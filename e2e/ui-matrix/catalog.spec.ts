import { expect, test } from "@playwright/test";

import { UI_TEST_CASES, UI_TEST_CASE_TOTAL, summarizeUiCases } from "./cases";
import { UI_MATRIX_SPEC_INVENTORY } from "./inventory";

test.describe("UI matrix catalog @required-profile", () => {
  test("catalogs exactly 500 subsystem UI cases with unique IDs", () => {
    const ids = new Set(UI_TEST_CASES.map((testCase) => testCase.id));
    const summary = summarizeUiCases();

    expect(summary.total).toBe(UI_TEST_CASE_TOTAL);
    expect(ids.size).toBe(UI_TEST_CASE_TOTAL);
    expect(summary.bySubsystem["presentation-editor"].total).toBe(180);
    expect(summary.bySubsystem["presentation-render-export"].total).toBe(120);
    expect(summary.bySubsystem["public-render-share"].total).toBe(60);
    expect(summary.bySubsystem["auth-public"].total).toBe(40);
    expect(summary.bySubsystem["document-editor"].total).toBe(45);
    expect(summary.bySubsystem["workspace-billing-brand"].total).toBe(55);
    expect(summary.byStatus.automated).toBe(98);
  });

  test("keeps every automated case tied to a runnable Playwright spec", () => {
    const automatedCases = UI_TEST_CASES.filter(
      (testCase) => testCase.status === "automated",
    );
    const inventoriedSpecs = new Set<string>(
      UI_MATRIX_SPEC_INVENTORY.map((entry) => entry.spec),
    );

    expect(automatedCases.length).toBe(98);
    for (const testCase of automatedCases) {
      expect(testCase.automation?.spec).toMatch(
        /^e2e\/ui-matrix\/.*\.spec\.ts$/,
      );
      expect(inventoriedSpecs.has(testCase.automation!.spec)).toBe(true);
      expect(testCase.refs.length).toBeGreaterThan(0);
      expect(testCase.title).toContain(testCase.area);
    }
  });
});
