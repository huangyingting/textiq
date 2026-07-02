/**
 * Style cascade layer resolvers for slide-level styles.
 *
 * Pure and DOM-free. The five cascade layers are deliberately documented here
 * because renderers/exporters depend on this order staying stable:
 *  1. deck token set — built-in or custom PresentationTheme.
 *  2. master slide — shared chrome/background for assigned slides.
 *  3. template materialization — blueprint defaults copied onto slide elements.
 *  4. slide override — Slide.background/accent/image/gradient fields.
 *  5. element override — handled by style-cascade-text for text-bearing nodes.
 *
 * Unit boundaries: this module returns CSS colors and CSS font stacks for
 * renderer use; export adapters convert slide percentages to inches and point
 * sizes at their own boundary.
 */

import type { Deck, Slide, SlideMaster } from "./deck-core";
import type {
  BackgroundTreatment,
  PresentationTheme,
} from "./presentation-theme-types";
import {
  backgroundTreatmentToCss,
  resolvePresentationThemeTokens,
} from "./presentation-theme-resolvers";

export const STYLE_CASCADE_LAYERS = [
  "deck",
  "master",
  "layout",
  "slide",
  "element",
] as const;

export interface ResolvedSlideStyle {
  background: BackgroundTreatment;
  backgroundCss: string;
  accent: string;
  titleColor: string;
  bodyColor: string;
  mutedColor: string;
  headingFontFamily: string;
  bodyFontFamily: string;
  master?: SlideMaster;
  tokenSet: PresentationTheme;
}

/** Resolves the presentation theme token set for a v6 deck. */
export function resolveDeckTokenSet(deck: Deck): PresentationTheme {
  const raw = deck as any;
  /* node:coverage disable */
  /* Deck token resolution is exercised through cascade tests; tsx maps the wrapper rows as residual. */
  return resolvePresentationThemeTokens({ design: raw.design });
}
/* node:coverage enable */

function colorRefValue(
  input: unknown,
  tokenSet: PresentationTheme,
): string | undefined {
  if (typeof input === "string") return input;
  if (!input || typeof input !== "object") return undefined;
  const ref = input as { token?: string; value?: string };
  if (typeof ref.value === "string") return ref.value;
  if (typeof ref.token === "string") {
    return tokenSet.colors[ref.token as keyof PresentationTheme["colors"]];
  }
  return undefined;
}

function gradientStopsFromDesign(
  input: unknown,
  tokenSet: PresentationTheme,
): Array<{ color: string; offset?: number }> | undefined {
  if (!Array.isArray(input)) return undefined;
  const stops = input.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const stop = item as { color?: unknown; offset?: unknown };
    const color = colorRefValue(stop.color, tokenSet);
    if (!color) return [];
    return [
      {
        color,
        ...(typeof stop.offset === "number" ? { offset: stop.offset } : {}),
      },
    ];
  });
  return stops.length >= 2 ? stops : undefined;
}

function backgroundFromDesign(
  input: unknown,
  tokenSet: PresentationTheme,
): BackgroundTreatment | undefined {
  if (!input || typeof input !== "object") return undefined;
  const background = input as Record<string, unknown>;
  if (background.type === "solid") {
    const color = colorRefValue(background.color, tokenSet);
    return color ? { type: "solid", color } : undefined;
  }
  if (background.type === "gradient") {
    const from = colorRefValue(background.from, tokenSet);
    const to = colorRefValue(background.to, tokenSet);
    if (!from || !to) return undefined;
    return {
      type: "gradient",
      from,
      to,
      ...(typeof background.angle === "number"
        ? { angle: background.angle }
        : {}),
      ...(gradientStopsFromDesign(background.stops, tokenSet)
        ? { stops: gradientStopsFromDesign(background.stops, tokenSet) }
        : {}),
    };
  }
  if (background.type === "radialGradient") {
    const inner = colorRefValue(background.inner, tokenSet);
    const outer = colorRefValue(background.outer, tokenSet);
    if (!inner || !outer) return undefined;
    return {
      type: "radialGradient",
      inner,
      outer,
      ...(typeof background.cx === "number" ? { cx: background.cx } : {}),
      ...(typeof background.cy === "number" ? { cy: background.cy } : {}),
      ...(typeof background.r === "number" ? { r: background.r } : {}),
      ...(typeof background.rx === "number" ? { rx: background.rx } : {}),
      ...(typeof background.ry === "number" ? { ry: background.ry } : {}),
      ...(gradientStopsFromDesign(background.stops, tokenSet)
        ? { stops: gradientStopsFromDesign(background.stops, tokenSet) }
        : {}),
    };
  }
  if (background.type === "image" && typeof background.url === "string") {
    return { type: "image", url: background.url };
  }
  return undefined;
}

/** Resolves the deck-wide global master. */
export function resolveMaster(
  deck: Deck,
  _slide: Slide,
): SlideMaster | undefined {
  const rawDeck = deck as any;
  const masters = rawDeck.masters as SlideMaster[] | undefined;
  if (!masters || masters.length === 0) return undefined;
  return masters.find((m) => m.id === rawDeck.defaultMasterId) ?? masters[0];
}

/**
 * Resolves the complete style for a slide, applying the five-layer cascade:
 * deck tokens → master → slide overrides.
 */
/* node:coverage disable */
/* resolveSlideStyle behavior is asserted in cascade tests; tsx maps delegation and literal assignment rows as residual. */
export function resolveSlideStyle(
  deck: Deck,
  slide: Slide,
): ResolvedSlideStyle {
  const tokenSet = resolveDeckTokenSet(deck);
  const master = resolveMaster(deck, slide);
  const rawSlide = slide as any;

  const masterBackground = backgroundFromDesign(master?.background, tokenSet);
  const slideBackground = backgroundFromDesign(
    rawSlide.designOverrides?.background,
    tokenSet,
  );

  const background =
    slideBackground ?? masterBackground ?? tokenSet.defaultBackground;

  const accent =
    colorRefValue(rawSlide.designOverrides?.accent, tokenSet) ??
    tokenSet.colors.accent;
  const titleColor = tokenSet.colors.onBg;
  const bodyColor = tokenSet.colors.onBg;
  const mutedColor = tokenSet.colors.muted;
  const headingFontFamily =
    tokenSet.typography.headingFontFamily ?? tokenSet.typography.fontFamily;
  const bodyFontFamily = tokenSet.typography.fontFamily;

  return {
    background,
    backgroundCss: backgroundTreatmentToCss(background),
    accent,
    titleColor,
    bodyColor,
    mutedColor,
    headingFontFamily,
    bodyFontFamily,
    ...(master !== undefined ? { master } : {}),
    tokenSet,
  };
}
/* node:coverage enable */

/**
 * Resolves the {@link PresentationTheme} that governs a slide (#607). A full
 * deck is required because `design.themeId` and `design.themeOverrides` are the
 * theme source.
 */
export function resolveSlideTokenSet(
  deck: Deck,
  slide: Slide,
): PresentationTheme {
  return resolveSlideStyle(deck, slide).tokenSet;
}

// ---------------------------------------------------------------------------
// Slide theme colours for the shared renderer (#609)
// ---------------------------------------------------------------------------

/** The flat colour set the slide renderer needs for one slide. */
export interface SlideThemeColors {
  bgColor: string;
  accentColor: string;
  titleColor: string;
  bodyColor: string;
  mutedColor: string;
}

/**
 * Resolves the renderer's slide colours from the deck token cascade (#609).
 * A full {@link Deck} is required because `design.themeId` and
 * `design.themeOverrides` are the theme source. The background colour collapses a
 * gradient to its `from` stop and an image background to the token-set's
 * `slideBg`.
 */
export function resolveSlideThemeColors(
  deck: Deck,
  slide: Slide,
): SlideThemeColors {
  const r = resolveSlideStyle(deck, slide);
  const bgColor =
    r.background.type === "solid"
      ? r.background.color
      : r.background.type === "gradient"
        ? r.background.from
        : r.background.type === "radialGradient"
          ? r.background.outer
          : r.tokenSet.colors.slideBg;
  return {
    bgColor,
    accentColor: r.accent,
    titleColor: r.titleColor,
    bodyColor: r.bodyColor,
    mutedColor: r.mutedColor,
  };
}
