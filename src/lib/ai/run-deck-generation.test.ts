/**
 * presentation deck generation contract tests.
 *
 * Tests the generation pipeline:
 *   DocumentSlidePlanV1 (raw AI output) → repairDocumentSlidePlan → Deck
 *
 * Uses a stub `complete` function so no real AI calls are made.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  runDeckGeneration,
  type RunDeckGenerationInput,
} from "@/lib/ai/run-deck-generation";
import type { CompleteFn } from "@/lib/ai/generate";
import type { Visual } from "@/lib/visual/schema";
import { DEFAULT_STYLE, VISUAL_SCHEMA_VERSION } from "@/lib/visual/schema";
import {
  DECK_SCHEMA_VERSION,
  type SlideChildNode,
} from "@/lib/presentation/schema";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid DocumentSlidePlanV1 JSON with a cover + content slide. */
const VALID_PLAN_JSON = JSON.stringify({
  planVersion: 1,
  planner: "ai",
  mode: "faithful",
  locale: "en",
  source: { contentHash: "ignored-by-repair", truncated: false },
  slides: [
    {
      id: "plan-slide-1",
      kind: "cover",
      sourceBlockIds: ["heading-1"],
      slotSources: { title: ["heading-1"], subtitle: ["paragraph-1"] },
      slots: {
        title: { type: "shortText", text: "My Presentation" },
        subtitle: { type: "shortText", text: "A strategic overview" },
      },
    },
    {
      id: "plan-slide-2",
      kind: "content",
      sourceBlockIds: ["paragraph-1"],
      slotSources: { title: ["paragraph-1"], bullets: ["paragraph-1"] },
      slots: {
        title: { type: "shortText", text: "Key Findings" },
        bullets: {
          type: "bullets",
          items: [{ text: "Finding one" }, { text: "Finding two" }],
        },
      },
    },
  ],
});

function makeStubComplete(response: string): CompleteFn {
  return async () => response;
}

function collectNodes(nodes: ReadonlyArray<SlideChildNode>): SlideChildNode[] {
  const flattened: SlideChildNode[] = [];
  const walk = (list: ReadonlyArray<SlideChildNode>) => {
    for (const node of list) {
      flattened.push(node);
      if (node.type === "group") walk(node.children);
    }
  };
  walk(nodes);
  return flattened;
}

function makeSequenceComplete(responses: string[]): {
  complete: CompleteFn;
  getCallCount: () => number;
} {
  let calls = 0;
  return {
    complete: async () => {
      const response = responses[Math.min(calls, responses.length - 1)];
      calls += 1;
      return response;
    },
    getCallCount: () => calls,
  };
}

function makeInput(
  complete: CompleteFn,
  overrides: Partial<RunDeckGenerationInput> = {},
): RunDeckGenerationInput {
  return {
    contentJson: {
      root: {
        children: [
          {
            type: "heading",
            tag: "h1",
            bid: "heading-1",
            children: [{ text: "My Presentation" }],
          },
          {
            type: "paragraph",
            bid: "paragraph-1",
            children: [{ text: "Key findings from our research." }],
          },
        ],
      },
    },
    visuals: new Map(),
    themePackageId: "clarity",
    complete,
    ...overrides,
  };
}

function makeInputWithVisual(
  complete: CompleteFn,
  overrides: { embeddedVisual?: Visual; inventoryVisual?: Visual } = {},
): RunDeckGenerationInput {
  const visual: Visual = overrides.embeddedVisual ?? {
    version: VISUAL_SCHEMA_VERSION,
    type: "flowchart",
    title: "Journey map",
    width: 960,
    height: 540,
    nodes: [{ id: "n1", label: "Start" }],
    edges: [],
    style: { ...DEFAULT_STYLE },
  };
  const inventoryVisual = overrides.inventoryVisual ?? visual;
  return {
    contentJson: {
      root: {
        children: [
          {
            type: "heading",
            tag: "h1",
            bid: "heading-1",
            children: [{ text: "My Presentation" }],
          },
          {
            type: "visual",
            visualId: "visual-1",
            visual,
          },
        ],
      },
    },
    visuals: new Map([["visual-1", inventoryVisual]]),
    themePackageId: "clarity",
    complete,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runDeckGeneration", () => {
  test("produces a schemaVersion 7 deck", async () => {
    const result = await runDeckGeneration(
      makeInput(makeStubComplete(VALID_PLAN_JSON)),
    );
    assert.equal(result.deck.schemaVersion, DECK_SCHEMA_VERSION);
  });

  test("deck has at least one slide per plan slide", async () => {
    const result = await runDeckGeneration(
      makeInput(makeStubComplete(VALID_PLAN_JSON)),
    );
    assert.equal(result.deck.slides.length, 2);
  });

  test("deck theme packageId matches input", async () => {
    const result = await runDeckGeneration(
      makeInput(makeStubComplete(VALID_PLAN_JSON)),
    );
    assert.equal(result.deck.theme.packageId, "clarity");
  });

  test("selectedKindCounts reflect compiled slide kinds", async () => {
    const result = await runDeckGeneration(
      makeInput(makeStubComplete(VALID_PLAN_JSON)),
    );
    assert.equal(result.selectedKindCounts["cover"], 1);
    assert.equal(result.selectedKindCounts["content"], 1);
  });

  test("deck canvas defaults to 16:9", async () => {
    const result = await runDeckGeneration(
      makeInput(makeStubComplete(VALID_PLAN_JSON)),
    );
    assert.equal(result.deck.canvas.format, "16:9");
  });

  test("custom canvas is preserved", async () => {
    const canvas = {
      format: "4:3" as const,
      width: 100,
      height: 75,
      unit: "percent" as const,
    };
    const result = await runDeckGeneration(
      makeInput(makeStubComplete(VALID_PLAN_JSON), { canvas }),
    );
    assert.equal(result.deck.canvas.format, "4:3");
  });

  test("slide nodes have generated ids (not AI-provided)", async () => {
    const result = await runDeckGeneration(
      makeInput(makeStubComplete(VALID_PLAN_JSON)),
    );
    for (const slide of result.deck.slides) {
      assert.ok(typeof slide.id === "string" && slide.id.length > 0);
      // Generated ids follow the prefix-counter pattern from template compiler
      assert.ok(
        slide.id.startsWith("slide-"),
        `Expected slide id to start with "slide-", got "${slide.id}"`,
      );
    }
  });

  test("slide template kind matches plan kind", async () => {
    const result = await runDeckGeneration(
      makeInput(makeStubComplete(VALID_PLAN_JSON)),
    );
    assert.equal(result.deck.slides[0].template.kind, "cover");
    assert.equal(result.deck.slides[1].template.kind, "content");
  });

  test("truncated flag comes from source extraction", async () => {
    const result = await runDeckGeneration(
      makeInput(makeStubComplete(VALID_PLAN_JSON)),
    );
    // Small content never truncates
    assert.equal(result.truncated, false);
  });

  test("repair diagnostic for unknown kind surfaces in result diagnostics", async () => {
    const planWithUnknownKind = JSON.stringify({
      planVersion: 1,
      planner: "ai",
      mode: "faithful",
      source: { contentHash: "ignored-by-repair", truncated: false },
      locale: "en",
      slides: [
        {
          id: "plan-slide-1",
          kind: "not-a-real-kind",
          sourceBlockIds: ["heading-1"],
          slotSources: { title: ["heading-1"] },
          slots: { title: { type: "shortText", text: "T" } },
        },
      ],
    });
    const result = await runDeckGeneration(
      makeInput(makeStubComplete(planWithUnknownKind)),
    );
    // Repair maps unknown kind to "content" with a warning
    assert.equal(result.deck.slides[0].template.kind, "content");
    assert.ok(
      result.diagnostics.some((d) => d.code === "unknown-template-kind"),
      "Expected unknown-template-kind diagnostic",
    );
  });

  test("rejects empty outline", async () => {
    await assert.rejects(
      runDeckGeneration(
        makeInput(makeStubComplete(VALID_PLAN_JSON), {
          contentJson: { root: { children: [] } },
        }),
      ),
      /empty/i,
    );
  });

  test("rejects after max attempts when AI returns garbage", async () => {
    const badComplete: CompleteFn = async () => "not json at all {{{";
    await assert.rejects(
      runDeckGeneration(makeInput(badComplete, { maxAttempts: 1 })),
      /Could not generate/i,
    );
  });

  test("retries malformed slot payload through normal repair path", async () => {
    const malformedPlan = JSON.stringify({
      planVersion: 1,
      planner: "ai",
      mode: "faithful",
      source: { contentHash: "ignored-by-repair", truncated: false },
      slides: [
        {
          id: "plan-slide-1",
          kind: "cover",
          sourceBlockIds: ["heading-1"],
          slotSources: { title: ["heading-1"] },
          slots: {
            title: { type: "shortText", text: { bad: true } },
          },
        },
      ],
    });

    const { complete, getCallCount } = makeSequenceComplete([
      malformedPlan,
      VALID_PLAN_JSON,
    ]);

    const result = await runDeckGeneration(
      makeInput(complete, { maxAttempts: 2 }),
    );
    assert.equal(getCallCount(), 2);
    assert.equal(result.deck.slides.length, 2);
  });

  test("rejects malformed slot payload with final generation error", async () => {
    const malformedPlan = JSON.stringify({
      planVersion: 1,
      planner: "ai",
      mode: "faithful",
      source: { contentHash: "ignored-by-repair", truncated: false },
      slides: [
        {
          id: "plan-slide-1",
          kind: "cover",
          sourceBlockIds: ["heading-1"],
          slotSources: { title: ["heading-1"] },
          slots: {
            title: { type: "shortText", text: { bad: true } },
          },
        },
      ],
    });

    await assert.rejects(
      runDeckGeneration(
        makeInput(makeStubComplete(malformedPlan), { maxAttempts: 1 }),
      ),
      /Could not generate a valid presentation document slide plan/i,
    );
  });

  test("deck asset registry is initialized empty", async () => {
    const result = await runDeckGeneration(
      makeInput(makeStubComplete(VALID_PLAN_JSON)),
    );
    assert.deepEqual(result.deck.assets.images, {});
  });

  test("plan locale is preserved in deck metadata", async () => {
    const frPlan = JSON.stringify({
      planVersion: 1,
      planner: "ai",
      mode: "faithful",
      source: { contentHash: "ignored-by-repair", truncated: false },
      locale: "fr",
      slides: [
        {
          id: "plan-slide-1",
          kind: "cover",
          sourceBlockIds: ["heading-1"],
          slotSources: { title: ["heading-1"] },
          slots: { title: { type: "shortText", text: "Ma Présentation" } },
        },
      ],
    });
    const result = await runDeckGeneration(makeInput(makeStubComplete(frPlan)));
    assert.equal(result.deck.metadata?.locale, "fr");
  });

  test("visual source plans compile visualId slots into visual nodes", async () => {
    const visualPlan = JSON.stringify({
      planVersion: 1,
      planner: "ai",
      mode: "faithful",
      source: { contentHash: "ignored-by-repair", truncated: false },
      slides: [
        {
          id: "plan-slide-1",
          kind: "visual-focus",
          sourceBlockIds: ["visual-1"],
          slotSources: {
            title: ["visual-1"],
            visualId: ["visual-1"],
          },
          slots: {
            title: { type: "shortText", text: "Journey map" },
            visualId: { type: "visual", visualId: "visual-1" },
          },
        },
      ],
    });
    const result = await runDeckGeneration(
      makeInputWithVisual(makeStubComplete(visualPlan)),
    );
    const visualNode = result.deck.slides
      .flatMap((slide) => collectNodes(slide.children))
      .find((node) => node.type === "visual");
    assert.equal(visualNode?.type, "visual");
    if (visualNode?.type !== "visual") return;
    assert.equal(visualNode.content.visualId, "visual-1");
  });

  test("prompt visual inventory uses authoritative input visuals map", async () => {
    const visualPlan = JSON.stringify({
      planVersion: 1,
      planner: "ai",
      mode: "faithful",
      source: { contentHash: "ignored-by-repair", truncated: false },
      slides: [
        {
          id: "plan-slide-1",
          kind: "visual-focus",
          sourceBlockIds: ["visual-1"],
          slotSources: {
            title: ["visual-1"],
            visualId: ["visual-1"],
          },
          slots: {
            title: { type: "shortText", text: "Authoritative journey" },
            visualId: { type: "visual", visualId: "visual-1" },
          },
        },
      ],
    });
    const embeddedVisual: Visual = {
      version: VISUAL_SCHEMA_VERSION,
      type: "flowchart",
      title: "Embedded journey",
      width: 960,
      height: 540,
      nodes: [{ id: "n1", label: "Embedded node" }],
      edges: [],
      style: { ...DEFAULT_STYLE },
    };
    const inventoryVisual: Visual = {
      ...embeddedVisual,
      title: "Authoritative journey",
      nodes: [{ id: "n1", label: "Authoritative node" }],
    };
    let capturedMessages: Parameters<CompleteFn>[0] | undefined;
    const complete: CompleteFn = async (messages) => {
      capturedMessages = messages;
      return visualPlan;
    };

    await runDeckGeneration(
      makeInputWithVisual(complete, { embeddedVisual, inventoryVisual }),
    );

    const userContent = capturedMessages?.[1]?.content ?? "";
    assert.ok(
      userContent.includes(
        "visual-1 | Authoritative journey (flowchart): Authoritative node",
      ),
    );
    assert.ok(
      !userContent.includes(
        "visual-1 | Embedded journey (flowchart): Embedded node",
      ),
    );
  });
});
