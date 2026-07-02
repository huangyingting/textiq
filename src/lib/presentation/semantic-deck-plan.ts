/**
 * Semantic deck plan schema for presentation.
 *
 * Semantic plans are template-compiler inputs, not rendered decks and not
 * intrinsically AI-specific. Document-derived, AI-generated, and hand-authored
 * planning paths can all project into this source-agnostic shape before repair
 * and template compilation.
 */

import type {
  SemanticTemplateKind,
  SlideTone,
  SlideDensity,
  SlideEmphasis,
  SlotKey,
  AssetId,
} from "./schema";

// ---------------------------------------------------------------------------
// Slot values
// ---------------------------------------------------------------------------

export type BulletSlotItem = { text: string; children?: BulletSlotItem[] };
export type MetricSlotItem = { value: string; label: string; detail?: string };
export type CardSlotItem = { title: string; body?: string; metric?: string };
export type StepSlotItem = { title: string; body?: string; date?: string };
export type TimelineSlotItem = {
  label: string;
  title: string;
  body?: string;
};

export type SlotValue =
  | { type: "shortText"; text: string }
  | { type: "paragraph"; paragraphs: string[] }
  | { type: "bullets"; items: BulletSlotItem[] }
  | { type: "metric"; value: string; label: string; detail?: string }
  | { type: "metrics"; items: MetricSlotItem[] }
  | { type: "cards"; items: CardSlotItem[] }
  | { type: "steps"; items: StepSlotItem[] }
  | {
      type: "image";
      assetId?: AssetId;
      prompt?: string;
      alt?: string;
    }
  | {
      type: "table";
      columns: string[];
      rows: string[][];
      caption?: string;
    }
  | { type: "timeline"; items: TimelineSlotItem[] }
  | { type: "visual"; visualId: string; caption?: string };

// ---------------------------------------------------------------------------
// Semantic slide spec
// ---------------------------------------------------------------------------

export type SemanticSlideSpecV1 = {
  kind: SemanticTemplateKind;
  tone?: SlideTone;
  density?: SlideDensity;
  emphasis?: SlideEmphasis;
  slots: Partial<Record<SlotKey, SlotValue>>;
  speakerNotes?: string;
};

// ---------------------------------------------------------------------------
// Semantic deck plan
// ---------------------------------------------------------------------------

export type SemanticDeckPlanV1 = {
  planVersion: 1;
  title?: string;
  locale?: string;
  slides: SemanticSlideSpecV1[];
};

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isSlotValue(value: unknown): value is SlotValue {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.type === "string";
}
