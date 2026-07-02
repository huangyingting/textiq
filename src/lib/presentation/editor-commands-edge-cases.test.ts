import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  deleteNodes,
  detachDeckChrome,
  insertTemplateSlide,
  moveNodesBy,
  restoreThemeDecoration,
  updateDeckChrome,
} from "@/lib/presentation/editor-commands";
import type { ResolvedRenderNode } from "@/lib/presentation/render-tree";
import { resetIdCounter } from "@/lib/presentation/template-compiler";
import { createDefaultTemplateRegistry } from "@/lib/presentation/theme-packages";
import {
  buildContentSlide,
  buildCoverSlide,
  buildDeck,
  buildTextNode,
  resetBuilderCounter,
} from "@/test/builders/presentation-deck";
import type { SemanticSlideSpecV1 } from "@/lib/presentation/semantic-deck-plan";
import type { SlideChildNode } from "@/lib/presentation/schema";

function makeTestDeck() {
  resetBuilderCounter();
  return buildDeck([buildCoverSlide(), buildContentSlide()]);
}

function findNode(
  nodes: readonly SlideChildNode[],
  id: string,
): SlideChildNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.type === "group") {
      const found = findNode(node.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

describe("editor command edge cases", () => {
  test("insertTemplateSlide clamps position and re-identifies colliding template ids", () => {
    resetIdCounter();
    const registry = createDefaultTemplateRegistry();
    const template = registry.get("content")!;
    const deck = buildDeck([
      {
        ...buildContentSlide("Existing content"),
        id: "slide-0007",
        children: [
          buildTextNode({
            id: "title-0003",
            slot: "title",
            content: { paragraphs: [{ id: "p1", text: "Existing" }] },
          }),
        ],
      },
    ]);
    const spec: SemanticSlideSpecV1 = {
      kind: "content",
      slots: { title: { type: "shortText", text: "Inserted content" } },
    };

    const result = insertTemplateSlide(deck, spec, template, -10);

    assert.equal(result.index, 0);
    assert.equal(result.slideId, "slide-0007-copy");
    assert.equal(result.deck.slides[0].id, "slide-0007-copy");
    assert.equal(result.deck.slides[0].children[1].id, "title-0003-copy");
  });

  test("moveNodesBy clamps movement and ignores locked or missing targets", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const free = slide.children[0];
    const locked: SlideChildNode = {
      ...buildTextNode({
        id: "locked-node",
        layout: { frame: { x: 10, y: 10, w: 20, h: 10 }, zIndex: 3 },
      }),
      locked: true,
    };
    const withLocked = {
      ...deck,
      slides: deck.slides.map((candidate) =>
        candidate.id === slide.id
          ? { ...candidate, children: [...candidate.children, locked] }
          : candidate,
      ),
    };
    const updated = moveNodesBy(withLocked, slide.id, [free.id, locked.id], {
      x: 200,
      y: 200,
    });
    const moved = findNode(updated.slides[0].children, free.id);
    const stillLocked = findNode(updated.slides[0].children, locked.id);
    const missingSlide = moveNodesBy(deck, "missing-slide", [free.id], {
      x: 1,
      y: 1,
    });

    assert.equal(moved?.layout?.frame.x, 100 - free.layout!.frame.w);
    assert.equal(moved?.layout?.frame.y, 100 - free.layout!.frame.h);
    assert.deepEqual(stillLocked?.layout?.frame, locked.layout?.frame);
    assert.strictEqual(missingSlide, deck);
  });

  test("keeps connector endpoint bindings when target layout is unavailable", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const noLayoutTarget: SlideChildNode = {
      id: "no-layout-target",
      type: "text",
      role: "body",
      style: { ref: "text.body" },
      content: { paragraphs: [{ id: "no-layout-p1", text: "No layout" }] },
    };
    const connector: SlideChildNode = {
      id: "no-layout-connector",
      type: "connector",
      role: "connector",
      style: { ref: "connector.primary" },
      content: {
        from: { kind: "node", nodeId: noLayoutTarget.id, anchor: "left" },
        to: { kind: "node", nodeId: noLayoutTarget.id, anchor: "right" },
      },
    };
    const withConnector = {
      ...deck,
      slides: deck.slides.map((candidate) =>
        candidate.id === slide.id
          ? {
              ...candidate,
              children: [...candidate.children, noLayoutTarget, connector],
            }
          : candidate,
      ),
    };

    const updated = deleteNodes(withConnector, slide.id, [noLayoutTarget.id]);
    const repaired = findNode(updated.slides[0].children, connector.id);

    assert.equal(repaired?.type, "connector");
    if (repaired?.type === "connector") {
      assert.deepEqual(repaired.content.from, connector.content.from);
      assert.deepEqual(repaired.content.to, connector.content.to);
    }
  });

  test("keeps connector endpoint bindings when connector frame is zero-sized", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const target: SlideChildNode = {
      id: "zero-frame-target",
      type: "text",
      role: "body",
      layout: { frame: { x: 40, y: 40, w: 20, h: 10 }, zIndex: 3 },
      style: { ref: "text.body" },
      content: { paragraphs: [{ id: "zero-frame-p1", text: "Target" }] },
    };
    const connector: SlideChildNode = {
      id: "zero-frame-connector",
      type: "connector",
      role: "connector",
      layout: { frame: { x: 0, y: 0, w: 0, h: 30 }, zIndex: 9 },
      style: { ref: "connector.primary" },
      content: {
        from: { kind: "node", nodeId: target.id, anchor: "top" },
        to: { kind: "point", point: { x: 50, y: 50 } },
      },
    };
    const withConnector = {
      ...deck,
      slides: deck.slides.map((candidate) =>
        candidate.id === slide.id
          ? {
              ...candidate,
              children: [...candidate.children, target, connector],
            }
          : candidate,
      ),
    };

    const updated = deleteNodes(withConnector, slide.id, [target.id]);
    const repaired = findNode(updated.slides[0].children, connector.id);

    assert.equal(repaired?.type, "connector");
    if (repaired?.type === "connector") {
      assert.deepEqual(repaired.content.from, connector.content.from);
      assert.deepEqual(repaired.content.to, connector.content.to);
    }
  });

  test("restoreThemeDecoration preserves remaining disabled decorations", () => {
    const deck = buildDeck([buildCoverSlide()], {
      theme: {
        packageId: "test-package",
        overrides: {
          disabledDecorations: ["bg-corner", "grid"],
          tokens: { colors: { accent: { fill: "#f97316" } } },
        },
      },
    });

    const updated = restoreThemeDecoration(deck, "bg-corner");

    assert.deepEqual(updated.theme.overrides?.disabledDecorations, ["grid"]);
    assert.deepEqual(updated.theme.overrides?.tokens, {
      colors: { accent: { fill: "#f97316" } },
    });
  });

  test("updates deck-level chrome without mutating slides", () => {
    const deck = makeTestDeck();
    const updated = updateDeckChrome(deck, {
      footer: { enabled: true, text: "Confidential" },
    });

    assert.equal(updated.chrome?.footer?.text, "Confidential");
    assert.strictEqual(updated.slides, deck.slides);
  });

  test("detaches resolved deck chrome as a slide node and records override", () => {
    const deck = makeTestDeck();
    const node: ResolvedRenderNode = {
      id: "deck-chrome-footer",
      type: "text",
      role: "caption",
      layout: { frame: { x: 6, y: 91, w: 88, h: 5 }, zIndex: 900 },
      style: { text: { fontSizePt: 9, color: "#64748b" } },
      content: {
        type: "text",
        content: { paragraphs: [{ id: "footer-p0", text: "Footer" }] },
      },
      source: "deckChrome",
      chromeKind: "footer",
    };
    const updated = detachDeckChrome(deck, deck.slides[0].id, "footer", node);
    const detached = updated.slides[0].children.find((child) =>
      child.id.startsWith("detached-chrome-footer-"),
    );

    assert.equal(detached?.type, "text");
    assert.equal(updated.slides[0].props?.deckChrome?.footer?.mode, "detached");
  });

  test("detaches stroke-only chrome without inheriting a card fill", () => {
    const deck = makeTestDeck();
    const node: ResolvedRenderNode = {
      id: "deck-chrome-border",
      type: "shape",
      role: "background",
      layout: { frame: { x: 1, y: 1, w: 98, h: 98 }, zIndex: 930 },
      style: { stroke: { color: "#111111", widthPt: 1 } },
      content: { type: "shape", content: { shape: "rect" } },
      source: "deckChrome",
      chromeKind: "border",
    };
    const updated = detachDeckChrome(deck, deck.slides[0].id, "border", node);
    const detached = updated.slides[0].children.find((child) =>
      child.id.startsWith("detached-chrome-border-"),
    );

    assert.equal(detached?.type, "shape");
    assert.deepEqual(detached?.localStyle?.fill, {
      type: "solid",
      color: "transparent",
    });
    assert.deepEqual(detached?.localStyle?.radius, { allPt: 0 });
  });
});
