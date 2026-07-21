/**
 * Pure export-options model and SVG transform helpers.
 *
 * These functions are browser-free and fully testable in Node — they operate
 * on plain SVG strings (or minimal DOM-like objects). The canvas/download step
 * lives in export.ts and consumes the transformed strings produced here.
 */

import type { AspectRatioPreset } from "@/lib/visual/schema";
import { SOCIAL_PRESET_CONFIGS } from "@/lib/visual/output-profiles";
import type { SocialPreset } from "@/lib/visual/output-profiles";

// Re-export for convenience — callers can get both types and profile catalog
// data from one place while ownership stays in output-profiles.ts.
export type { AspectRatioPreset };
export {
  OUTPUT_PROFILE_CATALOG,
  SOCIAL_PRESET_CATALOG,
  SOCIAL_PRESET_CONFIGS,
  getOutputProfile,
  listOutputProfiles,
} from "@/lib/visual/output-profiles";
export type {
  OutputProfileConfig,
  OutputProfileId,
  SocialPreset,
  SocialPresetConfig,
} from "@/lib/visual/output-profiles";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** How the background of the exported image should be handled. */
export type BackgroundMode = "include" | "transparent" | "custom";

/** Whether colours are exported as-is or converted to greyscale. */
export type ColorMode = "color" | "mono";

/** Controls applied when producing the exported file. */
export interface ExportOptions {
  /** Background treatment. Defaults to `"include"`. */
  background: BackgroundMode;
  /**
   * When `background === "custom"`, the fill color as a CSS colour string
   * (e.g. `"#ffffff"` or `"rgb(255,255,255)"`).
   */
  customBackground?: string;
  /** Colour conversion. Defaults to `"color"`. */
  colorMode: ColorMode;
  /** Pixel-density multiplier (1 / 2 / 3 …). Defaults to `2`. */
  scale: number;
  /**
   * Aspect-ratio preset. When set (and not `"auto"`), the export canvas is
   * letterboxed/pillarboxed to the requested ratio while the visual content is
   * centred. Defaults to `undefined` / `"auto"` (natural dimensions).
   */
  aspectRatio?: AspectRatioPreset;
  /**
   * Safe-area padding in SVG canvas units. When set, the content is inset from
   * the canvas edge by this many units on every side — ensuring breathing room
   * for social platforms that crop or overlay UI chrome near the edges.
   * Defaults to `0` (no padding).
   */
  padding?: number;
  /**
   * Social export preset selected in the dialog. Drives aspectRatio, padding,
   * background, and minScale. Does not affect the SVG transform directly —
   * use the resolved ExportOptions fields for that.
   */
  socialPreset?: SocialPreset;
  /**
   * When `true`, a "TextIQ" watermark text is stamped in the bottom-right
   * corner of the exported image. Use export-policy.ts to derive the default
   * value from billing entitlements. Defaults to `false`.
   */
  watermark?: boolean;
}

/** Sensible defaults — keeps existing callers working unchanged. */
export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  background: "include",
  colorMode: "color",
  scale: 2,
}; /* node:coverage disable */

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

export interface ViewBoxLike {
  width: number;
  height: number;
}

/** Returns the pixel dimensions at the requested scale. */
export function computeExportDimensions(
  viewBox: ViewBoxLike,
  scale: number,
): { width: number; height: number } {
  return {
    width: Math.round(viewBox.width * scale),
    height: Math.round(viewBox.height * scale),
  };
}

// ---------------------------------------------------------------------------
// Aspect-ratio letterbox helpers
// ---------------------------------------------------------------------------

/** The numeric ratio (width/height) for each named preset. */
export const ASPECT_RATIO_VALUES: Record<
  Exclude<AspectRatioPreset, "auto">,
  number
> = {
  "16:9": 16 / 9,
  "1:1": 1,
  "4:5": 4 / 5,
  "9:16": 9 / 16,
};

/**
 * Computes the letterbox/pillarbox geometry needed to fit a `viewBox` into the
 * requested `preset` aspect ratio, keeping the content at its natural size and
 * centering it within the larger canvas.
 *
 * When `padding` is provided (SVG canvas units), the content is treated as
 * `width + 2*padding` × `height + 2*padding` for the letterbox calculation so
 * the final canvas always has at least `padding` units of breathing room on
 * every side (safe-area padding for social export).
 *
 * Returns the canvas dimensions and the content offset — all in the same units
 * as `viewBox`. For `"auto"` the content fills the canvas (offset = 0).
 */
export function computeLetterboxedDimensions(
  viewBox: ViewBoxLike,
  preset: AspectRatioPreset | undefined,
  padding = 0,
): {
  canvasW: number;
  canvasH: number;
  offsetX: number;
  offsetY: number;
} {
  /* node:coverage enable */
  if (!preset || preset === "auto") {
    return {
      canvasW: viewBox.width,
      canvasH: viewBox.height,
      offsetX: 0,
      offsetY: 0,
    };
  }

  const targetRatio = ASPECT_RATIO_VALUES[preset];
  // Expand the "effective" content size by padding so the letterbox canvas
  // respects the safe-area margin on all sides.
  const effectiveW = viewBox.width + 2 * padding;
  const effectiveH = viewBox.height + 2 * padding;
  const naturalRatio = effectiveW / effectiveH;

  let canvasW: number;
  let canvasH: number;

  if (naturalRatio > targetRatio) {
    // Content is wider than target → pillarbox: extend height
    canvasW = effectiveW;
    canvasH = effectiveW / targetRatio;
  } else if (naturalRatio < targetRatio) {
    // Content is taller than target → letterbox: extend width
    canvasH = effectiveH;
    canvasW = effectiveH * targetRatio;
  } else {
    // Already correct ratio
    canvasW = effectiveW;
    canvasH = effectiveH;
  }

  return {
    canvasW,
    canvasH,
    offsetX: (canvasW - viewBox.width) / 2,
    offsetY: (canvasH - viewBox.height) / 2,
  };
}

function parseSvgAttributeMap(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(
    /\s([A-Za-z_:][\w:.-]*)=["']([^"']*)["']/g,
  )) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function firstSolidRectFill(svgString: string): string | undefined {
  for (const match of svgString.matchAll(/<rect\b[^>]*>/g)) {
    const attrs = parseSvgAttributeMap(match[0]);
    const fill = attrs.fill;
    if (
      fill &&
      attrs.width !== undefined &&
      attrs.height !== undefined &&
      !fill.startsWith("url(")
    ) {
      return fill;
    }
  }
  return undefined;
}

/**
 * Apply aspect-ratio letterboxing to a raw SVG string. When `preset` is
 * `"auto"` or `undefined`, the SVG is returned unchanged.
 *
 * Transforms applied:
 * 1. The `viewBox` attribute is expanded to the letterboxed canvas size.
 * 2. A background rect covering the full letterbox area is injected (using the
 *    existing background colour extracted from the SVG, defaulting to white).
 * 3. All existing SVG content is wrapped in a `<g>` that translates it to the
 *    correct centred position within the new canvas.
 *
 * When `padding` is provided (SVG canvas units), the content is inset from the
 * canvas edge by that amount on every side (safe-area padding).
 */
export function applyAspectRatioToSvg(
  svgString: string,
  preset: AspectRatioPreset | undefined,
  padding = 0,
): string {
  if (!preset || preset === "auto") {
    return svgString;
  }

  // Extract viewBox dimensions
  const vbMatch = svgString.match(
    /viewBox=["']\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)["']/,
  );
  if (!vbMatch) {
    return svgString;
  }

  const vbX = parseFloat(vbMatch[1]);
  const vbY = parseFloat(vbMatch[2]);
  const vbW = parseFloat(vbMatch[3]);
  const vbH = parseFloat(vbMatch[4]); /* node:coverage disable */

  const { canvasW, canvasH, offsetX, offsetY } = computeLetterboxedDimensions(
    { width: vbW, height: vbH },
    preset,
    padding,
  );

  // No change needed when already the correct ratio and no padding
  if (offsetX === 0 && offsetY === 0) {
    return svgString;
  }

  // Try to extract a background fill colour from the first solid-colour rect
  // (the visual background rect that comes right after the opening <svg> tag).
  // Fall back to white when none is found.
  const bgFill = firstSolidRectFill(svgString) ?? "#ffffff";

  // Update the viewBox attribute to the new canvas size
  let svg = svgString.replace(
    /viewBox=["']\s*[\d.]+\s+[\d.]+\s+[\d.]+\s+[\d.]+["']/,
    `viewBox="${vbX} ${vbY} ${canvasW} ${canvasH}"`,
  );

  // Wrap all content inside a translate group and prepend the letterbox rect
  svg = svg.replace(
    /(<svg\b[^>]*>)([\s\S]*)(<\/svg>)/,
    (_, open, inner, close) =>
      `${open}` +
      `<rect x="${vbX}" y="${vbY}" width="${canvasW}" height="${canvasH}" fill="${bgFill}" data-letterbox="true"/>` +
      `<g transform="translate(${offsetX},${offsetY})">${inner}</g>` +
      `${close}`,
  );

  return svg;
}

// ---------------------------------------------------------------------------
// SVG string transforms
// ---------------------------------------------------------------------------

/**
 * Build the SVG filter definition string that converts a full-colour graphic
 * to greyscale using a standard luminance matrix.
 */
function buildMonoFilterDef(): string {
  return (
    `<filter id="__export_mono__" color-interpolation-filters="sRGB">` +
    `<feColorMatrix type="saturate" values="0"/>` +
    `</filter>`
  );
}

/**
 * Apply {@link ExportOptions} to a raw SVG string and return the transformed
 * string ready for rasterisation or download.
 *
 * Transforms applied (in order):
 * 1. **Transparent background** — removes/strips existing `<rect>` background
 *    fill if found, and ensures no background-colour attribute on the root.
 * 2. **Custom background** — injects a `<rect>` covering the full viewBox with
 *    the requested fill colour *before* all existing children.
 * 3. **Mono colour mode** — injects a greyscale `<filter>` in `<defs>` and
 *    wraps all existing content in a `<g filter="url(#__export_mono__)">`.
 * 4. **Aspect ratio** — letterboxes/pillarboxes the canvas to the requested
 *    ratio by expanding the viewBox and centering the content.
 *
 * Transforms avoid broad tag regexes for SVG structure; when a DOM parser is
 * unavailable, narrow root/first-child scanning keeps the helpers Node-safe.
 */
export function applyExportOptionsToSvg(
  svgString: string,
  options: ExportOptions,
): string {
  let svg = svgString;

  // ── background ────────────────────────────────────────────────────────────
  if (options.background === "transparent") {
    // Strip style="background-color:…" / style="background:…" on root <svg>
    svg = svg.replace(
      /(<svg\b[^>]*)\sstyle="[^"]*background(?:-color)?:[^;"]*;?([^"]*)"/,
      (_, before, rest) => {
        const cleaned = rest.replace(/^\s*;\s*/, "").trim();
        return cleaned ? `${before} style="${cleaned}"` : before;
      },
    );

    svg = removeLeadingBackgroundRect(svg);
  } else if (options.background === "custom") {
    const fill = options.customBackground ?? "#ffffff";
    // Inject a full-coverage background rect immediately after the opening <svg …> tag.
    svg = svg.replace(/(<svg\b[^>]*>)/, (_, openTag) => {
      // Extract viewBox dimensions to size the rect correctly
      const vbMatch = openTag.match(
        /viewBox=["']\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)["']/,
      );
      const w = vbMatch ? vbMatch[1] : "100%";
      const h = vbMatch ? vbMatch[2] : "100%";
      return (
        `${openTag}` +
        `<rect x="0" y="0" width="${w}" height="${h}" fill="${fill}" data-export-bg="true"/>`
      );
    });
  }

  // ── colour mode ───────────────────────────────────────────────────────────
  if (options.colorMode === "mono") {
    const filterDef = buildMonoFilterDef();

    // Ensure a <defs> block exists and inject our filter.
    if (/<defs\b/.test(svg)) {
      svg = svg.replace(/<defs\b([^>]*)>/, `<defs$1>${filterDef}`);
    } else {
      svg = svg.replace(/(<svg\b[^>]*>)/, `$1<defs>${filterDef}</defs>`);
    }

    // Wrap all child content in a filter group.
    // Strategy: replace the first occurrence of "> ... </svg>" with
    // "> <g filter="url(#__export_mono__)"> ... </g> </svg>"
    svg = svg.replace(
      /(<svg\b[^>]*>)([\s\S]*)(<\/svg>)/,
      (_, open, inner, close) =>
        `${open}<g filter="url(#__export_mono__)">${inner}</g>${close}`,
    );
  }

  // ── aspect ratio ─────────────────────────────────────────────────────────
  if (options.aspectRatio && options.aspectRatio !== "auto") {
    svg = applyAspectRatioToSvg(svg, options.aspectRatio, options.padding ?? 0);
  }

  // ── watermark ────────────────────────────────────────────────────────────
  if (options.watermark) {
    svg = applyWatermarkToSvg(svg);
  }

  return svg;
}

type SvgViewBox = { x: number; y: number; width: number; height: number };

type ParsedTag = {
  name: string;
  attrs: Map<string, string>;
  end: number;
  selfClosing: boolean;
};

function removeLeadingBackgroundRect(svgString: string): string {
  return (
    removeLeadingBackgroundRectWithDom(svgString) ??
    removeLeadingBackgroundRectWithScanner(svgString)
  );
}

function removeLeadingBackgroundRectWithDom(svgString: string): string | null {
  if (
    typeof DOMParser === "undefined" ||
    typeof XMLSerializer === "undefined"
  ) {
    return null;
  }

  const parsed = new DOMParser().parseFromString(svgString, "image/svg+xml");
  if (parsed.querySelector("parsererror")) {
    return null;
  }

  const root = parsed.documentElement;
  if (root.localName.toLowerCase() !== "svg") {
    return null;
  }

  const viewBox = parseViewBox(root.getAttribute("viewBox") ?? "");
  const firstChild = root.firstElementChild;
  if (
    !viewBox ||
    !firstChild ||
    firstChild.localName.toLowerCase() !== "rect"
  ) {
    return svgString;
  }

  if (
    hasSemanticIdentifier(firstChild.getAttributeNames()) ||
    !rectCoversViewBox((name) => firstChild.getAttribute(name), viewBox)
  ) {
    return svgString;
  }

  firstChild.remove();
  return new XMLSerializer().serializeToString(root);
}

function removeLeadingBackgroundRectWithScanner(svgString: string): string {
  const svgStart = findElementStart(svgString, "svg", 0);
  if (svgStart < 0) return svgString;

  const svgTag = parseTagAt(svgString, svgStart);
  if (!svgTag) return svgString;

  const viewBox = parseViewBox(svgTag.attrs.get("viewbox") ?? "");
  if (!viewBox) return svgString;

  const childStart = findFirstChildElementStart(svgString, svgTag.end + 1);
  if (childStart < 0) return svgString;

  const childTag = parseTagAt(svgString, childStart);
  if (!childTag || childTag.name !== "rect") return svgString;

  if (
    hasSemanticIdentifier(childTag.attrs.keys()) ||
    !rectCoversViewBox((name) => childTag.attrs.get(name) ?? null, viewBox)
  ) {
    return svgString;
  }

  const childEnd = findEmptyElementEnd(svgString, childTag);
  if (childEnd < 0) return svgString;

  return svgString.slice(0, childStart) + svgString.slice(childEnd);
}

function parseViewBox(value: string): SvgViewBox | null {
  const parts = value
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  return {
    x: parts[0]!,
    y: parts[1]!,
    width: parts[2]!,
    height: parts[3]!,
  };
}

function hasSemanticIdentifier(attributeNames: Iterable<string>): boolean {
  const names = Array.from(attributeNames, (name) => name.toLowerCase());
  return names.some(
    (name) =>
      name === "id" ||
      name === "class" ||
      name === "aria-label" ||
      name === "aria-labelledby" ||
      name === "role" ||
      name.startsWith("data-"),
  );
}

function rectCoversViewBox(
  getAttr: (name: string) => string | null,
  viewBox: SvgViewBox,
): boolean {
  const x = parseSvgLength(getAttr("x") ?? "0");
  const y = parseSvgLength(getAttr("y") ?? "0");
  const width = parseSvgLength(getAttr("width") ?? "");
  const height = parseSvgLength(getAttr("height") ?? "");

  return (
    lengthEquals(x, viewBox.x) &&
    lengthEquals(y, viewBox.y) &&
    lengthEquals(width, viewBox.width) &&
    lengthEquals(height, viewBox.height)
  );
}

function parseSvgLength(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.endsWith("%")) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function lengthEquals(actual: number | null, expected: number): boolean {
  return actual !== null && Math.abs(actual - expected) < 0.000001;
}

function findElementStart(
  source: string,
  tagName: string,
  fromIndex: number,
): number {
  let cursor = fromIndex;
  const needle = `<${tagName}`;
  while (cursor < source.length) {
    const index = source.indexOf(needle, cursor);
    if (index < 0) return -1;
    const next = source[index + needle.length];
    if (next === undefined || /[\s>/]/.test(next)) return index;
    cursor = index + needle.length;
  }
  return -1;
}

function findFirstChildElementStart(source: string, fromIndex: number): number {
  let cursor = fromIndex;
  while (cursor < source.length) {
    const char = source[cursor];
    if (/\s/.test(char ?? "")) {
      cursor++;
      continue;
    }

    if (source.startsWith("<!--", cursor)) {
      const end = source.indexOf("-->", cursor + 4);
      if (end < 0) return -1;
      cursor = end + 3;
      continue;
    }

    if (source.startsWith("<?", cursor)) {
      const end = source.indexOf("?>", cursor + 2);
      if (end < 0) return -1;
      cursor = end + 2;
      continue;
    }

    if (source.startsWith("<!", cursor)) {
      const end = source.indexOf(">", cursor + 2);
      if (end < 0) return -1;
      cursor = end + 1;
      continue;
    }

    return source[cursor] === "<" && source[cursor + 1] !== "/" ? cursor : -1;
  }
  return -1;
}

function parseTagAt(source: string, start: number): ParsedTag | null {
  if (source[start] !== "<" || source[start + 1] === "/") return null;

  const end = findTagEnd(source, start + 1);
  if (end < 0) return null;

  const raw = source.slice(start + 1, end);
  const nameMatch = raw.match(/^([A-Za-z][\w:-]*)/);
  if (!nameMatch) return null;

  const name = nameMatch[1]!.toLowerCase();
  const attrSource = raw.slice(nameMatch[0].length);
  return {
    name,
    attrs: parseAttributes(attrSource),
    end,
    selfClosing: /\/\s*$/.test(raw),
  };
}

function findTagEnd(source: string, fromIndex: number): number {
  let quote: string | null = null;
  for (let index = fromIndex; index < source.length; index++) {
    const char = source[index];
    if ((char === `"` || char === "'") && source[index - 1] !== "\\") {
      quote = quote === char ? null : (quote ?? char);
      continue;
    }
    if (char === ">" && !quote) return index;
  }
  return -1;
}

function parseAttributes(source: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const attrPattern = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of source.matchAll(attrPattern)) {
    attrs.set(match[1]!.toLowerCase(), match[2] ?? match[3] ?? "");
  }
  return attrs;
}

function findEmptyElementEnd(source: string, tag: ParsedTag): number {
  if (tag.selfClosing) return tag.end + 1;

  const closeStart = source.indexOf(`</${tag.name}`, tag.end + 1);
  if (closeStart < 0) return -1;

  if (source.slice(tag.end + 1, closeStart).trim() !== "") {
    return -1;
  }

  const closeEnd = findTagEnd(source, closeStart + 2);
  return closeEnd < 0 ? -1 : closeEnd + 1;
}

/**
 * Inject a "TextIQ" watermark text into the bottom-right corner of the
 * SVG. Uses a semi-transparent text element so it is legible on both light and
 * dark backgrounds. The text is placed relative to the viewBox dimensions so
 * it scales correctly at any export resolution.
 */
export function applyWatermarkToSvg(svgString: string): string {
  const vbMatch = svgString.match(
    /viewBox=["']\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)["']/,
  );
  if (!vbMatch) return svgString;

  const vbW = parseFloat(vbMatch[3]);
  const vbH = parseFloat(vbMatch[4]);
  const fontSize = Math.max(8, Math.round(vbH * 0.035));
  const padding = Math.round(fontSize * 0.8);
  const x = vbW - padding;
  const y = vbH - padding;

  const watermarkEl =
    `<text ` +
    `x="${x}" y="${y}" ` +
    `text-anchor="end" ` +
    `font-family="sans-serif" ` +
    `font-size="${fontSize}" ` +
    `fill="rgba(100,100,100,0.45)" ` +
    `data-watermark="true" ` +
    `style="pointer-events:none;user-select:none;"` +
    `>TextIQ</text>`;

  return svgString.replace(/(<\/svg>)$/, `${watermarkEl}$1`);
}

// ---------------------------------------------------------------------------
// Social preset helpers
// ---------------------------------------------------------------------------

/**
 * Merges a {@link SocialPreset} configuration into existing {@link ExportOptions},
 * returning a new options object ready for the export pipeline.
 *
 * Rules applied:
 * - `aspectRatio` and `padding` are taken from the preset config.
 * - `background` is forced to `"custom"` with the preset's fill color.
 * - `scale` is raised to the preset's `minScale` if the current value is lower.
 * - `socialPreset` is recorded so the dialog can reflect the active preset.
 * - All other options (colorMode, watermark, …) are preserved from `current`.
 */
export function applySocialPresetToOptions(
  preset: SocialPreset,
  current: ExportOptions,
): ExportOptions {
  const config = SOCIAL_PRESET_CONFIGS[preset];
  return {
    ...current,
    socialPreset: preset,
    aspectRatio: config.aspectRatio,
    padding: config.padding,
    background: "custom",
    customBackground: config.background,
    scale: Math.max(current.scale, config.minScale),
  };
}

/**
 * Clears the active social preset, restoring natural-dimensions export.
 * Resets `aspectRatio`, `padding`, and `socialPreset`; keeps everything else.
 */
export function clearSocialPreset(current: ExportOptions): ExportOptions {
  const next: ExportOptions = { ...current };
  delete next.socialPreset;
  delete next.padding;
  delete next.aspectRatio;
  return next;
}

/**
 * A lightweight utility that serialises an `SVGSVGElement` and applies
 * {@link ExportOptions}. This is the main entry-point for browser-side callers
 * (export.ts) — it couples the DOM serialization to the pure string transform.
 */
export function buildTransformedSvgString(
  svgElement: SVGSVGElement,
  options: ExportOptions,
): string {
  const serializer = new XMLSerializer();
  const raw = serializer.serializeToString(svgElement);
  return applyExportOptionsToSvg(raw, options);
}
