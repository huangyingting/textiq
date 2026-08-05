import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  Children,
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { NodeContentPanel } from "./node-content-panel";
import { SelectMenu, type SelectMenuOption } from "@/components/ui/select-menu";
import type { SlideChildNode, TableContent } from "@/lib/presentation/schema";
import { createReactRenderHarness } from "@/test/react-render-harness";

type ElementWithProps = ReactElement<Record<string, unknown>>;

function withMockUseState<T>(callback: () => T): T {
  return createReactRenderHarness({
    idPrefix: "node-content-panel-test-id",
    message: "React internals are required for hook dispatcher tests",
  }).run(callback);
}

function elements(root: ReactNode): ElementWithProps[] {
  const found: ElementWithProps[] = [];
  function visit(node: ReactNode): void {
    Children.forEach(node, (child) => {
      if (!isValidElement(child)) return;
      const element = child as ElementWithProps;
      found.push(element);
      visit(element.props.children as ReactNode);
    });
  }
  visit(root);
  return found;
}

function textContent(node: ReactNode): string {
  let text = "";

  Children.forEach(node, (child) => {
    if (typeof child === "string" || typeof child === "number") {
      text += child;
      return;
    }

    if (isValidElement(child)) {
      text += textContent(
        (child as ElementWithProps).props.children as ReactNode,
      );
    }
  });

  return text;
}

function clickButton(root: ReactNode, label: string): void {
  const button = elements(root).find((element) => {
    const props = element.props as {
      children?: ReactNode;
      disabled?: boolean;
      onClick?: () => void;
      type?: string;
    };
    return (
      props.type === "button" &&
      props.disabled !== true &&
      props.onClick !== undefined &&
      textContent(props.children).trim() === label
    );
  });

  assert.ok(button, `Expected to find enabled ${label} button`);
  (button.props as { onClick: () => void }).onClick();
}

function invokeHandlers(root: ReactNode): number {
  let count = 0;
  for (const element of elements(root)) {
    const props = element.props as {
      disabled?: boolean;
      onChange?: (event: {
        currentTarget: { value: string; checked: boolean };
      }) => void;
      onClick?: () => void;
    };
    if (props.onChange) {
      props.onChange({
        currentTarget: { value: "12", checked: true },
      });
      count += 1;
    }
    if (props.onClick && props.disabled !== true) {
      props.onClick();
      count += 1;
    }
  }
  return count;
}

function renderPanel(node: SlideChildNode) {
  return renderToStaticMarkup(
    createElement(NodeContentPanel, {
      node,
      onUpdateContent: () => undefined,
      assetResolver: (assetId) => `https://assets.example/${assetId}.png`,
      onReplaceImage: () => undefined,
    }),
  );
}

function baseNode(node: Record<string, unknown>): SlideChildNode {
  return {
    role: "body",
    layout: { frame: { x: 10, y: 10, w: 30, h: 20 }, zIndex: 1 },
    ...node,
  } as SlideChildNode;
}

describe("NodeContentPanel render coverage", () => {
  test("renders text and shape editors", () => {
    const textHtml = renderPanel(
      baseNode({
        id: "text-1",
        type: "text",
        content: {
          paragraphs: [
            { id: "p1", text: "First line" },
            { id: "p2", text: "Second line" },
          ],
        },
      }),
    );
    assert.match(textHtml, /First line/);
    assert.match(textHtml, /Second line/);
    assert.match(textHtml, /Text content\s*<textarea/);

    const shapeNode = baseNode({
      id: "shape-1",
      type: "shape",
      content: { shape: "diamond" },
    });
    const shapeHtml = renderPanel(shapeNode);
    // SelectMenu renders a closed button showing only the selected label, so
    // assert the selected shape is visible and inspect the element tree for the
    // Shape select with its full option list.
    assert.match(shapeHtml, /diamond/);
    const shapeElement = withMockUseState(() =>
      NodeContentPanel({
        node: shapeNode,
        onUpdateContent: () => undefined,
      }),
    );
    const shapeSelect = elements(shapeElement).find(
      (element) =>
        element.type === SelectMenu && element.props["aria-label"] === "Shape",
    );
    assert.ok(shapeSelect);
    assert.equal(shapeSelect.props.value, "diamond");
    const shapeOptions = shapeSelect.props
      .options as readonly SelectMenuOption[];
    assert.ok(shapeOptions.some((option) => option.value === "diamond"));
  });

  test("renders image replace affordances with fit, alt, crop, and debug ids", () => {
    const html = renderPanel(
      baseNode({
        id: "image-1",
        type: "image",
        content: {
          assetId: "img-1",
          fit: "contain",
          alt: "Uploaded hero",
          crop: { top: 1, right: 2, bottom: 3, left: 4 },
        },
      }),
    );

    assert.match(html, /src="https:\/\/assets.example\/img-1.png"/);
    assert.match(html, /alt="Uploaded hero"/);
    assert.match(html, /Crop top/);
    assert.match(html, /Reset crop/);
    assert.match(html, /contain/);
    assert.match(html, /Debug identifiers/);
    assert.match(html, /Image snapshot is available/);
  });

  test("renders visual replace affordances, status, and debug ids", () => {
    const html = renderPanel(
      baseNode({
        id: "visual-1",
        type: "visual",
        content: {
          visualId: "doc-visual-1",
          assetId: "visual-asset-1",
          alt: "Revenue chart",
          transparentBackground: true,
        },
      }),
    );

    assert.match(html, /Replace visual/);
    assert.match(html, /Linked visual with snapshot asset/);
    assert.match(html, /Debug identifiers/);
    assert.match(html, /Revenue chart/);
    assert.match(html, /Transparent background/);
  });

  test("renders table grid controls and destructive safeguards", () => {
    const html = renderPanel(
      baseNode({
        id: "table-1",
        type: "table",
        content: {
          columns: [
            { id: "col-1", label: "Metric" },
            { id: "col-2", label: "Value" },
          ],
          rows: [
            { id: "row-1", cells: [{ text: "NPS" }, { text: "72" }] },
            { id: "row-2", cells: [{ text: "Growth" }, { text: "15%" }] },
          ],
          header: true,
          caption: "Quarterly metrics",
        },
      }),
    );

    assert.match(html, /Metric/);
    assert.match(html, /Row 1 cell 1/);
    assert.match(html, /Insert row before/);
    assert.match(html, /Delete target column/);
    assert.match(html, /Quarterly metrics/);
    assert.match(html, /Header row/);
  });

  test("renders point and node connector endpoint controls", () => {
    const pointHtml = renderPanel(
      baseNode({
        id: "connector-1",
        type: "connector",
        content: {
          from: { kind: "point", point: { x: 10, y: 20 } },
          to: { kind: "point", point: { x: 90, y: 80 } },
          routing: "curved",
        },
      }),
    );
    assert.match(pointHtml, /Routing/);
    assert.match(pointHtml, /from x/);
    assert.match(pointHtml, /to y/);

    const nodeHtml = renderPanel(
      baseNode({
        id: "connector-2",
        type: "connector",
        content: {
          from: { kind: "node", nodeId: "node-a", anchor: "right" },
          to: { kind: "node", nodeId: "node-b", anchor: "left" },
          routing: "elbow",
        },
      }),
    );
    assert.match(nodeHtml, /from node id/);
    assert.match(nodeHtml, /node-a/);
    assert.match(nodeHtml, /from anchor/);
    assert.match(nodeHtml, /right/);
  });

  test("renders group fallback copy", () => {
    const html = renderPanel(
      baseNode({
        id: "group-1",
        type: "group",
        children: [],
      }),
    );

    assert.match(html, /Group children are edited on the stage/);
  });

  test("wires text, shape, image, and visual content handlers", () => {
    const updates: unknown[] = [];
    const text = withMockUseState(() =>
      NodeContentPanel({
        node: baseNode({
          id: "text-1",
          type: "text",
          content: { paragraphs: [{ id: "p1", text: "First line" }] },
        }),
        onUpdateContent: (patch) => updates.push(patch),
      }),
    );
    const shape = withMockUseState(() =>
      NodeContentPanel({
        node: baseNode({
          id: "shape-1",
          type: "shape",
          content: { shape: "rect" },
        }),
        onUpdateContent: (patch) => updates.push(patch),
      }),
    );
    const image = withMockUseState(() =>
      NodeContentPanel({
        node: baseNode({
          id: "image-1",
          type: "image",
          content: {
            assetId: "img-1",
            fit: "cover",
            alt: "Hero",
            crop: { top: 1, right: 2, bottom: 3, left: 4 },
          },
        }),
        assetResolver: (assetId) => `https://assets.example/${assetId}.png`,
        onReplaceImage: () => updates.push("replace-image"),
        onUpdateContent: (patch) => updates.push(patch),
      }),
    );
    const visual = withMockUseState(() =>
      NodeContentPanel({
        node: baseNode({
          id: "visual-1",
          type: "visual",
          content: {
            visualId: "chart-1",
            assetId: "visual-asset-1",
            alt: "Chart",
            transparentBackground: false,
          },
        }),
        onReplaceVisual: () => updates.push("replace-visual"),
        onUpdateContent: (patch) => updates.push(patch),
      }),
    );

    assert.ok(invokeHandlers(text) >= 1);
    assert.ok(invokeHandlers(shape) >= 1);
    assert.ok(invokeHandlers(image) >= 7);
    assert.ok(invokeHandlers(visual) >= 3);
    assert.ok(
      updates.some(
        (patch) =>
          typeof patch === "object" &&
          patch !== null &&
          "transparentBackground" in patch,
      ),
    );
    assert.ok(updates.includes("replace-image"));
    assert.ok(updates.includes("replace-visual"));
  });

  test("uses unique ids when bottom add follows a middle table delete", () => {
    const updates: Record<string, unknown>[] = [];
    const originalNow = Date.now;
    Date.now = () => Number.parseInt("3", 36);

    try {
      const table = withMockUseState(() =>
        NodeContentPanel({
          node: baseNode({
            id: "table-1",
            type: "table",
            content: {
              columns: [
                { id: "table-1-col-1", label: "Metric" },
                { id: "table-1-col-3", label: "Value" },
              ],
              rows: [
                {
                  id: "table-1-row-1",
                  cells: [{ text: "NPS" }, { text: "72" }],
                },
                {
                  id: "table-1-row-3",
                  cells: [{ text: "Growth" }, { text: "15%" }],
                },
              ],
            },
          }),
          onUpdateContent: (patch) => updates.push(patch),
        }),
      );

      clickButton(table, "Add row");
      clickButton(table, "Add column");
    } finally {
      Date.now = originalNow;
    }

    const rowUpdate = updates[0] as TableContent;
    const rowIds = rowUpdate.rows.map((row) => row.id);
    assert.equal(rowIds.length, new Set(rowIds).size);
    assert.equal(rowIds[rowIds.length - 1], "table-1-row-3-1");

    const columnUpdate = updates[1] as TableContent;
    const columnIds = columnUpdate.columns.map((column) => column.id);
    assert.equal(columnIds.length, new Set(columnIds).size);
    assert.equal(columnIds[columnIds.length - 1], "table-1-col-3-1");
  });

  test("wires table and connector structural handlers", () => {
    const updates: unknown[] = [];
    const table = withMockUseState(() =>
      NodeContentPanel({
        node: baseNode({
          id: "table-1",
          type: "table",
          content: {
            columns: [
              { id: "col-1", label: "Metric" },
              { id: "col-2", label: "Value" },
            ],
            rows: [
              { id: "row-1", cells: [{ text: "NPS" }, { text: "72" }] },
              { id: "row-2", cells: [{ text: "Growth" }, { text: "15%" }] },
            ],
            header: false,
            caption: "Metrics",
          },
        }),
        onUpdateContent: (patch) => updates.push(patch),
      }),
    );
    const pointConnector = withMockUseState(() =>
      NodeContentPanel({
        node: baseNode({
          id: "connector-1",
          type: "connector",
          content: {
            from: { kind: "point", point: { x: 10, y: 20 } },
            to: { kind: "point", point: { x: 90, y: 80 } },
            routing: "straight",
          },
        }),
        onUpdateContent: (patch) => updates.push(patch),
      }),
    );
    const nodeConnector = withMockUseState(() =>
      NodeContentPanel({
        node: baseNode({
          id: "connector-2",
          type: "connector",
          content: {
            from: { kind: "node", nodeId: "node-a", anchor: "left" },
            to: { kind: "node", nodeId: "node-b", anchor: "right" },
            routing: "elbow",
          },
        }),
        onUpdateContent: (patch) => updates.push(patch),
      }),
    );

    assert.ok(invokeHandlers(table) >= 16);
    assert.ok(invokeHandlers(pointConnector) >= 5);
    assert.ok(invokeHandlers(nodeConnector) >= 5);
    assert.ok(
      updates.some(
        (patch) =>
          typeof patch === "object" &&
          patch !== null &&
          "columns" in patch &&
          "rows" in patch,
      ),
    );
    assert.ok(
      updates.some(
        (patch) =>
          typeof patch === "object" && patch !== null && "routing" in patch,
      ),
    );
  });
});
