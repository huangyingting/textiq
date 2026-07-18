import assert from "node:assert/strict";
import { test } from "node:test";

import { createReactRenderHarness } from "@/test/react-render-harness";

import {
  DEFAULT_PRECISION_GUIDE_PREFERENCES,
  precisionGuidesStorageKey,
} from "./precision-guides-storage";
import { usePrecisionGuides } from "./use-precision-guides";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

function restoreWindow() {
  if (originalWindow) {
    Object.defineProperty(globalThis, "window", originalWindow);
    return;
  }
  Reflect.deleteProperty(globalThis, "window");
}

test("usePrecisionGuides starts from SSR-safe defaults before browser storage loads", () => {
  const documentId = "doc-hydration";
  const storageKey = precisionGuidesStorageKey(documentId);
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) =>
          key === storageKey
            ? JSON.stringify({
                gridVisible: true,
                rulersVisible: true,
                guidesVisible: true,
                customGuides: [{ axis: "x", positionPct: 50 }],
              })
            : null,
        setItem: () => undefined,
      },
    },
  });

  test("usePrecisionGuides validates, persists, and announces custom guide operations", () => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) => values.get(key) ?? null,
          setItem: (key: string, value: string) => values.set(key, value),
        },
      },
    });
    const announcements: string[] = [];
    const renderer = createReactRenderHarness();
    const render = () =>
      renderer.run(() =>
        usePrecisionGuides("doc-guides", (message) =>
          announcements.push(message),
        ),
      );

    try {
      let guides = render();
      guides.addCustomGuide("x", "125");
      guides = render();
      assert.deepEqual(guides.precisionGuides.customGuides, []);
      assert.equal(
        announcements.at(-1),
        "Enter a guide position between 0 and 100 percent",
      );

      guides.addCustomGuide("x", "100");
      guides = render();
      assert.deepEqual(guides.precisionGuides.customGuides, [
        { axis: "x", positionPct: 100 },
      ]);
      assert.equal(guides.precisionGuides.guidesVisible, true);
      assert.match(
        values.get(precisionGuidesStorageKey("doc-guides")) ?? "",
        /"positionPct":100/,
      );
      assert.equal(announcements.at(-1), "Added vertical guide at 100%");

      guides.addCustomGuide("y", "not-a-number");
      guides = render();
      assert.equal(guides.precisionGuides.customGuides.length, 1);
      assert.equal(
        announcements.at(-1),
        "Enter a guide position between 0 and 100 percent",
      );

      guides.toggleCustomGuidesVisible();
      guides = render();
      assert.equal(guides.precisionGuides.guidesVisible, false);
      assert.equal(announcements.at(-1), "Custom guides hidden");

      guides.removeCustomGuide(0);
      guides = render();
      assert.deepEqual(guides.precisionGuides.customGuides, []);
      assert.equal(announcements.at(-1), "Removed vertical guide at 100%");
    } finally {
      renderer.cleanup();
      restoreWindow();
    }
  });

  const renderer = createReactRenderHarness();
  try {
    const { precisionGuides } = renderer.run(() =>
      usePrecisionGuides(documentId, () => undefined),
    );

    assert.deepEqual(precisionGuides, DEFAULT_PRECISION_GUIDE_PREFERENCES);
  } finally {
    renderer.cleanup();
    restoreWindow();
  }
});
