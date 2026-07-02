// e2e-governance-allow oversized-test: failure coverage is consolidated here until the inline editor harness is split.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as React from "react";
import type { MouseEvent, ReactNode } from "react";

import type { GroupNode } from "@/lib/presentation/schema";
import {
  buildDeck,
  buildImageNode,
  buildShapeNode,
  buildSlide,
  buildTableNode,
  buildTextNode,
} from "@/test/builders/presentation-deck";
import { InlineTextEditorPresentation } from "./inline-text-editor";
import { SlideCanvas } from "./slide-canvas";
import { SlideEditor } from "./slide-editor";
import {
  clickNode,
  createHookRenderer,
  findRequiredElement,
  focusNode,
  withMockHTMLElement,
  withPointerWindow,
} from "./slide-editor-failure-test-utils";

const preventableMouseEvent = (event: Partial<MouseEvent> = {}) =>
  ({
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
    ...event,
  }) as MouseEvent;

function stageCanvasFromRoot(root: ReactNode) {
  return findRequiredElement(
    root,
    (element) => element.type === SlideCanvas,
    "Expected stage canvas to render.",
  );
}

function selectedNodeIdsFrom(root: ReactNode): string[] {
  const selection = (
    stageCanvasFromRoot(root).props as {
      selection?: { nodeIds?: ReadonlySet<string> };
    }
  ).selection;
  return [...(selection?.nodeIds ?? new Set<string>())];
}

function hiddenNodeIdsFrom(root: ReactNode): ReadonlySet<string> | undefined {
  return (
    stageCanvasFromRoot(root).props as {
      hiddenNodeIds?: ReadonlySet<string>;
    }
  ).hiddenNodeIds;
}

function nodeDoubleClickFrom(root: ReactNode) {
  const onNodeDoubleClick = (
    stageCanvasFromRoot(root).props as {
      onNodeDoubleClick?: (nodeId: string, event: MouseEvent) => void;
    }
  ).onNodeDoubleClick;
  assert.ok(onNodeDoubleClick);
  return onNodeDoubleClick;
}

function activeGroupIdFrom(root: ReactNode): string | null | undefined {
  return (stageCanvasFromRoot(root).props as { activeGroupId?: string | null })
    .activeGroupId;
}

function buildGroupNode(
  id: string,
  children = [buildTextNode({ id: `${id}-child` })],
  locked = false,
): GroupNode {
  return {
    id,
    type: "group",
    component: "custom",
    locked,
    layout: { frame: { x: 45, y: 10, w: 35, h: 30 }, zIndex: 2 },
    children,
  };
}

function mountStageFrame(
  root: ReactNode,
  createElement: (args?: {
    closestMap?: Record<string, unknown>;
    queryMap?: Record<string, unknown>;
    rect?: { left: number; top: number; width: number; height: number };
  }) => HTMLElement,
) {
  const slideCanvasElement = createElement({
    rect: { left: 0, top: 0, width: 1000, height: 1000 },
  });
  const frameElement = createElement({
    rect: { left: 0, top: 0, width: 1000, height: 1000 },
    queryMap: {
      '[data-slide-canvas="true"]': slideCanvasElement,
    },
  });
  const frame = findRequiredElement(
    root,
    (element) =>
      element.type === "div" &&
      (element.props as { "data-slide-stage-frame"?: string })[
        "data-slide-stage-frame"
      ] === "true" &&
      typeof (element.props as { ref?: unknown }).ref === "function",
    "Expected mounted stage frame ref.",
  );
  (frame.props as { ref: (element: HTMLDivElement | null) => void }).ref(
    frameElement as HTMLDivElement,
  );
}

describe("SlideEditor inline text editor failures", () => {
  test("inline edit keeps stage hover preselection for other nodes", () => {
    withMockHTMLElement((createElement) => {
      const hookRenderer = createHookRenderer();
      const currentDeck = buildDeck([
        buildSlide(
          "content",
          [
            buildTextNode({
              id: "editing-node",
              layout: { frame: { x: 10, y: 10, w: 20, h: 10 }, zIndex: 1 },
            }),
            buildTextNode({
              id: "hover-other",
              layout: { frame: { x: 50, y: 10, w: 20, h: 10 }, zIndex: 2 },
            }),
          ],
          { id: "slide-inline-hover", name: "Slide 1" },
        ),
      ]);
      const renderTree = () =>
        hookRenderer.run(() =>
          SlideEditor({
            documentId: "doc-inline-hover",
            deck: currentDeck,
            onDeckChange: () => undefined,
          }),
        );
      const stageCanvasFrom = (root: ReactNode) =>
        findRequiredElement(
          root,
          (element) => element.type === SlideCanvas,
          "Expected stage canvas to render.",
        );

      let tree = renderTree();
      focusNode(tree, "editing-node");
      tree = renderTree();
      clickNode(tree, new Map(), createElement, "editing-node", {
        clientX: 120,
        clientY: 120,
      });

      tree = renderTree();
      const stageShell = findRequiredElement(
        tree,
        (element) =>
          element.type === "div" &&
          (element.props as { "data-slide-stage-shell"?: string })[
            "data-slide-stage-shell"
          ] === "true" &&
          typeof (element.props as { onPointerMove?: unknown })
            .onPointerMove === "function",
        "Expected stage shell with pointermove handler.",
      );
      const onPointerMove = (
        stageShell.props as {
          onPointerMove?: (event: React.PointerEvent<HTMLDivElement>) => void;
        }
      ).onPointerMove;
      assert.ok(onPointerMove);
      const canvasElement = createElement({
        rect: { left: 0, top: 0, width: 1000, height: 1000 },
      });
      const target = createElement({
        closestMap: {
          '[data-slide-canvas="true"]': canvasElement,
        },
      });

      onPointerMove({
        clientX: 550,
        clientY: 150,
        target,
      } as unknown as React.PointerEvent<HTMLDivElement>);

      tree = renderTree();
      const stageCanvas = stageCanvasFrom(tree);
      assert.equal(
        (stageCanvas.props as { hoveredNodeId?: string | null }).hoveredNodeId,
        "hover-other",
      );
    });
  });

  test("dragging an already-selected text node does not enter inline edit", () => {
    withMockHTMLElement((createElement) =>
      withPointerWindow((listeners) => {
        const hookRenderer = createHookRenderer();
        const currentDeck = buildDeck([
          buildSlide(
            "content",
            [
              buildTextNode({
                id: "drag-selected-text",
                layout: { frame: { x: 20, y: 20, w: 30, h: 12 }, zIndex: 1 },
              }),
            ],
            { id: "slide-drag-selected-text", name: "Slide 1" },
          ),
        ]);

        const renderTree = () =>
          hookRenderer.run(() =>
            SlideEditor({
              documentId: "doc-drag-selected-text",
              deck: currentDeck,
              onDeckChange: () => undefined,
            }),
          );
        const stageCanvasFrom = (root: ReactNode) =>
          findRequiredElement(
            root,
            (element) => element.type === SlideCanvas,
            "Expected stage canvas to render.",
          );

        let tree = renderTree();
        focusNode(tree, "drag-selected-text");

        tree = renderTree();
        const selectedStageCanvas = stageCanvasFrom(tree);
        const selectedNodePointerDown = (
          selectedStageCanvas.props as {
            onNodePointerDown?: (
              nodeId: string,
              event: React.PointerEvent,
            ) => void;
          }
        ).onNodePointerDown;
        assert.ok(selectedNodePointerDown);
        const canvasElement = createElement({
          rect: { left: 0, top: 0, width: 1000, height: 1000 },
        });
        const currentTarget = createElement({
          closestMap: {
            '[data-slide-canvas="true"]': canvasElement,
          },
        });
        selectedNodePointerDown("drag-selected-text", {
          button: 0,
          pointerId: 1,
          clientX: 200,
          clientY: 200,
          shiftKey: false,
          metaKey: false,
          ctrlKey: false,
          altKey: false,
          target: currentTarget,
          currentTarget,
          preventDefault: () => undefined,
          stopPropagation: () => undefined,
        } as unknown as React.PointerEvent);
        listeners.get("pointermove")?.({
          clientX: 250,
          clientY: 220,
          altKey: true,
        } as PointerEvent);
        listeners.get("pointerup")?.({
          clientX: 250,
          clientY: 220,
        } as PointerEvent);
        tree = renderTree();
        const updatedStageCanvas = stageCanvasFrom(tree);
        const hiddenNodeIds = (
          updatedStageCanvas.props as { hiddenNodeIds?: ReadonlySet<string> }
        ).hiddenNodeIds;
        assert.notEqual(hiddenNodeIds?.has("drag-selected-text"), true);
      }),
    );
  });

  test("double-clicking text does not bypass the click-to-edit selection system", () => {
    const hookRenderer = createHookRenderer();
    const currentDeck = buildDeck([
      buildSlide(
        "content",
        [
          buildTextNode({
            id: "selected-under-edit",
            layout: { frame: { x: 20, y: 20, w: 30, h: 12 }, zIndex: 1 },
          }),
          buildTextNode({
            id: "preselected-over-edit",
            layout: { frame: { x: 20, y: 20, w: 30, h: 12 }, zIndex: 2 },
          }),
        ],
        { id: "slide-overlap-double-click", name: "Slide 1" },
      ),
    ]);

    const renderTree = () =>
      hookRenderer.run(() =>
        SlideEditor({
          documentId: "doc-overlap-double-click",
          deck: currentDeck,
          onDeckChange: () => undefined,
        }),
      );

    let tree = renderTree();
    focusNode(tree, "selected-under-edit");

    tree = renderTree();
    const stageCanvas = findRequiredElement(
      tree,
      (element) => element.type === SlideCanvas,
      "Expected stage canvas.",
    );
    const onNodeDoubleClick = (
      stageCanvas.props as {
        onNodeDoubleClick?: (nodeId: string, event: MouseEvent) => void;
      }
    ).onNodeDoubleClick;
    assert.ok(onNodeDoubleClick);
    const target = {
      closest: (selector: string) =>
        selector === '[data-slide-canvas="true"]'
          ? {
              getBoundingClientRect: () => ({
                left: 0,
                top: 0,
                width: 1000,
                height: 1000,
              }),
            }
          : null,
    };
    onNodeDoubleClick(
      "preselected-over-edit",
      preventableMouseEvent({
        clientX: 250,
        clientY: 250,
        target: target as unknown as EventTarget,
      }),
    );

    tree = renderTree();
    const updatedStageCanvas = findRequiredElement(
      tree,
      (element) => element.type === SlideCanvas,
      "Expected updated stage canvas.",
    );
    const hiddenNodeIds = (
      updatedStageCanvas.props as { hiddenNodeIds?: ReadonlySet<string> }
    ).hiddenNodeIds;
    assert.notEqual(hiddenNodeIds?.has("selected-under-edit"), true);
    assert.ok(hiddenNodeIds?.has("preselected-over-edit"));
  });

  test("pressing another node exits the first node's inline edit", () => {
    withMockHTMLElement((createElement) =>
      withPointerWindow((listeners) => {
        const hookRenderer = createHookRenderer();
        const currentDeck = buildDeck([
          buildSlide(
            "content",
            [
              buildTextNode({
                id: "edit-first",
                layout: { frame: { x: 10, y: 10, w: 25, h: 12 }, zIndex: 1 },
              }),
              buildTextNode({
                id: "press-second",
                layout: { frame: { x: 60, y: 10, w: 25, h: 12 }, zIndex: 2 },
              }),
            ],
            { id: "slide-exit-edit", name: "Slide 1" },
          ),
        ]);

        const renderTree = () =>
          hookRenderer.run(() =>
            SlideEditor({
              documentId: "doc-exit-edit",
              deck: currentDeck,
              onDeckChange: () => undefined,
            }),
          );
        const stageCanvasFrom = (root: ReactNode) =>
          findRequiredElement(
            root,
            (element) => element.type === SlideCanvas,
            "Expected stage canvas to render.",
          );
        const hiddenNodeIdsFrom = (root: ReactNode) =>
          (
            stageCanvasFrom(root).props as {
              hiddenNodeIds?: ReadonlySet<string>;
            }
          ).hiddenNodeIds;
        const pointerDownFrom = (root: ReactNode) =>
          (
            stageCanvasFrom(root).props as {
              onNodePointerDown?: (
                nodeId: string,
                event: React.PointerEvent,
              ) => void;
            }
          ).onNodePointerDown;

        const canvasElement = createElement({
          rect: { left: 0, top: 0, width: 1000, height: 1000 },
        });
        const currentTarget = createElement({
          closestMap: {
            '[data-slide-canvas="true"]': canvasElement,
          },
        });
        const pressNode = (
          pointerDown: (nodeId: string, event: React.PointerEvent) => void,
          nodeId: string,
          clientX: number,
        ) => {
          pointerDown(nodeId, {
            button: 0,
            pointerId: 1,
            clientX,
            clientY: 120,
            shiftKey: false,
            metaKey: false,
            ctrlKey: false,
            altKey: false,
            target: currentTarget,
            currentTarget,
            preventDefault: () => undefined,
            stopPropagation: () => undefined,
          } as unknown as React.PointerEvent);
          listeners.get("pointerup")?.({
            clientX,
            clientY: 120,
          } as PointerEvent);
        };

        let tree = renderTree();
        focusNode(tree, "edit-first");

        tree = renderTree();
        const selectedPointerDown = pointerDownFrom(tree);
        assert.ok(selectedPointerDown);
        pressNode(selectedPointerDown, "edit-first", 120);

        tree = renderTree();
        assert.ok(
          hiddenNodeIdsFrom(tree)?.has("edit-first"),
          "Expected first node to enter inline edit mode.",
        );

        const pressSecondPointerDown = pointerDownFrom(tree);
        assert.ok(pressSecondPointerDown);
        pressNode(pressSecondPointerDown, "press-second", 620);

        tree = renderTree();
        assert.notEqual(
          hiddenNodeIdsFrom(tree)?.has("edit-first"),
          true,
          "Expected pressing another node to exit the first node's inline edit.",
        );
      }),
    );
  });

  test("pressing another text node requests blur commit before switching selection", () => {
    withMockHTMLElement((createElement) =>
      withPointerWindow((listeners) => {
        const hookRenderer = createHookRenderer();
        const currentDeck = buildDeck([
          buildSlide(
            "content",
            [
              buildTextNode({
                id: "edit-before-switch",
                layout: { frame: { x: 10, y: 10, w: 25, h: 12 }, zIndex: 1 },
                content: {
                  paragraphs: [
                    { id: "edit-before-switch-p1", text: "Original" },
                  ],
                },
              }),
              buildTextNode({
                id: "switch-target",
                layout: { frame: { x: 60, y: 10, w: 25, h: 12 }, zIndex: 2 },
              }),
            ],
            { id: "slide-commit-before-switch", name: "Slide 1" },
          ),
        ]);

        const renderTree = () =>
          hookRenderer.run(() =>
            SlideEditor({
              documentId: "doc-commit-before-switch",
              deck: currentDeck,
              onDeckChange: () => undefined,
            }),
          );
        const pointerDownFrom = (root: ReactNode) =>
          (
            findRequiredElement(
              root,
              (element) => element.type === SlideCanvas,
              "Expected stage canvas to render.",
            ).props as {
              onNodePointerDown?: (
                nodeId: string,
                event: React.PointerEvent,
              ) => void;
            }
          ).onNodePointerDown;
        const pressNode = (
          pointerDown: (nodeId: string, event: React.PointerEvent) => void,
          nodeId: string,
          clientX: number,
        ) => {
          const canvasElement = createElement({
            rect: { left: 0, top: 0, width: 1000, height: 1000 },
          });
          const currentTarget = createElement({
            closestMap: {
              '[data-slide-canvas="true"]': canvasElement,
            },
          });
          pointerDown(nodeId, {
            button: 0,
            pointerId: 1,
            clientX,
            clientY: 120,
            shiftKey: false,
            metaKey: false,
            ctrlKey: false,
            altKey: false,
            target: currentTarget,
            currentTarget,
            preventDefault: () => undefined,
            stopPropagation: () => undefined,
          } as unknown as React.PointerEvent);
          listeners.get("pointerup")?.({
            clientX,
            clientY: 120,
          } as PointerEvent);
        };

        let tree = renderTree();
        focusNode(tree, "edit-before-switch");
        tree = renderTree();
        const selectedPointerDown = pointerDownFrom(tree);
        assert.ok(selectedPointerDown);
        pressNode(selectedPointerDown, "edit-before-switch", 120);

        tree = renderTree();
        const previousDocument = globalThis.document;
        let blurCalls = 0;
        globalThis.document = {
          querySelector(selector: string) {
            assert.equal(
              selector,
              '[data-inline-editor-presentation="edit-before-switch"]',
            );
            return {
              blur() {
                blurCalls += 1;
              },
            } as unknown as Element;
          },
        } as Document;

        try {
          const switchPointerDown = pointerDownFrom(tree);
          assert.ok(switchPointerDown);
          pressNode(switchPointerDown, "switch-target", 620);
        } finally {
          if (previousDocument === undefined) {
            Reflect.deleteProperty(globalThis, "document");
          } else {
            globalThis.document = previousDocument;
          }
        }

        assert.equal(blurCalls, 1);
      }),
    );
  });

  test("dragging the selected frame while inline editing moves the editor overlay with the frame", () => {
    withMockHTMLElement((createElement) =>
      withPointerWindow((listeners) => {
        const hookRenderer = createHookRenderer();
        const currentDeck = buildDeck([
          buildSlide(
            "content",
            [
              buildTextNode({
                id: "edit-drag-frame",
                layout: { frame: { x: 20, y: 20, w: 30, h: 12 }, zIndex: 1 },
              }),
            ],
            { id: "slide-inline-frame-drag", name: "Slide 1" },
          ),
        ]);
        const renderTree = () =>
          hookRenderer.run(() =>
            SlideEditor({
              documentId: "doc-inline-frame-drag",
              deck: currentDeck,
              onDeckChange: () => undefined,
            }),
          );
        const stageCanvasFrom = (root: ReactNode) =>
          findRequiredElement(
            root,
            (element) => element.type === SlideCanvas,
            "Expected stage canvas to render.",
          );
        const mountCanvasFrame = (root: ReactNode) => {
          const slideCanvasElement = createElement({
            rect: { left: 0, top: 0, width: 1000, height: 1000 },
          });
          const frameElement = createElement({
            rect: { left: 0, top: 0, width: 1000, height: 1000 },
            queryMap: {
              '[data-slide-canvas="true"]': slideCanvasElement,
            },
          });
          const frame = findRequiredElement(
            root,
            (element) =>
              element.type === "div" &&
              (element.props as { "data-slide-stage-frame"?: string })[
                "data-slide-stage-frame"
              ] === "true" &&
              typeof (element.props as { ref?: unknown }).ref === "function",
            "Expected mounted stage frame ref.",
          );
          (
            frame.props as { ref: (element: HTMLDivElement | null) => void }
          ).ref(frameElement as HTMLDivElement);
        };
        const pointerDownFrom = (root: ReactNode) =>
          (
            stageCanvasFrom(root).props as {
              onNodePointerDown?: (
                nodeId: string,
                event: React.PointerEvent,
              ) => void;
            }
          ).onNodePointerDown;
        const inlineEditorFrameFrom = (root: ReactNode) =>
          (
            findRequiredElement(
              root,
              (element) => element.type === InlineTextEditorPresentation,
              "Expected inline editor to render.",
            ).props as unknown as Parameters<
              typeof InlineTextEditorPresentation
            >[0]
          ).frame;
        const pointerEvent = (clientX: number, clientY: number) => {
          const canvasElement = createElement({
            rect: { left: 0, top: 0, width: 1000, height: 1000 },
          });
          const currentTarget = createElement({
            closestMap: {
              '[data-slide-canvas="true"]': canvasElement,
            },
          });
          return {
            button: 0,
            pointerId: 1,
            clientX,
            clientY,
            shiftKey: false,
            metaKey: false,
            ctrlKey: false,
            altKey: false,
            target: currentTarget,
            currentTarget,
            preventDefault: () => undefined,
            stopPropagation: () => undefined,
          } as unknown as React.PointerEvent;
        };

        let tree = renderTree();
        focusNode(tree, "edit-drag-frame");
        tree = renderTree();
        const enterEditPointerDown = pointerDownFrom(tree);
        assert.ok(enterEditPointerDown);
        enterEditPointerDown("edit-drag-frame", pointerEvent(220, 220));
        listeners.get("pointerup")?.({
          clientX: 220,
          clientY: 220,
        } as PointerEvent);

        tree = renderTree();
        mountCanvasFrame(tree);
        tree = renderTree();
        assert.deepEqual(inlineEditorFrameFrom(tree), {
          x: 20,
          y: 20,
          w: 30,
          h: 12,
        });

        const dragPointerDown = pointerDownFrom(tree);
        assert.ok(dragPointerDown);
        dragPointerDown("edit-drag-frame", pointerEvent(220, 220));
        listeners.get("pointermove")?.({
          clientX: 280,
          clientY: 250,
          shiftKey: false,
          altKey: false,
        } as PointerEvent);

        tree = renderTree();
        const dragFrame = inlineEditorFrameFrom(tree);
        assert.ok(
          dragFrame.x > 20 && dragFrame.y > 20,
          "Expected inline editor frame to follow drag preview.",
        );
      }),
    );
  });

  describe("SlideEditor empty-canvas double-click behavior", () => {
    test("inserts a text node at the canvas point and enters inline edit mode", () => {
      withMockHTMLElement((createElement) => {
        const hookRenderer = createHookRenderer();
        let deckChangeCount = 0;
        let currentDeck = buildDeck(
          [buildSlide("content", [], { id: "slide-empty", name: "Slide 1" })],
          { title: "Double-click insertion deck" },
        );

        const renderTree = () =>
          hookRenderer.run(() =>
            SlideEditor({
              documentId: "doc-double-click",
              deck: currentDeck,
              onDeckChange: (nextDeck) => {
                deckChangeCount += 1;
                currentDeck = nextDeck;
              },
            }),
          );

        let tree = renderTree();
        const stageShell = findRequiredElement(
          tree,
          (element) =>
            element.type === "div" &&
            (element.props as { "data-slide-stage-shell"?: string })[
              "data-slide-stage-shell"
            ] === "true" &&
            typeof (element.props as { onDoubleClick?: unknown })
              .onDoubleClick === "function",
          "Expected stage shell with double-click handler.",
        );
        const onStageDoubleClick = (
          stageShell.props as {
            onDoubleClick?: (event: MouseEvent<HTMLDivElement>) => void;
          }
        ).onDoubleClick;
        assert.ok(onStageDoubleClick);

        const canvasElement = createElement({
          rect: { left: 100, top: 200, width: 1000, height: 500 },
        });
        const target = createElement({
          closestMap: {
            '[data-slide-canvas="true"]': canvasElement,
          },
        });

        onStageDoubleClick?.({
          clientX: 850,
          clientY: 450,
          target,
        } as unknown as MouseEvent<HTMLDivElement>);

        assert.equal(deckChangeCount, 1, "Expected one deck update.");
        const inserted = currentDeck.slides[0]?.children.at(-1);
        assert.ok(inserted && inserted.type === "text");
        assert.equal(currentDeck.slides[0]?.children.length, 1);
        assert.deepEqual(inserted.layout?.frame, {
          x: 54,
          y: 44,
          w: 42,
          h: 12,
        });

        tree = renderTree();
        const stageCanvas = findRequiredElement(
          tree,
          (element) => element.type === SlideCanvas,
          "Expected stage canvas to render.",
        );
        const hiddenNodeIds = (
          stageCanvas.props as {
            hiddenNodeIds?: ReadonlySet<string>;
          }
        ).hiddenNodeIds;
        assert.ok(hiddenNodeIds?.has(inserted.id));

        const selection = (
          stageCanvas.props as {
            selection?: { nodeIds?: ReadonlySet<string> };
          }
        ).selection;
        assert.ok(
          selection?.nodeIds?.has(inserted.id),
          "Expected inserted node to be selected.",
        );
      });
    });

    test("double-clicking an existing text node enters inline edit without inserting", () => {
      const hookRenderer = createHookRenderer();
      let deckChangeCount = 0;
      let currentDeck = buildDeck([
        buildSlide(
          "content",
          [
            buildTextNode({
              id: "existing-text",
              layout: { frame: { x: 20, y: 24, w: 36, h: 12 }, zIndex: 1 },
            }),
          ],
          { id: "slide-with-text", name: "Slide 1" },
        ),
      ]);

      const renderTree = () =>
        hookRenderer.run(() =>
          SlideEditor({
            documentId: "doc-node-double-click",
            deck: currentDeck,
            onDeckChange: (nextDeck) => {
              deckChangeCount += 1;
              currentDeck = nextDeck;
            },
          }),
        );

      let tree = renderTree();
      const stageCanvas = findRequiredElement(
        tree,
        (element) =>
          element.type === SlideCanvas &&
          typeof (
            element.props as {
              onNodeDoubleClick?: (nodeId: string, event: MouseEvent) => void;
            }
          ).onNodeDoubleClick === "function",
        "Expected stage canvas with node double-click handler.",
      );
      const onNodeDoubleClick = (
        stageCanvas.props as {
          onNodeDoubleClick?: (nodeId: string, event: MouseEvent) => void;
        }
      ).onNodeDoubleClick;
      assert.ok(onNodeDoubleClick);
      onNodeDoubleClick?.("existing-text", preventableMouseEvent());

      tree = renderTree();
      assert.equal(
        deckChangeCount,
        0,
        "Expected no deck mutation on node edit.",
      );
      assert.equal(
        currentDeck.slides[0]?.children.length,
        1,
        "Expected existing node count to remain unchanged.",
      );

      const updatedStageCanvas = findRequiredElement(
        tree,
        (element) => element.type === SlideCanvas,
        "Expected stage canvas after node double-click.",
      );
      const hiddenNodeIds = (
        updatedStageCanvas.props as {
          hiddenNodeIds?: ReadonlySet<string>;
        }
      ).hiddenNodeIds;
      assert.ok(hiddenNodeIds?.has("existing-text"));
    });

    test("multi-selection double-click finalizes to the clicked text edit target", () => {
      withMockHTMLElement((createElement) =>
        withPointerWindow((listeners) => {
          const hookRenderer = createHookRenderer();
          const currentDeck = buildDeck([
            buildSlide(
              "content",
              [
                buildTextNode({
                  id: "multi-text-target",
                  layout: { frame: { x: 10, y: 10, w: 25, h: 12 }, zIndex: 1 },
                  content: {
                    paragraphs: [{ id: "multi-text-p1", text: "Edit here" }],
                  },
                }),
                buildImageNode("img-1", {
                  id: "multi-image-other",
                  layout: { frame: { x: 50, y: 10, w: 25, h: 12 }, zIndex: 2 },
                }),
              ],
              { id: "slide-multi-text-double-click", name: "Slide 1" },
            ),
          ]);
          const renderTree = () =>
            hookRenderer.run(() =>
              SlideEditor({
                documentId: "doc-multi-text-double-click",
                deck: currentDeck,
                onDeckChange: () => undefined,
              }),
            );

          let tree = renderTree();
          focusNode(tree, "multi-text-target");
          tree = renderTree();
          clickNode(tree, listeners, createElement, "multi-image-other", {
            shiftKey: true,
            clientX: 620,
            clientY: 160,
          });

          tree = renderTree();
          assert.deepEqual(selectedNodeIdsFrom(tree).sort(), [
            "multi-image-other",
            "multi-text-target",
          ]);
          nodeDoubleClickFrom(tree)(
            "multi-text-target",
            preventableMouseEvent({ clientX: 130, clientY: 130 }),
          );

          tree = renderTree();
          assert.deepEqual(selectedNodeIdsFrom(tree), ["multi-text-target"]);
          assert.ok(hiddenNodeIdsFrom(tree)?.has("multi-text-target"));
          mountStageFrame(tree, createElement);
          tree = renderTree();
          const inlineEditor = findRequiredElement(
            tree,
            (element) => element.type === InlineTextEditorPresentation,
            "Expected inline editor after text double-click.",
          );
          assert.deepEqual(
            (inlineEditor.props as { initialCaret?: unknown }).initialCaret,
            { kind: "client", x: 130, y: 130 },
          );
        }),
      );
    });

    test("multi-selection double-click on locked text selects it without editing", () => {
      withMockHTMLElement((createElement) =>
        withPointerWindow((listeners) => {
          const hookRenderer = createHookRenderer();
          const currentDeck = buildDeck([
            buildSlide(
              "content",
              [
                buildTextNode({
                  id: "locked-text-target",
                  locked: true,
                  layout: { frame: { x: 10, y: 10, w: 25, h: 12 }, zIndex: 1 },
                }),
                buildImageNode("img-1", {
                  id: "locked-image-other",
                  layout: { frame: { x: 50, y: 10, w: 25, h: 12 }, zIndex: 2 },
                }),
              ],
              { id: "slide-locked-text-double-click", name: "Slide 1" },
            ),
          ]);
          const renderTree = () =>
            hookRenderer.run(() =>
              SlideEditor({
                documentId: "doc-locked-text-double-click",
                deck: currentDeck,
                onDeckChange: () => undefined,
              }),
            );

          let tree = renderTree();
          focusNode(tree, "locked-text-target");
          tree = renderTree();
          clickNode(tree, listeners, createElement, "locked-image-other", {
            shiftKey: true,
            clientX: 620,
            clientY: 160,
          });

          tree = renderTree();
          nodeDoubleClickFrom(tree)(
            "locked-text-target",
            preventableMouseEvent({ clientX: 130, clientY: 130 }),
          );

          tree = renderTree();
          assert.deepEqual(selectedNodeIdsFrom(tree), ["locked-text-target"]);
          assert.notEqual(
            hiddenNodeIdsFrom(tree)?.has("locked-text-target"),
            true,
          );
        }),
      );
    });

    test("multi-selection double-click on an image only switches selection", () => {
      withMockHTMLElement((createElement) =>
        withPointerWindow((listeners) => {
          const hookRenderer = createHookRenderer();
          const currentDeck = buildDeck([
            buildSlide(
              "content",
              [
                buildTextNode({
                  id: "image-double-text-other",
                  layout: { frame: { x: 10, y: 10, w: 25, h: 12 }, zIndex: 1 },
                }),
                buildImageNode("img-1", {
                  id: "image-double-target",
                  layout: { frame: { x: 50, y: 10, w: 25, h: 12 }, zIndex: 2 },
                }),
              ],
              { id: "slide-image-double-click", name: "Slide 1" },
            ),
          ]);
          const renderTree = () =>
            hookRenderer.run(() =>
              SlideEditor({
                documentId: "doc-image-double-click",
                deck: currentDeck,
                onDeckChange: () => undefined,
              }),
            );

          let tree = renderTree();
          focusNode(tree, "image-double-text-other");
          tree = renderTree();
          clickNode(tree, listeners, createElement, "image-double-target", {
            shiftKey: true,
            clientX: 620,
            clientY: 160,
          });

          tree = renderTree();
          nodeDoubleClickFrom(tree)(
            "image-double-target",
            preventableMouseEvent({ clientX: 620, clientY: 160 }),
          );

          tree = renderTree();
          assert.deepEqual(selectedNodeIdsFrom(tree), ["image-double-target"]);
          assert.notEqual(
            hiddenNodeIdsFrom(tree)?.has("image-double-target"),
            true,
          );
        }),
      );
    });

    test("multi-selection double-click on a table enters table edit", async () => {
      await withMockHTMLElement((createElement) =>
        withPointerWindow(async (listeners) => {
          const hookRenderer = createHookRenderer();
          const currentDeck = buildDeck([
            buildSlide(
              "content",
              [
                buildTextNode({
                  id: "table-double-text-other",
                  layout: { frame: { x: 10, y: 10, w: 25, h: 12 }, zIndex: 1 },
                }),
                buildTableNode({
                  id: "table-double-target",
                  layout: { frame: { x: 50, y: 10, w: 30, h: 30 }, zIndex: 2 },
                }),
              ],
              { id: "slide-table-double-click", name: "Slide 1" },
            ),
          ]);
          const renderTree = () =>
            hookRenderer.run(() =>
              SlideEditor({
                documentId: "doc-table-double-click",
                deck: currentDeck,
                onDeckChange: () => undefined,
              }),
            );

          let tree = renderTree();
          focusNode(tree, "table-double-text-other");
          tree = renderTree();
          clickNode(tree, listeners, createElement, "table-double-target", {
            shiftKey: true,
            clientX: 620,
            clientY: 160,
          });

          tree = renderTree();
          const previousDocument = globalThis.document;
          globalThis.document = {
            querySelector: () => null,
          } as unknown as Document;
          try {
            nodeDoubleClickFrom(tree)(
              "table-double-target",
              preventableMouseEvent({ clientX: 620, clientY: 160 }),
            );
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          } finally {
            if (previousDocument === undefined) {
              Reflect.deleteProperty(globalThis, "document");
            } else {
              globalThis.document = previousDocument;
            }
          }

          tree = renderTree();
          const stageCanvas = stageCanvasFromRoot(tree);
          assert.deepEqual(selectedNodeIdsFrom(tree), ["table-double-target"]);
          assert.equal(
            (stageCanvas.props as { tableEditingNodeId?: string | null })
              .tableEditingNodeId,
            "table-double-target",
          );
          assert.deepEqual(
            (
              stageCanvas.props as {
                activeTableCell?: { rowIndex: number; colIndex: number } | null;
              }
            ).activeTableCell,
            { rowIndex: 0, colIndex: 0 },
          );
        }),
      );
    });

    test("multi-selection double-click on a group enters the group and selects its child", () => {
      withMockHTMLElement((createElement) =>
        withPointerWindow((listeners) => {
          const hookRenderer = createHookRenderer();
          const currentDeck = buildDeck([
            buildSlide(
              "content",
              [
                buildTextNode({
                  id: "group-double-other",
                  layout: { frame: { x: 10, y: 10, w: 25, h: 12 }, zIndex: 1 },
                }),
                buildGroupNode("group-double-target", [
                  buildTextNode({
                    id: "group-double-child",
                    layout: {
                      frame: { x: 50, y: 15, w: 20, h: 10 },
                      zIndex: 3,
                    },
                  }),
                ]),
              ],
              { id: "slide-group-double-click", name: "Slide 1" },
            ),
          ]);
          const renderTree = () =>
            hookRenderer.run(() =>
              SlideEditor({
                documentId: "doc-group-double-click",
                deck: currentDeck,
                onDeckChange: () => undefined,
              }),
            );

          let tree = renderTree();
          focusNode(tree, "group-double-other");
          tree = renderTree();
          clickNode(tree, listeners, createElement, "group-double-target", {
            shiftKey: true,
            clientX: 620,
            clientY: 250,
          });

          tree = renderTree();
          nodeDoubleClickFrom(tree)(
            "group-double-target",
            preventableMouseEvent({ clientX: 620, clientY: 250 }),
          );

          tree = renderTree();
          assert.equal(activeGroupIdFrom(tree), "group-double-target");
          assert.deepEqual(selectedNodeIdsFrom(tree), ["group-double-child"]);
        }),
      );
    });

    test("double-clicking a locked group selects it without entering the group", () => {
      const hookRenderer = createHookRenderer();
      const currentDeck = buildDeck([
        buildSlide(
          "content",
          [
            buildGroupNode(
              "locked-group-double-target",
              [buildTextNode({ id: "locked-group-child" })],
              true,
            ),
          ],
          { id: "slide-locked-group-double-click", name: "Slide 1" },
        ),
      ]);
      const renderTree = () =>
        hookRenderer.run(() =>
          SlideEditor({
            documentId: "doc-locked-group-double-click",
            deck: currentDeck,
            onDeckChange: () => undefined,
          }),
        );

      let tree = renderTree();
      nodeDoubleClickFrom(tree)(
        "locked-group-double-target",
        preventableMouseEvent({ clientX: 620, clientY: 250 }),
      );

      tree = renderTree();
      assert.equal(activeGroupIdFrom(tree), null);
      assert.deepEqual(selectedNodeIdsFrom(tree), [
        "locked-group-double-target",
      ]);
    });

    test("double-clicking multi-selection bounds does not insert or clear selection", () => {
      withMockHTMLElement((createElement) =>
        withPointerWindow((listeners) => {
          const hookRenderer = createHookRenderer();
          let deckChangeCount = 0;
          const currentDeck = buildDeck([
            buildSlide(
              "content",
              [
                buildTextNode({ id: "bounds-text-a" }),
                buildImageNode("img-1", { id: "bounds-image-b" }),
              ],
              { id: "slide-bounds-double-click", name: "Slide 1" },
            ),
          ]);
          const renderTree = () =>
            hookRenderer.run(() =>
              SlideEditor({
                documentId: "doc-bounds-double-click",
                deck: currentDeck,
                onDeckChange: () => {
                  deckChangeCount += 1;
                },
              }),
            );

          let tree = renderTree();
          focusNode(tree, "bounds-text-a");
          tree = renderTree();
          clickNode(tree, listeners, createElement, "bounds-image-b", {
            shiftKey: true,
            clientX: 620,
            clientY: 300,
          });

          tree = renderTree();
          assert.deepEqual(selectedNodeIdsFrom(tree).sort(), [
            "bounds-image-b",
            "bounds-text-a",
          ]);
          const stageShell = findRequiredElement(
            tree,
            (element) =>
              element.type === "div" &&
              (element.props as { "data-slide-stage-shell"?: string })[
                "data-slide-stage-shell"
              ] === "true" &&
              typeof (element.props as { onDoubleClick?: unknown })
                .onDoubleClick === "function",
            "Expected stage shell with double-click handler.",
          );
          const onStageDoubleClick = (
            stageShell.props as {
              onDoubleClick?: (event: MouseEvent<HTMLDivElement>) => void;
            }
          ).onDoubleClick;
          assert.ok(onStageDoubleClick);
          const boundsElement = createElement();
          const target = createElement({
            closestMap: {
              "[data-node-id],[data-resize-handle],[data-crop-handle],[data-rotation-handle],[data-connector-endpoint],[data-multi-selection-bounds]":
                boundsElement,
            },
          });
          onStageDoubleClick({
            clientX: 300,
            clientY: 200,
            target,
          } as unknown as MouseEvent<HTMLDivElement>);

          tree = renderTree();
          assert.equal(deckChangeCount, 0);
          assert.deepEqual(selectedNodeIdsFrom(tree).sort(), [
            "bounds-image-b",
            "bounds-text-a",
          ]);
        }),
      );
    });

    test("blank canvas double-click commits current inline edit before inserting text", () => {
      withMockHTMLElement((createElement) =>
        withPointerWindow((listeners) => {
          const hookRenderer = createHookRenderer();
          let currentDeck = buildDeck([
            buildSlide(
              "content",
              [
                buildTextNode({
                  id: "blank-commit-source",
                  layout: { frame: { x: 10, y: 10, w: 25, h: 12 }, zIndex: 1 },
                }),
              ],
              { id: "slide-blank-commit-double-click", name: "Slide 1" },
            ),
          ]);
          const renderTree = () =>
            hookRenderer.run(() =>
              SlideEditor({
                documentId: "doc-blank-commit-double-click",
                deck: currentDeck,
                onDeckChange: (nextDeck) => {
                  currentDeck = nextDeck;
                },
              }),
            );

          let tree = renderTree();
          focusNode(tree, "blank-commit-source");
          tree = renderTree();
          clickNode(tree, listeners, createElement, "blank-commit-source", {
            clientX: 130,
            clientY: 130,
          });

          tree = renderTree();
          assert.ok(hiddenNodeIdsFrom(tree)?.has("blank-commit-source"));

          const previousDocument = globalThis.document;
          let blurCalls = 0;
          globalThis.document = {
            querySelector(selector: string) {
              assert.equal(
                selector,
                '[data-inline-editor-presentation="blank-commit-source"]',
              );
              return {
                blur() {
                  blurCalls += 1;
                },
              } as unknown as Element;
            },
          } as Document;

          try {
            const stageShell = findRequiredElement(
              tree,
              (element) =>
                element.type === "div" &&
                (element.props as { "data-slide-stage-shell"?: string })[
                  "data-slide-stage-shell"
                ] === "true" &&
                typeof (element.props as { onDoubleClick?: unknown })
                  .onDoubleClick === "function",
              "Expected stage shell with double-click handler.",
            );
            const canvasElement = createElement({
              rect: { left: 0, top: 0, width: 1000, height: 500 },
            });
            const target = createElement({
              closestMap: {
                '[data-slide-canvas="true"]': canvasElement,
              },
            });
            (
              stageShell.props as {
                onDoubleClick?: (event: MouseEvent<HTMLDivElement>) => void;
              }
            ).onDoubleClick?.({
              clientX: 500,
              clientY: 250,
              target,
            } as unknown as MouseEvent<HTMLDivElement>);
          } finally {
            if (previousDocument === undefined) {
              Reflect.deleteProperty(globalThis, "document");
            } else {
              globalThis.document = previousDocument;
            }
          }

          assert.equal(blurCalls, 1);
          assert.equal(currentDeck.slides[0]?.children.length, 2);
          const inserted = currentDeck.slides[0]?.children.at(-1);
          assert.ok(inserted?.type === "text");

          tree = renderTree();
          assert.deepEqual(selectedNodeIdsFrom(tree), [inserted.id]);
          assert.ok(hiddenNodeIdsFrom(tree)?.has(inserted.id));
        }),
      );
    });

    test("clicking the already-selected text node enters edit mode at the click point", () => {
      withMockHTMLElement((createElement) =>
        withPointerWindow((listeners) => {
          const hookRenderer = createHookRenderer();
          const currentDeck = buildDeck([
            buildSlide(
              "content",
              [
                buildTextNode({
                  id: "selected-text",
                  layout: {
                    frame: { x: 20, y: 24, w: 36, h: 12 },
                    zIndex: 1,
                  },
                  content: {
                    paragraphs: [
                      {
                        id: "selected-text-p1",
                        text: "Place the caret here",
                      },
                    ],
                  },
                }),
              ],
              { id: "slide-with-selected-text", name: "Slide 1" },
            ),
          ]);

          const renderTree = () =>
            hookRenderer.run(() =>
              SlideEditor({
                documentId: "doc-selected-click",
                deck: currentDeck,
                onDeckChange: () => undefined,
              }),
            );
          const stageCanvasFrom = (root: ReactNode) =>
            findRequiredElement(
              root,
              (element) => element.type === SlideCanvas,
              "Expected stage canvas to render.",
            );

          let tree = renderTree();
          focusNode(tree, "selected-text");

          tree = renderTree();
          const selectedStageCanvas = stageCanvasFrom(tree);
          const onNodePointerDown = (
            selectedStageCanvas.props as {
              onNodePointerDown?: (
                nodeId: string,
                event: React.PointerEvent,
              ) => void;
            }
          ).onNodePointerDown;
          assert.ok(onNodePointerDown);
          const canvasElement = createElement({
            rect: { left: 0, top: 0, width: 1000, height: 1000 },
          });
          const currentTarget = createElement({
            closestMap: {
              '[data-slide-canvas="true"]': canvasElement,
            },
          });
          onNodePointerDown("selected-text", {
            button: 0,
            pointerId: 1,
            clientX: 372,
            clientY: 246,
            shiftKey: false,
            metaKey: false,
            ctrlKey: false,
            altKey: false,
            target: currentTarget,
            currentTarget,
            preventDefault: () => undefined,
            stopPropagation: () => undefined,
          } as unknown as React.PointerEvent);
          listeners.get("pointerup")?.({
            clientX: 372,
            clientY: 246,
          } as PointerEvent);

          tree = renderTree();
          const updatedStageCanvas = stageCanvasFrom(tree);
          const hiddenNodeIds = (
            updatedStageCanvas.props as {
              hiddenNodeIds?: ReadonlySet<string>;
            }
          ).hiddenNodeIds;
          assert.ok(
            hiddenNodeIds?.has("selected-text"),
            "Expected selected text click to enter inline edit mode.",
          );
        }),
      );
    });

    test("clicking an already-selected shape does not enter inline edit", () => {
      withMockHTMLElement((createElement) =>
        withPointerWindow((listeners) => {
          const hookRenderer = createHookRenderer();
          const currentDeck = buildDeck([
            buildSlide(
              "content",
              [
                buildShapeNode({
                  id: "empty-shape",
                  layout: {
                    frame: { x: 20, y: 24, w: 36, h: 12 },
                    zIndex: 1,
                  },
                  content: { shape: "rect" },
                }),
              ],
              { id: "slide-with-empty-shape", name: "Slide 1" },
            ),
          ]);

          const renderTree = () =>
            hookRenderer.run(() =>
              SlideEditor({
                documentId: "doc-selected-empty-shape-click",
                deck: currentDeck,
                onDeckChange: () => undefined,
              }),
            );
          const stageCanvasFrom = (root: ReactNode) =>
            findRequiredElement(
              root,
              (element) => element.type === SlideCanvas,
              "Expected stage canvas to render.",
            );

          let tree = renderTree();
          focusNode(tree, "empty-shape");

          tree = renderTree();
          const selectedStageCanvas = stageCanvasFrom(tree);
          const onNodePointerDown = (
            selectedStageCanvas.props as {
              onNodePointerDown?: (
                nodeId: string,
                event: React.PointerEvent,
              ) => void;
            }
          ).onNodePointerDown;
          assert.ok(onNodePointerDown);
          const canvasElement = createElement({
            rect: { left: 0, top: 0, width: 1000, height: 1000 },
          });
          const currentTarget = createElement({
            closestMap: {
              '[data-slide-canvas="true"]': canvasElement,
            },
          });
          onNodePointerDown("empty-shape", {
            button: 0,
            pointerId: 1,
            clientX: 372,
            clientY: 246,
            shiftKey: false,
            metaKey: false,
            ctrlKey: false,
            altKey: false,
            target: currentTarget,
            currentTarget,
            preventDefault: () => undefined,
            stopPropagation: () => undefined,
          } as unknown as React.PointerEvent);
          listeners.get("pointerup")?.({
            clientX: 372,
            clientY: 246,
          } as PointerEvent);

          tree = renderTree();
          const updatedStageCanvas = stageCanvasFrom(tree);
          const hiddenNodeIds = (
            updatedStageCanvas.props as {
              hiddenNodeIds?: ReadonlySet<string>;
            }
          ).hiddenNodeIds;
          assert.notEqual(
            hiddenNodeIds?.has("empty-shape"),
            true,
            "Expected selected shape click to stay out of inline edit mode.",
          );
        }),
      );
    });
  });
});
