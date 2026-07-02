import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { SlidePresencePeer } from "@/lib/presentation-shared/use-slide-presence";
import type { DeckV7, SlideNode } from "@/lib/presentation-vnext/schema";
import {
  buildDeckV7,
  buildSlideV7,
  buildTextNode,
} from "@/test/builders/deck-v7";

import {
  diagnosticsSummary,
  presencePeerSummary,
  selectedSummary,
  SlideEditorFooter,
} from "./slide-editor-footer";
import {
  SlideEditorAddSlideDialog,
  SlideEditorDiagnosticsReviewDialog,
  SlideEditorInspectorRegion,
} from "./slide-editor-vnext-regions";

type ElementLike = ReactElement<Record<string, unknown>>;

function collectElements(node: ReactNode, collected: ElementLike[] = []) {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, collected);
    return collected;
  }
  if (!isValidElement(node)) return collected;
  const element = node as ElementLike;
  collected.push(element);
  const props = element.props as { children?: ReactNode; trigger?: ReactNode };
  collectElements(props.children, collected);
  collectElements(props.trigger, collected);
  return collected;
}

function firstElement(
  node: ReactNode,
  predicate: (element: ElementLike) => boolean,
): ElementLike {
  const element = collectElements(node).find(predicate);
  assert.ok(element);
  return element;
}

function invokeProp(
  element: ElementLike,
  prop: string,
  argument?: unknown,
): void {
  const handler = element.props[prop];
  assert.equal(typeof handler, "function");
  (handler as (argument?: unknown) => void)(argument);
}

function event(key: string) {
  let stopped = false;
  return {
    key,
    stopPropagation: () => {
      stopped = true;
    },
    stopped: () => stopped,
  };
}

function deckFixture(): DeckV7 {
  const slide = buildSlideV7("content", [buildTextNode({ id: "node-a" })], {
    id: "slide-a",
    name: "Revenue",
  });
  return buildDeckV7([slide], { title: "Quarterly Review" });
}

function peer(
  selectedSlideId: string | null,
  selectedNodeIds: string[] = [],
  userName = " Ada ",
): SlidePresencePeer {
  return {
    clientId: 1,
    self: false,
    documentId: "doc-1",
    userId: "user-1",
    userName,
    selectedSlideId,
    selectedNodeIds,
    editingMode: "selecting",
  };
}

function footerProps(
  overrides: Partial<Parameters<typeof SlideEditorFooter>[0]> = {},
) {
  const deck = deckFixture();
  return {
    deck,
    activeSlide: deck.slides[0],
    activeSlideIndex: 0,
    filmstripCollapsed: false,
    inspectorPanel: undefined,
    stageZoomPercent: 100,
    zoomMenuOpen: false,
    zoomMenuId: "zoom-menu",
    zoomMenuTriggerRef: { current: null },
    zoomMenuPanelRef: { current: null },
    footerStatusMenuOpen: false,
    footerStatusMenuId: "status-menu",
    footerStatusMenuTriggerRef: { current: null },
    footerStatusMenuPanelRef: { current: null },
    hasUnsavedWork: false,
    saveStatus: "saved",
    saveStatusLabel: "Saved",
    saveErrorMessage: null,
    sourceReviewCount: 0,
    sourceStatusLabel: "No source issues",
    diagnosticsCount: 0,
    activeGroupId: null,
    tableEditingNodeId: null,
    selectionMode: "normal",
    selectedCount: 0,
    remotePresencePeers: [],
    onSave: () => undefined,
    onToggleFilmstripCollapsed: () => undefined,
    onNotesClick: () => undefined,
    onSetStageZoomPercent: () => undefined,
    onSetFooterZoom: () => undefined,
    onSetZoomMenuOpen: () => undefined,
    onSetFooterStatusMenuOpen: () => undefined,
    onCloseZoomMenuAndRestoreFocus: () => undefined,
    onCloseFooterStatusMenuAndRestoreFocus: () => undefined,
    onZoomMenuKeyDown: () => undefined,
    onFooterStatusMenuKeyDown: () => undefined,
    onReviewSourceLinks: () => undefined,
    onOpenDiagnosticsReview: () => undefined,
    ...overrides,
  } satisfies Parameters<typeof SlideEditorFooter>[0];
}

describe("SlideEditorFooter", () => {
  test("summarizes selection, diagnostics, and collaborators", () => {
    const deck = deckFixture();
    assert.equal(selectedSummary(0), "No selection");
    assert.equal(selectedSummary(1), "1 node selected");
    assert.equal(selectedSummary(3), "3 nodes selected");
    assert.equal(diagnosticsSummary(0), "No diagnostics");
    assert.equal(diagnosticsSummary(1), "1 diagnostic");
    assert.equal(diagnosticsSummary(2), "2 diagnostics");
    assert.equal(
      presencePeerSummary(peer(null), deck, "slide-a"),
      "Ada: in deck",
    );
    assert.equal(
      presencePeerSummary(peer("slide-a", ["node-a"]), deck, "slide-a"),
      "Ada: selecting 1 node",
    );
    assert.equal(
      presencePeerSummary(peer("slide-a", ["a", "b"]), deck, "slide-a"),
      "Ada: selecting 2 nodes",
    );
    assert.equal(
      presencePeerSummary(peer("slide-a"), deck, "slide-a"),
      "Ada: viewing this slide",
    );
    assert.equal(
      presencePeerSummary(peer("missing"), deck, "slide-a"),
      "Ada: in deck",
    );
  });

  test("renders rich status branches and wires footer callbacks", () => {
    const calls: string[] = [];
    const tree = SlideEditorFooter(
      footerProps({
        filmstripCollapsed: true,
        inspectorPanel: "notes",
        zoomMenuOpen: true,
        footerStatusMenuOpen: true,
        hasUnsavedWork: true,
        saveStatus: "error",
        saveStatusLabel: "Save failed",
        saveErrorMessage: "Network offline",
        sourceReviewCount: 2,
        sourceStatusLabel: "2 source issues",
        diagnosticsCount: 1,
        activeGroupId: "group-a",
        tableEditingNodeId: "table-a",
        selectionMode: "layers",
        selectedCount: 2,
        remotePresencePeers: [peer("slide-a", ["node-a"])],
        onSave: () => calls.push("save"),
        onSetFooterZoom: (percent) => calls.push(`zoom:${percent}`),
        onCloseZoomMenuAndRestoreFocus: () => calls.push("close-zoom"),
        onOpenDiagnosticsReview: () => calls.push("diagnostics"),
        onCloseFooterStatusMenuAndRestoreFocus: () =>
          calls.push("close-status"),
      }),
    );
    const html = renderToStaticMarkup(tree);
    assert.match(html, /Quarterly Review/);
    assert.match(html, /2 source/);
    assert.match(html, /Save failed/);
    assert.match(html, /Network offline/);
    assert.match(html, /1 diagnostic/);
    assert.match(html, /Group edit/);
    assert.match(html, /Table edit/);
    assert.match(html, /Layers mode/);
    assert.match(html, /2 nodes selected/);
    assert.match(html, /1 present/);

    invokeProp(
      firstElement(
        tree,
        (element) =>
          element.type === "button" && element.props.children === "Fit",
      ),
      "onClick",
    );
    invokeProp(
      firstElement(
        tree,
        (element) =>
          element.type === "button" &&
          element.props["aria-label"] ===
            "Open deck diagnostics review (1 diagnostic)",
      ),
      "onClick",
    );
    invokeProp(
      firstElement(
        tree,
        (element) =>
          element.type === "button" &&
          element.props["aria-label"] === "Save failed",
      ),
      "onClick",
    );
    assert.deepEqual(calls, [
      "zoom:100",
      "close-zoom",
      "diagnostics",
      "close-status",
      "save",
      "close-status",
    ]);
  });

  test("renders minimal saved footer and singular source status", () => {
    const plainDeck = { ...deckFixture(), title: "Slides" };
    const html = renderToStaticMarkup(
      SlideEditorFooter(
        footerProps({
          deck: plainDeck,
          activeSlide: undefined,
          activeSlideIndex: 3,
          filmstripCollapsed: false,
          saveStatus: "saved",
          hasUnsavedWork: false,
          sourceReviewCount: 1,
          diagnosticsCount: 0,
          remotePresencePeers: [],
          onSave: undefined,
        }),
      ),
    );
    assert.match(html, /Hide slide thumbnails/);
    assert.match(html, /1 source/);
    assert.doesNotMatch(html, /role="status"/);
  });
});

describe("SlideEditorVNext regions", () => {
  test("renders desktop, closed mobile, and open mobile inspector states", () => {
    const shell = () => <div>Inspector shell</div>;
    assert.match(
      renderToStaticMarkup(
        <SlideEditorInspectorRegion
          isDesktopInspectorViewport
          activeSlide={deckFixture().slides[0]}
          inspectorSheetOpen={false}
          onOpenMobileInspector={() => undefined}
          onCloseMobileInspector={() => undefined}
          renderInspectorShell={shell}
        />,
      ),
      /Inspector shell/,
    );
    assert.ok(
      collectElements(
        SlideEditorInspectorRegion({
          isDesktopInspectorViewport: true,
          activeSlide: deckFixture().slides[0],
          inspectorSheetOpen: false,
          onOpenMobileInspector: () => undefined,
          onCloseMobileInspector: () => undefined,
          renderInspectorShell: shell,
        }),
      ).some((element) => element.props.children),
    );
    assert.equal(
      renderToStaticMarkup(
        <SlideEditorInspectorRegion
          isDesktopInspectorViewport={false}
          activeSlide={undefined}
          inspectorSheetOpen={false}
          onOpenMobileInspector={() => undefined}
          onCloseMobileInspector={() => undefined}
          renderInspectorShell={shell}
        />,
      ),
      "",
    );

    let closeCalls = 0;
    let openCalls = 0;
    const tree = SlideEditorInspectorRegion({
      isDesktopInspectorViewport: false,
      activeSlide: deckFixture().slides[0] as SlideNode,
      inspectorSheetOpen: true,
      onOpenMobileInspector: () => {
        openCalls += 1;
      },
      onCloseMobileInspector: () => {
        closeCalls += 1;
      },
      renderInspectorShell: shell,
    });
    invokeProp(
      firstElement(
        tree,
        (element) => element.props["aria-label"] === "Edit slide",
      ),
      "onClick",
    );
    invokeProp(
      firstElement(
        tree,
        (element) =>
          element.props["data-floating-panel"] === "true" &&
          element.props["aria-hidden"] === "true",
      ),
      "onClick",
    );
    const escape = event("Escape");
    invokeProp(
      firstElement(tree, (element) => element.props.role === "dialog"),
      "onKeyDown",
      escape,
    );
    invokeProp(
      firstElement(
        tree,
        (element) => element.props["aria-label"] === "Close slide inspector",
      ),
      "onClick",
    );
    assert.equal(openCalls, 1);
    assert.equal(closeCalls, 3);
    assert.equal(escape.stopped(), true);
  });

  test("wires add-slide and diagnostics dialogs through public callbacks", () => {
    let closeCalls = 0;
    const addDialog = SlideEditorAddSlideDialog({
      templates: [],
      onChoose: () => undefined,
      onClose: () => {
        closeCalls += 1;
      },
      onAuthorBrandKit: () => undefined,
    });
    invokeProp(
      firstElement(
        addDialog,
        (element) => element.props["aria-hidden"] === "true",
      ),
      "onClick",
    );
    const ignored = event("Enter");
    invokeProp(
      firstElement(addDialog, (element) => element.props.role === "dialog"),
      "onKeyDown",
      ignored,
    );
    const escape = event("Escape");
    invokeProp(
      firstElement(addDialog, (element) => element.props.role === "dialog"),
      "onKeyDown",
      escape,
    );
    assert.equal(closeCalls, 2);
    assert.equal(ignored.stopped(), false);
    assert.equal(escape.stopped(), true);

    const diagnostics = SlideEditorDiagnosticsReviewDialog({
      diagnostics: [],
      onClose: () => undefined,
      onNavigate: () => undefined,
      onAction: () => undefined,
    });
    assert.ok(
      collectElements(diagnostics).some(
        (element) =>
          typeof element.type === "function" &&
          element.type.name === "DeckDiagnosticsReview",
      ),
    );
  });
});
