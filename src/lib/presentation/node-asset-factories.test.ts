import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { insertNode } from "@/lib/presentation/editor-commands";
import type { Deck } from "@/lib/presentation/schema";
import { safeParseDeck } from "@/lib/presentation/validation";
import { buildDeck, buildSlide } from "@/test/builders/presentation-deck";

import {
  assetFactoryId,
  deckWithPickedVisualAsset,
  deckWithUploadedImageAsset,
  defaultConnectorNode,
  defaultImageNode,
  defaultShapeNode,
  defaultTableNode,
  defaultTextNode,
  defaultVisualNode,
  imageMimeType,
  nextZIndex,
  nodeFactoryId,
  textNodeAtPoint,
  visualContentPatchFromPick,
} from "./node-asset-factories";

function buildFactoryDeck(): Deck {
  return buildDeck([buildSlide("content", [], { id: "slide-factory" })]);
}

describe("node factory ids", () => {
  test("creates node and asset ids with the expected prefixes", () => {
    const nodeId = nodeFactoryId("text");
    const assetId = assetFactoryId("image");

    assert.match(nodeId, /^text-[a-z0-9]+$/);
    assert.match(assetId, /^image-[a-z0-9]+-[a-z0-9]{6}$/);
  });
});

describe("default node factories", () => {
  test("produce nodes that remain Deck-valid after insertion", () => {
    let deck = buildFactoryDeck();
    const slide = deck.slides[0];
    assert.ok(slide);

    const baseZ = nextZIndex(slide);
    const nodes = [
      defaultTextNode(baseZ),
      defaultShapeNode(baseZ + 1),
      defaultTableNode(baseZ + 2),
      defaultImageNode(baseZ + 3),
      defaultVisualNode(baseZ + 4),
      defaultConnectorNode(baseZ + 5),
      textNodeAtPoint({ x: 95, y: 99 }, baseZ + 6),
    ];

    for (const node of nodes) {
      const result = insertNode(deck, slide.id, node);
      deck = result.deck;
    }

    const parsed = safeParseDeck(deck);
    assert.equal(parsed.success, true);
  });

  test("clamps text-at-point frames to the slide bounds", () => {
    const node = textNodeAtPoint({ x: 100, y: 100 }, 1);
    assert.equal(node.type, "text");
    assert.deepEqual(node.layout?.frame, { x: 58, y: 88, w: 42, h: 12 });
  });

  test("gives default shapes a visible local style", () => {
    const node = defaultShapeNode(1);

    assert.equal(node.style?.ref, "surface.card");
    assert.deepEqual(node.localStyle?.fill, {
      type: "solid",
      color: "#e2e8f0",
    });
    assert.deepEqual(node.localStyle?.stroke, {
      color: "#94a3b8",
      widthPt: 1.5,
    });
  });
});

describe("uploaded image asset factory", () => {
  test("builds the same image asset registry shape used by SlideEditor", () => {
    const deck = buildFactoryDeck();
    const result = deckWithUploadedImageAsset({
      deck,
      upload: {
        src: "data:image/png;base64,abc123",
        widthPx: 1280,
        heightPx: 720,
        contentHash: "hash-123",
      },
      fileName: "Roadmap chart",
      fileType: "image/png",
      now: () => "2026-07-01T00:00:00.000Z",
      createAssetId: () => "image-upload-001",
    });

    assert.ok(result);
    assert.equal(result.assetId, "image-upload-001");
    assert.equal(result.alt, "Roadmap chart");
    assert.deepEqual(result.deckWithAsset.assets.images["image-upload-001"], {
      id: "image-upload-001",
      src: "data:image/png;base64,abc123",
      alt: "Roadmap chart",
      widthPx: 1280,
      heightPx: 720,
      mimeType: "image/png",
      contentHash: "hash-123",
      origin: { kind: "upload", importedAt: "2026-07-01T00:00:00.000Z" },
    });
  });

  test("returns undefined when upload data is empty", () => {
    const result = deckWithUploadedImageAsset({
      deck: buildFactoryDeck(),
      upload: { src: "" },
      fileName: "Untitled",
      fileType: "image/png",
    });
    assert.equal(result, undefined);
  });
});

describe("visual and mime helpers", () => {
  test("adds picked visual assets without mutating deck shape", () => {
    const deck = buildFactoryDeck();
    const updated = deckWithPickedVisualAsset(deck, {
      assetId: "visual-asset-001",
      visualId: "visual-001",
      alt: "Revenue chart",
    });

    assert.deepEqual(updated.assets.visuals?.["visual-asset-001"], {
      id: "visual-asset-001",
      visualId: "visual-001",
      alt: "Revenue chart",
    });
  });

  test("builds visual content patch fields from picker output", () => {
    assert.deepEqual(
      visualContentPatchFromPick({
        assetId: "visual-asset-002",
        alt: "Updated chart",
      }),
      { assetId: "visual-asset-002", alt: "Updated chart" },
    );
  });

  test("keeps only supported image mime types", () => {
    assert.equal(imageMimeType("image/png"), "image/png");
    assert.equal(imageMimeType("image/svg+xml"), "image/svg+xml");
    assert.equal(imageMimeType("image/gif"), undefined);
  });
});
