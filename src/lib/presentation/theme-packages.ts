/**
 * Built-in semantic template definitions for the presentation system.
 *
 * Full SemanticTemplateV1 contracts for all 27 documented template kinds:
 * cover, agenda, section, executive-summary, content, detail, quote, big-stat,
 * metric-row, insight, evidence, table, comparison, matrix, framework, process,
 * timeline, roadmap, architecture, case-study, risks, recommendation, pricing,
 * team, visual-focus, closing, appendix.
 *
 * Each template declares typed slots with capacity limits and deterministic
 * overflow policies per the spec. Each has at least one layout variant whose
 * root is a slide blueprint with correctly positioned child nodes.
 */

import type { SemanticTemplateV1 } from "./template-registry";
import { SemanticTemplateRegistry } from "./template-registry";

// ---------------------------------------------------------------------------
// Shared style bindings used across templates
// ---------------------------------------------------------------------------

const SLIDE_COVER_STYLE = { ref: "slide.cover" as const };
const SLIDE_CONTENT_STYLE = { ref: "slide.content" as const };
const SLIDE_SECTION_STYLE = { ref: "slide.section" as const };
const TEXT_TITLE_STYLE = { ref: "text.title" as const };
const TEXT_SUBTITLE_STYLE = { ref: "text.subtitle" as const };
const TEXT_BODY_STYLE = { ref: "text.body" as const };
const TEXT_KICKER_STYLE = { ref: "text.kicker" as const };
const TEXT_QUOTE_STYLE = { ref: "text.quote" as const };
const TEXT_METRIC_STYLE = { ref: "text.metric" as const };
const TEXT_CAPTION_STYLE = { ref: "text.caption" as const };
const SURFACE_CARD_STYLE = { ref: "surface.card" as const };
const SURFACE_CALLOUT_STYLE = { ref: "surface.callout" as const };
const SURFACE_TABLE_STYLE = { ref: "surface.table" as const };
const MEDIA_HERO_STYLE = { ref: "media.hero" as const };
const MEDIA_INLINE_STYLE = { ref: "media.inline" as const };

// ---------------------------------------------------------------------------
// Cover template
// ---------------------------------------------------------------------------

const COVER_TEMPLATE: SemanticTemplateV1 = {
  schemaVersion: 1,
  kind: "cover",
  label: "Cover",
  version: "1.0.0",
  group: "orient",
  intent: "Open a presentation with a strong title and context",
  slots: {
    kicker: {
      type: "shortText",
      required: false,
      maxChars: 80,
      overflow: "truncateWithNote",
    },
    title: {
      type: "shortText",
      required: true,
      maxChars: 120,
      overflow: "repair",
    },
    subtitle: {
      type: "shortText",
      required: false,
      maxChars: 200,
      overflow: "truncateWithNote",
    },
  } as SemanticTemplateV1["slots"],
  supports: {
    tone: ["neutral", "confident", "warm", "urgent", "premium", "technical"],
    density: ["airy", "normal"],
    emphasis: ["balanced", "title"],
  },
  layouts: [
    {
      id: "cover-default",
      density: ["airy", "normal"],
      emphasis: ["balanced", "title"],
      root: {
        type: "slide",
        style: SLIDE_COVER_STYLE,
        children: [
          {
            type: "text",
            role: "kicker",
            slot: "kicker",
            style: TEXT_KICKER_STYLE,
            layout: { frame: { x: 10, y: 28, w: 80, h: 6 }, zIndex: 1 },
          },
          {
            type: "text",
            role: "title",
            slot: "title",
            style: TEXT_TITLE_STYLE,
            layout: { frame: { x: 10, y: 35, w: 80, h: 18 }, zIndex: 2 },
          },
          {
            type: "text",
            role: "subtitle",
            slot: "subtitle",
            style: TEXT_SUBTITLE_STYLE,
            layout: { frame: { x: 10, y: 55, w: 80, h: 8 }, zIndex: 3 },
          },
        ],
      },
    },
  ],
  selection: {
    priority: 100,
    bestFor: "First slide of a presentation",
    signals: ["opening", "title-only", "deck-start"],
  },
};

// ---------------------------------------------------------------------------
// Section template
// ---------------------------------------------------------------------------

const SECTION_TEMPLATE: SemanticTemplateV1 = {
  schemaVersion: 1,
  kind: "section",
  label: "Section Divider",
  version: "1.0.0",
  group: "orient",
  intent: "Mark a new section in the narrative",
  slots: {
    kicker: {
      type: "shortText",
      required: false,
      maxChars: 80,
      overflow: "truncateWithNote",
    },
    title: {
      type: "shortText",
      required: true,
      maxChars: 120,
      overflow: "repair",
    },
  } as SemanticTemplateV1["slots"],
  supports: {
    tone: ["neutral", "confident", "warm", "urgent", "premium", "technical"],
    density: ["airy", "normal"],
    emphasis: ["balanced", "title"],
  },
  layouts: [
    {
      id: "section-default",
      density: ["airy", "normal"],
      emphasis: ["balanced", "title"],
      root: {
        type: "slide",
        style: SLIDE_SECTION_STYLE,
        children: [
          {
            type: "text",
            role: "kicker",
            slot: "kicker",
            style: TEXT_KICKER_STYLE,
            layout: { frame: { x: 10, y: 35, w: 80, h: 6 }, zIndex: 1 },
          },
          {
            type: "text",
            role: "title",
            slot: "title",
            style: TEXT_TITLE_STYLE,
            layout: { frame: { x: 10, y: 42, w: 80, h: 16 }, zIndex: 2 },
          },
        ],
      },
    },
  ],
  selection: {
    priority: 80,
    bestFor: "Section transition slide",
    signals: ["section", "chapter", "part"],
  },
};

// ---------------------------------------------------------------------------
// Content template (title + bullets)
// ---------------------------------------------------------------------------

const CONTENT_TEMPLATE: SemanticTemplateV1 = {
  schemaVersion: 1,
  kind: "content",
  label: "Content",
  version: "1.0.0",
  group: "explain",
  intent: "Present a title with supporting bullet points or body text",
  slots: {
    kicker: {
      type: "shortText",
      required: false,
      maxChars: 80,
      overflow: "truncateWithNote",
    },
    title: {
      type: "shortText",
      required: true,
      maxChars: 120,
      overflow: "repair",
    },
    bullets: {
      type: "bullets",
      required: false,
      maxItems: 6,
      overflow: "chooseDenserLayout",
    },
    body: {
      type: "paragraph",
      required: false,
      maxItems: 3,
      maxChars: 600,
      overflow: "truncateWithNote",
    },
  } as SemanticTemplateV1["slots"],
  supports: {
    tone: ["neutral", "confident", "warm", "urgent", "premium", "technical"],
    density: ["airy", "normal", "dense"],
    emphasis: ["balanced", "title", "data"],
  },
  layouts: [
    {
      id: "content-airy",
      density: ["airy"],
      emphasis: ["balanced", "title"],
      root: {
        type: "slide",
        style: SLIDE_CONTENT_STYLE,
        children: [
          {
            type: "text",
            role: "kicker",
            slot: "kicker",
            style: TEXT_KICKER_STYLE,
            layout: { frame: { x: 8, y: 8, w: 84, h: 5 }, zIndex: 1 },
          },
          {
            type: "text",
            role: "title",
            slot: "title",
            style: TEXT_TITLE_STYLE,
            layout: { frame: { x: 8, y: 14, w: 84, h: 14 }, zIndex: 2 },
          },
          {
            type: "text",
            role: "bullet",
            slot: "bullets",
            style: TEXT_BODY_STYLE,
            layout: { frame: { x: 8, y: 32, w: 84, h: 58 }, zIndex: 3 },
          },
        ],
      },
    },
    {
      id: "content-dense",
      density: ["dense"],
      emphasis: ["data"],
      root: {
        type: "slide",
        style: SLIDE_CONTENT_STYLE,
        children: [
          {
            type: "text",
            role: "title",
            slot: "title",
            style: TEXT_TITLE_STYLE,
            layout: { frame: { x: 8, y: 6, w: 84, h: 12 }, zIndex: 1 },
          },
          {
            type: "text",
            role: "bullet",
            slot: "bullets",
            style: TEXT_BODY_STYLE,
            layout: { frame: { x: 8, y: 20, w: 84, h: 72 }, zIndex: 2 },
          },
        ],
      },
    },
  ],
  selection: {
    priority: 70,
    bestFor: "General purpose text + bullets slide",
    signals: ["bullets", "list", "text-heavy", "explain"],
  },
};

// ---------------------------------------------------------------------------
// Quote template
// ---------------------------------------------------------------------------

const QUOTE_TEMPLATE: SemanticTemplateV1 = {
  schemaVersion: 1,
  kind: "quote",
  label: "Quote",
  version: "1.0.0",
  group: "prove",
  intent: "Feature a compelling quotation with attribution",
  slots: {
    quote: {
      type: "shortText",
      required: true,
      maxChars: 300,
      overflow: "truncateWithNote",
    },
    attribution: {
      type: "shortText",
      required: false,
      maxChars: 100,
      overflow: "truncateWithNote",
    },
  } as SemanticTemplateV1["slots"],
  supports: {
    tone: ["neutral", "confident", "warm", "premium"],
    density: ["airy", "normal"],
    emphasis: ["balanced", "quote"],
  },
  layouts: [
    {
      id: "quote-default",
      density: ["airy", "normal"],
      emphasis: ["balanced", "quote"],
      root: {
        type: "slide",
        style: SLIDE_CONTENT_STYLE,
        children: [
          {
            type: "text",
            role: "quote",
            slot: "quote",
            style: TEXT_QUOTE_STYLE,
            layout: { frame: { x: 12, y: 25, w: 76, h: 32 }, zIndex: 1 },
          },
          {
            type: "text",
            role: "attribution",
            slot: "attribution",
            style: TEXT_CAPTION_STYLE,
            layout: { frame: { x: 12, y: 60, w: 76, h: 8 }, zIndex: 2 },
          },
        ],
      },
    },
  ],
  selection: {
    priority: 60,
    bestFor: "A single strong quotation with attribution",
    signals: ["quote", "testimonial", "citation"],
  },
};

// ---------------------------------------------------------------------------
// Metric row template
// ---------------------------------------------------------------------------

const METRIC_ROW_TEMPLATE: SemanticTemplateV1 = {
  schemaVersion: 1,
  kind: "metric-row",
  label: "Metric Row",
  version: "1.0.0",
  group: "prove",
  intent: "Show a row of key metrics side by side",
  slots: {
    title: {
      type: "shortText",
      required: false,
      maxChars: 100,
      overflow: "truncateWithNote",
    },
    metrics: {
      type: "metrics",
      required: true,
      minItems: 2,
      maxItems: 4,
      overflow: "repair",
    },
  } as SemanticTemplateV1["slots"],
  supports: {
    tone: ["neutral", "confident", "premium", "technical"],
    density: ["airy", "normal", "dense"],
    emphasis: ["balanced", "data"],
  },
  layouts: [
    {
      id: "metric-row-default",
      density: ["airy", "normal", "dense"],
      emphasis: ["balanced", "data"],
      root: {
        type: "slide",
        style: SLIDE_CONTENT_STYLE,
        children: [
          {
            type: "text",
            role: "title",
            slot: "title",
            style: TEXT_TITLE_STYLE,
            layout: { frame: { x: 8, y: 8, w: 84, h: 14 }, zIndex: 1 },
          },
          {
            type: "group",
            component: "metricCard",
            role: "card",
            slot: "metrics",
            style: SURFACE_CARD_STYLE,
            layout: { frame: { x: 8, y: 30, w: 84, h: 52 }, zIndex: 2 },
            children: [
              {
                type: "text",
                role: "metric",
                style: TEXT_METRIC_STYLE,
                layout: { frame: { x: 10, y: 35, w: 20, h: 20 }, zIndex: 1 },
              },
            ],
          },
        ],
      },
    },
  ],
  selection: {
    priority: 65,
    bestFor: "2-4 key numbers or KPIs displayed side by side",
    signals: ["metrics", "kpi", "stats", "numbers"],
  },
};

// ---------------------------------------------------------------------------
// Comparison template (two columns)
// ---------------------------------------------------------------------------

const COMPARISON_TEMPLATE: SemanticTemplateV1 = {
  schemaVersion: 1,
  kind: "comparison",
  label: "Comparison",
  version: "1.0.0",
  group: "compare",
  intent: "Compare two options, concepts, or time periods side by side",
  slots: {
    title: {
      type: "shortText",
      required: false,
      maxChars: 100,
      overflow: "truncateWithNote",
    },
    leftTitle: {
      type: "shortText",
      required: true,
      maxChars: 80,
      overflow: "repair",
    },
    leftBullets: {
      type: "bullets",
      required: false,
      maxItems: 5,
      overflow: "repair",
    },
    rightTitle: {
      type: "shortText",
      required: true,
      maxChars: 80,
      overflow: "repair",
    },
    rightBullets: {
      type: "bullets",
      required: false,
      maxItems: 5,
      overflow: "repair",
    },
  } as SemanticTemplateV1["slots"],
  supports: {
    tone: ["neutral", "confident", "technical"],
    density: ["airy", "normal", "dense"],
    emphasis: ["balanced", "data"],
  },
  layouts: [
    {
      id: "comparison-two-col",
      density: ["airy", "normal", "dense"],
      emphasis: ["balanced", "data"],
      root: {
        type: "slide",
        style: SLIDE_CONTENT_STYLE,
        children: [
          {
            type: "text",
            role: "title",
            slot: "title",
            style: TEXT_TITLE_STYLE,
            layout: { frame: { x: 8, y: 6, w: 84, h: 12 }, zIndex: 1 },
          },
          {
            type: "text",
            role: "label",
            slot: "leftTitle",
            style: TEXT_SUBTITLE_STYLE,
            layout: { frame: { x: 8, y: 22, w: 40, h: 8 }, zIndex: 2 },
          },
          {
            type: "text",
            role: "bullet",
            slot: "leftBullets",
            style: TEXT_BODY_STYLE,
            layout: { frame: { x: 8, y: 32, w: 40, h: 56 }, zIndex: 3 },
          },
          {
            type: "text",
            role: "label",
            slot: "rightTitle",
            style: TEXT_SUBTITLE_STYLE,
            layout: { frame: { x: 52, y: 22, w: 40, h: 8 }, zIndex: 4 },
          },
          {
            type: "text",
            role: "bullet",
            slot: "rightBullets",
            style: TEXT_BODY_STYLE,
            layout: { frame: { x: 52, y: 32, w: 40, h: 56 }, zIndex: 5 },
          },
        ],
      },
    },
  ],
  selection: {
    priority: 65,
    bestFor: "Side-by-side comparison of two options",
    signals: ["comparison", "versus", "two-column", "pros-cons"],
  },
};

// ---------------------------------------------------------------------------
// Table template
// ---------------------------------------------------------------------------

const TABLE_TEMPLATE: SemanticTemplateV1 = {
  schemaVersion: 1,
  kind: "table",
  label: "Table",
  version: "1.0.0",
  group: "explain",
  intent: "Present structured tabular data",
  slots: {
    title: {
      type: "shortText",
      required: false,
      maxChars: 100,
      overflow: "truncateWithNote",
    },
    table: {
      type: "table",
      required: true,
      minColumns: 1,
      maxColumns: 6,
      minRows: 1,
      maxRows: 10,
      maxCellChars: 120,
      overflow: "repair",
    },
    caption: {
      type: "shortText",
      required: false,
      maxChars: 160,
      overflow: "truncateWithNote",
    },
  } as SemanticTemplateV1["slots"],
  supports: {
    tone: ["neutral", "confident", "technical"],
    density: ["normal", "dense"],
    emphasis: ["balanced", "data"],
  },
  layouts: [
    {
      id: "table-default",
      density: ["normal", "dense"],
      emphasis: ["balanced", "data"],
      root: {
        type: "slide",
        style: SLIDE_CONTENT_STYLE,
        children: [
          {
            type: "text",
            role: "title",
            slot: "title",
            style: TEXT_TITLE_STYLE,
            layout: { frame: { x: 8, y: 6, w: 84, h: 12 }, zIndex: 1 },
          },
          {
            type: "table",
            role: "table",
            slot: "table",
            style: SURFACE_TABLE_STYLE,
            layout: { frame: { x: 8, y: 22, w: 84, h: 62 }, zIndex: 2 },
          },
          {
            type: "text",
            role: "caption",
            slot: "caption",
            style: TEXT_CAPTION_STYLE,
            layout: { frame: { x: 8, y: 86, w: 84, h: 6 }, zIndex: 3 },
          },
        ],
      },
    },
  ],
  selection: {
    priority: 60,
    bestFor: "Tabular data with headers",
    signals: ["table", "grid", "data", "rows"],
  },
};

// ---------------------------------------------------------------------------
// Recommendation template
// ---------------------------------------------------------------------------

const RECOMMENDATION_TEMPLATE: SemanticTemplateV1 = {
  schemaVersion: 1,
  kind: "recommendation",
  label: "Recommendation",
  version: "1.0.0",
  group: "decision",
  intent: "Present a clear recommendation with supporting rationale",
  slots: {
    kicker: {
      type: "shortText",
      required: false,
      maxChars: 80,
      overflow: "truncateWithNote",
    },
    title: {
      type: "shortText",
      required: true,
      maxChars: 160,
      overflow: "repair",
    },
    bullets: {
      type: "bullets",
      required: false,
      maxItems: 4,
      overflow: "repair",
    },
  } as SemanticTemplateV1["slots"],
  supports: {
    tone: ["neutral", "confident", "urgent"],
    density: ["airy", "normal"],
    emphasis: ["balanced", "title", "action"],
  },
  layouts: [
    {
      id: "recommendation-default",
      density: ["airy", "normal"],
      emphasis: ["balanced", "title", "action"],
      root: {
        type: "slide",
        style: SLIDE_CONTENT_STYLE,
        children: [
          {
            type: "text",
            role: "kicker",
            slot: "kicker",
            style: TEXT_KICKER_STYLE,
            layout: { frame: { x: 10, y: 15, w: 80, h: 6 }, zIndex: 1 },
          },
          {
            type: "text",
            role: "title",
            slot: "title",
            style: TEXT_TITLE_STYLE,
            layout: { frame: { x: 10, y: 22, w: 80, h: 20 }, zIndex: 2 },
          },
          {
            type: "text",
            role: "bullet",
            slot: "bullets",
            style: TEXT_BODY_STYLE,
            layout: { frame: { x: 10, y: 46, w: 80, h: 44 }, zIndex: 3 },
          },
        ],
      },
    },
  ],
  selection: {
    priority: 55,
    bestFor: "Decision or recommendation slide",
    signals: ["recommendation", "decision", "action", "next-steps"],
  },
};

// ---------------------------------------------------------------------------
// Agenda template
// ---------------------------------------------------------------------------

const AGENDA_TEMPLATE: SemanticTemplateV1 = {
  schemaVersion: 1,
  kind: "agenda",
  label: "Agenda",
  version: "1.0.0",
  group: "orient",
  intent: "List the sections or topics to be covered in this presentation",
  slots: {
    kicker: {
      type: "shortText",
      required: false,
      maxChars: 80,
      overflow: "truncateWithNote",
    },
    title: {
      type: "shortText",
      required: false,
      maxChars: 100,
      overflow: "truncateWithNote",
    },
    steps: {
      type: "steps",
      required: true,
      minItems: 2,
      maxItems: 8,
      overflow: "chooseDenserLayout",
    },
  } as SemanticTemplateV1["slots"],
  supports: {
    tone: ["neutral", "confident", "warm", "premium", "technical"],
    density: ["airy", "normal", "dense"],
    emphasis: ["balanced", "title"],
  },
  layouts: [
    {
      id: "agenda-default",
      density: ["airy", "normal"],
      emphasis: ["balanced", "title"],
      root: {
        type: "slide",
        style: SLIDE_CONTENT_STYLE,
        children: [
          {
            type: "text",
            role: "kicker",
            slot: "kicker",
            style: TEXT_KICKER_STYLE,
            layout: { frame: { x: 8, y: 8, w: 84, h: 5 }, zIndex: 1 },
          },
          {
            type: "text",
            role: "title",
            slot: "title",
            style: TEXT_TITLE_STYLE,
            layout: { frame: { x: 8, y: 14, w: 84, h: 12 }, zIndex: 2 },
          },
          {
            type: "group",
            component: "cardGrid",
            role: "card",
            slot: "steps",
            style: SURFACE_CARD_STYLE,
            layout: { frame: { x: 8, y: 30, w: 84, h: 60 }, zIndex: 3 },
            children: [
              {
                type: "text",
                role: "label",
                style: TEXT_SUBTITLE_STYLE,
                layout: { frame: { x: 10, y: 32, w: 40, h: 8 }, zIndex: 1 },
              },
              {
                type: "text",
                role: "body",
                style: TEXT_BODY_STYLE,
                layout: { frame: { x: 10, y: 42, w: 40, h: 20 }, zIndex: 2 },
              },
            ],
          },
        ],
      },
    },
    {
      id: "agenda-dense",
      density: ["dense"],
      emphasis: ["balanced", "title"],
      root: {
        type: "slide",
        style: SLIDE_CONTENT_STYLE,
        children: [
          {
            type: "text",
            role: "title",
            slot: "title",
            style: TEXT_TITLE_STYLE,
            layout: { frame: { x: 8, y: 6, w: 84, h: 10 }, zIndex: 1 },
          },
          {
            type: "group",
            component: "cardGrid",
            role: "card",
            slot: "steps",
            style: SURFACE_CARD_STYLE,
            layout: { frame: { x: 8, y: 20, w: 84, h: 72 }, zIndex: 2 },
            children: [
              {
                type: "text",
                role: "label",
                style: TEXT_SUBTITLE_STYLE,
                layout: { frame: { x: 10, y: 22, w: 40, h: 7 }, zIndex: 1 },
              },
            ],
          },
        ],
      },
    },
  ],
  selection: {
    priority: 85,
    bestFor: "Agenda or table of contents slide",
    signals: ["agenda", "table-of-contents", "sections", "topics"],
  },
};

// ---------------------------------------------------------------------------
// Executive Summary template
// ---------------------------------------------------------------------------

const EXECUTIVE_SUMMARY_TEMPLATE: SemanticTemplateV1 = {
  schemaVersion: 1,
  kind: "executive-summary",
  label: "Executive Summary",
  version: "1.0.0",
  group: "orient",
  intent: "Provide a concise high-level summary for executive audiences",
  slots: {
    kicker: {
      type: "shortText",
      required: false,
      maxChars: 80,
      overflow: "truncateWithNote",
    },
    title: {
      type: "shortText",
      required: true,
      maxChars: 160,
      overflow: "repair",
    },
    bullets: {
      type: "bullets",
      required: false,
      maxItems: 5,
      overflow: "chooseDenserLayout",
    },
    body: {
      type: "paragraph",
      required: false,
      maxItems: 3,
      maxChars: 500,
      overflow: "truncateWithNote",
    },
  } as SemanticTemplateV1["slots"],
  supports: {
    tone: ["neutral", "confident", "premium"],
    density: ["airy", "normal"],
    emphasis: ["balanced", "title"],
  },
  layouts: [
    {
      id: "exec-summary-airy",
      density: ["airy"],
      emphasis: ["balanced", "title"],
      root: {
        type: "slide",
        style: SLIDE_CONTENT_STYLE,
        children: [
          {
            type: "text",
            role: "kicker",
            slot: "kicker",
            style: TEXT_KICKER_STYLE,
            layout: { frame: { x: 8, y: 7, w: 84, h: 5 }, zIndex: 1 },
          },
          {
            type: "text",
            role: "title",
            slot: "title",
            style: TEXT_TITLE_STYLE,
            layout: { frame: { x: 8, y: 13, w: 84, h: 16 }, zIndex: 2 },
          },
          {
            type: "text",
            role: "bullet",
            slot: "bullets",
            style: TEXT_BODY_STYLE,
            layout: { frame: { x: 8, y: 32, w: 84, h: 58 }, zIndex: 3 },
          },
        ],
      },
    },
    {
      id: "exec-summary-normal",
      density: ["normal"],
      emphasis: ["balanced", "title"],
      root: {
        type: "slide",
        style: SLIDE_CONTENT_STYLE,
        children: [
          {
            type: "text",
            role: "kicker",
            slot: "kicker",
            style: TEXT_KICKER_STYLE,
            layout: { frame: { x: 8, y: 6, w: 84, h: 5 }, zIndex: 1 },
          },
          {
            type: "text",
            role: "title",
            slot: "title",
            style: TEXT_TITLE_STYLE,
            layout: { frame: { x: 8, y: 12, w: 84, h: 14 }, zIndex: 2 },
          },
          {
            type: "text",
            role: "bullet",
            slot: "bullets",
            style: TEXT_BODY_STYLE,
            layout: { frame: { x: 8, y: 29, w: 44, h: 62 }, zIndex: 3 },
          },
          {
            type: "text",
            role: "body",
            slot: "body",
            style: TEXT_BODY_STYLE,
            layout: { frame: { x: 54, y: 29, w: 38, h: 62 }, zIndex: 4 },
          },
        ],
      },
    },
  ],
  selection: {
    priority: 80,
    bestFor: "High-level executive overview slide",
    signals: ["executive-summary", "summary", "overview", "highlights"],
  },
};

// ---------------------------------------------------------------------------
// Detail template
// ---------------------------------------------------------------------------

const DETAIL_TEMPLATE: SemanticTemplateV1 = {
  schemaVersion: 1,
  kind: "detail",
  label: "Detail",
  version: "1.0.0",
  group: "explain",
  intent: "Present a deep-dive or detailed explanation with long-form text",
  slots: {
    kicker: {
      type: "shortText",
      required: false,
      maxChars: 80,
      overflow: "truncateWithNote",
    },
    title: {
      type: "shortText",
      required: true,
      maxChars: 120,
      overflow: "repair",
    },
    body: {
      type: "paragraph",
      required: true,
      maxItems: 6,
      maxChars: 900,
      overflow: "truncateWithNote",
    },
  } as SemanticTemplateV1["slots"],
  supports: {
    tone: ["neutral", "confident", "technical"],
    density: ["normal", "dense"],
    emphasis: ["balanced", "data"],
  },
  layouts: [
    {
      id: "detail-default",
      density: ["normal", "dense"],
      emphasis: ["balanced", "data"],
      root: {
        type: "slide",
        style: SLIDE_CONTENT_STYLE,
        children: [
          {
            type: "text",
            role: "kicker",
            slot: "kicker",
            style: TEXT_KICKER_STYLE,
            layout: { frame: { x: 8, y: 6, w: 84, h: 5 }, zIndex: 1 },
          },
          {
            type: "text",
            role: "title",
            slot: "title",
            style: TEXT_TITLE_STYLE,
            layout: { frame: { x: 8, y: 12, w: 84, h: 14 }, zIndex: 2 },
          },
          {
            type: "text",
            role: "body",
            slot: "body",
            style: TEXT_BODY_STYLE,
            layout: { frame: { x: 8, y: 28, w: 84, h: 64 }, zIndex: 3 },
          },
        ],
      },
    },
  ],
  selection: {
    priority: 55,
    bestFor: "Deep-dive or detailed explanation with substantial body text",
    signals: ["detail", "deep-dive", "explainer", "long-form"],
  },
};

// ---------------------------------------------------------------------------
// Big Stat template
// ---------------------------------------------------------------------------

const BIG_STAT_TEMPLATE: SemanticTemplateV1 = {
  schemaVersion: 1,
  kind: "big-stat",
  label: "Big Stat",
  version: "1.0.0",
  group: "prove",
  intent: "Feature a single dominant statistic or number with context",
  slots: {
    kicker: {
      type: "shortText",
      required: false,
      maxChars: 80,
      overflow: "truncateWithNote",
    },
    stat: {
      type: "metric",
      required: true,
      maxChars: 30,
      overflow: "repair",
    },
    statLabel: {
      type: "shortText",
      required: false,
      maxChars: 120,
      overflow: "truncateWithNote",
    },
    caption: {
      type: "shortText",
      required: false,
      maxChars: 200,
      overflow: "truncateWithNote",
    },
  } as SemanticTemplateV1["slots"],
  supports: {
    tone: ["neutral", "confident", "urgent", "premium"],
    density: ["airy", "normal"],
    emphasis: ["balanced", "data"],
  },
  layouts: [
    {
      id: "big-stat-default",
      density: ["airy", "normal"],
      emphasis: ["balanced", "data"],
      root: {
        type: "slide",
        style: SLIDE_CONTENT_STYLE,
        children: [
          {
            type: "text",
            role: "kicker",
            slot: "kicker",
            style: TEXT_KICKER_STYLE,
            layout: { frame: { x: 10, y: 12, w: 80, h: 6 }, zIndex: 1 },
          },
          {
            type: "text",
            role: "metric",
            slot: "stat",
            style: TEXT_METRIC_STYLE,
            layout: { frame: { x: 10, y: 22, w: 80, h: 28 }, zIndex: 2 },
          },
          {
            type: "text",
            role: "label",
            slot: "statLabel",
            style: TEXT_SUBTITLE_STYLE,
            layout: { frame: { x: 10, y: 52, w: 80, h: 10 }, zIndex: 3 },
          },
          {
            type: "text",
            role: "caption",
            slot: "caption",
            style: TEXT_CAPTION_STYLE,
            layout: { frame: { x: 10, y: 64, w: 80, h: 8 }, zIndex: 4 },
          },
        ],
      },
    },
  ],
  selection: {
    priority: 60,
    bestFor: "A single large number or KPI that stands alone",
    signals: ["big-stat", "single-metric", "stat", "kpi", "number"],
  },
};

// ---------------------------------------------------------------------------
// Insight template
// ---------------------------------------------------------------------------

const INSIGHT_TEMPLATE: SemanticTemplateV1 = {
  schemaVersion: 1,
  kind: "insight",
  label: "Insight",
  version: "1.0.0",
  group: "prove",
  intent: "Spotlight a key insight or finding with a prominent statement",
  slots: {
    kicker: {
      type: "shortText",
      required: false,
      maxChars: 80,
      overflow: "truncateWithNote",
    },
    title: {
      type: "shortText",
      required: true,
      maxChars: 200,
      overflow: "repair",
    },
    body: {
      type: "paragraph",
      required: false,
      maxItems: 3,
      maxChars: 400,
      overflow: "truncateWithNote",
    },
  } as SemanticTemplateV1["slots"],
  supports: {
    tone: ["neutral", "confident", "urgent", "premium"],
    density: ["airy", "normal"],
    emphasis: ["balanced", "title"],
  },
  layouts: [
    {
      id: "insight-default",
      density: ["airy", "normal"],
      emphasis: ["balanced", "title"],
      root: {
        type: "slide",
        style: SLIDE_CONTENT_STYLE,
        children: [
          {
            type: "text",
            role: "kicker",
            slot: "kicker",
            style: TEXT_KICKER_STYLE,
            layout: { frame: { x: 10, y: 10, w: 80, h: 5 }, zIndex: 1 },
          },
          {
            type: "shape",
            role: "callout",
            style: SURFACE_CALLOUT_STYLE,
            layout: { frame: { x: 8, y: 18, w: 84, h: 36 }, zIndex: 2 },
          },
          {
            type: "text",
            role: "title",
            slot: "title",
            style: TEXT_TITLE_STYLE,
            layout: { frame: { x: 12, y: 22, w: 76, h: 28 }, zIndex: 3 },
          },
          {
            type: "text",
            role: "body",
            slot: "body",
            style: TEXT_BODY_STYLE,
            layout: { frame: { x: 10, y: 58, w: 80, h: 30 }, zIndex: 4 },
          },
        ],
      },
    },
  ],
  selection: {
    priority: 58,
    bestFor: "A key insight or finding that needs to stand out",
    signals: ["insight", "finding", "takeaway", "key-point"],
  },
};

// ---------------------------------------------------------------------------
// Evidence template
// ---------------------------------------------------------------------------

const EVIDENCE_TEMPLATE: SemanticTemplateV1 = {
  schemaVersion: 1,
  kind: "evidence",
  label: "Evidence",
  version: "1.0.0",
  group: "prove",
  intent: "Present supporting evidence or proof points with optional imagery",
  slots: {
    kicker: {
      type: "shortText",
      required: false,
      maxChars: 80,
      overflow: "truncateWithNote",
    },
    title: {
      type: "shortText",
      required: true,
      maxChars: 120,
      overflow: "repair",
    },
    bullets: {
      type: "bullets",
      required: false,
      maxItems: 5,
      overflow: "chooseDenserLayout",
    },
    imagePrompt: {
      type: "image",
      required: false,
      maxChars: 400,
      overflow: "truncateWithNote",
    },
  } as SemanticTemplateV1["slots"],
  supports: {
    tone: ["neutral", "confident", "technical"],
    density: ["airy", "normal", "dense"],
    emphasis: ["balanced", "data", "visual"],
  },
  layouts: [
    {
      id: "evidence-text",
      density: ["airy", "normal"],
      emphasis: ["balanced", "data"],
      root: {
        type: "slide",
        style: SLIDE_CONTENT_STYLE,
        children: [
          {
            type: "text",
            role: "kicker",
            slot: "kicker",
            style: TEXT_KICKER_STYLE,
            layout: { frame: { x: 8, y: 6, w: 84, h: 5 }, zIndex: 1 },
          },
          {
            type: "text",
            role: "title",
            slot: "title",
            style: TEXT_TITLE_STYLE,
            layout: { frame: { x: 8, y: 12, w: 84, h: 14 }, zIndex: 2 },
          },
          {
            type: "text",
            role: "bullet",
            slot: "bullets",
            style: TEXT_BODY_STYLE,
            layout: { frame: { x: 8, y: 28, w: 84, h: 62 }, zIndex: 3 },
          },
        ],
      },
    },
    {
      id: "evidence-split",
      density: ["dense"],
      emphasis: ["visual"],
      root: {
        type: "slide",
        style: SLIDE_CONTENT_STYLE,
        children: [
          {
            type: "text",
            role: "title",
            slot: "title",
            style: TEXT_TITLE_STYLE,
            layout: { frame: { x: 8, y: 6, w: 84, h: 12 }, zIndex: 1 },
          },
          {
            type: "text",
            role: "bullet",
            slot: "bullets",
            style: TEXT_BODY_STYLE,
            layout: { frame: { x: 8, y: 22, w: 44, h: 68 }, zIndex: 2 },
          },
          {
            type: "image",
            role: "image",
            slot: "imagePrompt",
            style: MEDIA_INLINE_STYLE,
            layout: { frame: { x: 55, y: 22, w: 37, h: 68 }, zIndex: 3 },
          },
        ],
      },
    },
  ],
  selection: {
    priority: 55,
    bestFor: "Supporting evidence or proof points",
    signals: ["evidence", "proof", "support", "findings"],
  },
};

// ---------------------------------------------------------------------------
// Matrix template (2x2 or n-grid)
// ---------------------------------------------------------------------------

const MATRIX_TEMPLATE: SemanticTemplateV1 = {
  schemaVersion: 1,
  kind: "matrix",
  label: "Matrix",
  version: "1.0.0",
  group: "compare",
  intent: "Arrange concepts in a 2×2 or quadrant matrix for comparison",
  slots: {
    title: {
      type: "shortText",
      required: false,
      maxChars: 100,
      overflow: "truncateWithNote",
    },
    cards: {
      type: "cards",
      required: true,
      minItems: 4,
      maxItems: 4,
      overflow: "repair",
    },
  } as SemanticTemplateV1["slots"],
  supports: {
    tone: ["neutral", "confident", "technical"],
    density: ["airy", "normal"],
    emphasis: ["balanced", "data"],
  },
  layouts: [
    {
      id: "matrix-2x2",
      density: ["airy", "normal"],
      emphasis: ["balanced", "data"],
      root: {
        type: "slide",
        style: SLIDE_CONTENT_STYLE,
        children: [
          {
            type: "text",
            role: "title",
            slot: "title",
            style: TEXT_TITLE_STYLE,
            layout: { frame: { x: 8, y: 6, w: 84, h: 12 }, zIndex: 1 },
          },
          {
            type: "group",
            component: "cardGrid",
            role: "card",
            slot: "cards",
            style: SURFACE_CARD_STYLE,
            layout: { frame: { x: 8, y: 20, w: 84, h: 72 }, zIndex: 2 },
            children: [
              {
                type: "text",
                role: "label",
                style: TEXT_SUBTITLE_STYLE,
                layout: { frame: { x: 10, y: 24, w: 36, h: 8 }, zIndex: 1 },
              },
              {
                type: "text",
                role: "body",
                style: TEXT_BODY_STYLE,
                layout: { frame: { x: 10, y: 34, w: 36, h: 16 }, zIndex: 2 },
              },
            ],
          },
        ],
      },
    },
  ],
  selection: {
    priority: 55,
    bestFor: "2x2 matrix or quadrant analysis",
    signals: ["matrix", "2x2", "quadrant", "grid"],
  },
};

// ---------------------------------------------------------------------------
// Framework template
// ---------------------------------------------------------------------------

const FRAMEWORK_TEMPLATE: SemanticTemplateV1 = {
  schemaVersion: 1,
  kind: "framework",
  label: "Framework",
  version: "1.0.0",
  group: "explain",
  intent: "Illustrate a model or framework using labeled components",
  slots: {
    kicker: {
      type: "shortText",
      required: false,
      maxChars: 80,
      overflow: "truncateWithNote",
    },
    title: {
      type: "shortText",
      required: true,
      maxChars: 120,
      overflow: "repair",
    },
    cards: {
      type: "cards",
      required: true,
      minItems: 3,
      maxItems: 6,
      overflow: "chooseDenserLayout",
    },
    caption: {
      type: "shortText",
      required: false,
      maxChars: 160,
      overflow: "truncateWithNote",
    },
  } as SemanticTemplateV1["slots"],
  supports: {
    tone: ["neutral", "confident", "technical"],
    density: ["airy", "normal", "dense"],
    emphasis: ["balanced", "data"],
  },
  layouts: [
    {
      id: "framework-default",
      density: ["airy", "normal"],
      emphasis: ["balanced", "data"],
      root: {
        type: "slide",
        style: SLIDE_CONTENT_STYLE,
        children: [
          {
            type: "text",
            role: "kicker",
            slot: "kicker",
            style: TEXT_KICKER_STYLE,
            layout: { frame: { x: 8, y: 6, w: 84, h: 5 }, zIndex: 1 },
          },
          {
            type: "text",
            role: "title",
            slot: "title",
            style: TEXT_TITLE_STYLE,
            layout: { frame: { x: 8, y: 12, w: 84, h: 14 }, zIndex: 2 },
          },
          {
            type: "group",
            component: "cardGrid",
            role: "card",
            slot: "cards",
            style: SURFACE_CARD_STYLE,
            layout: { frame: { x: 8, y: 28, w: 84, h: 58 }, zIndex: 3 },
            children: [
              {
                type: "text",
                role: "label",
                style: TEXT_SUBTITLE_STYLE,
                layout: { frame: { x: 10, y: 30, w: 24, h: 8 }, zIndex: 1 },
              },
              {
                type: "text",
                role: "body",
                style: TEXT_BODY_STYLE,
                layout: { frame: { x: 10, y: 40, w: 24, h: 20 }, zIndex: 2 },
              },
            ],
          },
          {
            type: "text",
            role: "caption",
            slot: "caption",
            style: TEXT_CAPTION_STYLE,
            layout: { frame: { x: 8, y: 88, w: 84, h: 5 }, zIndex: 4 },
          },
        ],
      },
    },
    {
      id: "framework-dense",
      density: ["dense"],
      emphasis: ["data"],
      root: {
        type: "slide",
        style: SLIDE_CONTENT_STYLE,
        children: [
          {
            type: "text",
            role: "title",
            slot: "title",
            style: TEXT_TITLE_STYLE,
            layout: { frame: { x: 8, y: 4, w: 84, h: 12 }, zIndex: 1 },
          },
          {
            type: "group",
            component: "cardGrid",
            role: "card",
            slot: "cards",
            style: SURFACE_CARD_STYLE,
            layout: { frame: { x: 8, y: 18, w: 84, h: 74 }, zIndex: 2 },
            children: [
              {
                type: "text",
                role: "label",
                style: TEXT_SUBTITLE_STYLE,
                layout: { frame: { x: 10, y: 20, w: 24, h: 7 }, zIndex: 1 },
              },
            ],
          },
        ],
      },
    },
  ],
  selection: {
    priority: 52,
    bestFor: "Model, framework, or structured concept diagram",
    signals: ["framework", "model", "pillars", "dimensions"],
  },
};

// ---------------------------------------------------------------------------
// Process template
// ---------------------------------------------------------------------------

const PROCESS_TEMPLATE: SemanticTemplateV1 = {
  schemaVersion: 1,
  kind: "process",
  label: "Process",
  version: "1.0.0",
  group: "sequence",
  intent: "Show a sequential process or workflow with ordered steps",
  slots: {
    title: {
      type: "shortText",
      required: true,
      maxChars: 120,
      overflow: "repair",
    },
    steps: {
      type: "steps",
      required: true,
      minItems: 2,
      maxItems: 7,
      overflow: "chooseDenserLayout",
    },
  } as SemanticTemplateV1["slots"],
  supports: {
    tone: ["neutral", "confident", "technical"],
    density: ["airy", "normal", "dense"],
    emphasis: ["balanced", "data"],
  },
  layouts: [
    {
      id: "process-default",
      density: ["airy", "normal"],
      emphasis: ["balanced", "data"],
      root: {
        type: "slide",
        style: SLIDE_CONTENT_STYLE,
        children: [
          {
            type: "text",
            role: "title",
            slot: "title",
            style: TEXT_TITLE_STYLE,
            layout: { frame: { x: 8, y: 8, w: 84, h: 14 }, zIndex: 1 },
          },
          {
            type: "group",
            component: "cardGrid",
            role: "card",
            slot: "steps",
            style: SURFACE_CARD_STYLE,
            layout: { frame: { x: 8, y: 26, w: 84, h: 64 }, zIndex: 2 },
            children: [
              {
                type: "text",
                role: "label",
                style: TEXT_SUBTITLE_STYLE,
                layout: { frame: { x: 10, y: 30, w: 18, h: 8 }, zIndex: 1 },
              },
              {
                type: "text",
                role: "body",
                style: TEXT_BODY_STYLE,
                layout: { frame: { x: 10, y: 40, w: 18, h: 20 }, zIndex: 2 },
              },
            ],
          },
        ],
      },
    },
    {
      id: "process-dense",
      density: ["dense"],
      emphasis: ["data"],
      root: {
        type: "slide",
        style: SLIDE_CONTENT_STYLE,
        children: [
          {
            type: "text",
            role: "title",
            slot: "title",
            style: TEXT_TITLE_STYLE,
            layout: { frame: { x: 8, y: 4, w: 84, h: 12 }, zIndex: 1 },
          },
          {
            type: "group",
            component: "cardGrid",
            role: "card",
            slot: "steps",
            style: SURFACE_CARD_STYLE,
            layout: { frame: { x: 8, y: 18, w: 84, h: 74 }, zIndex: 2 },
            children: [
              {
                type: "text",
                role: "label",
                style: TEXT_SUBTITLE_STYLE,
                layout: { frame: { x: 10, y: 20, w: 18, h: 7 }, zIndex: 1 },
              },
            ],
          },
        ],
      },
    },
  ],
  selection: {
    priority: 55,
    bestFor: "Sequential workflow or process flow",
    signals: ["process", "workflow", "steps", "procedure"],
  },
};

// ---------------------------------------------------------------------------
// Timeline template
// ---------------------------------------------------------------------------

const TIMELINE_TEMPLATE: SemanticTemplateV1 = {
  schemaVersion: 1,
  kind: "timeline",
  label: "Timeline",
  version: "1.0.0",
  group: "sequence",
  intent: "Show events or milestones arranged along a time axis",
  slots: {
    title: {
      type: "shortText",
      required: true,
      maxChars: 120,
      overflow: "repair",
    },
    steps: {
      type: "timeline",
      required: true,
      minItems: 2,
      maxItems: 8,
      overflow: "chooseDenserLayout",
    },
  } as SemanticTemplateV1["slots"],
  supports: {
    tone: ["neutral", "confident", "technical"],
    density: ["airy", "normal", "dense"],
    emphasis: ["balanced", "data"],
  },
  layouts: [
    {
      id: "timeline-default",
      density: ["airy", "normal"],
      emphasis: ["balanced", "data"],
      root: {
        type: "slide",
        style: SLIDE_CONTENT_STYLE,
        children: [
          {
            type: "text",
            role: "title",
            slot: "title",
            style: TEXT_TITLE_STYLE,
            layout: { frame: { x: 8, y: 8, w: 84, h: 14 }, zIndex: 1 },
          },
          {
            type: "group",
            component: "timeline",
            role: "card",
            slot: "steps",
            style: SURFACE_CARD_STYLE,
            layout: { frame: { x: 8, y: 26, w: 84, h: 64 }, zIndex: 2 },
            children: [
              {
                type: "text",
                role: "label",
                style: TEXT_CAPTION_STYLE,
                layout: { frame: { x: 10, y: 28, w: 18, h: 6 }, zIndex: 1 },
              },
              {
                type: "text",
                role: "title",
                style: TEXT_SUBTITLE_STYLE,
                layout: { frame: { x: 10, y: 36, w: 18, h: 8 }, zIndex: 2 },
              },
              {
                type: "text",
                role: "body",
                style: TEXT_BODY_STYLE,
                layout: { frame: { x: 10, y: 46, w: 18, h: 16 }, zIndex: 3 },
              },
            ],
          },
        ],
      },
    },
    {
      id: "timeline-dense",
      density: ["dense"],
      emphasis: ["data"],
      root: {
        type: "slide",
        style: SLIDE_CONTENT_STYLE,
        children: [
          {
            type: "text",
            role: "title",
            slot: "title",
            style: TEXT_TITLE_STYLE,
            layout: { frame: { x: 8, y: 4, w: 84, h: 12 }, zIndex: 1 },
          },
          {
            type: "group",
            component: "timeline",
            role: "card",
            slot: "steps",
            style: SURFACE_CARD_STYLE,
            layout: { frame: { x: 8, y: 18, w: 84, h: 74 }, zIndex: 2 },
            children: [
              {
                type: "text",
                role: "label",
                style: TEXT_CAPTION_STYLE,
                layout: { frame: { x: 10, y: 20, w: 18, h: 5 }, zIndex: 1 },
              },
              {
                type: "text",
                role: "title",
                style: TEXT_SUBTITLE_STYLE,
                layout: { frame: { x: 10, y: 27, w: 18, h: 7 }, zIndex: 2 },
              },
            ],
          },
        ],
      },
    },
  ],
  selection: {
    priority: 58,
    bestFor: "Historical or projected timeline of events and milestones",
    signals: ["timeline", "history", "milestones", "chronology"],
  },
};

// ---------------------------------------------------------------------------
// Roadmap template
// ---------------------------------------------------------------------------

const ROADMAP_TEMPLATE: SemanticTemplateV1 = {
  schemaVersion: 1,
  kind: "roadmap",
  label: "Roadmap",
  version: "1.0.0",
  group: "sequence",
  intent: "Present a forward-looking roadmap with phases and deliverables",
  slots: {
    kicker: {
      type: "shortText",
      required: false,
      maxChars: 80,
      overflow: "truncateWithNote",
    },
    title: {
      type: "shortText",
      required: true,
      maxChars: 120,
      overflow: "repair",
    },
    steps: {
      type: "steps",
      required: true,
      minItems: 2,
      maxItems: 6,
      overflow: "chooseDenserLayout",
    },
  } as SemanticTemplateV1["slots"],
  supports: {
    tone: ["neutral", "confident", "premium", "technical"],
    density: ["airy", "normal", "dense"],
    emphasis: ["balanced", "data"],
  },
  layouts: [
    {
      id: "roadmap-default",
      density: ["airy", "normal"],
      emphasis: ["balanced", "data"],
      root: {
        type: "slide",
        style: SLIDE_CONTENT_STYLE,
        children: [
          {
            type: "text",
            role: "kicker",
            slot: "kicker",
            style: TEXT_KICKER_STYLE,
            layout: { frame: { x: 8, y: 6, w: 84, h: 5 }, zIndex: 1 },
          },
          {
            type: "text",
            role: "title",
            slot: "title",
            style: TEXT_TITLE_STYLE,
            layout: { frame: { x: 8, y: 12, w: 84, h: 14 }, zIndex: 2 },
          },
          {
            type: "group",
            component: "cardGrid",
            role: "card",
            slot: "steps",
            style: SURFACE_CARD_STYLE,
            layout: { frame: { x: 8, y: 28, w: 84, h: 62 }, zIndex: 3 },
            children: [
              {
                type: "text",
                role: "label",
                style: TEXT_SUBTITLE_STYLE,
                layout: { frame: { x: 10, y: 30, w: 20, h: 7 }, zIndex: 1 },
              },
              {
                type: "text",
                role: "body",
                style: TEXT_BODY_STYLE,
                layout: { frame: { x: 10, y: 39, w: 20, h: 18 }, zIndex: 2 },
              },
            ],
          },
        ],
      },
    },
    {
      id: "roadmap-dense",
      density: ["dense"],
      emphasis: ["data"],
      root: {
        type: "slide",
        style: SLIDE_CONTENT_STYLE,
        children: [
          {
            type: "text",
            role: "title",
            slot: "title",
            style: TEXT_TITLE_STYLE,
            layout: { frame: { x: 8, y: 4, w: 84, h: 12 }, zIndex: 1 },
          },
          {
            type: "group",
            component: "cardGrid",
            role: "card",
            slot: "steps",
            style: SURFACE_CARD_STYLE,
            layout: { frame: { x: 8, y: 18, w: 84, h: 74 }, zIndex: 2 },
            children: [
              {
                type: "text",
                role: "label",
                style: TEXT_SUBTITLE_STYLE,
                layout: { frame: { x: 10, y: 20, w: 20, h: 7 }, zIndex: 1 },
              },
            ],
          },
        ],
      },
    },
  ],
  selection: {
    priority: 58,
    bestFor: "Product or strategic roadmap with phases",
    signals: ["roadmap", "phases", "milestones", "plan"],
  },
};

// ---------------------------------------------------------------------------
// Architecture template
// ---------------------------------------------------------------------------

const ARCHITECTURE_TEMPLATE: SemanticTemplateV1 = {
  schemaVersion: 1,
  kind: "architecture",
  label: "Architecture",
  version: "1.0.0",
  group: "explain",
  intent: "Show a system architecture, diagram, or technical overview",
  slots: {
    title: {
      type: "shortText",
      required: true,
      maxChars: 120,
      overflow: "repair",
    },
    imagePrompt: {
      type: "image",
      required: true,
      maxChars: 400,
      overflow: "truncateWithNote",
    },
    caption: {
      type: "shortText",
      required: false,
      maxChars: 200,
      overflow: "truncateWithNote",
    },
  } as SemanticTemplateV1["slots"],
  supports: {
    tone: ["neutral", "technical"],
    density: ["airy", "normal"],
    emphasis: ["balanced", "visual"],
  },
  layouts: [
    {
      id: "architecture-default",
      density: ["airy", "normal"],
      emphasis: ["balanced", "visual"],
      root: {
        type: "slide",
        style: SLIDE_CONTENT_STYLE,
        children: [
          {
            type: "text",
            role: "title",
            slot: "title",
            style: TEXT_TITLE_STYLE,
            layout: { frame: { x: 8, y: 6, w: 84, h: 12 }, zIndex: 1 },
          },
          {
            type: "image",
            role: "image",
            slot: "imagePrompt",
            style: MEDIA_HERO_STYLE,
            layout: { frame: { x: 8, y: 20, w: 84, h: 64 }, zIndex: 2 },
          },
          {
            type: "text",
            role: "caption",
            slot: "caption",
            style: TEXT_CAPTION_STYLE,
            layout: { frame: { x: 8, y: 86, w: 84, h: 6 }, zIndex: 3 },
          },
        ],
      },
    },
  ],
  selection: {
    priority: 50,
    bestFor: "System architecture or technical diagram slide",
    signals: ["architecture", "diagram", "system", "technical"],
  },
};

// ---------------------------------------------------------------------------
// Case Study template
// ---------------------------------------------------------------------------

const CASE_STUDY_TEMPLATE: SemanticTemplateV1 = {
  schemaVersion: 1,
  kind: "case-study",
  label: "Case Study",
  version: "1.0.0",
  group: "prove",
  intent: "Present a case study with challenge, approach, and results",
  slots: {
    kicker: {
      type: "shortText",
      required: false,
      maxChars: 80,
      overflow: "truncateWithNote",
    },
    title: {
      type: "shortText",
      required: true,
      maxChars: 120,
      overflow: "repair",
    },
    leftTitle: {
      type: "shortText",
      required: false,
      maxChars: 80,
      overflow: "truncateWithNote",
    },
    leftBullets: {
      type: "bullets",
      required: false,
      maxItems: 4,
      overflow: "chooseDenserLayout",
    },
    rightTitle: {
      type: "shortText",
      required: false,
      maxChars: 80,
      overflow: "truncateWithNote",
    },
    rightBody: {
      type: "paragraph",
      required: false,
      maxItems: 3,
      maxChars: 400,
      overflow: "truncateWithNote",
    },
  } as SemanticTemplateV1["slots"],
  supports: {
    tone: ["neutral", "confident", "premium"],
    density: ["airy", "normal", "dense"],
    emphasis: ["balanced", "data"],
  },
  layouts: [
    {
      id: "case-study-split",
      density: ["airy", "normal"],
      emphasis: ["balanced", "data"],
      root: {
        type: "slide",
        style: SLIDE_CONTENT_STYLE,
        children: [
          {
            type: "text",
            role: "kicker",
            slot: "kicker",
            style: TEXT_KICKER_STYLE,
            layout: { frame: { x: 8, y: 6, w: 84, h: 5 }, zIndex: 1 },
          },
          {
            type: "text",
            role: "title",
            slot: "title",
            style: TEXT_TITLE_STYLE,
            layout: { frame: { x: 8, y: 12, w: 84, h: 12 }, zIndex: 2 },
          },
          {
            type: "text",
            role: "label",
            slot: "leftTitle",
            style: TEXT_SUBTITLE_STYLE,
            layout: { frame: { x: 8, y: 26, w: 40, h: 7 }, zIndex: 3 },
          },
          {
            type: "text",
            role: "bullet",
            slot: "leftBullets",
            style: TEXT_BODY_STYLE,
            layout: { frame: { x: 8, y: 35, w: 40, h: 56 }, zIndex: 4 },
          },
          {
            type: "text",
            role: "label",
            slot: "rightTitle",
            style: TEXT_SUBTITLE_STYLE,
            layout: { frame: { x: 52, y: 26, w: 40, h: 7 }, zIndex: 5 },
          },
          {
            type: "text",
            role: "body",
            slot: "rightBody",
            style: TEXT_BODY_STYLE,
            layout: { frame: { x: 52, y: 35, w: 40, h: 56 }, zIndex: 6 },
          },
        ],
      },
    },
    {
      id: "case-study-dense",
      density: ["dense"],
      emphasis: ["data"],
      root: {
        type: "slide",
        style: SLIDE_CONTENT_STYLE,
        children: [
          {
            type: "text",
            role: "title",
            slot: "title",
            style: TEXT_TITLE_STYLE,
            layout: { frame: { x: 8, y: 4, w: 84, h: 12 }, zIndex: 1 },
          },
          {
            type: "text",
            role: "bullet",
            slot: "leftBullets",
            style: TEXT_BODY_STYLE,
            layout: { frame: { x: 8, y: 18, w: 40, h: 74 }, zIndex: 2 },
          },
          {
            type: "text",
            role: "body",
            slot: "rightBody",
            style: TEXT_BODY_STYLE,
            layout: { frame: { x: 52, y: 18, w: 40, h: 74 }, zIndex: 3 },
          },
        ],
      },
    },
  ],
  selection: {
    priority: 52,
    bestFor: "Case study or customer story slide",
    signals: ["case-study", "customer-story", "example", "proof"],
  },
};

// ---------------------------------------------------------------------------
// Risks template
// ---------------------------------------------------------------------------

const RISKS_TEMPLATE: SemanticTemplateV1 = {
  schemaVersion: 1,
  kind: "risks",
  label: "Risks",
  version: "1.0.0",
  group: "decision",
  intent: "Present a risk register or risk matrix with mitigations",
  slots: {
    title: {
      type: "shortText",
      required: false,
      maxChars: 100,
      overflow: "truncateWithNote",
    },
    table: {
      type: "table",
      required: true,
      minColumns: 2,
      maxColumns: 4,
      minRows: 1,
      maxRows: 8,
      maxCellChars: 100,
      overflow: "repair",
    },
  } as SemanticTemplateV1["slots"],
  supports: {
    tone: ["neutral", "urgent", "technical"],
    density: ["normal", "dense"],
    emphasis: ["balanced", "data"],
  },
  layouts: [
    {
      id: "risks-table",
      density: ["normal", "dense"],
      emphasis: ["balanced", "data"],
      root: {
        type: "slide",
        style: SLIDE_CONTENT_STYLE,
        children: [
          {
            type: "text",
            role: "title",
            slot: "title",
            style: TEXT_TITLE_STYLE,
            layout: { frame: { x: 8, y: 6, w: 84, h: 12 }, zIndex: 1 },
          },
          {
            type: "table",
            role: "table",
            slot: "table",
            style: SURFACE_TABLE_STYLE,
            layout: { frame: { x: 8, y: 22, w: 84, h: 70 }, zIndex: 2 },
          },
        ],
      },
    },
  ],
  selection: {
    priority: 50,
    bestFor: "Risk register or risk/mitigation table",
    signals: ["risks", "risk-matrix", "mitigations", "issues"],
  },
};

// ---------------------------------------------------------------------------
// Pricing template
// ---------------------------------------------------------------------------

const PRICING_TEMPLATE: SemanticTemplateV1 = {
  schemaVersion: 1,
  kind: "pricing",
  label: "Pricing",
  version: "1.0.0",
  group: "commercial",
  intent: "Compare pricing tiers or package options side by side",
  slots: {
    kicker: {
      type: "shortText",
      required: false,
      maxChars: 80,
      overflow: "truncateWithNote",
    },
    title: {
      type: "shortText",
      required: false,
      maxChars: 100,
      overflow: "truncateWithNote",
    },
    cards: {
      type: "cards",
      required: true,
      minItems: 2,
      maxItems: 4,
      overflow: "repair",
    },
  } as SemanticTemplateV1["slots"],
  supports: {
    tone: ["neutral", "confident", "premium"],
    density: ["airy", "normal"],
    emphasis: ["balanced", "data"],
  },
  layouts: [
    {
      id: "pricing-cards",
      density: ["airy", "normal"],
      emphasis: ["balanced", "data"],
      root: {
        type: "slide",
        style: SLIDE_CONTENT_STYLE,
        children: [
          {
            type: "text",
            role: "kicker",
            slot: "kicker",
            style: TEXT_KICKER_STYLE,
            layout: { frame: { x: 8, y: 6, w: 84, h: 5 }, zIndex: 1 },
          },
          {
            type: "text",
            role: "title",
            slot: "title",
            style: TEXT_TITLE_STYLE,
            layout: { frame: { x: 8, y: 12, w: 84, h: 14 }, zIndex: 2 },
          },
          {
            type: "group",
            component: "cardGrid",
            role: "card",
            slot: "cards",
            style: SURFACE_CARD_STYLE,
            layout: { frame: { x: 8, y: 28, w: 84, h: 62 }, zIndex: 3 },
            children: [
              {
                type: "text",
                role: "label",
                style: TEXT_SUBTITLE_STYLE,
                layout: { frame: { x: 10, y: 32, w: 20, h: 8 }, zIndex: 1 },
              },
              {
                type: "text",
                role: "metric",
                style: TEXT_METRIC_STYLE,
                layout: { frame: { x: 10, y: 42, w: 20, h: 12 }, zIndex: 2 },
              },
              {
                type: "text",
                role: "body",
                style: TEXT_BODY_STYLE,
                layout: { frame: { x: 10, y: 56, w: 20, h: 20 }, zIndex: 3 },
              },
            ],
          },
        ],
      },
    },
  ],
  selection: {
    priority: 55,
    bestFor: "Pricing tiers or commercial package comparison",
    signals: ["pricing", "tiers", "packages", "commercial"],
  },
};

// ---------------------------------------------------------------------------
// Team template
// ---------------------------------------------------------------------------

const TEAM_TEMPLATE: SemanticTemplateV1 = {
  schemaVersion: 1,
  kind: "team",
  label: "Team",
  version: "1.0.0",
  group: "orient",
  intent: "Introduce team members with names, roles, and brief bios",
  slots: {
    kicker: {
      type: "shortText",
      required: false,
      maxChars: 80,
      overflow: "truncateWithNote",
    },
    title: {
      type: "shortText",
      required: false,
      maxChars: 100,
      overflow: "truncateWithNote",
    },
    cards: {
      type: "cards",
      required: true,
      minItems: 1,
      maxItems: 6,
      overflow: "repair",
    },
  } as SemanticTemplateV1["slots"],
  supports: {
    tone: ["neutral", "warm", "confident", "premium"],
    density: ["airy", "normal"],
    emphasis: ["balanced", "visual"],
  },
  layouts: [
    {
      id: "team-cards",
      density: ["airy", "normal"],
      emphasis: ["balanced", "visual"],
      root: {
        type: "slide",
        style: SLIDE_CONTENT_STYLE,
        children: [
          {
            type: "text",
            role: "kicker",
            slot: "kicker",
            style: TEXT_KICKER_STYLE,
            layout: { frame: { x: 8, y: 6, w: 84, h: 5 }, zIndex: 1 },
          },
          {
            type: "text",
            role: "title",
            slot: "title",
            style: TEXT_TITLE_STYLE,
            layout: { frame: { x: 8, y: 12, w: 84, h: 12 }, zIndex: 2 },
          },
          {
            type: "group",
            component: "cardGrid",
            role: "card",
            slot: "cards",
            style: SURFACE_CARD_STYLE,
            layout: { frame: { x: 8, y: 26, w: 84, h: 64 }, zIndex: 3 },
            children: [
              {
                type: "text",
                role: "label",
                style: TEXT_SUBTITLE_STYLE,
                layout: { frame: { x: 10, y: 50, w: 22, h: 7 }, zIndex: 1 },
              },
              {
                type: "text",
                role: "caption",
                style: TEXT_CAPTION_STYLE,
                layout: { frame: { x: 10, y: 58, w: 22, h: 6 }, zIndex: 2 },
              },
            ],
          },
        ],
      },
    },
  ],
  selection: {
    priority: 55,
    bestFor: "Team introduction or people slide",
    signals: ["team", "people", "leadership", "bios"],
  },
};

// ---------------------------------------------------------------------------
// Visual Focus template
// ---------------------------------------------------------------------------

const VISUAL_FOCUS_TEMPLATE: SemanticTemplateV1 = {
  schemaVersion: 1,
  kind: "visual-focus",
  label: "Visual Focus",
  version: "1.0.0",
  group: "explain",
  intent: "Feature a dominant image or visual with minimal text",
  slots: {
    title: {
      type: "shortText",
      required: false,
      maxChars: 120,
      overflow: "truncateWithNote",
    },
    imagePrompt: {
      type: "image",
      required: true,
      maxChars: 400,
      overflow: "truncateWithNote",
    },
    caption: {
      type: "shortText",
      required: false,
      maxChars: 200,
      overflow: "truncateWithNote",
    },
  } as SemanticTemplateV1["slots"],
  supports: {
    tone: ["neutral", "confident", "warm", "premium"],
    density: ["airy", "normal"],
    emphasis: ["balanced", "visual"],
  },
  layouts: [
    {
      id: "visual-focus-hero",
      density: ["airy", "normal"],
      emphasis: ["balanced", "visual"],
      root: {
        type: "slide",
        style: SLIDE_CONTENT_STYLE,
        children: [
          {
            type: "image",
            role: "image",
            slot: "imagePrompt",
            style: MEDIA_HERO_STYLE,
            layout: { frame: { x: 0, y: 0, w: 100, h: 82 }, zIndex: 1 },
          },
          {
            type: "text",
            role: "title",
            slot: "title",
            style: TEXT_TITLE_STYLE,
            layout: { frame: { x: 8, y: 74, w: 84, h: 14 }, zIndex: 2 },
          },
          {
            type: "text",
            role: "caption",
            slot: "caption",
            style: TEXT_CAPTION_STYLE,
            layout: { frame: { x: 8, y: 88, w: 84, h: 6 }, zIndex: 3 },
          },
        ],
      },
    },
  ],
  selection: {
    priority: 55,
    bestFor: "Image-led or visual hero slide",
    signals: ["visual-focus", "image", "photo", "diagram"],
  },
};

// ---------------------------------------------------------------------------
// Closing template
// ---------------------------------------------------------------------------

const CLOSING_TEMPLATE: SemanticTemplateV1 = {
  schemaVersion: 1,
  kind: "closing",
  label: "Closing",
  version: "1.0.0",
  group: "closing",
  intent: "Close the presentation with a call to action or thank-you",
  slots: {
    kicker: {
      type: "shortText",
      required: false,
      maxChars: 80,
      overflow: "truncateWithNote",
    },
    title: {
      type: "shortText",
      required: true,
      maxChars: 120,
      overflow: "repair",
    },
    subtitle: {
      type: "shortText",
      required: false,
      maxChars: 200,
      overflow: "truncateWithNote",
    },
  } as SemanticTemplateV1["slots"],
  supports: {
    tone: ["neutral", "confident", "warm", "urgent", "premium"],
    density: ["airy", "normal"],
    emphasis: ["balanced", "title", "action"],
  },
  layouts: [
    {
      id: "closing-default",
      density: ["airy", "normal"],
      emphasis: ["balanced", "title", "action"],
      root: {
        type: "slide",
        style: SLIDE_COVER_STYLE,
        children: [
          {
            type: "text",
            role: "kicker",
            slot: "kicker",
            style: TEXT_KICKER_STYLE,
            layout: { frame: { x: 10, y: 28, w: 80, h: 6 }, zIndex: 1 },
          },
          {
            type: "text",
            role: "title",
            slot: "title",
            style: TEXT_TITLE_STYLE,
            layout: { frame: { x: 10, y: 35, w: 80, h: 18 }, zIndex: 2 },
          },
          {
            type: "text",
            role: "subtitle",
            slot: "subtitle",
            style: TEXT_SUBTITLE_STYLE,
            layout: { frame: { x: 10, y: 56, w: 80, h: 10 }, zIndex: 3 },
          },
        ],
      },
    },
  ],
  selection: {
    priority: 90,
    bestFor: "Final closing or call-to-action slide",
    signals: ["closing", "thank-you", "call-to-action", "next-steps", "end"],
  },
};

// ---------------------------------------------------------------------------
// Appendix template
// ---------------------------------------------------------------------------

const APPENDIX_TEMPLATE: SemanticTemplateV1 = {
  schemaVersion: 1,
  kind: "appendix",
  label: "Appendix",
  version: "1.0.0",
  group: "closing",
  intent: "Provide supplementary data, references, or detailed backup material",
  slots: {
    title: {
      type: "shortText",
      required: true,
      maxChars: 120,
      overflow: "repair",
    },
    body: {
      type: "paragraph",
      required: false,
      maxItems: 8,
      maxChars: 1000,
      overflow: "truncateWithNote",
    },
    table: {
      type: "table",
      required: false,
      minColumns: 1,
      maxColumns: 6,
      minRows: 1,
      maxRows: 12,
      maxCellChars: 120,
      overflow: "repair",
    },
  } as SemanticTemplateV1["slots"],
  supports: {
    tone: ["neutral", "technical"],
    density: ["normal", "dense"],
    emphasis: ["balanced", "data"],
  },
  layouts: [
    {
      id: "appendix-text",
      density: ["normal"],
      emphasis: ["balanced"],
      root: {
        type: "slide",
        style: SLIDE_CONTENT_STYLE,
        children: [
          {
            type: "text",
            role: "title",
            slot: "title",
            style: TEXT_TITLE_STYLE,
            layout: { frame: { x: 8, y: 6, w: 84, h: 12 }, zIndex: 1 },
          },
          {
            type: "text",
            role: "body",
            slot: "body",
            style: TEXT_BODY_STYLE,
            layout: { frame: { x: 8, y: 22, w: 84, h: 70 }, zIndex: 2 },
          },
        ],
      },
    },
    {
      id: "appendix-table",
      density: ["dense"],
      emphasis: ["data"],
      root: {
        type: "slide",
        style: SLIDE_CONTENT_STYLE,
        children: [
          {
            type: "text",
            role: "title",
            slot: "title",
            style: TEXT_TITLE_STYLE,
            layout: { frame: { x: 8, y: 4, w: 84, h: 12 }, zIndex: 1 },
          },
          {
            type: "table",
            role: "table",
            slot: "table",
            style: SURFACE_TABLE_STYLE,
            layout: { frame: { x: 8, y: 18, w: 84, h: 74 }, zIndex: 2 },
          },
        ],
      },
    },
  ],
  selection: {
    priority: 40,
    bestFor: "Appendix or supplementary backup slide",
    signals: ["appendix", "backup", "supplementary", "references"],
  },
};

// ---------------------------------------------------------------------------
// Registry builder
// ---------------------------------------------------------------------------

const BUILT_IN_TEMPLATES: SemanticTemplateV1[] = [
  COVER_TEMPLATE,
  SECTION_TEMPLATE,
  CONTENT_TEMPLATE,
  QUOTE_TEMPLATE,
  METRIC_ROW_TEMPLATE,
  COMPARISON_TEMPLATE,
  TABLE_TEMPLATE,
  RECOMMENDATION_TEMPLATE,
  AGENDA_TEMPLATE,
  EXECUTIVE_SUMMARY_TEMPLATE,
  DETAIL_TEMPLATE,
  BIG_STAT_TEMPLATE,
  INSIGHT_TEMPLATE,
  EVIDENCE_TEMPLATE,
  MATRIX_TEMPLATE,
  FRAMEWORK_TEMPLATE,
  PROCESS_TEMPLATE,
  TIMELINE_TEMPLATE,
  ROADMAP_TEMPLATE,
  ARCHITECTURE_TEMPLATE,
  CASE_STUDY_TEMPLATE,
  RISKS_TEMPLATE,
  PRICING_TEMPLATE,
  TEAM_TEMPLATE,
  VISUAL_FOCUS_TEMPLATE,
  CLOSING_TEMPLATE,
  APPENDIX_TEMPLATE,
];

/** Creates a pre-populated registry containing all built-in templates. */
export function createDefaultTemplateRegistry(): SemanticTemplateRegistry {
  const registry = new SemanticTemplateRegistry();
  for (const template of BUILT_IN_TEMPLATES) {
    registry.register(template);
  }
  return registry;
}

export { BUILT_IN_TEMPLATES };
