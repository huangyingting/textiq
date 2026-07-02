import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { Deck } from "@/lib/presentation/schema";
import {
  DeckGenerationDiagnosticsNotice,
  diffDecks,
} from "./deck-generation-preview";

function makeSlide(
  id: string,
  options: { notes?: string } = {},
): Deck["slides"][number] {
  return {
    id,
    type: "slide",
    template: { kind: "content" },
    style: { ref: "slide.content" },
    children: [],
    ...(options.notes ? { notes: options.notes } : {}),
  };
}

function makeDeck(slides: Deck["slides"]): Deck {
  return {
    schemaVersion: 7,
    canvas: { format: "16:9", width: 100, height: 56.25, unit: "percent" },
    theme: { packageId: "neutral" },
    assets: { images: {} },
    slides,
  };
}

test("shows deduped AI diagnostics review affordance in preview", () => {
  const html = renderToStaticMarkup(
    createElement(DeckGenerationDiagnosticsNotice, {
      diagnosticsCount: 1,
      isRegenerating: false,
      onReview: () => undefined,
    }),
  );

  assert.match(html, /AI generation reported 1 diagnostic/);
  assert.match(html, /Review AI diagnostics \(1\)/);
});

test("classifies reordered, changed, unchanged, and added proposal slides", () => {
  const baseline = makeDeck([
    makeSlide("slide-a", { notes: "A" }),
    makeSlide("slide-b", { notes: "B" }),
    makeSlide("slide-c", { notes: "C" }),
  ]);

  const proposal = makeDeck([
    makeSlide("slide-c", { notes: "C" }),
    makeSlide("slide-b", { notes: "B (updated)" }),
    makeSlide("slide-a", { notes: "A" }),
    makeSlide("slide-d", { notes: "D" }),
  ]);

  const diff = diffDecks(baseline, proposal);

  assert.deepEqual(
    diff.entries.map((entry) => entry.status),
    ["unchanged", "changed", "unchanged", "added"],
  );
  assert.equal(diff.added, 1);
  assert.equal(diff.changed, 1);
  assert.equal(diff.summary, "4 slides — 1 new, 1 changed, 2 unchanged");
});

test("diffs large deterministic decks without per-slide baseline scans", () => {
  const baselineCount = 800;
  const baselineSlides = Array.from({ length: baselineCount }, (_, index) =>
    makeSlide(`slide-${index + 1}`, { notes: `baseline-${index + 1}` }),
  );
  let findPredicateCalls = 0;
  const originalFind = baselineSlides.find.bind(baselineSlides);
  const wrappedFind: typeof baselineSlides.find = ((
    predicate: (
      value: Deck["slides"][number],
      index: number,
      obj: Deck["slides"],
    ) => unknown,
    thisArg?: unknown,
  ) =>
    originalFind((slide, index, slides) => {
      findPredicateCalls++;
      return predicate.call(thisArg, slide, index, slides);
    })) as typeof baselineSlides.find;
  Object.defineProperty(baselineSlides, "find", { value: wrappedFind });

  const baseline = makeDeck(baselineSlides);
  const proposalSlides = baselineSlides
    .slice()
    .reverse()
    .map((slide, index) =>
      makeSlide(slide.id, {
        notes:
          index === 200 ? `${slide.notes ?? slide.id}-updated` : slide.notes,
      }),
    );
  proposalSlides.push(makeSlide("slide-added", { notes: "added" }));
  const proposal = makeDeck(proposalSlides);

  const baselineSlideRefs = new Set(baselineSlides);
  const proposalSlideRefs = new Set(proposalSlides);
  let baselineSerializeCalls = 0;
  let proposalSerializeCalls = 0;
  const diff = diffDecks(baseline, proposal, {
    stringifySlide: (slide) => {
      if (baselineSlideRefs.has(slide)) baselineSerializeCalls++;
      if (proposalSlideRefs.has(slide)) proposalSerializeCalls++;
      return JSON.stringify(slide);
    },
  });

  assert.equal(findPredicateCalls, 0);
  assert.equal(baselineSerializeCalls, baselineCount);
  assert.equal(proposalSerializeCalls, baselineCount);
  assert.equal(diff.added, 1);
  assert.equal(diff.changed, 1);
  assert.equal(
    diff.summary,
    `${baselineCount + 1} slides — 1 new, 1 changed, ${baselineCount - 1} unchanged`,
  );
});
