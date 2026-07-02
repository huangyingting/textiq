/**
 * Editor command slide-deck tests.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  insertSlide,
  insertTemplateSlide,
  insertBlankSlide,
  duplicateSlide,
  splitNodeToSlide,
  deleteSlide,
  moveSlide,
  updateSlideControls,
  updateSlideAttributes,
  updateSlideLocalStyle,
  resetSlideLocalStyle,
  updateSlideSourceMetadata,
  restoreThemeDecoration,
  setThemePackage,
  insertNode,
  updateNodeLayout,
  deleteNodes,
  updateLocalStyle,
  resetLocalStyleOverride,
  applyTemplate,
  detachDecoration,
} from "@/lib/presentation/editor-commands";
import { resetIdCounter } from "@/lib/presentation/template-compiler";
import { createDefaultTemplateRegistry } from "@/lib/presentation/theme-packages";
import {
  buildDeck,
  buildCoverSlide,
  buildContentSlide,
  buildTextNode,
} from "@/test/builders/presentation-deck";
import {
  makeTestDeck,
  assertNoV6ElementsField,
} from "./editor-commands.test-utils";
import type { SemanticSlideSpecV1 } from "@/lib/presentation/semantic-deck-plan";

describe("insertSlide", () => {
  test("inserts a compiled slide at the end by default", () => {
    resetIdCounter();
    const deck = makeTestDeck();
    const registry = createDefaultTemplateRegistry();
    const template = registry.get("section")!;
    const spec: SemanticSlideSpecV1 = {
      kind: "section",
      slots: { title: { type: "shortText", text: "New Section" } },
    };
    const updated = insertSlide(deck, spec, template);
    assert.equal(updated.slides.length, 3);
    assert.equal(updated.slides[2].template.kind, "section");
  });

  describe("collaboration safety", () => {
    test("command outputs never write v6 Slide.elements fields", () => {
      const deck = makeTestDeck();
      const slide = deck.slides[0];
      const nodeId = slide.children[0].id;
      const inserted = insertBlankSlide(deck).deck;
      const withNode = insertNode(inserted, slide.id, {
        id: "safety-node",
        type: "text",
        role: "body",
        layout: { frame: { x: 12, y: 12, w: 30, h: 12 }, zIndex: 50 },
        style: { ref: "text.body" },
        content: { paragraphs: [{ id: "safety-node-p1", text: "Safe" }] },
      }).deck;
      const moved = updateNodeLayout(withNode, slide.id, nodeId, {
        frame: { x: 20, y: 20, w: 40, h: 12 },
      });
      const deleted = deleteNodes(moved, slide.id, [nodeId]);

      assertNoV6ElementsField(deleted);
    });
  });

  test("inserts at specified index", () => {
    resetIdCounter();
    const deck = makeTestDeck();
    const registry = createDefaultTemplateRegistry();
    const template = registry.get("section")!;
    const spec: SemanticSlideSpecV1 = {
      kind: "section",
      slots: { title: { type: "shortText", text: "Inserted" } },
    };
    const updated = insertSlide(deck, spec, template, 0);
    assert.equal(updated.slides.length, 3);
    assert.equal(updated.slides[0].template.kind, "section");
  });

  test("insertTemplateSlide returns the inserted semantic slide id and index", () => {
    resetIdCounter();
    const deck = makeTestDeck();
    const registry = createDefaultTemplateRegistry();
    const template = registry.get("content")!;
    const spec: SemanticSlideSpecV1 = {
      kind: "content",
      density: "dense",
      emphasis: "data",
      slots: { title: { type: "shortText", text: "Inserted content" } },
    };

    const result = insertTemplateSlide(deck, spec, template, 1);

    assert.equal(result.index, 1);
    assert.equal(result.deck.slides[1].id, result.slideId);
    assert.equal(result.deck.slides[1].template.kind, "content");
    assert.equal(result.deck.slides[1].template.layoutId, "content-dense");
  });

  test("does not mutate original deck", () => {
    resetIdCounter();
    const deck = makeTestDeck();
    const originalLength = deck.slides.length;
    const registry = createDefaultTemplateRegistry();
    const template = registry.get("cover")!;
    const spec: SemanticSlideSpecV1 = {
      kind: "cover",
      slots: { title: { type: "shortText", text: "Hi" } },
    };
    insertSlide(deck, spec, template);
    assert.equal(
      deck.slides.length,
      originalLength,
      "Original deck must not be mutated",
    );
  });
});

describe("slide management", () => {
  test("insertBlankSlide inserts an empty content slide", () => {
    const deck = makeTestDeck();
    const result = insertBlankSlide(deck, 1);

    assert.equal(result.deck.slides.length, deck.slides.length + 1);
    assert.equal(result.deck.slides[1].id, result.slideId);
    assert.equal(result.deck.slides[1].template.kind, "content");
  });

  test("duplicateSlide clones a slide and its children with new ids", () => {
    const deck = makeTestDeck();
    const result = duplicateSlide(deck, deck.slides[0].id);

    assert.equal(result.deck.slides.length, deck.slides.length + 1);
    assert.notEqual(result.slideId, deck.slides[0].id);
    assert.equal(
      result.deck.slides[1].children.length,
      deck.slides[0].children.length,
    );
    assert.notEqual(
      result.deck.slides[1].children[0].id,
      deck.slides[0].children[0].id,
    );
  });

  test("splitNodeToSlide moves a node to a new adjacent slide", () => {
    const deck = makeTestDeck();
    const sourceSlide = deck.slides[0];
    const nodeId = sourceSlide.children[0].id;
    const result = splitNodeToSlide(deck, sourceSlide.id, nodeId);

    assert.equal(result.deck.slides.length, deck.slides.length + 1);
    assert.equal(result.index, 1);
    assert.equal(result.nodeId, nodeId);
    assert.ok(
      !result.deck.slides[0].children.some((node) => node.id === nodeId),
    );
    assert.equal(result.deck.slides[1].children[0].id, nodeId);
    assert.equal(deck.slides[0].children[0].id, nodeId);
  });

  test("splitNodeToSlide returns no-op result for missing slide or node targets", () => {
    const deck = makeTestDeck();
    const missingSlide = splitNodeToSlide(deck, "missing-slide", "node-1");
    const missingNode = splitNodeToSlide(
      deck,
      deck.slides[0].id,
      "missing-node",
    );

    assert.deepEqual(missingSlide, {
      deck,
      slideId: "",
      nodeId: "node-1",
      index: -1,
    });
    assert.deepEqual(missingNode, {
      deck,
      slideId: "",
      nodeId: "missing-node",
      index: -1,
    });
  });

  test("deleteSlide keeps at least one slide", () => {
    const deck = makeTestDeck();
    const oneSlide = deleteSlide(deck, deck.slides[0].id).deck;
    const stillOneSlide = deleteSlide(oneSlide, oneSlide.slides[0].id).deck;

    assert.equal(stillOneSlide.slides.length, 1);
  });

  test("moveSlide reorders slides", () => {
    const deck = makeTestDeck();
    const secondId = deck.slides[1].id;
    const result = moveSlide(deck, secondId, 0);

    assert.equal(result.deck.slides[0].id, secondId);
    assert.equal(result.index, 0);
  });

  test("deleteSlide returns the first index when the slide is missing", () => {
    const deck = makeTestDeck();
    const result = deleteSlide(deck, "missing-slide");

    assert.strictEqual(result.deck, deck);
    assert.equal(result.index, 0);
  });
});

describe("updateSlideControls", () => {
  test("updates controls on target slide", () => {
    const deck = makeTestDeck();
    const slideId = deck.slides[0].id;
    const updated = updateSlideControls(deck, slideId, {
      tone: "confident",
      density: "dense",
    });
    assert.equal(updated.slides[0].controls?.tone, "confident");
    assert.equal(updated.slides[0].controls?.density, "dense");
  });

  test("does not modify other slides", () => {
    const deck = makeTestDeck();
    const slideId = deck.slides[0].id;
    const updated = updateSlideControls(deck, slideId, { tone: "confident" });
    assert.equal(updated.slides[1].controls, deck.slides[1].controls);
  });

  test("ignores controls for unknown slides", () => {
    const deck = makeTestDeck();
    const updated = updateSlideControls(deck, "missing-slide", {
      density: "dense",
    });

    assert.strictEqual(updated.slides[0], deck.slides[0]);
    assert.strictEqual(updated.slides[1], deck.slides[1]);
  });
});

describe("slide metadata and local style", () => {
  test("updates slide name and notes", () => {
    const deck = makeTestDeck();
    const slideId = deck.slides[0].id;
    const updated = updateSlideAttributes(deck, slideId, {
      name: "Updated slide",
      notes: "Speaker notes",
    });

    assert.equal(updated.slides[0].name, "Updated slide");
    assert.equal(updated.slides[0].notes, "Speaker notes");
  });

  test("updates and resets slide local style", () => {
    const deck = makeTestDeck();
    const slideId = deck.slides[0].id;
    const withStyle = updateSlideLocalStyle(deck, slideId, {
      slide: { background: { type: "solid", color: "#ffeeaa" } },
    });
    assert.equal(
      withStyle.slides[0].localStyle?.slide?.background?.type,
      "solid",
    );

    const reset = resetSlideLocalStyle(withStyle, slideId);
    assert.equal(reset.slides[0].localStyle, undefined);
  });

  test("sets and clears slide source metadata", () => {
    const deck = makeTestDeck();
    const slideId = deck.slides[0].id;
    const withSource = updateSlideSourceMetadata(deck, slideId, {
      documentId: "doc-1",
      blockId: "section-1",
      blockKind: "text",
    });
    assert.equal(withSource.slides[0].source?.blockId, "section-1");

    const cleared = updateSlideSourceMetadata(withSource, slideId, undefined);
    assert.equal(cleared.slides[0].source, undefined);
  });

  test("ignores slide metadata updates for unknown slides", () => {
    const deck = makeTestDeck();
    const attributes = updateSlideAttributes(deck, "missing-slide", {
      name: "Ignored",
    });
    const localStyle = updateSlideLocalStyle(deck, "missing-slide", {
      fill: { type: "solid", color: "#fff" },
    });
    const source = updateSlideSourceMetadata(deck, "missing-slide", {
      documentId: "doc-1",
      blockId: "block-1",
      blockKind: "text",
    });

    assert.strictEqual(attributes.slides[0], deck.slides[0]);
    assert.strictEqual(localStyle.slides[0], deck.slides[0]);
    assert.strictEqual(source.slides[0], deck.slides[0]);
  });
});

describe("setThemePackage", () => {
  test("updates theme packageId", () => {
    const deck = makeTestDeck();
    const updated = setThemePackage(deck, "ocean", "2.0.0");
    assert.equal(updated.theme.packageId, "ocean");
    assert.equal(updated.theme.packageVersion, "2.0.0");
  });

  test("does not rewrite node layout or localStyle", () => {
    const deck = makeTestDeck();
    const original = deck.slides[0].children[0].layout;
    const updated = setThemePackage(deck, "aurora");
    assert.deepEqual(updated.slides[0].children[0].layout, original);
    assert.equal(
      updated.slides[0].children[0].localStyle,
      deck.slides[0].children[0].localStyle,
    );
  });

  test("preserves local overrides until an explicit reset after theme switch", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const nodeId = slide.children[0].id;
    const withOverride = updateLocalStyle(deck, slide.id, nodeId, {
      text: { color: "#111827" },
      fill: { type: "solid", color: "#fde68a" },
    });

    const switched = setThemePackage(withOverride, "aurora");
    const reset = resetLocalStyleOverride(switched, slide.id, nodeId, ["fill"]);
    const resetNode = reset.slides[0].children.find(
      (node) => node.id === nodeId,
    );

    assert.equal(switched.theme.packageId, "aurora");
    assert.equal(
      switched.slides[0].children[0].localStyle?.fill?.type,
      "solid",
    );
    assert.equal(resetNode?.localStyle?.fill, undefined);
    assert.equal(resetNode?.localStyle?.text?.color, "#111827");
    assert.equal(reset.theme.packageId, "aurora");
  });
});

describe("applyTemplate", () => {
  test("reapplies template to existing slide, preserving id and localStyle", () => {
    resetIdCounter();
    const deck = makeTestDeck();
    const registry = createDefaultTemplateRegistry();
    const template = registry.get("content")!;
    const slideId = deck.slides[0].id;
    const spec: SemanticSlideSpecV1 = {
      kind: "content",
      slots: { title: { type: "shortText", text: "Reapplied Title" } },
    };
    const updated = applyTemplate(deck, slideId, spec, template);
    assert.equal(updated.slides[0].id, slideId, "Slide id must be preserved");
    assert.equal(updated.slides[0].template.kind, "content");
  });

  test("preserves compatible slot content, source, and local overrides", () => {
    resetIdCounter();
    const registry = createDefaultTemplateRegistry();
    const template = registry.get("content")!;
    const titleNode = buildTextNode({
      id: "title-source",
      role: "title",
      slot: "title",
      content: {
        paragraphs: [{ id: "title-source-p1", text: "Preserve me" }],
      },
      source: {
        documentId: "doc-1",
        blockId: "heading-1",
        blockKind: "text",
      },
      localStyle: { text: { color: "#ff0000" } },
    });
    const bodyNode = buildTextNode({
      id: "body-source",
      role: "body",
      slot: "bullets",
      content: {
        paragraphs: [
          { id: "body-source-p1", text: "First", list: { kind: "bullet" } },
          { id: "body-source-p2", text: "Second", list: { kind: "bullet" } },
        ],
      },
      source: {
        documentId: "doc-1",
        blockId: "body-1",
        blockKind: "text",
      },
    });
    const slide = {
      ...buildContentSlide("Old"),
      id: "slide-source",
      source: {
        documentId: "doc-1",
        blockId: "slide-1",
        blockKind: "text" as const,
      },
      localStyle: {
        slide: { background: { type: "solid" as const, color: "#fff7ed" } },
      },
      props: { decoration: "expressive" as const, chrome: "minimal" as const },
      notes: "Keep these notes",
      children: [titleNode, bodyNode],
    };
    const deck = buildDeck([slide]);
    const spec: SemanticSlideSpecV1 = {
      kind: "content",
      density: "dense",
      emphasis: "data",
      slots: {
        title: { type: "shortText", text: "Generated title" },
        bullets: { type: "bullets", items: [{ text: "Generated" }] },
      },
    };

    const updated = applyTemplate(deck, slide.id, spec, template);
    const nextSlide = updated.slides[0];
    const nextTitle = nextSlide.children.find((node) => node.slot === "title");
    const nextBullets = nextSlide.children.find(
      (node) => node.slot === "bullets",
    );

    assert.equal(nextSlide.id, "slide-source");
    assert.equal(nextSlide.source?.blockId, "slide-1");
    assert.equal(nextSlide.localStyle?.slide?.background?.type, "solid");
    assert.deepEqual(nextSlide.props, slide.props);
    assert.equal(nextSlide.notes, "Keep these notes");
    assert.equal(nextTitle?.id, "title-source");
    assert.equal(nextTitle?.source?.blockId, "heading-1");
    assert.equal(nextTitle?.localStyle?.text?.color, "#ff0000");
    assert.equal(nextTitle?.type, "text");
    if (nextTitle?.type === "text") {
      assert.equal(nextTitle.content.paragraphs[0].text, "Preserve me");
    }
    assert.equal(nextBullets?.id, "body-source");
    assert.equal(nextBullets?.source?.blockId, "body-1");
    assert.equal(nextBullets?.type, "text");
    if (nextBullets?.type === "text") {
      assert.equal(nextBullets.content.paragraphs.length, 2);
    }
  });

  test("returns unchanged deck for unknown slideId", () => {
    const deck = makeTestDeck();
    const registry = createDefaultTemplateRegistry();
    const template = registry.get("content")!;
    const spec: SemanticSlideSpecV1 = {
      kind: "content",
      slots: { title: { type: "shortText", text: "X" } },
    };
    const updated = applyTemplate(deck, "nonexistent-id", spec, template);
    assert.strictEqual(updated, deck, "Must return original deck unchanged");
  });
});

describe("decoration commands", () => {
  test("disables the source decoration recipe when detaching a resolved decoration", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const updated = detachDecoration(
      deck,
      slide.id,
      "decoration-bg-corner",
      { frame: { x: 10, y: 10, w: 20, h: 10 }, zIndex: 99 },
      { fill: { type: "solid", color: "#aabbcc" } },
    );

    assert.deepEqual(updated.theme.overrides?.disabledDecorations, [
      "bg-corner",
    ]);
  });

  test("restoreThemeDecoration removes stale disabled decoration overrides", () => {
    const deck = buildDeck([buildCoverSlide()], {
      theme: {
        packageId: "test-package",
        overrides: { disabledDecorations: ["bg-corner"] },
      },
    });

    const updated = restoreThemeDecoration(deck, "bg-corner");

    assert.equal(updated.theme.overrides?.disabledDecorations, undefined);
  });
});

describe("moveSlide — UI navigation flows", () => {
  test("moves first slide to last position (drag to end)", () => {
    const deck = makeTestDeck();
    const firstId = deck.slides[0].id;
    const result = moveSlide(deck, firstId, deck.slides.length);
    assert.equal(result.deck.slides[result.deck.slides.length - 1].id, firstId);
    assert.equal(result.index, deck.slides.length - 1);
  });

  test("moves last slide to first position (drag to start)", () => {
    const deck = makeTestDeck();
    const lastId = deck.slides[deck.slides.length - 1].id;
    const result = moveSlide(deck, lastId, 0);
    assert.equal(result.deck.slides[0].id, lastId);
    assert.equal(result.index, 0);
  });

  test("clamps target index to valid range (toIndex > slides.length)", () => {
    const deck = makeTestDeck();
    const firstId = deck.slides[0].id;
    const result = moveSlide(deck, firstId, 9999);
    assert.equal(result.deck.slides[result.deck.slides.length - 1].id, firstId);
  });

  test("clamps target index to 0 when toIndex < 0", () => {
    const deck = makeTestDeck();
    const lastId = deck.slides[deck.slides.length - 1].id;
    const result = moveSlide(deck, lastId, -5);
    assert.equal(result.deck.slides[0].id, lastId);
    assert.equal(result.index, 0);
  });

  test("no-op move (same index) keeps slides unchanged", () => {
    const deck = makeTestDeck();
    const firstId = deck.slides[0].id;
    const result = moveSlide(deck, firstId, 0);
    assert.equal(result.deck.slides[0].id, firstId);
    assert.equal(result.deck.slides.length, deck.slides.length);
  });

  test("returns index -1 for unknown slideId", () => {
    const deck = makeTestDeck();
    const result = moveSlide(deck, "nonexistent", 0);
    assert.equal(result.index, -1);
    assert.strictEqual(result.deck, deck);
  });
});

describe("insertBlankSlide — boundary index handling", () => {
  test("clamps negative atIndex to 0", () => {
    const deck = makeTestDeck();
    const result = insertBlankSlide(deck, -1);
    assert.equal(result.deck.slides[0].id, result.slideId);
  });

  test("clamps atIndex > slides.length to slides.length (appends)", () => {
    const deck = makeTestDeck();
    const result = insertBlankSlide(deck, 9999);
    assert.equal(
      result.deck.slides[result.deck.slides.length - 1].id,
      result.slideId,
    );
  });

  test("returns a unique slideId each call", () => {
    const deck = makeTestDeck();
    const r1 = insertBlankSlide(deck);
    const r2 = insertBlankSlide(r1.deck);
    assert.notEqual(r1.slideId, r2.slideId);
  });
});

describe("duplicateSlide — name handling", () => {
  test("appends ' Copy' to named slide", () => {
    const deck = makeTestDeck();
    const slideId = deck.slides[0].id;
    const named = updateSlideAttributes(deck, slideId, { name: "Intro" });
    const result = duplicateSlide(named, slideId);
    assert.equal(result.deck.slides[result.index].name, "Intro Copy");
  });

  test("duplicate of unnamed slide has no name", () => {
    const deck = makeTestDeck();
    const slideId = deck.slides[0].id;
    const result = duplicateSlide(deck, slideId);
    assert.equal(result.deck.slides[result.index].name, undefined);
  });

  test("duplicate is inserted immediately after the source slide", () => {
    const deck = makeTestDeck();
    const slideId = deck.slides[0].id;
    const result = duplicateSlide(deck, slideId);
    assert.equal(result.index, 1);
    assert.equal(result.deck.slides[0].id, slideId);
    assert.equal(result.deck.slides[1].id, result.slideId);
  });
});
