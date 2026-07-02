/**
 * Editor command media-shape-connector tests.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  updateAssetMetadata,
  resetImageCrop,
  detachDecoration,
} from "@/lib/presentation/editor-commands";
import {
  buildDeck,
  buildCoverSlide,
  buildImageAsset,
  resetBuilderCounter,
} from "@/test/builders/presentation-deck";
import type { SlideChildNode } from "@/lib/presentation/schema";
import { makeTestDeck, findNode } from "./editor-commands.test-utils";

describe("resetImageCrop", () => {
  test("removes crop metadata from image content", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const image: SlideChildNode = {
      id: "crop-image",
      type: "image",
      role: "image",
      layout: { frame: { x: 10, y: 10, w: 30, h: 20 }, zIndex: 5 },
      style: { ref: "media.inline" },
      content: {
        assetId: "placeholder",
        crop: { top: 10, right: 5, bottom: 0, left: 2 },
      },
    };
    const withImage = {
      ...deck,
      slides: deck.slides.map((candidate) =>
        candidate.id === slide.id
          ? { ...candidate, children: [...candidate.children, image] }
          : candidate,
      ),
    };

    const updated = resetImageCrop(withImage, slide.id, image.id);
    const updatedImage = findNode(updated.slides[0].children, image.id);

    assert.equal(updatedImage?.type, "image");
    if (updatedImage?.type === "image") {
      assert.equal(updatedImage.content.crop, undefined);
      assert.equal("crop" in updatedImage.content, false);
    }
  });
});

describe("updateAssetMetadata", () => {
  test("updates alt text on existing image asset", () => {
    resetBuilderCounter();
    const deck = buildDeck([buildCoverSlide()], {
      assets: {
        images: {
          "img-001": buildImageAsset("img-001"),
        },
      },
    });
    const updated = updateAssetMetadata(deck, "img-001", {
      alt: "A new alt text",
    });
    assert.equal(updated.assets.images["img-001"].alt, "A new alt text");
  });

  test("returns unchanged deck for missing asset id", () => {
    const deck = makeTestDeck();
    const updated = updateAssetMetadata(deck, "nonexistent", { alt: "oops" });
    assert.deepEqual(updated.assets, deck.assets);
  });
});

describe("detachDecoration", () => {
  test("appends a shape node with themeDecoration role to slide children", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const layout = { frame: { x: 10, y: 10, w: 20, h: 10 }, zIndex: 99 };
    const style = { fill: { type: "solid" as const, color: "#aabbcc" } };
    const updated = detachDecoration(
      deck,
      slide.id,
      "deco-bg-01",
      layout,
      style,
    );
    const extras = updated.slides[0].children.filter(
      (n) => (n as any).role === "themeDecoration",
    );
    assert.equal(extras.length, 1);
    assert.equal((extras[0] as any).type, "shape");
    assert.deepEqual(updated.theme.overrides?.disabledDecorations, [
      "deco-bg-01",
    ]);
  });

  test("normalizes resolved decoration ids before disabling theme recipes", () => {
    const deck = makeTestDeck();
    const updated = detachDecoration(
      deck,
      deck.slides[0].id,
      "decoration-corner",
      { frame: { x: 0, y: 0, w: 10, h: 10 }, zIndex: 0 },
      {},
    );

    assert.deepEqual(updated.theme.overrides?.disabledDecorations, ["corner"]);
  });
});
