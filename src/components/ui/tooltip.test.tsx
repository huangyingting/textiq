import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { ReactElement } from "react";
import {
  act,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";

import { mountWithPortalDom, withPortalDom } from "@/test/portal-dom";
import { Tooltip } from "./tooltip";

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

function renderTooltip(): ReactElement {
  return (
    <Tooltip label="Helpful context" delay={25}>
      <button type="button">Target</button>
    </Tooltip>
  );
}

function trigger(renderer: ReactTestRenderer): ReactTestInstance {
  return renderer.root.find(
    (node) =>
      node.type === "span" &&
      node.props.className === "relative inline-flex" &&
      typeof node.props.onMouseEnter === "function",
  );
}

function visibleTooltips(renderer: ReactTestRenderer): ReactTestInstance[] {
  return renderer.root.findAll(
    (node) => node.type === "span" && node.props.role === "tooltip",
  );
}

function installControlledTimers() {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const pending = new Map<number, () => void>();
  const cleared = new Set<number>();
  let nextId = 1;

  globalThis.setTimeout = ((callback: () => void) => {
    const id = nextId++;
    pending.set(id, callback);
    return id;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: number) => {
    cleared.add(id);
    pending.delete(id);
  }) as unknown as typeof clearTimeout;

  return {
    pending,
    cleared,
    flush() {
      const entries = [...pending.entries()];
      pending.clear();
      for (const [, callback] of entries) callback();
    },
    restore() {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    },
  };
}

test("Tooltip stays open until both hover and focus ownership end", () => {
  withPortalDom(() => {
    const renderer = mountWithPortalDom(renderTooltip());
    const timers = installControlledTimers();
    try {
      act(() => trigger(renderer).props.onFocus());
      act(() => timers.flush());
      assert.equal(visibleTooltips(renderer).length, 1);

      act(() =>
        trigger(renderer).props.onBlur({
          relatedTarget: {},
          currentTarget: { contains: () => true },
        }),
      );
      assert.equal(
        visibleTooltips(renderer).length,
        1,
        "focus moving between descendants must not restart the tooltip lifecycle",
      );

      act(() => trigger(renderer).props.onMouseEnter());
      act(() => trigger(renderer).props.onMouseLeave());
      assert.equal(
        visibleTooltips(renderer).length,
        1,
        "pointer exit must not dismiss a tooltip still owned by keyboard focus",
      );

      act(() => trigger(renderer).props.onBlur());
      assert.equal(visibleTooltips(renderer).length, 0);
    } finally {
      act(() => renderer.unmount());
      timers.restore();
    }
  });
});

test("Tooltip stays open while hovered after focus ownership ends", () => {
  withPortalDom(() => {
    const renderer = mountWithPortalDom(renderTooltip());
    const timers = installControlledTimers();
    try {
      act(() => trigger(renderer).props.onMouseEnter());
      act(() => timers.flush());
      assert.equal(visibleTooltips(renderer).length, 1);

      act(() => trigger(renderer).props.onFocus());
      act(() => trigger(renderer).props.onBlur());
      assert.equal(
        visibleTooltips(renderer).length,
        1,
        "blur must not dismiss a tooltip while the pointer remains over its trigger",
      );

      act(() => trigger(renderer).props.onMouseLeave());
      assert.equal(visibleTooltips(renderer).length, 0);
    } finally {
      act(() => renderer.unmount());
      timers.restore();
    }
  });
});

test("Tooltip clears a delayed show when it unmounts", () => {
  withPortalDom(() => {
    const renderer = mountWithPortalDom(renderTooltip());
    const timers = installControlledTimers();
    try {
      act(() => trigger(renderer).props.onMouseEnter());
      assert.equal(timers.pending.size, 1);

      act(() => renderer.unmount());
      assert.equal(
        timers.pending.size,
        0,
        "a detached tooltip must not retain a callback that can update state later",
      );
      assert.equal(timers.cleared.size, 1);
    } finally {
      timers.restore();
    }
  });
});

test("an open Tooltip consumes Escape after dismissing itself", () => {
  withPortalDom(() => {
    const renderer = mountWithPortalDom(renderTooltip());
    const timers = installControlledTimers();
    try {
      act(() => trigger(renderer).props.onFocus());
      act(() => timers.flush());
      assert.equal(visibleTooltips(renderer).length, 1);

      let prevented = 0;
      let stopped = 0;
      act(() =>
        trigger(renderer).props.onKeyDown({
          key: "Escape",
          preventDefault: () => {
            prevented += 1;
          },
          stopPropagation: () => {
            stopped += 1;
          },
        }),
      );

      assert.equal(visibleTooltips(renderer).length, 0);
      assert.equal(
        prevented,
        1,
        "the parent overlay must be able to observe that Escape was handled",
      );
      assert.equal(stopped, 1);
    } finally {
      act(() => renderer.unmount());
      timers.restore();
    }
  });
});
