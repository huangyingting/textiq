/**
 * Template registry, compiler, and AI plan repair tests.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  SEMANTIC_TEMPLATE_KINDS,
  isSemanticTemplateKind,
  selectLayout,
} from "@/lib/presentation/template-registry";
import { createDefaultTemplateRegistry } from "@/lib/presentation/theme-packages";
import {
  compileSlide,
  resetIdCounter,
} from "@/lib/presentation/template-compiler";
import { repairSemanticDeckPlan } from "@/lib/presentation/semantic-deck-plan-repair";
import type { SemanticSlideSpecV1 } from "@/lib/presentation/semantic-deck-plan";
import type { SemanticTemplateV1 } from "@/lib/presentation/template-registry";

describe("SEMANTIC_TEMPLATE_KINDS", () => {
  test("contains all 27 documented kinds", () => {
    assert.equal(SEMANTIC_TEMPLATE_KINDS.length, 27);
    assert.ok(SEMANTIC_TEMPLATE_KINDS.includes("cover"));
    assert.ok(SEMANTIC_TEMPLATE_KINDS.includes("appendix"));
    assert.ok(SEMANTIC_TEMPLATE_KINDS.includes("metric-row"));
  });

  test("isSemanticTemplateKind accepts valid kinds", () => {
    assert.ok(isSemanticTemplateKind("cover"));
    assert.ok(isSemanticTemplateKind("comparison"));
    assert.ok(isSemanticTemplateKind("closing"));
  });

  test("isSemanticTemplateKind rejects invalid kinds", () => {
    assert.ok(!isSemanticTemplateKind("not-a-kind"));
    assert.ok(!isSemanticTemplateKind(""));
    assert.ok(!isSemanticTemplateKind(null));
  });
});

describe("createDefaultTemplateRegistry", () => {
  test("registers all 26 kinds", () => {
    const registry = createDefaultTemplateRegistry();
    for (const kind of SEMANTIC_TEMPLATE_KINDS) {
      assert.ok(registry.has(kind), `Expected registry to have kind "${kind}"`);
    }
  });

  test("each template has at least one layout", () => {
    const registry = createDefaultTemplateRegistry();
    for (const template of registry.all()) {
      assert.ok(
        template.layouts.length >= 1,
        `Template "${template.kind}" has no layouts`,
      );
    }
  });

  test("each layout root is type=slide", () => {
    const registry = createDefaultTemplateRegistry();
    for (const template of registry.all()) {
      for (const layout of template.layouts) {
        assert.equal(
          layout.root.type,
          "slide",
          `Template "${template.kind}" layout "${layout.id}" root is not "slide"`,
        );
      }
    }
  });
});

describe("selectLayout", () => {
  test("returns exact density+emphasis match", () => {
    resetIdCounter();
    const registry = createDefaultTemplateRegistry();
    const template = registry.get("content")!;
    const layout = selectLayout(template, "dense", "data");
    assert.equal(layout.id, "content-dense");
  });

  test("returns first layout when no match", () => {
    resetIdCounter();
    const registry = createDefaultTemplateRegistry();
    const template = registry.get("cover")!;
    const layout = selectLayout(template);
    assert.equal(layout.id, "cover-default");
  });
});

describe("compileSlide", () => {
  test("compiles a cover slide with title slot", () => {
    resetIdCounter();
    const registry = createDefaultTemplateRegistry();
    const template = registry.get("cover")!;
    const spec: SemanticSlideSpecV1 = {
      kind: "cover",
      slots: {
        title: { type: "shortText", text: "My Presentation" },
        subtitle: { type: "shortText", text: "Q4 Results" },
      },
    };
    const { slide, diagnostics } = compileSlide(spec, template);
    assert.equal(slide.type, "slide");
    assert.equal(slide.template.kind, "cover");
    assert.ok(slide.children.length >= 1, "Expected at least one child");
    // Find title node
    const titleNode = slide.children.find((n) => n.slot === "title");
    assert.ok(titleNode, "Expected a node with slot=title");
    if (titleNode && titleNode.type === "text") {
      assert.equal(titleNode.content.paragraphs[0].text, "My Presentation");
    }
    assert.ok(!diagnostics.some((d) => d.severity === "error"));
  });

  test("compiles a content slide with bullets", () => {
    resetIdCounter();
    const registry = createDefaultTemplateRegistry();
    const template = registry.get("content")!;
    const spec: SemanticSlideSpecV1 = {
      kind: "content",
      density: "airy",
      slots: {
        title: { type: "shortText", text: "Key Points" },
        bullets: {
          type: "bullets",
          items: [{ text: "Point one" }, { text: "Point two" }],
        },
      },
    };
    const { slide, diagnostics } = compileSlide(spec, template);
    assert.equal(slide.template.layoutId, "content-airy");
    const bulletNode = slide.children.find((n) => n.slot === "bullets");
    assert.ok(bulletNode, "Expected bullets node");
    if (bulletNode && bulletNode.type === "text") {
      assert.ok(bulletNode.content.paragraphs.length >= 2);
    }
    assert.ok(!diagnostics.some((d) => d.severity === "error"));
  });

  test("uses readable fallback text when a text blueprint has no slot or static content", () => {
    resetIdCounter();
    const template: SemanticTemplateV1 = {
      schemaVersion: 1,
      kind: "content",
      label: "Fallback Text",
      version: "1.0.0",
      group: "explain",
      intent: "Verify fallback text.",
      slots: {} as SemanticTemplateV1["slots"],
      supports: {
        tone: ["technical"],
        density: ["normal"],
        emphasis: ["balanced"],
      },
      layouts: [
        {
          id: "fallback-text-layout",
          density: ["normal"],
          emphasis: ["balanced"],
          root: {
            type: "slide",
            style: { ref: "slide.content" },
            children: [
              {
                type: "text",
                role: "label",
                layout: { frame: { x: 10, y: 10, w: 20, h: 8 }, zIndex: 1 },
                style: { ref: "text.caption" },
              },
            ],
          },
        },
      ],
      selection: { priority: 1, bestFor: "fallback", signals: [] },
    };

    const { slide } = compileSlide({ kind: "content", slots: {} }, template);
    const label = slide.children[0];
    assert.equal(label?.type, "text");
    if (label?.type === "text") {
      assert.equal(label.content.paragraphs[0]?.text, "Label");
    }
  });

  test("maps template local zIndex into type layer bands", () => {
    resetIdCounter();
    const template: SemanticTemplateV1 = {
      schemaVersion: 1,
      kind: "content",
      label: "Layer Bands",
      version: "1.0.0",
      group: "explain",
      intent: "Verify type layer bands.",
      slots: {} as SemanticTemplateV1["slots"],
      supports: {
        tone: ["technical"],
        density: ["normal"],
        emphasis: ["balanced"],
      },
      layouts: [
        {
          id: "layer-bands-layout",
          density: ["normal"],
          emphasis: ["balanced"],
          root: {
            type: "slide",
            style: { ref: "slide.content" },
            children: [
              {
                type: "shape",
                role: "card",
                layout: { frame: { x: 10, y: 10, w: 30, h: 20 }, zIndex: 900 },
                style: { ref: "surface.card" },
              },
              {
                type: "text",
                role: "label",
                layout: { frame: { x: 12, y: 12, w: 26, h: 8 }, zIndex: 1 },
                style: { ref: "text.caption" },
              },
            ],
          },
        },
      ],
      selection: { priority: 1, bestFor: "layering", signals: [] },
    };

    const { slide } = compileSlide({ kind: "content", slots: {} }, template);
    const shape = slide.children.find((node) => node.type === "shape");
    const text = slide.children.find((node) => node.type === "text");
    assert.equal(shape?.layout?.zIndex, 1900);
    assert.equal(text?.layout?.zIndex, 4001);
    assert.ok((text?.layout?.zIndex ?? 0) > (shape?.layout?.zIndex ?? 0));
  });

  test("compiles a table slide", () => {
    resetIdCounter();
    const registry = createDefaultTemplateRegistry();
    const template = registry.get("table")!;
    const spec: SemanticSlideSpecV1 = {
      kind: "table",
      slots: {
        title: { type: "shortText", text: "Data Table" },
        table: {
          type: "table",
          columns: ["Name", "Value"],
          rows: [
            ["A", "100"],
            ["B", "200"],
          ],
        },
      },
    };
    const { slide, diagnostics } = compileSlide(spec, template);
    const tableNode = slide.children.find((n) => n.slot === "table");
    assert.ok(tableNode, "Expected table node");
    if (tableNode && tableNode.type === "table") {
      assert.equal(tableNode.content.columns.length, 2);
      assert.equal(tableNode.content.rows.length, 2);
    }
    assert.ok(!diagnostics.some((d) => d.severity === "error"));
  });

  test("materialises timeline slot items into timeline group text nodes", () => {
    resetIdCounter();
    const registry = createDefaultTemplateRegistry();
    const template = registry.get("timeline")!;
    const spec: SemanticSlideSpecV1 = {
      kind: "timeline",
      slots: {
        title: { type: "shortText", text: "Milestones" },
        steps: {
          type: "timeline",
          items: [
            { label: "2022", title: "Started", body: "Team formed" },
            { label: "2023", title: "Scaled", body: "Series A" },
            { label: "2024", title: "Expanded", body: "Global launch" },
          ],
        },
      },
    };

    const { slide, diagnostics } = compileSlide(spec, template);
    const timelineGroup = slide.children.find(
      (node) => node.type === "group" && node.slot === "steps",
    );
    assert.ok(timelineGroup?.type === "group", "Expected timeline group node");

    if (timelineGroup?.type === "group") {
      const labelNode = timelineGroup.children.find(
        (node) => node.type === "text" && node.role === "label",
      );
      const titleNode = timelineGroup.children.find(
        (node) => node.type === "text" && node.role === "title",
      );
      const bodyNode = timelineGroup.children.find(
        (node) => node.type === "text" && node.role === "body",
      );

      assert.equal(labelNode?.type, "text");
      if (labelNode?.type === "text") {
        assert.deepEqual(
          labelNode.content.paragraphs.map((paragraph) => paragraph.text),
          ["2022", "2023", "2024"],
        );
      }

      assert.equal(titleNode?.type, "text");
      if (titleNode?.type === "text") {
        assert.deepEqual(
          titleNode.content.paragraphs.map((paragraph) => paragraph.text),
          ["Started", "Scaled", "Expanded"],
        );
      }

      assert.equal(bodyNode?.type, "text");
      if (bodyNode?.type === "text") {
        assert.deepEqual(
          bodyNode.content.paragraphs.map((paragraph) => paragraph.text),
          ["Team formed", "Series A", "Global launch"],
        );
      }
    }

    assert.ok(!diagnostics.some((d) => d.severity === "error"));
  });

  test("generates unique node ids (never copies AI ids)", () => {
    resetIdCounter();
    const registry = createDefaultTemplateRegistry();
    const template = registry.get("cover")!;
    const spec: SemanticSlideSpecV1 = {
      kind: "cover",
      slots: { title: { type: "shortText", text: "Hi" } },
    };
    const { slide } = compileSlide(spec, template);
    // Node ids must not equal any 'AI' ids — check they follow generator pattern
    const allIds = [slide.id, ...slide.children.map((c) => c.id)];
    for (const id of allIds) {
      assert.ok(id.length > 0, "Node id must not be empty");
      assert.ok(
        !id.includes("undefined"),
        "Node id must not contain 'undefined'",
      );
    }
    // All ids must be unique
    assert.equal(
      new Set(allIds).size,
      allIds.length,
      "All node ids must be unique",
    );
  });

  test("preserves speaker notes", () => {
    resetIdCounter();
    const registry = createDefaultTemplateRegistry();
    const template = registry.get("cover")!;
    const spec: SemanticSlideSpecV1 = {
      kind: "cover",
      slots: { title: { type: "shortText", text: "Hello" } },
      speakerNotes: "Remember to pause here.",
    };
    const { slide } = compileSlide(spec, template);
    assert.equal(slide.notes, "Remember to pause here.");
  });

  test("materialises all blueprint node types and emits diagnostics for unknown nodes", () => {
    resetIdCounter();
    const layout = {
      frame: { x: 0, y: 0, w: 20, h: 10 },
      zIndex: 1,
    };
    const template: SemanticTemplateV1 = {
      schemaVersion: 1,
      kind: "content",
      label: "All nodes",
      version: "1.0.0",
      group: "explain",
      intent: "Exercise every blueprint node type.",
      slots: {} as SemanticTemplateV1["slots"],
      supports: {
        tone: ["technical"],
        density: ["dense"],
        emphasis: ["data"],
      },
      layouts: [
        {
          id: "all-nodes",
          density: ["dense"],
          emphasis: ["data"],
          root: {
            type: "slide",
            style: { ref: "slide.content" },
            children: [
              {
                type: "text",
                role: "body",
                slot: "body",
                layout,
                style: { ref: "text.body" },
              },
              {
                type: "text",
                role: "metric",
                slot: "stat",
                layout,
                style: { ref: "text.metric" },
              },
              {
                type: "image",
                role: "image",
                slot: "imagePrompt",
                layout,
                style: { ref: "media.inline" },
              },
              {
                type: "visual",
                role: "visual",
                slot: "visualId",
                layout,
                style: { ref: "chart.primary" },
              },
              {
                type: "table",
                role: "table",
                slot: "table",
                layout,
                style: { ref: "surface.table" },
              },
              {
                type: "shape",
                role: "callout",
                layout,
                style: { ref: "surface.callout" },
                content: { type: "text", text: "Static shape" },
              },
              {
                type: "group",
                component: "custom",
                role: "card",
                layout,
              },
              {
                type: "video" as never,
                role: "visual",
                layout,
                style: { ref: "surface.card" },
              },
            ],
          },
        },
      ],
      selection: {
        priority: 1,
        bestFor: "coverage",
        signals: [],
      },
    };
    const spec: SemanticSlideSpecV1 = {
      kind: "content",
      tone: "technical",
      density: "dense",
      emphasis: "data",
      slots: {
        body: { type: "paragraph", paragraphs: ["One", "Two"] },
        stat: { type: "metric", value: "42", label: "Answer" },
        imagePrompt: { type: "image", assetId: "img-1", alt: "Hero image" },
        visualId: { type: "visual", visualId: "chart-1" },
        table: {
          type: "table",
          columns: ["Metric"],
          rows: [["NPS"]],
          caption: "Metrics",
        },
      },
      speakerNotes: "All nodes note",
    };

    const { slide, diagnostics } = compileSlide(spec, template, 3);

    assert.deepEqual(slide.controls, {
      tone: "technical",
      density: "dense",
      emphasis: "data",
    });
    assert.equal(slide.template.layoutId, "all-nodes");
    assert.equal(slide.notes, "All nodes note");
    assert.equal(slide.children.length, 7);

    const [paragraph, metric, image, visual, table, shape, group] =
      slide.children;
    assert.equal(paragraph?.type, "text");
    if (paragraph?.type === "text") {
      assert.deepEqual(
        paragraph.content.paragraphs.map((item) => item.text),
        ["One", "Two"],
      );
    }
    assert.equal(metric?.type, "text");
    if (metric?.type === "text") {
      assert.equal(metric.content.paragraphs[0]?.text, "42");
    }
    assert.equal(image?.type, "image");
    if (image?.type === "image") {
      assert.equal(image.content.assetId, "img-1");
      assert.equal(image.content.alt, "Hero image");
    }
    assert.equal(visual?.type, "visual");
    if (visual?.type === "visual") {
      assert.equal(visual.content.visualId, "chart-1");
    }
    assert.equal(table?.type, "table");
    if (table?.type === "table") {
      assert.equal(table.content.caption, "Metrics");
      assert.equal(table.content.header, true);
    }
    assert.equal(shape?.type, "shape");
    if (shape?.type === "shape") {
      assert.deepEqual(shape.content, { shape: "rect" });
    }
    assert.equal(group?.type, "group");
    if (group?.type === "group") {
      assert.equal("style" in group, false);
      assert.equal(group.children[0]?.type, "shape");
    }
    assert.ok(
      diagnostics.some(
        (diagnostic) => diagnostic.code === "unknown-template-kind",
      ),
    );
  });

  test("falls back to placeholders when slots do not match blueprint content", () => {
    resetIdCounter();
    const layout = {
      frame: { x: 0, y: 0, w: 10, h: 10 },
      zIndex: 1,
    };
    const template: SemanticTemplateV1 = {
      schemaVersion: 1,
      kind: "content",
      label: "Fallbacks",
      version: "1.0.0",
      group: "explain",
      intent: "Exercise fallback placeholder materialization.",
      slots: {} as SemanticTemplateV1["slots"],
      supports: { tone: [], density: [], emphasis: [] },
      layouts: [
        {
          id: "fallbacks",
          density: [],
          emphasis: [],
          root: {
            type: "slide",
            style: { ref: "slide.content" },
            children: [
              {
                type: "text",
                role: "body",
                slot: "body",
                layout,
                style: { ref: "text.body" },
                content: { type: "text", text: "Static fallback" },
              },
              {
                type: "image",
                role: "image",
                slot: "imagePrompt",
                layout,
                style: { ref: "media.inline" },
              },
              {
                type: "visual",
                role: "visual",
                slot: "visualId",
                layout,
                style: { ref: "chart.primary" },
              },
              {
                type: "table",
                role: "table",
                slot: "table",
                layout,
                style: { ref: "surface.table" },
              },
            ],
          },
        },
      ],
      selection: { priority: 1, bestFor: "fallbacks", signals: [] },
    };
    const spec: SemanticSlideSpecV1 = {
      kind: "content",
      slots: {
        body: { type: "image", assetId: undefined },
        imagePrompt: { type: "paragraph", paragraphs: ["Wrong type"] },
        visualId: { type: "image", assetId: "visual-as-image" },
        table: { type: "shortText", text: "Wrong type" },
      },
    };

    const { slide } = compileSlide(spec, template);
    const [text, image, visual, table] = slide.children;

    assert.equal(text?.type, "text");
    if (text?.type === "text") {
      assert.equal(text.content.paragraphs[0]?.text, "Static fallback");
    }
    assert.equal(image?.type, "image");
    if (image?.type === "image") {
      assert.equal(image.content.assetId, "placeholder");
    }
    assert.equal(visual?.type, "visual");
    if (visual?.type === "visual") {
      assert.equal(visual.content.assetId, "visual-as-image");
    }
    assert.equal(table?.type, "table");
    if (table?.type === "table") {
      assert.deepEqual(table.content.columns, [
        { id: "col-0", label: "Column 1" },
      ]);
      assert.deepEqual(table.content.rows, [
        { id: "row-0", cells: [{ text: "" }] },
      ]);
    }
  });
});

describe("repairSemanticDeckPlan", () => {
  test("accepts a valid plan", () => {
    const registry = createDefaultTemplateRegistry();
    const plan = {
      planVersion: 1,
      title: "Test",
      slides: [
        {
          kind: "cover",
          slots: { title: { type: "shortText", text: "Hello" } },
        },
      ],
    };
    const { plan: repaired, diagnostics } = repairSemanticDeckPlan(
      plan,
      registry,
    );
    assert.equal(repaired.planVersion, 1);
    assert.equal(repaired.slides.length, 1);
    assert.equal(repaired.slides[0].kind, "cover");
    assert.ok(
      !diagnostics.some(
        (d) => d.severity === "error" || d.severity === "fatal",
      ),
    );
  });

  test("repairs unknown template kind to 'content'", () => {
    const registry = createDefaultTemplateRegistry();
    const plan = {
      planVersion: 1,
      slides: [
        {
          kind: "totally-unknown-kind",
          slots: {},
        },
      ],
    };
    const { plan: repaired, diagnostics } = repairSemanticDeckPlan(
      plan,
      registry,
    );
    assert.equal(repaired.slides[0].kind, "content");
    assert.ok(
      diagnostics.some((d) => d.code === "unknown-template-kind"),
      "Expected unknown-template-kind diagnostic",
    );
  });

  test("repairs unknown tone", () => {
    const registry = createDefaultTemplateRegistry();
    const plan = {
      planVersion: 1,
      slides: [
        {
          kind: "content",
          tone: "aggressive",
          slots: {},
        },
      ],
    };
    const { plan: repaired, diagnostics } = repairSemanticDeckPlan(
      plan,
      registry,
    );
    assert.equal(repaired.slides[0].tone, undefined);
    assert.ok(
      diagnostics.some((d) => d.code === "unsupported-template-control"),
    );
  });

  test("truncates over-capacity bullets", () => {
    const registry = createDefaultTemplateRegistry();
    const plan = {
      planVersion: 1,
      slides: [
        {
          kind: "content",
          slots: {
            bullets: {
              type: "bullets",
              items: Array.from({ length: 10 }, (_, i) => ({
                text: `Item ${i + 1}`,
              })),
            },
          },
        },
      ],
    };
    const { plan: repaired, diagnostics } = repairSemanticDeckPlan(
      plan,
      registry,
    );
    const bullets = repaired.slides[0].slots.bullets;
    assert.ok(bullets?.type === "bullets" && bullets.items.length <= 6);
    assert.ok(diagnostics.some((d) => d.code === "slot-over-capacity"));
  });

  test("errors on non-object input", () => {
    const registry = createDefaultTemplateRegistry();
    const { plan: repaired, diagnostics } = repairSemanticDeckPlan(
      "not-a-plan",
      registry,
    );
    assert.ok(diagnostics.some((d) => d.severity === "fatal"));
    assert.equal(repaired.slides.length, 0);
  });

  test("errors on wrong planVersion", () => {
    const registry = createDefaultTemplateRegistry();
    const { diagnostics } = repairSemanticDeckPlan(
      { planVersion: 2, slides: [] },
      registry,
    );
    assert.ok(diagnostics.some((d) => d.code === "invalid-schema-version"));
  });

  test("errors on missing required slot", () => {
    const registry = createDefaultTemplateRegistry();
    // cover template requires title
    const plan = {
      planVersion: 1,
      slides: [{ kind: "cover", slots: {} }],
    };
    const { diagnostics } = repairSemanticDeckPlan(plan, registry);
    assert.ok(
      diagnostics.some((d) => d.code === "missing-required-slot"),
      "Expected missing-required-slot diagnostic",
    );
  });

  test("truncates over-capacity table rows", () => {
    const registry = createDefaultTemplateRegistry();
    const plan = {
      planVersion: 1,
      slides: [
        {
          kind: "table",
          slots: {
            table: {
              type: "table",
              columns: ["A", "B"],
              rows: Array.from({ length: 15 }, (_, i) => [
                `Row ${i}`,
                `${i * 10}`,
              ]),
            },
          },
        },
      ],
    };
    const { plan: repaired, diagnostics } = repairSemanticDeckPlan(
      plan,
      registry,
    );
    const table = repaired.slides[0].slots.table;
    assert.ok(table?.type === "table" && table.rows.length <= 10);
    assert.ok(diagnostics.some((d) => d.code === "slot-over-capacity"));
  });

  test("truncates over-capacity shortText to maxChars", () => {
    const registry = createDefaultTemplateRegistry();
    // cover template has title with maxChars: 120
    const longTitle = "A".repeat(150);
    const plan = {
      planVersion: 1,
      slides: [
        {
          kind: "cover",
          slots: {
            title: { type: "shortText", text: longTitle },
          },
        },
      ],
    };
    const { plan: repaired, diagnostics } = repairSemanticDeckPlan(
      plan,
      registry,
    );
    const title = repaired.slides[0].slots.title;
    assert.ok(title?.type === "shortText" && title.text.length <= 120);
    assert.ok(diagnostics.some((d) => d.code === "slot-over-capacity"));
  });

  test("truncates over-capacity paragraph items", () => {
    const registry = createDefaultTemplateRegistry();
    // content template has body (paragraph) with maxItems: 3
    const plan = {
      planVersion: 1,
      slides: [
        {
          kind: "content",
          slots: {
            body: {
              type: "paragraph",
              paragraphs: Array.from(
                { length: 6 },
                (_, i) => `Paragraph ${i + 1}`,
              ),
            },
          },
        },
      ],
    };
    const { plan: repaired, diagnostics } = repairSemanticDeckPlan(
      plan,
      registry,
    );
    const body = repaired.slides[0].slots.body;
    assert.ok(body?.type === "paragraph" && body.paragraphs.length <= 3);
    assert.ok(diagnostics.some((d) => d.code === "slot-over-capacity"));
  });

  test("drops malformed slot payload shapes and reports diagnostics", () => {
    const registry = createDefaultTemplateRegistry();
    const plan = {
      planVersion: 1,
      slides: [
        {
          kind: "content",
          slots: {
            title: { type: "shortText", text: "Valid title" },
            badShortText: { type: "shortText", text: 123 },
            badParagraph: { type: "paragraph", paragraphs: "not-an-array" },
            badBullets: { type: "bullets", items: [{ text: 99 }] },
            badMetrics: { type: "metrics", items: [{ value: 1, label: "L" }] },
            badCards: { type: "cards", items: [{ title: 1 }] },
            badSteps: { type: "steps", items: [{ title: 2 }] },
            badTable: {
              type: "table",
              columns: ["A", 2],
              rows: [["ok"], ["bad", 3]],
            },
            badTimeline: {
              type: "timeline",
              items: [{ label: 2026, title: "Milestone" }],
            },
            badImage: { type: "image", assetId: 7, prompt: ["bad"] },
            badVisual: { type: "visual", visualId: 11 },
          },
        },
      ],
    };

    const { plan: repaired, diagnostics } = repairSemanticDeckPlan(
      plan,
      registry,
    );
    const slots = repaired.slides[0].slots as Record<string, unknown>;
    const malformedSlotKeys = [
      "badShortText",
      "badParagraph",
      "badBullets",
      "badMetrics",
      "badCards",
      "badSteps",
      "badTable",
      "badTimeline",
      "badImage",
      "badVisual",
    ];

    for (const key of malformedSlotKeys) {
      assert.ok(
        !(key in slots),
        `Expected malformed slot "${key}" to be dropped from repaired output`,
      );
      assert.ok(
        diagnostics.some(
          (d) =>
            d.code === "unknown-field" &&
            d.path?.startsWith(`slides[0].slots.${key}`),
        ),
        `Expected unknown-field diagnostic for malformed slot "${key}"`,
      );
    }
  });

  test("drops known slots with type mismatch and surfaces missing required slot", () => {
    const registry = createDefaultTemplateRegistry();
    const plan = {
      planVersion: 1,
      slides: [
        {
          kind: "cover",
          slots: {
            title: {
              type: "table",
              columns: ["A"],
              rows: [["B"]],
            },
          },
        },
      ],
    };

    const { plan: repaired, diagnostics } = repairSemanticDeckPlan(
      plan,
      registry,
    );
    assert.equal(repaired.slides[0].slots.title, undefined);
    assert.ok(
      diagnostics.some(
        (d) =>
          d.code === "unknown-field" && d.path === "slides[0].slots.title.type",
      ),
      "Expected unknown-field diagnostic for title slot type mismatch",
    );
    assert.ok(
      diagnostics.some((d) => d.code === "missing-required-slot"),
      "Expected missing-required-slot diagnostic after dropping malformed title",
    );
  });

  test("truncates over-capacity table columns", () => {
    const registry = createDefaultTemplateRegistry();
    // table template has table with maxColumns: 6
    const plan = {
      planVersion: 1,
      slides: [
        {
          kind: "table",
          slots: {
            table: {
              type: "table",
              columns: Array.from({ length: 9 }, (_, i) => `Col${i}`),
              rows: [Array.from({ length: 9 }, (_, i) => `v${i}`)],
            },
          },
        },
      ],
    };
    const { plan: repaired, diagnostics } = repairSemanticDeckPlan(
      plan,
      registry,
    );
    const table = repaired.slides[0].slots.table;
    assert.ok(table?.type === "table" && table.columns.length <= 6);
    assert.ok(diagnostics.some((d) => d.code === "slot-over-capacity"));
  });

  test("removes unknown density control", () => {
    const registry = createDefaultTemplateRegistry();
    const plan = {
      planVersion: 1,
      slides: [
        {
          kind: "content",
          density: "extreme",
          slots: {},
        },
      ],
    };
    const { plan: repaired, diagnostics } = repairSemanticDeckPlan(
      plan,
      registry,
    );
    assert.equal(repaired.slides[0].density, undefined);
    assert.ok(
      diagnostics.some((d) => d.code === "unsupported-template-control"),
    );
  });

  test("removes unknown emphasis control", () => {
    const registry = createDefaultTemplateRegistry();
    const plan = {
      planVersion: 1,
      slides: [
        {
          kind: "content",
          emphasis: "unknown-emphasis",
          slots: {},
        },
      ],
    };
    const { plan: repaired, diagnostics } = repairSemanticDeckPlan(
      plan,
      registry,
    );
    assert.equal(repaired.slides[0].emphasis, undefined);
    assert.ok(
      diagnostics.some((d) => d.code === "unsupported-template-control"),
    );
  });

  test("preserves valid tone, density, emphasis without diagnostics", () => {
    const registry = createDefaultTemplateRegistry();
    const plan = {
      planVersion: 1,
      slides: [
        {
          kind: "content",
          tone: "confident",
          density: "dense",
          emphasis: "data",
          slots: {},
        },
      ],
    };
    const { plan: repaired, diagnostics } = repairSemanticDeckPlan(
      plan,
      registry,
    );
    assert.equal(repaired.slides[0].tone, "confident");
    assert.equal(repaired.slides[0].density, "dense");
    assert.equal(repaired.slides[0].emphasis, "data");
    assert.ok(
      !diagnostics.some((d) => d.code === "unsupported-template-control"),
    );
  });

  test("errors on slide that is not an object", () => {
    const registry = createDefaultTemplateRegistry();
    const plan = {
      planVersion: 1,
      slides: [null], // slide must be an object
    };
    const { diagnostics } = repairSemanticDeckPlan(plan, registry);
    assert.ok(diagnostics.some((d) => d.severity === "error"));
  });
});
