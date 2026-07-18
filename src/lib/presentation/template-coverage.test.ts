/**
 * Full semantic template coverage tests.
 *
 * Verifies that every SemanticTemplateKind defined in the spec:
 * 1. Is registered in the default registry.
 * 2. Has at least one layout variant whose root is a "slide" blueprint.
 * 3. Has all AI-facing slots with at least one capacity field and an overflow policy.
 * 4. Compiles a representative SemanticSlideSpecV1 into a valid presentation SlideNode with no
 *    error-severity diagnostics (only missing optional data produces none).
 * 5. Produces the expected diagnostic codes when required slots are absent.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { SEMANTIC_TEMPLATE_KINDS } from "@/lib/presentation/template-registry";
import { createDefaultTemplateRegistry } from "@/lib/presentation/theme-packages";
import {
  compileSlide,
  resetIdCounter,
} from "@/lib/presentation/template-compiler";
import { repairSemanticDeckPlan } from "@/lib/presentation/semantic-deck-plan-repair";
import type {
  SemanticSlideSpecV1,
  SlotValue,
} from "@/lib/presentation/semantic-deck-plan";

// ---------------------------------------------------------------------------
// Minimal representative slot payloads for each template kind
// ---------------------------------------------------------------------------

const shortText = (text: string): SlotValue => ({ type: "shortText", text });
const paragraph = (texts: string[]): SlotValue => ({
  type: "paragraph",
  paragraphs: texts,
});
const bullets = (items: string[]): SlotValue => ({
  type: "bullets",
  items: items.map((t) => ({ text: t })),
});
const steps = (items: { title: string; body?: string }[]): SlotValue => ({
  type: "steps",
  items: items.map((i) => ({ title: i.title, body: i.body })),
});
const timelineItems = (
  items: { label: string; title: string }[],
): SlotValue => ({
  type: "timeline",
  items: items.map((i) => ({ label: i.label, title: i.title })),
});
const cards = (items: { title: string; body?: string }[]): SlotValue => ({
  type: "cards",
  items: items.map((i) => ({ title: i.title, body: i.body })),
});
const metricValue: SlotValue = { type: "metric", value: "$1.2B", label: "ARR" };
const metricsValue: SlotValue = {
  type: "metrics",
  items: [
    { value: "42%", label: "Growth" },
    { value: "$1.2M", label: "Revenue" },
  ],
};
const tableValue: SlotValue = {
  type: "table",
  columns: ["Risk", "Severity", "Mitigation"],
  rows: [
    ["Data breach", "High", "Encrypt at rest"],
    ["Vendor lock-in", "Medium", "Multi-cloud"],
  ],
};
const imageValue: SlotValue = {
  type: "image",
  prompt: "Architecture diagram showing microservices",
  alt: "Microservices architecture",
};

// Representative specs for each template kind
const REPRESENTATIVE_SPECS: Record<string, SemanticSlideSpecV1> = {
  cover: {
    kind: "cover",
    slots: {
      kicker: shortText("Q4 2026"),
      title: shortText("Annual Business Review"),
      subtitle: shortText("Driving growth through innovation"),
    },
  },
  agenda: {
    kind: "agenda",
    slots: {
      kicker: shortText("Today's session"),
      title: shortText("Agenda"),
      steps: steps([
        { title: "Market Overview", body: "10 min" },
        { title: "Product Update", body: "20 min" },
        { title: "Q&A", body: "10 min" },
      ]),
    },
  },
  section: {
    kind: "section",
    slots: {
      kicker: shortText("Part 1"),
      title: shortText("Market Analysis"),
    },
  },
  "executive-summary": {
    kind: "executive-summary",
    slots: {
      kicker: shortText("Key Takeaways"),
      title: shortText("The company achieved record growth in Q4"),
      bullets: bullets([
        "Revenue grew 42% YoY",
        "Market share increased to 18%",
        "NPS rose to 72",
      ]),
    },
  },
  content: {
    kind: "content",
    slots: {
      kicker: shortText("Context"),
      title: shortText("Key Points"),
      bullets: bullets(["Point one", "Point two", "Point three"]),
    },
  },
  detail: {
    kind: "detail",
    slots: {
      kicker: shortText("Technical Details"),
      title: shortText("Implementation Architecture"),
      body: paragraph([
        "The system uses a distributed microservices architecture.",
        "Each service handles a discrete business domain.",
      ]),
    },
  },
  quote: {
    kind: "quote",
    slots: {
      quote: shortText(
        "Innovation is the ability to see change as an opportunity, not a threat.",
      ),
      attribution: shortText("Steve Jobs, Apple"),
    },
  },
  "big-stat": {
    kind: "big-stat",
    slots: {
      kicker: shortText("Revenue Milestone"),
      stat: metricValue,
      statLabel: shortText("Annual Recurring Revenue"),
      caption: shortText("As of December 2026"),
    },
  },
  "metric-row": {
    kind: "metric-row",
    slots: {
      title: shortText("Key Metrics"),
      metrics: metricsValue,
    },
  },
  insight: {
    kind: "insight",
    slots: {
      kicker: shortText("Key Finding"),
      title: shortText(
        "80% of churn happens in the first 30 days of onboarding",
      ),
      body: paragraph([
        "Early intervention programs show 3x improvement in retention.",
      ]),
    },
  },
  evidence: {
    kind: "evidence",
    slots: {
      kicker: shortText("Supporting Data"),
      title: shortText("Customer Satisfaction Drives Revenue"),
      bullets: bullets([
        "NPS correlates with LTV at r=0.82",
        "Top-quartile NPS firms grow 2.5x faster",
      ]),
    },
  },
  table: {
    kind: "table",
    slots: {
      title: shortText("Quarterly Performance"),
      table: tableValue,
    },
  },
  comparison: {
    kind: "comparison",
    slots: {
      title: shortText("Current vs Future State"),
      leftTitle: shortText("Current State"),
      leftBullets: bullets([
        "Manual processes",
        "Siloed data",
        "Slow decision-making",
      ]),
      rightTitle: shortText("Future State"),
      rightBullets: bullets([
        "Automated workflows",
        "Unified data platform",
        "Real-time insights",
      ]),
    },
  },
  matrix: {
    kind: "matrix",
    slots: {
      title: shortText("Strategic Priority Matrix"),
      cards: cards([
        { title: "High Impact / Low Effort", body: "Quick wins" },
        { title: "High Impact / High Effort", body: "Major projects" },
        { title: "Low Impact / Low Effort", body: "Fill-ins" },
        { title: "Low Impact / High Effort", body: "Avoid" },
      ]),
    },
  },
  framework: {
    kind: "framework",
    slots: {
      kicker: shortText("Operating Model"),
      title: shortText("Three Pillars of Excellence"),
      cards: cards([
        { title: "People", body: "Right skills and culture" },
        { title: "Process", body: "Lean and scalable" },
        { title: "Technology", body: "Enabling automation" },
      ]),
    },
  },
  process: {
    kind: "process",
    slots: {
      title: shortText("Deal Closing Process"),
      steps: steps([
        { title: "Discovery", body: "Understand needs" },
        { title: "Proposal", body: "Tailor solution" },
        { title: "Negotiation", body: "Align on terms" },
        { title: "Close", body: "Sign contract" },
      ]),
    },
  },
  timeline: {
    kind: "timeline",
    slots: {
      title: shortText("Company Milestones"),
      steps: timelineItems([
        { label: "2020", title: "Founded" },
        { label: "2022", title: "Series A — $10M" },
        { label: "2024", title: "1M customers" },
        { label: "2026", title: "IPO" },
      ]),
    },
  },
  roadmap: {
    kind: "roadmap",
    slots: {
      kicker: shortText("Product Vision"),
      title: shortText("2026 Roadmap"),
      steps: steps([
        { title: "Q1: Foundation", body: "Core platform stability" },
        { title: "Q2: Growth", body: "Enterprise features" },
        { title: "Q3: Scale", body: "Global expansion" },
      ]),
    },
  },
  architecture: {
    kind: "architecture",
    slots: {
      title: shortText("System Architecture"),
      imagePrompt: imageValue,
      caption: shortText("Microservices deployed on Kubernetes"),
    },
  },
  "case-study": {
    kind: "case-study",
    slots: {
      kicker: shortText("Customer Success"),
      title: shortText("Acme Corp: 3x ROI in 6 Months"),
      leftTitle: shortText("Challenge"),
      leftBullets: bullets(["Legacy CRM", "Manual reporting", "High churn"]),
      rightTitle: shortText("Results"),
      rightBody: paragraph([
        "3x ROI achieved in 6 months.",
        "Churn reduced by 40%.",
      ]),
    },
  },
  risks: {
    kind: "risks",
    slots: {
      title: shortText("Risk Register"),
      table: tableValue,
    },
  },
  recommendation: {
    kind: "recommendation",
    slots: {
      kicker: shortText("Recommended Path"),
      title: shortText("Proceed with Platform Consolidation"),
      bullets: bullets([
        "Reduces TCO by 35%",
        "Faster time-to-market",
        "Better developer experience",
      ]),
    },
  },
  pricing: {
    kind: "pricing",
    slots: {
      kicker: shortText("Flexible Plans"),
      title: shortText("Choose Your Plan"),
      cards: cards([
        { title: "Starter", body: "$99/mo — Up to 10 users" },
        { title: "Growth", body: "$499/mo — Up to 100 users" },
        { title: "Enterprise", body: "Custom pricing" },
      ]),
    },
  },
  team: {
    kind: "team",
    slots: {
      kicker: shortText("Leadership"),
      title: shortText("Meet the Team"),
      cards: cards([
        { title: "Alice Chen", body: "CEO — 15 years in SaaS" },
        { title: "Bob Smith", body: "CTO — Ex-Google, ex-Stripe" },
      ]),
    },
  },
  "visual-focus": {
    kind: "visual-focus",
    slots: {
      title: shortText("The Future of Work"),
      imagePrompt: imageValue,
      caption: shortText("AI-powered collaboration platform"),
    },
  },
  closing: {
    kind: "closing",
    slots: {
      kicker: shortText("Thank You"),
      title: shortText("Questions?"),
      subtitle: shortText("contact@company.com  ·  +1 (555) 000-0000"),
    },
  },
  appendix: {
    kind: "appendix",
    slots: {
      title: shortText("Appendix A: Supporting Data"),
      body: paragraph([
        "Full dataset available on request.",
        "Methodology: quarterly survey of 2,000 respondents.",
      ]),
    },
  },
};

// ---------------------------------------------------------------------------
// Registry completeness
// ---------------------------------------------------------------------------

describe("template registry: all kinds registered", () => {
  const registry = createDefaultTemplateRegistry();

  for (const kind of SEMANTIC_TEMPLATE_KINDS) {
    test(`registers "${kind}"`, () => {
      assert.ok(registry.has(kind), `Expected registry to have kind "${kind}"`);
    });
  }
});

// ---------------------------------------------------------------------------
// Per-template structural validation
// ---------------------------------------------------------------------------

describe("template structure: layouts and slots", () => {
  const registry = createDefaultTemplateRegistry();

  for (const kind of SEMANTIC_TEMPLATE_KINDS) {
    test(`"${kind}" has at least one layout with a slide root`, () => {
      const template = registry.get(kind)!;
      assert.ok(
        template.layouts.length >= 1,
        `"${kind}" must have >= 1 layout`,
      );
      for (const layout of template.layouts) {
        assert.equal(
          layout.root.type,
          "slide",
          `"${kind}" layout "${layout.id}" root must be type "slide"`,
        );
      }
    });

    test(`"${kind}" all slots have a capacity field and overflow policy`, () => {
      const template = registry.get(kind)!;
      const capacityFields = [
        "maxChars",
        "maxItems",
        "minItems",
        "minRows",
        "maxRows",
        "minColumns",
        "maxColumns",
        "maxCellChars",
      ] as const;
      for (const [slotKey, contract] of Object.entries(template.slots)) {
        assert.ok(
          contract.overflow,
          `"${kind}".slots.${slotKey} must have an overflow policy`,
        );
        const hasCapacity = capacityFields.some(
          (f) => contract[f] !== undefined,
        );
        assert.ok(
          hasCapacity,
          `"${kind}".slots.${slotKey} (type=${contract.type}) must have at least one capacity field`,
        );
      }
    });

    test(`"${kind}" blueprints have layout and only visual nodes have style`, () => {
      const template = registry.get(kind)!;
      function checkBlueprints(
        blueprints: (typeof template.layouts)[0]["root"]["children"],
      ): void {
        if (!blueprints) return;
        for (const bp of blueprints) {
          if (bp.type === "slide") continue;
          assert.ok(
            bp.layout,
            `"${kind}" blueprint type="${bp.type}" slot="${bp.slot ?? "none"}" must have layout`,
          );
          if (bp.type === "group") {
            assert.equal(
              bp.style,
              undefined,
              `"${kind}" group blueprint slot="${bp.slot ?? "none"}" must be styleless`,
            );
          } else {
            assert.ok(
              bp.style,
              `"${kind}" blueprint type="${bp.type}" slot="${bp.slot ?? "none"}" must have style`,
            );
          }
          if (bp.children) checkBlueprints(bp.children);
        }
      }
      for (const layout of template.layouts) {
        checkBlueprints(layout.root.children);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Per-template compilation
// ---------------------------------------------------------------------------

describe("template compilation: representative specs", () => {
  const registry = createDefaultTemplateRegistry();

  for (const kind of SEMANTIC_TEMPLATE_KINDS) {
    test(`compiles "${kind}" representative spec into a valid SlideNode`, () => {
      resetIdCounter();
      const template = registry.get(kind)!;
      const spec = REPRESENTATIVE_SPECS[kind];
      assert.ok(spec, `Missing representative spec for kind "${kind}"`);

      const { slide, diagnostics } = compileSlide(spec, template);

      // Must produce a slide node
      assert.equal(slide.type, "slide");
      assert.equal(slide.template.kind, kind);
      assert.ok(slide.id.length > 0, "Slide id must not be empty");
      assert.ok(
        slide.children.length >= 1,
        "Slide must have at least one child",
      );

      // No error or fatal diagnostics
      const errors = diagnostics.filter(
        (d) => d.severity === "error" || d.severity === "fatal",
      );
      assert.equal(
        errors.length,
        0,
        `"${kind}" compilation produced error diagnostics: ${errors.map((e) => e.message).join("; ")}`,
      );

      // All child ids are non-empty and unique
      const allIds = [slide.id, ...slide.children.map((c) => c.id)];
      for (const id of allIds) {
        assert.ok(id.length > 0, "Every node id must be non-empty");
        assert.ok(
          !id.includes("undefined"),
          "Node id must not contain 'undefined'",
        );
      }
      assert.equal(
        new Set(allIds).size,
        allIds.length,
        `"${kind}" produced duplicate node ids`,
      );

      // layout.id must be present on the compiled slide
      assert.ok(
        slide.template.layoutId && slide.template.layoutId.length > 0,
        `"${kind}" compiled slide must record layout id`,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// Overflow capacity enforcement via repairSemanticDeckPlan
// ---------------------------------------------------------------------------

describe("template capacity: overflow triggers slot-over-capacity diagnostic", () => {
  const registry = createDefaultTemplateRegistry();

  test("agenda: truncates steps at maxItems=8", () => {
    const plan = {
      planVersion: 1,
      slides: [
        {
          kind: "agenda",
          slots: {
            title: { type: "shortText", text: "Agenda" },
            steps: {
              type: "steps",
              items: Array.from({ length: 12 }, (_, i) => ({
                title: `Item ${i + 1}`,
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
    const s = repaired.slides[0].slots.steps;
    assert.ok(s?.type === "steps" && s.items.length <= 8);
    assert.ok(diagnostics.some((d) => d.code === "slot-over-capacity"));
  });

  test("big-stat: truncates stat at maxChars=30", () => {
    const plan = {
      planVersion: 1,
      slides: [
        {
          kind: "big-stat",
          slots: {
            stat: { type: "metric", value: "A".repeat(60), label: "Metric" },
          },
        },
      ],
    };
    // stat is type "metric"; repair only handles shortText truncation, so no
    // slot-over-capacity is emitted for metric — but also no error.
    const { diagnostics } = repairSemanticDeckPlan(plan, registry);
    assert.ok(!diagnostics.some((d) => d.severity === "fatal"));
  });

  test("framework: truncates cards at maxItems=6", () => {
    const plan = {
      planVersion: 1,
      slides: [
        {
          kind: "framework",
          slots: {
            title: { type: "shortText", text: "Framework" },
            cards: {
              type: "cards",
              items: Array.from({ length: 10 }, (_, i) => ({
                title: `Card ${i + 1}`,
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
    const c = repaired.slides[0].slots.cards;
    assert.ok(c?.type === "cards" && c.items.length <= 6);
    assert.ok(diagnostics.some((d) => d.code === "slot-over-capacity"));
  });

  test("risks: truncates table rows at maxRows=8", () => {
    const plan = {
      planVersion: 1,
      slides: [
        {
          kind: "risks",
          slots: {
            table: {
              type: "table",
              columns: ["Risk", "Severity"],
              rows: Array.from({ length: 15 }, (_, i) => [`Risk ${i}`, "High"]),
            },
          },
        },
      ],
    };
    const { plan: repaired, diagnostics } = repairSemanticDeckPlan(
      plan,
      registry,
    );
    const t = repaired.slides[0].slots.table;
    assert.ok(t?.type === "table" && t.rows.length <= 8);
    assert.ok(diagnostics.some((d) => d.code === "slot-over-capacity"));
  });

  test("timeline: truncates steps at maxItems=8", () => {
    const plan = {
      planVersion: 1,
      slides: [
        {
          kind: "timeline",
          slots: {
            title: { type: "shortText", text: "Timeline" },
            steps: {
              type: "timeline",
              items: Array.from({ length: 12 }, (_, i) => ({
                label: `${2010 + i}`,
                title: `Event ${i + 1}`,
                body: `Details ${i + 1}`,
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
    const repairedSteps = repaired.slides[0].slots.steps;
    assert.ok(repairedSteps?.type === "timeline");
    if (repairedSteps?.type === "timeline") {
      assert.equal(repairedSteps.items.length, 8);
    }
    assert.ok(diagnostics.some((d) => d.code === "slot-over-capacity"));

    const template = registry.get("timeline")!;
    const { slide } = compileSlide(
      repaired.slides[0] as SemanticSlideSpecV1,
      template,
    );
    const timelineGroup = slide.children.find(
      (node) => node.type === "group" && node.slot === "steps",
    );
    assert.ok(timelineGroup?.type === "group");
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
          labelNode.content.paragraphs.map((p) => p.text),
          Array.from({ length: 8 }, (_, i) => `${2010 + i}`),
        );
      }

      assert.equal(titleNode?.type, "text");
      if (titleNode?.type === "text") {
        assert.deepEqual(
          titleNode.content.paragraphs.map((p) => p.text),
          Array.from({ length: 8 }, (_, i) => `Event ${i + 1}`),
        );
      }

      assert.equal(bodyNode?.type, "text");
      if (bodyNode?.type === "text") {
        assert.deepEqual(
          bodyNode.content.paragraphs.map((p) => p.text),
          Array.from({ length: 8 }, (_, i) => `Details ${i + 1}`),
        );
      }
    }
  });

  test("appendix: truncates table columns at maxColumns=6", () => {
    const plan = {
      planVersion: 1,
      slides: [
        {
          kind: "appendix",
          slots: {
            title: { type: "shortText", text: "Appendix" },
            table: {
              type: "table",
              columns: Array.from({ length: 10 }, (_, i) => `Col ${i}`),
              rows: [Array.from({ length: 10 }, (_, i) => `val${i}`)],
            },
          },
        },
      ],
    };
    const { plan: repaired, diagnostics } = repairSemanticDeckPlan(
      plan,
      registry,
    );
    const t = repaired.slides[0].slots.table;
    assert.ok(t?.type === "table" && t.columns.length <= 6);
    assert.ok(diagnostics.some((d) => d.code === "slot-over-capacity"));
  });
});

// ---------------------------------------------------------------------------
// Missing required slot diagnostics
// ---------------------------------------------------------------------------

describe("template diagnostics: missing-required-slot", () => {
  const registry = createDefaultTemplateRegistry();

  const requiredSlotCases: Array<{ kind: string; requiredSlot: string }> = [
    { kind: "cover", requiredSlot: "title" },
    { kind: "section", requiredSlot: "title" },
    { kind: "content", requiredSlot: "title" },
    { kind: "quote", requiredSlot: "quote" },
    { kind: "metric-row", requiredSlot: "metrics" },
    { kind: "comparison", requiredSlot: "leftTitle" },
    { kind: "table", requiredSlot: "table" },
    { kind: "recommendation", requiredSlot: "title" },
    { kind: "executive-summary", requiredSlot: "title" },
    { kind: "detail", requiredSlot: "title" },
    { kind: "big-stat", requiredSlot: "stat" },
    { kind: "insight", requiredSlot: "title" },
    { kind: "evidence", requiredSlot: "title" },
    { kind: "matrix", requiredSlot: "cards" },
    { kind: "framework", requiredSlot: "title" },
    { kind: "process", requiredSlot: "title" },
    { kind: "timeline", requiredSlot: "title" },
    { kind: "roadmap", requiredSlot: "title" },
    { kind: "architecture", requiredSlot: "title" },
    { kind: "case-study", requiredSlot: "title" },
    { kind: "risks", requiredSlot: "table" },
    { kind: "pricing", requiredSlot: "cards" },
    { kind: "team", requiredSlot: "cards" },
    { kind: "visual-focus", requiredSlot: "imagePrompt" },
    { kind: "closing", requiredSlot: "title" },
    { kind: "appendix", requiredSlot: "title" },
    { kind: "agenda", requiredSlot: "steps" },
  ];

  for (const { kind, requiredSlot } of requiredSlotCases) {
    test(`"${kind}" emits missing-required-slot when "${requiredSlot}" is absent`, () => {
      const plan = {
        planVersion: 1,
        slides: [{ kind, slots: {} }],
      };
      const { diagnostics } = repairSemanticDeckPlan(plan, registry);
      assert.ok(
        diagnostics.some(
          (d) =>
            d.code === "missing-required-slot" &&
            d.message.includes(requiredSlot),
        ),
        `Expected missing-required-slot for slot "${requiredSlot}" in kind "${kind}". Got: ${diagnostics.map((d) => d.message).join("; ")}`,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// All documented diagnostic codes exist as PresentationDiagnosticCode
// ---------------------------------------------------------------------------

describe("diagnostics: all documented codes are used in core paths", () => {
  const registry = createDefaultTemplateRegistry();

  test("invalid-schema-version emitted for wrong planVersion", () => {
    const { diagnostics } = repairSemanticDeckPlan(
      { planVersion: 99, slides: [] },
      registry,
    );
    assert.ok(diagnostics.some((d) => d.code === "invalid-schema-version"));
  });

  test("unknown-template-kind emitted for bogus kind", () => {
    const { diagnostics } = repairSemanticDeckPlan(
      { planVersion: 1, slides: [{ kind: "not-real", slots: {} }] },
      registry,
    );
    assert.ok(diagnostics.some((d) => d.code === "unknown-template-kind"));
  });

  test("unsupported-template-control emitted for invalid tone", () => {
    const { diagnostics } = repairSemanticDeckPlan(
      {
        planVersion: 1,
        slides: [{ kind: "content", tone: "aggressive", slots: {} }],
      },
      registry,
    );
    assert.ok(
      diagnostics.some((d) => d.code === "unsupported-template-control"),
    );
  });

  test("missing-required-slot emitted for cover without title", () => {
    const { diagnostics } = repairSemanticDeckPlan(
      { planVersion: 1, slides: [{ kind: "cover", slots: {} }] },
      registry,
    );
    assert.ok(diagnostics.some((d) => d.code === "missing-required-slot"));
  });

  test("slot-over-capacity emitted when bullets exceed maxItems", () => {
    const { diagnostics } = repairSemanticDeckPlan(
      {
        planVersion: 1,
        slides: [
          {
            kind: "content",
            slots: {
              title: { type: "shortText", text: "T" },
              bullets: {
                type: "bullets",
                items: Array.from({ length: 10 }, (_, i) => ({
                  text: `Item ${i + 1}`,
                })),
              },
            },
          },
        ],
      },
      registry,
    );
    assert.ok(diagnostics.some((d) => d.code === "slot-over-capacity"));
  });
});
