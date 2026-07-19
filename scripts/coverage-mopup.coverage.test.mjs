import assert from "node:assert/strict";
import test from "node:test";

import { runCombinedCoverageGate } from "./check-combined-coverage.mjs";

function passingHarness(env) {
  const errors = [];
  return {
    errors,
    options: {
      env,
      repoRoot: "/repo",
      listEligible: () => ["src/a.ts"],
      listTestFiles: () => ["src/a.test.ts"],
      collectLoaded: async () => ({
        loaded: new Set(),
        failureCount: 0,
        summary: {
          files: [
            {
              path: "/repo/src/a.ts",
              totalLineCount: 100,
              coveredLineCount: 100,
              totalBranchCount: 100,
              coveredBranchCount: 100,
              totalFunctionCount: 100,
              coveredFunctionCount: 100,
            },
          ],
        },
      }),
      buildReport: () => ({
        eligibleCount: 1,
        runtimeEligibleCount: 1,
        loadedRuntimeCount: 1,
        unloadedRuntimeCount: 0,
        typeOnlyCount: 0,
        barrelCount: 0,
        mappedInteractionCount: 0,
        approvedExceptionCount: 0,
        actionableGapCount: 0,
        files: {
          "unit-loaded": [],
          "type-only": [],
          barrel: [],
          "mapped-e2e": [],
          "approved-exception": [],
          gap: [],
        },
      }),
      formatReport: () => "FORMATTED REPORT",
      spawn: () => ({ status: 0 }),
      reporter: null,
      log: () => {},
      logError: (line) => errors.push(line),
    },
  };
}

test("runCombinedCoverageGate reports invalid script-stage threshold overrides", async () => {
  const h = passingHarness({ SCRIPT_LINE_COVERAGE_MIN: "not-a-number" });

  const exitCode = await runCombinedCoverageGate(h.options);

  assert.equal(exitCode, 1);
  assert.ok(h.errors.some((line) => line.includes("SCRIPT_LINE_COVERAGE_MIN")));
});
