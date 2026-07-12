import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SlideEditorOpenRecovery } from "./slide-editor-button";

function collectElements(node: ReactNode, elements: ReactElement[] = []) {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, elements);
    return elements;
  }
  if (!isValidElement(node)) return elements;
  elements.push(node);
  collectElements((node.props as { children?: ReactNode }).children, elements);
  return elements;
}

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (!isValidElement(node)) return "";
  return textContent((node.props as { children?: ReactNode }).children);
}

test("SlideEditorOpenRecovery renders diagnostics and validation details", () => {
  const html = renderToStaticMarkup(
    createElement(SlideEditorOpenRecovery, {
      error: "Deck schema mismatch",
      diagnostics: [
        {
          code: "invalid-schema-version",
          category: "validation",
          severity: "error",
          target: { scope: "deck" },
          message: "Slide 2 had invalid layout.",
        },
      ],
      validationErrors: ["slides[1].children[0].layout.frame.w is required"],
      onClose: () => undefined,
    }),
  );

  assert.match(html, /Slides could not be opened/);
  assert.match(html, /Deck schema mismatch/);
  assert.match(html, /Slide 2 had invalid layout\./);
  assert.match(html, /Validation details/);
  assert.match(
    html,
    /slides\[1\]\.children\[0\]\.layout\.frame\.w is required/,
  );
});

test("SlideEditorOpenRecovery omits validation details when none are provided", () => {
  const html = renderToStaticMarkup(
    createElement(SlideEditorOpenRecovery, {
      error: "Deck payload malformed",
      diagnostics: [],
      onClose: () => undefined,
    }),
  );

  assert.match(html, /Deck payload malformed/);
  assert.equal(html.includes("Validation details"), false);
});

test("SlideEditorOpenRecovery routes its close control to recovery exit", () => {
  let closeCalls = 0;
  const tree = SlideEditorOpenRecovery({
    error: "Deck payload malformed",
    diagnostics: [],
    onClose: () => {
      closeCalls += 1;
    },
  });
  const closeButton = collectElements(tree).find(
    (element) =>
      element.type === "button" &&
      textContent((element.props as { children?: ReactNode }).children) ===
        "Close",
  );

  assert.ok(closeButton, "Missing recovery close button");
  (closeButton.props as { onClick: () => void }).onClick();
  assert.equal(closeCalls, 1);
});
