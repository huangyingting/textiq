import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FocusTrapTestElement,
  installFocusTrapDom,
} from "@/test/focus-trap-dom";
import { installFocusTrap } from "./use-focus-trap";

function runFocusTrap(trap: HTMLElement): () => void {
  return installFocusTrap(trap, () => document.activeElement);
}

function testHTMLElement(element: FocusTrapTestElement): HTMLElement {
  return element as unknown as HTMLElement;
}

function keyboardEvent(event: unknown): KeyboardEvent {
  return event as unknown as KeyboardEvent;
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
    const cleanup = runFocusTrap(testHTMLElement(trap));

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

    trap.listener?.(
      keyboardEvent({
        key: "Escape",
        preventDefault: () => assert.fail("Escape should not be trapped"),
      }),
    );

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
    const cleanup = runFocusTrap(testHTMLElement(trap));
    assert.equal(trap.focusCount, 1);

    const event = tabEvent();
    trap.listener?.(event);
    assert.equal(event.prevented, 1);

    cleanup();
  } finally {
    restoreDom();
  }
});
