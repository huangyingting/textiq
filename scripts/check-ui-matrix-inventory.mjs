#!/usr/bin/env node

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { toPosix } from "./source-scan-utils.mjs";

export const GENERATED_START = "<!-- ui-matrix-inventory:start -->";
export const GENERATED_END = "<!-- ui-matrix-inventory:end -->";

const README_PATH = join("e2e", "ui-matrix", "README.md");

function walkFiles(
  root,
  skipDirectoryNames = new Set(["node_modules", ".next"]),
) {
  const files = [];
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    return files;
  }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (skipDirectoryNames.has(entry.name)) {
      continue;
    }
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath, skipDirectoryNames));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

export function collectPlaywrightSpecs(repoRoot = process.cwd()) {
  return walkFiles(join(repoRoot, "e2e"))
    .map((filePath) => toPosix(relative(repoRoot, filePath)))
    .filter((filePath) => filePath.endsWith(".spec.ts"))
    .sort();
}

function compareSets(actual, documented) {
  const actualSet = new Set(actual);
  const documentedSet = new Set(documented);
  return {
    missing: actual.filter((item) => !documentedSet.has(item)),
    stale: documented.filter((item) => !actualSet.has(item)),
  };
}

function markdownTable(headers, rows) {
  const widths = headers.map((header, column) =>
    Math.max(
      header.length,
      3,
      ...rows.map((row) => String(row[column] ?? "").length),
    ),
  );
  const formatRow = (row) =>
    `| ${row.map((cell, index) => String(cell ?? "").padEnd(widths[index])).join(" | ")} |`;
  return [
    formatRow(headers),
    `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`,
    ...rows.map(formatRow),
  ].join("\n");
}

function statusSummaryRows(summary) {
  return Object.entries(summary.bySubsystem)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([subsystem, counts]) => [
      subsystem,
      counts.total,
      counts.automated,
      counts.manual,
      counts.blocked,
      counts.catalog,
    ]);
}

function joinList(values) {
  return values.join(", ");
}

function codeList(values) {
  return joinList(values.map((value) => `\`${value}\``));
}

export function summarizeSpecInventory(specInventory) {
  return specInventory.reduce(
    (summary, entry) => {
      summary.total += 1;
      summary.byRunMode[entry.runMode] =
        (summary.byRunMode[entry.runMode] ?? 0) + 1;
      for (const owner of entry.owners) {
        summary.byOwner[owner] = (summary.byOwner[owner] ?? 0) + 1;
      }
      return summary;
    },
    { total: 0, byRunMode: {}, byOwner: {} },
  );
}

export function renderInventoryMarkdown({
  specInventory,
  manualGaps,
  caseSummary,
}) {
  const specSummary = summarizeSpecInventory(specInventory);
  const runModeRows = Object.entries(specSummary.byRunMode)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([mode, count]) => [mode, count]);
  const specRows = specInventory.map((entry) => [
    `\`${entry.spec}\``,
    joinList(entry.owners),
    entry.runMode,
    codeList(entry.prerequisites),
    joinList(entry.roles),
    joinList(entry.devices),
    entry.ciStatus,
  ]);
  const gapRows = manualGaps.map((gap) => [
    gap.id,
    gap.owner,
    gap.status,
    gap.gap,
    joinList(gap.sourceRefs.map((source) => `\`${source}\``)),
  ]);

  return [
    GENERATED_START,
    "## Source-backed catalog distribution",
    "",
    "The 500-case catalog is generated from `e2e/ui-matrix/cases.ts`; this README section is rendered and checked by `scripts/check-ui-matrix-inventory.mjs`.",
    "",
    markdownTable(
      ["Subsystem", "Total", "Automated", "Manual", "Blocked", "Catalog"],
      [
        ...statusSummaryRows(caseSummary),
        [
          "Total",
          caseSummary.total,
          caseSummary.byStatus.automated,
          caseSummary.byStatus.manual,
          caseSummary.byStatus.blocked,
          caseSummary.byStatus.catalog,
        ],
      ],
    ),
    "",
    "`automated` means covered by a representative runnable spec in this directory or the deterministic profile. `manual` means human exploratory or release-gate validation is still expected. `blocked` means product hooks, deterministic fixture coverage, or stable selectors are missing. `catalog` means planned coverage that is not currently a release gate.",
    "",
    "## Playwright spec inventory",
    "",
    `The repository currently has ${specSummary.total} Playwright specs under \`e2e/\`. Every \`e2e/**/*.spec.ts\` file must appear here, and stale rows fail the inventory check.`,
    "",
    markdownTable(["Run mode", "Specs"], runModeRows),
    "",
    markdownTable(
      [
        "Spec",
        "Owners",
        "Run mode",
        "Prerequisites / gates",
        "Roles",
        "Devices / viewports",
        "CI status",
      ],
      specRows,
    ),
    "",
    "## Known manual, blocked, and catalog gaps",
    "",
    markdownTable(["ID", "Owner", "Status", "Gap", "Sources"], gapRows),
    "",
    "## Drift guard",
    "",
    "Run `npm run ui-matrix:check` after adding, renaming, or removing any `e2e/**/*.spec.ts` file. Use `npm run ui-matrix:write` to refresh this generated README section after changing `e2e/ui-matrix/inventory.ts` or `e2e/ui-matrix/cases.ts`.",
    GENERATED_END,
  ].join("\n");
}

export function replaceGeneratedInventorySection(readme, rendered) {
  const startIndex = readme.indexOf(GENERATED_START);
  const endIndex = readme.indexOf(GENERATED_END);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error(
      `${README_PATH} must contain ${GENERATED_START} and ${GENERATED_END} markers`,
    );
  }
  return `${readme.slice(0, startIndex)}${rendered}${readme.slice(endIndex + GENERATED_END.length)}`;
}

function referencePath(sourceRef) {
  return sourceRef.split("#")[0];
}

function validateReferences(repoRoot, specInventory, manualGaps) {
  const references = new Set();
  for (const entry of specInventory) {
    references.add(entry.spec);
    for (const sourceRef of entry.sourceRefs)
      references.add(referencePath(sourceRef));
  }
  for (const gap of manualGaps) {
    for (const sourceRef of gap.sourceRefs)
      references.add(referencePath(sourceRef));
  }
  return [...references]
    .filter((sourceRef) => sourceRef.length > 0)
    .filter((sourceRef) => !existsSync(join(repoRoot, sourceRef)))
    .sort();
}

function validateUniqueSpecs(specInventory) {
  const seen = new Set();
  return specInventory
    .map((entry) => entry.spec)
    .filter((spec) => {
      if (seen.has(spec)) return true;
      seen.add(spec);
      return false;
    })
    .sort();
}

export function validateUiMatrixInventory({
  repoRoot = process.cwd(),
  specInventory,
  manualGaps,
  caseSummary,
  automatedSpecs,
  readmeText,
}) {
  const findings = [];
  const actualSpecs = collectPlaywrightSpecs(repoRoot);
  const documentedSpecs = specInventory.map((entry) => entry.spec).sort();
  const { missing, stale } = compareSets(actualSpecs, documentedSpecs);
  const duplicateSpecs = validateUniqueSpecs(specInventory);
  const missingReferences = validateReferences(
    repoRoot,
    specInventory,
    manualGaps,
  );
  const automatedCompare = compareSets(
    [...new Set(automatedSpecs)].sort(),
    documentedSpecs,
  );

  for (const spec of missing) {
    findings.push({ rule: "missing-spec-inventory", item: spec });
  }
  for (const spec of stale) {
    findings.push({ rule: "stale-spec-inventory", item: spec });
  }
  for (const spec of duplicateSpecs) {
    findings.push({ rule: "duplicate-spec-inventory", item: spec });
  }
  for (const sourceRef of missingReferences) {
    findings.push({ rule: "missing-source-reference", item: sourceRef });
  }
  for (const spec of automatedCompare.missing) {
    findings.push({ rule: "automated-spec-not-in-inventory", item: spec });
  }

  const rendered = renderInventoryMarkdown({
    specInventory,
    manualGaps,
    caseSummary,
  });
  if (typeof readmeText === "string") {
    let expected;
    try {
      expected = replaceGeneratedInventorySection(readmeText, rendered);
    } catch (error) {
      findings.push({ rule: "readme-marker-error", item: error.message });
    }
    if (expected && expected !== readmeText) {
      findings.push({ rule: "readme-inventory-drift", item: README_PATH });
    }
  }

  return { findings, rendered };
}

/* node:coverage ignore next 79 */
async function loadDefaultInventory(repoRoot) {
  const inventoryModule = await import(
    pathToFileURL(join(repoRoot, "e2e", "ui-matrix", "inventory.ts")).href
  );
  const casesModule = await import(
    pathToFileURL(join(repoRoot, "e2e", "ui-matrix", "cases.ts")).href
  );
  const automatedSpecs = casesModule.UI_TEST_CASES.filter(
    (testCase) => testCase.status === "automated" && testCase.automation,
  ).map((testCase) => testCase.automation.spec);
  return {
    specInventory: inventoryModule.UI_MATRIX_SPEC_INVENTORY,
    manualGaps: inventoryModule.UI_MATRIX_MANUAL_GAPS,
    caseSummary: casesModule.summarizeUiCases(),
    automatedSpecs,
  };
}

async function formatMarkdown(markdown) {
  const prettier = await import("prettier");
  return await prettier.format(markdown, { parser: "markdown" });
}

function printFindings(findings) {
  console.error("UI matrix inventory drift detected:");
  for (const finding of findings) {
    console.error(`  - ${finding.rule}: ${finding.item}`);
  }
}

async function main() {
  const repoRoot = process.cwd();
  const write = process.argv.includes("--write");
  const readmePath = join(repoRoot, README_PATH);
  const readmeText = readFileSync(readmePath, "utf8");
  const data = await loadDefaultInventory(repoRoot);
  const result = validateUiMatrixInventory({
    repoRoot,
    ...data,
  });
  let expectedReadme;
  try {
    expectedReadme = await formatMarkdown(
      replaceGeneratedInventorySection(readmeText, result.rendered),
    );
  } catch (error) {
    result.findings.push({ rule: "readme-marker-error", item: error.message });
  }

  if (write) {
    if (!expectedReadme || result.findings.length > 0) {
      printFindings(result.findings);
      process.exitCode = 1;
      return;
    }
    writeFileSync(readmePath, expectedReadme);
    console.log(`${toPosix(README_PATH)} refreshed.`);
    return;
  }

  if (expectedReadme && expectedReadme !== readmeText) {
    result.findings.push({ rule: "readme-inventory-drift", item: README_PATH });
  }

  if (result.findings.length > 0) {
    printFindings(result.findings);
    process.exitCode = 1;
    return;
  }

  console.log("UI matrix inventory check passed.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
