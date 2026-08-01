import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { ReactElement } from "react";
import { act, type ReactTestRenderer } from "react-test-renderer";

import { mountWithPortalDom, withPortalDom } from "@/test/portal-dom";
import { Popover } from "./popover";

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

type FocusTarget = {
  focusCalls: number;
  focus: () => void;
};

function setActiveElement(target: FocusTarget): void {
  Object.defineProperty(document, "activeElement", {
    configurable: true,
    writable: true,
    value: target,
  });
}

function focusTarget(becomesActive = false): FocusTarget {
  const target: FocusTarget = {
    focusCalls: 0,
    focus() {
      target.focusCalls += 1;
      if (becomesActive) setActiveElement(target);
    },
  };
  return target;
}

function renderPopover(
  open: boolean,
  initialFocusTarget: FocusTarget,
): ReactElement {
  return (
    <Popover
      open={open}
      onClose={() => undefined}
      trigger={<button type="button">Open</button>}
      initialFocusRef={{
        current: initialFocusTarget as unknown as HTMLElement,
      }}
      restoreFocusOnClose
      portal
      aria-label="Test actions"
    >
      <button type="button">Inside</button>
    </Popover>
  );
}

function rerender(
  renderer: ReactTestRenderer,
  open: boolean,
  initialFocusTarget: FocusTarget,
): void {
  act(() => renderer.update(renderPopover(open, initialFocusTarget)));
}

test("Popover captures and moves focus only once across open rerenders", () => {
  withPortalDom(() => {
    const opener = focusTarget();
    const initialFocusTarget = focusTarget(true);
    setActiveElement(opener);
    const renderer = mountWithPortalDom(
      renderPopover(true, initialFocusTarget),
    );
    try {
      assert.equal(initialFocusTarget.focusCalls, 1);

      rerender(renderer, true, initialFocusTarget);
      assert.equal(
        initialFocusTarget.focusCalls,
        1,
        "an unrelated rerender must not recapture focus or overwrite the opener",
      );

      rerender(renderer, false, initialFocusTarget);
      assert.equal(opener.focusCalls, 1);
    } finally {
      act(() => renderer.unmount());
    }
  });
});

test("Popover restores opener focus when an open instance unmounts", () => {
  withPortalDom(() => {
    const opener = focusTarget();
    const initialFocusTarget = focusTarget(true);
    setActiveElement(opener);
    const renderer = mountWithPortalDom(
      renderPopover(true, initialFocusTarget),
    );

    act(() => renderer.unmount());

    assert.equal(
      opener.focusCalls,
      1,
      "removing an interactive popover must not strand focus in detached content",
    );
  });
});
