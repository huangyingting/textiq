import { test } from "node:test";
import assert from "node:assert/strict";
import * as React from "react";

import { LayersPanel } from "./layers-panel";
import type { ResolvedRenderNode } from "@/lib/presentation/render-tree";
import type { SlideChildNode } from "@/lib/presentation/schema";
import { createReactRenderHarness } from "@/test/react-render-harness";

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
  const renderer = createReactRenderHarness({
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
  zIndex = 2,
}: {
  id?: string;
  name?: string;
  zIndex?: number;
} = {}): SlideChildNode {
  return {
    id,
    type: "text",
    role: "body",
    name,
    layout: { frame: { x: 0, y: 0, w: 20, h: 10 }, zIndex },
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

test("LayersPanel lists foreground-to-background using canonical visual order", () => {
  const nestedChild = userTextNode({
    id: "nested-later-low-z",
    name: "Nested later",
    zIndex: -900,
  });
  const group: SlideChildNode = {
    id: "group",
    type: "group",
    component: "custom",
    name: "Group",
    layout: { frame: { x: 0, y: 0, w: 30, h: 20 }, zIndex: 500 },
    children: [
      userTextNode({
        id: "nested-first-high-z",
        name: "Nested first",
        zIndex: 900,
      }),
      nestedChild,
    ],
  };
  const renderPanel = createStatefulRenderer(() =>
    LayersPanel({
      nodes: [
        group,
        userTextNode({
          id: "later-sibling-low-z",
          name: "Later sibling",
          zIndex: -1000,
        }),
      ],
      selectedIds: [],
      onSelectNode: () => undefined,
      onUpdateNode: () => undefined,
    }),
  );
  const panel = renderPanel();

  const labels = elements(panel)
    .filter(
      (element) =>
        element.type === "button" && typeof element.props.children === "string",
    )
    .map((element) => element.props.children);
  assert.deepEqual(labels, [
    "Nested first",
    "Nested later",
    "Group",
    "Later sibling",
  ]);
});

test("LayersPanel moves a child only within its group sibling positions", () => {
  const reorders: Array<[string, number]> = [];
  const group: SlideChildNode = {
    id: "reorder-group",
    type: "group",
    component: "custom",
    layout: { frame: { x: 0, y: 0, w: 30, h: 20 }, zIndex: 10 },
    children: [
      userTextNode({ id: "group-back", name: "Group back", zIndex: 1 }),
      userTextNode({ id: "group-front", name: "Group front", zIndex: 2 }),
    ],
  };
  const renderPanel = createStatefulRenderer(() =>
    LayersPanel({
      nodes: [
        userTextNode({ id: "root-back", name: "Root back", zIndex: 1 }),
        group,
      ],
      selectedIds: ["group-back"],
      onSelectNode: () => undefined,
      onUpdateNode: () => undefined,
      onReorderNode: (id, targetIndex) => reorders.push([id, targetIndex]),
    }),
  );
  const panel = renderPanel();
  const row = elements(panel).find(
    (element) => element.props["data-layer-id"] === "group-back",
  );
  assert.ok(row);
  const moveForward = elements(row).find(
    (element) => element.props["aria-label"] === "Move layer forward",
  );
  assert.ok(moveForward);
  assert.equal(moveForward.props.disabled, false);

  (moveForward.props.onClick as () => void)();

  assert.deepEqual(reorders, [["group-back", 1]]);
});

test("LayersPanel keeps hidden groups and descendants available for management", () => {
  const hiddenChild = {
    ...userTextNode({ id: "hidden-child", name: "Hidden child" }),
    hidden: true,
  };
  const hiddenGroup: SlideChildNode = {
    id: "hidden-group",
    type: "group",
    component: "custom",
    name: "Hidden group",
    hidden: true,
    layout: { frame: { x: 0, y: 0, w: 30, h: 20 }, zIndex: 2 },
    children: [hiddenChild],
  };
  const updates: Array<
    [string, { name?: string; locked?: boolean; hidden?: boolean }]
  > = [];
  const renderPanel = createStatefulRenderer(() =>
    LayersPanel({
      nodes: [hiddenGroup],
      selectedIds: [],
      onSelectNode: () => undefined,
      onUpdateNode: (id, patch) => updates.push([id, patch]),
    }),
  );
  const panel = renderPanel();
  const panelElements = elements(panel);
  const labels = panelElements
    .filter(
      (element) =>
        element.type === "button" && typeof element.props.children === "string",
    )
    .map((element) => element.props.children);

  assert.deepEqual(labels, ["Hidden child", "Hidden group"]);

  const showGroup = panelElements.find(
    (element) => element.props["aria-label"] === 'Show layer "Hidden group"',
  )?.props["onClick"];
  const showChild = panelElements.find(
    (element) => element.props["aria-label"] === 'Show layer "Hidden child"',
  )?.props["onClick"];
  assert.equal(typeof showGroup, "function");
  assert.equal(typeof showChild, "function");
  (showGroup as () => void)();
  (showChild as () => void)();
  assert.deepEqual(updates, [
    ["hidden-group", { hidden: false }],
    ["hidden-child", { hidden: false }],
  ]);
});
