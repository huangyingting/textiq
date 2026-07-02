import assert from "node:assert/strict";
import { test } from "node:test";

import { DECK_SCHEMA_VERSION } from "@/lib/presentation/schema";
import type { Deck, SlideNode } from "@/lib/presentation/schema";
import {
  buildDeck,
  buildCoverSlide,
  buildContentSlide,
  buildTableSlide,
  buildVisualSlide,
  buildSlide,
  buildImageNode,
  resetBuilderCounter,
} from "@/test/builders/presentation-deck";
import type { RunDeckGenerationResult } from "@/lib/ai/run-deck-generation";
import { makeDiagnostic } from "@/lib/presentation/diagnostics";

import type { GenerateDeckPayload } from "./parser";
import {
  buildGenerateDeckSuccessLogFields,
  buildGenerateDeckSuccessResponse,
  generateDeckForRoute,
} from "./route-logic";

const CONTENT_JSON = {
  root: { children: [{ type: "paragraph", children: [{ text: "Roadmap" }] }] },
};

function makeDeck(withTable = false): Deck {
  resetBuilderCounter();
  const slides: SlideNode[] = withTable
    ? [buildCoverSlide(), buildTableSlide()]
    : [buildCoverSlide(), buildContentSlide()];
  return buildDeck(slides, { theme: { packageId: "noir" } });
}

function makePayload(): GenerateDeckPayload {
  return {
    contentJson: CONTENT_JSON,
    options: {},
    blocks: [],
    visuals: new Map(),
    outline: "Roadmap\nLaunch plan",
    truncated: false,
    themePackageId: "noir",
  };
}

const complete = async () => "{}";

function makeDeckResult(deck: Deck): RunDeckGenerationResult {
  return {
    deck,
    truncated: false,
    selectedKindCounts: { cover: 1, content: 1 },
    diagnostics: [],
  };
}

test("generateDeckForRoute calls runDeck with correct inputs", async () => {
  let deckCalls = 0;
  const diagnostics = [
    makeDiagnostic("slot-over-capacity", "warning", "Adjusted slot payload", {
      slideId: "slide-1",
    }),
  ];

  const result = await generateDeckForRoute(
    { payload: makePayload(), complete },
    {
      runDeck: async (input) => {
        deckCalls += 1;
        assert.equal(input.themePackageId, "noir");
        return {
          deck: makeDeck(true),
          truncated: true,
          selectedKindCounts: { cover: 1, table: 1 },
          diagnostics,
        };
      },
    },
  );

  assert.equal(deckCalls, 1);
  assert.equal(result.planner, "ai");
  assert.equal(result.mode, "faithful");
  assert.equal(result.themePackageId, "noir");
  assert.deepEqual(result.selectedKindCounts, { cover: 1, table: 1 });
  assert.equal(result.truncated, true);
  assert.deepEqual(result.diagnostics, diagnostics);
});

test("generateDeckForRoute returns a Deck with schemaVersion 7", async () => {
  const deck = makeDeck();
  const result = await generateDeckForRoute(
    { payload: makePayload(), complete },
    { runDeck: async () => makeDeckResult(deck) },
  );
  assert.equal(result.deck.schemaVersion, DECK_SCHEMA_VERSION);
});

test("generateDeckForRoute propagates presentation failures", async () => {
  await assert.rejects(
    generateDeckForRoute(
      { payload: makePayload(), complete, requestId: "req-1" },
      {
        runDeck: async () => {
          throw new Error("generation failed");
        },
      },
    ),
    /generation failed/,
  );
});

test("buildGenerateDeckSuccessResponse includes presentation metadata", () => {
  const deck = makeDeck(true);
  const diagnostics = [
    makeDiagnostic("missing-required-slot", "warning", "Filled missing slot", {
      slideId: "slide-2",
    }),
  ];
  const response = buildGenerateDeckSuccessResponse({
    deck,
    truncated: false,
    diagnostics,
    planner: "ai",
    mode: "faithful",
    themePackageId: "terra",
    selectedKindCounts: { cover: 1, table: 1 },
  });

  assert.equal(response.truncated, false);
  assert.equal(response.metadata.planner, "ai");
  assert.equal(response.metadata.mode, "faithful");
  assert.equal(response.metadata.themePackageId, "terra");
  assert.equal(response.metadata.tableSlideCount, 1);
  assert.equal(response.metadata.schemaValid, true);
  assert.deepEqual(response.diagnostics, diagnostics);
  assert.deepEqual(response.metadata.selectedKindCounts, {
    cover: 1,
    table: 1,
  });
  // deck in response is Deck
  assert.equal(response.deck.schemaVersion, DECK_SCHEMA_VERSION);
});

test("buildGenerateDeckSuccessLogFields includes presentation telemetry", () => {
  const deck = makeDeck(true);
  const fields = buildGenerateDeckSuccessLogFields(
    {
      deck,
      truncated: true,
      diagnostics: [],
      planner: "ai",
      mode: "presentationRewrite",
      themePackageId: "noir",
      selectedKindCounts: { cover: 1, table: 1 },
    },
    {
      payload: makePayload(),
      requestId: "req-2",
      latencyMs: 24,
    },
  );

  assert.equal(fields.requestId, "req-2");
  assert.equal(fields.latencyMs, 24);
  assert.equal(fields.packageId, "noir");
  assert.equal(fields.planner, "ai");
  assert.equal(fields.mode, "presentationRewrite");
  assert.equal(fields.tableSlideCount, 1);
  assert.equal(fields.schemaValid, true);
  assert.deepEqual(fields.selectedKindCounts, { cover: 1, table: 1 });
});

test("computeRouteMetrics: percentSlidesWithVisual never exceeds 1", () => {
  resetBuilderCounter();
  // Slide with TWO image nodes — should count as 1, not 2.
  const twoImageSlide = buildSlide("visual-focus", [
    buildImageNode("img-a"),
    buildImageNode("img-b"),
  ]);
  // One plain content slide (no visuals).
  const plainSlide = buildContentSlide();
  const deck = buildDeck([twoImageSlide, plainSlide]);

  const fields = buildGenerateDeckSuccessLogFields(
    {
      deck,
      truncated: false,
      diagnostics: [],
      planner: "ai",
      mode: "faithful",
    },
    { payload: makePayload(), requestId: "req-3", latencyMs: 10 },
  );

  // 1 out of 2 slides has a visual → exactly 0.5, never > 1.
  assert.equal(fields.percentSlidesWithVisual, 0.5);
});

test("computeRouteMetrics: visual-only deck percentSlidesWithVisual is 1", () => {
  resetBuilderCounter();
  const deck = buildDeck([buildVisualSlide(), buildVisualSlide()]);

  const fields = buildGenerateDeckSuccessLogFields(
    {
      deck,
      truncated: false,
      diagnostics: [],
      planner: "ai",
      mode: "faithful",
    },
    { payload: makePayload(), requestId: "req-4", latencyMs: 5 },
  );

  assert.equal(fields.percentSlidesWithVisual, 1);
});
