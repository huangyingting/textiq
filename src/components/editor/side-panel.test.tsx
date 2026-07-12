/**
 * Direct contract coverage for `EditorSidePanel` and
 * `EditorSidePanelHeaderButton` (issue #1933).
 *
 * `EditorSidePanel` has no hooks — it's a plain function that either returns
 * `null` (no `document`, e.g. server rendering) or a `ReactPortal` targeting
 * `document.body`. Both branches are exercised by calling the exported
 * function directly and inspecting the return value, with a minimal
 * `document` stub installed only for the portal branch (matching the
 * `typeof document === "undefined"` guard the component itself checks).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { EditorSidePanel, EditorSidePanelHeaderButton } from "./side-panel";

type PortalLike = {
  $$typeof?: symbol;
  containerInfo: unknown;
  children: ReactElement<Record<string, unknown>>;
};

function installFakeDocumentBody(): { body: object; restore: () => void } {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  const body = { nodeType: 1 };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    writable: true,
    value: { body },
  });
  return {
    body,
    restore: () => {
      if (previous) {
        Object.defineProperty(globalThis, "document", previous);
      } else {
        delete (globalThis as { document?: unknown }).document;
      }
    },
  };
}

describe("EditorSidePanel", () => {
  test("returns null when document is undefined", () => {
    assert.equal(typeof document, "undefined");
    const result = EditorSidePanel({
      label: "Comments",
      title: "Comments",
      children: null,
    });
    assert.equal(result, null);
  });

  test("returns a portal targeting document.body with the dialog role/label/title/children composed", () => {
    const { body, restore } = installFakeDocumentBody();
    try {
      const result = EditorSidePanel({
        label: "Comments panel",
        title: "Comments",
        children: "panel body",
      }) as unknown as PortalLike;
      assert.equal(result.$$typeof, Symbol.for("react.portal"));
      assert.equal(result.containerInfo, body);
      const aside = result.children;
      assert.equal(aside.type, "aside");
      assert.equal(aside.props.role, "dialog");
      assert.equal(aside.props["aria-label"], "Comments panel");
      const html = renderToStaticMarkup(aside);
      assert.match(html, /role="dialog"/);
      assert.match(html, /Comments/);
      assert.match(html, /panel body/);
    } finally {
      restore();
    }
  });

  test("renders the actions slot in the header only when actions are provided", () => {
    const { restore } = installFakeDocumentBody();
    try {
      const withActions = EditorSidePanel({
        label: "Comments panel",
        title: "Comments",
        actions: "close-action",
        children: null,
      }) as unknown as PortalLike;
      assert.match(renderToStaticMarkup(withActions.children), /close-action/);

      const withoutActions = EditorSidePanel({
        label: "Comments panel",
        title: "Comments",
        children: null,
      }) as unknown as PortalLike;
      assert.doesNotMatch(
        renderToStaticMarkup(withoutActions.children),
        /close-action/,
      );
    } finally {
      restore();
    }
  });
});

describe("EditorSidePanelHeaderButton", () => {
  test("renders a type=button element merging the caller's className with the base styles", () => {
    const element = EditorSidePanelHeaderButton({
      className: "custom-class",
      children: "Close",
    });
    assert.equal(element.type, "button");
    assert.equal(element.props.type, "button");
    assert.match(element.props.className, /custom-class/);
    assert.match(element.props.className, /rounded-md/);
    const html = renderToStaticMarkup(element);
    assert.match(html, /custom-class/);
    assert.match(html, />Close</);
  });

  test("omits a trailing separator when no className is provided", () => {
    const element = EditorSidePanelHeaderButton({ children: "Close" });
    assert.doesNotMatch(element.props.className, /undefined/);
    assert.doesNotMatch(element.props.className.trim(), /\s$/);
  });

  test("forwards disabled and onClick wiring to the underlying button", () => {
    let clicked = 0;
    const element = EditorSidePanelHeaderButton({
      disabled: true,
      onClick: () => {
        clicked += 1;
      },
      children: "Close",
    });
    assert.equal(element.props.disabled, true);
    assert.equal(typeof element.props.onClick, "function");
    element.props.onClick();
    assert.equal(clicked, 1);
    const html = renderToStaticMarkup(element);
    assert.match(html, /disabled=""/);
  });
});
