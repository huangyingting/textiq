import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildDocumentSourcePlanV1,
  compileDocumentSlidePlanToDeck,
  deriveDocumentSlidePlanDeterministic,
  renderDocumentSourcePlanForPrompt,
} from "./document-slide-plan";
import { AI_GENERATION_INPUT_MAX_CHARS } from "@/lib/limits/ai";
import type { SlideChildNode } from "./schema";
import type { JsonValue } from "./types";

function jsonObject(value: JsonValue | undefined) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined;
}

function collectNodes(nodes: ReadonlyArray<SlideChildNode>): SlideChildNode[] {
  const flattened: SlideChildNode[] = [];
  const walk = (list: ReadonlyArray<SlideChildNode>) => {
    for (const node of list) {
      flattened.push(node);
      if (node.type === "group") {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return flattened;
}

function contentJson() {
  return JSON.stringify({
    root: {
      type: "root",
      children: [
        {
          type: "heading",
          tag: "h1",
          bid: "heading-1",
          children: [{ type: "text", text: "Launch plan" }],
        },
        {
          type: "paragraph",
          bid: "paragraph-1",
          children: [{ type: "text", text: "Ship the beta in September." }],
        },
        {
          type: "table",
          bid: "table-1",
          children: [
            {
              type: "tablerow",
              children: [
                {
                  type: "tablecell",
                  children: [{ type: "text", text: "KPI" }],
                },
                {
                  type: "tablecell",
                  children: [{ type: "text", text: "Target" }],
                },
              ],
            },
            {
              type: "tablerow",
              children: [
                {
                  type: "tablecell",
                  children: [{ type: "text", text: "Trials" }],
                },
                {
                  type: "tablecell",
                  children: [{ type: "text", text: "500" }],
                },
              ],
            },
          ],
        },
      ],
    },
  });
}

test("buildDocumentSourcePlanV1 extracts sections, block ids, and content hash", () => {
  const result = buildDocumentSourcePlanV1({
    contentJson: contentJson(),
    documentId: "doc-1",
  });

  assert.equal(result.sourcePlan.planVersion, 1);
  assert.equal(result.sourcePlan.documentId, "doc-1");
  assert.match(result.sourcePlan.contentHash, /^[0-9a-f]{8}$/);
  assert.equal(result.sourcePlan.sections.length, 1);
  assert.deepEqual(result.sourcePlan.sections[0]?.sourceBlockIds, [
    "heading-1",
    "paragraph-1",
    "table-1",
  ]);
  assert.equal(result.blockMap.get("table-1")?.kind, "table");
});

test("buildDocumentSourcePlanV1 budgets sections to the prompted source plan", () => {
  const children: JsonValue[] = [
    {
      type: "heading",
      tag: "h1",
      bid: "heading-1",
      children: [{ type: "text", text: "Large source" }],
    },
  ];
  for (let i = 0; i < 120; i++) {
    children.push({
      type: "paragraph",
      bid: `paragraph-${i}`,
      children: [{ type: "text", text: `detail ${i} ${"x".repeat(200)}` }],
    });
  }

  const result = buildDocumentSourcePlanV1({
    contentJson: JSON.stringify({
      root: {
        type: "root",
        children,
      },
    }),
  });
  const rendered = renderDocumentSourcePlanForPrompt(result.sourcePlan);

  assert.equal(result.sourcePlan.truncated, true);
  assert.ok(result.sourcePlan.originalChars > AI_GENERATION_INPUT_MAX_CHARS);
  assert.equal(result.sourcePlan.keptChars, rendered.length);
  assert.ok(
    rendered.length <= AI_GENERATION_INPUT_MAX_CHARS,
    `source plan prompt length ${rendered.length} exceeds ${AI_GENERATION_INPUT_MAX_CHARS}`,
  );
  assert.ok(rendered.includes("heading-1"));
  assert.ok(!rendered.includes("detail 119"));
});

test("deterministic planner emits DocumentSlidePlanV1 with slot source ids", () => {
  const source = buildDocumentSourcePlanV1({ contentJson: contentJson() });
  const plan = deriveDocumentSlidePlanDeterministic(source);

  assert.equal(plan.planner, "deterministic");
  assert.equal(plan.mode, "faithful");
  assert.equal(plan.source.contentHash, source.sourcePlan.contentHash);
  assert.ok(plan.slides.some((slide) => slide.kind === "table"));
  const contentSlide = plan.slides.find((slide) => slide.kind === "content");
  assert.deepEqual(contentSlide?.slotSources.bullets, ["paragraph-1"]);
});

test("compileDocumentSlidePlanToDeck stores deck and node provenance", () => {
  const source = buildDocumentSourcePlanV1({
    contentJson: contentJson(),
    documentId: "doc-1",
  });
  const plan = deriveDocumentSlidePlanDeterministic(source);
  const compiled = compileDocumentSlidePlanToDeck({
    plan,
    blockMap: source.blockMap,
    linkedAt: "2026-07-02T00:00:00.000Z",
    themePackageId: "clarity",
  });

  assert.equal(compiled.ok, true);
  if (!compiled.ok) return;
  const deckDerivation = jsonObject(compiled.deck.metadata?.extra?.derivation);
  assert.equal(compiled.deck.theme.packageId, "clarity");
  assert.equal(deckDerivation?.planner, "deterministic");
  assert.deepEqual(deckDerivation?.sourceBlockIds, [
    "heading-1",
    "paragraph-1",
    "table-1",
  ]);

  const allNodes = compiled.deck.slides.flatMap((slide) =>
    collectNodes(slide.children),
  );
  const sourced = allNodes.find(
    (node) => node.source?.extra?.derivation !== undefined,
  );
  const nodeDerivation = jsonObject(sourced?.source?.extra?.derivation);
  assert.equal(sourced?.source?.documentId, "doc-1");
  assert.equal(nodeDerivation?.pipelineVersion, 1);
});
