import assert from "node:assert/strict";
import { test } from "node:test";

import type { Deck, SlideChildNode, SlideNode } from "./presentation/schema";
import { hashDocumentBlock } from "./presentation/document-block-hash";
import type { SlideCommentAnchor } from "./document/deck-kernel/slide-comment-anchors";
import {
  resolveBlockRef,
  resolveCommentAnchor,
  resolveSlideElementRef,
  resolveSlideRef,
  resolveSourceRef,
  resolveVisualRef,
} from "./anchor-resolver";
import type { DocumentBlock, DocumentTextBlock } from "./content";
import type { Visual } from "./visual/schema";

function textBlock(
  blockId: string | undefined,
  text: string,
  overrides: Partial<DocumentTextBlock> = {},
): DocumentTextBlock {
  return {
    kind: "text",
    blockType: "paragraph",
    text,
    ...(blockId ? { blockId } : {}),
    ...overrides,
  };
}

function visualBlock(visualId: string): DocumentBlock {
  return { kind: "visual", visualId, visual: {} as Visual };
}

function textElement(id: string): SlideChildNode {
  return {
    id,
    type: "text",
    role: "body",
    layout: { frame: { x: 0, y: 0, w: 40, h: 10 }, zIndex: 0 },
    style: { ref: "text.body" },
    content: { paragraphs: [{ id: `${id}-p1`, text: "" }] },
  };
}

function slide(id: string, elements: SlideChildNode[] = []): SlideNode {
  return {
    id,
    type: "slide",
    template: { kind: "content" },
    style: { ref: "slide.content" },
    notes: "",
    children: elements,
  };
}

function deck(slides: SlideNode[]): Deck {
  return {
    schemaVersion: 7,
    canvas: { format: "16:9", width: 100, height: 56.25, unit: "percent" },
    theme: { packageId: "neutral" },
    assets: { images: {} },
    slides,
  };
}

function anchor(partial: Partial<SlideCommentAnchor> = {}): SlideCommentAnchor {
  return partial;
}

test("resolveBlockRef returns found, missing, and invalid for text blocks", () => {
  const blocks: DocumentBlock[] = [textBlock("blk-1", "Hello")];
  assert.equal(resolveBlockRef("blk-1", blocks).status, "found");
  assert.equal(resolveBlockRef("blk-missing", blocks).status, "missing");
  assert.equal(resolveBlockRef("", blocks).status, "invalid");
});

test("resolveVisualRef returns found, missing, and invalid for visual blocks", () => {
  const blocks: DocumentBlock[] = [visualBlock("vis-1")];
  assert.equal(resolveVisualRef("vis-1", blocks).status, "found");
  assert.equal(resolveVisualRef("vis-missing", blocks).status, "missing");
  assert.equal(resolveVisualRef("", blocks).status, "invalid");
});

test("resolveSourceRef returns found, stale, and missing for text and visual sources", () => {
  const freshText = textBlock("blk-1", "Fresh");
  const changedText = textBlock("blk-1", "Changed");
  const freshVisual = visualBlock("vis-1");
  const blocks: DocumentBlock[] = [freshText, freshVisual];

  assert.equal(
    resolveSourceRef(
      {
        documentId: "doc-1",
        blockId: "blk-1",
        contentHash: hashDocumentBlock(freshText),
        linkedAt: "2026-06-23T00:00:00.000Z",
        blockKind: "text",
      },
      blocks,
    ).status,
    "found",
  );

  const staleText = resolveSourceRef(
    {
      documentId: "doc-1",
      blockId: "blk-1",
      contentHash: hashDocumentBlock(changedText),
      linkedAt: "2026-06-23T00:00:00.000Z",
      blockKind: "text",
    },
    blocks,
  );
  assert.equal(staleText.status, "stale");
  assert.equal(staleText.target?.kind, "text");

  const staleVisual = resolveSourceRef(
    {
      documentId: "doc-1",
      blockId: "vis-1",
      blockKind: "visual",
      contentHash: "deadbeef",
      linkedAt: "2026-06-23T00:00:00.000Z",
    },
    blocks,
  );
  assert.equal(staleVisual.status, "stale");
  assert.equal(staleVisual.target?.kind, "visual");

  assert.deepEqual(
    resolveSourceRef(
      {
        documentId: "doc-1",
        blockId: "blk-1",
        linkedAt: "2026-06-23T00:00:00.000Z",
        blockKind: "legacy" as any,
      },
      blocks,
    ),
    {
      status: "invalid",
      reason: "Unsupported source ref blockKind: legacy.",
    },
  );

  assert.equal(
    resolveSourceRef(
      {
        documentId: "doc-1",
        blockId: "blk-gone",
        linkedAt: "2026-06-23T00:00:00.000Z",
        blockKind: "text",
      },
      blocks,
    ).status,
    "missing",
  );
});

test("resolveSlideRef returns found, missing, and invalid", () => {
  const d = deck([slide("sl-1")]);
  assert.equal(resolveSlideRef("sl-1", d).status, "found");
  assert.equal(resolveSlideRef("sl-gone", d).status, "missing");
  assert.equal(resolveSlideRef("", d).status, "invalid");
});

test("resolveSlideElementRef returns found, missing, and invalid", () => {
  const d = deck([slide("sl-1", [textElement("el-1")])]);
  assert.equal(resolveSlideElementRef("sl-1", "el-1", d).status, "found");
  assert.equal(resolveSlideElementRef("sl-1", "el-gone", d).status, "missing");
  const missingSlide = resolveSlideElementRef("sl-gone", "el-1", d);
  assert.equal(missingSlide.status, "missing");
  assert.match(missingSlide.reason ?? "", /slide missing/i);
  assert.equal(resolveSlideElementRef("", "el-1", d).status, "invalid");
  assert.equal(resolveSlideElementRef("sl-1", "", d).status, "invalid");
});

test("resolveCommentAnchor maps deck, attached, orphaned, and unknown anchor states", () => {
  const d = deck([slide("sl-1", [textElement("el-1")])]);
  assert.equal(resolveCommentAnchor(anchor(), d).status, "found");
  assert.equal(
    resolveCommentAnchor(anchor({ slideId: "sl-1", elementId: "el-1" }), d)
      .status,
    "found",
  );
  assert.equal(
    resolveCommentAnchor(anchor({ slideId: "sl-1", elementId: "el-gone" }), d)
      .status,
    "missing",
  );
  assert.equal(
    resolveCommentAnchor(anchor({ slideId: "sl-1" }), null).status,
    "unknown",
  );
  assert.equal(
    resolveCommentAnchor(anchor({ slideId: "missing-slide" }), d).status,
    "missing",
  );
  assert.equal(
    resolveCommentAnchor(anchor({ slideId: "sl-1", elementId: "el-1" }), null)
      .status,
    "unknown",
  );
});

test("text blocks without bid remain unresolved and return missing", () => {
  const blocks: DocumentBlock[] = [textBlock(undefined, "Text")];
  assert.equal(resolveBlockRef("missing-key", blocks).status, "missing");
  assert.equal(
    resolveSourceRef(
      {
        documentId: "doc-1",
        blockId: "missing-key",
        linkedAt: "2026-06-23T00:00:00.000Z",
        blockKind: "text",
      },
      blocks,
    ).status,
    "missing",
  );
});
