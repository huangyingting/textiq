/**
 * Direct contracts for `RightSurfaceProvider` / `useRightSurface` (#1946).
 *
 * The reducer (`rightSurfaceReducer`) and the suppression derivation
 * (`shouldSuppressFloatPopover`) are pure and already exhaustively pinned by
 * `right-surface-coordinator.test.ts`. This file instead covers the
 * React/context boundary the provider adds on top: the no-provider default
 * (guarded, harmless no-op actions), that `openSlideEditor`/`closeSlideEditor`
 * dispatch through to the real reducer and re-derive `suppressFloatPopover`
 * on every state change, and that every consumer under one provider shares
 * the same coordinator instance (a dispatch from one consumer is visible to
 * all others).
 *
 * Mounted directly with `react-test-renderer` (same pattern as
 * `locale-context.test.tsx`) rather than the shared `react-render-harness`,
 * because the harness's `run()` never commits the element tree it builds and
 * so cannot propagate context to a nested consumer.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { RightSurfaceProvider, useRightSurface } from "./right-surface-context";

const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const [message] = args;
  if (
    typeof message === "string" &&
    message.startsWith("react-test-renderer is deprecated")
  ) {
    return;
  }
  originalConsoleError(...args);
};
after(() => {
  console.error = originalConsoleError;
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Snapshot = ReturnType<typeof useRightSurface>;

function Consumer({
  onRender,
  label = "default",
}: {
  onRender: (label: string, snapshot: Snapshot) => void;
  label?: string;
}) {
  const snapshot = useRightSurface();
  onRender(label, snapshot);
  return null;
}

function renderUnguarded(): {
  latest(): Snapshot;
  unmount(): void;
} {
  let latest: Snapshot | undefined;
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <Consumer onRender={(_label, snapshot) => (latest = snapshot)} />,
    );
  });
  return {
    latest: () => {
      assert.ok(latest, "expected the consumer to have rendered");
      return latest as Snapshot;
    },
    unmount: () => act(() => renderer.unmount()),
  };
}

function renderProvided(consumerLabels: string[] = ["a"]): {
  latest(label: string): Snapshot;
  unmount(): void;
} {
  const seen = new Map<string, Snapshot>();
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <RightSurfaceProvider>
        {consumerLabels.map((label) => (
          <Consumer
            key={label}
            label={label}
            onRender={(l, snapshot) => seen.set(l, snapshot)}
          />
        ))}
      </RightSurfaceProvider>,
    );
  });
  return {
    latest: (label: string) => {
      const snapshot = seen.get(label);
      assert.ok(snapshot, `expected consumer "${label}" to have rendered`);
      return snapshot as Snapshot;
    },
    unmount: () => act(() => renderer.unmount()),
  };
}

// ---------------------------------------------------------------------------
// Guard — no provider ancestor
// ---------------------------------------------------------------------------

test("useRightSurface outside any provider falls back to the closed default", () => {
  const { latest, unmount } = renderUnguarded();
  const snapshot = latest();

  assert.deepEqual(snapshot.state, { slideEditorOpen: false });
  assert.equal(snapshot.suppressFloatPopover, false);
  unmount();
});

test("openSlideEditor/closeSlideEditor are harmless no-ops when unguarded", () => {
  const { latest, unmount } = renderUnguarded();
  assert.doesNotThrow(() => latest().openSlideEditor());
  assert.doesNotThrow(() => latest().closeSlideEditor());
  unmount();
});

// ---------------------------------------------------------------------------
// Provided — initial state and dispatch wiring
// ---------------------------------------------------------------------------

test("RightSurfaceProvider starts closed with the float popover not suppressed", () => {
  const { latest, unmount } = renderProvided();
  const snapshot = latest("a");

  assert.deepEqual(snapshot.state, { slideEditorOpen: false });
  assert.equal(snapshot.suppressFloatPopover, false);
  unmount();
});

test("openSlideEditor opens the SlideEditor and suppresses the floating popover", () => {
  const { latest, unmount } = renderProvided();

  act(() => {
    latest("a").openSlideEditor();
  });

  const snapshot = latest("a");
  assert.deepEqual(snapshot.state, { slideEditorOpen: true });
  assert.equal(snapshot.suppressFloatPopover, true);
  unmount();
});

test("closeSlideEditor restores the default (unsuppressed) state", () => {
  const { latest, unmount } = renderProvided();

  act(() => {
    latest("a").openSlideEditor();
  });
  assert.equal(latest("a").suppressFloatPopover, true);

  act(() => {
    latest("a").closeSlideEditor();
  });

  const snapshot = latest("a");
  assert.deepEqual(snapshot.state, { slideEditorOpen: false });
  assert.equal(snapshot.suppressFloatPopover, false);
  unmount();
});

test("closeSlideEditor on an already-closed coordinator is a no-op", () => {
  const { latest, unmount } = renderProvided();

  act(() => {
    latest("a").closeSlideEditor();
  });

  assert.deepEqual(latest("a").state, { slideEditorOpen: false });
  assert.equal(latest("a").suppressFloatPopover, false);
  unmount();
});

// ---------------------------------------------------------------------------
// Shared instance across consumers
// ---------------------------------------------------------------------------

test("every consumer under one provider shares the same coordinator instance", () => {
  const { latest, unmount } = renderProvided(["a", "b"]);

  assert.equal(latest("a").state.slideEditorOpen, false);
  assert.equal(latest("b").state.slideEditorOpen, false);

  act(() => {
    // Dispatch from consumer "b" — consumer "a" must observe the same update.
    latest("b").openSlideEditor();
  });

  assert.equal(latest("a").state.slideEditorOpen, true);
  assert.equal(latest("a").suppressFloatPopover, true);
  assert.equal(latest("b").state.slideEditorOpen, true);
  unmount();
});
