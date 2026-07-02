/**
 * Built-in neutral theme package for the presentation system.
 *
 * Used as a fallback when no external ThemePackageV1 is loaded:
 * - Public render for presentation decks without a custom package.
 * - Present mode and preview surfaces that receive a Deck.
 * - Editor surface before a custom package is resolved.
 *
 * The neutral package uses a clean white/charcoal colour palette with
 * Inter as the font stack. Every required StyleRef has a "default" variant.
 * No decorations are included so the render tree is clean without package
 * context.
 */

import type { ThemePackageV1 } from "./theme-package-schema";
import type { StyleRef } from "./style-schema";
import { STYLE_REFS } from "./style-registry";

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

const NEUTRAL_TOKENS: ThemePackageV1["tokens"] = {
  colors: {
    canvas: {
      fill: "#ffffff",
      text: "#111111",
      mutedText: "#666666",
    },
    surface: {
      fill: "#f4f4f5",
      text: "#18181b",
      mutedText: "#71717a",
    },
    accent: {
      fill: "#2563eb",
      text: "#ffffff",
    },
  },
  fonts: {
    heading: "Inter, system-ui, sans-serif",
    body: "Inter, system-ui, sans-serif",
  },
};

// ---------------------------------------------------------------------------
// Style objects
// ---------------------------------------------------------------------------

type Styles = Record<StyleRef, Record<string, object>>;

const STYLES: Styles = {
  "slide.cover": {
    default: {
      slide: {
        background: { type: "solid", color: "#1e293b" },
        chrome: "minimal",
      },
    },
  },
  "slide.content": {
    default: {
      slide: {
        background: { type: "solid", color: "#ffffff" },
        chrome: "default",
      },
    },
  },
  "slide.section": {
    default: {
      slide: {
        background: { type: "solid", color: "#f1f5f9" },
        chrome: "minimal",
      },
    },
  },
  "text.title": {
    default: {
      text: {
        fontFamily: "Inter, system-ui, sans-serif",
        fontSizePt: 32,
        fontWeight: 700,
        color: "#111111",
        lineHeightEm: 1.2,
      },
    },
    large: {
      text: {
        fontFamily: "Inter, system-ui, sans-serif",
        fontSizePt: 44,
        fontWeight: 700,
        color: "#111111",
        lineHeightEm: 1.15,
      },
    },
    cover: {
      text: {
        fontFamily: "Inter, system-ui, sans-serif",
        fontSizePt: 40,
        fontWeight: 700,
        color: "#ffffff",
        lineHeightEm: 1.15,
      },
    },
  },
  "text.subtitle": {
    default: {
      text: {
        fontFamily: "Inter, system-ui, sans-serif",
        fontSizePt: 18,
        fontWeight: 400,
        color: "#374151",
        lineHeightEm: 1.4,
      },
    },
    cover: {
      text: {
        fontFamily: "Inter, system-ui, sans-serif",
        fontSizePt: 18,
        fontWeight: 400,
        color: "#cbd5e1",
        lineHeightEm: 1.4,
      },
    },
  },
  "text.body": {
    default: {
      text: {
        fontFamily: "Inter, system-ui, sans-serif",
        fontSizePt: 14,
        fontWeight: 400,
        color: "#374151",
        lineHeightEm: 1.5,
      },
    },
    small: {
      text: {
        fontFamily: "Inter, system-ui, sans-serif",
        fontSizePt: 12,
        fontWeight: 400,
        color: "#374151",
        lineHeightEm: 1.5,
      },
    },
  },
  "text.kicker": {
    default: {
      text: {
        fontFamily: "Inter, system-ui, sans-serif",
        fontSizePt: 11,
        fontWeight: 600,
        color: "#2563eb",
        letterSpacingEm: 0.06,
        textTransform: "uppercase",
        lineHeightEm: 1.2,
      },
    },
  },
  "text.caption": {
    default: {
      text: {
        fontFamily: "Inter, system-ui, sans-serif",
        fontSizePt: 11,
        fontWeight: 400,
        color: "#6b7280",
        lineHeightEm: 1.4,
      },
    },
  },
  "text.quote": {
    default: {
      text: {
        fontFamily: "Inter, system-ui, sans-serif",
        fontSizePt: 22,
        fontWeight: 400,
        fontStyle: "italic",
        color: "#1e293b",
        lineHeightEm: 1.45,
      },
    },
  },
  "text.metric": {
    default: {
      text: {
        fontFamily: "Inter, system-ui, sans-serif",
        fontSizePt: 40,
        fontWeight: 700,
        color: "#111111",
        lineHeightEm: 1.1,
        tabularNums: true,
      },
    },
    accent: {
      text: {
        fontFamily: "Inter, system-ui, sans-serif",
        fontSizePt: 40,
        fontWeight: 700,
        color: "#2563eb",
        lineHeightEm: 1.1,
        tabularNums: true,
      },
    },
  },
  "surface.card": {
    default: {
      fill: { type: "solid", color: "#f8fafc" },
      stroke: { color: "#e2e8f0", widthPt: 1 },
      radius: { allPt: 8 },
    },
  },
  "surface.callout": {
    default: {
      fill: { type: "solid", color: "#eff6ff" },
      stroke: { color: "#bfdbfe", widthPt: 1 },
      radius: { allPt: 6 },
    },
    warning: {
      fill: { type: "solid", color: "#fffbeb" },
      stroke: { color: "#fde68a", widthPt: 1 },
      radius: { allPt: 6 },
    },
    danger: {
      fill: { type: "solid", color: "#fef2f2" },
      stroke: { color: "#fecaca", widthPt: 1 },
      radius: { allPt: 6 },
    },
  },
  "surface.table": {
    default: {
      fill: { type: "solid", color: "#ffffff" },
      stroke: { color: "#e2e8f0", widthPt: 1 },
    },
  },
  "media.hero": {
    default: {
      image: { fit: "cover" },
      radius: { allPt: 4 },
    },
  },
  "media.inline": {
    default: {
      image: { fit: "contain" },
      radius: { allPt: 2 },
    },
  },
  "chart.primary": {
    default: {
      fill: { type: "solid", color: "#2563eb" },
      text: {
        fontFamily: "Inter, system-ui, sans-serif",
        fontSizePt: 11,
        color: "#374151",
      },
    },
  },
  "connector.primary": {
    default: {
      connector: {
        strokeColor: "#6b7280",
        strokeWidthPt: 1.5,
        style: "straight",
      },
    },
  },
  "decoration.background": {
    default: {
      fill: { type: "solid", color: "#f1f5f9" },
    },
  },
};

// Ensure every registered STYLE_REF has at least a "default" entry.
for (const ref of STYLE_REFS) {
  if (!(ref in STYLES)) {
    (STYLES as Record<string, Record<string, object>>)[ref] = {
      default: {},
    };
  }
}

// ---------------------------------------------------------------------------
// Exported package
// ---------------------------------------------------------------------------

/**
 * Built-in neutral theme package.
 *
 * Suitable as a fallback renderer for presentation decks that have not yet resolved a
 * custom theme package, and for unit / integration tests that do not want to
 * supply a full theme fixture.
 */
export const NEUTRAL_THEME_PACKAGE: ThemePackageV1 = {
  schemaVersion: 1,
  id: "neutral",
  version: "1.0.0",
  name: "Neutral",
  tagline: "A clean, typography-first default theme",
  tokens: NEUTRAL_TOKENS,
  styles: STYLES as ThemePackageV1["styles"],
};
