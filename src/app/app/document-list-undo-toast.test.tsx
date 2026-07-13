/**
 * Direct contract coverage for `UndoToast` (#1961) — the transient "Document
 * deleted / Undo" affordance `DocumentList` mounts after an optimistic trash.
 *
 * `UndoToast` renders nothing but a `createPortal(..., document.body)` call
 * (no `ModalSurface`/framer-motion involved), so this uses the shared
 * `@/test/portal-dom` harness (`withPortalDom`/`mountWithPortalDom`) purely
 * for its portal-capable `document.body` target — matching
 * `new-document-button.test.tsx`'s use of the same module for its
 * `Dialog`-bearing `TemplatePicker`. `react-test-renderer`'s `root.find*`
 * traverses through a portal's contents as part of the same tree, so no
 * separate lookup into `document.body` is needed to assert on the portalled
 * markup.
 */
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import {
  act,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";

import { mountWithPortalDom, withPortalDom } from "@/test/portal-dom";

import { UndoToast } from "./document-list-undo-toast";

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

function textOf(instance: ReactTestInstance): string {
  return instance.children
    .map((child) => (typeof child === "string" ? child : textOf(child)))
    .join("");
}

function mount(props: {
  title: string;
  onUndo: () => void;
}): ReactTestRenderer {
  return mountWithPortalDom(<UndoToast {...props} />);
}

describe("UndoToast", () => {
  test("portals a polite status region naming the deleted document into document.body", () => {
    withPortalDom(() => {
      const renderer = mount({ title: "Roadmap", onUndo: () => {} });
      try {
        const status = renderer.root.findByProps({ role: "status" });
        assert.equal(status.props["aria-live"], "polite");
        assert.match(textOf(status), /Document deleted/);
        assert.match(textOf(status), /Roadmap/);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("clicking Undo invokes the onUndo callback exactly once", () => {
    withPortalDom(() => {
      let undoCalls = 0;
      const renderer = mount({
        title: "Q3 plan",
        onUndo: () => {
          undoCalls += 1;
        },
      });
      try {
        const undoButton = renderer.root.find(
          (el) => el.type === "button" && textOf(el) === "Undo",
        );
        act(() => {
          (undoButton.props.onClick as () => void)();
        });
        assert.equal(undoCalls, 1);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("unmounting removes the portalled toast (no lingering status region)", () => {
    withPortalDom(() => {
      const renderer = mount({ title: "Notes", onUndo: () => {} });
      assert.ok(renderer.root.findByProps({ role: "status" }));
      act(() => renderer.unmount());
      assert.throws(() => renderer.root.findByProps({ role: "status" }));
    });
  });
});
