/**
 * Content-level typography tokens, stored in points so they can drive editor
 * hints and export defaults without being tied to a particular slide renderer.
 */
export type FontScale = {
  h1: number;
  h2: number;
  h3: number;
  body: number;
  list: number;
  footer: number;
};

export type ThemeTypography = {
  fontFamily: string;
  headingFontFamily?: string;
  scale: FontScale;
};

/**
 * Built-in typography themes keyed by the same palette ids used by the visual
 * theme system (`src/lib/visual/themes.ts`), plus a stable `default` fallback
 * for decks that only specify the presentation theme.
 */
export const THEME_TYPOGRAPHY: Record<string, ThemeTypography> = {
  default: {
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
    scale: { h1: 36, h2: 28, h3: 22, body: 16, list: 14, footer: 10 },
  },
  indigo: {
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
    headingFontFamily:
      "Space Grotesk, Inter, ui-sans-serif, system-ui, sans-serif",
    scale: { h1: 38, h2: 30, h3: 24, body: 16, list: 14, footer: 10 },
  },
  ocean: {
    fontFamily: "Avenir Next, Inter, ui-sans-serif, system-ui, sans-serif",
    scale: { h1: 38, h2: 30, h3: 24, body: 16, list: 14, footer: 10 },
  },
  forest: {
    fontFamily: "Trebuchet MS, Inter, ui-sans-serif, system-ui, sans-serif",
    scale: { h1: 36, h2: 28, h3: 22, body: 16, list: 14, footer: 10 },
  },
  sunset: {
    fontFamily: "Georgia, ui-serif, serif",
    headingFontFamily:
      "Avenir Next, Inter, ui-sans-serif, system-ui, sans-serif",
    scale: { h1: 40, h2: 32, h3: 24, body: 17, list: 15, footer: 10 },
  },
  grape: {
    fontFamily: "Avenir Next, Inter, ui-sans-serif, system-ui, sans-serif",
    headingFontFamily:
      "Trebuchet MS, Inter, ui-sans-serif, system-ui, sans-serif",
    scale: { h1: 40, h2: 30, h3: 24, body: 16, list: 14, footer: 10 },
  },
  rose: {
    fontFamily: "Georgia, ui-serif, serif",
    headingFontFamily:
      "Helvetica Neue, Arial, ui-sans-serif, system-ui, sans-serif",
    scale: { h1: 38, h2: 30, h3: 22, body: 16, list: 14, footer: 10 },
  },
  amber: {
    fontFamily: "Charter, Georgia, ui-serif, serif",
    headingFontFamily:
      "Trebuchet MS, Inter, ui-sans-serif, system-ui, sans-serif",
    scale: { h1: 40, h2: 32, h3: 24, body: 17, list: 15, footer: 10 },
  },
  slate: {
    fontFamily: "IBM Plex Sans, Inter, ui-sans-serif, system-ui, sans-serif",
    scale: { h1: 34, h2: 28, h3: 22, body: 15, list: 13, footer: 10 },
  },
};

export const DEFAULT_TYPOGRAPHY: ThemeTypography = THEME_TYPOGRAPHY.default;

/** Get typography for a theme id, falling back to default. */
export function getThemeTypography(themeId?: string): ThemeTypography {
  return themeId
    ? (THEME_TYPOGRAPHY[themeId] ?? DEFAULT_TYPOGRAPHY)
    : DEFAULT_TYPOGRAPHY;
}

/** Resolve the heading font for a given theme. */
export function resolveHeadingFont(typography: ThemeTypography): string {
  return typography.headingFontFamily ?? typography.fontFamily;
}

/** Resolve the body font for a given theme. */
export function resolveBodyFont(typography: ThemeTypography): string {
  return typography.fontFamily;
}

/**
 * Display hint for a semantic role's theme typography. This is an editor hint
 * (font stack + point size), not persisted element data — element font
 * overrides use a slide `fontId`, while the theme/role font is a CSS stack.
 */
export type RoleStyleHint = {
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  align?: "left" | "center" | "right";
};

export type TypographyHintRole =
  | "title"
  | "subtitle"
  | "body"
  | "visual"
  | "footer";

/* node:coverage disable */
/* roleStyle is exhaustively covered by theme-typography.test.ts; tsx maps switch signature rows as residual. */
/** Build a partial text style hint for a semantic template role. */
export function roleStyle(
  role: TypographyHintRole,
  typography: ThemeTypography,
): RoleStyleHint {
  switch (role) {
    case "title":
      return {
        fontFamily: resolveHeadingFont(typography),
        fontSize: typography.scale.h1,
        bold: true,
        align: "center",
      };
    case "subtitle":
      return {
        fontFamily: resolveBodyFont(typography),
        fontSize: typography.scale.h2,
        align: "center",
      };
    case "body":
      return {
        fontFamily: resolveBodyFont(typography),
        fontSize: typography.scale.list,
        align: "left",
      };
    case "visual":
      return {
        fontFamily: resolveHeadingFont(typography),
        fontSize: typography.scale.h3,
        bold: true,
        align: "center",
      };
    case "footer":
      return {
        fontFamily: resolveBodyFont(typography),
        fontSize: typography.scale.footer,
        align: "center",
      };
    default:
      return {};
  }
}
/* node:coverage enable */
