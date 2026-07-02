import { test } from "node:test";
import assert from "node:assert/strict";
import * as React from "react";

import { LayersPanel } from "./layers-panel";
import type { ResolvedRenderNode } from "@/lib/presentation-vnext/render-tree";
import type { SlideChildNode } from "@/lib/presentation-vnext/schema";
import { createServerRenderHarness } from "@/test/react-server-renderer";

type ElementWithProps = React.ReactElement<Record<string, unknown>>;

function elements(root: React.ReactNode): ElementWithProps[] {
  const found: ElementWithProps[] = [];
  function visit(node: React.ReactNode): void {
    React.Children.forEach(node, (child) => {
      if (!React.isValidElement(child)) return;
      const element = child as ElementWithProps;
      found.push(element);
      visit(element.props.children as React.ReactNode);
    });
  }
  visit(root);
  return found;
}

function createStatefulRenderer<T>(renderComponent: () => T): () => T {
  const renderer = createServerRenderHarness({
    idPrefix: "layer-panel-test-id",
    requireInternals: false,
  });
  return () => {
    return renderer.run(renderComponent);
  };
}

function userTextNode({
  id = "user-node",
  name = "Original name",
}: {
  id?: string;
  name?: string;
} = {}): SlideChildNode {
  return {
    id,
    type: "text",
    role: "body",
    name,
    layout: { frame: { x: 0, y: 0, w: 20, h: 10 }, zIndex: 2 },
    content: { paragraphs: [{ id: "p1", text: "Body copy" }] },
  };
}

function decorationNode(): ResolvedRenderNode {
  return {
    id: "theme-decoration",
    type: "group",
    layout: { frame: { x: 0, y: 0, w: 20, h: 10 }, zIndex: 1 },
    style: {},
    content: { type: "group" },
    source: "themeDecoration",
  };
}

test("LayersPanel renames user layers and keeps generated layers read-only", () => {
  const updates: Array<
    [string, { name?: string; locked?: boolean; hidden?: boolean }]
  > = [];
  const renderPanel = createStatefulRenderer(() =>
    LayersPanel({
      nodes: [userTextNode()],
      decorations: [decorationNode()],
      selectedIds: [],
      onSelectNode: () => undefined,
      onUpdateNode: (id, patch) => updates.push([id, patch]),
    }),
  );

  let panel = renderPanel();
  const renameButtons = elements(panel).filter((element) => {
    const label = element.props["aria-label"];
    return typeof label === "string" && label.startsWith("Rename layer ");
  });
  assert.equal(renameButtons.length, 1);

  const renameButtonClick = renameButtons[0]?.props["onClick"];
  assert.equal(typeof renameButtonClick, "function");
  (
    renameButtonClick as (event: {
      preventDefault: () => void;
      stopPropagation: () => void;
    }) => void
  )({
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
  });

  panel = renderPanel();
  let renameInput = elements(panel).find(
    (element) =>
      element.type === "input" &&
      element.props["aria-label"] === "Rename layer",
  );
  assert.ok(renameInput);
  (
    renameInput.props["onChange"] as (event: {
      currentTarget: { value: string };
    }) => void
  )({
    currentTarget: { value: "  Renamed layer  " },
  });

  panel = renderPanel();
  renameInput = elements(panel).find(
    (element) =>
      element.type === "input" &&
      element.props["aria-label"] === "Rename layer",
  );
  assert.ok(renameInput);
  (
    renameInput.props["onKeyDown"] as (event: {
      key: string;
      preventDefault: () => void;
      stopPropagation: () => void;
    }) => void
  )({
    key: "Enter",
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
  });

  assert.deepEqual(updates, [["user-node", { name: "Renamed layer" }]]);

  panel = renderPanel();
  const rowKeyDown = elements(panel).find(
    (element) => element.props["data-layer-source"] === "user",
  )?.props["onKeyDown"];
  assert.equal(typeof rowKeyDown, "function");
  (
    rowKeyDown as (event: {
      key: string;
      preventDefault: () => void;
      stopPropagation: () => void;
    }) => void
  )({
    key: "F2",
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
  });

  panel = renderPanel();
  renameInput = elements(panel).find(
    (element) =>
      element.type === "input" &&
      element.props["aria-label"] === "Rename layer",
  );
  assert.ok(renameInput);
});

test("LayersPanel enters rename mode on label double click", () => {
  const renderPanel = createStatefulRenderer(() =>
    LayersPanel({
      nodes: [
        userTextNode({ id: "double-click-node", name: "Double click me" }),
      ],
      selectedIds: [],
      onSelectNode: () => undefined,
      onUpdateNode: () => undefined,
    }),
  );

  let panel = renderPanel();
  const labelDoubleClick = elements(panel).find(
    (element) =>
      element.type === "button" &&
      element.props["children"] === "Double click me" &&
      typeof element.props["onDoubleClick"] === "function",
  )?.props["onDoubleClick"];
  assert.equal(typeof labelDoubleClick, "function");
  (
    labelDoubleClick as (event: {
      preventDefault: () => void;
      stopPropagation: () => void;
    }) => void
  )({
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
  });

  panel = renderPanel();
  const renameInput = elements(panel).find(
    (element) =>
      element.type === "input" &&
      element.props["aria-label"] === "Rename layer",
  );
  assert.ok(renameInput);
});
