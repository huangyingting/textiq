import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { ReactElement } from "react";
import { act, type ReactTestRenderer } from "react-test-renderer";

import { mountWithPortalDom, withPortalDom } from "@/test/portal-dom";
import { FloatingSurface } from "./floating-surface";
import { ModalSurface, OverlayProvider } from "./overlay-stack";
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

function installDocumentListeners() {
  const listeners = new Map<string, Set<EventListener>>();
  document.addEventListener = ((type: string, listener: EventListener) => {
    const registered = listeners.get(type) ?? new Set<EventListener>();
    registered.add(listener);
    listeners.set(type, registered);
  }) as typeof document.addEventListener;
  document.removeEventListener = ((type: string, listener: EventListener) => {
    listeners.get(type)?.delete(listener);
  }) as typeof document.removeEventListener;

  return {
    dispatchEscape() {
      const event = {
        key: "Escape",
        defaultPrevented: false,
        preventDefault() {
          event.defaultPrevented = true;
        },
        stopPropagation() {},
      };
      for (const listener of [...(listeners.get("keydown") ?? [])]) {
        listener(event as unknown as Event);
      }
      return event;
    },
  };
}

test("Escape closes only the nested Popover above a modal", () => {
  withPortalDom(() => {
    const documentEvents = installDocumentListeners();
    const closed: string[] = [];
    const renderer = mountWithPortalDom(
      <OverlayProvider>
        <ModalSurface
          open
          onClose={() => closed.push("modal")}
          aria-label="Parent dialog"
        >
          <Popover
            open
            onClose={() => closed.push("popover")}
            trigger={<button type="button">Actions</button>}
            portal
            aria-label="Nested actions"
          >
            <button type="button">Nested action</button>
          </Popover>
        </ModalSurface>
      </OverlayProvider>,
    );
    try {
      act(() => {
        documentEvents.dispatchEscape();
      });
      assert.deepEqual(
        closed,
        ["popover"],
        "one Escape press must unwind only the top transient surface",
      );
    } finally {
      act(() => renderer.unmount());
    }
  });
});

test("Escape closes only the nested FloatingSurface above a modal", () => {
  withPortalDom(() => {
    const documentEvents = installDocumentListeners();
    const closed: string[] = [];
    const renderer = mountWithPortalDom(
      <OverlayProvider>
        <ModalSurface
          open
          onClose={() => closed.push("modal")}
          aria-label="Parent dialog"
        >
          <FloatingSurface
            open
            onClose={() => closed.push("floating")}
            position={{ top: 40, left: 40 }}
            aria-label="Nested floating actions"
          >
            <button type="button">Nested action</button>
          </FloatingSurface>
        </ModalSurface>
      </OverlayProvider>,
    );
    try {
      act(() => {
        documentEvents.dispatchEscape();
      });
      assert.deepEqual(
        closed,
        ["floating"],
        "one Escape press must not close the parent beneath a floating surface",
      );
    } finally {
      act(() => renderer.unmount());
    }
  });
});

function renderModalStack(
  secondOpen: boolean,
  onFirstClose: () => void,
  onSecondClose: () => void,
): ReactElement {
  return (
    <OverlayProvider>
      <ModalSurface open onClose={onFirstClose} aria-label="First dialog">
        First
      </ModalSurface>
      <ModalSurface
        open={secondOpen}
        onClose={onSecondClose}
        aria-label="Second dialog"
      >
        Second
      </ModalSurface>
    </OverlayProvider>
  );
}

test("the real overlay stack closes one modal at a time and owns body lock", () => {
  withPortalDom(() => {
    const documentEvents = installDocumentListeners();
    const closed: string[] = [];
    document.body.style.overflow = "clip";
    const render = (secondOpen: boolean) =>
      renderModalStack(
        secondOpen,
        () => closed.push("first"),
        () => closed.push("second"),
      );
    const renderer = mountWithPortalDom(render(true));
    try {
      assert.equal(document.body.style.overflow, "hidden");

      act(() => {
        documentEvents.dispatchEscape();
      });
      assert.deepEqual(closed, ["second"]);

      act(() => renderer.update(render(false)));
      assert.equal(document.body.style.overflow, "hidden");
      act(() => {
        documentEvents.dispatchEscape();
      });
      assert.deepEqual(closed, ["second", "first"]);

      act(() => renderer.update(<OverlayProvider>{null}</OverlayProvider>));
      assert.equal(document.body.style.overflow, "clip");
    } finally {
      act(() => renderer.unmount());
    }
  });
});

type FocusTarget = HTMLElement & { focusCalls: number };

function focusTarget(): FocusTarget {
  const target = {
    focusCalls: 0,
    focus() {
      target.focusCalls += 1;
    },
  };
  return target as unknown as FocusTarget;
}

function renderModal(open: boolean, restoreTarget: FocusTarget): ReactElement {
  return (
    <OverlayProvider>
      <ModalSurface
        open={open}
        onClose={() => undefined}
        restoreFocusRef={{ current: restoreTarget }}
        aria-label="Focus test dialog"
      >
        <button type="button">Inside</button>
      </ModalSurface>
    </OverlayProvider>
  );
}

function rerenderModal(
  renderer: ReactTestRenderer,
  open: boolean,
  restoreTarget: FocusTarget,
): void {
  act(() => renderer.update(renderModal(open, restoreTarget)));
}

test("an open modal rerender does not restore focus before the modal closes", () => {
  withPortalDom(() => {
    const restoreTarget = focusTarget();
    const renderer = mountWithPortalDom(renderModal(true, restoreTarget));
    try {
      rerenderModal(renderer, true, restoreTarget);
      assert.equal(
        restoreTarget.focusCalls,
        0,
        "changing a ref-object identity must not run close cleanup while still open",
      );

      rerenderModal(renderer, false, restoreTarget);
      assert.equal(restoreTarget.focusCalls, 1);
    } finally {
      act(() => renderer.unmount());
    }
  });
});

test("an open modal restores focus when its instance unmounts", () => {
  withPortalDom(() => {
    const restoreTarget = focusTarget();
    const renderer = mountWithPortalDom(renderModal(true, restoreTarget));

    act(() => renderer.unmount());

    assert.equal(restoreTarget.focusCalls, 1);
  });
});
