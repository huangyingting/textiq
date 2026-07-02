import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

import { buildSlideV7 } from "@/test/builders/deck-v7";
import { SlideEditorInspectorRegion } from "./slide-editor-vnext-regions";

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

test("SlideEditorInspectorRegion wires mobile open, backdrop, escape, and close controls", () => {
  const calls: string[] = [];
  const tree = SlideEditorInspectorRegion({
    isDesktopInspectorViewport: false,
    activeSlide: buildSlideV7(),
    inspectorSheetOpen: true,
    onOpenMobileInspector: () => calls.push("open"),
    onCloseMobileInspector: () => calls.push("close"),
    renderInspectorShell: () =>
      createElement("div", { "data-inspector-shell": "true" }, "Inspector"),
  });

  const elements = collectElements(tree);
  const openButton = elements.find(
    (element) =>
      (element.props as { "aria-label"?: string })["aria-label"] ===
      "Edit slide",
  );
  const closeButton = elements.find(
    (element) =>
      (element.props as { "aria-label"?: string })["aria-label"] ===
      "Close slide inspector",
  );
  const backdrop = elements.find(
    (element) =>
      (
        element.props as { "aria-hidden"?: string | boolean; onClick?: unknown }
      )["aria-hidden"] === "true" &&
      typeof (element.props as { onClick?: unknown }).onClick === "function",
  );
  const dialog = elements.find(
    (element) =>
      (element.props as { role?: string; "aria-label"?: string }).role ===
        "dialog" &&
      (element.props as { "aria-label"?: string })["aria-label"] ===
        "Slide inspector",
  );

  assert.ok(openButton);
  assert.ok(closeButton);
  assert.ok(backdrop);
  assert.ok(dialog);

  (openButton.props as { onClick: () => void }).onClick();
  (backdrop.props as { onClick: () => void }).onClick();
  (dialog.props as { onKeyDown: (event: unknown) => void }).onKeyDown({
    key: "Escape",
    stopPropagation: () => calls.push("stop"),
  });
  (closeButton.props as { onClick: () => void }).onClick();

  assert.deepEqual(calls, ["open", "close", "stop", "close", "close"]);
});
