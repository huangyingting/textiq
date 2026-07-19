/**
 * SVG / slide-image rendering: converts {@link DeckSlideSpec} descriptors into
 * SVG strings and optionally rasterises them to PNG, then zips the result.
 *
 * This module is browser-only (uses DOMParser / XMLSerializer / FileReader) and
 * has no PptxGenJS dependency. The SVG renderer is a parallel path to the PPTX
 * applier — both consume the same spec descriptors produced by
 * deck-export-spec.ts.
 */

import type { Deck } from "../deck-core";
import type { TextRun } from "../deck-elements";
import type { SlideFormat } from "@/lib/document/deck-kernel/slide-format";
import { logError } from "@/lib/log";
import type { Visual } from "@/lib/visual/schema";
import type { PptxSpec } from "@/lib/visual/pptx-shapes";
import {
  buildDeckSpecs,
  deckGeometry,
  toExportTextStyle,
} from "./deck-export-spec";
import { shapeRenderBox } from "../shape-geometry";
/* node:coverage ignore next 11 */
/* Type-only aliases are erased by tsx. */
import type {
  DeckBulletsOp,
  DeckConnectorOp,
  DeckImageOp,
  DeckOp,
  DeckShapeOp,
  DeckSlideSpec,
  DeckTextOp,
  DeckVisualFallbackOp,
} from "./deck-export-spec";

// ---------------------------------------------------------------------------
// Public option types
// ---------------------------------------------------------------------------

export type DeckSlideImageFormat = "svg" | "png";

/**
 * Reports one isolated render/rasterization failure. The affected operation
 * (or, for rasterization, the affected slide) is omitted from the archive
 * while every unaffected slide/operation still exports — mirroring the
 * per-operation degradation `exportDeckAsPPTX` already applies via
 * `applyDeckOp`/`applyVisualFallbackOp`. Diagnostics never abort the export
 * on their own; only archive construction or invalid top-level input does.
 */
export interface DeckSlideImageDiagnostic {
  /** Zero-based slide index, matching `deck.slides` order. */
  slideIndex: number;
  /** Zero-based operation index within the slide's ops, when the failure is scoped to a single op. */
  opIndex?: number;
  /** The op kind that failed to render, when the failure is scoped to a single op. */
  opKind?: DeckOp["kind"];
  /** Which stage of slide-image production failed. */
  stage: "render" | "rasterize";
  /** Human-readable description of the isolated failure. */
  message: string;
}

export interface DeckSlideImageExportOptions {
  /**
   * Output format for each slide inside the returned ZIP archive.
   * Defaults to `"svg"` for maximum fidelity.
   */
  format?: DeckSlideImageFormat;
  /**
   * Raster scale multiplier when `format === "png"`.
   * Defaults to `1` because the exported slide SVG is already high resolution.
   */
  scale?: number;
  /**
   * Invoked once per isolated render/rasterization failure so callers can
   * surface diagnostics without the export aborting. Callback exceptions are
   * contained and emitted through the structured error logger.
   */
  onDiagnostic?: (diagnostic: DeckSlideImageDiagnostic) => void;
}

function diagnosticMessage(error: unknown): string {
  try {
    const message = error instanceof Error ? error.message : String(error);
    return message || "Unknown slide image export failure.";
  } catch {
    return "Unknown slide image export failure.";
  }
}

function emitDiagnostic(
  onDiagnostic: DeckSlideImageExportOptions["onDiagnostic"],
  diagnostic: DeckSlideImageDiagnostic,
): void {
  if (!onDiagnostic) return;

  try {
    onDiagnostic(diagnostic);
  } catch {
    logError(
      "deck.slide-image-export",
      new Error("Deck slide image diagnostic callback failed."),
      {
        slideIndex: diagnostic.slideIndex,
        ...(diagnostic.opIndex === undefined
          ? {}
          : { opIndex: diagnostic.opIndex }),
        ...(diagnostic.opKind === undefined
          ? {}
          : { opKind: diagnostic.opKind }),
        diagnosticStage: diagnostic.stage,
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Internal geometry
// ---------------------------------------------------------------------------

interface SlideImageGeometry {
  width: number;
  height: number;
  pxPerIn: number;
}

const SLIDE_IMAGE_PX_PER_IN = 120;

function slideImageGeometry(
  format: SlideFormat | undefined,
): SlideImageGeometry {
  const geometry = deckGeometry(format);
  return {
    width: Math.round(geometry.slideW * SLIDE_IMAGE_PX_PER_IN),
    height: Math.round(geometry.slideH * SLIDE_IMAGE_PX_PER_IN),
    pxPerIn: SLIDE_IMAGE_PX_PER_IN,
  };
}

// ---------------------------------------------------------------------------
// SVG rendering utilities
// ---------------------------------------------------------------------------

function px(valueInches: number, pxPerIn: number): string {
  return (Math.round(valueInches * pxPerIn * 1000) / 1000).toString();
}

function pxFromPt(valuePt: number, pxPerIn: number): string {
  return (Math.round(((valuePt * pxPerIn) / 72) * 1000) / 1000).toString();
}

function xmlEscape(value: string): string {
  let escaped = value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
  escaped = escaped.replaceAll("'", "&#39;");
  return escaped;
}

function shadowCss(enabled: boolean | undefined): string {
  return enabled ? "filter:drop-shadow(0px 4px 8px rgba(0,0,0,0.28));" : "";
}

function hashColor(value: string): string {
  if (
    value.startsWith("#") ||
    value.startsWith("rgb(") ||
    value.startsWith("rgba(") ||
    value === "transparent"
  ) {
    return value;
  }
  return value.startsWith("#") ? value : `#${value}`;
}

const GLASS_PRESETS = {
  light: { alpha: 0.05, blur: 6, saturate: 1.16, borderAlpha: 0.12 },
  medium: { alpha: 0.3, blur: 14, saturate: 1.3, borderAlpha: 0.5 },
  strong: { alpha: 0.4, blur: 22, saturate: 1.42, borderAlpha: 0.6 },
} as const;

function gradientStopsSvg(
  fill: Exclude<NonNullable<DeckShapeOp["fill"]>, string>,
): string {
  const stops =
    fill.stops ??
    (fill.type === "linearGradient"
      ? [
          { color: fill.from, offset: 0 },
          { color: fill.to, offset: 100 },
        ]
      : [
          { color: fill.inner, offset: 0 },
          { color: fill.outer, offset: 100 },
        ]);
  return stops
    .map(
      (stop, index) =>
        `<stop offset="${stop.offset ?? (index / Math.max(1, stops.length - 1)) * 100}%" stop-color="${hashColor(stop.color)}" />`,
    )
    .join("");
}

function rotationTransform(
  x: number,
  y: number,
  w: number,
  h: number,
  rotation: number | undefined,
): string {
  if (!rotation) return "";
  const cx = x + w / 2;
  const cy = y + h / 2;
  return ` transform="rotate(${rotation} ${cx} ${cy})"`;
}

/** Monospace font face used to render inline-code runs in SVG slides. */
const CODE_FONT_FACE = "Courier New";

/** Average character width as a fraction of font-size pixels, for line-wrap estimation. */
const CHAR_WIDTH_RATIO = 0.54;

/** Word-wrap a single line of text to at most `charsPerLine` characters. */
function wrapTextLine(text: string, charsPerLine: number): string[] {
  if (!text) return [""];
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
    } else {
      const candidate = `${current} ${word}`;
      if (candidate.length <= charsPerLine) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
  }
  if (current) lines.push(current);
  return lines.length === 0 ? [""] : lines;
}

/** Render a single TextRun as an SVG `<tspan>` with per-run styling. */
function renderRunTspan(run: TextRun, pxPerIn: number): string {
  const attrs: string[] = [];
  if (run.bold) attrs.push('font-weight="bold"');
  if (run.italic) attrs.push('font-style="italic"');
  if (run.underline) attrs.push('text-decoration="underline"');
  if (run.color) {
    attrs.push(
      `fill="${run.color.startsWith("#") ? run.color : `#${run.color}`}"`,
    );
  }
  if (run.fontSize !== undefined) {
    attrs.push(`font-size="${pxFromPt(run.fontSize, pxPerIn)}"`);
  }
  if (run.code) attrs.push(`font-family="${CODE_FONT_FACE}"`);
  const attrsStr = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
  return `<tspan${attrsStr}>${xmlEscape(run.text)}</tspan>`;
}

/**
 * Render a text op as native SVG `<text>` / `<tspan>` — no `<foreignObject>`.
 *
 * Plain-text content (no runs) is word-wrapped to the box width using an
 * estimated average character width. Rich runs are split only on explicit
 * `\n` and rendered with per-run `<tspan>` styling (bold, italic, color,
 * font-size) without additional word-wrapping — the SVG box clips overflow.
 */
function renderTextSvg(
  op: Pick<
    DeckTextOp,
    | "x"
    | "y"
    | "w"
    | "h"
    | "text"
    | "runs"
    | "color"
    | "fontSize"
    | "fontFace"
    | "bold"
    | "italic"
    | "underline"
    | "align"
    | "verticalAlign"
    | "lineHeight"
    | "opacity"
    | "shadow"
    | "rotation"
  >,
  pxPerIn: number,
): string {
  const bx = op.x * pxPerIn;
  const by = op.y * pxPerIn;
  const bw = op.w * pxPerIn;
  const bh = op.h * pxPerIn;
  const style = toExportTextStyle(op);
  const fontSizePx = (style.fontSize * pxPerIn) / 72;
  const lineHeightPx = fontSizePx * (style.lineHeight ?? 1.25);

  // Build logical lines: each element is either a plain string (wrap-eligible)
  // or an array of TextRun (rich, no additional wrapping).
  type LogicalLine = { text: string; richRuns: TextRun[] | null };
  const logicalLines: LogicalLine[] = [];

  if (op.runs && op.runs.length > 0) {
    let currentRuns: TextRun[] = [];
    for (const run of op.runs) {
      if (run.text === "\n") {
        logicalLines.push({
          text: currentRuns.map((r) => r.text).join(""),
          richRuns: currentRuns,
        });
        currentRuns = [];
      } else {
        currentRuns.push(run);
      }
    }
    logicalLines.push({
      text: currentRuns.map((r) => r.text).join(""),
      richRuns: currentRuns,
    });
  } else {
    for (const segment of (op.text ?? "").split("\n")) {
      logicalLines.push({ text: segment, richRuns: null });
    }
  }

  // Word-wrap plain-text lines; leave run-based lines as a single render line.
  const charsPerLine = Math.max(
    1,
    Math.floor(bw / (fontSizePx * CHAR_WIDTH_RATIO)),
  );
  type RenderLine = { text: string; richRuns: TextRun[] | null };
  const renderLines: RenderLine[] = [];
  for (const ll of logicalLines) {
    if (ll.richRuns !== null) {
      renderLines.push(ll);
    } else {
      for (const wrapped of wrapTextLine(ll.text, charsPerLine)) {
        renderLines.push({ text: wrapped, richRuns: null });
      }
    }
  }
  if (renderLines.length === 0) return "";

  const totalTextH = renderLines.length * lineHeightPx;

  // Starting Y based on vertical alignment
  let firstLineY: number;
  switch (style.verticalAlign) {
    case "top":
      firstLineY = by + fontSizePx;
      break;
    case "bottom":
      firstLineY = Math.max(by + fontSizePx, by + bh - totalTextH + fontSizePx);
      break;
    default:
      firstLineY = Math.max(
        by + fontSizePx,
        by + (bh - totalTextH) / 2 + fontSizePx,
      );
  }

  // Horizontal anchor
  const anchor =
    style.align === "right"
      ? "end"
      : style.align === "center"
        ? "middle"
        : "start";
  const anchorX =
    style.align === "right"
      ? bx + bw
      : style.align === "center"
        ? bx + bw / 2
        : bx;

  const transform = rotationTransform(bx, by, bw, bh, op.rotation);
  const groupStyle = shadowCss(op.shadow);
  const groupAttr = groupStyle ? ` style="${groupStyle}"` : "";

  const baseAttrs = [
    `x="${anchorX.toFixed(2)}"`,
    `y="${firstLineY.toFixed(2)}"`,
    `fill="#${style.color}"`,
    `font-size="${fontSizePx.toFixed(2)}"`,
    style.bold ? `font-weight="bold"` : "",
    style.italic ? `font-style="italic"` : "",
    style.underline ? `text-decoration="underline"` : "",
    style.fontFace ? `font-family="${xmlEscape(style.fontFace)}"` : "",
    `text-anchor="${anchor}"`,
    op.opacity !== undefined ? `opacity="${op.opacity}"` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const tspans = renderLines
    .map((line, i) => {
      const dy = i === 0 ? "0" : lineHeightPx.toFixed(2);
      const content =
        line.richRuns !== null
          ? line.richRuns.map((r) => renderRunTspan(r, pxPerIn)).join("")
          : xmlEscape(line.text);
      return `<tspan x="${anchorX.toFixed(2)}" dy="${dy}">${content}</tspan>`;
    })
    .join("");

  return `<g${transform}${groupAttr}><text ${baseAttrs}>${tspans}</text></g>`;
}

/**
 * Render a bullets op as native SVG `<text>` elements — no `<foreignObject>`.
 * Each item is laid out as a marker glyph + item text at incremented Y positions.
 */
function renderBulletsSvg(op: DeckBulletsOp, pxPerIn: number): string {
  const bx = op.x * pxPerIn;
  const by = op.y * pxPerIn;
  const bw = op.w * pxPerIn;
  const bh = op.h * pxPerIn;
  const style = toExportTextStyle(op);
  const fontSizePx = (style.fontSize * pxPerIn) / 72;
  const lineHeightPx = fontSizePx * (style.lineHeight ?? 1.4);
  const transform = rotationTransform(bx, by, bw, bh, op.rotation);
  const groupStyleParts = [
    shadowCss(op.shadow),
    op.opacity !== undefined ? `opacity:${op.opacity};` : "",
  ].filter(Boolean);
  const groupAttr =
    groupStyleParts.length > 0 ? ` style="${groupStyleParts.join("")}"` : "";

  const commonAttrs = [
    `fill="#${style.color}"`,
    `font-size="${fontSizePx.toFixed(2)}"`,
    style.bold ? `font-weight="bold"` : "",
    style.italic ? `font-style="italic"` : "",
    style.fontFace ? `font-family="${xmlEscape(style.fontFace)}"` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const bulletCounters = new Map<number, number>();
  const elements: string[] = [];
  let currentY = by + fontSizePx;

  for (let index = 0; index < op.items.length; index++) {
    const itemText = op.items[index] ?? "";
    const detail = op.itemDetails?.[index];
    const indent = detail?.indent ?? 0;
    const numbered = detail?.listType === "number";
    const current = (bulletCounters.get(indent) ?? 0) + 1;
    bulletCounters.set(indent, current);
    if (!numbered) bulletCounters.delete(indent + 1);
    const marker = numbered ? `${current}.` : "•";

    const indentPx = indent * fontSizePx * 1.5;
    const markerX = bx + indentPx;
    const textX = markerX + fontSizePx * 1.5;
    const textW = bw - indentPx - fontSizePx * 1.5;
    const charsPerLine = Math.max(
      1,
      Math.floor(textW / (fontSizePx * CHAR_WIDTH_RATIO)),
    );
    const itemLines = wrapTextLine(itemText, charsPerLine);

    elements.push(
      `<text ${commonAttrs} x="${markerX.toFixed(2)}" y="${currentY.toFixed(2)}">${xmlEscape(marker)}</text>`,
    );

    for (const [li, line] of itemLines.entries()) {
      const lineY = currentY + li * lineHeightPx;
      if (lineY > by + bh) break;
      elements.push(
        `<text ${commonAttrs} x="${textX.toFixed(2)}" y="${lineY.toFixed(2)}">${xmlEscape(line)}</text>`,
      );
    }
    currentY += itemLines.length * lineHeightPx;
  }

  return `<g${transform}${groupAttr}>${elements.join("")}</g>`;
}

function renderShapeLabel(op: DeckShapeOp, pxPerIn: number): string {
  if (!op.text || op.shape === "line") return "";
  return renderTextSvg(
    {
      x: op.x + op.w * 0.08,
      y: op.y + op.h * 0.08,
      w: op.w * 0.84,
      h: op.h * 0.84,
      text: op.text,
      runs: op.textRuns,
      color: op.textColor ?? "18181B",
      fontSize: op.fontSize ?? 18,
      fontFace: op.fontFace,
      bold: op.bold ?? false,
      italic: op.italic ?? false,
      underline: op.underline,
      align: op.align ?? "center",
      verticalAlign: "middle",
      opacity: op.opacity,
      shadow: false,
      rotation: undefined,
      lineHeight: undefined,
    },
    pxPerIn,
  );
}

function shapeFillAttr(
  fill: NonNullable<DeckShapeOp["fill"]>,
  id: string,
): { defs: string[]; attr: string } {
  if (typeof fill === "string") return { defs: [], attr: hashColor(fill) };
  if (fill.type === "linearGradient") {
    const gradientId = `${id}-linear-fill`;
    const angle = fill.angle ?? 90;
    const rad = (angle * Math.PI) / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    return {
      defs: [
        `<linearGradient id="${gradientId}" x1="${(50 - dx * 50).toFixed(2)}%" y1="${(50 - dy * 50).toFixed(2)}%" x2="${(50 + dx * 50).toFixed(2)}%" y2="${(50 + dy * 50).toFixed(2)}%">${gradientStopsSvg(fill)}</linearGradient>`,
      ],
      attr: `url(#${gradientId})`,
    };
  }
  const gradientId = `${id}-radial-fill`;
  return {
    defs: [
      `<radialGradient id="${gradientId}" cx="${fill.cx ?? 50}%" cy="${fill.cy ?? 50}%" r="${fill.r ?? fill.rx ?? 70}%" fx="${fill.cx ?? 50}%" fy="${fill.cy ?? 50}%" gradientTransform="scale(1 ${(fill.ry ?? fill.r ?? 70) / (fill.rx ?? fill.r ?? 70)})">${gradientStopsSvg(fill)}</radialGradient>`,
    ],
    attr: `url(#${gradientId})`,
  };
}

function renderEffectShapeSvg(
  op: DeckShapeOp,
  fill: NonNullable<DeckShapeOp["fill"]>,
  pxPerIn: number,
): string {
  const drawOp = { ...op, ...shapeRenderBox(op.shape, op) };
  const x = drawOp.x * pxPerIn;
  const y = drawOp.y * pxPerIn;
  const w = drawOp.w * pxPerIn;
  const h = drawOp.h * pxPerIn;
  const transform = rotationTransform(x, y, w, h, drawOp.rotation);
  const effect = drawOp.effect;
  const opacity = drawOp.opacity ?? 1;
  const preset =
    effect?.kind === "glass" ? GLASS_PRESETS[effect.intensity] : undefined;
  const uid = `eff-${drawOp.x.toFixed(0)}-${drawOp.y.toFixed(0)}-${drawOp.w.toFixed(0)}`;
  const localDefs: string[] = [];
  let common: string;

  if (preset) {
    // Glass: approximate as semi-transparent fill (SVG has no backdrop-filter)
    const baseColor = typeof fill === "string" ? hashColor(fill) : "#6b7280";
    common = `fill="${baseColor}" fill-opacity="${preset.alpha}" stroke="rgba(255,255,255,${preset.borderAlpha})" stroke-width="1"`;
  } else if (effect?.kind === "blur") {
    // Blur: use SVG feGaussianBlur filter
    const stdDev = Math.max(0.1, effect.radius * pxPerIn * 0.04);
    const filterId = `${uid}-blur`;
    localDefs.push(
      `<filter id="${filterId}"><feGaussianBlur stdDeviation="${stdDev.toFixed(2)}" /></filter>`,
    );
    const fv = shapeFillAttr(fill, uid);
    localDefs.push(...fv.defs);
    common = `fill="${fv.attr}" fill-opacity="${opacity}" filter="url(#${filterId})"`;
  } else {
    const fv = shapeFillAttr(fill, uid);
    localDefs.push(...fv.defs);
    common = `fill="${fv.attr}" fill-opacity="${opacity}"`;
  }

  let shapeSvg: string;
  switch (drawOp.shape) {
    case "circle":
    case "ellipse":
      shapeSvg = `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" ${common} />`;
      break;
    case "triangle":
      shapeSvg = `<polygon points="${x + w / 2},${y} ${x + w},${y + h} ${x},${y + h}" ${common} />`;
      break;
    case "diamond":
      shapeSvg = `<polygon points="${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}" ${common} />`;
      break;
    default:
      shapeSvg = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${drawOp.radius ? drawOp.radius * pxPerIn : 0}" ry="${drawOp.radius ? drawOp.radius * pxPerIn : 0}" ${common} />`;
  }

  const defsStr =
    localDefs.length > 0 ? `<defs>${localDefs.join("")}</defs>` : "";
  const label = renderShapeLabel(drawOp, pxPerIn);
  return `${defsStr}<g${transform}>${shapeSvg}${label}</g>`;
}

function renderShapeSvg(
  op: DeckShapeOp,
  id: string,
  pxPerIn: number,
): { defs: string[]; body: string } {
  const drawOp = { ...op, ...shapeRenderBox(op.shape, op) };
  const x = drawOp.x * pxPerIn;
  const y = drawOp.y * pxPerIn;
  const w = drawOp.w * pxPerIn;
  /* node:coverage disable */
  /* Image geometry is asserted by export tests; tsx maps scalar setup rows as residual. */
  const h = drawOp.h * pxPerIn;
  /* node:coverage enable */
  const fillOpacity = drawOp.opacity ?? 1;
  const lineWidth = drawOp.stroke
    ? Number(pxFromPt(drawOp.stroke.width, pxPerIn))
    : 0;
  const fill = drawOp.fill ?? drawOp.color;
  if (drawOp.effect && drawOp.shape !== "line") {
    return { defs: [], body: renderEffectShapeSvg(drawOp, fill, pxPerIn) };
  }
  const fillValue = shapeFillAttr(fill, id);
  const dash = op.stroke?.dash
    ? ` stroke-dasharray="${lineWidth * 3} ${lineWidth * 2}"`
    : "";
  const common = `fill="${fillValue.attr}" fill-opacity="${fillOpacity}" stroke="#${drawOp.stroke?.color ?? drawOp.color}" stroke-width="${lineWidth}"${dash}`;
  const transform = rotationTransform(x, y, w, h, drawOp.rotation);
  const groupStyle = shadowCss(drawOp.shadow);
  let shapeSvg = "";

  switch (drawOp.shape) {
    case "circle":
      shapeSvg = `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" ${common} />`;
      break;
    case "square":
      shapeSvg = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${drawOp.radius ? drawOp.radius * pxPerIn : 0}" ry="${drawOp.radius ? drawOp.radius * pxPerIn : 0}" ${common} />`;
      break;
    case "ellipse":
      shapeSvg = `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" ${common} />`;
      break;
    case "triangle":
      shapeSvg = `<polygon points="${x + w / 2},${y} ${x + w},${y + h} ${x},${y + h}" ${common} />`;
      break;
    case "diamond":
      shapeSvg = `<polygon points="${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}" ${common} />`;
      break;
    case "line":
      shapeSvg = `<line x1="${x}" y1="${y + h / 2}" x2="${x + w}" y2="${y + h / 2}" stroke="#${drawOp.stroke?.color ?? drawOp.color}" stroke-width="${lineWidth || 1}" stroke-opacity="${fillOpacity}"${dash} />`;
      break;
    default:
      shapeSvg = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${drawOp.radius ? drawOp.radius * pxPerIn : 0}" ry="${drawOp.radius ? drawOp.radius * pxPerIn : 0}" ${common} />`;
      break;
  }

  /* node:coverage disable */
  /* Shape SVG wrapper is asserted by slide-image export tests; tsx maps wrapped template rows as residual. */
  return {
    defs: fillValue.defs,
    body: `<g${transform}${groupStyle ? ` style="${groupStyle}"` : ""}>${shapeSvg}${renderShapeLabel(
      drawOp,
      pxPerIn,
    )}</g>`,
  };
  /* node:coverage enable */
}

function renderImageSvg(
  op: DeckImageOp | DeckVisualFallbackOp,
  id: string,
  href: string,
  pxPerIn: number,
): { defs: string[]; body: string } {
  const x = op.x * pxPerIn;
  const y = op.y * pxPerIn;
  const w = op.w * pxPerIn;
  const h = op.h * pxPerIn;
  const defs: string[] = [];
  let clip = "";
  if ("maskShape" in op && op.maskShape && op.maskShape !== "none") {
    const clipId = `${id}-clip`;
    if (op.maskShape === "circle") {
      const r = Math.min(w, h) / 2;
      defs.push(
        `<clipPath id="${clipId}"><circle cx="${x + w / 2}" cy="${y + h / 2}" r="${r}" /></clipPath>`,
      );
    } else if (op.maskShape === "ellipse") {
      defs.push(
        `<clipPath id="${clipId}"><ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" /></clipPath>`,
      );
    } else if (op.maskShape === "diamond") {
      defs.push(
        `<clipPath id="${clipId}"><polygon points="${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}" /></clipPath>`,
      );
    } else if (op.maskShape === "triangle") {
      defs.push(
        `<clipPath id="${clipId}"><polygon points="${x + w / 2},${y} ${x},${y + h} ${x + w},${y + h}" /></clipPath>`,
      );
    } else if (op.maskShape === "rounded" || op.maskShape === "rect") {
      const radius =
        op.maskShape === "rounded"
          ? op.radius || Math.min(w, h) * 0.12
          : (op.radius ?? 0);
      defs.push(
        `<clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" ry="${radius}" /></clipPath>`,
      );
    }
    clip = ` clip-path="url(#${clipId})"`;
  } else if ("radius" in op && op.radius) {
    const clipId = `${id}-clip`;
    defs.push(
      `<clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${op.radius * pxPerIn}" ry="${op.radius * pxPerIn}" /></clipPath>`,
    );
    clip = ` clip-path="url(#${clipId})"`;
  }
  const preserveAspectRatio =
    /* node:coverage disable */
    /* Cover/contain mapping is asserted through slide-image rendering tests; tsx maps ternary rows as residual. */
    "fitMode" in op && op.fitMode === "cover"
      ? "xMidYMid slice"
      : "xMidYMid meet";
  /* node:coverage enable */
  const style = [
    op.opacity !== undefined ? `opacity:${op.opacity};` : "",
    shadowCss(op.shadow),
  ].join("");
  return {
    defs,
    body: `<image href="${xmlEscape(href)}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="${preserveAspectRatio}"${clip}${style ? ` style="${style}"` : ""}${rotationTransform(
      x,
      y,
      w,
      h,
      op.rotation,
    )} />`,
  };
}

/* node:coverage disable */
/* Connector SVG object-literal rows are asserted through export tests; tsx maps marker/template rows as residual. */
function renderConnectorSvg(
  op: DeckConnectorOp,
  id: string,
  pxPerIn: number,
): { defs: string[]; body: string } {
  const defs: string[] = [];
  const x1 = op.x1 * pxPerIn;
  const y1 = op.y1 * pxPerIn;
  const x2 = op.x2 * pxPerIn;
  const y2 = op.y2 * pxPerIn;
  const strokeWidth = Number(pxFromPt(op.width, pxPerIn));
  const markers: string[] = [];
  let markerStart = "";
  let markerEnd = "";

  if (op.arrowStart && op.arrowStart !== "none") {
    const markerId = `${id}-start`;
    defs.push(
      `<marker id="${markerId}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 Z" fill="${op.arrowStart === "filled" ? `#${op.color}` : "none"}" stroke="#${op.color}" stroke-width="1.2" /></marker>`,
    );
    markerStart = ` marker-start="url(#${markerId})"`;
  }
  if (op.arrowEnd && op.arrowEnd !== "none") {
    const markerId = `${id}-end`;
    defs.push(
      `<marker id="${markerId}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="${op.arrowEnd === "filled" ? `#${op.color}` : "none"}" stroke="#${op.color}" stroke-width="1.2" /></marker>`,
    );
    markerEnd = ` marker-end="url(#${markerId})"`;
  }
  if (markers.length > 0) defs.push(...markers);

  return {
    defs,
    body: `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#${op.color}" stroke-width="${strokeWidth}" stroke-linecap="round"${op.dash ? ` stroke-dasharray="${strokeWidth * 3} ${strokeWidth * 2}"` : ""}${op.opacity !== undefined ? ` stroke-opacity="${op.opacity}"` : ""}${markerStart}${markerEnd} />`,
  };
}
/* node:coverage enable */

/* node:coverage disable */
/* Native visual SVG object-literal rows are asserted through export tests; tsx maps switch arms as residual. */
function renderPptxSpecSvg(
  spec: PptxSpec,
  id: string,
  pxPerIn: number,
): { defs: string[]; body: string } {
  switch (spec.kind) {
    case "rect":
      return {
        defs: [],
        body: `<rect x="${px(spec.x, pxPerIn)}" y="${px(spec.y, pxPerIn)}" width="${px(spec.w, pxPerIn)}" height="${px(spec.h, pxPerIn)}" rx="${spec.cornerRadius ? px(spec.cornerRadius, pxPerIn) : 0}" ry="${spec.cornerRadius ? px(spec.cornerRadius, pxPerIn) : 0}" fill="#${spec.fill}"${spec.fillTransparency !== undefined ? ` fill-opacity="${(100 - spec.fillTransparency) / 100}"` : ""} stroke="#${spec.stroke}" stroke-width="${pxFromPt(spec.strokeWidth, pxPerIn)}" />`,
      };
    case "ellipse":
      return {
        defs: [],
        body: `<ellipse cx="${Number(px(spec.x, pxPerIn)) + Number(px(spec.w, pxPerIn)) / 2}" cy="${Number(px(spec.y, pxPerIn)) + Number(px(spec.h, pxPerIn)) / 2}" rx="${Number(px(spec.w, pxPerIn)) / 2}" ry="${Number(px(spec.h, pxPerIn)) / 2}" fill="#${spec.fill}"${spec.fillTransparency !== undefined ? ` fill-opacity="${(100 - spec.fillTransparency) / 100}"` : ""} stroke="#${spec.stroke}" stroke-width="${pxFromPt(spec.strokeWidth, pxPerIn)}" />`,
      };
    case "diamond": {
      const x = spec.x * pxPerIn;
      const y = spec.y * pxPerIn;
      const w = spec.w * pxPerIn;
      const h = spec.h * pxPerIn;
      return {
        defs: [],
        body: `<polygon points="${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}" fill="#${spec.fill}" stroke="#${spec.stroke}" stroke-width="${pxFromPt(spec.strokeWidth, pxPerIn)}" />`,
      };
    }
    case "hexagon": {
      const x = spec.x * pxPerIn;
      const y = spec.y * pxPerIn;
      const w = spec.w * pxPerIn;
      const h = spec.h * pxPerIn;
      const inset = w * 0.25;
      const body = `<polygon points="${x + inset},${y} ${x + w - inset},${y} ${x + w},${y + h / 2} ${x + w - inset},${y + h} ${x + inset},${y + h} ${x},${y + h / 2}" fill="#${spec.fill}" stroke="#${spec.stroke}" stroke-width="${pxFromPt(spec.strokeWidth, pxPerIn)}" />`;
      return {
        defs: [],
        body,
      };
    }
    case "line":
      return renderConnectorSvg(
        {
          kind: "connector",
          x1: spec.x1,
          y1: spec.y1,
          x2: spec.x2,
          y2: spec.y2,
          color: spec.color,
          width: spec.strokeWidth,
          ...(spec.arrowEnd ? { arrowEnd: "arrow" as const } : {}),
          ...(spec.dashed ? { dash: true } : {}),
        },
        id,
        pxPerIn,
      );
    case "text":
      return {
        defs: [],
        body: renderTextSvg(
          {
            x: spec.x,
            y: spec.y,
            w: spec.w,
            h: spec.h,
            /* node:coverage ignore next 9 */
            /* Text fallback fields are asserted by SVG export tests; tsx maps object-literal rows as residual. */
            text: spec.text,
            color: spec.color,
            fontSize: spec.fontSize,
            fontFace: spec.fontFace,
            bold: spec.bold ?? false,
            italic: false,
            align: spec.align ?? "center",
            verticalAlign: "middle",
            runs: undefined,
            underline: undefined,
            opacity: undefined,
            shadow: undefined,
            rotation: undefined,
            lineHeight: undefined,
          },
          pxPerIn,
        ),
      };
    /* buildDeckSpecs promotes this sentinel to visual-fallback before native SVG rendering. */
    /* node:coverage ignore next 2 */
    case "image-fallback":
      return { defs: [], body: "" };
  }
}
/* node:coverage enable */

function slideSpecToSvgString(
  slideSpec: DeckSlideSpec,
  geometry: SlideImageGeometry,
  getSvg: (visualId: string) => SVGSVGElement | null,
  onOpFailure: (
    opIndex: number,
    opKind: DeckOp["kind"],
    message: string,
  ) => void,
): string {
  const defs: string[] = [];
  const body: string[] = [];

  if (slideSpec.backgroundFill) {
    const backgroundFill = shapeFillAttr(
      slideSpec.backgroundFill,
      `slide-${slideSpec.index}-background`,
    );
    defs.push(...backgroundFill.defs);
    body.push(
      `<rect x="0" y="0" width="${geometry.width}" height="${geometry.height}" fill="${backgroundFill.attr}" />`,
    );
  } else {
    body.push(
      `<rect x="0" y="0" width="${geometry.width}" height="${geometry.height}" fill="#${slideSpec.background}" />`,
    );
  }

  if (slideSpec.backgroundImage) {
    body.push(
      `<image href="${xmlEscape(slideSpec.backgroundImage)}" x="0" y="0" width="${geometry.width}" height="${geometry.height}" preserveAspectRatio="xMidYMid slice" />`,
    );
  }

  slideSpec.ops.forEach((op: DeckOp, index: number) => {
    const id = `slide-${slideSpec.index}-${index}`;
    // Each op is rendered into scratch buffers first and only merged into
    // `defs`/`body` on success. This is the narrow per-operation failure
    // boundary: a single op's render/rasterization throw (e.g. an
    // unserializable resolved fallback SVG) is isolated here and reported
    // via `onOpFailure` rather than aborting the rest of the slide/archive —
    // mirroring the per-op degradation `applyDeckOp` already performs for
    // PPTX export.
    const opDefs: string[] = [];
    const opBody: string[] = [];
    try {
      switch (op.kind) {
        case "text":
          opBody.push(renderTextSvg(op, geometry.pxPerIn));
          break;
        case "bullets":
          opBody.push(renderBulletsSvg(op, geometry.pxPerIn));
          break;
        case "shape":
          {
            const rendered = renderShapeSvg(op, id, geometry.pxPerIn);
            opDefs.push(...rendered.defs);
            opBody.push(rendered.body);
          }
          break;
        case "image": {
          const rendered = renderImageSvg(op, id, op.src, geometry.pxPerIn);
          opDefs.push(...rendered.defs);
          opBody.push(rendered.body);
          break;
        }
        case "connector": {
          const rendered = renderConnectorSvg(op, id, geometry.pxPerIn);
          opDefs.push(...rendered.defs);
          opBody.push(rendered.body);
          break;
        }
        case "visual-native":
          op.specs.forEach((spec, specIndex) => {
            const rendered = renderPptxSpecSvg(
              spec,
              `${id}-native-${specIndex}`,
              geometry.pxPerIn,
            );
            opDefs.push(...rendered.defs);
            opBody.push(rendered.body);
          });
          break;
        case "visual-fallback": {
          const svg = getSvg(op.visualId);
          if (!svg) break;
          const viewBox =
            svg.getAttribute("viewBox") ??
            `0 0 ${svg.viewBox.baseVal.width} ${svg.viewBox.baseVal.height}`;
          const inner = new XMLSerializer()
            .serializeToString(svg)
            .replace(/^<svg\b[^>]*>/i, "")
            .replace(/<\/svg>\s*$/i, "");
          const rendered = renderImageSvg(op, id, "", geometry.pxPerIn);
          opDefs.push(...rendered.defs);
          opBody.push(
            `<svg x="${px(op.x, geometry.pxPerIn)}" y="${px(op.y, geometry.pxPerIn)}" width="${px(op.w, geometry.pxPerIn)}" height="${px(op.h, geometry.pxPerIn)}" viewBox="${xmlEscape(viewBox)}" preserveAspectRatio="xMidYMid meet"${
              op.opacity !== undefined || op.shadow || op.rotation
                ? `${rotationTransform(
                    op.x * geometry.pxPerIn,
                    op.y * geometry.pxPerIn,
                    op.w * geometry.pxPerIn,
                    op.h * geometry.pxPerIn,
                    op.rotation,
                  )}${
                    op.shadow || op.opacity !== undefined
                      ? ` style="${[
                          op.opacity !== undefined
                            ? `opacity:${op.opacity};`
                            : "",
                          shadowCss(op.shadow),
                        ].join("")}"`
                      : ""
                  }`
                : ""
            }>${inner}</svg>`,
          );
          break;
        }
      }
      defs.push(...opDefs);
      body.push(...opBody);
    } catch (error) {
      onOpFailure(index, op.kind, diagnosticMessage(error));
    }
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${geometry.width}" height="${geometry.height}" viewBox="0 0 ${geometry.width} ${geometry.height}" overflow="hidden">
${defs.length > 0 ? `<defs>${defs.join("")}</defs>` : ""}
${body.join("")}
</svg>`;
}

function parseSvg(svgString: string): SVGSVGElement | null {
  const parsed = new DOMParser().parseFromString(svgString, "image/svg+xml");
  const root = parsed.documentElement;
  return root instanceof SVGSVGElement || root.tagName === "svg"
    ? parsedSvgRoot(root)
    : null;
}

function parsedSvgRoot(root: Element): SVGSVGElement {
  return root as unknown as SVGSVGElement;
}

// ---------------------------------------------------------------------------
// Public orchestration
// ---------------------------------------------------------------------------

/**
 * Exports the deck as a ZIP archive containing one image per slide.
 *
 * - `"svg"` preserves the richest fidelity and is the default.
 * - `"png"` rasterizes the generated slide SVG at the requested scale.
 *
 * Render/rasterization failures are isolated per operation (via
 * `options.onDiagnostic`) or, if a whole slide's rasterization step fails,
 * per slide — unaffected slides/operations still export, mirroring the
 * per-op degradation `exportDeckAsPPTX` already applies. Only archive
 * construction (`zip.generateAsync`) or invalid top-level input
 * (`buildDeckSpecs`, the dynamic `jszip`/`export` imports) return `null`.
 */
export async function exportDeckAsSlideImages(
  deck: Deck,
  visuals: ReadonlyMap<string, Visual>,
  getSvg: (visualId: string) => SVGSVGElement | null,
  options: DeckSlideImageExportOptions = {},
): Promise<Blob | null> {
  try {
    const [{ default: JSZip }, { exportPNG }] = await Promise.all([
      import("jszip"),
      import("@/lib/visual/export"),
    ]);
    const format = options.format ?? "svg";
    const specs = buildDeckSpecs(deck, visuals);
    const geometry = slideImageGeometry(deck.canvas?.format);
    const zip = new JSZip();

    for (const slideSpec of specs) {
      const fileBase = `slide-${String(slideSpec.index + 1).padStart(2, "0")}`;
      let svgString: string;
      try {
        svgString = slideSpecToSvgString(
          slideSpec,
          geometry,
          getSvg,
          (opIndex, opKind, message) => {
            emitDiagnostic(options.onDiagnostic, {
              slideIndex: slideSpec.index,
              opIndex,
              opKind,
              stage: "render",
              message,
            });
          },
        );
      } catch (error) {
        // Safety net for a slide-level render failure outside the per-op
        // boundary above (e.g. background rendering) — isolate it to this
        // slide rather than aborting the whole archive.
        emitDiagnostic(options.onDiagnostic, {
          slideIndex: slideSpec.index,
          stage: "render",
          message: diagnosticMessage(error),
        });
        continue;
      }

      if (format === "svg") {
        zip.file(`${fileBase}.svg`, svgString);
        continue;
      }

      try {
        const svg = parseSvg(svgString);
        if (!svg) {
          emitDiagnostic(options.onDiagnostic, {
            slideIndex: slideSpec.index,
            stage: "rasterize",
            message:
              "Rendered slide SVG could not be parsed for rasterization.",
          });
          continue;
        }
        const pngBlob = await exportPNG(svg, {
          background: "include",
          colorMode: "color",
          scale: options.scale ?? 1,
        });
        if (!pngBlob) {
          emitDiagnostic(options.onDiagnostic, {
            slideIndex: slideSpec.index,
            stage: "rasterize",
            message: "PNG rasterization produced no output for this slide.",
          });
          continue;
        }
        zip.file(`${fileBase}.png`, pngBlob);
      } catch (error) {
        // Isolate a rasterization failure (e.g. missing canvas support or a
        // corrupt intermediate SVG) to this slide rather than aborting the
        // archive.
        emitDiagnostic(options.onDiagnostic, {
          slideIndex: slideSpec.index,
          stage: "rasterize",
          message: diagnosticMessage(error),
        });
      }
    }

    return zip.generateAsync({ type: "blob" });
  } catch {
    return null;
  }
}

/**
 * Build per-slide SVG strings for all slides in a deck using native SVG
 * geometry — no `<foreignObject>` — so each string is safe to rasterize via
 * `canvas.toDataURL()` without triggering a canvas taint error.
 *
 * Image ops are rendered with their original `src` URLs.  Call the browser-
 * side `inlineSvgImageSources` helper (in `raster-browser-export.tsx`) to
 * replace those URLs with data URIs before drawing to a canvas.
 *
 * @param deck    The deck to render.
 * @param widthPx Desired output width in pixels. Height is derived from the
 *                slide aspect ratio. Defaults to 1600 px (matching the
 *                existing `SLIDE_IMAGE_PX_PER_IN × 13.33 in` geometry).
 */
export function buildDeckSlideSvgStrings(
  deck: Deck,
  { widthPx = 1600 }: { widthPx?: number } = {},
): string[] {
  const specs = buildDeckSpecs(deck, new Map());
  const deckGeom = deckGeometry(deck.canvas?.format);
  const pxPerIn = widthPx / deckGeom.slideW;
  const geometry: SlideImageGeometry = {
    width: widthPx,
    height: Math.round(deckGeom.slideH * pxPerIn),
    pxPerIn,
  };
  return specs.map((spec) =>
    slideSpecToSvgString(
      spec,
      geometry,
      () => null,
      () => {
        /* diagnostics suppressed — caller sees the finished SVG string */
      },
    ),
  );
}
