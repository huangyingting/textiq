import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type {
  DocumentBlock,
  DocumentTableBlock,
  DocumentTextBlock,
  DocumentVisualBlock,
} from "@/lib/content";
import type { DocumentSourcePlanV1 } from "./document-source-plan";
import {
  deriveDocumentSlidePlanDeterministic,
  documentSlidePlanToSemanticDeckPlan,
  semanticDeckPlanToDocumentSlidePlan,
} from "./document-slide-planner";

const sourcePlan: DocumentSourcePlanV1 = {
  planVersion: 1,
  documentId: "doc-1",
  contentHash: "hash-1",
  truncated: true,
  originalChars: 100,
  keptChars: 80,
  sections: [],
  visualInventory: [],
};

function text(
  blockId: string,
  blockType: DocumentTextBlock["blockType"],
  value: string,
  level?: 1 | 2 | 3,
): DocumentTextBlock {
  return {
    kind: "text",
    blockType,
    text: value,
    ...(level ? { level } : {}),
    blockId,
  };
}

function table(blockId: string, caption?: string): DocumentTableBlock {
  return {
    kind: "table",
    blockId,
    ...(caption ? { caption } : {}),
    columns: [{ id: "metric", label: "Metric" }],
    rows: [{ id: "row-1", cells: [{ text: "ARR" }] }],
  };
}

function visual(blockId: string, visualTitle?: string): DocumentVisualBlock {
  return {
    kind: "visual",
    blockId,
    visualId: `visual-${blockId}`,
    visual: {
      id: `visual-${blockId}`,
      type: "chart",
      title: visualTitle,
      spec: {},
    },
  } as unknown as DocumentVisualBlock;
}

function derive(blocks: DocumentBlock[]) {
  const blockMap = new Map(
    blocks.map((block) => [
      "blockId" in block && block.blockId ? block.blockId : crypto.randomUUID(),
      block,
    ]),
  );
  return deriveDocumentSlidePlanDeterministic({ sourcePlan, blocks, blockMap });
}

describe("document slide planner edge cases", () => {
  test("chunks long text sections and carries title/source provenance", () => {
    const blocks: DocumentBlock[] = [
      text("h1", "heading", "  ", 1),
      text("h2", "heading", "Milestones", 2),
      ...Array.from({ length: 7 }, (_, index) =>
        text(`p${index + 1}`, "paragraph", `Point ${index + 1}`),
      ),
    ];
    const plan = derive(blocks);

    assert.equal(plan.source.truncated, true);
    assert.equal(plan.slides[0]?.kind, "cover");
    assert.equal(plan.slides[0]?.slots.title?.type, "shortText");
    assert.equal(plan.slides[0]?.sourceBlockIds[0], "h1");
    assert.equal(plan.slides[1]?.slots.title?.type, "shortText");
    assert.deepEqual(plan.slides[1]?.slotSources.title, ["h2"]);
    assert.deepEqual(plan.slides[1]?.slotSources.bullets, [
      "p1",
      "p2",
      "p3",
      "p4",
      "p5",
      "p6",
    ]);
    assert.equal(plan.slides[2]?.slots.title?.type, "shortText");
    assert.deepEqual(plan.slides[2]?.slotSources.title, ["p7"]);
  });

  test("handles hr-separated text, tables, visuals, and unmapped blocks", () => {
    const intro = text("intro", "paragraph", "Intro body");
    const hr = text("hr", "hr", "");
    const after = text("after", "paragraph", "After break");
    const captioned = table("table-caption", "Pipeline");
    const plainTable = table("table-plain");
    const titledVisual = visual("visual-title", "  Revenue chart ");
    const untitledVisual = visual("visual-plain");
    const blocks: DocumentBlock[] = [
      intro,
      hr,
      after,
      captioned,
      plainTable,
      titledVisual,
      untitledVisual,
    ];
    const blockMap = new Map<string, DocumentBlock>(
      blocks
        .slice(0, -1)
        .map((block) => [
          ("blockId" in block ? block.blockId : undefined)!,
          block,
        ]),
    );
    const plan = deriveDocumentSlidePlanDeterministic({
      sourcePlan,
      blocks,
      blockMap,
    });

    assert.equal(plan.slides[0]?.kind, "content");
    assert.equal(plan.slides[0]?.sourceBlockIds[0], "intro");
    assert.equal(plan.slides[1]?.kind, "content");
    assert.equal(plan.slides[1]?.slots.title?.type, "shortText");
    assert.equal(plan.slides[2]?.kind, "table");
    assert.deepEqual(plan.slides[2]?.slotSources.caption, ["table-caption"]);
    assert.equal(plan.slides[3]?.kind, "table");
    assert.equal(plan.slides[3]?.slotSources.caption, undefined);
    assert.equal(plan.slides[4]?.kind, "visual-focus");
    assert.equal(plan.slides[4]?.slots.title?.type, "shortText");
    assert.equal(plan.slides[5]?.sourceBlockIds.length, 0);
  });

  test("round-trips semantic plans and preserves optional controls and notes", () => {
    const semantic = documentSlidePlanToSemanticDeckPlan({
      planVersion: 1,
      planner: "ai",
      mode: "presentationRewrite",
      title: "Deck",
      locale: "en-US",
      source: { contentHash: "hash", truncated: false },
      slides: [
        {
          id: "slide-1",
          kind: "content",
          sourceBlockIds: ["p1"],
          slotSources: { title: ["p1"] },
          controls: { tone: "technical", density: "dense", emphasis: "data" },
          slots: { title: { type: "shortText", text: "Title" } },
          speakerNotes: "Notes",
        },
      ],
    });
    assert.deepEqual(semantic.slides[0]?.tone, "technical");
    assert.equal(semantic.slides[0]?.speakerNotes, "Notes");

    const document = semanticDeckPlanToDocumentSlidePlan({
      semanticPlan: semantic,
      sourcePlan,
      planner: "ai",
      mode: "faithful",
    });
    assert.equal(document.title, "Deck");
    assert.deepEqual(document.slides[0]?.controls, {
      tone: "technical",
      density: "dense",
      emphasis: "data",
    });
    assert.equal(document.slides[0]?.speakerNotes, "Notes");
  });
});

test("document planner emits a title-only slide for an empty subsection and skips blank bodies", () => {
  const heading = text("h2-empty", "heading", "Empty subsection", 2);
  const blank = text("blank", "paragraph", "   ");
  const blocks: DocumentBlock[] = [heading, blank];
  const plan = deriveDocumentSlidePlanDeterministic({
    sourcePlan,
    blocks,
    blockMap: new Map([
      ["h2-empty", heading],
      ["blank", blank],
    ]),
  });
  assert.equal(plan.slides.length, 1);
  assert.equal(plan.slides[0]?.kind, "cover");
  assert.deepEqual(plan.slides[0]?.sourceBlockIds, ["h2-empty"]);
  assert.deepEqual(plan.slides[0]?.slotSources, { title: ["h2-empty"] });
});
