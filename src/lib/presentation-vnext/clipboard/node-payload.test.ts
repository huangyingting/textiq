import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { SlideChildNode } from "../schema";
import {
  parseTextIqNodePayload,
  resolveTextIqNodePaste,
  serializeTextIqNodePayload,
  textIqNodePlainTextFallback,
  TEXTIQ_NODE_CLIPBOARD_KIND,
  TEXTIQ_NODE_CLIPBOARD_MAX_BYTES,
  TEXTIQ_NODE_CLIPBOARD_MIME,
  TEXTIQ_NODE_CLIPBOARD_SCHEMA_VERSION,
  TEXTIQ_NODE_CLIPBOARD_VERSION,
} from "./node-payload";

const textNode: SlideChildNode = {
  id: "text-1",
  type: "text",
  name: "Headline",
  role: "title",
  slot: "title",
  layout: {
    frame: { x: 1, y: 2, w: 30, h: 12 },
    zIndex: 3,
    rotation: 5,
    autoHeight: true,
    flipX: false,
    flipY: false,
    anchor: "topLeft",
    constraints: {
      minW: 5,
      minH: 2,
      maxW: 90,
      maxH: 80,
      preserveAspectRatio: false,
    },
  },
  style: { ref: "text.title" },
  localStyle: { text: { color: "#111111" } },
  locked: false,
  hidden: false,
  accessibility: { label: "Headline" },
  source: { documentId: "doc-1", extra: { copied: true } },
  content: {
    paragraphs: [
      {
        id: "paragraph-1",
        text: "Hello TextIQ",
        runs: [
          {
            text: "Hello",
            bold: true,
            italic: false,
            underline: false,
            strikethrough: false,
            code: false,
            link: "https://example.com",
            localStyle: { color: "#111111" },
          },
        ],
        list: { kind: "number", indent: 1, numberStyle: "decimal" },
      },
    ],
    fit: "auto-height",
    language: "en",
  },
};

const nodes: SlideChildNode[] = [
  textNode,
  {
    id: "image-1",
    type: "image",
    content: {
      assetId: "asset-image-1",
      crop: { top: 0, right: 1, bottom: 2, left: 3 },
      fit: "cover",
      focalPoint: { x: 50, y: 45 },
      alt: "Image alt",
    },
  },
  {
    id: "shape-1",
    type: "shape",
    content: { shape: "path", path: "M 0 0 L 1 1" },
  },
  {
    id: "connector-1",
    type: "connector",
    content: {
      from: { kind: "point", point: { x: 10, y: 10 } },
      to: { kind: "node", nodeId: "shape-1", anchor: "center" },
      routing: "elbow",
    },
  },
  {
    id: "table-1",
    type: "table",
    content: {
      columns: [{ id: "column-1", label: "Column", width: 40 }],
      rows: [
        { id: "row-1", cells: [{ text: "Cell", runs: [{ text: "Cell" }] }] },
      ],
      header: true,
      caption: "Table caption",
    },
  },
  {
    id: "visual-1",
    type: "visual",
    content: {
      assetId: "asset-visual-1",
      visualId: "visual-source-1",
      transparentBackground: true,
      alt: "Visual alt",
    },
  },
  {
    id: "group-1",
    type: "group",
    component: "custom",
    children: [
      { id: "group-child-1", type: "shape", content: { shape: "rect" } },
    ],
  },
];

function payloadWith(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    kind: TEXTIQ_NODE_CLIPBOARD_KIND,
    version: TEXTIQ_NODE_CLIPBOARD_VERSION,
    schemaVersion: TEXTIQ_NODE_CLIPBOARD_SCHEMA_VERSION,
    nodes,
    ...overrides,
  });
}

describe("TextIQ node clipboard payload", () => {
  test("serializes and parses versioned v7 node payloads", () => {
    const serialized = serializeTextIqNodePayload(nodes);
    const raw = JSON.parse(serialized) as Record<string, unknown>;

    assert.equal(TEXTIQ_NODE_CLIPBOARD_MIME, "application/x-textiq-nodes+json");
    assert.equal(raw.kind, TEXTIQ_NODE_CLIPBOARD_KIND);
    assert.equal(raw.version, 1);
    assert.equal(raw.schemaVersion, 7);

    const parsed = parseTextIqNodePayload(serialized);
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.ok ? parsed.nodes : [], nodes);
    assert.notEqual(parsed.ok ? parsed.nodes : [], nodes);
  });

  test("rejects malformed, incompatible, and oversized payloads safely", () => {
    assert.equal(parseTextIqNodePayload("not-json").ok, false);
    assert.equal(parseTextIqNodePayload("[]").ok, false);
    assert.equal(
      parseTextIqNodePayload(payloadWith({ extra: true })).ok,
      false,
    );
    assert.equal(
      parseTextIqNodePayload(payloadWith({ kind: "other" })).ok,
      false,
    );
    assert.equal(parseTextIqNodePayload(payloadWith({ version: 2 })).ok, false);
    assert.equal(
      parseTextIqNodePayload(payloadWith({ schemaVersion: 8 })).ok,
      false,
    );
    assert.equal(parseTextIqNodePayload(payloadWith({ nodes: [] })).ok, false);
    assert.equal(
      parseTextIqNodePayload("x".repeat(TEXTIQ_NODE_CLIPBOARD_MAX_BYTES + 1))
        .ok,
      false,
    );
  });

  test("rejects invalid node shapes before serializing or parsing", () => {
    const invalidNodes = [
      [{ ...textNode, id: "" }],
      [{ ...textNode, unknown: true }],
      [{ id: "bad", type: "shape", content: { shape: "hexagon" } }],
      [{ id: "bad", type: "image", content: { assetId: "" } }],
      [
        {
          id: "bad",
          type: "connector",
          content: {
            from: { kind: "node", nodeId: "a", anchor: "bad" },
            to: { kind: "point", point: { x: 0, y: 0 } },
          },
        },
      ],
      [
        {
          id: "bad",
          type: "table",
          content: { columns: [{ id: "", label: "" }], rows: [] },
        },
      ],
      [{ id: "bad", type: "visual", content: { assetId: 1 } }],
      [{ id: "bad", type: "group", component: "unknown", children: [] }],
    ];

    for (const candidate of invalidNodes) {
      assert.equal(
        parseTextIqNodePayload(payloadWith({ nodes: candidate })).ok,
        false,
      );
      assert.throws(() =>
        serializeTextIqNodePayload(candidate as SlideChildNode[]),
      );
    }
  });

  test("chooses OS TextIQ payloads before in-memory nodes and rejects invalid OS payloads", () => {
    const osPayload = serializeTextIqNodePayload([nodes[0]]);
    const fromOs = resolveTextIqNodePaste(osPayload, [nodes[1]]);
    assert.equal(fromOs.source, "os");
    assert.deepEqual(fromOs.nodes, [nodes[0]]);

    const fromMemory = resolveTextIqNodePaste(null, [nodes[1]]);
    assert.equal(fromMemory.source, "memory");
    assert.deepEqual(fromMemory.nodes, [nodes[1]]);
    assert.notEqual(fromMemory.nodes, [nodes[1]]);

    const invalid = resolveTextIqNodePaste(payloadWith({ version: 99 }), [
      nodes[1],
    ]);
    assert.equal(invalid.source, "invalid");
    assert.deepEqual(invalid.nodes, []);

    assert.equal(resolveTextIqNodePaste(undefined, []).source, "none");
  });

  test("builds a plain-text fallback without exposing raw JSON", () => {
    assert.equal(
      textIqNodePlainTextFallback([textNode]),
      "1 TextIQ node\nHello TextIQ",
    );
    assert.equal(
      textIqNodePlainTextFallback([nodes[1], nodes[2]]),
      "2 TextIQ nodes",
    );
  });
});
