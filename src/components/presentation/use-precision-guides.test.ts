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
