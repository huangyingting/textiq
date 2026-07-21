import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type {
  ConnectorContent,
  SlideChildNode,
  SlideNode,
  TableContent,
  TextContent,
} from "@/lib/presentation/schema";
import type { StylePatch } from "@/lib/presentation/style-schema";

import {
  deleteTableColumn,
  deleteTableRow,
  emptyTableRow,
  insertTableColumn,
  insertTableRow,
  nextImageCrop,
  textContentFromValue,
  textValue,
  updateConnectorPoint,
  updateTableCell,
} from "./node-content-panel";
import { nextFrameForPatch } from "./node-geometry-panel";
import {
  connectorStrokeColor,
  solidFillColor,
  strokeColor,
  tableFillColor,
} from "./local-style-panel";
import {
  parseFiniteNumberInput,
  sanitizeBoundedNumber,
} from "./numeric-sanitization";
import {
  slideAccentColor,
  slideBackgroundAssetId,
  slideBackgroundColor,
  slideBackgroundColorPatch,
  slideBackgroundPatchForType,
  slideBackgroundPreviewAsset,
  slideBackgroundSecondaryColor,
  slideBackgroundSecondaryColorPatch,
  slideSourceWithPatch,
} from "./slide-settings-panel";
import { sourceStatus, sourceWithPatch } from "./node-source-panel";
import { flattenLayers, layerLabel } from "./layers-panel";

const table: TableContent = {
  columns: [
    { id: "c1", label: "Metric" },
    { id: "c2", label: "Value" },
  ],
  rows: [
    { id: "r1", cells: [{ text: "ARR" }, { text: "$12M" }] },
    { id: "r2", cells: [{ text: "NRR" }, { text: "118%" }] },
  ],
};

describe("inspector panel pure helpers", () => {
  test("converts text content to and from textarea values", () => {
    const content: TextContent = {
      paragraphs: [
        { id: "p1", text: "First" },
        { id: "p2", text: "Second" },
      ],
    };

    assert.equal(textValue(content), "First\nSecond");
    assert.deepEqual(textContentFromValue("One\nTwo", "node-1"), {
      paragraphs: [
        { id: "node-1-p-1", text: "One" },
        { id: "node-1-p-2", text: "Two" },
      ],
    });
  });

  test("updates table cells, rows, and columns without mutating the original table", () => {
    assert.equal(
      updateTableCell(table, 0, 1, "$13M").rows[0].cells[1].text,
      "$13M",
    );
    assert.equal(
      updateTableCell(table, 9, 0, "ignored").rows[0].cells[0].text,
      "ARR",
    );
    assert.deepEqual(emptyTableRow(table, "new-row"), {
      id: "new-row",
      cells: [{ text: "" }, { text: "" }],
    });

    const insertedBefore = insertTableRow(table, 0, "before", "table-1");
    const insertedAfter = insertTableRow(table, 99, "after", "table-1");
    assert.equal(insertedBefore.rows.length, 3);
    assert.equal(insertedBefore.rows[0].id.startsWith("table-1-row-"), true);
    assert.equal(insertedAfter.rows[2].id.startsWith("table-1-row-"), true);
    assert.equal(deleteTableRow(table, 0).rows.length, 1);
    assert.equal(
      deleteTableRow({ ...table, rows: [table.rows[0]] }, 0).rows.length,
      1,
    );

    const colBefore = insertTableColumn(table, 0, "before", "table-1");
    const colAfter = insertTableColumn(table, 99, "after", "table-1");
    assert.equal(colBefore.columns[0].id.startsWith("table-1-col-"), true);
    assert.equal(colBefore.rows[0].cells.length, 3);
    assert.equal(colAfter.columns[2].label, "Column 3");
    assert.deepEqual(
      deleteTableColumn(table, 1).columns.map((col) => col.id),
      ["c1"],
    );
    assert.equal(
      deleteTableColumn({ ...table, columns: [table.columns[0]] }, 0).columns
        .length,
      1,
    );
    assert.equal(table.rows[0].cells[1].text, "$12M");
  });

  test("generates unique table row and column ids after deletes and repeated inserts", () => {
    const originalNow = Date.now;
    Date.now = () => Number.parseInt("k", 36);
    try {
      const collisionProneTable: TableContent = {
        columns: [
          { id: "table-1-col-k", label: "Metric" },
          { id: "table-1-col-old", label: "Prior" },
          { id: "table-1-col-k-1", label: "Value" },
        ],
        rows: [
          {
            id: "table-1-row-k",
            cells: [{ text: "A" }, { text: "B" }, { text: "C" }],
          },
          {
            id: "table-1-row-old",
            cells: [{ text: "D" }, { text: "E" }, { text: "F" }],
          },
          {
            id: "table-1-row-k-1",
            cells: [{ text: "G" }, { text: "H" }, { text: "I" }],
          },
        ],
      };
      const afterMiddleRowDelete = deleteTableRow(collisionProneTable, 1);
      const afterMiddleColumnDelete = deleteTableColumn(
        afterMiddleRowDelete,
        1,
      );

      const withInsertedRows = [
        "before",
        "after",
        "after",
      ].reduce<TableContent>(
        (current, position, index) =>
          insertTableRow(
            current,
            index,
            position as "before" | "after",
            "table-1",
          ),
        afterMiddleColumnDelete,
      );
      const rowIds = withInsertedRows.rows.map((row) => row.id);
      assert.equal(rowIds.length, new Set(rowIds).size);
      assert.deepEqual(rowIds, [
        "table-1-row-k-2",
        "table-1-row-k",
        "table-1-row-k-3",
        "table-1-row-k-4",
        "table-1-row-k-1",
      ]);

      const withInsertedColumns = [
        "before",
        "after",
        "after",
      ].reduce<TableContent>(
        (current, position, index) =>
          insertTableColumn(
            current,
            index,
            position as "before" | "after",
            "table-1",
          ),
        afterMiddleColumnDelete,
      );
      const columnIds = withInsertedColumns.columns.map((column) => column.id);
      assert.equal(columnIds.length, new Set(columnIds).size);
      assert.deepEqual(columnIds, [
        "table-1-col-k-2",
        "table-1-col-k",
        "table-1-col-k-3",
        "table-1-col-k-4",
        "table-1-col-k-1",
      ]);
      assert.ok(
        withInsertedColumns.rows.every(
          (row) => row.cells.length === withInsertedColumns.columns.length,
        ),
      );
    } finally {
      Date.now = originalNow;
    }
  });

  test("updates connector point endpoints only when the endpoint is a point", () => {
    const connector: ConnectorContent = {
      from: { kind: "point", point: { x: 10, y: 20 } },
      to: { kind: "node", nodeId: "node-1", anchor: "right" },
    };

    assert.deepEqual(updateConnectorPoint(connector, "from", "x", 42).from, {
      kind: "point",
      point: { x: 42, y: 20 },
    });
    assert.deepEqual(updateConnectorPoint(connector, "from", "x", 120).from, {
      kind: "point",
      point: { x: 100, y: 20 },
    });
    assert.deepEqual(updateConnectorPoint(connector, "from", "y", -5).from, {
      kind: "point",
      point: { x: 10, y: 0 },
    });
    assert.equal(
      updateConnectorPoint(connector, "from", "x", Number.POSITIVE_INFINITY),
      connector,
    );
    assert.equal(updateConnectorPoint(connector, "to", "y", 99), connector);
  });

  test("preserves aspect ratio while applying geometry frame patches", () => {
    const layout = {
      frame: { x: 10, y: 20, w: 40, h: 20 },
      zIndex: 1,
      constraints: { preserveAspectRatio: true },
    };

    assert.deepEqual(nextFrameForPatch(layout, { w: 80 }), {
      x: 10,
      y: 20,
      w: 80,
      h: 40,
    });
    assert.deepEqual(nextFrameForPatch(layout, { h: 10 }), {
      x: 10,
      y: 20,
      w: 20,
      h: 10,
    });
    assert.deepEqual(
      nextFrameForPatch({ ...layout, constraints: undefined }, { w: 80 }),
      { x: 10, y: 20, w: 80, h: 20 },
    );
    assert.deepEqual(
      nextFrameForPatch(
        {
          frame: { x: 0, y: 0, w: 0, h: 0 },
          zIndex: 1,
          constraints: layout.constraints,
        },
        { w: 10 },
      ),
      { x: 0, y: 0, w: 10, h: 0.5 },
    );
    assert.deepEqual(nextFrameForPatch(layout, { w: 180, x: 120, y: -20 }), {
      x: 0,
      y: 0,
      w: 100,
      h: 90,
    });
    assert.deepEqual(
      nextFrameForPatch(layout, { x: Number.NaN, h: Number.POSITIVE_INFINITY }),
      {
        x: 10,
        y: 20,
        w: 40,
        h: 20,
      },
    );
  });

  test("clamps crop edits and rejects invalid crop values", () => {
    assert.deepEqual(nextImageCrop(undefined, "left", 20), {
      top: 0,
      right: 0,
      bottom: 0,
      left: 20,
    });
    assert.deepEqual(
      nextImageCrop({ top: 5, right: 4, bottom: 3, left: 2 }, "top", 120),
      {
        top: 95,
        right: 4,
        bottom: 3,
        left: 2,
      },
    );
    assert.equal(nextImageCrop(undefined, "right", Number.NaN), undefined);
  });

  test("reads local style color fallbacks for style panels", () => {
    const style: StylePatch = {
      fill: { type: "solid", color: "#ffffff" },
      stroke: { color: "#111111", widthPt: 1 },
      connector: { stroke: { color: "#222222", widthPt: 2 } },
      table: { headerFill: { type: "solid", color: "#f8fafc" } },
    };

    assert.equal(solidFillColor(style), "#ffffff");
    assert.equal(solidFillColor(undefined), "#ffffff");
    assert.equal(strokeColor(style), "#111111");
    assert.equal(strokeColor(undefined), "#111111");
    assert.equal(connectorStrokeColor(style), "#222222");
    assert.equal(connectorStrokeColor(undefined), "#111111");
    assert.equal(tableFillColor(style.table?.headerFill, "#000000"), "#f8fafc");
    assert.equal(tableFillColor({ type: "pattern" }, "#000000"), "#000000");
    assert.equal(tableFillColor(undefined, "#000000"), "#000000");
  });

  test("parses finite numeric input and clamps bounded style values", () => {
    assert.equal(parseFiniteNumberInput(""), undefined);
    assert.equal(parseFiniteNumberInput("Infinity"), undefined);
    assert.equal(parseFiniteNumberInput("14.5"), 14.5);
    assert.equal(sanitizeBoundedNumber(Number.NaN, 0, 1), undefined);
    assert.equal(sanitizeBoundedNumber(-2, 0, 1), 0);
    assert.equal(sanitizeBoundedNumber(2, 0, 1), 1);
    assert.equal(sanitizeBoundedNumber(0.6, 0, 1), 0.6);
  });

  test("builds slide settings source and background patches", () => {
    const slide: SlideNode = {
      id: "slide-1",
      type: "slide",
      template: { kind: "cover" },
      style: { ref: "slide.cover" },
      source: {
        documentId: "doc-1",
        blockId: "block-1",
        blockKind: "text",
        contentHash: "hash-1",
        linkedAt: "2026-06-30T00:00:00.000Z",
        unlinked: true,
      },
      localStyle: {
        slide: {
          background: {
            type: "linearGradient",
            from: "#111111",
            to: "#222222",
            angle: 90,
          },
          accent: "#38bdf8",
        },
      },
      children: [],
    };
    const radialSlide: SlideNode = {
      ...slide,
      localStyle: {
        slide: {
          background: {
            type: "radialGradient",
            inner: "#333333",
            outer: "#444444",
          },
        },
      },
    };
    const imageSlide: SlideNode = {
      ...slide,
      localStyle: {
        slide: { background: { type: "image", assetId: "asset-1" } },
      },
    };
    const blankSlide: SlideNode = {
      ...slide,
      source: undefined,
      localStyle: undefined,
    };

    assert.equal(slideBackgroundColor(slide), "#111111");
    assert.equal(slideBackgroundSecondaryColor(slide), "#222222");
    assert.equal(slideBackgroundColor(radialSlide), "#333333");
    assert.equal(slideBackgroundSecondaryColor(radialSlide), "#444444");
    assert.equal(slideBackgroundColor(blankSlide), "#ffffff");
    assert.equal(slideBackgroundSecondaryColor(blankSlide), "#f3f4f6");
    assert.equal(slideBackgroundAssetId(imageSlide), "asset-1");
    assert.equal(slideBackgroundAssetId(blankSlide), "");
    assert.equal(
      slideBackgroundPreviewAsset(imageSlide, (assetId) =>
        assetId === "asset-1" ? "https://example.com/asset-1.png" : undefined,
      ),
      "https://example.com/asset-1.png",
    );
    assert.equal(slideBackgroundPreviewAsset(imageSlide), undefined);
    assert.equal(slideAccentColor(slide), "#38bdf8");
    assert.equal(slideAccentColor(blankSlide), "#ffffff");
    assert.deepEqual(slideSourceWithPatch(slide, { blockId: "block-2" }), {
      documentId: "doc-1",
      blockId: "block-2",
      blockKind: "text",
      contentHash: "hash-1",
      linkedAt: "2026-06-30T00:00:00.000Z",
      unlinked: true,
    });
    assert.equal(
      slideBackgroundPatchForType(slide, "linearGradient").slide?.background
        ?.type,
      "linearGradient",
    );
    assert.equal(
      slideBackgroundPatchForType(slide, "radialGradient").slide?.background
        ?.type,
      "radialGradient",
    );
    assert.equal(
      slideBackgroundPatchForType(imageSlide, "image").slide?.background?.type,
      "image",
    );
    assert.equal(
      slideBackgroundPatchForType(slide, "solid").slide?.background?.type,
      "solid",
    );
    assert.equal(
      slideBackgroundColorPatch(slide, "#555555").slide?.background?.type,
      "linearGradient",
    );
    assert.equal(
      slideBackgroundColorPatch(radialSlide, "#555555").slide?.background?.type,
      "radialGradient",
    );
    assert.deepEqual(slideBackgroundColorPatch(blankSlide, "#555555"), {
      slide: { background: { type: "solid", color: "#555555" } },
    });
    assert.equal(
      slideBackgroundSecondaryColorPatch(slide, "#666666").slide?.background
        ?.type,
      "linearGradient",
    );
    assert.equal(
      slideBackgroundSecondaryColorPatch(radialSlide, "#666666").slide
        ?.background?.type,
      "radialGradient",
    );
    assert.deepEqual(
      slideBackgroundSecondaryColorPatch(blankSlide, "#666666"),
      {},
    );
  });

  test("builds node source status and patches", () => {
    const source = {
      documentId: "doc-1",
      blockId: "block-1",
      blockKind: "visual" as const,
      contentHash: "hash-1",
      linkedAt: "2026-06-30T00:00:00.000Z",
    };

    assert.equal(sourceStatus(undefined), "Standalone");
    assert.equal(sourceStatus({ ...source, unlinked: true }), "Unlinked");
    assert.equal(
      sourceStatus(source, {
        slideId: "slide-1",
        slideIndex: 0,
        nodeId: "node-1",
        nodeType: "visual",
        source,
        state: "stale",
        reason: "Dismissed for this block hash.",
        dismissed: true,
      }),
      "Dismissed",
    );
    assert.equal(sourceStatus(source), "Linked");
    assert.equal(sourceStatus({ documentId: "", blockId: "" }), "Draft link");
    assert.deepEqual(
      sourceWithPatch(source, { blockId: "block-2", unlinked: true }),
      {
        documentId: "doc-1",
        blockId: "block-2",
        blockKind: "visual",
        contentHash: "hash-1",
        linkedAt: "2026-06-30T00:00:00.000Z",
        unlinked: true,
      },
    );
    assert.deepEqual(
      sourceWithPatch(
        {
          ...source,
          extra: { sourceReviewDismissal: { currentHash: "hash-2" } },
        },
        { blockId: "block-2" },
      ).extra,
      { sourceReviewDismissal: { currentHash: "hash-2" } },
    );
  });

  test("labels and flattens layer nodes", () => {
    const nodes: SlideChildNode[] = [
      {
        id: "text-empty",
        type: "text",
        content: { paragraphs: [{ id: "p1", text: "  " }] },
      },
      {
        id: "shape-1",
        type: "shape",
        content: { shape: "diamond" },
        hidden: true,
      },
      {
        id: "image-1",
        type: "image",
        content: { assetId: "asset-1", alt: "Alt" },
      },
      { id: "visual-1", type: "visual", content: { visualId: "chart-1" } },
      { id: "table-1", type: "table", content: table },
      {
        id: "connector-1",
        type: "connector",
        content: {
          from: { kind: "point", point: { x: 0, y: 0 } },
          to: { kind: "point", point: { x: 100, y: 100 } },
        },
      },
      {
        id: "group-1",
        type: "group",
        component: "custom",
        name: "Group",
        children: [
          {
            id: "text-nested",
            type: "text",
            content: { paragraphs: [{ id: "p2", text: "Nested text" }] },
          },
        ],
      },
    ];

    assert.deepEqual(nodes.map(layerLabel), [
      "Text",
      "diamond shape",
      "Alt",
      "chart-1",
      "Table",
      "Connector",
      "Group",
    ]);
    assert.deepEqual(
      flattenLayers(nodes).map(({ node, depth }) => [node.id, depth]),
      [
        ["text-empty", 0],
        ["shape-1", 0],
        ["image-1", 0],
        ["visual-1", 0],
        ["table-1", 0],
        ["connector-1", 0],
        ["group-1", 0],
        ["text-nested", 1],
      ],
    );
  });
});
