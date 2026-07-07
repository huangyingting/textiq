import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";

import type { PresentationExportPreflightResult } from "@/lib/presentation/export-preflight";
import { ExportPreflightDialog } from "./export-preflight-dialog";
import { SlideEditor } from "./slide-editor";
import { SlideEditorTopToolbar } from "./slide-editor-top-toolbar";
import {
  buildDeck,
  buildImageNode,
  buildMinimalThemePackage,
  buildSlide,
  buildVisualNode,
} from "@/test/builders/presentation-deck";
import { createReactRenderHarness } from "@/test/react-render-harness";

type ElementLike = ReactElement<Record<string, unknown>>;

function collectElements(
  node: ReactNode,
  predicate: (element: ElementLike) => boolean,
  collected: ElementLike[] = [],
): ElementLike[] {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, predicate, collected);
    return collected;
  }
  if (!isValidElement(node)) return collected;
  const element = node as ElementLike;
  if (predicate(element)) collected.push(element);
  collectElements(element.props.children as ReactNode, predicate, collected);
  return collected;
}

function flattenText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (!isValidElement(node)) return "";
  return flattenText((node.props as { children?: ReactNode }).children);
}

function createHookRenderer() {
  return createReactRenderHarness();
}

function findRequiredElement(
  root: ReactNode,
  predicate: (element: ElementLike) => boolean,
  message: string,
): ElementLike {
  const [element] = collectElements(root, predicate);
  assert.ok(element, message);
  return element;
}

function renderTopToolbar(root: ReactNode): ReactNode {
  const toolbar = findRequiredElement(
    root,
    (element) => element.type === SlideEditorTopToolbar,
    "expected top toolbar",
  );
  return SlideEditorTopToolbar(
    toolbar.props as unknown as Parameters<typeof SlideEditorTopToolbar>[0],
  );
}

describe("SlideEditor export preflight", () => {
  test("blocks PDF download behind a fatal format preflight", () => {
    const deck = buildDeck([
      buildSlide(
        "content",
        [
          buildImageNode("missing-image", {
            id: "image-missing",
          }),
        ],
        { id: "slide-1" },
      ),
    ]);
    const renderer = createHookRenderer();
    let pdfExports = 0;

    let tree = renderer.run(() =>
      SlideEditor({
        documentId: "doc-export-preflight",
        deck,
        themePackage: buildMinimalThemePackage(),
        onDeckChange: () => undefined,
        onExportPdf: async () => {
          pdfExports += 1;
        },
      }),
    );

    const requestPdfExport = findRequiredElement(
      renderTopToolbar(tree),
      (element) =>
        element.type === "button" &&
        element.props["aria-label"] === "Export PDF",
      "expected PDF export menu item",
    ).props.onClick;
    if (typeof requestPdfExport !== "function") {
      throw new TypeError("Expected PDF export menu item to be clickable");
    }
    requestPdfExport();

    tree = renderer.run(() =>
      SlideEditor({
        documentId: "doc-export-preflight",
        deck,
        themePackage: buildMinimalThemePackage(),
        onDeckChange: () => undefined,
        onExportPdf: async () => {
          pdfExports += 1;
        },
      }),
    );

    const dialogElement = findRequiredElement(
      tree,
      (element) => element.type === ExportPreflightDialog,
      "expected PDF export preflight dialog",
    );
    const result = dialogElement.props
      .result as PresentationExportPreflightResult;
    const dialog = ExportPreflightDialog({
      result,
      onClose: () => undefined,
      onContinue: () => undefined,
    });
    const continueButton = findRequiredElement(
      dialog,
      (element) =>
        element.type === "button" &&
        flattenText(element).includes("Continue export"),
      "expected continue button",
    );

    assert.equal(pdfExports, 0);
    assert.equal(result.canExport, false);
    assert.match(result.fatalDiagnostics[0]?.message ?? "", /missing-image/);
    assert.equal(continueButton.props.disabled, true);
    assert.match(flattenText(dialog), /Fix blockers/);
  });

  test("continues PPTX export after warning preflight review", async () => {
    const deck = buildDeck([
      buildSlide(
        "content",
        [
          buildVisualNode({
            id: "visual-warning",
            content: { visualId: "visual-without-rendered-asset" },
          }),
        ],
        { id: "slide-1" },
      ),
    ]);
    const renderer = createHookRenderer();
    let pptxExports = 0;

    let tree = renderer.run(() =>
      SlideEditor({
        documentId: "doc-export-preflight-warning",
        deck,
        themePackage: buildMinimalThemePackage(),
        onDeckChange: () => undefined,
        onExportPptx: async () => {
          pptxExports += 1;
        },
      }),
    );

    const requestPptxExport = findRequiredElement(
      renderTopToolbar(tree),
      (element) =>
        element.type === "button" &&
        element.props["aria-label"] === "Export PPTX",
      "expected PPTX export menu item",
    ).props.onClick;
    if (typeof requestPptxExport !== "function") {
      throw new TypeError("Expected PPTX export menu item to be clickable");
    }
    await requestPptxExport();

    tree = renderer.run(() =>
      SlideEditor({
        documentId: "doc-export-preflight-warning",
        deck,
        themePackage: buildMinimalThemePackage(),
        onDeckChange: () => undefined,
        onExportPptx: async () => {
          pptxExports += 1;
        },
      }),
    );

    const dialogElement = findRequiredElement(
      tree,
      (element) => element.type === ExportPreflightDialog,
      "expected PPTX export preflight dialog",
    );
    const result = dialogElement.props
      .result as PresentationExportPreflightResult;

    assert.equal(result.canExport, true);
    assert.equal(result.hasWarnings, true);
    assert.equal(pptxExports, 0);

    const continueExport = dialogElement.props.onContinue;
    if (typeof continueExport !== "function") {
      throw new TypeError("Expected export preflight to be continuable");
    }
    continueExport();

    assert.equal(pptxExports, 1);
  });
});
