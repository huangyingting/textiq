import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { repairDocumentSlidePlan } from "./document-slide-plan-repair";
import type { DocumentSourcePlanV1 } from "./document-source-plan";

const sourcePlan: DocumentSourcePlanV1 = {
  planVersion: 1,
  documentId: "doc-1",
  contentHash: "hash-1",
  truncated: false,
  originalChars: 100,
  keptChars: 100,
  sections: [
    {
      id: "section-1",
      title: "Section",
      sourceBlockIds: ["h1", "p1", "p2"],
      blocks: [],
    },
  ],
  visualInventory: [],
};

describe("repairDocumentSlidePlan", () => {
  test("returns a fatal empty plan for non-object input", () => {
    const result = repairDocumentSlidePlan({ input: null, sourcePlan });
    assert.equal(result.plan.planner, "ai");
    assert.equal(result.plan.source.documentId, "doc-1");
    assert.equal(result.plan.slides.length, 0);
    assert.equal(result.diagnostics[0]?.severity, "fatal");
  });

  test("repairs semantic slots while preserving valid provenance and controls", () => {
    const result = repairDocumentSlidePlan({
      sourcePlan,
      input: {
        planVersion: 1,
        title: "Deck title",
        locale: "en-US",
        mode: "presentationRewrite",
        omittedBlockIds: ["p2", "missing-deck"],
        slides: [
          {
            id: "custom-slide",
            kind: "content",
            sourceBlockIds: ["h1", "missing", "p1", "p1"],
            slotSources: { title: ["h1", "bad"], bullets: ["p1"] },
            controls: { tone: "technical", density: "dense", emphasis: "data" },
            slots: {
              title: { type: "shortText", text: "Overview" },
              bullets: { type: "bullets", items: [{ text: "First" }] },
            },
            speakerNotes: "Talk track",
            rationale: "Grounded in source",
            omittedBlockIds: ["p2", "missing-slide"],
          },
        ],
      },
    });

    assert.equal(result.plan.mode, "presentationRewrite");
    assert.equal(result.plan.title, "Deck title");
    assert.equal(result.plan.locale, "en-US");
    assert.equal(result.plan.slides[0]?.id, "custom-slide");
    assert.deepEqual(result.plan.slides[0]?.sourceBlockIds, ["h1", "p1"]);
    assert.deepEqual(result.plan.slides[0]?.slotSources, {
      title: ["h1"],
      bullets: ["p1"],
    });
    assert.deepEqual(result.plan.slides[0]?.controls, {
      tone: "technical",
      density: "dense",
      emphasis: "data",
    });
    assert.equal(result.plan.slides[0]?.speakerNotes, "Talk track");
    assert.equal(result.plan.slides[0]?.rationale, "Grounded in source");
    assert.deepEqual(result.plan.slides[0]?.omittedBlockIds, ["p2"]);
    assert.deepEqual(result.plan.omittedBlockIds, ["p2"]);
    assert.ok(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "missing-source-block" &&
          diagnostic.details?.blockId === "missing",
      ),
    );
  });

  test("defaults ids, mode, and malformed optional provenance", () => {
    const result = repairDocumentSlidePlan({
      sourcePlan: { ...sourcePlan, documentId: undefined },
      input: {
        planVersion: 1,
        mode: "bad",
        slides: [
          {
            id: "",
            kind: "cover",
            sourceBlockIds: "h1",
            slotSources: "bad",
            slots: { title: { type: "shortText", text: "Cover" } },
            omittedBlockIds: "p1",
          },
        ],
      },
    });

    assert.equal(result.plan.mode, "faithful");
    assert.equal(result.plan.source.documentId, undefined);
    assert.equal(result.plan.slides[0]?.id, "plan-slide-1");
    assert.deepEqual(result.plan.slides[0]?.sourceBlockIds, []);
    assert.deepEqual(result.plan.slides[0]?.slotSources, {});
    assert.equal(result.plan.slides[0]?.omittedBlockIds, undefined);
  });
});
