import assert from "node:assert/strict";
import { describe, test } from "node:test";

import * as runtime from "@/lib/presentation";
import { repairSemanticDeckPlan } from "@/lib/presentation/semantic-deck-plan-repair";
import {
  cutNodes,
  deleteNodes,
  duplicateNodes,
  groupNodes,
  reorderZIndex,
  ungroupNodes,
  updateNodeSourceMetadata,
  updateSlideSourceMetadata,
} from "@/lib/presentation/editor-commands";
import type { SlotContract } from "@/lib/presentation/template-registry";
import { SemanticTemplateRegistry } from "@/lib/presentation/template-registry";
import { safeParseDeck } from "@/lib/presentation/validation";
import {
  buildDeck,
  buildLayoutBox,
  buildMinimalDeck,
  buildShapeNode,
  buildSlide,
  buildTextNode,
} from "@/test/builders/presentation-deck";
import type { SlideChildNode, SlotKey } from "@/lib/presentation/schema";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function errorsFor(input: unknown): string[] {
  const result = safeParseDeck(input);
  assert.equal(result.success, false);
  return result.success ? [] : result.errors;
}

function assertError(input: unknown, pattern: RegExp): void {
  const errors = errorsFor(input);
  assert.ok(
    errors.some((error) => pattern.test(error)),
    `Expected ${pattern}, got:\n${errors.join("\n")}`,
  );
}

function groupNode(
  id: string,
  children: SlideChildNode[],
  x: number,
): SlideChildNode {
  return {
    id,
    type: "group",
    component: "custom",
    style: { ref: "surface.card" },
    layout: buildLayoutBox({ frame: { x, y: x, w: 10, h: 10 }, zIndex: x }),
    children,
  };
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

function registryWithCapacityContracts(): SemanticTemplateRegistry {
  const registry = new SemanticTemplateRegistry();
  const contract = (
    type: SlotContract["type"],
    extra: Partial<SlotContract> = {},
  ): SlotContract => ({
    type,
    required: false,
    overflow: "repair",
    ...extra,
  });
  const slots: Record<SlotKey, SlotContract> = {
    kicker: contract("shortText"),
    title: contract("shortText", { maxChars: 6 }),
    subtitle: contract("shortText"),
    body: contract("paragraph", { maxItems: 1 }),
    bullets: contract("bullets", { maxItems: 1 }),
    leftTitle: contract("shortText"),
    leftBody: contract("paragraph"),
    leftBullets: contract("bullets"),
    rightTitle: contract("shortText"),
    rightBody: contract("paragraph"),
    rightBullets: contract("bullets"),
    cards: contract("cards", { maxItems: 1 }),
    steps: contract("steps", { maxItems: 1 }),
    quote: contract("paragraph"),
    attribution: contract("shortText"),
    stat: contract("metric"),
    statLabel: contract("shortText"),
    metrics: contract("metrics", { maxItems: 1 }),
    table: contract("table", { maxColumns: 2, maxRows: 1 }),
    visualId: contract("visual"),
    imagePrompt: contract("image", { required: true }),
    caption: contract("timeline", { maxItems: 1 }),
  };

  registry.register({
    schemaVersion: 1,
    kind: "content",
    label: "Coverage content",
    version: "1.0.0",
    group: "explain",
    intent: "Exercise repair capacity branches",
    slots,
    supports: {
      tone: ["neutral", "technical"],
      density: ["normal", "dense"],
      emphasis: ["balanced", "data"],
    },
    layouts: [
      {
        id: "default",
        density: ["normal"],
        emphasis: ["balanced"],
        root: { type: "slide", style: { ref: "slide.content" } },
      },
    ],
    selection: { priority: 1, bestFor: "coverage", signals: [] },
  });
  return registry;
}

describe("presentation final library coverage", () => {
  test("safeParseDeck reports remaining fatal, v6, and deep group diagnostics", () => {
    assertError(
      { ...buildMinimalDeck(), schemaVersion: "7" },
      /Deck\.schemaVersion must be 7/,
    );
    assertError({ ...buildMinimalDeck(), assets: "bad" }, /Deck\.assets/);
    assertError(
      { ...buildMinimalDeck(), slides: [] },
      /must contain at least one slide/,
    );

    const withV6Fields = {
      ...clone(buildMinimalDeck()),
      masters: [],
      customTemplates: [],
      design: { themeId: "default" },
      defaultMasterId: "master-1",
    };
    const v6Errors = errorsFor(withV6Fields);
    assert.ok(v6Errors.some((error) => error.includes("Deck.masters")));
    assert.ok(v6Errors.some((error) => error.includes("Deck.design")));

    const leaf = buildTextNode({ id: "leaf-node" });
    const nested = groupNode(
      "g0",
      [
        groupNode(
          "g1",
          [
            groupNode(
              "g2",
              [groupNode("g3", [groupNode("g4", [leaf], 5)], 4)],
              3,
            ),
          ],
          2,
        ),
      ],
      1,
    );
    assertError(
      buildDeck([buildSlide("content", [nested])]),
      /groups may not be nested beyond depth 4/,
    );
  });

  test("safeParseDeck accepts less common fill variants and node metadata", () => {
    const deck = buildDeck(
      [
        buildSlide("content", [
          buildShapeNode({
            id: "path-shape",
            source: {
              documentId: "doc-1",
              blockId: "block-1",
              blockKind: "image",
              unlinked: true,
              extra: { reviewed: true },
            },
            localStyle: {
              fill: {
                type: "conicGradient",
                fromAngle: 45,
                cx: 0.5,
                cy: 0.5,
                stops: [
                  { color: "#111111", offsetPct: 0 },
                  { color: { token: "colors.accent.fill" }, offsetPct: 100 },
                ],
              },
              image: { fit: "none", maskShape: "rect", shadow: false },
            },
            content: {
              shape: "path",
              path: "M 0 0 L 10 0 L 10 10 Z",
            },
          }),
        ]),
      ],
      {
        theme: {
          packageId: "test-package",
          overrides: {
            styles: {
              "surface.card": {
                pattern: {
                  fill: {
                    type: "pattern",
                    kind: "dots",
                    background: "#ffffff",
                    color: "#111111",
                    spacingPct: 8,
                    strokeWidthPct: 2,
                  },
                },
                image: {
                  fill: {
                    type: "image",
                    assetId: "img-001",
                    opacity: 0.5,
                  },
                },
              },
            },
          },
        },
      },
    );

    const result = safeParseDeck(deck);
    assert.equal(
      result.success,
      true,
      !result.success ? result.errors.join("\n") : "",
    );
  });

  test("editor commands cover no-op, nested selection, and default layout branches", () => {
    const sourced = buildTextNode({
      id: "sourced",
      source: { documentId: "doc", blockId: "block", blockKind: "text" },
      localStyle: { fill: { type: "solid", color: "#ffffff" } },
    });
    const noLayout = buildTextNode({ id: "no-layout", layout: undefined });
    const child = buildTextNode({ id: "child" });
    const parent = groupNode("parent", [child], 10);
    const deck = buildDeck([
      buildSlide("content", [sourced, noLayout, parent], {
        id: "slide-editor-final",
        source: { documentId: "deck-doc", blockId: "slide", blockKind: "text" },
      }),
    ]);
    const slideId = deck.slides[0].id;

    assert.strictEqual(deleteNodes(deck, slideId, []), deck);
    assert.deepEqual(duplicateNodes(deck, slideId, []), {
      deck,
      duplicatedIds: [],
    });
    assert.deepEqual(duplicateNodes(deck, "missing", ["sourced"]), {
      deck,
      duplicatedIds: [],
    });
    assert.deepEqual(cutNodes(deck, slideId, ["missing-node"]), {
      deck,
      nodes: [],
    });
    assert.deepEqual(ungroupNodes(deck, slideId, "missing-group"), {
      deck,
      nodeIds: [],
    });

    const reordered = reorderZIndex(deck, slideId, "no-layout", 42);
    assert.deepEqual(
      findNode(reordered.slides[0].children, "no-layout")?.layout,
      {
        frame: { x: 0, y: 0, w: 10, h: 10 },
        zIndex: 42,
      },
    );

    const withoutNodeSource = updateNodeSourceMetadata(
      reordered,
      slideId,
      "sourced",
      undefined,
    );
    assert.equal(
      findNode(withoutNodeSource.slides[0].children, "sourced")?.source,
      undefined,
    );
    const withoutSlideSource = updateSlideSourceMetadata(
      withoutNodeSource,
      slideId,
      undefined,
    );
    assert.equal(withoutSlideSource.slides[0].source, undefined);

    const grouped = groupNodes(
      withoutSlideSource,
      slideId,
      ["parent", "child"],
      "wrapper",
      {
        ref: "surface.card",
      },
    );
    const wrapper = findNode(grouped.slides[0].children, "wrapper");
    assert.equal(wrapper?.type, "group");
    assert.equal(
      wrapper?.type === "group" ? wrapper.children[0]?.id : undefined,
      "parent",
    );
  });

  test("repairSemanticDeckPlan truncates every capacity-managed slot type", () => {
    const result = repairSemanticDeckPlan(
      {
        planVersion: 1,
        title: 123,
        locale: false,
        slides: [
          {
            kind: "content",
            tone: "technical",
            density: "dense",
            emphasis: "data",
            slots: {
              title: { type: "shortText", text: "  More than six chars  " },
              body: { type: "paragraph", paragraphs: ["one", "two"] },
              bullets: {
                type: "bullets",
                items: [
                  { text: "first", children: [{ text: "nested" }] },
                  { text: "second" },
                ],
              },
              metrics: {
                type: "metrics",
                items: [
                  { value: "$1M", label: "ARR", detail: "run-rate" },
                  { value: "$2M", label: "Pipeline" },
                ],
              },
              cards: {
                type: "cards",
                items: [
                  { title: "A", body: "Alpha", metric: "10%" },
                  { title: "B" },
                ],
              },
              steps: {
                type: "steps",
                items: [
                  { title: "Plan", body: "Build", date: "Q1" },
                  { title: "Launch" },
                ],
              },
              caption: {
                type: "timeline",
                items: [
                  { label: "Now", title: "Start", body: "Kickoff" },
                  { label: "Next", title: "Scale" },
                ],
              },
              stat: { type: "metric", value: "98%", label: "Coverage" },
              table: {
                type: "table",
                columns: ["A", "B", "C"],
                rows: [
                  ["1", "2", "3"],
                  ["4", "5", "6"],
                ],
                caption: "Trimmed table",
              },
            },
          },
        ],
      },
      registryWithCapacityContracts(),
    );

    const slide = result.plan.slides[0]!;
    assert.equal(slide.slots.title?.type, "shortText");
    assert.equal(
      slide.slots.title?.type === "shortText" ? slide.slots.title.text : "",
      "More t",
    );
    assert.equal(
      slide.slots.body?.type === "paragraph"
        ? slide.slots.body.paragraphs.length
        : 0,
      1,
    );
    assert.equal(
      slide.slots.bullets?.type === "bullets"
        ? slide.slots.bullets.items.length
        : 0,
      1,
    );
    assert.equal(
      slide.slots.metrics?.type === "metrics"
        ? slide.slots.metrics.items.length
        : 0,
      1,
    );
    assert.equal(
      slide.slots.cards?.type === "cards" ? slide.slots.cards.items.length : 0,
      1,
    );
    assert.equal(
      slide.slots.steps?.type === "steps" ? slide.slots.steps.items.length : 0,
      1,
    );
    assert.equal(
      slide.slots.caption?.type === "timeline"
        ? slide.slots.caption.items.length
        : 0,
      1,
    );
    assert.deepEqual(
      slide.slots.table?.type === "table"
        ? { columns: slide.slots.table.columns, rows: slide.slots.table.rows }
        : {},
      { columns: ["A", "B"], rows: [["1", "2"]] },
    );
    assert.equal(result.plan.title, undefined);
    assert.equal(result.plan.locale, undefined);
    assert.ok(
      result.diagnostics.some((diagnostic) =>
        diagnostic.message.includes('required slot "imagePrompt" is missing'),
      ),
    );
    assert.ok(
      result.diagnostics.filter(
        (diagnostic) => diagnostic.code === "slot-over-capacity",
      ).length >= 7,
    );
  });

  test("barrel exposes final runtime facade values", () => {
    assert.equal(typeof runtime.SemanticTemplateRegistry, "function");
    assert.equal(typeof runtime.selectLayout, "function");
    assert.equal(typeof runtime.isSlotValue, "function");
    assert.equal(typeof runtime.slideSpecFromSlide, "function");
    assert.equal(typeof runtime.emptySlideSpecFromLayout, "function");
    assert.equal(typeof runtime.alignmentGuidesForFrames, "function");
    assert.equal(typeof runtime.snapFrameToStageGuides, "function");
    assert.equal(typeof runtime.normalizeSelectionFrame, "function");
    assert.equal(typeof runtime.selectNodesInFrame, "function");
    assert.equal(typeof runtime.NEUTRAL_THEME_PACKAGE, "object");
    assert.equal(typeof runtime.exportDeckAsPPTX, "function");
  });
});
