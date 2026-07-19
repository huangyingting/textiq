"use client";

import { buildExportSpec, buildSingleSlideExportSpec } from "./export-spec";
import { resolveExportSpecAssetSources } from "./pptx-appliers/asset-sources";
import type { ExportOperation, ExportSlideSpec } from "./export-spec-types";
import { loadSlideFonts } from "./slide-font-loading";
import { resolveDeckRenderTree } from "./render-resolver";
import type {
  ResolvedRenderNode,
  ResolvedSlideRenderTree,
} from "./render-tree";
import type { CanvasSpec } from "./types";
import type { Deck } from "./schema";
import type { FillStyle, ColorValue, TextStyle } from "./style-schema";
import type { ThemePackageV1 } from "./theme-package-schema";
import { resolveThemePackageForDeck } from "./theme-package-registry";
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
  const resolvedSpec = resolveExportSpecAssetSources(deck, singleDeckSpec);
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

const CHAR_WIDTH_RATIO_SVG = 0.54;

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

  // Collect all lines for vertical alignment
  const allLines: string[] = [];
  for (const para of op.content.paragraphs) {
    if (para.text.trim() === "" && para.runs === undefined) {
      allLines.push("");
      continue;
    }
    const lineText =
      para.runs
        ?.map((r) => r.text)
        .join("")
        .trimEnd() ?? para.text;
    for (const l of wrapSvgLine(lineText, w, fontSize)) allLines.push(l);
  }

  const totalH = allLines.length * lineH;
  const vAlign = ts.verticalAlign ?? "top";
  const startY =
    vAlign === "middle"
      ? y + (h - totalH) / 2 + fontSize
      : vAlign === "bottom"
        ? y + h - totalH + fontSize
        : y + fontSize;

  const rotation = op.rotation;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const transform = rotation
    ? ` transform="rotate(${rotation},${cx.toFixed(1)},${cy.toFixed(1)})"`
    : "";

  const body = allLines
    .map((line, i) => {
      const ly = (startY + i * lineH).toFixed(1);
      return `<text x="${textX.toFixed(1)}" y="${ly}" font-size="${fontSize.toFixed(1)}" fill="${xmlEsc(color)}" font-family="${xmlEsc(fontFamily)}" font-weight="${fontWeight}" font-style="${fontStyle}" text-anchor="${textAnchor}"${transform}>${xmlEsc(line)}</text>`;
    })
    .join("\n");

  return { defs: "", body };
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
  const rotation = op.rotation;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const transform = rotation
    ? ` transform="rotate(${rotation},${cx.toFixed(1)},${cy.toFixed(1)})"`
    : "";
  // op.assetId contains the resolved URL after resolveExportSpecAssetSources
  const href = xmlEsc(op.assetId);
  const body = `<image href="${href}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" preserveAspectRatio="xMidYMid meet"${transform}/>`;
  return { defs: "", body };
}

/** Render a connector operation as a native SVG <line> or <path>. */
function renderSvgConnector(
  op: Extract<ExportOperation, { type: "connector" }>,
  dims: RasterSlideDimensions,
): { defs: string; body: string } {
  const { x, y, w, h } = specFrameToPx(op.frame, dims);
  const stroke = op.style.stroke;
  const strokeColor = stroke ? svgColor(stroke.color, "#888888") : "#888888";
  const pxPerIn = dims.widthPx / dims.widthIn;
  const strokeW = stroke ? (stroke.widthPt * pxPerIn) / 72 : 1;
  const body = `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + w).toFixed(1)}" y2="${(y + h).toFixed(1)}" stroke="${xmlEsc(strokeColor)}" stroke-width="${strokeW.toFixed(1)}"/>`;
  return { defs: "", body };
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
    else if (op.type === "visual" && op.assetId) {
      // Render visual as image if it has a resolved asset
      result = renderSvgImage(
        { ...op, type: "image" } as Extract<ExportOperation, { type: "image" }>,
        dims,
      );
    }
    // tableShape and unresolved visuals: skip for now
    if (result) {
      if (result.defs) defs.push(result.defs);
      bodies.push(result.body);
    }
  }

  const defsBlock = defs.length > 0 ? `<defs>${defs.join("\n")}</defs>\n` : "";
  void canvas; // canvas is reserved for future per-canvas settings
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${viewBox}">\n${defsBlock}${bodies.join("\n")}\n</svg>`;
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
  const exportSpec = resolveExportSpecAssetSources(deck, rawExportSpec);

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
    diagnostics: exportSpec.diagnostics,
    ...(await buildRasterPdfFromPngs(pngs, dimensions)),
  };
}
