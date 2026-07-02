import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FocusTrapTestElement,
  installFocusTrapDom,
} from "@/test/focus-trap-dom";
import { withReactTestDispatcher } from "@/test/react-server-renderer";
import { useFocusTrap } from "./use-focus-trap";

function runHook(render: () => void): () => void {
  let cleanup: (() => void) | undefined;
  withReactTestDispatcher(
    {
      useRef: <T>(initial: T) => ({ current: initial }),
      useEffect: (effect?: () => void | (() => void)) => {
        const result = effect?.();
        if (typeof result === "function") cleanup = result;
      },
    },
    render,
  );
  return () => cleanup?.();
}

function tabEvent(shiftKey = false) {
  let prevented = 0;
  return {
    key: "Tab",
    shiftKey,
    preventDefault: () => {
      prevented += 1;
    },
    get prevented() {
      return prevented;
    },
  } as KeyboardEvent & { readonly prevented: number };
}

test("useFocusTrap focuses, wraps tab order, ignores hidden descendants, and restores focus", () => {
  const previous = new FocusTrapTestElement();
  const first = new FocusTrapTestElement();
  const hidden = new FocusTrapTestElement();
  const last = new FocusTrapTestElement();
  hidden.hiddenAncestor = true;
  const trap = new FocusTrapTestElement([first, hidden, last]);
  const restoreDom = installFocusTrapDom(previous);
  try {
    const cleanup = runHook(() =>
      useFocusTrap({
        current: trap as unknown as HTMLElement,
      }),
    );

    assert.equal(first.focusCount, 1);
    assert.equal(typeof trap.listener, "function");

    last.focus();
    const forward = tabEvent();
    trap.listener?.(forward);
    assert.equal(forward.prevented, 1);
    assert.equal(first.focusCount, 2);

    first.focus();
    const backward = tabEvent(true);
    trap.listener?.(backward);
    assert.equal(backward.prevented, 1);
    assert.equal(last.focusCount, 2);

    trap.listener?.({
      key: "Escape",
      preventDefault: () => assert.fail("Escape should not be trapped"),
    } as unknown as KeyboardEvent);

    cleanup();
    assert.equal(previous.focusCount, 1);
    assert.equal(trap.listener, undefined);
  } finally {
    restoreDom();
  }
});

test("useFocusTrap falls back to the container when it has no focusable descendants", () => {
  const previous = new FocusTrapTestElement();
  const trap = new FocusTrapTestElement();
  const restoreDom = installFocusTrapDom(previous);
  try {
    const cleanup = runHook(() =>
      useFocusTrap({
        current: trap as unknown as HTMLElement,
      }),
    );
    assert.equal(trap.focusCount, 1);

    const event = tabEvent();
    trap.listener?.(event);
    assert.equal(event.prevented, 1);

    cleanup();
  } finally {
    restoreDom();
  }
});
