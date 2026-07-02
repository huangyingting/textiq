/**
 * Built-in presentation theme token data and role default tables.
 *
 * This module intentionally contains no resolver functions. Consumers that need
 * lookup/fallback behavior should import from presentation-theme-resolvers (or the
 * stable presentation-theme facade).
 */

import type { ElementAlign } from "./deck-element-primitives";
import type { FontScale } from "./theme-typography";
import type {
  PresentationRole,
  PresentationTheme,
  ShapeToken,
  SpacingToken,
} from "./presentation-theme-types";

/**
 * Maps a {@link PresentationRole} onto the {@link FontScale} key whose size best
 * approximates it. Used to derive role defaults from the base `scale` so
 * themes get complete role typography without hand-authoring tokens.
 */
export const ROLE_TO_SCALE_KEY: Record<PresentationRole, keyof FontScale> = {
  title: "h1",
  subtitle: "h3",
  sectionTitle: "h2",
  body: "body",
  bullet: "list",
  quote: "body",
  caption: "footer",
  footer: "footer",
  label: "body",
  media: "body",
  visual: "body",
  image: "body",
  table: "body",
  logo: "footer",
  pageNumber: "footer",
  background: "body",
};

/** Headings render bold by default; body-like roles use a regular weight. */
export const ROLE_DEFAULT_WEIGHT: Record<PresentationRole, number> = {
  title: 700,
  subtitle: 400,
  sectionTitle: 700,
  body: 400,
  bullet: 400,
  quote: 400,
  caption: 400,
  footer: 400,
  label: 600,
  media: 400,
  visual: 400,
  image: 400,
  table: 400,
  logo: 600,
  pageNumber: 400,
  background: 400,
};

/** Roles that prefer the heading font stack when one is defined. */
export const HEADING_ROLES: ReadonlySet<PresentationRole> = new Set([
  "title",
  "subtitle",
  "sectionTitle",
  "label",
  "logo",
]);

/** Default alignment per role (titles/labels centered, copy left-aligned). */
export const ROLE_DEFAULT_ALIGN: Record<PresentationRole, ElementAlign> = {
  title: "center",
  subtitle: "center",
  sectionTitle: "left",
  body: "left",
  bullet: "left",
  quote: "left",
  caption: "left",
  footer: "center",
  label: "center",
  media: "center",
  visual: "center",
  image: "center",
  table: "left",
  logo: "center",
  pageNumber: "center",
  background: "center",
};

const DEFAULT_SPACING: SpacingToken = { slidePaddingPt: 36, gridUnitPt: 6 };
const DEFAULT_SHAPE: ShapeToken = { cornerRadiusPt: 4, shadowCss: "none" };

/**
 * Built-in `PresentationTheme` definitions.  Keyed by `PresentationThemeId` / `themeId`
 * so they can be looked up with `resolveThemeTokens`.
 *
 * Color values are drawn from the same palette used in `src/lib/visual/themes.ts`
 * to keep visual-content and slide-background colors harmonious.
 */
export const BUILT_IN_TOKEN_SETS: readonly PresentationTheme[] = [
  {
    id: "default",
    name: "Default",
    colors: {
      slideBg: "#ffffff",
      surface: "#f1f5f9",
      accent: "#6366f1",
      onBg: "#0f172a",
      onSurface: "#1e293b",
      onAccent: "#ffffff",
      muted: "#64748b",
    },
    typography: {
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      scale: { h1: 36, h2: 28, h3: 22, body: 16, list: 14, footer: 10 },
    },
    spacing: DEFAULT_SPACING,
    shape: DEFAULT_SHAPE,
    defaultBackground: { type: "solid", color: "#ffffff" },
  },
  {
    id: "indigo",
    name: "Indigo",
    colors: {
      slideBg: "#ffffff",
      surface: "#eef2ff",
      accent: "#4f46e5",
      onBg: "#1e1b4b",
      onSurface: "#312e81",
      onAccent: "#ffffff",
      muted: "#6366f1",
    },
    typography: {
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      headingFontFamily:
        "Space Grotesk, Inter, ui-sans-serif, system-ui, sans-serif",
      scale: { h1: 38, h2: 30, h3: 24, body: 16, list: 14, footer: 10 },
    },
    spacing: DEFAULT_SPACING,
    shape: { cornerRadiusPt: 6, shadowCss: "none" },
    defaultBackground: { type: "solid", color: "#ffffff" },
  },
  {
    id: "ocean",
    name: "Ocean",
    colors: {
      slideBg: "#f6fbff",
      surface: "#e0f2fe",
      accent: "#0284c7",
      onBg: "#0c4a6e",
      onSurface: "#075985",
      onAccent: "#ffffff",
      muted: "#0ea5e9",
    },
    typography: {
      fontFamily: "Avenir Next, Inter, ui-sans-serif, system-ui, sans-serif",
      scale: { h1: 38, h2: 30, h3: 24, body: 16, list: 14, footer: 10 },
    },
    spacing: DEFAULT_SPACING,
    shape: DEFAULT_SHAPE,
    defaultBackground: { type: "solid", color: "#f6fbff" },
  },
  {
    id: "forest",
    name: "Forest",
    colors: {
      slideBg: "#f6fdf8",
      surface: "#dcfce7",
      accent: "#16a34a",
      onBg: "#14532d",
      onSurface: "#166534",
      onAccent: "#ffffff",
      muted: "#22c55e",
    },
    typography: {
      fontFamily: "Trebuchet MS, Inter, ui-sans-serif, system-ui, sans-serif",
      scale: { h1: 36, h2: 28, h3: 22, body: 16, list: 14, footer: 10 },
    },
    spacing: DEFAULT_SPACING,
    shape: DEFAULT_SHAPE,
    defaultBackground: { type: "solid", color: "#f6fdf8" },
  },
  {
    id: "sunset",
    name: "Sunset",
    colors: {
      slideBg: "#fffaf5",
      surface: "#ffedd5",
      accent: "#ea580c",
      onBg: "#431407",
      onSurface: "#7c2d12",
      onAccent: "#ffffff",
      muted: "#f97316",
    },
    typography: {
      fontFamily: "Georgia, ui-serif, serif",
      headingFontFamily:
        "Avenir Next, Inter, ui-sans-serif, system-ui, sans-serif",
      scale: { h1: 40, h2: 32, h3: 24, body: 17, list: 15, footer: 10 },
    },
    spacing: DEFAULT_SPACING,
    shape: { cornerRadiusPt: 2, shadowCss: "none" },
    defaultBackground: { type: "solid", color: "#fffaf5" },
  },
  {
    id: "grape",
    name: "Grape",
    colors: {
      slideBg: "#fdf7ff",
      surface: "#f3e8ff",
      accent: "#9333ea",
      onBg: "#3b0764",
      onSurface: "#581c87",
      onAccent: "#ffffff",
      muted: "#a855f7",
    },
    typography: {
      fontFamily: "Avenir Next, Inter, ui-sans-serif, system-ui, sans-serif",
      headingFontFamily:
        "Trebuchet MS, Inter, ui-sans-serif, system-ui, sans-serif",
      scale: { h1: 40, h2: 30, h3: 24, body: 16, list: 14, footer: 10 },
    },
    spacing: DEFAULT_SPACING,
    shape: { cornerRadiusPt: 8, shadowCss: "none" },
    defaultBackground: { type: "solid", color: "#fdf7ff" },
  },
];

/** Lookup map: token-set id → `PresentationTheme`. */
export const TOKEN_SET_BY_ID: ReadonlyMap<string, PresentationTheme> = new Map(
  BUILT_IN_TOKEN_SETS.map((ts) => [ts.id, ts]),
);

/** The fallback token set used when `themeId` is absent or unrecognised. */
export const DEFAULT_TOKEN_SET: PresentationTheme =
  TOKEN_SET_BY_ID.get("default")!;
