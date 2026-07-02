import assert from "node:assert/strict";
import { test } from "node:test";

import {
  anchorNodeIdFromDurableBlockId,
  commentAnchorFromRecord,
  commentAnchorToRecord,
  durableBlockIdFromAnchorRecord,
  normalizeAnchorText,
  normalizeAnchorType,
  sanitizeAnchorGeometry,
  slideAnchorFromRecord,
  slideAnchorToRecord,
  validateAnchorGeometry,
  validateElementId,
  validateSlideId,
} from "./anchors";
import type { SlideCommentAnchor } from "@/lib/comments/slide-comment-anchors";
import {
  buildCommentAnchor,
  buildCommentAnchorRecord,
  buildSlideCommentAnchor,
} from "@/test/builders/comments";

test("slideAnchorFromRecord maps slide DB columns to slide anchors", () => {
  const result = slideAnchorFromRecord({
    ...buildCommentAnchorRecord(),
    ...slideAnchorToRecord(
      buildSlideCommentAnchor({
        slideId: "sl-1",
        elementId: "el-a",
        geometry: { x: 25, y: 75 },
      }),
    ),
  });
  assert.deepEqual(result, {
    slideId: "sl-1",
    elementId: "el-a",
    geometry: { x: 25, y: 75 },
  });
});

test("slideAnchorFromRecord silently drops malformed geometry", () => {
  const result = slideAnchorFromRecord({
    slideId: "sl-1",
    anchorGeometry: { label: "bad" },
  });
  assert.equal(result.slideId, "sl-1");
  assert.equal(result.geometry, null);
});

test("slideAnchorToRecord round-trips through slideAnchorFromRecord", () => {
  const original: SlideCommentAnchor = buildSlideCommentAnchor({
    slideId: "sl-1",
    elementId: "el-a",
    geometry: { x: 33, y: 66 },
  });
  assert.deepEqual(
    slideAnchorFromRecord(slideAnchorToRecord(original)),
    original,
  );
});

test("commentAnchorFromRecord maps deck, text, visual, table, slide, and element variants", () => {
  assert.deepEqual(commentAnchorFromRecord({}), { kind: "deck" });
  assert.deepEqual(
    commentAnchorFromRecord({ anchorType: "text", anchorText: "Paragraph" }),
    { kind: "text", text: "Paragraph", nodeId: null },
  );
  assert.deepEqual(
    commentAnchorFromRecord({
      anchorType: "visual",
      anchorText: "Chart",
      anchorNodeId: "visual-1",
    }),
    {
      ...buildCommentAnchor({
        kind: "document-block",
        text: "Chart",
        nodeId: "visual-1",
      }),
    },
  );
  assert.deepEqual(
    commentAnchorFromRecord({
      anchorType: "table",
      anchorText: "Evidence",
      anchorNodeId: "table-1",
    }),
    {
      kind: "document-block",
      blockKind: "table",
      text: "Evidence",
      nodeId: "table-1",
    },
  );
  assert.deepEqual(
    commentAnchorFromRecord({
      slideId: "sl-1",
      anchorGeometry: { x: 10, y: 20 },
    }),
    { kind: "slide", slideId: "sl-1", geometry: { x: 10, y: 20 } },
  );
  assert.deepEqual(
    commentAnchorFromRecord({
      slideId: "sl-1",
      elementId: "el-1",
      anchorGeometry: { x: 10, y: 20 },
    }),
    {
      kind: "slide-element",
      slideId: "sl-1",
      elementId: "el-1",
      geometry: { x: 10, y: 20 },
    },
  );
});

test("commentAnchorToRecord maps canonical variants to DB columns", () => {
  assert.deepEqual(commentAnchorToRecord({ kind: "deck" }), {
    anchorType: null,
    anchorText: null,
    anchorNodeId: null,
    slideId: null,
    elementId: null,
    anchorGeometry: null,
  });
  assert.equal(
    commentAnchorToRecord({
      kind: "document-block",
      blockKind: "visual",
      text: "Chart",
      nodeId: "visual-1",
    }).anchorType,
    "visual",
  );
  assert.equal(
    commentAnchorToRecord({
      kind: "document-block",
      blockKind: "table",
      text: "Evidence",
      nodeId: "table-1",
    }).anchorType,
    "table",
  );
  assert.deepEqual(
    commentAnchorToRecord({
      kind: "text",
      text: "Paragraph",
      nodeId: "block-1",
    }),
    {
      anchorType: "text",
      anchorText: "Paragraph",
      anchorNodeId: "block-1",
      slideId: null,
      elementId: null,
      anchorGeometry: null,
    },
  );
  assert.deepEqual(
    commentAnchorToRecord({
      kind: "document-block",
      blockKind: "visual",
      text: "Chart",
      nodeId: "visual-1",
    }),
    {
      anchorType: "visual",
      anchorText: "Chart",
      anchorNodeId: "visual-1",
      slideId: null,
      elementId: null,
      anchorGeometry: null,
    },
  );
  assert.deepEqual(
    commentAnchorToRecord({
      kind: "slide",
      slideId: "sl-1",
      geometry: { x: 5, y: 6 },
    }),
    {
      anchorType: null,
      anchorText: null,
      anchorNodeId: null,
      slideId: "sl-1",
      elementId: null,
      anchorGeometry: { x: 5, y: 6 },
    },
  );
  assert.deepEqual(
    commentAnchorToRecord({
      ...buildCommentAnchor({
        kind: "slide-element",
        slideId: "sl-1",
        elementId: "el-1",
        geometry: { x: 5, y: 6 },
      }),
    }),
    {
      anchorType: null,
      anchorText: null,
      anchorNodeId: null,
      slideId: "sl-1",
      elementId: "el-1",
      anchorGeometry: { x: 5, y: 6 },
    },
  );
});

test("anchor primitive normalizers trim, coerce, and reject invalid values", () => {
  assert.equal(normalizeAnchorType("text"), "text");
  assert.equal(normalizeAnchorType("visual"), "visual");
  assert.equal(normalizeAnchorType("table"), "table");
  assert.equal(normalizeAnchorType("deck"), null);
  assert.equal(
    normalizeAnchorText("  Many\n\nspaces\tinside  ", 11),
    "Many spaces",
  );
  assert.equal(validateSlideId(null), null);
  assert.equal(validateSlideId("  sl-1  "), "sl-1");
  assert.throws(() => validateSlideId(42), /slideId must be a string/);
  assert.equal(validateElementId(undefined), null);
  assert.equal(validateElementId("  el-1  "), "el-1");
  assert.throws(() => validateElementId({}), /elementId must be a string/);
});

test("comment anchor id adapters treat anchorNodeId as durable block id", () => {
  assert.equal(anchorNodeIdFromDurableBlockId(null), null);
  assert.equal(anchorNodeIdFromDurableBlockId("bid-stable-1"), "bid-stable-1");
  assert.equal(
    durableBlockIdFromAnchorRecord({ anchorNodeId: "visual-1" }),
    "visual-1",
  );

  const record = commentAnchorToRecord({
    kind: "document-block",
    blockKind: "visual",
    text: "Chart",
    nodeId: "visual-1",
  });
  assert.equal(record.anchorNodeId, "visual-1");
  assert.deepEqual(commentAnchorFromRecord(record), {
    kind: "document-block",
    blockKind: "visual",
    text: "Chart",
    nodeId: "visual-1",
  });
});

test("validateAnchorGeometry accepts bounds and rejects invalid values", () => {
  assert.deepEqual(validateAnchorGeometry({ x: 0, y: 100 }), { x: 0, y: 100 });
  assert.throws(() => validateAnchorGeometry({ x: -1, y: 50 }));
  assert.throws(() => validateAnchorGeometry({ x: "25", y: 50 }));
  assert.throws(() => validateAnchorGeometry({ x: Number.NaN, y: 50 }));
  assert.throws(() => validateAnchorGeometry({ x: 50, y: Number.NaN }));
});

test("sanitizeAnchorGeometry drops non-objects and out-of-range values", () => {
  assert.equal(sanitizeAnchorGeometry("bad"), null);
  assert.equal(sanitizeAnchorGeometry({ x: 50, y: 101 }), null);
  assert.equal(sanitizeAnchorGeometry({ x: Number.NaN, y: 50 }), null);
  assert.equal(sanitizeAnchorGeometry({ x: 50, y: Number.NaN }), null);
});
