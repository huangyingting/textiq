/**
 * Semantic template schema and registry for the presentation system.
 *
 * Templates own layout structure. Theme packages own visual style.
 * AI fills semantic slots. These layers must not leak into each other.
 */

import type { TemplateVersion, JsonValue, AssetId } from "./types";
import type { StyleBinding } from "./style-schema";
import type {
  SemanticTemplateKind,
  SlideTone,
  SlideDensity,
  SlideEmphasis,
  SemanticRole,
  SlotKey,
  LayoutBox,
  GroupComponentKind,
  SlideChildNode,
} from "./schema";

// ---------------------------------------------------------------------------
// Slot contracts
// ---------------------------------------------------------------------------

export type SlotValueType =
  | "shortText"
  | "paragraph"
  | "bullets"
  | "metric"
  | "metrics"
  | "cards"
  | "steps"
  | "image"
  | "table"
  | "timeline"
  | "visual";

export type OverflowPolicy =
  | "reject"
  | "repair"
  | "chooseDenserLayout"
  | "splitSlide"
  | "truncateWithNote";

export type TemplateStaticContent =
  | { type: "text"; text: string }
  | { type: "shape"; shape: string }
  | { type: "image"; assetId: AssetId };

export type SlotContract = {
  type: SlotValueType;
  required: boolean;
  maxChars?: number;
  maxItems?: number;
  minItems?: number;
  minRows?: number;
  maxRows?: number;
  minColumns?: number;
  maxColumns?: number;
  maxCellChars?: number;
  overflow: OverflowPolicy;
};

// ---------------------------------------------------------------------------
// Control support
// ---------------------------------------------------------------------------

export type TemplateControlSupport = {
  tone: SlideTone[];
  density: SlideDensity[];
  emphasis: SlideEmphasis[];
};

// ---------------------------------------------------------------------------
// Template groups
// ---------------------------------------------------------------------------

export type TemplateGroup =
  | "orient"
  | "explain"
  | "compare"
  | "prove"
  | "sequence"
  | "decision"
  | "commercial"
  | "closing";

// ---------------------------------------------------------------------------
// Layout variants
// ---------------------------------------------------------------------------

export type TemplateNodeBlueprint = {
  type: SlideChildNode["type"] | "slide";
  component?: GroupComponentKind;
  role?: SemanticRole;
  slot?: SlotKey;
  layout?: LayoutBox;
  style: StyleBinding;
  content?: TemplateStaticContent;
  props?: Record<string, JsonValue>;
  children?: TemplateNodeBlueprint[];
};

export type TemplateLayoutVariant = {
  id: string;
  density: SlideDensity[];
  emphasis: SlideEmphasis[];
  root: TemplateNodeBlueprint;
};

// ---------------------------------------------------------------------------
// Selection metadata
// ---------------------------------------------------------------------------

export type TemplateSelectionMetadata = {
  priority: number;
  bestFor: string;
  avoidFor?: string;
  signals: string[];
};

// ---------------------------------------------------------------------------
// Full template contract
// ---------------------------------------------------------------------------

export type SemanticTemplateV1 = {
  schemaVersion: 1;
  kind: SemanticTemplateKind;
  label: string;
  version: TemplateVersion;
  group: TemplateGroup;
  intent: string;
  slots: Record<SlotKey, SlotContract>;
  supports: TemplateControlSupport;
  layouts: TemplateLayoutVariant[];
  selection: TemplateSelectionMetadata;
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const SEMANTIC_TEMPLATE_KINDS: readonly SemanticTemplateKind[] = [
  "cover",
  "agenda",
  "section",
  "executive-summary",
  "content",
  "detail",
  "quote",
  "big-stat",
  "metric-row",
  "insight",
  "evidence",
  "table",
  "comparison",
  "matrix",
  "framework",
  "process",
  "timeline",
  "roadmap",
  "architecture",
  "case-study",
  "risks",
  "recommendation",
  "pricing",
  "team",
  "visual-focus",
  "closing",
  "appendix",
] as const;

const SEMANTIC_TEMPLATE_KIND_SET = new Set<string>(SEMANTIC_TEMPLATE_KINDS);

export function isSemanticTemplateKind(
  value: unknown,
): value is SemanticTemplateKind {
  return typeof value === "string" && SEMANTIC_TEMPLATE_KIND_SET.has(value);
}

export class SemanticTemplateRegistry {
  private readonly _templates = new Map<
    SemanticTemplateKind,
    SemanticTemplateV1
  >();

  register(template: SemanticTemplateV1): void {
    this._templates.set(template.kind, template);
  }

  get(kind: SemanticTemplateKind): SemanticTemplateV1 | undefined {
    return this._templates.get(kind);
  }

  has(kind: SemanticTemplateKind): boolean {
    return this._templates.has(kind);
  }

  allKinds(): SemanticTemplateKind[] {
    return [...this._templates.keys()];
  }

  all(): SemanticTemplateV1[] {
    return [...this._templates.values()];
  }
}

/** Selects the best layout for the given controls using deterministic rules:
 *  1. Exact density+emphasis match.
 *  2. Density match only.
 *  3. Emphasis match only.
 *  4. First layout (template default).
 */
export function selectLayout(
  template: SemanticTemplateV1,
  density?: SlideDensity,
  emphasis?: SlideEmphasis,
): TemplateLayoutVariant {
  const layouts = template.layouts;
  if (layouts.length === 0) {
    throw new Error(`Template "${template.kind}" has no layouts`);
  }
  if (density && emphasis) {
    const exact = layouts.find(
      (l) => l.density.includes(density) && l.emphasis.includes(emphasis),
    );
    if (exact) return exact;
  }
  if (density) {
    const densityMatch = layouts.find((l) => l.density.includes(density));
    if (densityMatch) return densityMatch;
  }
  if (emphasis) {
    const emphasisMatch = layouts.find((l) => l.emphasis.includes(emphasis));
    if (emphasisMatch) return emphasisMatch;
  }
  return layouts[0];
}
