import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildDeck,
  buildSlide,
  buildSourceRef,
  buildTextElement,
  buildVisualElement as buildFixtureVisualElement,
} from "@/test/builders/deck";
import {
  activeSourceRef,
  buildDeckFromBlocks,
  buildSlideElementsFromContent,
  buildVisualElement,
  DEFAULT_SLIDE_FORMAT,
  DEFAULT_VISUAL_BOX,
  findSourceLinkedElements,
  getSlideTitleFromElements,
  getSlideVisualIds,
  GLASS_EFFECT_INTENSITIES,
  IMAGE_FIT_MODES,
  IMAGE_MASK_SHAPES,
  inspectSlideDesignOrigins,
  isSourceLinked,
  isSourceStale,
  LEGACY_DECK_SCHEMA_VERSION,
  makeElementId,
  makeSlideId,
  MAX_BULLETS,
  normalizeTextParagraphs,
  PRESENTATION_THEME_IDS,
  relinkSource,
  resolveSlideFormat,
  slideAspectRatio,
  slideFormatConfig,
  SLIDE_FORMAT_CONFIGS,
  SLIDE_FORMATS,
  summarizeSlideContent,
  unlinkSource,
} from "./deck-model";

test("deck-model facade exposes slide format constants and helpers", () => {
  assert.equal(DEFAULT_SLIDE_FORMAT, "16:9");
  assert.deepEqual(SLIDE_FORMATS, ["16:9", "4:3"]);
  assert.equal(resolveSlideFormat(undefined), "16:9");
  assert.equal(slideFormatConfig("4:3"), SLIDE_FORMAT_CONFIGS["4:3"]);
  assert.equal(slideAspectRatio("16:9"), 16 / 9);
  assert.equal(LEGACY_DECK_SCHEMA_VERSION, 6);
  assert.ok(PRESENTATION_THEME_IDS.length > 0);
});

test("element helper exports build and normalize visual/text elements", () => {
  const source = buildSourceRef({ contentHash: "old" });
  const visual = buildVisualElement("visual-1", {
    id: "visual-el",
    styleThemeId: "mono",
    source,
  });
  assert.deepEqual(visual.box, DEFAULT_VISUAL_BOX);
  assert.equal(visual.content.visualId, "visual-1");
  assert.equal(visual.content.styleThemeId, "mono");
  assert.deepEqual(
    normalizeTextParagraphs({
      content: {
        kind: "text",
        text: "Hello",
        runs: [{ text: "Hello", bold: true }],
      },
    }),
    [{ text: "Hello", runs: [{ text: "Hello", bold: true }] }],
  );
  assert.deepEqual(
    normalizeTextParagraphs({ content: { kind: "text", text: "" } }),
    [{ text: "" }],
  );
  assert.deepEqual(
    normalizeTextParagraphs({
      content: {
        kind: "text",
        text: "Ignored",
        paragraphs: [{ text: "Para" }],
      },
    }),
    [{ text: "Para" }],
  );
  assert.deepEqual(IMAGE_FIT_MODES, ["contain", "cover", "fill", "none"]);
  assert.ok(IMAGE_MASK_SHAPES.includes("rounded"));
  assert.ok(GLASS_EFFECT_INTENSITIES.includes("medium"));
});

test("source reference helpers clone, stale-check, unlink, and relink elements", () => {
  const ref = buildSourceRef({ contentHash: "old", unlinked: true });
  assert.deepEqual(activeSourceRef(ref), {
    documentId: ref.documentId,
    blockId: ref.blockId,
    contentHash: "old",
    linkedAt: ref.linkedAt,
    blockKind: ref.blockKind,
  });
  const linked = { source: activeSourceRef(ref) };
  assert.equal(isSourceLinked(linked), true);
  assert.equal(isSourceStale(linked, "new"), true);
  assert.equal(isSourceStale(linked, "old"), false);
  const unlinked = unlinkSource(linked);
  assert.equal(unlinked.source.unlinked, true);
  assert.equal(unlinkSource(unlinked), unlinked);
  assert.deepEqual(relinkSource(unlinked, ref).source, activeSourceRef(ref));
});

test("slide helper exports summarize element-derived content", () => {
  const source = buildSourceRef();
  const slide = buildSlide({
    elements: [
      buildTextElement({ id: "body", role: "body", text: "Body" }),
      buildTextElement({
        id: "title",
        role: "title",
        text: "  Title  ",
        source,
      }),
      buildFixtureVisualElement({ visualId: "visual-1" }),
      buildFixtureVisualElement({ visualId: "" }),
    ],
  });
  assert.equal(getSlideTitleFromElements(slide), "Title");
  assert.deepEqual(getSlideVisualIds(slide), ["visual-1"]);
  assert.equal(findSourceLinkedElements(slide).length, 1);
  assert.deepEqual(summarizeSlideContent(slide), {
    title: "Title",
    text: "Body\nTitle",
    visualIds: ["visual-1"],
    sourceLinkedElementCount: 1,
  });
});

test("deck derivation and id helpers are reachable through the facade", () => {
  const deck = buildDeckFromBlocks([
    {
      kind: "text",
      blockId: "block-1",
      blockType: "heading",
      level: 1,
      text: "Launch",
    },
  ]);
  assert.equal(deck.schemaVersion, LEGACY_DECK_SCHEMA_VERSION);
  assert.equal(deck.slides.length > 0, true);
  assert.ok(
    buildSlideElementsFromContent({
      title: "Title",
      bodyTexts: ["One", "Two"],
      visualRefs: [],
      templateId: "content",
    }).length > 0,
  );
  assert.equal(MAX_BULLETS > 0, true);
  assert.match(makeSlideId(), /^sl-/);
  assert.match(makeElementId(), /^el-/);
});

test("inspectSlideDesignOrigins reports deck, master, slide, and element design layers", () => {
  const deck = buildDeck({
    design: {
      themeId: "default",
      themeOverrides: { colors: { primary: "#000" } },
    },
    masters: [
      {
        id: "master-1",
        name: "Master",
        designOverrides: { accent: { value: "#f00" } },
        elements: [],
      },
    ],
    slides: [
      buildSlide({
        masterId: "master-1",
        designOverrides: {
          background: { type: "solid", color: { value: "#fff" } },
        },
      }),
    ],
  });
  const report = inspectSlideDesignOrigins(deck, deck.slides[0]);
  assert.equal(report.themeId.layer, "theme");
  assert.equal(report.masterId?.layer, "deck");
  assert.equal(report.background.layer, "slide");
});
