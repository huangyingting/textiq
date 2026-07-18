import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  customGuidesForSnapping,
  normalizePrecisionGuidePreferences,
  precisionGuidesStorageKey,
  readPrecisionGuidePreferences,
  writePrecisionGuidePreferences,
} from "./precision-guides-storage";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    values,
  };
}

describe("precision guide preferences storage", () => {
  test("normalizes persisted overlay flags and custom guide positions", () => {
    assert.deepEqual(
      normalizePrecisionGuidePreferences({
        gridVisible: true,
        rulersVisible: true,
        guidesVisible: true,
        customGuides: [
          { axis: "x", positionPct: "33.333" },
          { axis: "x", positionPct: 33.333 },
          { axis: "y", positionPct: 150 },
          { axis: "z", positionPct: 50 },
        ],
      }),
      {
        gridVisible: true,
        rulersVisible: true,
        guidesVisible: true,
        customGuides: [
          { axis: "x", positionPct: 33.33 },
          { axis: "y", positionPct: 100 },
        ],
      },
    );
  });

  test("reads and writes document-scoped preferences", () => {
    const storage = memoryStorage();

    writePrecisionGuidePreferences(
      "deck a",
      {
        gridVisible: true,
        rulersVisible: false,
        guidesVisible: true,
        customGuides: [{ axis: "y", positionPct: 42 }],
      },
      storage,
    );

    assert.equal(storage.values.has(precisionGuidesStorageKey("deck a")), true);
    assert.deepEqual(readPrecisionGuidePreferences("deck a", storage), {
      gridVisible: true,
      rulersVisible: false,
      guidesVisible: true,
      customGuides: [{ axis: "y", positionPct: 42 }],
    });
    assert.deepEqual(readPrecisionGuidePreferences("other deck", storage), {
      gridVisible: false,
      rulersVisible: false,
      guidesVisible: false,
      customGuides: [],
    });

    test("only exposes visible custom guides to snapping controllers", () => {
      const customGuides = [{ axis: "x" as const, positionPct: 37 }];

      assert.deepEqual(
        customGuidesForSnapping({
          gridVisible: false,
          rulersVisible: false,
          guidesVisible: false,
          customGuides,
        }),
        [],
      );
      assert.equal(
        customGuidesForSnapping({
          gridVisible: false,
          rulersVisible: false,
          guidesVisible: true,
          customGuides,
        }),
        customGuides,
      );
    });
  });
});
