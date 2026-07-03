/* node:coverage disable -- Module documentation is non-runtime; tsx maps docblock rows as source gaps. */
/**
 * Self-hosted presentation slide font registry (source of truth).
 *
 * This module is the single place that knows about the fonts TextIQ bundles for
 * slide typography. It is consumed by:
 *  - the slide inspector and presentation theme font pickers (UI options);
 *  - the renderer/style cascade (CSS font stacks);
 *  - the `@font-face` CSS used to load the self-hosted assets;
 *  - editable PPTX export (font-id → Office-compatible font face mapping).
 *
 * Runtime contract: see `docs/presentation/rendering-and-export.md`.
 *
 * Fonts keep their own names (no product prefix). The asset files live under
 * `public/fonts/slides/<id>/` and are served as static `/fonts/slides/...`
 * URLs. The CSS stacks always append the self-hosted CJK fallback
 * (`Noto Sans SC`) so Simplified Chinese renders deterministically without a
 * separate user-facing font selector.
 */
/* node:coverage enable */

/** Numeric weights bundled for slide fonts (MVP scope). */
export type SlideFontWeight = 400 | 600 | 700;

/** Font styles bundled for slide fonts. */
export type SlideFontStyle = "normal" | "italic";

/** A single self-hosted font asset (one weight/style of a family). */
export interface SlideFontAsset {
  weight: SlideFontWeight;
  style: SlideFontStyle;
  /** Static URL under `/fonts/slides/...` served from `public/`. */
  url: string;
}

/** A registry-backed slide font. */
export interface SlideFont {
  /** Stable id used in UI and (future) deck data. Equals the family slug. */
  id: string;
  /** Display label shown in font pickers. */
  label: string;
  /** Primary CSS family name; must match the `@font-face` family. */
  cssFamily: string;
  /**
   * Full CSS font stack stored/rendered for this font. Always includes the
   * self-hosted `Noto Sans SC` CJK fallback (except the CJK font itself) plus a
   * generic family.
   */
  cssStack: string;
  /** Self-hosted `@font-face` assets. */
  assets: readonly SlideFontAsset[];
  /** Editable-PPTX Office font face for primarily-Latin text. */
  pptxFontFace: string;
  /** Editable-PPTX Office font face for primarily-Chinese text. */
  pptxCjkFontFace: string;
  /** Script coverage hints. */
  coverage: readonly ("latin" | "sc")[];
}

const GENERIC_SANS = "sans-serif";
const GENERIC_SERIF = "serif";
const GENERIC_MONO = "ui-monospace, monospace";
const CJK_FALLBACK = "'Noto Sans SC'";

function latinAssets(
  id: string,
  opts: { italic?: boolean } = {},
): SlideFontAsset[] {
  const assets: SlideFontAsset[] = [
    {
      weight: 400,
      style: "normal",
      url: `/fonts/slides/${id}/${id}-latin-400-normal.woff2`,
    },
    {
      weight: 600,
      style: "normal",
      url: `/fonts/slides/${id}/${id}-latin-600-normal.woff2`,
    },
    {
      weight: 700,
      style: "normal",
      url: `/fonts/slides/${id}/${id}-latin-700-normal.woff2`,
    },
  ];
  if (opts.italic) {
    assets.push({
      weight: 400,
      style: "italic",
      url: `/fonts/slides/${id}/${id}-latin-400-italic.woff2`,
    });
  }
  return assets;
}

/**
 * Registry of bundled slide fonts. Order here is the order shown in the picker.
 */
export const SLIDE_FONTS: readonly SlideFont[] = [
  {
    id: "inter",
    label: "Inter",
    cssFamily: "Inter",
    cssStack: `'Inter', ${CJK_FALLBACK}, ${GENERIC_SANS}`,
    assets: latinAssets("inter", { italic: true }),
    pptxFontFace: "Aptos",
    pptxCjkFontFace: "Microsoft YaHei",
    coverage: ["latin", "sc"],
  },
  {
    id: "source-sans-3",
    label: "Source Sans 3",
    cssFamily: "Source Sans 3",
    cssStack: `'Source Sans 3', ${CJK_FALLBACK}, ${GENERIC_SANS}`,
    assets: latinAssets("source-sans-3", { italic: true }),
    pptxFontFace: "Aptos",
    pptxCjkFontFace: "Microsoft YaHei",
    coverage: ["latin", "sc"],
  },
  {
    id: "ibm-plex-sans",
    label: "IBM Plex Sans",
    cssFamily: "IBM Plex Sans",
    cssStack: `'IBM Plex Sans', ${CJK_FALLBACK}, ${GENERIC_SANS}`,
    assets: latinAssets("ibm-plex-sans", { italic: true }),
    pptxFontFace: "Aptos",
    pptxCjkFontFace: "Microsoft YaHei",
    coverage: ["latin", "sc"],
  },
  {
    id: "manrope",
    label: "Manrope",
    cssFamily: "Manrope",
    cssStack: `'Manrope', ${CJK_FALLBACK}, ${GENERIC_SANS}`,
    assets: latinAssets("manrope"),
    pptxFontFace: "Aptos",
    pptxCjkFontFace: "Microsoft YaHei",
    coverage: ["latin", "sc"],
  },
  {
    id: "space-grotesk",
    label: "Space Grotesk",
    cssFamily: "Space Grotesk",
    cssStack: `'Space Grotesk', ${CJK_FALLBACK}, ${GENERIC_SANS}`,
    assets: latinAssets("space-grotesk"),
    pptxFontFace: "Aptos Display",
    pptxCjkFontFace: "Microsoft YaHei",
    coverage: ["latin", "sc"],
  },
  {
    id: "source-serif-4",
    label: "Source Serif 4",
    cssFamily: "Source Serif 4",
    cssStack: `'Source Serif 4', ${CJK_FALLBACK}, ${GENERIC_SERIF}`,
    assets: latinAssets("source-serif-4", { italic: true }),
    pptxFontFace: "Georgia",
    pptxCjkFontFace: "Microsoft YaHei",
    coverage: ["latin", "sc"],
  },
  {
    id: "jetbrains-mono",
    label: "JetBrains Mono",
    cssFamily: "JetBrains Mono",
    cssStack: `'JetBrains Mono', ${CJK_FALLBACK}, ${GENERIC_MONO}`,
    assets: latinAssets("jetbrains-mono", { italic: true }),
    pptxFontFace: "Consolas",
    pptxCjkFontFace: "Microsoft YaHei",
    coverage: ["latin", "sc"],
  },
  {
    id: "noto-sans-sc",
    label: "Noto Sans SC",
    cssFamily: "Noto Sans SC",
    cssStack: `'Noto Sans SC', ${GENERIC_SANS}`,
    assets: [
      {
        weight: 400,
        style: "normal",
        url: "/fonts/slides/noto-sans-sc/noto-sans-sc-chinese-simplified-400-normal.woff2",
      },
      {
        weight: 600,
        style: "normal",
        url: "/fonts/slides/noto-sans-sc/noto-sans-sc-chinese-simplified-600-normal.woff2",
      },
      {
        weight: 700,
        style: "normal",
        url: "/fonts/slides/noto-sans-sc/noto-sans-sc-chinese-simplified-700-normal.woff2",
      },
    ],
    pptxFontFace: "Microsoft YaHei",
    pptxCjkFontFace: "Microsoft YaHei",
    coverage: ["sc"],
  },
];

/** Default slide font id used when no font is explicitly selected. */
export const DEFAULT_SLIDE_FONT_ID = "inter";

const FONT_BY_ID = new Map(SLIDE_FONTS.map((font) => [font.id, font]));
const FONT_BY_FAMILY = new Map(
  SLIDE_FONTS.map((font) => [font.cssFamily.toLowerCase(), font]),
);

/** A single UI picker option for a slide font. `value` is the full CSS stack. */
export type FontOption = {
  id: string;
  label: string;
  value: string;
};

/** UI picker options. `value` is the full CSS stack stored in `fontFamily`. */
export const SLIDE_FONT_OPTIONS: ReadonlyArray<FontOption> = SLIDE_FONTS.map(
  (font) => ({
    id: font.id,
    label: font.label,
    value: font.cssStack,
  }),
);

/** Narrowing guard for a registry font id. */
export function isSlideFontId(value: unknown): value is string {
  return typeof value === "string" && FONT_BY_ID.has(value);
}

/* node:coverage disable */
/* Font lookup behavior is asserted in slide-fonts tests; tsx maps the short helpers and adjacent docblocks as residual. */
/** Resolve a registry font by id, or `undefined` when unknown. */
export function resolveSlideFont(id: string): SlideFont | undefined {
  return FONT_BY_ID.get(id);
}

/** Resolve the full CSS font stack for a registry font id. */
export function slideFontCssStack(id: string): string | undefined {
  return FONT_BY_ID.get(id)?.cssStack;
}

/**
 * Resolve an element's optional `fontId` override to a CSS font stack for the
 * renderer. Returns `undefined` when there is no (valid) override so callers
 * fall back to the theme/role font.
 */
export function resolveElementFontCss(
  fontId: string | undefined,
): string | undefined {
  return fontId ? slideFontCssStack(fontId) : undefined;
}
/* node:coverage enable */

/** Self-hosted CJK fallback family appended to slide font stacks. */
const SLIDE_CJK_FALLBACK = "'Noto Sans SC'";

const GENERIC_FAMILY_RE =
  /^(ui-sans-serif|ui-serif|ui-monospace|system-ui|sans-serif|serif|monospace|cursive|fantasy|-apple-system)$/i;

/**
 * Ensure a CSS font stack carries the self-hosted CJK fallback so Simplified
 * Chinese text renders deterministically regardless of the OS. Inserts
 * `'Noto Sans SC'` before the first generic family (or appends it). Idempotent:
 * stacks that already reference a Noto CJK family are returned unchanged.
 */
export function ensureCjkFallback(cssStack: string): string {
  if (!cssStack) return cssStack;
  if (/noto\s+(sans|serif)\s+(sc|tc|hk|jp|kr)/i.test(cssStack)) {
    return cssStack;
  }
  const parts = cssStack.split(",").map((p) => p.trim());
  const genericIdx = parts.findIndex((p) =>
    GENERIC_FAMILY_RE.test(p.replace(/^['"]|['"]$/g, "")),
  );
  if (genericIdx === -1) {
    return `${cssStack}, ${SLIDE_CJK_FALLBACK}`;
  }
  parts.splice(genericIdx, 0, SLIDE_CJK_FALLBACK);
  return parts.join(", ");
}

/**
 * Extract the bare first family name from a CSS font-family stack.
 * e.g. `"'Inter', 'Noto Sans SC', sans-serif"` → `Inter`.
 */
function firstFamily(cssStack: string): string {
  return (cssStack.split(",")[0] ?? "")
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .trim();
}

/**
 * Resolve the registry font that a stored CSS stack (or bare id/family) refers
 * to. Matches by the leading family name so literal stacks still map.
 */
export function matchSlideFont(cssStackOrId: string): SlideFont | undefined {
  if (FONT_BY_ID.has(cssStackOrId)) return FONT_BY_ID.get(cssStackOrId);
  const family = firstFamily(cssStackOrId).toLowerCase();
  return FONT_BY_FAMILY.get(family);
}

/**
 * Heuristic: is `text` primarily CJK? Used to pick the CJK PPTX font face.
 * Counts CJK Unified Ideographs vs. Latin letters; ties/empty favor Latin.
 */
export function isPrimarilyCjk(text: string | undefined): boolean {
  if (!text) return false;
  let cjk = 0;
  let latin = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
      (code >= 0x3400 && code <= 0x4dbf) || // Extension A
      (code >= 0xf900 && code <= 0xfaff) // Compatibility Ideographs
    ) {
      cjk++;
    } else if (
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a)
    ) {
      latin++;
    }
  }
  return cjk > 0 && cjk >= latin;
}

/**
 * Map a stored CSS font stack to the editable-PPTX Office font face.
 *
 * When the stack matches a registry font, returns its `pptxFontFace` (or
 * `pptxCjkFontFace` when `text` is primarily Chinese). When it does not match a
 * registry font, falls back to the bare first family so literal stacks keep
 * their existing export behavior.
 */
export function slideFontExportFace(
  cssStackOrId: string | undefined,
  text?: string,
): string | undefined {
  if (!cssStackOrId) return undefined;
  const font = matchSlideFont(cssStackOrId);
  if (font) {
    return isPrimarilyCjk(text) ? font.pptxCjkFontFace : font.pptxFontFace;
  }
  const family = firstFamily(cssStackOrId);
  return family && family.toLowerCase() !== "inherit" ? family : undefined;
}

/**
 * Build the `@font-face` CSS for every bundled slide font asset.
 *
 * Used to generate `src/app/slide-fonts.css`; a registry test asserts the
 * checked-in CSS stays in sync with this output so the two never drift.
 */
export function buildSlideFontFaceCss(): string {
  const rules: string[] = [];
  for (const font of SLIDE_FONTS) {
    for (const asset of font.assets) {
      rules.push(
        [
          "@font-face {",
          `  font-family: "${font.cssFamily}";`,
          `  font-style: ${asset.style};`,
          `  font-weight: ${asset.weight};`,
          "  font-display: swap;",
          `  src: url("${asset.url}") format("woff2");`,
          "}",
        ].join("\n"),
      );
    }
  }
  return rules.join("\n\n") + "\n";
}
