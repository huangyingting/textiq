import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { ReactElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import {
  createPortalNodeMock,
  mountWithPortalDom,
  withPortalDom,
} from "@/test/portal-dom";
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

test("Popover keeps a portaled child menu interactive without accepting unrelated menus", () => {
  withPortalDom(() => {
    const listeners = new Map<string, EventListener>();
    document.addEventListener = ((type: string, listener: EventListener) => {
      listeners.set(type, listener);
    }) as typeof document.addEventListener;
    document.removeEventListener = (() =>
      undefined) as typeof document.removeEventListener;
    const trigger = createPortalNodeMock();
    document.getElementById = ((id: string) =>
      id === "child-trigger"
        ? trigger
        : null) as typeof document.getElementById;
    const menu = {
      getAttribute: () => "child-trigger",
      ownerDocument: document,
    };
    const target = { nodeType: 1, closest: () => menu };
    const closed: string[] = [];
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <Popover
          open
          onClose={() => closed.push("closed")}
          trigger={<button type="button">Open</button>}
          aria-label="Parent actions"
        >
          <button type="button">Child menu</button>
        </Popover>,
        {
          createNodeMock: () => ({
            ...createPortalNodeMock(),
            contains: (node: unknown) => node === trigger,
          }),
        },
      );
    });
    try {
      act(() => listeners.get("pointerdown")!({ target } as unknown as Event));
      assert.deepEqual(
        closed,
        [],
        "selecting a child menu must not dismiss its parent",
      );

      menu.getAttribute = () => "unrelated-trigger";
      act(() => listeners.get("pointerdown")!({ target } as unknown as Event));
      assert.deepEqual(closed, ["closed"]);
    } finally {
      act(() => renderer.unmount());
    }
  });
});

test("Popover leaves an Escape already handled by its child menu alone", () => {
  withPortalDom(() => {
    let keyListener: EventListener | undefined;
    document.addEventListener = ((type: string, listener: EventListener) => {
      if (type === "keydown") keyListener = listener;
    }) as typeof document.addEventListener;
    const closed: string[] = [];
    const renderer = mountWithPortalDom(
      <Popover open onClose={() => closed.push("closed")} trigger={null}>
        Child
      </Popover>,
    );
    try {
      act(() =>
        keyListener!({
          key: "Escape",
          defaultPrevented: true,
          preventDefault() {},
          stopPropagation() {},
        } as unknown as Event),
      );
      assert.deepEqual(closed, []);
    } finally {
      act(() => renderer.unmount());
    }
  });
});
