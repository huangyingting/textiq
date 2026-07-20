import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  DeckDiagnosticsReview,
  diagnosticReviewActionAriaLabel,
} from "./deck-diagnostics-review";
import { makeDiagnostic } from "@/lib/presentation/diagnostics";
import type { PresentationDiagnostic } from "@/lib/presentation/diagnostics";

interface TestElement {
  type: unknown;
  props: Record<string, unknown>;
}

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (node == null || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (!isValidElement(node)) return "";
  return textContent((node.props as { children?: ReactNode }).children);
}

function findElement(
  node: ReactNode,
  predicate: (element: TestElement) => boolean,
): TestElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findElement(child, predicate);
      if (match) return match;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const element: TestElement = {
    type: node.type,
    props: node.props as Record<string, unknown>,
  };
  if (predicate(element)) return element;
  return findElement(element.props.children as ReactNode, predicate);
}

function findButtonClickHandler(
  node: ReactNode,
  label: string,
): (() => void) | null {
  const button = findElement(
    node,
    (element) =>
      element.type === "button" &&
      textContent(element.props.children as ReactNode).trim() === label,
  );
  if (!button || typeof button.props.onClick !== "function") return null;
  return button.props.onClick as () => void;
}

describe("DeckDiagnosticsReview", () => {
  test("renders grouped deck diagnostics with navigation and actions", () => {
    const diagnostics: PresentationDiagnostic[] = [
      makeDiagnostic("missing-asset", "error", "Image asset missing", {
        slideId: "slide-1",
        nodeId: "image-1",
        details: { assetId: "hero" },
        action: { type: "open-asset-panel" },
      }),
      makeDiagnostic("duplicate-id", "info", "Duplicate id in deck"),
    ];

    const html = renderToStaticMarkup(
      createElement(DeckDiagnosticsReview, {
        diagnostics,
        onClose: () => undefined,
        onNavigate: () => undefined,
        onAction: () => undefined,
      }),
    );

    assert.match(html, /Diagnostics review/);
    assert.match(html, /Asset hero/);
    assert.match(html, /Deck/);
    assert.match(html, /Go to target/);
    assert.match(html, /Open asset panel/);
    assert.ok(
      html.includes(
        `aria-label="${diagnosticReviewActionAriaLabel("Go to target", diagnostics[0])}"`,
      ),
    );
    assert.ok(
      html.includes(
        `aria-label="${diagnosticReviewActionAriaLabel("Open asset panel", diagnostics[0])}"`,
      ),
    );
  });

  test("hides navigation and action buttons when handlers are omitted", () => {
    const diagnostics: PresentationDiagnostic[] = [
      makeDiagnostic("missing-asset", "error", "Image asset missing", {
        slideId: "slide-1",
        nodeId: "image-1",
        details: { assetId: "hero" },
        action: { type: "open-asset-panel" },
      }),
    ];

    const html = renderToStaticMarkup(
      createElement(DeckDiagnosticsReview, {
        diagnostics,
        onClose: () => undefined,
      }),
    );

    assert.match(html, /Diagnostics review/);
    assert.doesNotMatch(html, /Go to target/);
    assert.doesNotMatch(html, /Open asset panel/);
  });

  test("renders validation, source, asset, theme, render, and export diagnostics in one surface", () => {
    const diagnostics: PresentationDiagnostic[] = [
      makeDiagnostic("duplicate-id", "info", "Duplicate id in deck"),
      makeDiagnostic("stale-source", "warning", "Source is stale", {
        slideId: "slide-1",
        nodeId: "text-1",
        details: { documentId: "doc-1", blockId: "block-1" },
        action: { type: "refresh-source" },
      }),
      makeDiagnostic("missing-asset", "error", "Image asset missing", {
        slideId: "slide-1",
        nodeId: "image-1",
        details: { assetId: "hero" },
      }),
      makeDiagnostic("missing-token", "warning", "Theme token missing", {
        path: "tokens.color.accent",
      }),
      makeDiagnostic("missing-node-layout", "error", "Node has no layout", {
        slideId: "slide-2",
        nodeId: "shape-1",
      }),
      makeDiagnostic(
        "unsupported-export-feature",
        "warning",
        "Export fallback",
        {
          nodeId: "shape-2",
          action: { type: "replace-style-ref" },
        },
      ),
    ];

    const html = renderToStaticMarkup(
      createElement(DeckDiagnosticsReview, {
        diagnostics,
        onClose: () => undefined,
        onNavigate: () => undefined,
        onAction: () => undefined,
      }),
    );

    for (const category of [
      "validation",
      "source",
      "asset",
      "theme",
      "render",
      "export",
    ]) {
      assert.match(html, new RegExp(`· ${category} ·`));
    }
    assert.match(html, /Source block block-1/);
    assert.match(html, /Refresh source/);
  });

  test("routes close, navigation, and action handlers", () => {
    const diagnostics: PresentationDiagnostic[] = [
      makeDiagnostic("missing-asset", "error", "Image asset missing", {
        slideId: "slide-1",
        nodeId: "image-1",
        details: { assetId: "hero" },
        action: { type: "open-asset-panel" },
      }),
    ];
    const calls: string[] = [];
    const element = DeckDiagnosticsReview({
      diagnostics,
      onClose: () => calls.push("close"),
      onNavigate: () => calls.push("navigate"),
      onAction: () => calls.push("action"),
    });
    const close = findButtonClickHandler(element, "Close");
    const navigate = findButtonClickHandler(element, "Go to target");
    const action = findButtonClickHandler(element, "Open asset panel");

    assert.ok(close);
    assert.ok(navigate);
    assert.ok(action);
    close();
    navigate();
    action();

    assert.deepEqual(calls, ["close", "navigate", "action"]);
  });

  test("dismisses from backdrop and Escape without closing on dialog clicks", () => {
    const calls: string[] = [];
    const element = DeckDiagnosticsReview({
      diagnostics: [
        makeDiagnostic("duplicate-id", "info", "Duplicate id in deck"),
      ],
      onClose: () => calls.push("close"),
      onNavigate: () => undefined,
      onAction: () => undefined,
    });

    const rootProps = element.props as {
      onClick?: (event: { target: unknown; currentTarget: unknown }) => void;
      children?: ReactNode;
    };
    const dialog = findElement(
      rootProps.children,
      (candidate) => candidate.props["data-deck-diagnostics-review"] === "true",
    );
    const onKeyDown =
      dialog && typeof dialog.props.onKeyDown === "function"
        ? (dialog.props.onKeyDown as (event: {
            key: string;
            stopPropagation: () => void;
          }) => void)
        : null;

    assert.equal(typeof rootProps.onClick, "function");
    assert.ok(onKeyDown);

    const backdrop = {};
    rootProps.onClick!({ target: backdrop, currentTarget: backdrop });
    rootProps.onClick!({ target: {}, currentTarget: backdrop });
    onKeyDown!({
      key: "Escape",
      stopPropagation: () => calls.push("stopped"),
    });
    onKeyDown!({
      key: "Enter",
      stopPropagation: () => calls.push("ignored"),
    });

    assert.deepEqual(calls, ["close", "stopped", "close"]);
  });
});
