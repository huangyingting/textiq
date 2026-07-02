import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { SlideChildNode } from "../schema";
import {
  buildTextIqNodeCopyOutPayload,
  clipboardImageNodeFromUpload,
  clipboardTextNode,
  parseTextIqNodePayload,
  resolveExternalTextIqNodePaste,
  resolveTextIqNodePaste,
  sanitizedClipboardHtmlToText,
  serializeTextIqNodePayload,
  textIqNodeHtmlFallback,
  textIqNodePlainTextFallback,
  TEXTIQ_NODE_CLIPBOARD_KIND,
  TEXTIQ_NODE_CLIPBOARD_MAX_BYTES,
  TEXTIQ_NODE_CLIPBOARD_MAX_TEXT_CHARS,
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
      parseTextIqNodePayload(payloadWith({ nodes: "not-array" })).ok,
      false,
    );
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
      [
        {
          ...textNode,
          layout: { frame: { x: 0, y: 0, w: 1 }, zIndex: 1 },
        },
      ],
      [
        {
          ...textNode,
          layout: {
            frame: { x: 0, y: 0, w: 1, h: 1 },
            zIndex: 1,
            anchor: "bad",
          },
        },
      ],
      [
        {
          ...textNode,
          layout: {
            frame: { x: 0, y: 0, w: 1, h: 1 },
            zIndex: 1,
            constraints: { minW: "wide" },
          },
        },
      ],
      [
        {
          ...textNode,
          content: {
            paragraphs: [{ id: "bad-list", text: "x", list: { kind: "bad" } }],
          },
        },
      ],
      [
        {
          ...textNode,
          content: {
            paragraphs: [{ id: "bad-run", text: "x", runs: [{ text: 1 }] }],
          },
        },
      ],
      [{ id: "bad", type: "connector", content: { from: { kind: "bad" } } }],
      [
        {
          id: "bad",
          type: "table",
          content: {
            columns: [{ id: "column", label: "Column" }],
            rows: [{ id: "row", cells: [{ text: 1 }] }],
          },
        },
      ],
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

  test("orders external paste sources before the in-memory node buffer", () => {
    const osPayload = serializeTextIqNodePayload([nodes[0]]);
    assert.equal(
      resolveExternalTextIqNodePaste({
        osPayload,
        hasImage: true,
        html: "<p>HTML</p>",
        plainText: "plain",
        memoryNodes: [nodes[1]],
      }).source,
      "os",
    );
    assert.equal(
      resolveExternalTextIqNodePaste({
        hasImage: true,
        html: "<p>HTML</p>",
        plainText: "plain",
        memoryNodes: [nodes[1]],
      }).source,
      "image",
    );
    assert.equal(
      resolveExternalTextIqNodePaste({
        html: "<p>HTML</p>",
        plainText: "plain",
        memoryNodes: [nodes[1]],
      }).source,
      "html",
    );
    assert.equal(
      resolveExternalTextIqNodePaste({
        plainText: "plain",
        memoryNodes: [nodes[1]],
      }).source,
      "plain-text",
    );
    assert.equal(
      resolveExternalTextIqNodePaste({ memoryNodes: [nodes[1]] }).source,
      "memory",
    );
  });

  test("uploads clipboard images through a mocked boundary before creating image nodes", async () => {
    const pasted = await clipboardImageNodeFromUpload(
      { type: "image/png", size: 12 },
      25,
      async (image) => {
        assert.equal(image.type, "image/png");
        return { assetId: "asset-from-upload", alt: "clipboard-image.png" };
      },
    );

    assert.equal(pasted.type, "image");
    assert.deepEqual(pasted.layout, {
      frame: { x: 18, y: 18, w: 40, h: 28 },
      zIndex: 25,
    });
    assert.deepEqual(pasted.content, {
      assetId: "asset-from-upload",
      alt: "clipboard-image.png",
    });
  });

  test("converts sanitized HTML into text nodes and strips dangerous markup", () => {
    const text = sanitizedClipboardHtmlToText(
      '<p>Hello <strong>safe</strong></p><script>alert("x")</script><img src=x onerror=alert(1)>',
    );
    assert.match(text, /Hello\s+safe/);
    assert.equal(text.includes("alert"), false);
    assert.equal(text.includes("onerror"), false);

    const node = clipboardTextNode(
      "<h1>Title</h1><p>Body &amp; details &#x2713; &#10003; &unknown;</p><style>.x{color:red}</style>",
      42,
      { html: true },
    );
    assert.equal(node?.type, "text");
    assert.equal(node?.layout?.zIndex, 42);
    assert.deepEqual(
      node?.type === "text"
        ? node.content.paragraphs.map((paragraph) => paragraph.text)
        : [],
      ["Title", "Body & details ✓ ✓ &unknown;"],
    );
  });

  test("normalizes and limits plain text into v7 text node paragraphs", () => {
    const node = clipboardTextNode("First line\r\nSecond line\n\nThird", 9);
    assert.equal(node?.type, "text");
    assert.deepEqual(
      node?.type === "text"
        ? node.content.paragraphs.map((paragraph) => paragraph.text)
        : [],
      ["First line", "Second line", "Third"],
    );
    assert.equal(clipboardTextNode(" \n\t ", 1), null);

    const oversized = clipboardTextNode(
      `${"x".repeat(TEXTIQ_NODE_CLIPBOARD_MAX_TEXT_CHARS + 5)}\ntruncated`,
      1,
    );
    assert.equal(
      oversized?.type === "text"
        ? oversized.content.paragraphs[0]?.text.length
        : 0,
      TEXTIQ_NODE_CLIPBOARD_MAX_TEXT_CHARS,
    );
    const exact = clipboardTextNode("short", 1);
    assert.equal(
      exact?.type === "text" ? exact.content.paragraphs[0]?.text : "",
      "short",
    );
  });

  test("handles invalid and edge-case HTML entity decoding", () => {
    const text = sanitizedClipboardHtmlToText(
      "<p>&nbsp;&apos;&#x110000;&#99999999;&AMP;</p>",
    );

    assert.match(text, / '/);
    assert.match(text, /&#x110000;/);
    assert.match(text, /&#99999999;/);
    assert.match(text, /&/);
  });

  test("builds a plain-text fallback without exposing raw JSON", () => {
    assert.equal(
      textIqNodePlainTextFallback([textNode]),
      "1 TextIQ node\nHello TextIQ",
    );
    assert.equal(
      textIqNodePlainTextFallback([nodes[1], nodes[2]]),
      "2 TextIQ nodes\nImage alt",
    );
  });

  test("builds sanitized HTML and aggregate copy-out payloads", () => {
    const html = textIqNodeHtmlFallback([
      {
        ...textNode,
        content: {
          paragraphs: [{ id: "xss", text: '<script>alert("x")</script>' }],
        },
      },
      nodes[1],
    ]);

    assert.match(html, /data-textiq-copy="nodes"/);
    assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
    assert.doesNotMatch(html, /asset-image-1/);

    const payload = buildTextIqNodeCopyOutPayload([textNode]);
    assert.equal(parseTextIqNodePayload(payload.textIqPayload).ok, true);
    assert.match(payload.html, /Hello TextIQ/);
    assert.equal(payload.plainText, "1 TextIQ node\nHello TextIQ");
  });
});
