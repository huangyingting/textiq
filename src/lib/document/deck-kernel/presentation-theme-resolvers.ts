/**
 * Presentation theme token resolvers.
 *
 * All fallback and normalization behavior for token data lives here so the
 * schema/data modules stay declarative. This file is pure and has no React,
 * DOM, or browser dependencies.
 */

import type {
  ConnectorArrow,
  ImageFitMode,
  ImageMaskShape,
} from "./deck-element-primitives";
import type { PresentationThemeId } from "./deck-core";
import {
  BUILT_IN_TOKEN_SETS,
  DEFAULT_TOKEN_SET,
  HEADING_ROLES,
  ROLE_DEFAULT_ALIGN,
  ROLE_DEFAULT_WEIGHT,
  ROLE_TO_SCALE_KEY,
  TOKEN_SET_BY_ID,
} from "./presentation-theme-data";
import {
  PRESENTATION_ROLES,
  type BackgroundTreatment,
  type BulletNumberStyle,
  type ConnectorDashStyle,
  type PresentationRole,
  type PresentationTheme,
  type PresentationRoleToken,
} from "./presentation-theme-types";
import { ensureCjkFallback } from "./slide-fonts";

/** Type guard: is `value` a known {@link PresentationRole}? */
export function isPresentationRole(value: unknown): value is PresentationRole {
  return (
    typeof value === "string" &&
    (PRESENTATION_ROLES as readonly string[]).includes(value)
  );
}

/**
 * Returns the `PresentationTheme` for a given `themeId` / `PresentationThemeId` value.
 * Falls back to {@link DEFAULT_TOKEN_SET} for unknown or absent ids.
 *
 * This is the primary entry point for renderers and exporters to access the
 * token cascade without directly importing the constant array.
 */
export function resolveThemeTokens(themeId?: string | null): PresentationTheme {
  if (!themeId) return DEFAULT_TOKEN_SET;
  return TOKEN_SET_BY_ID.get(themeId) ?? DEFAULT_TOKEN_SET;
}

/** Minimal deck-shaped source used by theme-token resolvers. */
export interface PresentationThemeSource {
  /** v6 presentation design source. */
  design?: {
    themeId?: string;
    themeOverrides?: { tokenSet?: PresentationTheme } & Record<string, unknown>;
  };
}

/**
 * Returns the token id that names the deck's current theme source.
 *
 * `themeId` is the authoritative presentation-theme key. There is intentionally no
 * fallback to a superseded `theme` field: current deck payloads must carry
 * `themeId`.
 */
export function resolvePresentationThemeId(
  source: PresentationThemeSource,
): string {
  return (
    source.design?.themeOverrides?.tokenSet?.id ??
    source.design?.themeId ??
    DEFAULT_TOKEN_SET.id
  );
}

/** Resolves the deck-level token set, preferring custom/brand tokens. */
export function resolvePresentationThemeTokens(
  source: PresentationThemeSource,
): PresentationTheme {
  return (
    source.design?.themeOverrides?.tokenSet ??
    resolveThemeTokens(resolvePresentationThemeId(source))
  );
}

/**
 * Returns the resolved `BackgroundTreatment` for a slide, applying the
 * cascade: slide background image → slide overrides → master background →
 * presentation theme default background.
 *
 * Accepts the three existing per-slide fields as optional parameters so
 * callers do not need to construct a `BackgroundTreatment` union themselves.
 */
export function resolveSlideBackground(
  tokenSet: PresentationTheme,
  options: {
    masterBackground?: BackgroundTreatment;
    slideBackground?: string;
    slideBackgroundGradient?: { from: string; to: string; angle?: number };
    slideBackgroundImage?: string;
  } = {},
): BackgroundTreatment {
  const {
    masterBackground,
    slideBackground,
    slideBackgroundGradient,
    slideBackgroundImage,
  } = options;

  if (slideBackgroundImage) {
    return { type: "image", url: slideBackgroundImage };
  }
  if (slideBackgroundGradient) {
    return {
      type: "gradient",
      from: slideBackgroundGradient.from,
      to: slideBackgroundGradient.to,
      angle: slideBackgroundGradient.angle,
    };
  }
  if (slideBackground) {
    return { type: "solid", color: slideBackground };
  }
  return masterBackground ?? tokenSet.defaultBackground;
}

/**
 * Returns a CSS `background` shorthand string from a `BackgroundTreatment`.
 * Suitable for use as an inline `style.background` value in the renderer.
 */
export function backgroundTreatmentToCss(bg: BackgroundTreatment): string {
  const stopsCss = (stops: readonly { color: string; offset?: number }[]) =>
    stops
      .map(
        (stop) =>
          `${stop.color}${stop.offset !== undefined ? ` ${stop.offset}%` : ""}`,
      )
      .join(", ");
  switch (bg.type) {
    case "solid":
      return bg.color;
    case "gradient": {
      const angle = bg.angle ?? 135;
      return `linear-gradient(${angle}deg, ${bg.stops ? stopsCss(bg.stops) : `${bg.from}, ${bg.to}`})`;
    }
    case "radialGradient": {
      const cx = bg.cx ?? 50;
      const cy = bg.cy ?? 50;
      const rx = bg.rx ?? bg.r ?? 70;
      const ry = bg.ry ?? bg.r ?? 70;
      return `radial-gradient(${rx}% ${ry}% at ${cx}% ${cy}%, ${bg.stops ? stopsCss(bg.stops) : `${bg.inner}, ${bg.outer}`})`;
    }
    case "image":
      return `url(${JSON.stringify(bg.url)}) center / cover no-repeat`;
  }
}

/**
 * Looks up the built-in token set for each registered `PresentationThemeId` and returns
 * the result.
 */
export function allThemeTokenSets(): PresentationTheme[] {
  return [...BUILT_IN_TOKEN_SETS];
}

/**
 * Returns `true` when `id` matches one of the built-in token sets.
 * Helps validators distinguish known ids from custom/brand-kit ids.
 */
export function isBuiltInTheme(id: string): id is PresentationThemeId {
  return TOKEN_SET_BY_ID.has(id);
}

// ---------------------------------------------------------------------------
// Semantic role token resolution (#603 / #602)
// ---------------------------------------------------------------------------

/**
 * Derives a complete {@link PresentationRoleToken} for `role` from a token set's base
 * {@link FontScale}, font stacks, and color tokens. This guarantees every
 * theme exposes usable role typography even when it omits an explicit
 * `typography.roles` map.
 */
export function deriveRoleToken(
  tokenSet: PresentationTheme,
  role: PresentationRole,
): PresentationRoleToken {
  const { typography, colors } = tokenSet;
  const sizeKey = ROLE_TO_SCALE_KEY[role];
  const baseFamily = HEADING_ROLES.has(role)
    ? (typography.headingFontFamily ?? typography.fontFamily)
    : typography.fontFamily;
  // Guarantee the self-hosted CJK fallback so Simplified Chinese renders
  // deterministically across platforms, regardless of the theme/brand font.
  const fontFamily = ensureCjkFallback(baseFamily);
  const color =
    role === "footer" || role === "caption" ? colors.muted : colors.onBg;
  return {
    fontFamily,
    fontSize: typography.scale[sizeKey],
    color,
    weight: ROLE_DEFAULT_WEIGHT[role],
    align: ROLE_DEFAULT_ALIGN[role],
  };
}

/**
 * Resolves the effective {@link PresentationRoleToken} for a role: an explicitly
 * authored `typography.roles[role]` token (merged over derived defaults so a
 * partial authored token still yields complete typography) or, when absent,
 * the fully derived token.
 *
 * Unknown roles are not representable at the type level; callers passing an
 * arbitrary string should guard with {@link isPresentationRole} and fall back to
 * `"body"`.
 */
export function resolveRoleToken(
  tokenSet: PresentationTheme,
  role: PresentationRole,
): PresentationRoleToken {
  const derived = deriveRoleToken(tokenSet, role);
  const authored = tokenSet.typography.roles?.[role];
  if (!authored) return derived;
  const merged = { ...derived, ...authored };
  // Re-apply the CJK fallback in case an authored role token supplied its own
  // font stack without one.
  if (authored.fontFamily !== undefined) {
    merged.fontFamily = ensureCjkFallback(authored.fontFamily);
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Non-text default resolvers (#601)
// ---------------------------------------------------------------------------

/** Fully-resolved bullet defaults (every field present). */
export interface ResolvedBulletDefaults {
  markerColor: string;
  gapPct: number;
  indentPct: number;
  numberStyle: BulletNumberStyle;
}

/**
 * Resolves bullet defaults, filling absent fields with deterministic fallbacks
 * (marker color → accent). Existing rendering is unaffected when `bullet` is
 * absent because these are defaults a consumer opts into.
 */
export function resolveBulletDefaults(
  tokenSet: PresentationTheme,
): ResolvedBulletDefaults {
  const b = tokenSet.bullet ?? {};
  return {
    markerColor: b.markerColor ?? tokenSet.colors.accent,
    gapPct: b.gapPct ?? 0,
    indentPct: b.indentPct ?? 0,
    numberStyle: b.numberStyle ?? "decimal",
  };
}

/** Fully-resolved connector defaults (every field present). */
export interface ResolvedConnectorDefaults {
  color: string;
  width: number;
  dash: ConnectorDashStyle;
  startArrow: ConnectorArrow;
  endArrow: ConnectorArrow;
}

/** Resolves connector defaults with deterministic fallbacks. */
export function resolveConnectorDefaults(
  tokenSet: PresentationTheme,
): ResolvedConnectorDefaults {
  const c = tokenSet.connector ?? {};
  return {
    color: c.color ?? tokenSet.colors.onBg,
    width: c.width ?? 0.4,
    dash: c.dash ?? "solid",
    startArrow: c.startArrow ?? "none",
    endArrow: c.endArrow ?? "arrow",
  };
}

/** Fully-resolved image defaults (every field present). */
export interface ResolvedImageDefaults {
  fitMode: ImageFitMode;
  radiusPct: number;
  maskShape: ImageMaskShape;
  shadow: boolean;
}

/** Resolves image defaults with deterministic fallbacks. */
export function resolveImageDefaults(
  tokenSet: PresentationTheme,
): ResolvedImageDefaults {
  const i = tokenSet.image ?? {};
  return {
    fitMode: i.fitMode ?? "contain",
    radiusPct: i.radiusPct ?? 0,
    maskShape: i.maskShape ?? "none",
    shadow: i.shadow ?? false,
  };
}

/** Fully-resolved visual defaults. `styleThemeId` stays optional. */
export interface ResolvedVisualDefaults {
  styleThemeId?: string;
  transparentBackground: boolean;
}

/** Resolves visual defaults with deterministic fallbacks. */
export function resolveVisualDefaults(
  tokenSet: PresentationTheme,
): ResolvedVisualDefaults {
  const v = tokenSet.visual ?? {};
  return {
    ...(v.styleThemeId !== undefined ? { styleThemeId: v.styleThemeId } : {}),
    transparentBackground: v.transparentBackground ?? false,
  };
}
