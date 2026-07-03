import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { KeyboardEvent, ReactNode } from "react";

import {
  buildDeck,
  buildImageNode,
  buildSlide,
  buildTextNode,
} from "@/test/builders/presentation-deck";
import { SlideCanvas } from "./slide-canvas";
import { SlideEditor } from "./slide-editor";
import {
  clickNode,
  createHookRenderer,
  findRequiredElement,
  flattenText,
  focusNode,
  withMockHTMLElement,
  withPointerWindow,
  withWindow,
} from "./slide-editor-failure-test-utils";

function reactKeyboardEvent<T = Element>(event: object): KeyboardEvent<T> {
  return event as KeyboardEvent<T>;
}

describe("SlideEditor toolbar command surface failures", () => {
  test("bare c connects exactly two selected nodes", async () => {
    await withWindow(() =>
      withMockHTMLElement((createElement) =>
        withPointerWindow((listeners) => {
          const hookRenderer = createHookRenderer();
          let currentDeck = buildDeck([
            buildSlide(
              "content",
              [
                buildTextNode({
                  id: "connect-a",
                  layout: { frame: { x: 10, y: 10, w: 12, h: 12 }, zIndex: 1 },
                }),
                buildTextNode({
                  id: "connect-b",
                  layout: { frame: { x: 60, y: 10, w: 12, h: 12 }, zIndex: 2 },
                }),
              ],
              { id: "slide-connect-pair", name: "Slide 1" },
            ),
          ]);

          const renderTree = () =>
            hookRenderer.run(() =>
              SlideEditor({
                documentId: "doc-connect-pair",
                deck: currentDeck,
                onDeckChange: (nextDeck) => {
                  currentDeck = nextDeck;
                },
              }),
            );
          const editorRootFrom = (root: ReactNode) =>
            findRequiredElement(
              root,
              (element) =>
                element.type === "div" &&
                (element.props as { "data-slide-editor"?: string })[
                  "data-slide-editor"
                ] === "true" &&
                typeof (element.props as { onKeyDown?: unknown }).onKeyDown ===
                  "function",
              "Expected editor root with keydown handler.",
            );

          let tree = renderTree();
          focusNode(tree, "connect-a");
          tree = renderTree();
          clickNode(tree, listeners, createElement, "connect-b", {
            clientX: 660,
            clientY: 160,
            shiftKey: true,
          });

          tree = renderTree();
          const onKeyDown = (
            editorRootFrom(tree).props as {
              onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
            }
          ).onKeyDown;
          assert.ok(onKeyDown);
          let prevented = false;
          onKeyDown(
            reactKeyboardEvent<HTMLDivElement>({
              key: "c",
              ctrlKey: false,
              metaKey: false,
              altKey: false,
              shiftKey: false,
              target: null,
              preventDefault: () => {
                prevented = true;
              },
            }),
          );

          assert.equal(prevented, true);
          const connector = currentDeck.slides[0]?.children.find(
            (node) => node.type === "connector",
          );
          assert.ok(connector);
          assert.equal(connector.content.from.kind, "node");
          assert.equal(connector.content.to.kind, "node");
          if (connector.content.from.kind === "node") {
            assert.equal(connector.content.from.nodeId, "connect-a");
          }
          if (connector.content.to.kind === "node") {
            assert.equal(connector.content.to.nodeId, "connect-b");
          }
        }),
      ),
    );
  });

  test("bare c starts connector mode and Enter confirms target", async () => {
    await withWindow(() => {
      const hookRenderer = createHookRenderer();
      let currentDeck = buildDeck([
        buildSlide(
          "content",
          [
            buildTextNode({
              id: "connect-source",
              layout: { frame: { x: 10, y: 10, w: 12, h: 12 }, zIndex: 1 },
            }),
            buildTextNode({
              id: "connect-target",
              layout: { frame: { x: 60, y: 10, w: 12, h: 12 }, zIndex: 2 },
            }),
          ],
          { id: "slide-connect-mode", name: "Slide 1" },
        ),
      ]);

      const renderTree = () =>
        hookRenderer.run(() =>
          SlideEditor({
            documentId: "doc-connect-mode",
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
      const keyDownFrom = (root: ReactNode) =>
        (
          findRequiredElement(
            root,
            (element) =>
              element.type === "div" &&
              (element.props as { "data-slide-editor"?: string })[
                "data-slide-editor"
              ] === "true" &&
              typeof (element.props as { onKeyDown?: unknown }).onKeyDown ===
                "function",
            "Expected editor root with keydown handler.",
          ).props as {
            onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
          }
        ).onKeyDown;

      let tree = renderTree();
      focusNode(tree, "connect-source");

      tree = renderTree();
      keyDownFrom(tree)?.(
        reactKeyboardEvent<HTMLDivElement>({
          key: "c",
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          shiftKey: false,
          target: null,
          preventDefault: () => undefined,
        }),
      );

      tree = renderTree();
      const selection = (
        stageCanvasFrom(tree).props as {
          selection?: { nodeIds?: ReadonlySet<string> };
        }
      ).selection;
      assert.ok(selection?.nodeIds?.has("connect-source"));
      assert.ok(selection?.nodeIds?.has("connect-target"));

      keyDownFrom(tree)?.(
        reactKeyboardEvent<HTMLDivElement>({
          key: "Enter",
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          shiftKey: false,
          target: null,
          preventDefault: () => undefined,
        }),
      );

      const connector = currentDeck.slides[0]?.children.find(
        (node) => node.type === "connector",
      );
      assert.ok(connector);
      assert.equal(connector.content.from.kind, "node");
      assert.equal(connector.content.to.kind, "node");
    });
  });

  test("bare c cycles the selected connector end anchor", async () => {
    await withWindow(() => {
      const hookRenderer = createHookRenderer();
      let currentDeck = buildDeck([
        buildSlide(
          "content",
          [
            buildTextNode({
              id: "anchor-a",
              layout: { frame: { x: 10, y: 10, w: 12, h: 12 }, zIndex: 1 },
            }),
            buildTextNode({
              id: "anchor-b",
              layout: { frame: { x: 60, y: 10, w: 12, h: 12 }, zIndex: 2 },
            }),
            {
              id: "anchor-connector",
              type: "connector" as const,
              role: "connector" as const,
              layout: { frame: { x: 22, y: 16, w: 38, h: 1 }, zIndex: 3 },
              style: { ref: "connector.primary" as const },
              content: {
                from: {
                  kind: "node" as const,
                  nodeId: "anchor-a",
                  anchor: "right" as const,
                },
                to: {
                  kind: "node" as const,
                  nodeId: "anchor-b",
                  anchor: "left" as const,
                },
                routing: "straight" as const,
              },
            },
          ],
          { id: "slide-anchor-cycle", name: "Slide 1" },
        ),
      ]);

      const renderTree = () =>
        hookRenderer.run(() =>
          SlideEditor({
            documentId: "doc-anchor-cycle",
            deck: currentDeck,
            onDeckChange: (nextDeck) => {
              currentDeck = nextDeck;
            },
          }),
        );
      let tree = renderTree();
      focusNode(tree, "anchor-connector");

      tree = renderTree();
      const editorRoot = findRequiredElement(
        tree,
        (element) =>
          element.type === "div" &&
          (element.props as { "data-slide-editor"?: string })[
            "data-slide-editor"
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
      onKeyDown(
        reactKeyboardEvent<HTMLDivElement>({
          key: "c",
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          shiftKey: false,
          target: null,
          preventDefault: () => undefined,
        }),
      );

      const connector = currentDeck.slides[0]?.children.find(
        (node) => node.id === "anchor-connector" && node.type === "connector",
      );
      assert.ok(connector && connector.type === "connector");
      assert.equal(connector.content.to.kind, "node");
      if (connector.content.to.kind === "node") {
        assert.equal(connector.content.to.anchor, "right");
      }
    });
  });

  test("supports keyboard rotation with shifted bracket shortcuts", () => {
    withMockHTMLElement(() => {
      const hookRenderer = createHookRenderer();
      let currentDeck = buildDeck(
        [
          buildSlide(
            "content",
            [
              buildImageNode("img-001", {
                id: "image-primary",
                name: "Primary image",
                layout: { frame: { x: 12, y: 16, w: 36, h: 48 }, zIndex: 1 },
              }),
            ],
            { id: "slide-rotation", name: "Slide 1" },
          ),
        ],
        { title: "Keyboard rotation deck" },
      );

      const renderTree = () =>
        hookRenderer.run(() =>
          SlideEditor({
            documentId: "doc-rotation",
            deck: currentDeck,
            onDeckChange: (nextDeck) => {
              currentDeck = nextDeck;
            },
          }),
        );

      let tree = renderTree();
      focusNode(tree, "image-primary");

      tree = renderTree();
      const editorRoot = findRequiredElement(
        tree,
        (element) =>
          element.type === "div" &&
          (element.props as { "data-slide-editor"?: string })[
            "data-slide-editor"
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
      onKeyDown?.(
        reactKeyboardEvent<HTMLDivElement>({
          key: "{",
          shiftKey: true,
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          target: null,
          preventDefault: () => {
            prevented = true;
          },
        }),
      );

      assert.equal(prevented, true);
      const rotatedNode = currentDeck.slides[0]?.children[0];
      assert.ok(rotatedNode?.layout);
      assert.equal(rotatedNode.layout.rotation, -1);

      tree = renderTree();
      const stageLiveRegion = findRequiredElement(
        tree,
        (element) =>
          element.type === "div" &&
          (element.props as { "aria-live"?: string })["aria-live"] ===
            "polite" &&
          flattenText(element).includes("Rotated Primary image to 359°"),
        "Expected keyboard rotation announcement in the stage live region.",
      );
      assert.match(
        flattenText(stageLiveRegion),
        /Rotated Primary image to 359°/,
      );
    });
  });
});
