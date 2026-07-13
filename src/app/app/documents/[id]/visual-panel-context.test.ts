/**
 * Direct behavior coverage for `VisualPanelProvider` / `useVisualPanel` (#1947).
 *
 * `VisualPanelProvider` is a plain React Context bridge with no Lexical or
 * DOM dependency of its own, so it is mounted directly with
 * `react-test-renderer`'s `act`/`create`/`update` (mirroring the pattern
 * already used by `src/lib/lexical/editor-context-provider.test.ts`) rather
 * than the shared harness's `run()` (which never mounts what it builds).
 * Importing `createReactRenderHarness` is for its module-level side effect
 * only: it flips on `IS_REACT_ACT_ENVIRONMENT`, which `act()` requires.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

// Side effect only: sets IS_REACT_ACT_ENVIRONMENT.
import { createReactRenderHarness } from "@/test/react-render-harness";

import { useVisualPanel, VisualPanelProvider } from "./visual-panel-context";

createReactRenderHarness();

function mountProvider() {
  const seen: ReturnType<typeof useVisualPanel>[] = [];
  function Inner() {
    seen.push(useVisualPanel());
    return null;
  }

  let renderer: ReactTestRenderer | null = null;
  act(() => {
    renderer = create(
      createElement(VisualPanelProvider, null, createElement(Inner)),
    );
  });

  return {
    latest: () => {
      assert.ok(seen.length > 0, "expected the provider to have rendered");
      return seen[seen.length - 1];
    },
    unmount: () => {
      act(() => {
        renderer?.unmount();
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Default context (no provider ancestor)
// ---------------------------------------------------------------------------

test("useVisualPanel outside any provider returns the null/no-op default", () => {
  const harness = createReactRenderHarness();
  try {
    const value = harness.run(() => useVisualPanel());
    assert.deepEqual(value.activeVisual, null);
    assert.equal(value.onClose, null);
    assert.equal(value.selectedNodeId, null);
    // Setters are stable no-ops; calling them must not throw.
    assert.doesNotThrow(() => value.setActiveVisual(null));
    assert.doesNotThrow(() => value.setOnClose(null));
    assert.doesNotThrow(() => value.setSelectedNodeId(null));
  } finally {
    harness.cleanup();
  }
});

// ---------------------------------------------------------------------------
// setActiveVisual
// ---------------------------------------------------------------------------

test("setActiveVisual propagates the active visual to consumers", () => {
  const harness = mountProvider();
  try {
    assert.equal(harness.latest().activeVisual, null);

    act(() => {
      harness
        .latest()
        .setActiveVisual({ nodeKey: "node-1", visualId: "visual-1" });
    });

    assert.deepEqual(harness.latest().activeVisual, {
      nodeKey: "node-1",
      visualId: "visual-1",
    });
  } finally {
    harness.unmount();
  }
});

test("setActiveVisual(null) clears a previously active visual", () => {
  const harness = mountProvider();
  try {
    act(() => {
      harness
        .latest()
        .setActiveVisual({ nodeKey: "node-1", visualId: "visual-1" });
    });
    assert.notEqual(harness.latest().activeVisual, null);

    act(() => {
      harness.latest().setActiveVisual(null);
    });
    assert.equal(harness.latest().activeVisual, null);
  } finally {
    harness.unmount();
  }
});

// ---------------------------------------------------------------------------
// setSelectedNodeId
// ---------------------------------------------------------------------------

test("setSelectedNodeId propagates the selected sub-node id to consumers", () => {
  const harness = mountProvider();
  try {
    assert.equal(harness.latest().selectedNodeId, null);

    act(() => {
      harness.latest().setSelectedNodeId("sub-node-9");
    });
    assert.equal(harness.latest().selectedNodeId, "sub-node-9");

    act(() => {
      harness.latest().setSelectedNodeId(null);
    });
    assert.equal(harness.latest().selectedNodeId, null);
  } finally {
    harness.unmount();
  }
});

// ---------------------------------------------------------------------------
// setOnClose — lazy-initializer wrapping
// ---------------------------------------------------------------------------

test("setOnClose wraps the callback so React does not invoke it as a lazy state initializer", () => {
  const harness = mountProvider();
  try {
    let closeCalls = 0;
    const onClose = () => {
      closeCalls++;
    };

    act(() => {
      harness.latest().setOnClose(onClose);
    });

    // The callback itself must not have been invoked merely by registering it
    // (which would happen if `setOnCloseState(cb)` were called directly,
    // since React treats a bare function argument to `useState`'s setter as a
    // lazy initializer).
    assert.equal(closeCalls, 0);

    const registered = harness.latest().onClose;
    assert.equal(typeof registered, "function");
    registered?.();
    assert.equal(closeCalls, 1);
  } finally {
    harness.unmount();
  }
});

test("setOnClose(null) clears a previously registered close callback", () => {
  const harness = mountProvider();
  try {
    act(() => {
      harness.latest().setOnClose(() => {});
    });
    assert.equal(typeof harness.latest().onClose, "function");

    act(() => {
      harness.latest().setOnClose(null);
    });
    assert.equal(harness.latest().onClose, null);
  } finally {
    harness.unmount();
  }
});

test("VisualPanelProvider keeps activeVisual, selectedNodeId, and onClose independently addressable", () => {
  const harness = mountProvider();
  try {
    let closeCalls = 0;
    act(() => {
      harness
        .latest()
        .setActiveVisual({ nodeKey: "node-2", visualId: "visual-2" });
      harness.latest().setSelectedNodeId("sub-node-3");
      harness.latest().setOnClose(() => {
        closeCalls++;
      });
    });

    const value = harness.latest();
    assert.deepEqual(value.activeVisual, {
      nodeKey: "node-2",
      visualId: "visual-2",
    });
    assert.equal(value.selectedNodeId, "sub-node-3");
    value.onClose?.();
    assert.equal(closeCalls, 1);

    // Clearing the active visual should not disturb the other two slots.
    act(() => {
      harness.latest().setActiveVisual(null);
    });
    const cleared = harness.latest();
    assert.equal(cleared.activeVisual, null);
    assert.equal(cleared.selectedNodeId, "sub-node-3");
    assert.equal(typeof cleared.onClose, "function");
  } finally {
    harness.unmount();
  }
});
