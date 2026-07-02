/** Core legacy v6 deck and slide schema types. */

import type { SlideFormat } from "@/lib/presentation/slide-format";
import type { SlideElement } from "./deck-elements";
import { STYLE_THEME_IDS } from "./presentation-theme-ids";

/** Explicit schema version for legacy v6 deck payloads. */
export const LEGACY_DECK_SCHEMA_VERSION = 6;

/**
 * Canonical presentation theme names — identical to the visual style theme
 * catalog ({@link STYLE_THEME_IDS}). Persisted decks with an unrecognised
 * `themeId` still parse because the validator only requires a non-empty
 * string; renderers fall back to the visual default token set via the generic
 * resolver fallback.
 *
 * Exported as a `const` array so it is the single source of truth for both the
 * {@link PresentationThemeId} type and any code (validators, AI prompts) that needs to
 * enumerate the allowed values at runtime.
 */
export const PRESENTATION_THEME_IDS = [...STYLE_THEME_IDS] as const;

/** Presentation themes — derived from the visual style theme catalog. */
export type PresentationThemeId = (typeof PRESENTATION_THEME_IDS)[number];

/* node:coverage ignore next 6 -- type-only deck aliases are erased by tsx and map to uncovered comment lines. */
export type ColorRef = { token: string } | { value: string };

export interface BackgroundGradientStop {
  color: ColorRef;
  offset?: number;
}

export type SlideBackgroundDesign =
  | { type: "solid"; color: ColorRef }
  | {
      type: "gradient";
      from: ColorRef;
      to: ColorRef;
      angle?: number;
      stops?: BackgroundGradientStop[];
    }
  | {
      type: "radialGradient";
      inner: ColorRef;
      outer: ColorRef;
      cx?: number;
      cy?: number;
      r?: number;
      rx?: number;
      ry?: number;
      stops?: BackgroundGradientStop[];
    }
  | { type: "image"; url: string; assetId?: string };

export interface SlideDesignOverrides {
  background?: SlideBackgroundDesign;
  accent?: ColorRef;
  [key: string]: unknown;
}

export interface PresentationDesign {
  themeId: string;
  themeOverrides?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SlideSourceMetadata {
  sectionId?: string;
  [key: string]: unknown;
}

export type MasterElement = SlideElement & {
  layer: "background" | "foreground";
  locked: true;
  masterChromeKind: MasterChromeKind;
};

export type MasterChromeKind = "logo" | "footer" | "pageNumber" | "watermark";

export interface SlideMaster {
  id: string;
  name: string;
  background?: SlideBackgroundDesign;
  designOverrides?: SlideDesignOverrides;
  elements: MasterElement[];
  [key: string]: unknown;
}

export interface SlideTemplateElement {
  id: string;
  kind: string;
  role?: string;
  box?: unknown;
  contentDefaults?: Record<string, unknown>;
  designOverrides?: Record<string, unknown>;
  opacity?: number;
  rotation?: number;
  locked?: boolean;
  name?: string;
  [key: string]: unknown;
}

export type SlideTemplateSource = "system" | "theme" | "custom";
export type SlideTemplateStyleMode = "fixed" | "theme-aware";

export interface SlideTemplateSlotBinding {
  slot: string;
  target: string;
  elementRole?: string;
  elementIndex?: number;
}

export interface SlideTemplate {
  id: string;
  name: string;
  category: "title" | "section" | "content" | "media" | "comparison" | "blank";
  source?: SlideTemplateSource;
  semanticKind?: string;
  layoutFamily?: string;
  styleMode?: SlideTemplateStyleMode;
  accepts?: string[];
  capacity?: object;
  bindings?: SlideTemplateSlotBinding[];
  defaultMasterId?: string;
  slideDesignDefaults?: SlideDesignOverrides;
  elements: SlideTemplateElement[];
  [key: string]: unknown;
}

/** A single slide in the presentation deck. */
export interface Slide {
  [key: string]: unknown;

  /** Stable unique identifier for the slide — persisted in `deckJson`. */
  id: string;

  /** Zero-based position in the deck. */
  index: number;

  /** Slide heading / title text (may be empty for the first/preamble slide). */
  title: string;

  /** Speaker notes — overflow prose + quote blocks. */
  notes: string;

  /** Optional master id. When absent, `Deck.defaultMasterId` is used. */
  masterId?: string;

  /** Template provenance only; templates are materialized into real elements. */
  templateId?: string;

  /** Slide-local design overrides such as background or accent. */
  designOverrides?: SlideDesignOverrides;

  /**
   * Free-form positioned elements. This is the authoritative slide content
   * consumed by renderers and exporters.
   */
  elements?: SlideElement[];

  /** Optional provenance for document-derived slides. */
  source?: SlideSourceMetadata;
}

/** A complete presentation deck derived from a document's block structure. */
export interface Deck {
  [key: string]: unknown;

  /** Monotonically-increasing deck schema version. */
  schemaVersion?: typeof LEGACY_DECK_SCHEMA_VERSION;

  /** Deck-wide canvas settings. */
  canvas?: { format: SlideFormat };

  /** Presentation design selector and global overrides. */
  design?: PresentationDesign;

  /** Deck-owned master slide catalogue. */
  masters?: SlideMaster[];

  /** Id of the master used when a slide omits `masterId`. */
  defaultMasterId?: string;

  /** Optional deck-local custom slide templates. */
  customTemplates?: SlideTemplate[];

  /** Ordered list of slides. */
  slides: Slide[];

  /**
   * Stable hash of the document content this deck was last derived/synced
   * against (see `deck-hash.ts`). Embedded in the persisted deck JSON — NO
   * schema change — so staleness can be detected without a separate column:
   * on open the editor recomputes the live content hash and compares it against
   * this value to surface `isDeckStale`. Absent values are treated as
   * "staleness unknown" and the banner stays hidden, while the manual
   * "Sync from document" action remains available.
   */
  deckContentHash?: string;
}
