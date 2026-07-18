import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  emptySlideSpecFromLayout,
  slideSpecFromSlide,
} from "@/lib/presentation/slide-spec";
import type { SlideChildNode } from "@/lib/presentation/schema";
import { createDefaultTemplateRegistry } from "@/lib/presentation/theme-packages";
import {
  buildLayoutBox,
  buildSlide,
  buildTableNode,
  buildTextNode,
  buildVisualNode,
} from "@/test/builders/presentation-deck";

function buildGroupNode(
  id: string,
  children: SlideChildNode[],
): Extract<SlideChildNode, { type: "group" }> {
  return {
    id,
    type: "group",
    component: "custom",
    layout: buildLayoutBox(),
    children,
  };
}

describe("slide spec projection", () => {
  test("projects paragraph text into body slot and preserves tone and notes", () => {
    const slide = buildSlide(
      "content",
      [
        buildTextNode({
          id: "body-node",
          role: "body",
          content: {
            paragraphs: [
              {
                id: "p1",
                text: "First paragraph",
                runs: [{ text: "ignored run text", bold: true }],
              },
              { id: "p2", text: "Second paragraph" },
            ],
          },
        }),
      ],
      {
        controls: { tone: "confident", density: "airy", emphasis: "balanced" },
        notes: "Speaker note",
      },
    );

    const spec = slideSpecFromSlide(slide, "content");

    assert.deepEqual(spec.slots.body, {
      type: "paragraph",
      paragraphs: ["First paragraph", "Second paragraph"],
    });
    assert.equal(spec.tone, "confident");
    assert.equal(spec.speakerNotes, "Speaker note");
  });

  test("prefers explicit slot over role mapping", () => {
    const slide = buildSlide("cover", [
      buildTextNode({
        id: "title-node",
        role: "title",
        slot: "subtitle",
        content: {
          paragraphs: [{ id: "p1", text: "Explicit subtitle slot" }],
        },
      }),
    ]);

    const spec = slideSpecFromSlide(slide, "cover");

    assert.deepEqual(spec.slots.subtitle, {
      type: "shortText",
      text: "Explicit subtitle slot",
    });
    assert.equal(spec.slots.title, undefined);
  });

  test("traverses nested groups when collecting text slots", () => {
    const slide = buildSlide("quote", [
      buildGroupNode("group-root", [
        buildTextNode({
          id: "quote-node",
          role: "quote",
          content: { paragraphs: [{ id: "p1", text: "Nested quote text" }] },
        }),
        buildGroupNode("group-inner", [
          buildTextNode({
            id: "attribution-node",
            role: "attribution",
            content: { paragraphs: [{ id: "p2", text: "Nested attribution" }] },
          }),
        ]),
      ]),
    ]);

    const spec = slideSpecFromSlide(slide, "quote");

    assert.deepEqual(spec.slots.quote, {
      type: "shortText",
      text: "Nested quote text",
    });
    assert.deepEqual(spec.slots.attribution, {
      type: "shortText",
      text: "Nested attribution",
    });
  });

  test("projects table nodes into table slots", () => {
    const slide = buildSlide("table", [
      buildTableNode({
        id: "table-node",
        content: {
          columns: [
            { id: "c0", label: "Product" },
            { id: "c1", label: "Revenue" },
          ],
          rows: [
            { id: "r0", cells: [{ text: "A" }, { text: "$10" }] },
            { id: "r1", cells: [{ text: "B" }, { text: "$20" }] },
          ],
          caption: "Quarterly snapshot",
          header: true,
        },
      }),
    ]);

    const spec = slideSpecFromSlide(slide, "table");

    assert.deepEqual(spec.slots.table, {
      type: "table",
      columns: ["Product", "Revenue"],
      rows: [
        ["A", "$10"],
        ["B", "$20"],
      ],
      caption: "Quarterly snapshot",
    });
  });

  test("projects visual nodes into visualId slots", () => {
    const slide = buildSlide("visual-focus", [
      buildVisualNode({
        id: "visual-node",
        role: "visual",
        content: { visualId: "chart-42" },
      }),
    ]);

    const spec = slideSpecFromSlide(slide, "visual-focus");

    assert.deepEqual(spec.slots.visualId, {
      type: "visual",
      visualId: "chart-42",
    });
  });

  test("applies layout defaults for slide and empty layout specs", () => {
    const registry = createDefaultTemplateRegistry();
    const slide = buildSlide(
      "content",
      [
        buildTextNode({
          id: "title-node",
          role: "title",
          content: { paragraphs: [{ id: "p1", text: "Layout defaults" }] },
        }),
      ],
      { controls: { density: "airy", emphasis: "balanced" } },
    );

    const projected = slideSpecFromSlide(
      slide,
      "content",
      "content-dense",
      registry,
    );
    const empty = emptySlideSpecFromLayout(
      "content",
      "content-dense",
      registry,
    );

    assert.equal(projected.density, "dense");
    assert.equal(projected.emphasis, "data");
    assert.deepEqual(empty, {
      kind: "content",
      density: "dense",
      emphasis: "data",
      slots: {},
    });
  });
});
