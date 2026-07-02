import assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as React from "react";
import type { MouseEvent, ReactNode } from "react";

import {
  buildDeckV7,
  buildShapeNode,
  buildSlideV7,
  buildTextNode,
} from "@/test/builders/deck-v7";
import { InlineTextEditorVNext } from "./inline-text-editor";
import { SlideCanvasVNext } from "./slide-canvas";
import { SlideEditorVNext } from "./slide-editor-vnext";
import {
  clickNode,
  createHookRenderer,
  findRequiredElement,
  focusNode,
  withMockHTMLElement,
  withPointerWindow,
} from "./slide-editor-vnext-failure-test-utils";

describe("SlideEditorVNext inline text editor failures", () => {
  test("inline edit keeps stage hover preselection for other nodes", () => {
    withMockHTMLElement((createElement) => {
      const hookRenderer = createHookRenderer();
      const currentDeck = buildDeckV7([
        buildSlideV7(
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
          SlideEditorVNext({
            documentId: "doc-inline-hover",
            deck: currentDeck,
            onDeckChange: () => undefined,
          }),
        );
      const stageCanvasFrom = (root: ReactNode) =>
        findRequiredElement(
          root,
          (element) => element.type === SlideCanvasVNext,
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
          '[data-slide-canvas-vnext="true"]': canvasElement,
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
        const currentDeck = buildDeckV7([
          buildSlideV7(
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
            SlideEditorVNext({
              documentId: "doc-drag-selected-text",
              deck: currentDeck,
              onDeckChange: () => undefined,
            }),
          );
        const stageCanvasFrom = (root: ReactNode) =>
          findRequiredElement(
            root,
            (element) => element.type === SlideCanvasVNext,
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
            '[data-slide-canvas-vnext="true"]': canvasElement,
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
    const currentDeck = buildDeckV7([
      buildSlideV7(
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
        SlideEditorVNext({
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
      (element) => element.type === SlideCanvasVNext,
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
        selector === '[data-slide-canvas-vnext="true"]'
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
    onNodeDoubleClick("preselected-over-edit", {
      clientX: 250,
      clientY: 250,
      target,
    } as unknown as MouseEvent);

    tree = renderTree();
    const updatedStageCanvas = findRequiredElement(
      tree,
      (element) => element.type === SlideCanvasVNext,
      "Expected updated stage canvas.",
    );
    const hiddenNodeIds = (
      updatedStageCanvas.props as { hiddenNodeIds?: ReadonlySet<string> }
    ).hiddenNodeIds;
    assert.notEqual(hiddenNodeIds?.has("selected-under-edit"), true);
    assert.notEqual(hiddenNodeIds?.has("preselected-over-edit"), true);
  });

  test("pressing another node exits the first node's inline edit", () => {
    withMockHTMLElement((createElement) =>
      withPointerWindow((listeners) => {
        const hookRenderer = createHookRenderer();
        const currentDeck = buildDeckV7([
          buildSlideV7(
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
            SlideEditorVNext({
              documentId: "doc-exit-edit",
              deck: currentDeck,
              onDeckChange: () => undefined,
            }),
          );
        const stageCanvasFrom = (root: ReactNode) =>
          findRequiredElement(
            root,
            (element) => element.type === SlideCanvasVNext,
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
            '[data-slide-canvas-vnext="true"]': canvasElement,
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
        const currentDeck = buildDeckV7([
          buildSlideV7(
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
            SlideEditorVNext({
              documentId: "doc-commit-before-switch",
              deck: currentDeck,
              onDeckChange: () => undefined,
            }),
          );
        const pointerDownFrom = (root: ReactNode) =>
          (
            findRequiredElement(
              root,
              (element) => element.type === SlideCanvasVNext,
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
              '[data-slide-canvas-vnext="true"]': canvasElement,
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
              '[data-inline-editor-vnext="edit-before-switch"]',
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
        const currentDeck = buildDeckV7([
          buildSlideV7(
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
            SlideEditorVNext({
              documentId: "doc-inline-frame-drag",
              deck: currentDeck,
              onDeckChange: () => undefined,
            }),
          );
        const stageCanvasFrom = (root: ReactNode) =>
          findRequiredElement(
            root,
            (element) => element.type === SlideCanvasVNext,
            "Expected stage canvas to render.",
          );
        const mountCanvasFrame = (root: ReactNode) => {
          const slideCanvasElement = createElement({
            rect: { left: 0, top: 0, width: 1000, height: 1000 },
          });
          const frameElement = createElement({
            rect: { left: 0, top: 0, width: 1000, height: 1000 },
            queryMap: {
              '[data-slide-canvas-vnext="true"]': slideCanvasElement,
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
              (element) => element.type === InlineTextEditorVNext,
              "Expected inline editor to render.",
            ).props as unknown as Parameters<typeof InlineTextEditorVNext>[0]
          ).frame;
        const pointerEvent = (clientX: number, clientY: number) => {
          const canvasElement = createElement({
            rect: { left: 0, top: 0, width: 1000, height: 1000 },
          });
          const currentTarget = createElement({
            closestMap: {
              '[data-slide-canvas-vnext="true"]': canvasElement,
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

  describe("SlideEditorVNext empty-canvas double-click behavior", () => {
    test("inserts a text node at the canvas point and enters inline edit mode", () => {
      withMockHTMLElement((createElement) => {
        const hookRenderer = createHookRenderer();
        let deckChangeCount = 0;
        let currentDeck = buildDeckV7(
          [buildSlideV7("content", [], { id: "slide-empty", name: "Slide 1" })],
          { title: "Double-click insertion deck" },
        );

        const renderTree = () =>
          hookRenderer.run(() =>
            SlideEditorVNext({
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
            '[data-slide-canvas-vnext="true"]': canvasElement,
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
          (element) => element.type === SlideCanvasVNext,
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

    test("double-clicking an existing text node does not insert or force inline edit", () => {
      const hookRenderer = createHookRenderer();
      let deckChangeCount = 0;
      let currentDeck = buildDeckV7([
        buildSlideV7(
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
          SlideEditorVNext({
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
          element.type === SlideCanvasVNext &&
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
      onNodeDoubleClick?.("existing-text", {} as MouseEvent);

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
        (element) => element.type === SlideCanvasVNext,
        "Expected stage canvas after node double-click.",
      );
      const hiddenNodeIds = (
        updatedStageCanvas.props as {
          hiddenNodeIds?: ReadonlySet<string>;
        }
      ).hiddenNodeIds;
      assert.notEqual(hiddenNodeIds?.has("existing-text"), true);
    });

    test("clicking the already-selected text node enters edit mode at the click point", () => {
      withMockHTMLElement((createElement) =>
        withPointerWindow((listeners) => {
          const hookRenderer = createHookRenderer();
          const currentDeck = buildDeckV7([
            buildSlideV7(
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
              SlideEditorVNext({
                documentId: "doc-selected-click",
                deck: currentDeck,
                onDeckChange: () => undefined,
              }),
            );
          const stageCanvasFrom = (root: ReactNode) =>
            findRequiredElement(
              root,
              (element) => element.type === SlideCanvasVNext,
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
              '[data-slide-canvas-vnext="true"]': canvasElement,
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
          const currentDeck = buildDeckV7([
            buildSlideV7(
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
              SlideEditorVNext({
                documentId: "doc-selected-empty-shape-click",
                deck: currentDeck,
                onDeckChange: () => undefined,
              }),
            );
          const stageCanvasFrom = (root: ReactNode) =>
            findRequiredElement(
              root,
              (element) => element.type === SlideCanvasVNext,
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
              '[data-slide-canvas-vnext="true"]': canvasElement,
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
