import assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as React from "react";
import type { ReactNode } from "react";

import {
  buildDeck,
  buildSlide,
  buildTextNode,
} from "@/test/builders/presentation-deck";
import { SlideCanvas } from "./slide-canvas";
import { SlideEditor } from "./slide-editor";
import {
  createHookRenderer,
  findRequiredElement,
  flattenText,
  focusNode,
  nodePointerDownFrom,
  withMockHTMLElement,
  withPointerWindow,
} from "./slide-editor-failure-test-utils";

function reactPointerEvent(event: object): React.PointerEvent {
  return event as React.PointerEvent;
}

describe("SlideEditor stage gesture failures", () => {
  test("moving a node shows the live position badge", () => {
    withMockHTMLElement((createElement) =>
      withPointerWindow((listeners) => {
        const hookRenderer = createHookRenderer();
        const currentDeck = buildDeck([
          buildSlide(
            "content",
            [
              buildTextNode({
                id: "badge-move-node",
                layout: { frame: { x: 20, y: 20, w: 30, h: 12 }, zIndex: 1 },
              }),
            ],
            { id: "slide-badge-move", name: "Slide 1" },
          ),
        ]);

        const renderTree = () =>
          hookRenderer.run(() =>
            SlideEditor({
              documentId: "doc-badge-move",
              deck: currentDeck,
              onDeckChange: () => undefined,
            }),
          );

        let tree = renderTree();
        const stageCanvas = findRequiredElement(
          tree,
          (element) => element.type === SlideCanvas,
          "Expected stage canvas to render.",
        );
        const onNodePointerDown = (
          stageCanvas.props as {
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

        onNodePointerDown(
          "badge-move-node",
          reactPointerEvent({
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
          }),
        );
        listeners.get("pointermove")?.({
          clientX: 250,
          clientY: 220,
          altKey: true,
        } as PointerEvent);

        tree = renderTree();
        const badge = findRequiredElement(
          tree,
          (element) =>
            element.type === "div" &&
            (element.props as { "data-stage-gesture-badge"?: string })[
              "data-stage-gesture-badge"
            ] === "true",
          "Expected live move badge.",
        );
        assert.equal(flattenText(badge), "25, 22");
      }),
    );
  });

  test("dragging a preselected overlapping node moves it instead of the selected node", () => {
    withMockHTMLElement((createElement) =>
      withPointerWindow((listeners) => {
        const hookRenderer = createHookRenderer();
        let currentDeck = buildDeck([
          buildSlide(
            "content",
            [
              buildTextNode({
                id: "selected-under",
                layout: { frame: { x: 20, y: 20, w: 30, h: 12 }, zIndex: 1 },
              }),
              buildTextNode({
                id: "preselected-over",
                layout: { frame: { x: 20, y: 20, w: 30, h: 12 }, zIndex: 2 },
              }),
            ],
            { id: "slide-overlap-drag", name: "Slide 1" },
          ),
        ]);

        const renderTree = () =>
          hookRenderer.run(() =>
            SlideEditor({
              documentId: "doc-overlap-drag",
              deck: currentDeck,
              onDeckChange: (nextDeck) => {
                currentDeck = nextDeck;
              },
            }),
          );

        let tree = renderTree();
        focusNode(tree, "selected-under");

        tree = renderTree();
        const canvasElement = createElement({
          rect: { left: 0, top: 0, width: 1000, height: 1000 },
        });
        const currentTarget = createElement({
          closestMap: {
            '[data-slide-canvas="true"]': canvasElement,
          },
        });
        nodePointerDownFrom(tree)(
          "preselected-over",
          reactPointerEvent({
            button: 0,
            pointerId: 1,
            clientX: 250,
            clientY: 250,
            shiftKey: false,
            metaKey: false,
            ctrlKey: false,
            altKey: false,
            target: currentTarget,
            currentTarget,
            preventDefault: () => undefined,
            stopPropagation: () => undefined,
          }),
        );
        listeners.get("pointermove")?.({
          clientX: 350,
          clientY: 250,
          altKey: false,
          shiftKey: false,
        } as PointerEvent);
        listeners.get("pointerup")?.({
          clientX: 350,
          clientY: 250,
        } as PointerEvent);

        const [selectedUnder, preselectedOver] =
          currentDeck.slides[0]?.children ?? [];
        assert.equal(selectedUnder?.id, "selected-under");
        assert.equal(preselectedOver?.id, "preselected-over");
        assert.equal(selectedUnder?.layout?.frame.x, 20);
        assert.equal(preselectedOver?.layout?.frame.x, 30);
      }),
    );
  });

  test("alt-dragging a node duplicates it at the drop point", () => {
    withMockHTMLElement((createElement) =>
      withPointerWindow((listeners) => {
        const hookRenderer = createHookRenderer();
        let currentDeck = buildDeck([
          buildSlide(
            "content",
            [
              buildTextNode({
                id: "alt-drag-source",
                layout: { frame: { x: 20, y: 20, w: 30, h: 12 }, zIndex: 1 },
              }),
            ],
            { id: "slide-alt-drag", name: "Slide 1" },
          ),
        ]);

        const renderTree = () =>
          hookRenderer.run(() =>
            SlideEditor({
              documentId: "doc-alt-drag",
              deck: currentDeck,
              onDeckChange: (nextDeck) => {
                currentDeck = nextDeck;
              },
            }),
          );
        const stageCanvasFrom = (root: ReactNode) =>
          findRequiredElement(
            root,
            (element) => element.type === SlideCanvas,
            "Expected stage canvas to render.",
          );

        let tree = renderTree();
        const stageCanvas = stageCanvasFrom(tree);
        const onNodePointerDown = (
          stageCanvas.props as {
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
        onNodePointerDown(
          "alt-drag-source",
          reactPointerEvent({
            button: 0,
            pointerId: 1,
            clientX: 200,
            clientY: 200,
            shiftKey: false,
            metaKey: false,
            ctrlKey: false,
            altKey: true,
            target: currentTarget,
            currentTarget,
            preventDefault: () => undefined,
            stopPropagation: () => undefined,
          }),
        );
        listeners.get("pointermove")?.({
          clientX: 350,
          clientY: 260,
          altKey: true,
          shiftKey: false,
        } as PointerEvent);
        listeners.get("pointerup")?.({
          clientX: 350,
          clientY: 260,
        } as PointerEvent);

        const children = currentDeck.slides[0]?.children ?? [];
        assert.equal(
          children.length,
          2,
          "Expected the original plus one duplicate.",
        );
        const original = children.find((node) => node.id === "alt-drag-source");
        assert.ok(original);
        assert.deepEqual(
          original.layout?.frame,
          { x: 20, y: 20, w: 30, h: 12 },
          "Expected the original to stay in place.",
        );
        const duplicate = children.find(
          (node) => node.id !== "alt-drag-source",
        );
        assert.ok(duplicate, "Expected a duplicate node to be created.");
        const frame = duplicate.layout?.frame;
        assert.ok(frame);
        assert.ok(
          frame.x > 20 && frame.y > 20,
          "Expected the duplicate to land at the moved position.",
        );

        tree = renderTree();
        const updatedStageCanvas = stageCanvasFrom(tree);
        const selectedNodeIds = (
          updatedStageCanvas.props as {
            selection?: { nodeIds?: ReadonlySet<string> };
          }
        ).selection?.nodeIds;
        assert.equal(
          selectedNodeIds?.has(duplicate.id),
          true,
          "Expected the duplicate to become selected.",
        );
      }),
    );
  });

  test("resizing a node shows the live size badge", () => {
    withMockHTMLElement((createElement) =>
      withPointerWindow((listeners) => {
        const hookRenderer = createHookRenderer();
        const currentDeck = buildDeck([
          buildSlide(
            "content",
            [
              buildTextNode({
                id: "badge-resize-node",
                layout: { frame: { x: 20, y: 20, w: 30, h: 12 }, zIndex: 1 },
              }),
            ],
            { id: "slide-badge-resize", name: "Slide 1" },
          ),
        ]);

        const renderTree = () =>
          hookRenderer.run(() =>
            SlideEditor({
              documentId: "doc-badge-resize",
              deck: currentDeck,
              onDeckChange: () => undefined,
            }),
          );

        let tree = renderTree();
        const stageCanvas = findRequiredElement(
          tree,
          (element) => element.type === SlideCanvas,
          "Expected stage canvas to render.",
        );
        const onResizeHandlePointerDown = (
          stageCanvas.props as {
            onResizeHandlePointerDown?: (
              nodeId: string,
              handle: "se",
              event: React.PointerEvent,
            ) => void;
          }
        ).onResizeHandlePointerDown;
        assert.ok(onResizeHandlePointerDown);
        const canvasElement = createElement({
          rect: { left: 0, top: 0, width: 1000, height: 1000 },
        });
        const currentTarget = createElement({
          closestMap: {
            '[data-slide-canvas="true"]': canvasElement,
          },
        });

        onResizeHandlePointerDown(
          "badge-resize-node",
          "se",
          reactPointerEvent({
            button: 0,
            pointerId: 1,
            clientX: 500,
            clientY: 320,
            altKey: false,
            target: currentTarget,
            currentTarget,
            preventDefault: () => undefined,
            stopPropagation: () => undefined,
          }),
        );
        listeners.get("pointermove")?.({
          clientX: 550,
          clientY: 350,
          altKey: true,
        } as PointerEvent);

        tree = renderTree();
        const badge = findRequiredElement(
          tree,
          (element) =>
            element.type === "div" &&
            (element.props as { "data-stage-gesture-badge"?: string })[
              "data-stage-gesture-badge"
            ] === "true",
          "Expected live resize badge.",
        );
        assert.equal(flattenText(badge), "35 × 15");
      }),
    );
  });
});
