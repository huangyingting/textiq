#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { scanRepositoryRoots, toPosix } from "./source-scan-utils.mjs";

const TEST_ROOTS = ["src", "scripts", "e2e"];
const SKIPPED_DIRECTORIES = new Set([
  ".next",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
]);
const TEST_FILE_PATTERN = /\.(?:test|spec)\.(?:ts|tsx|js|mjs)$/;
const TEST_FILE_NAME_PATTERN =
  /^[a-z0-9]+(?:[-.][a-z0-9]+)*(?:\.test|\.spec)\.(?:ts|tsx|js|mjs)$/;
const E2E_SPEC_FILE_PATTERN = /^[a-z0-9]+(?:[-.][a-z0-9]+)*\.spec\.ts$/;
const TEST_TITLE_ROOTS = new Set(["it", "test"]);
const WEAK_TEST_TITLES = new Set([
  "basic",
  "create",
  "delete",
  "handles",
  "loads",
  "render",
  "renders",
  "selection",
  "smoke",
  "test",
  "update",
  "works",
]);
const MIN_TEST_TITLE_LENGTH = 8;
const TEST_SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs"]);

export const SUBSYSTEM_TEST_TARGETS = {
  ai: {
    description: "AI generation routes, prompts, quotas, and model contracts",
    patterns: [/^src\/lib\/ai\//, /^src\/app\/api\/generate(?:-deck)?\//],
  },
  auth: {
    description: "Authentication, account lifecycle, settings, and login gates",
    patterns: [
      /^src\/auth\.config\.test\.ts$/,
      /^src\/auth\.test\.ts$/,
      /^src\/lib\/auth\//,
      /^src\/lib\/account\//,
      /^src\/lib\/settings\//,
      /^e2e\/(?:auth-redirect|authenticated-nested-routes|oauth-disabled|auth-forms|settings-account)\.spec\.ts$/,
      /^e2e\/ui-matrix\/auth-public-ui\.spec\.ts$/,
    ],
  },
  billing: {
    description:
      "Billing providers, entitlements, credits, and webhook handling",
    patterns: [
      /^src\/lib\/billing\//,
      /^src\/app\/api\/billing\//,
      /^e2e\/billing-brand\.spec\.ts$/,
      /^e2e\/ui-matrix\/workspace-billing-brand-ui\.spec\.ts$/,
    ],
  },
  brand: {
    description: "Brand Studio view models, brand assets, fonts, and samples",
    patterns: [
      /^src\/lib\/brand\//,
      /^src\/lib\/brand-studio\//,
      /^e2e\/billing-brand\.spec\.ts$/,
      /^e2e\/ui-matrix\/workspace-billing-brand-ui\.spec\.ts$/,
    ],
  },
  collaboration: {
    description:
      "Collaboration room access, server scripts, and flush/authorize APIs",
    patterns: [
      /^src\/lib\/collab\//,
      /^src\/app\/api\/collab\//,
      /^scripts\/collab-/,
    ],
  },
  commands: {
    description:
      "Command envelope, shortcuts, action ports, and mutation routing",
    patterns: [
      /^src\/lib\/actions\//,
      /^src\/lib\/commands\//,
      /^src\/lib\/shortcuts\//,
      /^scripts\/check-action-ports\.test\.mjs$/,
    ],
  },
  comments: {
    description:
      "Comment anchors, permissions, unread state, and lifecycle tests",
    patterns: [
      /^src\/lib\/comments\//,
      /^src\/app\/app\/documents\/.*comment.*\.test\.ts$/,
    ],
  },
  "data-model": {
    description:
      "Persisted JSON contracts, deck schemas, Prisma row mappers, and schema audit",
    patterns: [
      /^src\/lib\/data-contracts\//,
      /^src\/lib\/document\//,
      /^src\/lib\/presentation\/validation/,
      /^src\/lib\/schema-audit\//,
      /^src\/lib\/db\//,
      /^src\/lib\/db-provider\.test\.ts$/,
      /^src\/test\//,
      /^scripts\/gen-sqlite-schema\.test\.mjs$/,
    ],
  },
  diagnostics: {
    description:
      "Structured logs, diagnostic codes, telemetry, and abuse diagnostics",
    patterns: [
      /^src\/lib\/diagnostics\//,
      /^src\/lib\/log\.test\.ts$/,
      /^src\/lib\/telemetry\//,
      /^scripts\/structured-log\.test\.mjs$/,
    ],
  },
  documents: {
    description:
      "Document creation, listing, tags, search, templates, trash, and workspace UI",
    patterns: [
      /^src\/app\/app\/document-list/,
      /^src\/lib\/dashboard\//,
      /^src\/lib\/document\//,
      /^src\/lib\/document-stats\.test\.ts$/,
      /^src\/lib\/document-versions\.test\.ts$/,
      /^src\/lib\/documents\.test\.ts$/,
      /^src\/lib\/search\.test\.ts$/,
      /^src\/lib\/templates\//,
      /^src\/lib\/trash\.test\.ts$/,
      /^src\/lib\/workspace\//,
      /^e2e\/workspace\.spec\.ts$/,
      /^e2e\/ui-matrix\/workspace-billing-brand-ui\.spec\.ts$/,
    ],
  },
  editor: {
    description:
      "Lexical editor, document editor view models, and document editing flows",
    patterns: [
      /^src\/components\/editor\//,
      /^src\/lib\/document-editor\//,
      /^src\/lib\/lexical\//,
      /^src\/app\/app\/documents\//,
      /^e2e\/(?:authenticated-nested-routes|block-id-preservation|document-editor-profile)\.spec\.ts$/,
      /^e2e\/ui-matrix\/document-editor-ui\.spec\.ts$/,
    ],
  },
  import: {
    description:
      "Import parsers, content normalization, persistence, and import UI flow",
    patterns: [
      /^src\/lib\/content\//,
      /^src\/lib\/import\//,
      /^src\/app\/api\/import\//,
      /^e2e\/import-roundtrip\.spec\.ts$/,
    ],
  },
  localization: {
    description: "Locale catalog and language activation gate",
    patterns: [/^src\/lib\/i18n\//],
  },
  operations: {
    description:
      "Repository scripts, release guards, environment checks, and maintenance utilities",
    patterns: [
      /^scripts\/.*\.test\.mjs$/,
      /^src\/lib\/client-config\.test\.ts$/,
      /^src\/lib\/db-provider\.test\.ts$/,
      /^src\/lib\/env\.test\.ts$/,
      /^src\/lib\/limits\//,
      /^src\/lib\/maintenance\.test\.ts$/,
      /^src\/lib\/maintenance\//,
      /^src\/lib\/privacy\//,
      /^src\/lib\/schema-audit\//,
      /^src\/scripts\//,
      /^src\/test\//,
      /^e2e\/screenshot-regression\.spec\.ts$/,
      /^e2e\/ui-matrix\/catalog\.spec\.ts$/,
    ],
  },
  presentation: {
    description:
      "Slide editor, deck runtime, exports, assets, and present mode",
    patterns: [
      /^src\/components\/presentation\//,
      /^src\/lib\/assets\//,
      /^src\/lib\/presentation\//,
      /^src\/lib\/slides\//,
      /^src\/app\/api\/slide-assets\//,
      /^scripts\/(?:perf-budgets|slide-editor-size-budget)\.test\.mjs$/,
      /^e2e\/(?:present-export|screenshot-regression|slide-asset-upload|slides-layout-screenshots|slides-smoke)\.spec\.ts$/,
      /^e2e\/ui-matrix\/(?:catalog|presentation-ui|public-render-ui)\.spec\.ts$/,
    ],
  },
  product: {
    description: "Product-facing billing and brand surface coverage",
    patterns: [
      /^src\/lib\/billing\//,
      /^src\/lib\/brand\//,
      /^src\/lib\/brand-studio\//,
      /^src\/app\/api\/billing\//,
      /^e2e\/billing-brand\.spec\.ts$/,
      /^e2e\/ui-matrix\/workspace-billing-brand-ui\.spec\.ts$/,
    ],
  },
  "public-render": {
    description:
      "Public share, embed, present, metadata, and social-share rendering",
    patterns: [
      /^src\/lib\/public-render\//,
      /^src\/lib\/share\//,
      /^src\/lib\/share-access\.test\.ts$/,
      /^src\/lib\/share-passcode\.test\.ts$/,
      /^e2e\/(?:present-export|public-pages|share-fallback)\.spec\.ts$/,
      /^e2e\/ui-matrix\/(?:auth-public-ui|catalog|presentation-ui|public-render-ui)\.spec\.ts$/,
    ],
  },
  security: {
    description:
      "Authorization, API route policy, sharing, abuse controls, and asset access",
    patterns: [
      /^src\/proxy\.test\.ts$/,
      /^src\/app\/api\/api-route-security-matrix\.test\.ts$/,
      /^src\/app\/api\/slide-assets\//,
      /^src\/lib\/abuse-budget\.test\.ts$/,
      /^src\/lib\/access-policy\//,
      /^src\/lib\/access-query\.test\.ts$/,
      /^src\/lib\/api\//,
      /^src\/lib\/auth\/(?:authz|document-|page-route|workspace-)/,
      /^src\/lib\/invite-access\.test\.ts$/,
      /^src\/lib\/rate-limit\.test\.ts$/,
      /^src\/lib\/security-audit\.test\.ts$/,
      /^src\/lib\/share-access\.test\.ts$/,
      /^src\/lib\/share-passcode\.test\.ts$/,
      /^e2e\/(?:auth-redirect|oauth-disabled|share-fallback|slide-asset-upload)\.spec\.ts$/,
      /^e2e\/ui-matrix\/(?:auth-public-ui|public-render-ui)\.spec\.ts$/,
    ],
  },
  system: {
    description:
      "Cross-cutting helpers, app shell, view model contracts, and UI support logic",
    patterns: [
      /^src\/components\/ui\//,
      /^src\/lib\/a11y\//,
      /^src\/lib\/action-result\.test\.ts$/,
      /^src\/lib\/anchor-resolver\.test\.ts$/,
      /^src\/lib\/anchored-position\.test\.ts$/,
      /^src\/lib\/app-shell\//,
      /^src\/lib\/client-config\.test\.ts$/,
      /^src\/lib\/domain-identity\.test\.ts$/,
      /^src\/lib\/env\.test\.ts$/,
      /^src\/lib\/markdown\.test\.ts$/,
      /^src\/lib\/mobile-viewport\.test\.ts$/,
      /^src\/lib\/onboarding\//,
      /^src\/lib\/pointer\.test\.ts$/,
      /^src\/lib\/right-surface-coordinator\.test\.ts$/,
      /^src\/lib\/slug\.test\.ts$/,
      /^src\/lib\/taxonomy\.test\.ts$/,
      /^src\/lib\/view-models\//,
      /^e2e\/public-pages\.spec\.ts$/,
      /^e2e\/ui-matrix\/auth-public-ui\.spec\.ts$/,
    ],
  },
  ui: {
    description:
      "Reusable UI primitives, app chrome, a11y helpers, and viewport utilities",
    patterns: [
      /^src\/components\/ui\//,
      /^src\/lib\/a11y\//,
      /^src\/lib\/app-shell\//,
      /^src\/lib\/mobile-viewport\.test\.ts$/,
      /^scripts\/check-design-system\.test\.mjs$/,
      /^e2e\/ui-matrix\/catalog\.spec\.ts$/,
    ],
  },
  visual: {
    description:
      "Visual schemas, mirror logic, rendering helpers, icons, and visual components",
    patterns: [
      /^src\/components\/visual\//,
      /^src\/lib\/icons\//,
      /^src\/lib\/visual\//,
      /^src\/lib\/lexical\/visual/,
      /^e2e\/(?:screenshot-regression|slides-layout-screenshots)\.spec\.ts$/,
    ],
  },
  workspace: {
    description: "Workspace capabilities and owner/editor/viewer behavior",
    patterns: [
      /^src\/lib\/workspace\//,
      /^e2e\/workspace\.spec\.ts$/,
      /^e2e\/ui-matrix\/workspace-billing-brand-ui\.spec\.ts$/,
    ],
  },
};

export function listTestFiles(repoRoot = process.cwd()) {
  return scanRepositoryRoots({
    repoRoot,
    roots: TEST_ROOTS,
    sourceExtensions: TEST_SOURCE_EXTENSIONS,
    scanText: (filePath) => [filePath],
    shouldScanFile: (filePath) => TEST_FILE_PATTERN.test(filePath),
    skipDirectoryNames: SKIPPED_DIRECTORIES,
  }).sort();
}

export function listSubsystems() {
  return Object.keys(SUBSYSTEM_TEST_TARGETS).sort();
}

export function classifyTestFile(filePath) {
  const normalized = toPosix(filePath);
  return listSubsystems().filter((name) =>
    SUBSYSTEM_TEST_TARGETS[name].patterns.some((pattern) =>
      pattern.test(normalized),
    ),
  );
}

export function findUnclassifiedTestFiles(testFiles) {
  return testFiles
    .map(toPosix)
    .filter((filePath) => classifyTestFile(filePath).length === 0)
    .sort();
}

export function findSubsystemCoverageGaps(testFiles) {
  const coveredSubsystems = new Set(testFiles.flatMap(classifyTestFile));
  return listSubsystems().filter((name) => !coveredSubsystems.has(name));
}

export function findTestFileNameProblems(testFiles) {
  return testFiles
    .map(toPosix)
    .flatMap((filePath) => {
      const fileName = basename(filePath);
      const findings = [];
      if (!TEST_FILE_NAME_PATTERN.test(fileName)) {
        findings.push({
          filePath,
          rule: "test-file-name",
          message:
            "Use lowercase kebab/dotted names ending in .test.* or .spec.*.",
        });
      }
      if (
        filePath.startsWith("e2e/") &&
        !E2E_SPEC_FILE_PATTERN.test(fileName)
      ) {
        findings.push({
          filePath,
          rule: "e2e-spec-name",
          message: "E2E files should use lowercase kebab .spec.ts names.",
        });
      }
      if (!filePath.startsWith("e2e/") && fileName.includes(".spec.")) {
        findings.push({
          filePath,
          rule: "unit-test-name",
          message: "Unit and script tests should use .test.* names.",
        });
      }
      return findings;
    })
    .sort((left, right) => left.filePath.localeCompare(right.filePath));
}

function scriptKindForPath(filePath) {
  if (filePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (filePath.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function callRootName(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) {
    return callRootName(expression.expression);
  }
  return null;
}

function literalText(node) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return null;
}

function lineAndColumn(sourceFile, node) {
  const position = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );
  return {
    lineNumber: position.line + 1,
    columnNumber: position.character + 1,
  };
}

export function scanTestText(filePath, text) {
  const sourceFile = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(filePath),
  );
  const findings = [];

  function visit(node) {
    if (ts.isCallExpression(node)) {
      const rootName = callRootName(node.expression);
      const title = literalText(node.arguments[0]);
      if (rootName && TEST_TITLE_ROOTS.has(rootName) && title !== null) {
        const normalizedTitle = title.trim().toLowerCase();
        if (
          normalizedTitle.length < MIN_TEST_TITLE_LENGTH ||
          WEAK_TEST_TITLES.has(normalizedTitle)
        ) {
          findings.push({
            filePath: toPosix(filePath),
            ...lineAndColumn(sourceFile, node.arguments[0]),
            rule: "weak-test-title",
            match: title,
            message: "Use a behavior-specific test title.",
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

export function findWeakTestTitleProblems(
  testFiles,
  {
    repoRoot = process.cwd(),
    readText = (filePath) => readFileSync(join(repoRoot, filePath), "utf8"),
  } = {},
) {
  return testFiles
    .map(toPosix)
    .flatMap((filePath) => scanTestText(filePath, readText(filePath)))
    .sort(
      (left, right) =>
        left.filePath.localeCompare(right.filePath) ||
        left.lineNumber - right.lineNumber,
    );
}

export function runTestCoverageAudit(testFiles, options = {}) {
  return {
    unclassified: findUnclassifiedTestFiles(testFiles),
    emptySubsystems: findSubsystemCoverageGaps(testFiles),
    fileNameProblems: findTestFileNameProblems(testFiles),
    weakTitleProblems: findWeakTestTitleProblems(testFiles, options),
  };
}

function auditHasProblems(audit) {
  return Object.values(audit).some((items) => items.length > 0);
}

function printAuditProblems(audit) {
  if (audit.unclassified.length > 0) {
    console.error("Unclassified test files:");
    for (const filePath of audit.unclassified) console.error(`- ${filePath}`);
  }
  if (audit.emptySubsystems.length > 0) {
    console.error("Subsystems without test coverage:");
    for (const subsystem of audit.emptySubsystems)
      console.error(`- ${subsystem}`);
  }
  if (audit.fileNameProblems.length > 0) {
    console.error("Unclear test file names:");
    for (const item of audit.fileNameProblems) {
      console.error(`- ${item.filePath} ${item.rule}: ${item.message}`);
    }
  }
  if (audit.weakTitleProblems.length > 0) {
    console.error("Weak test case names:");
    for (const item of audit.weakTitleProblems) {
      console.error(
        `- ${item.filePath}:${item.lineNumber}:${item.columnNumber} ${item.rule} ${JSON.stringify(item.match)}: ${item.message}`,
      );
    }
  }
}

function normalizeSubsystems(subsystems) {
  const unique = [...new Set(subsystems.map((name) => name.trim()))].filter(
    Boolean,
  );
  const unknown = unique.filter((name) => !SUBSYSTEM_TEST_TARGETS[name]);
  if (unknown.length > 0) {
    throw new Error(
      `Unknown subsystem: ${unknown.join(", ")}. Run npm run test:subsystem -- --list.`,
    );
  }
  if (unique.length === 0) {
    throw new Error("Choose at least one subsystem to test.");
  }
  return unique.sort();
}

function splitByRunner(files) {
  return {
    source: files.filter((filePath) => filePath.startsWith("src/")),
    scripts: files.filter((filePath) => filePath.startsWith("scripts/")),
    e2e: files.filter((filePath) => filePath.startsWith("e2e/")),
  };
}

export function buildTestPlan({ subsystems, testFiles, includeE2e = false }) {
  const normalizedSubsystems = normalizeSubsystems(subsystems);
  const selected = testFiles
    .map(toPosix)
    .filter((filePath) => {
      const owners = classifyTestFile(filePath);
      return normalizedSubsystems.some((name) => owners.includes(name));
    })
    .sort();
  const buckets = splitByRunner(selected);
  const commands = [];

  if (buckets.source.length > 0) {
    commands.push({
      label: "source unit tests",
      command: "node",
      args: ["--import", "tsx", "--test", ...buckets.source],
    });
  }
  if (buckets.scripts.length > 0) {
    commands.push({
      label: "script tests",
      command: "node",
      args: ["--test", ...buckets.scripts],
    });
  }
  if (includeE2e && buckets.e2e.length > 0) {
    commands.push({
      label: "e2e tests",
      command: "npx",
      args: ["playwright", "test", ...buckets.e2e],
    });
  }

  return {
    subsystems: normalizedSubsystems,
    files: selected,
    buckets,
    commands,
    skippedE2e: includeE2e ? [] : buckets.e2e,
  };
}

function displayCommand({ command, args }) {
  return [command, ...args].join(" ");
}

function printUsage() {
  console.log(`Usage:
  npm run test:subsystem -- <subsystem> [more-subsystems] [--with-e2e]
  npm run test:subsystem -- --list
  npm run test:subsystem -- --check
  npm run test:subsystem -- <subsystem> --dry-run

Examples:
  npm run test:subsystem -- editor
  npm run test:subsystem -- presentation --with-e2e
  npm run test:subsystem -- auth security --dry-run`);
}

function parseArgs(argv) {
  const options = {
    check: false,
    dryRun: false,
    help: false,
    includeE2e: false,
    list: false,
    subsystems: [],
  };

  for (const arg of argv) {
    if (arg === "--check") options.check = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--list") options.list = true;
    else if (arg === "--with-e2e" || arg === "--e2e") options.includeE2e = true;
    else options.subsystems.push(arg);
  }

  return options;
}

function printSubsystemList(testFiles) {
  for (const name of listSubsystems()) {
    const plan = buildTestPlan({ subsystems: [name], testFiles });
    const unitCount = plan.buckets.source.length + plan.buckets.scripts.length;
    const e2eCount = plan.buckets.e2e.length;
    console.log(
      `${name}: ${unitCount} unit/script, ${e2eCount} e2e - ${SUBSYSTEM_TEST_TARGETS[name].description}`,
    );
  }
}

function runCommands(commands) {
  for (const testCommand of commands) {
    console.log(
      `\n[test:subsystem] ${testCommand.label}: ${displayCommand(testCommand)}`,
    );
    const result = spawnSync(testCommand.command, testCommand.args, {
      stdio: "inherit",
      env: process.env,
    });
    if (result.status !== 0) {
      return result.status ?? 1;
    }
  }
  return 0;
}

export function main(argv = process.argv.slice(2), repoRoot = process.cwd()) {
  const options = parseArgs(argv);
  const testFiles = listTestFiles(repoRoot);

  if (options.help) {
    printUsage();
    return 0;
  }
  if (options.list) {
    printSubsystemList(testFiles);
    return 0;
  }
  if (options.check) {
    const audit = runTestCoverageAudit(testFiles, { repoRoot });
    if (auditHasProblems(audit)) {
      printAuditProblems(audit);
      return 1;
    }
    console.log(
      `Test subsystem coverage and naming audit passed (${testFiles.length} files, ${listSubsystems().length} subsystems).`,
    );
    return 0;
  }

  let plan;
  try {
    plan = buildTestPlan({
      subsystems: options.subsystems,
      testFiles,
      includeE2e: options.includeE2e,
    });
  } catch (error) {
    console.error(error.message);
    printUsage();
    return 1;
  }

  if (plan.files.length === 0) {
    console.error(`No test files matched: ${plan.subsystems.join(", ")}`);
    return 1;
  }

  console.log(
    `[test:subsystem] ${plan.subsystems.join(", ")}: ${plan.files.length} matching test file(s).`,
  );
  if (plan.skippedE2e.length > 0) {
    console.log(
      `[test:subsystem] ${plan.skippedE2e.length} e2e file(s) are mapped but skipped. Add --with-e2e to include them.`,
    );
  }

  if (options.dryRun) {
    for (const testCommand of plan.commands)
      console.log(displayCommand(testCommand));
    if (plan.commands.length === 0)
      console.log("No unit/script commands selected.");
    return 0;
  }

  if (plan.commands.length === 0) {
    console.error(
      "No unit/script tests selected. Re-run with --with-e2e if this subsystem only has e2e coverage.",
    );
    return 1;
  }

  return runCommands(plan.commands);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main();
}
