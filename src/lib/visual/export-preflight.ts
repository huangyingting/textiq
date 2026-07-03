/**
 * Export preflight diagnostics for Slides.
 *
 * Runs a pure, synchronous inspection of a {@link Deck} before a PPTX or
 * image export and returns a structured list of {@link PreflightDiagnostic}
 * items.  The caller is responsible for deciding whether to block the export
 * (check {@link PreflightResult.hasFatal}) or surface fidelity warnings.
 *
 * Design goals:
 *  - Pure and headless — no DOM, no browser APIs, no Prisma.  Safe to run in
 *    server actions, API routes, and unit tests.
 *  - Distinguishes FATAL errors (the exported file will be broken or missing
 *    essential content) from fidelity WARNINGs (the file will open but will
 *    look different from the editor preview).
 *  - Each diagnostic carries a stable `code` string so UI components can
 *    localise messages without parsing the `message` field.
 */

import {
  normalizeTextParagraphs,
  type Deck,
  type ImageElement,
  type ShapeElement,
  type SlideElement,
} from "@/lib/document/deck-model";
import { isPrimarilyCjk } from "@/lib/presentation/slide-fonts";
import type { ExportPolicy } from "@/lib/visual/export-policy";
import { getFidelity } from "@/lib/visual/export-fidelity";
import {
  getOutputProfile,
  type OutputProfileId,
} from "@/lib/visual/output-profiles";
import {
  EXPORT_PREFLIGHT_MAX_SLIDES,
  budgetExceededDiagnostic,
  checkLimit,
  type BudgetCheckResult,
  type BudgetExceededDiagnostic,
} from "@/lib/limits";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Blocking export error vs non-blocking fidelity degradation. */
export type PreflightSeverity = "fatal" | "warning";

/**
 * Stable diagnostic codes produced by the preflight check.
 *
 * - `missing-asset`           — an image element has no resolvable source
 *                               (no `src`, no `assetId`, empty URL).
 * - `missing-font`            — a text/bullets element references a custom
 *                               font that is not embedded in the PPTX format.
 * - `unsupported-pptx-feature`— a feature used in the deck has "partial" or
 *                               "unsupported" fidelity in the PPTX target.
 * - `raster-fallback`         — an image element will be rasterised rather
 *                               than embedded as a vector in PPTX.
 * - `remote-image-failure`    — an image element references a remote URL that
 *                               could fail at export time.
 * - `oversized-deck`          — the deck exceeds the recommended slide count
 *                               threshold, risking large file size or OOM.
 * - `font-cjk-mapping`        — editable PPTX maps the self-hosted CJK font to
 *                               an Office font (e.g. Microsoft YaHei); Chinese
 *                               text may look slightly different from preview.
 */
export type PreflightCode =
  | "missing-asset"
  | "missing-font"
  | "unsupported-pptx-feature"
  | "raster-fallback"
  | "remote-image-failure"
  | "oversized-deck"
  | "font-cjk-mapping";

/** A single preflight finding. */
export interface PreflightDiagnostic {
  /** Error (blocks export) vs warning (degrades fidelity). */
  severity: PreflightSeverity;
  /** Stable machine-readable code. */
  code: PreflightCode;
  /** Human-readable description (English). */
  message: string;
  /** Zero-based index of the affected slide, when applicable. */
  slideIndex?: number;
  /** Element id on the affected slide, when applicable. */
  elementId?: string;
  /** Additional context (feature name, URL prefix, etc.). */
  detail?: string;
  /** Advisory performance-budget check result, when the finding is budget-based. */
  budget?: BudgetCheckResult;
  /** Safe structured BUDGET_EXCEEDED metadata for diagnostics/logging. */
  diagnostic?: BudgetExceededDiagnostic;
}

/** Aggregated result returned by {@link runExportPreflight}. */
export interface PreflightResult {
  /** All diagnostics found during the preflight scan. */
  diagnostics: PreflightDiagnostic[];
  /** True when at least one FATAL diagnostic is present. */
  hasFatal: boolean;
  /** True when at least one WARNING diagnostic is present. */
  hasWarnings: boolean;
  /**
   * Convenience flag — `true` when the export is safe to proceed (no fatal
   * errors).  The caller should still surface any warnings.
   */
  canExport: boolean;
  /**
   * Resolved output profile metadata when a profile is supplied. Preflight reads
   * this from the shared output profile catalog instead of duplicating data.
   */
  outputProfile?: PreflightOutputProfile;
  /** Entitlement-derived export policy summary relevant to export checks. */
  exportPolicy?: PreflightExportPolicy;
}

/** Which export format is being preflight-checked. */
export type PreflightTarget = "pptx" | "image";

/** Options accepted by {@link runExportPreflight}. */
export interface PreflightOptions {
  /** Target export format — affects which feature checks apply. */
  target: PreflightTarget;
  /**
   * Maximum number of slides before an `oversized-deck` warning is emitted.
   * Defaults to {@link DEFAULT_MAX_SLIDES}.
   */
  maxSlides?: number;
  /**
   * Custom font families used in the deck (e.g. from the applied brand).
   * When provided, any element whose `fontFamily` matches one of these is
   * reported as `missing-font` for PPTX (fonts are not embedded).
   */
  customFontFamilies?: ReadonlySet<string>;
  /** Optional output profile id to resolve from the shared catalog. */
  outputProfile?: OutputProfileId;
  /** Optional centralized export entitlement/watermark policy. */
  exportPolicy?: ExportPolicy;
}

export interface PreflightOutputProfile {
  id: OutputProfileId;
  label: string;
  canonicalWidth: number;
  canonicalHeight: number;
  aspectRatio: string;
  padding: number;
  background: string;
  minScale: number;
}

export interface PreflightExportPolicy {
  canSvg: boolean;
  canPptx: boolean;
  canRemoveWatermark: boolean;
  defaultWatermark: boolean;
}

type UnknownRecord = Record<string, unknown>;

interface ThemeTypographyTokens {
  fontFamily?: string;
  headingFontFamily?: string;
  roles?: Record<string, { fontFamily?: string } | undefined>;
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === "object");
}

function typographyTokens(deck: Deck): ThemeTypographyTokens | undefined {
  const tokenSet = isRecord(deck.design?.themeOverrides)
    ? deck.design.themeOverrides.tokenSet
    : undefined;
  const typography = isRecord(tokenSet) ? tokenSet.typography : undefined;
  if (!isRecord(typography)) return undefined;

  const roles = isRecord(typography.roles)
    ? Object.fromEntries(
        Object.entries(typography.roles).flatMap(([role, token]) =>
          isRecord(token) && typeof token.fontFamily === "string"
            ? [[role, { fontFamily: token.fontFamily }]]
            : [],
        ),
      )
    : undefined;

  return {
    ...(typeof typography.fontFamily === "string"
      ? { fontFamily: typography.fontFamily }
      : {}),
    ...(typeof typography.headingFontFamily === "string"
      ? { headingFontFamily: typography.headingFontFamily }
      : {}),
    ...(roles && Object.keys(roles).length > 0 ? { roles } : {}),
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Slide count above which an `oversized-deck` warning is emitted. */
export const DEFAULT_MAX_SLIDES = EXPORT_PREFLIGHT_MAX_SLIDES;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns true when the image element will require a raster fallback in PPTX. */
function imageNeedsRasterFallback(el: ImageElement): boolean {
  const fitMode = el.designOverrides?.fitMode;
  const maskShape = el.designOverrides?.maskShape;
  const crop = el.content.crop;
  if (fitMode === "none") return true;
  if (maskShape && maskShape !== "none") return true;
  if (crop) return true;
  return false;
}

function shapeNeedsRasterFallback(el: ShapeElement): boolean {
  const design = el.designOverrides;
  const fill = design?.fill;
  return Boolean(
    design?.effect ||
    (fill &&
      typeof fill === "object" &&
      "type" in fill &&
      (fill.type === "radialGradient" || fill.type === "linearGradient")),
  );
}

/** Returns true when the string looks like a remote (http/https) URL. */
function isRemoteUrl(src: string): boolean {
  return src.startsWith("http://") || src.startsWith("https://");
}

/** Extracts the first font-family name from a CSS font stack. */
function primaryFontFamily(fontFamily: string): string {
  return fontFamily
    .split(",")[0]
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .trim();
}

function imageField<T>(
  element: ImageElement,
  field:
    | keyof ImageElement["content"]
    | keyof NonNullable<ImageElement["designOverrides"]>,
): T | undefined {
  return (element.content[field as keyof ImageElement["content"]] ??
    element.designOverrides?.[
      field as keyof NonNullable<ImageElement["designOverrides"]>
    ]) as T | undefined;
}

function resolvePreflightOutputProfile(
  outputProfile: OutputProfileId | undefined,
): PreflightOutputProfile | undefined {
  if (!outputProfile) return undefined;
  const profile = getOutputProfile(outputProfile);
  return {
    id: profile.id,
    label: profile.label,
    canonicalWidth: profile.canonicalWidth,
    canonicalHeight: profile.canonicalHeight,
    aspectRatio: profile.aspectRatio,
    padding: profile.padding,
    background: profile.background,
    minScale: profile.minScale,
  };
}

function resolvePreflightExportPolicy(
  policy: ExportPolicy | undefined,
): PreflightExportPolicy | undefined {
  if (!policy) return undefined;
  return {
    canSvg: policy.canSvg,
    canPptx: policy.canPptx,
    canRemoveWatermark: policy.canRemoveWatermark,
    defaultWatermark: policy.defaultWatermark,
  };
}

// ---------------------------------------------------------------------------
// Core preflight checks
// ---------------------------------------------------------------------------

/* node:coverage ignore next -- parameter-only row is covered by image preflight cases but mapped as uncovered by tsx. @preserve */
function checkImageElement(
  el: ImageElement,
  slideIndex: number,
  /* node:coverage ignore next -- parameter-only row is covered by PPTX/image target cases but mapped as uncovered by tsx. @preserve */
  target: PreflightTarget,
  /* node:coverage ignore next -- parameter-only row is covered by diagnostic-producing image cases but mapped as uncovered by tsx. @preserve */
  diagnostics: PreflightDiagnostic[],
): void {
  const src = imageField<string>(el, "src");
  const assetId = imageField<string>(el, "assetId");
  const hasSrc = src && src.trim() !== "";
  const hasAssetId = Boolean(assetId);

  // Missing-asset check (fatal for both targets).
  if (!hasSrc && !hasAssetId) {
    diagnostics.push({
      severity: "fatal",
      code: "missing-asset",
      message: `Slide ${slideIndex + 1}: image element has no source — it will appear broken in the export.`,
      slideIndex,
      elementId: el.id,
    });
    return; // no further checks for this element
  }

  if (target === "pptx") {
    // Raster-fallback warning.
    if (imageNeedsRasterFallback(el)) {
      diagnostics.push({
        severity: "warning",
        code: "raster-fallback",
        message: `Slide ${slideIndex + 1}: image element will be rasterised in PPTX (fitMode/mask/crop).`,
        slideIndex,
        elementId: el.id,
        detail:
          imageField<string>(el, "fitMode") ??
          imageField<string>(el, "maskShape") ??
          "crop",
      });
    }

    // Remote-image warning.
    if (hasSrc && src && isRemoteUrl(src)) {
      diagnostics.push({
        severity: "warning",
        code: "remote-image-failure",
        message: `Slide ${slideIndex + 1}: image references a remote URL that could fail at export time.`,
        slideIndex,
        elementId: el.id,
        detail: src.slice(0, 80),
      });
    }
  }
}

function checkShapeElement(
  el: ShapeElement,
  slideIndex: number,
  target: PreflightTarget,
  diagnostics: PreflightDiagnostic[],
): void {
  if (target !== "pptx" || !shapeNeedsRasterFallback(el)) return;
  const fill = el.designOverrides?.fill;
  const fillType =
    fill && typeof fill === "object" && "type" in fill ? fill.type : undefined;
  diagnostics.push({
    severity: "warning",
    code: "raster-fallback",
    message: `Slide ${slideIndex + 1}: shape element will be rasterised in PPTX (gradient fill/shape effect).`,
    slideIndex,
    elementId: el.id,
    detail: el.designOverrides?.effect?.kind ?? fillType ?? "radialGradient",
  });
}

/**
 * Deck-level check: warns when an applied custom presentation theme (e.g. a
 * brand-derived theme override token set) declares typography fonts that PPTX cannot
 * embed. The element-level font override now stores a self-hosted slide
 * `fontId`, so only template/brand typography can introduce a non-embeddable
 * custom font. Gated on the caller-provided `customFontFamilies` set so
 * behaviour stays predictable and opt-in.
 */
function checkCustomTemplateFonts(
  deck: Deck,
  customFontFamilies: ReadonlySet<string>,
  diagnostics: PreflightDiagnostic[],
): void {
  const typography = typographyTokens(deck);
  if (!typography) return;

  const candidates: string[] = typography.fontFamily
    ? [typography.fontFamily]
    : [];
  if (typography.headingFontFamily) {
    candidates.push(typography.headingFontFamily);
  }
  if (typography.roles) {
    for (const token of Object.values(typography.roles)) {
      if (token?.fontFamily) candidates.push(token.fontFamily);
    }
  }

  const seen = new Set<string>();
  for (const stack of candidates) {
    const primary = primaryFontFamily(stack);
    if (seen.has(primary)) continue;
    seen.add(primary);
    if (customFontFamilies.has(primary)) {
      diagnostics.push({
        severity: "warning",
        code: "missing-font",
        message: `Presentation theme uses custom font "${primary}" which is not embedded in PPTX — Office will substitute a system font.`,
        detail: primary,
      });
    }
  }
}

/** Collects the visible text strings from a slide's text-bearing elements. */
function slideTextStrings(slide: Deck["slides"][number]): string[] {
  const out: string[] = [];
  for (const el of slide.elements ?? []) {
    if (el.hidden) continue;
    if (el.kind === "text") {
      for (const paragraph of normalizeTextParagraphs(el)) {
        if (paragraph.text) out.push(paragraph.text);
      }
    } else if (el.kind === "shape") {
      if (el.content.text) out.push(el.content.text);
    }
  }
  return out;
}

/**
 * Deck-level notice: editable PPTX maps the self-hosted CJK fallback
 * (`Noto Sans SC`) to an Office CJK font (e.g. Microsoft YaHei). Chinese text
 * may render slightly differently from the TextIQ preview on the target client.
 * Emitted once per deck, only when the deck actually contains Chinese text, so
 * Latin-only decks are unaffected. Non-blocking.
 */
function checkCjkFontMapping(
  deck: Deck,
  diagnostics: PreflightDiagnostic[],
): void {
  const hasCjk = deck.slides.some((slide) =>
    slideTextStrings(slide).some((text) => isPrimarilyCjk(text)),
  );
  if (!hasCjk) return;
  diagnostics.push({
    severity: "warning",
    code: "font-cjk-mapping",
    message:
      "Editable PPTX maps fonts to Office-compatible faces. Chinese text may look slightly different from the TextIQ preview on machines without the mapped font.",
  });
}

function checkPptxFidelityFeatures(
  slide: Deck["slides"][number],
  slideIndex: number,
  elements: SlideElement[],
  diagnostics: PreflightDiagnostic[],
): void {
  // Connector routing — check for elbow connectors.
  for (const el of elements) {
    if (el.kind === "connector" && el.content.routing === "elbow") {
      const fidelity = getFidelity("connector-elbow", "pptx");
      if (fidelity === "partial" || fidelity === "degraded") {
        diagnostics.push({
          severity: "warning",
          code: "unsupported-pptx-feature",
          message: `Slide ${slideIndex + 1}: elbow connectors export as straight lines in PPTX.`,
          slideIndex,
          elementId: el.id,
          detail: "connector-elbow",
        });
      }
    }
  }

  // Background gradient.
  if (slide.designOverrides?.background?.type === "gradient") {
    diagnostics.push({
      severity: "warning",
      code: "unsupported-pptx-feature",
      message: `Slide ${slideIndex + 1}: gradient background is approximated as a flat colour in PPTX.`,
      slideIndex,
      detail: "background-gradient",
    });
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Runs a synchronous, pure preflight check on a {@link Deck} before export.
 *
 * Returns a {@link PreflightResult} containing all found diagnostics.
 * The caller should:
 *  1. If `result.hasFatal` — block the export and surface the fatal errors.
 *  2. If `result.hasWarnings` — surface warnings in the export dialog.
 *  3. Otherwise — proceed with export.
 *
 * This function is safe to call in any environment (Node, browser, tests).
 */
export function runExportPreflight(
  deck: Deck,
  options: PreflightOptions,
): PreflightResult {
  const {
    target,
    maxSlides = DEFAULT_MAX_SLIDES,
    customFontFamilies = new Set<string>(),
    outputProfile,
    exportPolicy,
  } = options;

  const diagnostics: PreflightDiagnostic[] = [];

  // Oversized-deck check.
  const slideBudget = checkLimit(
    {
      id: "export.preflight.slides",
      description: "Export preflight slide count threshold.",
      value: maxSlides,
      unit: "count",
      enforcement: "warning",
      warnAt: maxSlides,
      diagnostic: { scope: "export.preflight", metric: "slideCount" },
      source: "src/lib/visual/export-preflight.ts",
    },
    deck.slides.length,
  );
  if (slideBudget.exceeded) {
    diagnostics.push({
      severity: "warning",
      code: "oversized-deck",
      message: `Deck has ${deck.slides.length} slides (recommended maximum: ${maxSlides}). Export file may be very large.`,
      detail: String(deck.slides.length),
      budget: {
        metric: slideBudget.metric,
        actual: slideBudget.actual,
        warnAt: slideBudget.warnAt,
        hardAt: slideBudget.hardAt,
        exceeded: slideBudget.exceeded,
        warned: slideBudget.warned,
      },
      diagnostic: budgetExceededDiagnostic(slideBudget),
    });
  }

  // Deck-level custom template font check.
  if (target === "pptx" && customFontFamilies.size > 0) {
    checkCustomTemplateFonts(deck, customFontFamilies, diagnostics);
  }

  // Deck-level CJK font-mapping notice: editable PPTX maps the self-hosted CJK
  // fallback to an Office CJK font, which can differ from the TextIQ preview.
  if (target === "pptx") {
    checkCjkFontMapping(deck, diagnostics);
  }

  // Per-slide element checks.
  for (let i = 0; i < deck.slides.length; i++) {
    const slide = deck.slides[i];
    const elements = [...(slide.elements ?? [])].filter((el) => !el.hidden);

    for (const el of elements) {
      if (el.kind === "image") {
        checkImageElement(el, i, target, diagnostics);
      } else if (el.kind === "shape") {
        checkShapeElement(el, i, target, diagnostics);
      }
    }

    if (target === "pptx") {
      checkPptxFidelityFeatures(slide, i, elements, diagnostics);
    }
  }

  // Note: per-element checks above handle connector-elbow, image-*, and
  // background-gradient. Deck-level fidelity warnings (shadow, theme-typography)
  // are only meaningful when those features are actually present in the deck,
  // so we skip generic unconditional emission here to avoid false positives.

  const hasFatal = diagnostics.some((d) => d.severity === "fatal");
  const hasWarnings = diagnostics.some((d) => d.severity === "warning");

  const result: PreflightResult = {
    diagnostics,
    hasFatal,
    hasWarnings,
    canExport: !hasFatal,
  };
  const resolvedOutputProfile = resolvePreflightOutputProfile(outputProfile);
  if (resolvedOutputProfile) {
    result.outputProfile = resolvedOutputProfile;
  }
  const resolvedExportPolicy = resolvePreflightExportPolicy(exportPolicy);
  if (resolvedExportPolicy) {
    result.exportPolicy = resolvedExportPolicy;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Convenience helpers for the export menu / dialog
// ---------------------------------------------------------------------------

/** Returns only the fatal diagnostics from a preflight result. */
export function fatalDiagnostics(
  result: PreflightResult,
): PreflightDiagnostic[] {
  return result.diagnostics.filter((d) => d.severity === "fatal");
}

/** Returns only the warning diagnostics from a preflight result. */
export function warningDiagnostics(
  result: PreflightResult,
): PreflightDiagnostic[] {
  return result.diagnostics.filter((d) => d.severity === "warning");
}
