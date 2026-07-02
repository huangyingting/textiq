import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SlideEditorInspectorRegion } from "./slide-editor-regions";
import { buildSlide } from "@/test/builders/presentation-deck";

type InspectorRegionProps = Parameters<typeof SlideEditorInspectorRegion>[0];

const noop = () => undefined;

function renderInspectorRegion(
  overrides: Partial<InspectorRegionProps> = {},
): string {
  const props: InspectorRegionProps = {
    isDesktopInspectorViewport: true,
    activeSlide: buildSlide(),
    inspectorSheetOpen: false,
    onOpenMobileInspector: noop,
    onCloseMobileInspector: noop,
    renderInspectorShell: () =>
      createElement("div", { "data-inspector-shell": "true" }, "Inspector"),
    ...overrides,
  };

  return renderToStaticMarkup(createElement(SlideEditorInspectorRegion, props));
}

function shellMountCount(html: string): number {
  return (html.match(/data-inspector-shell="true"/g) ?? []).length;
}

describe("SlideEditorInspectorRegion responsive mounting", () => {
  test("renders only one inspector shell on mobile when the sheet is open", () => {
    const html = renderInspectorRegion({
      isDesktopInspectorViewport: false,
      inspectorSheetOpen: true,
    });

    assert.equal(shellMountCount(html), 1);
    assert.match(html, /aria-label="Slide inspector"/);
  });

  test("renders only the desktop inspector shell in desktop viewport mode", () => {
    const html = renderInspectorRegion({
      isDesktopInspectorViewport: true,
      inspectorSheetOpen: true,
    });

    assert.equal(shellMountCount(html), 1);
    assert.doesNotMatch(html, /aria-label="Slide inspector"/);
  });
});
