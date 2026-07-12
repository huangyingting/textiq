/**
 * Behavior coverage for the deck-export public facade (#1899).
 *
 * `deck-export.ts` is a pure re-export surface — external importers should be
 * able to reach the spec builder, PPTX applier, and slide-image exporter
 * through this single module path and get back the *exact same* function
 * references as importing the sub-modules directly. This also exercises the
 * facade's `buildDeckSpecs` ordering guarantee end-to-end through the public
 * entry point (not just the sub-module directly, which
 * `deck-export-spec.test.ts` already covers in depth).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { makeDeck, makeSlide } from "../deck-mutation-test-fixtures";
import * as facade from "./deck-export";
import { buildDeckSpecs as specBuildDeckSpecs } from "./deck-export-spec";
import { exportDeckAsPPTX as pptxExportDeckAsPPTX } from "./deck-export-pptx";
import { exportDeckAsSlideImages as slideImagesExportDeckAsSlideImages } from "./deck-export-slide-images";

test("deck-export re-exports the exact buildDeckSpecs implementation from deck-export-spec", () => {
  assert.equal(facade.buildDeckSpecs, specBuildDeckSpecs);
});

test("deck-export re-exports the exact exportDeckAsPPTX implementation from deck-export-pptx", () => {
  assert.equal(facade.exportDeckAsPPTX, pptxExportDeckAsPPTX);
});

test("deck-export re-exports the exact exportDeckAsSlideImages implementation from deck-export-slide-images", () => {
  assert.equal(
    facade.exportDeckAsSlideImages,
    slideImagesExportDeckAsSlideImages,
  );
});

test("deck-export's public buildDeckSpecs preserves deck.slides order in the returned index sequence", () => {
  const deck = makeDeck([
    makeSlide({ id: "third", index: 2 }),
    makeSlide({ id: "first", index: 0 }),
    makeSlide({ id: "second", index: 1 }),
  ]);
  const specs = facade.buildDeckSpecs(deck, new Map());
  assert.deepEqual(
    specs.map((spec) => spec.index),
    [0, 1, 2],
  );
  assert.deepEqual(
    specs.map((_, i) => deck.slides[i]!.id),
    ["third", "first", "second"],
  );
});

test("deck-export only exposes the documented public surface", () => {
  assert.deepEqual(
    Object.keys(facade).sort(),
    ["buildDeckSpecs", "exportDeckAsPPTX", "exportDeckAsSlideImages"].sort(),
  );
});
