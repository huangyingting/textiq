import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { load as parseYaml } from "js-yaml";

const SECURITY_AUDIT_COMMAND =
  "npm audit --omit=dev --audit-level=high && npm audit signatures";

function markdownSection(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line === heading);
  assert.notEqual(start, -1, `Missing Markdown section: ${heading}`);

  const level = heading.match(/^#+/)?.[0].length ?? 0;
  const end = lines.findIndex(
    (line, index) =>
      index > start && new RegExp(`^#{1,${level}}\\s`).test(line),
  );

  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

test("dependency security: package script audits runtime advisories and provenance", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

  assert.equal(packageJson.scripts?.["security:audit"], SECURITY_AUDIT_COMMAND);
});

test("dependency security: CI audits immediately after installing dependencies", () => {
  const workflow = parseYaml(readFileSync(".github/workflows/ci.yml", "utf8"));
  const steps = workflow?.jobs?.["quality-gate"]?.steps ?? [];
  const installIndex = steps.findIndex((step) => step?.run === "npm ci");
  const auditIndexes = steps.flatMap((step, index) =>
    step?.run === "npm run security:audit" ? [index] : [],
  );

  assert.notEqual(installIndex, -1, "CI must install dependencies with npm ci");
  assert.deepEqual(auditIndexes, [installIndex + 1]);
});

test("dependency security: release gate documents the audit as a blocker", () => {
  const releaseGate = readFileSync("docs/operations/release-gate.md", "utf8");
  const automatedGate = markdownSection(
    releaseGate,
    "## Part 1 — Automated quality gate",
  );
  const blockers = markdownSection(
    releaseGate,
    "### Release blockers (must be green)",
  );
  const signOff = markdownSection(
    releaseGate,
    "## Part 4 — Sign-off procedure",
  );

  for (const section of [automatedGate, blockers, signOff]) {
    assert.match(section, /`?npm run security:audit`?/);
  }
  assert.match(automatedGate, /All ten steps must be green/);
  assert.match(signOff, /All ten must exit 0/);
});
