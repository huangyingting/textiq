"use client";

import { buildExportSpec, buildSingleSlideExportSpec } from "./export-spec";
import { resolveExportSpecAssetSources } from "./pptx-appliers/asset-sources";
import type {
  ExportDeckSpec,
  ExportOperation,
  ExportSlideSpec,
} from "./export-spec-types";
import { loadSlideFonts } from "./slide-font-loading";
import { resolveDeckRenderTree } from "./render-resolver";
import type {
  ResolvedRenderNode,
  ResolvedSlideRenderTree,
} from "./render-tree";
import type { CanvasSpec } from "./types";
import type { Deck, ListMarker, TextRun } from "./schema";
import type {
  FillStyle,
  ColorValue,
  TextStyle,
  StyleObject,
} from "./style-schema";
import type { ThemePackageV1 } from "./theme-package-schema";
import { resolveThemePackageForDeck } from "./theme-package-registry";
import { makeDiagnostic } from "./diagnostics";
import { visualChannelColorWithDefaults } from "./visual-channel-colors";
import {
  buildRasterPdfFromPngs,
  resolveRasterSlideDimensions,
  type ExportDeckRasterOptions,
  type RasterExportResult,
  type RasterPngOutput,
  type RasterSlideDimensions,
} from "./raster-export";

/**
 * Converts an ArrayBuffer + MIME type to a base64 data URI.
 * Uses ArrayBuffer (not FileReader) so it works in both browser
 * and Node.js test environments.
 */
export function arrayBufferToDataUrl(
  buffer: ArrayBuffer,
  mimeType: string,
): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

/**
 * For every <img> in `root` whose src is not already a data: URI, fetches
 * the resource (same-origin with credentials) and replaces the src with a
 * base64 data URI so it cannot taint a canvas during SVG rasterization.
 * Best-effort per image: a fetch failure leaves the original src unchanged.
 *
 * Also inlines single-URL background-image values copied verbatim by
 * inlineComputedStyles. NOTE: Complex background-image expressions that
 * combine a url() with a gradient or multiple URLs are not inlined here —
 * any external url() within such expressions will still taint the canvas.
 */
export async function inlineImageSources(root: Element): Promise<void> {
  await Promise.all(
    Array.from(root.querySelectorAll("img")).map(async (img) => {
      const src = img.getAttribute("src");
      if (!src || src.startsWith("data:")) return;
      try {
        const response = await fetch(src, { credentials: "include" });
        const blob = await response.blob();
        const buffer = await blob.arrayBuffer();
        img.src = arrayBufferToDataUrl(buffer, blob.type || "image/png");
        img.removeAttribute("crossorigin");
        img.removeAttribute("srcset");
      } catch {
        // Best-effort: on fetch failure leave the original src intact.
      }
    }),
  );

  await Promise.all(
    Array.from(root.querySelectorAll("*")).map(async (el) => {
      const htmlEl = el as HTMLElement;
      const bgImage = htmlEl.style?.backgroundImage;
      if (!bgImage) return;
      const match = bgImage.match(/^url\(["']?([^"')]+)["']?\)$/);
      if (!match?.[1]) return;
      const url = match[1];
      if (url.startsWith("data:")) return;
      try {
        const response = await fetch(url, { credentials: "include" });
        const blob = await response.blob();
        const buffer = await blob.arrayBuffer();
        htmlEl.style.backgroundImage = `url("${arrayBufferToDataUrl(buffer, blob.type || "image/png")}")`;
      } catch {
        // Best-effort: on fetch failure leave the original background-image intact.
      }
    }),
  );
}

/* node:coverage ignore next 28 */
export function selectedNodeBounds(
  nodes: readonly ResolvedRenderNode[],
  selectedIds: ReadonlySet<string>,
): { x: number; y: number; w: number; h: number } | null {
  const frames: { x: number; y: number; w: number; h: number }[] = [];
  const visit = (node: ResolvedRenderNode): void => {
    if (selectedIds.has(node.id)) frames.push(node.layout.frame);
    node.children?.forEach(visit);
  };
  nodes.forEach(visit);
  if (frames.length === 0) return null;
  const left = Math.max(0, Math.min(...frames.map((frame) => frame.x)));
  const top = Math.max(0, Math.min(...frames.map((frame) => frame.y)));
  const right = Math.min(
    100,
    Math.max(...frames.map((frame) => frame.x + frame.w)),
  );
  const bottom = Math.min(
    100,
    Math.max(...frames.map((frame) => frame.y + frame.h)),
  );
  return {
    x: left,
    y: top,
    w: Math.max(1, right - left),
    h: Math.max(1, bottom - top),
  };
}

/* node:coverage ignore next 10 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [metadata, base64] = dataUrl.split(",", 2);
  const type = metadata.match(/^data:([^;]+)/)?.[1] ?? "image/png";
  const binary = atob(base64 ?? "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type });
}

/* node:coverage ignore next 155 */
function drawSvgToPngDataUrl(
  svg: string,
  dimensions: RasterSlideDimensions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = dimensions.widthPx;
        canvas.height = dimensions.heightPx;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas 2D context unavailable");
        context.drawImage(image, 0, 0, dimensions.widthPx, dimensions.heightPx);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/png"));
      } catch (error) {
        URL.revokeObjectURL(url);
        reject(error);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Slide raster image failed to load"));
    };
    image.src = url;
  });
}

/* node:coverage ignore next 30 */
/**
 * Renders selected nodes from a slide to a PNG Blob using the native SVG
 * pipeline (foreignObject-free). The SVG viewBox is cropped to the bounding
 * box of the selected nodes; only the selected operations are rendered
 * (background is always included). Returns null if nothing is selected or the
 * selection has no matching export operations.
 */
export async function renderSelectedNodesToPngBlob(
  deck: Deck,
  slide: ResolvedSlideRenderTree,
  selectedNodeIds: readonly string[],
  dimensions: RasterSlideDimensions,
): Promise<Blob | null> {
  const selectedIds = new Set(selectedNodeIds);
  if (selectedIds.size === 0) return null;
  const bounds = selectedNodeBounds(slide.nodes, selectedIds);
  if (!bounds) return null;

  await loadSlideFonts();

  // Build a foreignObject-free SVG for the full slide, then crop the viewBox.
  const singleDeckSpec = buildSingleSlideExportSpec(slide, deck.canvas);
  const resolvedSpec = resolveExportSpecAssetSources(
    deck,
    singleDeckSpec,
    resolveThemePackageForDeck(deck).package,
  );
  const slideSpec = resolvedSpec.slides[0];
  if (!slideSpec) return null;

  // Filter to background + selected-node operations only.
  const filteredSpec: ExportSlideSpec = {
    ...slideSpec,
    operations: slideSpec.operations.filter((op) =>
      selectedIds.has((op as { id?: string }).id ?? ""),
    ),
  };

  // Build the full-slide SVG and crop its viewBox to the selection bounding box.
  const cropX = Math.floor((bounds.x / 100) * dimensions.widthPx);
  const cropY = Math.floor((bounds.y / 100) * dimensions.heightPx);
  const cropWidth = Math.max(
    1,
    Math.ceil((bounds.w / 100) * dimensions.widthPx),
  );
  const cropHeight = Math.max(
    1,
    Math.ceil((bounds.h / 100) * dimensions.heightPx),
  );
  const cropDimensions: RasterSlideDimensions = {
    ...dimensions,
    widthPx: cropWidth,
    heightPx: cropHeight,
  };

  const svgString = buildSvgFromSlideSpec(
    filteredSpec,
    deck.canvas,
    dimensions,
    {
      viewBoxX: cropX,
      viewBoxY: cropY,
      viewBoxW: cropWidth,
      viewBoxH: cropHeight,
    },
  );
  const inlined = await inlineSvgImageSources(svgString);
  return dataUrlToBlob(await drawSvgToPngDataUrl(inlined, cropDimensions));
}

/* node:coverage ignore next 25 */
/**
 * Inline every `<image href="…">` in an SVG string whose href is not already
 * a data: URI. Fetches each resource same-origin with credentials and
 * replaces the href with a base64 data URI so the SVG can be drawn to a
 * canvas without triggering a taint error. Best-effort: fetch failures leave
 * the original href intact.
 */
async function inlineSvgImageSources(svgString: string): Promise<string> {
  const doc = new DOMParser().parseFromString(svgString, "image/svg+xml");
  const images = Array.from(doc.querySelectorAll("image[href]"));
  await Promise.all(
    images.map(async (img) => {
      const href = img.getAttribute("href");
      if (!href || href.startsWith("data:")) return;
      try {
        const response = await fetch(href, { credentials: "include" });
        const blob = await response.blob();
        const buffer = await blob.arrayBuffer();
        img.setAttribute(
          "href",
          arrayBufferToDataUrl(buffer, blob.type || "image/png"),
        );
      } catch {
        // Best-effort: leave original href on fetch failure.
      }
    }),
  );
  return new XMLSerializer().serializeToString(doc);
}

// ---------------------------------------------------------------------------
// Native SVG renderer from ExportDeckSpec (foreignObject-free)
// ---------------------------------------------------------------------------

/** Resolve a ColorValue (string or unresolved token ref) to a CSS color. */
function svgColor(cv: ColorValue | undefined, fallback = "#888888"): string {
  if (!cv) return fallback;
  if (typeof cv === "string") {
    if (
      cv === "transparent" ||
      cv === "none" ||
      cv.startsWith("rgb") ||
      cv.startsWith("hsl")
    )
      return cv;
    return cv.startsWith("#") ? cv : `#${cv}`;
  }
  return fallback; // unresolved token ref — theme resolver should have resolved it
}

function xmlEsc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Convert spec-frame coordinates (960×540 basis) to absolute pixel coordinates. */
// ExportOperation.frame values come from resolvedFrame() in the export lowerers,
// which prefers node.layout.framePx (pixels at a 960×540 basis by default) over
// node.layout.frame (percent). This basis matches buildPptxSpec's default basisW/H.
const SPEC_BASIS_W = 960;
const SPEC_BASIS_H = 540;
function specFrameToPx(
  frame: { x: number; y: number; w: number; h: number },
  dims: RasterSlideDimensions,
): { x: number; y: number; w: number; h: number } {
  return {
    x: (frame.x / SPEC_BASIS_W) * dims.widthPx,
    y: (frame.y / SPEC_BASIS_H) * dims.heightPx,
    w: (frame.w / SPEC_BASIS_W) * dims.widthPx,
    h: (frame.h / SPEC_BASIS_H) * dims.heightPx,
  };
}

/** Render an SVG fill + optional gradient defs for one element. */
let _svgDefId = 0;
function nextDefId(): string {
  return `svgdf${(_svgDefId++).toString(36)}`;
}

function renderSvgFill(fill: FillStyle | undefined): {
  attr: string;
  def: string;
} {
  if (!fill) return { attr: "none", def: "" };
  if (fill.type === "solid") return { attr: svgColor(fill.color), def: "" };
  if (fill.type === "linearGradient") {
    const id = nextDefId();
    const angle = ((fill.angle ?? 180) * Math.PI) / 180;
    const x1 = (50 - 50 * Math.sin(angle)).toFixed(1);
    const y1 = (50 - 50 * Math.cos(angle)).toFixed(1);
    const x2 = (50 + 50 * Math.sin(angle)).toFixed(1);
    const y2 = (50 + 50 * Math.cos(angle)).toFixed(1);
    const stops = fill.stops
      ? fill.stops
          .map(
            (s) =>
              `<stop offset="${s.offsetPct}%" stop-color="${svgColor(s.color)}"/>`,
          )
          .join("")
      : `<stop offset="0%" stop-color="${svgColor(fill.from)}"/><stop offset="100%" stop-color="${svgColor(fill.to)}"/>`;
    return {
      attr: `url(#${id})`,
      def: `<linearGradient id="${id}" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%">${stops}</linearGradient>`,
    };
  }
  if (fill.type === "radialGradient") {
    const id = nextDefId();
    const cx = (fill.cx ?? 50).toFixed(1);
    const cy = (fill.cy ?? 50).toFixed(1);
    const r = (fill.r ?? fill.rx ?? 70).toFixed(1);
    const stops = fill.stops
      ? fill.stops
          .map(
            (s) =>
              `<stop offset="${s.offsetPct}%" stop-color="${svgColor(s.color)}"/>`,
          )
          .join("")
      : `<stop offset="0%" stop-color="${svgColor(fill.inner)}"/><stop offset="100%" stop-color="${svgColor(fill.outer)}"/>`;
    return {
      attr: `url(#${id})`,
      def: `<radialGradient id="${id}" cx="${cx}%" cy="${cy}%" r="${r}%">${stops}</radialGradient>`,
    };
  }
  // conicGradient, pattern, image → approximate with a flat color
  return { attr: "#f0f0f0", def: "" };
}

function pxPerPt(dims: RasterSlideDimensions): number {
  return dims.widthPx / dims.widthIn / 72;
}

function svgRotationTransform(
  rotation: number | undefined,
  x: number,
  y: number,
  w: number,
  h: number,
): string {
  if (!rotation) return "";
  const cx = x + w / 2;
  const cy = y + h / 2;
  return ` transform="rotate(${rotation},${cx.toFixed(1)},${cy.toFixed(1)})"`;
}

function svgRadiusAttrs(
  radius: StyleObject["radius"] | undefined,
  dims: RasterSlideDimensions,
): string {
  if (!radius) return "";
  const toPx = pxPerPt(dims);
  const r =
    "allPt" in radius
      ? radius.allPt
      : Math.max(
          radius.topLeftPt,
          radius.topRightPt,
          radius.bottomRightPt,
          radius.bottomLeftPt,
        );
  const px = Math.max(0, r * toPx);
  return px > 0 ? ` rx="${px.toFixed(1)}" ry="${px.toFixed(1)}"` : "";
}

function svgStrokeAttrs(
  stroke: StyleObject["stroke"] | undefined,
  dims: RasterSlideDimensions,
): string {
  if (!stroke) return ` stroke="none" stroke-width="0"`;
  const dashArray =
    stroke.dash === "dashed"
      ? "6 4"
      : stroke.dash === "dotted"
        ? "1 4"
        : undefined;
  return ` stroke="${xmlEsc(svgColor(stroke.color, "transparent"))}" stroke-width="${(stroke.widthPt * pxPerPt(dims)).toFixed(1)}"${dashArray ? ` stroke-dasharray="${dashArray}"` : ""}`;
}

function svgEffectFilter(style: StyleObject): string {
  const filters: string[] = [];
  const shadow = style.shadow;
  if (shadow) {
    filters.push(
      `drop-shadow(${shadow.xPt}pt ${shadow.yPt}pt ${shadow.blurPt}pt ${svgColor(shadow.color, "rgba(0,0,0,0.2)")})`,
    );
  }
  const effect = style.effect;
  if (effect && effect.kind !== "none") {
    if (effect.kind === "blur") {
      filters.push(`blur(${effect.radiusPt}pt)`);
    } else if (effect.kind === "glow") {
      filters.push(
        `drop-shadow(0 0 ${effect.blurPt}pt ${svgColor(effect.color, "currentColor")})`,
      );
    } else if (effect.kind === "glass") {
      const blur =
        effect.intensity === "strong"
          ? 22
          : effect.intensity === "light"
            ? 8
            : 14;
      filters.push(`blur(${blur}px) saturate(1.25)`);
    }
  }
  return filters.join(" ");
}

function svgImageFilter(style: StyleObject["image"] | undefined): string {
  return [
    style?.brightness !== undefined ? `brightness(${style.brightness})` : "",
    style?.contrast !== undefined ? `contrast(${style.contrast})` : "",
    style?.saturation !== undefined ? `saturate(${style.saturation})` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function renderSvgContainerPaint(
  style: StyleObject,
  frame: { x: number; y: number; w: number; h: number },
  dims: RasterSlideDimensions,
): { defs: string; body: string } {
  const fill = style.fill?.type === "image" ? undefined : style.fill;
  const fillResult = renderSvgFill(fill);
  const hasFill = fill !== undefined;
  const hasStroke = style.stroke !== undefined;
  if (!hasFill && !hasStroke) return { defs: "", body: "" };
  const strokeAttrs = svgStrokeAttrs(style.stroke, dims);
  return {
    defs: fillResult.def,
    body: `<rect x="${frame.x.toFixed(1)}" y="${frame.y.toFixed(1)}" width="${frame.w.toFixed(1)}" height="${frame.h.toFixed(1)}"${svgRadiusAttrs(style.radius, dims)} fill="${xmlEsc(hasFill ? fillResult.attr : "none")}"${strokeAttrs}/>`,
  };
}

function wrapSvgStyledNode(
  style: StyleObject,
  frame: { x: number; y: number; w: number; h: number },
  rotation: number | undefined,
  content: string,
): string {
  const nodeOpacity =
    style.opacity ??
    (style.effect?.kind === "glow" ? style.effect.opacity : undefined);
  const nodeFilter = svgEffectFilter(style);
  const attrs = [
    svgRotationTransform(rotation, frame.x, frame.y, frame.w, frame.h),
    nodeOpacity !== undefined ? ` opacity="${nodeOpacity}"` : "",
    nodeFilter ? ` filter="${xmlEsc(nodeFilter)}"` : "",
    style.blendMode && style.blendMode !== "normal"
      ? ` style="mix-blend-mode:${xmlEsc(style.blendMode)}"`
      : "",
  ].join("");
  return `<g${attrs}>${content}</g>`;
}

const CHAR_WIDTH_RATIO_SVG = 0.54;

type SvgTextSegment = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  color: string;
  fontSize: number;
  fontFamily: string;
};

type SvgTextLine = {
  segments: SvgTextSegment[];
  indentPx: number;
};

function wrapSvgLine(text: string, boxW: number, fontSize: number): string[] {
  const charsPerLine = Math.max(
    1,
    Math.floor(boxW / (fontSize * CHAR_WIDTH_RATIO_SVG)),
  );
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word;
    if (test.length > charsPerLine && cur) {
      lines.push(cur);
      cur = word;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

function listPrefix(marker: ListMarker | undefined, number: number): string {
  if (!marker) return "";
  if (marker.kind === "bullet") return "• ";
  switch (marker.numberStyle) {
    case "lower-alpha":
      return `${toAlphabeticMarker(number, false)}. `;
    case "upper-alpha":
      return `${toAlphabeticMarker(number, true)}. `;
    case "lower-roman":
      return `${toLowerRomanMarker(number)}. `;
    case "decimal":
    default:
      return `${number}. `;
  }
}

function toAlphabeticMarker(value: number, uppercase: boolean): string {
  if (value <= 0) return "0";
  let remaining = Math.floor(value);
  let marker = "";
  while (remaining > 0) {
    remaining -= 1;
    marker = String.fromCharCode(97 + (remaining % 26)) + marker;
    remaining = Math.floor(remaining / 26);
  }
  return uppercase ? marker.toUpperCase() : marker;
}

function toLowerRomanMarker(value: number): string {
  if (value <= 0) return "0";
  const numerals: Array<[number, string]> = [
    [1000, "m"],
    [900, "cm"],
    [500, "d"],
    [400, "cd"],
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let remaining = Math.floor(value);
  let marker = "";
  for (const [amount, symbol] of numerals) {
    while (remaining >= amount) {
      marker += symbol;
      remaining -= amount;
    }
  }
  return marker;
}

function segmentStyleKey(segment: SvgTextSegment): string {
  return [
    segment.bold ? "1" : "0",
    segment.italic ? "1" : "0",
    segment.underline ? "1" : "0",
    segment.strikethrough ? "1" : "0",
    segment.color,
    segment.fontSize,
    segment.fontFamily,
  ].join("\u0000");
}

function pushMergedSegment(
  segments: SvgTextSegment[],
  segment: SvgTextSegment,
): void {
  if (segment.text.length === 0) return;
  const last = segments[segments.length - 1];
  if (last && segmentStyleKey(last) === segmentStyleKey(segment)) {
    last.text += segment.text;
    return;
  }
  segments.push({ ...segment });
}

function textRunToSvgSegment(
  run: TextRun,
  defaults: {
    color: string;
    fontSize: number;
    fontFamily: string;
    bold: boolean;
    italic: boolean;
    pxPerPt: number;
  },
): SvgTextSegment {
  return {
    text: run.text,
    bold: run.bold ?? defaults.bold,
    italic: run.italic ?? defaults.italic,
    underline: run.underline,
    strikethrough: run.strikethrough,
    color:
      typeof run.localStyle?.color === "string"
        ? svgColor(run.localStyle.color, defaults.color)
        : defaults.color,
    fontSize:
      run.localStyle?.fontSizePt !== undefined
        ? run.localStyle.fontSizePt * defaults.pxPerPt
        : defaults.fontSize,
    fontFamily:
      typeof run.localStyle?.fontFamily === "string"
        ? run.localStyle.fontFamily
        : defaults.fontFamily,
  };
}

function wrapSvgSegments(
  segments: SvgTextSegment[],
  boxW: number,
  fontSize: number,
  indentPx: number,
): SvgTextLine[] {
  const chars = segments.flatMap((segment) =>
    Array.from(segment.text).map((char) => ({ char, segment })),
  );
  if (chars.length === 0) return [{ segments: [], indentPx }];

  const charsPerLine = Math.max(
    1,
    Math.floor(
      Math.max(1, boxW - indentPx) / (fontSize * CHAR_WIDTH_RATIO_SVG),
    ),
  );
  const lines: SvgTextLine[] = [];
  let start = 0;
  while (start < chars.length) {
    while (chars[start]?.char === " ") start += 1;
    let end = Math.min(chars.length, start + charsPerLine);
    if (end < chars.length) {
      for (let i = end - 1; i > start; i -= 1) {
        if (chars[i]?.char === " ") {
          end = i;
          break;
        }
      }
    }
    let nextStart = end;
    while (end > start && chars[end - 1]?.char === " ") end -= 1;
    if (chars[nextStart]?.char === " ") nextStart += 1;
    const lineSegments: SvgTextSegment[] = [];
    for (let i = start; i < end; i += 1) {
      const { char, segment } = chars[i]!;
      pushMergedSegment(lineSegments, { ...segment, text: char });
    }
    lines.push({ segments: lineSegments, indentPx });
    start = Math.max(nextStart, start + 1);
  }
  return lines.length ? lines : [{ segments: [], indentPx }];
}

function renderSvgTextLine(
  line: SvgTextLine,
  x: number,
  y: number,
  textAnchor: "start" | "middle" | "end",
  base: {
    fontSize: number;
    color: string;
    fontFamily: string;
    fontWeight: string;
    fontStyle: string;
    transform: string;
  },
): string {
  const tspans = line.segments
    .map((segment) => {
      const decorations = [
        segment.underline ? "underline" : "",
        segment.strikethrough ? "line-through" : "",
      ].filter(Boolean);
      return `<tspan font-size="${segment.fontSize.toFixed(1)}" fill="${xmlEsc(segment.color)}" font-family="${xmlEsc(segment.fontFamily)}" font-weight="${segment.bold ? "bold" : "normal"}" font-style="${segment.italic ? "italic" : "normal"}"${decorations.length ? ` text-decoration="${decorations.join(" ")}"` : ""}>${xmlEsc(segment.text)}</tspan>`;
    })
    .join("");
  return `<text x="${(x + line.indentPx).toFixed(1)}" y="${y.toFixed(1)}" font-size="${base.fontSize.toFixed(1)}" fill="${xmlEsc(base.color)}" font-family="${xmlEsc(base.fontFamily)}" font-weight="${base.fontWeight}" font-style="${base.fontStyle}" text-anchor="${textAnchor}"${base.transform}>${tspans}</text>`;
}

/** Render a text operation as native SVG <text> elements (no foreignObject). */
function renderSvgText(
  op: Extract<ExportOperation, { type: "text" }>,
  dims: RasterSlideDimensions,
): { defs: string; body: string } {
  const { x, y, w, h } = specFrameToPx(op.frame, dims);
  const ts: TextStyle = op.style.text ?? {};
  const pxPerIn = dims.widthPx / dims.widthIn;
  const fontSize = ts.fontSizePt
    ? (ts.fontSizePt * pxPerIn) / 72
    : (14 * pxPerIn) / 72;
  const color = svgColor(ts.color, "#111111");
  const fontFamily =
    typeof ts.fontFamily === "string" ? ts.fontFamily : "sans-serif";
  const fontWeight = (ts.weight ?? 400) >= 600 ? "bold" : "normal";
  const fontStyle = ts.italic ? "italic" : "normal";
  const align = ts.align ?? "left";
  const textAnchor =
    align === "center" ? "middle" : align === "right" ? "end" : "start";
  const textX = align === "center" ? x + w / 2 : align === "right" ? x + w : x;
  const lineH = fontSize * (ts.lineHeight ?? 1.4);
  const defaults = {
    color,
    fontSize,
    fontFamily,
    bold: fontWeight === "bold",
    italic: fontStyle === "italic",
    pxPerPt: pxPerIn / 72,
  };

  // Collect all lines for vertical alignment
  const allLines: SvgTextLine[] = [];
  const listCounters = new Array(6).fill(0) as number[];
  for (const para of op.content.paragraphs) {
    const indentPx = (para.list?.indent ?? 0) * fontSize * 1.5;
    let number = 0;
    if (para.list?.kind === "number") {
      const indent = Math.max(
        0,
        Math.min(listCounters.length - 1, para.list.indent ?? 0),
      );
      for (let depth = indent + 1; depth < listCounters.length; depth += 1) {
        listCounters[depth] = 0;
      }
      listCounters[indent] += 1;
      number = listCounters[indent];
    } else {
      listCounters.fill(0);
    }
    const prefix = listPrefix(para.list, number);
    const segments: SvgTextSegment[] = [];
    if (prefix) {
      segments.push({
        text: prefix,
        color,
        fontSize,
        fontFamily,
        bold: fontWeight === "bold",
        italic: fontStyle === "italic",
      });
    }
    if (para.runs && para.runs.length > 0) {
      for (const run of para.runs) {
        segments.push(textRunToSvgSegment(run, defaults));
      }
    } else if (para.text.trim() !== "" || prefix) {
      segments.push({
        text: para.text,
        color,
        fontSize,
        fontFamily,
        bold: fontWeight === "bold",
        italic: fontStyle === "italic",
      });
    }
    if (segments.length === 0) {
      allLines.push({ segments: [], indentPx });
      continue;
    }
    allLines.push(...wrapSvgSegments(segments, w, fontSize, indentPx));
  }

  const totalH = allLines.length * lineH;
  const vAlign = ts.verticalAlign ?? "top";
  const startY =
    vAlign === "middle"
      ? y + (h - totalH) / 2 + fontSize
      : vAlign === "bottom"
        ? y + h - totalH + fontSize
        : y + fontSize;

  const textBody = allLines
    .map((line, i) =>
      renderSvgTextLine(line, textX, startY + i * lineH, textAnchor, {
        fontSize,
        color,
        fontFamily,
        fontWeight,
        fontStyle,
        transform: "",
      }),
    )
    .join("\n");
  const container = renderSvgContainerPaint(op.style, { x, y, w, h }, dims);
  const body = wrapSvgStyledNode(
    op.style,
    { x, y, w, h },
    op.rotation,
    `${container.body}${textBody}`,
  );

  return { defs: container.defs, body };
}

/** Render a shape operation as native SVG (rect, ellipse, polygon, etc). */
function renderSvgShape(
  op: Extract<ExportOperation, { type: "shape" }>,
  dims: RasterSlideDimensions,
): { defs: string; body: string } {
  const { x, y, w, h } = specFrameToPx(op.frame, dims);
  const fillResult = renderSvgFill(op.style.fill);
  const stroke = op.style.stroke;
  const strokeColor = stroke ? svgColor(stroke.color, "none") : "none";
  const pxPerIn = dims.widthPx / dims.widthIn;
  const strokeW = stroke ? (stroke.widthPt * pxPerIn) / 72 : 0;
  const opacity = op.style.opacity ?? 1;
  const rotation = op.rotation;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const transform = rotation
    ? ` transform="rotate(${rotation},${cx.toFixed(1)},${cy.toFixed(1)})"`
    : "";
  const commonAttrs = ` fill="${xmlEsc(fillResult.attr)}" stroke="${xmlEsc(strokeColor)}" stroke-width="${strokeW.toFixed(1)}" opacity="${opacity}"${transform}`;

  let shapeEl: string;
  switch (op.shape) {
    case "circle":
    case "ellipse":
      shapeEl = `<ellipse cx="${(x + w / 2).toFixed(1)}" cy="${(y + h / 2).toFixed(1)}" rx="${(w / 2).toFixed(1)}" ry="${(h / 2).toFixed(1)}"${commonAttrs}/>`;
      break;
    case "triangle":
      shapeEl = `<polygon points="${(x + w / 2).toFixed(1)},${y.toFixed(1)} ${x.toFixed(1)},${(y + h).toFixed(1)} ${(x + w).toFixed(1)},${(y + h).toFixed(1)}"${commonAttrs}/>`;
      break;
    case "diamond":
      shapeEl = `<polygon points="${(x + w / 2).toFixed(1)},${y.toFixed(1)} ${(x + w).toFixed(1)},${(y + h / 2).toFixed(1)} ${(x + w / 2).toFixed(1)},${(y + h).toFixed(1)} ${x.toFixed(1)},${(y + h / 2).toFixed(1)}"${commonAttrs}/>`;
      break;
    case "line":
      shapeEl = `<line x1="${x.toFixed(1)}" y1="${(y + h / 2).toFixed(1)}" x2="${(x + w).toFixed(1)}" y2="${(y + h / 2).toFixed(1)}" stroke="${xmlEsc(strokeColor)}" stroke-width="${strokeW.toFixed(1)}" opacity="${opacity}"${transform}/>`;
      break;
    default:
      // rect, square, and unknown shapes → <rect>
      shapeEl = `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}"${commonAttrs}/>`;
  }
  return { defs: fillResult.def, body: shapeEl };
}

/** Render an image operation as native SVG <image>. */
function renderSvgImage(
  op: Extract<ExportOperation, { type: "image" }>,
  dims: RasterSlideDimensions,
): { defs: string; body: string } {
  const { x, y, w, h } = specFrameToPx(op.frame, dims);
  const crop = op.crop;
  const hasCrop = crop
    ? [crop.top, crop.right, crop.bottom, crop.left].some((value) => value > 0)
    : false;
  const imageX = hasCrop && crop ? x - (w * crop.left) / 100 : x;
  const imageY = hasCrop && crop ? y - (h * crop.top) / 100 : y;
  const imageW =
    hasCrop && crop ? (w * (100 + crop.left + crop.right)) / 100 : w;
  const imageH =
    hasCrop && crop ? (h * (100 + crop.top + crop.bottom)) / 100 : h;
  const preserveAspectRatio =
    op.fit === "cover"
      ? "xMidYMid slice"
      : op.fit === "fill"
        ? "none"
        : "xMidYMid meet";
  // op.assetId contains the resolved URL after resolveExportSpecAssetSources
  const href = xmlEsc(op.assetId);
  const filter = svgImageFilter(op.style.image);
  const image = `<image href="${href}" x="${imageX.toFixed(1)}" y="${imageY.toFixed(1)}" width="${imageW.toFixed(1)}" height="${imageH.toFixed(1)}" preserveAspectRatio="${preserveAspectRatio}"${filter ? ` filter="${xmlEsc(filter)}"` : ""}/>`;
  const defs: string[] = [];
  const bodies: string[] = [];
  const container = renderSvgContainerPaint(op.style, { x, y, w, h }, dims);
  if (container.defs) defs.push(container.defs);
  if (container.body) bodies.push(container.body);
  let imageBody = image;

  if (hasCrop) {
    const clipId = nextDefId();
    defs.push(
      `<clipPath id="${clipId}"><rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}"/></clipPath>`,
    );
    imageBody = `<g clip-path="url(#${clipId})">${image}</g>`;
  }
  bodies.push(imageBody);
  return {
    defs: defs.join("\n"),
    body: wrapSvgStyledNode(
      op.style,
      { x, y, w, h },
      op.rotation,
      bodies.join(""),
    ),
  };
}

function renderSvgVisualPlaceholder(
  op: Extract<ExportOperation, { type: "visual" }>,
  dims: RasterSlideDimensions,
): { defs: string; body: string } {
  const { x, y, w, h } = specFrameToPx(op.frame, dims);
  const colors = visualChannelColorWithDefaults({
    ...(op.style.visual?.channelColors ?? {}),
    ...(op.channelColors ?? {}),
  });
  const isTransparent =
    op.transparentBackground ?? op.style.visual?.transparentBackground ?? false;
  const backgroundColor = isTransparent ? "transparent" : `${colors.muted}22`;
  const scaleX = w / 120;
  const scaleY = h / 80;
  const bar = (bx: number, by: number, bw: number, bh: number, fill: string) =>
    `<rect x="${(x + bx * scaleX).toFixed(1)}" y="${(y + by * scaleY).toFixed(1)}" width="${(bw * scaleX).toFixed(1)}" height="${(bh * scaleY).toFixed(1)}" rx="${(4 * Math.min(scaleX, scaleY)).toFixed(1)}" fill="${xmlEsc(fill)}"/>`;
  const container = renderSvgContainerPaint(op.style, { x, y, w, h }, dims);
  const fallbackBorder = `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${(4 * Math.min(scaleX, scaleY)).toFixed(1)}" fill="${xmlEsc(backgroundColor)}" stroke="${xmlEsc(colors.muted)}" stroke-width="1"/>`;
  const placeholder = [
    container.body,
    fallbackBorder,
    bar(14, 18, 18, 44, colors.primary),
    bar(51, 31, 18, 31, colors.secondary),
    bar(88, 10, 18, 52, colors.accent),
    `<path d="M ${(x + 12 * scaleX).toFixed(1)} ${(y + 68 * scaleY).toFixed(1)} H ${(x + 108 * scaleX).toFixed(1)}" stroke="${xmlEsc(colors.muted)}" stroke-width="${(4 * Math.min(scaleX, scaleY)).toFixed(1)}" stroke-linecap="round"/>`,
  ].join("");
  return {
    defs: container.defs,
    body: wrapSvgStyledNode(op.style, { x, y, w, h }, op.rotation, placeholder),
  };
}

/** Render a connector operation as a native SVG <line> or <path>. */
function renderSvgConnector(
  op: Extract<ExportOperation, { type: "connector" }>,
  dims: RasterSlideDimensions,
): { defs: string; body: string } {
  const { x, y, w, h } = specFrameToPx(op.frame, dims);
  const connectorStyle = op.style.connector;
  const stroke = connectorStyle?.stroke ?? op.style.stroke;
  const strokeColor = stroke ? svgColor(stroke.color, "#888888") : "#888888";
  const pxPerIn = dims.widthPx / dims.widthIn;
  const strokeW = stroke ? (stroke.widthPt * pxPerIn) / 72 : 2;
  const dashArray =
    stroke?.dash === "dashed"
      ? "6 4"
      : stroke?.dash === "dotted"
        ? "1 4"
        : undefined;
  const startArrow = connectorStyle?.startArrow ?? "none";
  const endArrow = connectorStyle?.endArrow ?? "arrow";
  const routing = op.routing ?? connectorStyle?.routing ?? "straight";
  const start = connectorEndpointToSvgPoint(op.from, { x, y, w, h });
  const end = connectorEndpointToSvgPoint(op.to, { x, y, w, h });
  const midX = start.x + (end.x - start.x) / 2;
  const path =
    routing === "curved"
      ? `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} C ${midX.toFixed(1)} ${start.y.toFixed(1)} ${midX.toFixed(1)} ${end.y.toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`
      : routing === "elbow"
        ? `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} L ${midX.toFixed(1)} ${start.y.toFixed(1)} L ${midX.toFixed(1)} ${end.y.toFixed(1)} L ${end.x.toFixed(1)} ${end.y.toFixed(1)}`
        : `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} L ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
  const defs: string[] = [];
  const startMarkerId = startArrow !== "none" ? nextDefId() : undefined;
  const endMarkerId = endArrow !== "none" ? nextDefId() : undefined;

  if (startMarkerId && startArrow !== "none") {
    defs.push(
      renderConnectorMarker(startMarkerId, "start", startArrow, strokeColor),
    );
  }
  if (endMarkerId && endArrow !== "none") {
    defs.push(renderConnectorMarker(endMarkerId, "end", endArrow, strokeColor));
  }

  const opacity =
    op.style.opacity !== undefined ? ` opacity="${op.style.opacity}"` : "";
  const body = `<path d="${path}" fill="none" stroke="${xmlEsc(strokeColor)}" stroke-width="${strokeW.toFixed(1)}"${dashArray ? ` stroke-dasharray="${dashArray}"` : ""} vector-effect="non-scaling-stroke"${startMarkerId ? ` marker-start="url(#${startMarkerId})"` : ""}${endMarkerId ? ` marker-end="url(#${endMarkerId})"` : ""}${opacity}/>`;
  return { defs: defs.join("\n"), body };
}

function connectorEndpointToSvgPoint(
  endpoint: Extract<ExportOperation, { type: "connector" }>["from"],
  frame: { x: number; y: number; w: number; h: number },
): { x: number; y: number } {
  const point =
    endpoint.kind === "point"
      ? endpoint.point
      : connectorAnchorPoint(endpoint.anchor);
  return {
    x: frame.x + (frame.w * point.x) / 100,
    y: frame.y + (frame.h * point.y) / 100,
  };
}

function connectorAnchorPoint(
  anchor: Extract<
    Extract<ExportOperation, { type: "connector" }>["from"],
    { kind: "node" }
  >["anchor"],
): { x: number; y: number } {
  switch (anchor) {
    case "top":
      return { x: 50, y: 0 };
    case "right":
      return { x: 100, y: 50 };
    case "bottom":
      return { x: 50, y: 100 };
    case "left":
      return { x: 0, y: 50 };
    case "center":
    default:
      return { x: 50, y: 50 };
  }
}

function renderConnectorMarker(
  id: string,
  side: "start" | "end",
  arrow: "arrow" | "filled",
  strokeColor: string,
): string {
  const path = side === "start" ? "M 8 0 L 0 3 L 8 6" : "M 0 0 L 8 3 L 0 6";
  const refX = side === "start" ? 1 : 7;
  return `<marker id="${id}" markerWidth="8" markerHeight="6" refX="${refX}" refY="3" orient="auto"><path d="${path}" fill="${arrow === "filled" ? xmlEsc(strokeColor) : "none"}" stroke="${xmlEsc(strokeColor)}" stroke-width="1"/></marker>`;
}

function tableColumnWidths(
  op: Extract<ExportOperation, { type: "tableShape" }>,
  totalWidth: number,
): number[] {
  const weights = op.table.columns.map((column) =>
    typeof column.width === "number" && Number.isFinite(column.width)
      ? Math.max(0, column.width)
      : 1,
  );
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) {
    return op.table.columns.map(() => totalWidth / op.table.columns.length);
  }
  return weights.map((weight) => (weight / totalWeight) * totalWidth);
}

function tableTextValue(cell: {
  text: string;
  runs?: { text: string }[];
}): string {
  if (!cell.runs || cell.runs.length === 0) return cell.text;
  return cell.runs.map((run) => run.text).join("");
}

function renderSvgTableText(
  text: string,
  cell: { x: number; y: number; w: number; h: number },
  textStyle: TextStyle,
  defaults: { weight?: number },
  padding: { top: number; right: number; bottom: number; left: number },
  clipId: string,
  dims: RasterSlideDimensions,
): string {
  const pxPerIn = dims.widthPx / dims.widthIn;
  const fontSize = textStyle.fontSizePt
    ? (textStyle.fontSizePt * pxPerIn) / 72
    : (9 * pxPerIn) / 72;
  const lineH = fontSize * (textStyle.lineHeight ?? 1.25);
  const fontFamily =
    typeof textStyle.fontFamily === "string"
      ? textStyle.fontFamily
      : "sans-serif";
  const color = svgColor(textStyle.color, "#111111");
  const weight = textStyle.weight ?? defaults.weight ?? 400;
  const fontWeight = weight >= 600 ? "bold" : "normal";
  const fontStyle = textStyle.italic ? "italic" : "normal";
  const availableW = Math.max(1, cell.w - padding.left - padding.right);
  const availableH = Math.max(lineH, cell.h - padding.top - padding.bottom);
  const lines = wrapSvgLine(text, availableW, fontSize);
  const maxLines = Math.max(1, Math.floor(availableH / lineH));
  const visibleLines = lines.slice(0, maxLines);
  const align = textStyle.align ?? "left";
  const textAnchor =
    align === "center" ? "middle" : align === "right" ? "end" : "start";
  const textX =
    align === "center"
      ? cell.x + cell.w / 2
      : align === "right"
        ? cell.x + cell.w - padding.right
        : cell.x + padding.left;
  const textY = cell.y + padding.top + fontSize;

  return visibleLines
    .map((line, index) => {
      const ly = textY + index * lineH;
      return `<text x="${textX.toFixed(1)}" y="${ly.toFixed(1)}" font-size="${fontSize.toFixed(1)}" fill="${xmlEsc(color)}" font-family="${xmlEsc(fontFamily)}" font-weight="${fontWeight}" font-style="${fontStyle}" text-anchor="${textAnchor}" clip-path="url(#${clipId})">${xmlEsc(line)}</text>`;
    })
    .join("\n");
}

function tableStrokeDashArray(
  dash: string | undefined,
  strokeW: number,
): string {
  if (dash === "dashed")
    return `${(strokeW * 4).toFixed(1)} ${(strokeW * 3).toFixed(1)}`;
  if (dash === "dotted")
    return `${strokeW.toFixed(1)} ${(strokeW * 3).toFixed(1)}`;
  return "";
}

/** Render a tableShape operation as native SVG cell rectangles, grid lines, and text. */
function renderSvgTableShape(
  op: Extract<ExportOperation, { type: "tableShape" }>,
  dims: RasterSlideDimensions,
): { defs: string; body: string } {
  const { x, y, w, h } = specFrameToPx(op.frame, dims);
  const columnCount = op.table.columns.length;
  const includeHeader = op.table.header === true && columnCount > 0;
  const bodyRows = op.table.rows;
  const rowCount = bodyRows.length + (includeHeader ? 1 : 0);
  const tableStyle = op.style.table;
  const pxPerIn = dims.widthPx / dims.widthIn;
  const border = tableStyle?.border;
  const strokeW = border ? (border.widthPt * pxPerIn) / 72 : 1;
  const strokeColor = border ? svgColor(border.color, "#d1d5db") : "#d1d5db";
  const dashArray = tableStrokeDashArray(border?.dash, strokeW);
  const opacity = op.style.opacity ?? 1;

  if (columnCount === 0 || rowCount === 0) {
    const emptyStroke =
      strokeW > 0
        ? ` stroke="${xmlEsc(strokeColor)}" stroke-width="${strokeW.toFixed(1)}"`
        : ' stroke="none"';
    return {
      defs: "",
      body: `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="none"${emptyStroke} opacity="${opacity}"/>`,
    };
  }

  const defs: string[] = [];
  const body: string[] = [];
  const colWidths = tableColumnWidths(op, w);
  const rowH = h / rowCount;
  const paddingPt = tableStyle?.cellPaddingPt ?? {
    top: 3,
    right: 6,
    bottom: 3,
    left: 6,
  };
  const padding = {
    top: (paddingPt.top * pxPerIn) / 72,
    right: (paddingPt.right * pxPerIn) / 72,
    bottom: (paddingPt.bottom * pxPerIn) / 72,
    left: (paddingPt.left * pxPerIn) / 72,
  };
  const textStyle = tableStyle?.text ?? op.style.text ?? {};
  const headerTextStyle = tableStyle?.headerText ?? textStyle;
  const rowEntries = [
    ...(includeHeader
      ? [
          {
            kind: "header" as const,
            cells: op.table.columns.map((column) => column.label),
          },
        ]
      : []),
    ...bodyRows.map((row, rowIndex) => ({
      kind: "body" as const,
      rowIndex,
      cells: op.table.columns.map((_, columnIndex) =>
        tableTextValue(row.cells[columnIndex] ?? { text: "" }),
      ),
    })),
  ];

  let currentY = y;
  for (const [rowIndex, row] of rowEntries.entries()) {
    let currentX = x;
    const fill =
      row.kind === "header"
        ? renderSvgFill(tableStyle?.headerFill)
        : renderSvgFill(
            row.rowIndex % 2 === 1
              ? (tableStyle?.alternateRowFill ?? tableStyle?.rowFill)
              : tableStyle?.rowFill,
          );
    if (fill.def) defs.push(fill.def);

    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const cellW = colWidths[columnIndex] ?? w / columnCount;
      if (fill.attr !== "none") {
        body.push(
          `<rect x="${currentX.toFixed(1)}" y="${currentY.toFixed(1)}" width="${cellW.toFixed(1)}" height="${rowH.toFixed(1)}" fill="${xmlEsc(fill.attr)}"/>`,
        );
      }
      const clipId = nextDefId();
      defs.push(
        `<clipPath id="${clipId}"><rect x="${(currentX + padding.left).toFixed(1)}" y="${(currentY + padding.top).toFixed(1)}" width="${Math.max(1, cellW - padding.left - padding.right).toFixed(1)}" height="${Math.max(1, rowH - padding.top - padding.bottom).toFixed(1)}"/></clipPath>`,
      );
      body.push(
        renderSvgTableText(
          row.cells[columnIndex] ?? "",
          { x: currentX, y: currentY, w: cellW, h: rowH },
          row.kind === "header" ? headerTextStyle : textStyle,
          row.kind === "header" ? { weight: 600 } : {},
          padding,
          clipId,
          dims,
        ),
      );
      currentX += cellW;
    }
    currentY = y + (rowIndex + 1) * rowH;
  }

  if (strokeW > 0) {
    const boundariesX = [x];
    let currentX = x;
    for (const colW of colWidths) {
      currentX += colW;
      boundariesX.push(currentX);
    }
    const boundariesY = Array.from(
      { length: rowCount + 1 },
      (_, index) => y + index * rowH,
    );
    const gridPath = [
      ...boundariesX.map(
        (boundaryX) =>
          `M ${boundaryX.toFixed(1)} ${y.toFixed(1)} V ${(y + h).toFixed(1)}`,
      ),
      ...boundariesY.map(
        (boundaryY) =>
          `M ${x.toFixed(1)} ${boundaryY.toFixed(1)} H ${(x + w).toFixed(1)}`,
      ),
    ].join(" ");
    body.push(
      `<path d="${gridPath}" fill="none" stroke="${xmlEsc(strokeColor)}" stroke-width="${strokeW.toFixed(1)}"${dashArray ? ` stroke-dasharray="${dashArray}"` : ""}/>`,
    );
  }

  if (op.table.caption) {
    const captionHeight = 0.3 * pxPerIn;
    const captionGap = 0.05 * pxPerIn;
    const captionY = Math.max(0, y - captionHeight - captionGap);
    const clipId = nextDefId();
    defs.push(
      `<clipPath id="${clipId}"><rect x="${x.toFixed(1)}" y="${captionY.toFixed(1)}" width="${w.toFixed(1)}" height="${captionHeight.toFixed(1)}"/></clipPath>`,
    );
    body.unshift(
      renderSvgTableText(
        op.table.caption,
        { x, y: captionY, w, h: captionHeight },
        { ...textStyle, italic: textStyle.italic ?? true },
        {},
        { top: 0, right: 0, bottom: 0, left: 0 },
        clipId,
        dims,
      ),
    );
  }

  return {
    defs: defs.join("\n"),
    body: `<g opacity="${opacity}">\n${body.filter(Boolean).join("\n")}\n</g>`,
  };
}

/**
 * Build a foreignObject-free SVG string for one slide from its ExportSlideSpec.
 * ExportOperation frames are in 960×540-basis pixels (specFrameToPx converts
 * them to the output resolution). An optional `crop` viewBox can be passed to
 * clip the SVG output to a sub-region (e.g. for copy-as-image of selected nodes).
 *
 * Exported for unit testing; use `exportDeckRasterBrowser` / `renderSelectedNodesToPngBlob`
 * for live browser exports.
 */
export function buildSvgFromSlideSpec(
  spec: ExportSlideSpec,
  canvas: CanvasSpec,
  dims: RasterSlideDimensions,
  crop?: {
    viewBoxX: number;
    viewBoxY: number;
    viewBoxW: number;
    viewBoxH: number;
  },
): string {
  const W = crop ? crop.viewBoxW : dims.widthPx;
  const H = crop ? crop.viewBoxH : dims.heightPx;
  const viewBox = crop
    ? `${crop.viewBoxX} ${crop.viewBoxY} ${crop.viewBoxW} ${crop.viewBoxH}`
    : `0 0 ${dims.widthPx} ${dims.heightPx}`;

  const defs: string[] = [];
  const bodies: string[] = [];

  // Background (full slide — viewBox clips it when cropping)
  const bgFill = renderSvgFill(spec.background.fill);
  if (bgFill.def) defs.push(bgFill.def);

  const bgFillSpec = spec.background.fill;
  if (bgFillSpec?.type === "image" && bgFillSpec.assetId) {
    bodies.push(
      `<image href="${xmlEsc(bgFillSpec.assetId)}" x="0" y="0" width="${dims.widthPx}" height="${dims.heightPx}" preserveAspectRatio="xMidYMid slice"/>`,
    );
  } else {
    bodies.push(
      `<rect x="0" y="0" width="${dims.widthPx}" height="${dims.heightPx}" fill="${xmlEsc(bgFill.attr)}"/>`,
    );
  }

  // Operations sorted by zIndex (already sorted by buildExportSpec)
  const sorted = [...spec.operations].sort(
    (a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0),
  );
  for (const op of sorted) {
    let result: { defs: string; body: string } | null = null;
    if (op.type === "text") result = renderSvgText(op, dims);
    else if (op.type === "shape") result = renderSvgShape(op, dims);
    else if (op.type === "image") result = renderSvgImage(op, dims);
    else if (op.type === "connector") result = renderSvgConnector(op, dims);
    else if (op.type === "tableShape") result = renderSvgTableShape(op, dims);
    else if (op.type === "visual" && op.assetId) {
      // Render visual as image if it has a resolved asset
      result = renderSvgImage(
        { ...op, type: "image" } as Extract<ExportOperation, { type: "image" }>,
        dims,
      );
    } else if (op.type === "visual") {
      result = renderSvgVisualPlaceholder(op, dims);
    }
    if (result) {
      if (result.defs) defs.push(result.defs);
      bodies.push(result.body);
    }
  }

  const defsBlock = defs.length > 0 ? `<defs>${defs.join("\n")}</defs>\n` : "";
  void canvas; // canvas is reserved for future per-canvas settings
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${viewBox}">\n${defsBlock}${bodies.join("\n")}\n</svg>`;
}

function rasterVisualFallbackDiagnostics(exportSpec: ExportDeckSpec) {
  return exportSpec.slides.flatMap((slide) =>
    slide.operations.flatMap((op) => {
      if (op.type !== "visual" || op.assetId) return [];
      return [
        makeDiagnostic(
          "unsupported-export-feature",
          "warning",
          `Raster export rendered a visual placeholder because no rendered asset was available for ${op.visualId ?? op.id}.`,
          {
            category: "export",
            slideId: slide.id,
            nodeId: op.id,
            target: {
              scope: "export",
              exportFeature: "raster-visual-placeholder",
              slideId: slide.id,
              nodeId: op.id,
            },
            details: {
              ...(op.visualId !== undefined ? { visualId: op.visualId } : {}),
              ...(op.assetId !== undefined ? { assetId: op.assetId } : {}),
            },
          },
        ),
      ];
    }),
  );
}

/* node:coverage ignore next 33 */
export async function exportDeckRasterBrowser(
  deck: Deck,
  themePackage?: ThemePackageV1,
  options: Omit<ExportDeckRasterOptions, "themePackage"> = {},
): Promise<RasterExportResult> {
  const resolvedThemePackage =
    themePackage ?? resolveThemePackageForDeck(deck).package;
  const renderTree = resolveDeckRenderTree(deck, resolvedThemePackage);
  const dimensions = resolveRasterSlideDimensions(deck, options.widthPx);

  await loadSlideFonts();

  // Build the v7 export spec (same pipeline as PPTX, but we render to native SVG).
  // resolveExportSpecAssetSources rewrites assetId fields to resolved URLs so
  // <image href> elements contain /api/slide-assets/... URLs that inlineSvgImageSources
  // will then fetch and replace with data: URIs to prevent canvas taint.
  const rawExportSpec = buildExportSpec(renderTree);
  const exportSpec = resolveExportSpecAssetSources(
    deck,
    rawExportSpec,
    resolvedThemePackage,
  );

  const pngs: RasterPngOutput[] = [];
  for (let i = 0; i < renderTree.slides.length; i++) {
    const slide = renderTree.slides[i]!;
    const slideSpec = exportSpec.slides[i];
    if (!slideSpec) continue;
    // Build a foreignObject-free SVG string from the resolved spec.
    const svgString = buildSvgFromSlideSpec(slideSpec, deck.canvas, dimensions);
    // Inline any remaining /api/... image hrefs as data URIs.
    const inlined = await inlineSvgImageSources(svgString);
    pngs.push({
      slideId: slide.id,
      dataUrl: await drawSvgToPngDataUrl(inlined, dimensions),
    });
  }

  return {
    pngs,
    diagnostics: [
      ...exportSpec.diagnostics,
      ...rasterVisualFallbackDiagnostics(exportSpec),
    ],
    ...(await buildRasterPdfFromPngs(pngs, dimensions)),
  };
}
