import assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as React from "react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

import type { GroupNode } from "@/lib/presentation-vnext/schema";
import {
  buildDeckV7,
  buildShapeNode,
  buildSlideV7,
  buildTableNode,
  buildTextNode,
} from "@/test/builders/deck-v7";
import { SlideCanvasVNext } from "./slide-canvas";
import { StageNodeContextMenu } from "./stage-context-menu";
import { SlideEditorVNext } from "./slide-editor-vnext";
import {
  clickNode,
  createHookRenderer,
  findRequiredElement,
  focusNode,
  withMockHTMLElement,
  withPointerWindow,
  withWindow,
} from "./slide-editor-vnext-failure-test-utils";

function buildGroupNode(id: string, locked = false): GroupNode {
  return {
    id,
    type: "group",
    component: "custom",
    locked,
    layout: { frame: { x: 40, y: 20, w: 30, h: 25 }, zIndex: 3 },
    children: [
      buildTextNode({
        id: `${id}-child`,
        layout: { frame: { x: 45, y: 25, w: 15, h: 8 }, zIndex: 4 },
      }),
    ],
  };
}

describe("SlideEditorVNext stage selection failures", () => {
  test("shift-marquee adds framed nodes to the existing selection", () => {
    withMockHTMLElement((createElement) =>
      withPointerWindow((listeners) => {
        const hookRenderer = createHookRenderer();
        const currentDeck = buildDeckV7([
          buildSlideV7(
            "content",
            [
              buildTextNode({
                id: "already-selected",
                layout: { frame: { x: 10, y: 10, w: 10, h: 10 }, zIndex: 1 },
              }),
              buildTextNode({
                id: "marquee-target",
                layout: { frame: { x: 50, y: 10, w: 10, h: 10 }, zIndex: 2 },
              }),
            ],
            { id: "slide-marquee-additive", name: "Slide 1" },
          ),
        ]);

        const renderTree = () =>
          hookRenderer.run(() =>
            SlideEditorVNext({
              documentId: "doc-marquee-additive",
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
        focusNode(tree, "already-selected");

        tree = renderTree();
        const stageShell = findRequiredElement(
          tree,
          (element) =>
            element.type === "div" &&
            (element.props as { "data-slide-stage-shell"?: string })[
              "data-slide-stage-shell"
            ] === "true" &&
            typeof (element.props as { onPointerDown?: unknown })
              .onPointerDown === "function",
          "Expected stage shell with pointerdown handler.",
        );
        const onPointerDown = (
          stageShell.props as {
            onPointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
          }
        ).onPointerDown;
        assert.ok(onPointerDown);
        const canvasElement = createElement({
          rect: { left: 0, top: 0, width: 1000, height: 1000 },
        });
        const target = createElement({
          closestMap: {
            '[data-slide-canvas-vnext="true"]': canvasElement,
          },
        });
        let prevented = false;

        onPointerDown({
          button: 0,
          pointerId: 1,
          clientX: 400,
          clientY: 50,
          shiftKey: true,
          metaKey: false,
          ctrlKey: false,
          target,
          currentTarget: {
            setPointerCapture: () => undefined,
            releasePointerCapture: () => undefined,
          },
          preventDefault: () => {
            prevented = true;
          },
        } as unknown as React.PointerEvent<HTMLDivElement>);

        assert.equal(prevented, true);
        const pointerMove = listeners.get("pointermove");
        assert.ok(pointerMove, "Expected marquee to register pointermove.");
        pointerMove({ clientX: 700, clientY: 300 } as PointerEvent);

        tree = renderTree();
        const selection = (
          stageCanvasFrom(tree).props as {
            selection?: { nodeIds?: ReadonlySet<string> };
          }
        ).selection;
        assert.ok(selection?.nodeIds?.has("already-selected"));
        assert.ok(selection?.nodeIds?.has("marquee-target"));
      }),
    );
  });

  test("mod+a selects all editable slide nodes", async () => {
    await withWindow(() => {
      const hookRenderer = createHookRenderer();
      const currentDeck = buildDeckV7([
        buildSlideV7(
          "content",
          [
            buildTextNode({
              id: "select-all-first",
              layout: { frame: { x: 10, y: 10, w: 10, h: 10 }, zIndex: 1 },
            }),
            buildTextNode({
              id: "select-all-second",
              layout: { frame: { x: 50, y: 10, w: 10, h: 10 }, zIndex: 2 },
            }),
          ],
          { id: "slide-select-all", name: "Slide 1" },
        ),
      ]);

      const renderTree = () =>
        hookRenderer.run(() =>
          SlideEditorVNext({
            documentId: "doc-select-all",
            deck: currentDeck,
            onDeckChange: () => undefined,
          }),
        );

      let tree = renderTree();
      const editorRoot = findRequiredElement(
        tree,
        (element) =>
          element.type === "div" &&
          (element.props as { "data-slide-editor-vnext"?: string })[
            "data-slide-editor-vnext"
          ] === "true" &&
          typeof (element.props as { onKeyDown?: unknown }).onKeyDown ===
            "function",
        "Expected editor root with keydown handler.",
      );
      const onKeyDown = (
        editorRoot.props as {
          onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
        }
      ).onKeyDown;
      assert.ok(onKeyDown);
      let prevented = false;
      onKeyDown({
        key: "a",
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        target: null,
        preventDefault: () => {
          prevented = true;
        },
      } as unknown as KeyboardEvent<HTMLDivElement>);

      assert.equal(prevented, true);
      tree = renderTree();
      const stageCanvas = findRequiredElement(
        tree,
        (element) => element.type === SlideCanvasVNext,
        "Expected stage canvas after select-all.",
      );
      const selection = (
        stageCanvas.props as {
          selection?: { nodeIds?: ReadonlySet<string> };
        }
      ).selection;
      assert.ok(selection?.nodeIds?.has("select-all-first"));
      assert.ok(selection?.nodeIds?.has("select-all-second"));
    });
  });

  test("space selects and shift-space toggles the focused stage node", async () => {
    await withWindow(() => {
      const hookRenderer = createHookRenderer();
      const currentDeck = buildDeckV7([
        buildSlideV7(
          "content",
          [
            buildTextNode({
              id: "space-target",
              layout: { frame: { x: 10, y: 10, w: 10, h: 10 }, zIndex: 1 },
            }),
          ],
          { id: "slide-space-select", name: "Slide 1" },
        ),
      ]);

      const renderTree = () =>
        hookRenderer.run(() =>
          SlideEditorVNext({
            documentId: "doc-space-select",
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
      const keyDownFrom = (root: ReactNode) =>
        (
          findRequiredElement(
            root,
            (element) =>
              element.type === "div" &&
              (element.props as { "data-slide-editor-vnext"?: string })[
                "data-slide-editor-vnext"
              ] === "true" &&
              typeof (element.props as { onKeyDown?: unknown }).onKeyDown ===
                "function",
            "Expected editor root with keydown handler.",
          ).props as {
            onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
          }
        ).onKeyDown;

      let tree = renderTree();
      const onNodeFocus = (
        stageCanvasFrom(tree).props as {
          onNodeFocus?: (nodeId: string) => void;
        }
      ).onNodeFocus;
      assert.ok(onNodeFocus);
      onNodeFocus("space-target");

      tree = renderTree();
      let prevented = false;
      keyDownFrom(tree)?.({
        key: " ",
        shiftKey: false,
        target: null,
        preventDefault: () => {
          prevented = true;
        },
      } as unknown as KeyboardEvent<HTMLDivElement>);

      assert.equal(prevented, true);
      tree = renderTree();
      let selection = (
        stageCanvasFrom(tree).props as {
          selection?: { nodeIds?: ReadonlySet<string> };
        }
      ).selection;
      assert.ok(selection?.nodeIds?.has("space-target"));

      keyDownFrom(tree)?.({
        key: " ",
        shiftKey: true,
        target: null,
        preventDefault: () => undefined,
      } as unknown as KeyboardEvent<HTMLDivElement>);

      tree = renderTree();
      selection = (
        stageCanvasFrom(tree).props as {
          selection?: { nodeIds?: ReadonlySet<string> };
        }
      ).selection;
      assert.equal(selection?.nodeIds?.has("space-target"), false);
    });
  });

  test("Enter does not enter edit, table, or group modes for locked nodes", async () => {
    await withWindow(() => {
      const hookRenderer = createHookRenderer();
      const currentDeck = buildDeckV7([
        buildSlideV7(
          "content",
          [
            buildTextNode({
              id: "locked-enter-text",
              locked: true,
              layout: { frame: { x: 10, y: 10, w: 20, h: 10 }, zIndex: 1 },
            }),
            buildTableNode({
              id: "locked-enter-table",
              locked: true,
              layout: { frame: { x: 35, y: 10, w: 25, h: 20 }, zIndex: 2 },
            }),
            buildGroupNode("locked-enter-group", true),
          ],
          { id: "slide-locked-enter", name: "Slide 1" },
        ),
      ]);

      const renderTree = () =>
        hookRenderer.run(() =>
          SlideEditorVNext({
            documentId: "doc-locked-enter",
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
      const keyDownFrom = (root: ReactNode) =>
        (
          findRequiredElement(
            root,
            (element) =>
              element.type === "div" &&
              (element.props as { "data-slide-editor-vnext"?: string })[
                "data-slide-editor-vnext"
              ] === "true" &&
              typeof (element.props as { onKeyDown?: unknown }).onKeyDown ===
                "function",
            "Expected editor root with keydown handler.",
          ).props as {
            onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
          }
        ).onKeyDown;

      for (const nodeId of [
        "locked-enter-text",
        "locked-enter-table",
        "locked-enter-group",
      ]) {
        let tree = renderTree();
        focusNode(tree, nodeId);
        tree = renderTree();
        let prevented = false;
        keyDownFrom(tree)?.({
          key: "Enter",
          target: null,
          preventDefault: () => {
            prevented = true;
          },
        } as unknown as KeyboardEvent<HTMLDivElement>);

        tree = renderTree();
        const stageCanvas = stageCanvasFrom(tree);
        assert.equal(prevented, true);
        assert.deepEqual(
          [
            ...((
              stageCanvas.props as {
                selection?: { nodeIds?: ReadonlySet<string> };
              }
            ).selection?.nodeIds ?? new Set<string>()),
          ],
          [nodeId],
        );
        assert.notEqual(
          (
            stageCanvas.props as { hiddenNodeIds?: ReadonlySet<string> }
          ).hiddenNodeIds?.has(nodeId),
          true,
        );
        assert.notEqual(
          (stageCanvas.props as { tableEditingNodeId?: string | null })
            .tableEditingNodeId,
          nodeId,
        );
        assert.notEqual(
          (stageCanvas.props as { activeGroupId?: string | null })
            .activeGroupId,
          nodeId,
        );
      }
    });
  });

  test("right-clicking a stage node selects it for context actions", () => {
    withMockHTMLElement((createElement) => {
      const hookRenderer = createHookRenderer();
      const currentDeck = buildDeckV7([
        buildSlideV7(
          "content",
          [
            buildTextNode({
              id: "context-text",
              layout: { frame: { x: 20, y: 20, w: 30, h: 12 }, zIndex: 1 },
              content: {
                paragraphs: [{ id: "context-text-p1", text: "Context menu" }],
              },
            }),
          ],
          { id: "slide-context-menu", name: "Slide 1" },
        ),
      ]);

      const renderTree = () =>
        hookRenderer.run(() =>
          SlideEditorVNext({
            documentId: "doc-context-menu",
            deck: currentDeck,
            onDeckChange: () => undefined,
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
          typeof (element.props as { onContextMenu?: unknown })
            .onContextMenu === "function",
        "Expected stage shell with contextmenu handler.",
      );
      const onContextMenu = (
        stageShell.props as {
          onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
        }
      ).onContextMenu;
      assert.ok(onContextMenu);
      const canvasElement = createElement({
        rect: { left: 100, top: 200, width: 1000, height: 500 },
      });
      const target = createElement({
        closestMap: {
          '[data-slide-canvas-vnext="true"]': canvasElement,
        },
      });
      let prevented = false;
      let stopped = false;

      onContextMenu({
        clientX: 360,
        clientY: 330,
        target,
        preventDefault: () => {
          prevented = true;
        },
        stopPropagation: () => {
          stopped = true;
        },
      } as unknown as MouseEvent<HTMLDivElement>);

      assert.equal(prevented, true);
      assert.equal(stopped, true);
      tree = renderTree();
      const stageCanvas = findRequiredElement(
        tree,
        (element) => element.type === SlideCanvasVNext,
        "Expected stage canvas after context-menu selection.",
      );
      const selection = (
        stageCanvas.props as { selection?: { nodeIds?: ReadonlySet<string> } }
      ).selection;
      assert.ok(selection?.nodeIds?.has("context-text"));
    });
  });

  test("context menu detaches a bound connector endpoint", async () => {
    await withWindow(() =>
      withMockHTMLElement((createElement) => {
        const hookRenderer = createHookRenderer();
        let currentDeck = buildDeckV7([
          buildSlideV7(
            "content",
            [
              buildTextNode({
                id: "detach-a",
                layout: { frame: { x: 10, y: 10, w: 12, h: 12 }, zIndex: 1 },
              }),
              buildTextNode({
                id: "detach-b",
                layout: { frame: { x: 60, y: 10, w: 12, h: 12 }, zIndex: 2 },
              }),
              {
                id: "detach-connector",
                type: "connector" as const,
                role: "connector" as const,
                layout: { frame: { x: 22, y: 16, w: 38, h: 1 }, zIndex: 3 },
                style: { ref: "connector.primary" as const },
                content: {
                  from: {
                    kind: "node" as const,
                    nodeId: "detach-a",
                    anchor: "right" as const,
                  },
                  to: {
                    kind: "node" as const,
                    nodeId: "detach-b",
                    anchor: "left" as const,
                  },
                  routing: "straight" as const,
                },
              },
            ],
            { id: "slide-detach-connector", name: "Slide 1" },
          ),
        ]);

        const renderTree = () =>
          hookRenderer.run(() =>
            SlideEditorVNext({
              documentId: "doc-detach-connector",
              deck: currentDeck,
              onDeckChange: (nextDeck) => {
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
            typeof (element.props as { onContextMenu?: unknown })
              .onContextMenu === "function",
          "Expected stage shell with contextmenu handler.",
        );
        const onContextMenu = (
          stageShell.props as {
            onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
          }
        ).onContextMenu;
        assert.ok(onContextMenu);
        const canvasElement = createElement({
          rect: { left: 0, top: 0, width: 1000, height: 1000 },
        });
        const target = createElement({
          closestMap: {
            '[data-slide-canvas-vnext="true"]': canvasElement,
          },
        });

        onContextMenu({
          clientX: 410,
          clientY: 165,
          target,
          preventDefault: () => undefined,
          stopPropagation: () => undefined,
        } as unknown as MouseEvent<HTMLDivElement>);

        tree = renderTree();
        const menu = findRequiredElement(
          tree,
          (element) => element.type === StageNodeContextMenu,
          "Expected stage context menu to render.",
        );
        const detachStart = (
          menu.props as { onDetachConnectorFrom?: () => void }
        ).onDetachConnectorFrom;
        assert.equal(typeof detachStart, "function");
        detachStart?.();

        const connector = currentDeck.slides[0]?.children.find(
          (node) => node.id === "detach-connector" && node.type === "connector",
        );
        assert.ok(connector && connector.type === "connector");
        assert.equal(connector.content.from.kind, "point");
        if (connector.content.from.kind === "point") {
          assert.deepEqual(connector.content.from.point, { x: 0, y: 0 });
        }
      }),
    );
  });

  describe("SlideEditorVNext semantic hit testing parity", () => {
    test("semantic click selects covered text under a large covering shape", () => {
      withMockHTMLElement((createElement) =>
        withPointerWindow((listeners) => {
          const hookRenderer = createHookRenderer();
          let currentDeck = buildDeckV7([
            buildSlideV7(
              "content",
              [
                buildTextNode({
                  id: "covered-text",
                  layout: { frame: { x: 10, y: 40, w: 80, h: 20 }, zIndex: 1 },
                  content: {
                    paragraphs: [
                      {
                        id: "covered-text-p1",
                        text: "Quarterly revenue growth reached 37 percent.",
                      },
                    ],
                  },
                }),
                buildShapeNode({
                  id: "cover-shape",
                  layout: { frame: { x: 0, y: 0, w: 100, h: 100 }, zIndex: 20 },
                  content: { shape: "rect" },
                }),
              ],
              { id: "slide-overlap", name: "Slide 1" },
            ),
          ]);

          const renderTree = () =>
            hookRenderer.run(() =>
              SlideEditorVNext({
                documentId: "doc-semantic-click",
                deck: currentDeck,
                onDeckChange: (nextDeck) => {
                  currentDeck = nextDeck;
                },
              }),
            );

          let tree = renderTree();
          clickNode(tree, listeners, createElement, "cover-shape", {
            clientX: 220,
            clientY: 450,
            canvasRect: { left: 100, top: 200, width: 1000, height: 500 },
          });

          tree = renderTree();
          const updatedCanvas = findRequiredElement(
            tree,
            (element) => element.type === SlideCanvasVNext,
            "Expected updated stage canvas.",
          );
          const selection = (
            updatedCanvas.props as {
              selection?: { nodeIds?: ReadonlySet<string> };
            }
          ).selection;
          assert.ok(
            selection?.nodeIds?.has("covered-text"),
            "Expected semantic click to select the covered text node.",
          );
        }),
      );
    });

    test("Alt+] cycles to covered nodes for select-under parity", async () => {
      await withWindow(async () =>
        withMockHTMLElement((createElement) =>
          withPointerWindow((listeners) => {
            const hookRenderer = createHookRenderer();
            let currentDeck = buildDeckV7([
              buildSlideV7(
                "content",
                [
                  buildTextNode({
                    id: "covered-text",
                    layout: {
                      frame: { x: 10, y: 40, w: 80, h: 20 },
                      zIndex: 1,
                    },
                    content: {
                      paragraphs: [
                        {
                          id: "covered-text-p1",
                          text: "Quarterly revenue growth reached 37 percent.",
                        },
                      ],
                    },
                  }),
                  buildShapeNode({
                    id: "cover-shape",
                    layout: {
                      frame: { x: 0, y: 0, w: 100, h: 100 },
                      zIndex: 20,
                    },
                    content: { shape: "rect" },
                  }),
                ],
                { id: "slide-select-under", name: "Slide 1" },
              ),
            ]);

            const renderTree = () =>
              hookRenderer.run(() =>
                SlideEditorVNext({
                  documentId: "doc-select-under",
                  deck: currentDeck,
                  onDeckChange: (nextDeck) => {
                    currentDeck = nextDeck;
                  },
                }),
              );

            let tree = renderTree();
            clickNode(tree, listeners, createElement, "cover-shape", {
              clientX: 500,
              clientY: 300,
              canvasRect: { left: 100, top: 200, width: 1000, height: 500 },
            });

            tree = renderTree();
            const editorRoot = findRequiredElement(
              tree,
              (element) =>
                element.type === "div" &&
                (element.props as { "data-slide-editor-vnext"?: string })[
                  "data-slide-editor-vnext"
                ] === "true" &&
                typeof (element.props as { onKeyDown?: unknown }).onKeyDown ===
                  "function",
              "Expected editor root keydown handler.",
            );
            const onEditorKeyDown = (
              editorRoot.props as {
                onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
              }
            ).onKeyDown;
            assert.ok(onEditorKeyDown, "Expected editor keydown handler.");
            let prevented = false;
            onEditorKeyDown?.({
              key: "]",
              altKey: true,
              target: createElement(),
              preventDefault: () => {
                prevented = true;
              },
            } as unknown as KeyboardEvent<HTMLDivElement>);

            tree = renderTree();
            const updatedCanvas = findRequiredElement(
              tree,
              (element) => element.type === SlideCanvasVNext,
              "Expected stage canvas after Alt+] cycle.",
            );
            const selection = (
              updatedCanvas.props as {
                selection?: { nodeIds?: ReadonlySet<string> };
              }
            ).selection;
            assert.equal(
              prevented,
              true,
              "Expected Alt+] keydown to be handled.",
            );
            assert.ok(
              selection?.nodeIds?.has("covered-text"),
              "Expected Alt+] to cycle to the covered text node.",
            );
          }),
        ),
      );
    });
  });
});
