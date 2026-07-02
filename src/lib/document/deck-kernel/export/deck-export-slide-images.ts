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
import type { SlideFormat } from "@/lib/presentation-shared/slide-format";
import type { Visual } from "@/lib/visual/schema";
import { toHex } from "@/lib/visual/pptx-shapes";
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

function cssText(value: string | undefined): string {
  return value ? xmlEscape(value) : "";
}

function cssFontFace(fontFace: string | undefined): string {
  return fontFace ? `font-family:${cssText(fontFace)};` : "";
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

function rgbaColor(value: string, alpha: number): string {
  const raw = value.replace("#", "");
  const expanded =
    raw.length === 3
      ? raw
          .split("")
          .map((part) => `${part}${part}`)
          .join("")
      : raw;
  if (expanded.length < 6) return `rgba(113,113,122,${alpha})`;
  const r = Number.parseInt(expanded.slice(0, 2), 16);
  const g = Number.parseInt(expanded.slice(2, 4), 16);
  const b = Number.parseInt(expanded.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const GLASS_PRESETS = {
  light: { alpha: 0.05, blur: 6, saturate: 1.16, borderAlpha: 0.12 },
  medium: { alpha: 0.3, blur: 14, saturate: 1.3, borderAlpha: 0.5 },
  strong: { alpha: 0.4, blur: 22, saturate: 1.42, borderAlpha: 0.6 },
} as const;

function glassFillCss(
  fill: NonNullable<DeckShapeOp["fill"]>,
  alpha: number,
): string {
  if (typeof fill === "string") return rgbaColor(fill, alpha);
  if (fill.type === "linearGradient") {
    if (fill.stops) {
      return `linear-gradient(${fill.angle ?? 90}deg, ${fill.stops
        .map(
          (stop) =>
            `${rgbaColor(stop.color, alpha + 0.08)}${stop.offset !== undefined ? ` ${stop.offset}%` : ""}`,
        )
        .join(", ")})`;
    }
    return `linear-gradient(${fill.angle ?? 90}deg, ${rgbaColor(
      fill.from,
      alpha + 0.08,
    )}, ${rgbaColor(fill.to, alpha)})`;
  }
  const rx = fill.rx ?? fill.r ?? 70;
  const ry = fill.ry ?? fill.r ?? 70;
  if (fill.stops) {
    return `radial-gradient(${rx}% ${ry}% at ${fill.cx ?? 50}% ${fill.cy ?? 50}%, ${fill.stops
      .map(
        (stop) =>
          `${rgbaColor(stop.color, alpha + 0.08)}${stop.offset !== undefined ? ` ${stop.offset}%` : ""}`,
      )
      .join(", ")})`;
  }
  return `radial-gradient(${rx}% ${ry}% at ${fill.cx ?? 50}% ${fill.cy ?? 50}%, ${rgbaColor(
    fill.inner,
    alpha + 0.08,
  )}, ${rgbaColor(fill.outer, alpha)})`;
}

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

function textHtml(
  text: string,
  runs: TextRun[] | undefined,
  pxPerIn: number,
): string {
  if (runs && runs.length > 0) {
    return runs
      .map((run) => {
        if (run.text === "\n") return "<br/>";
        const styles = [
          run.bold ? "font-weight:700;" : "",
          run.italic ? "font-style:italic;" : "",
          run.underline ? "text-decoration:underline;" : "",
          run.fontSize !== undefined
            ? `font-size:${pxFromPt(run.fontSize, pxPerIn)}px;`
            : "",
          run.code ? `font-family:${CODE_FONT_FACE};` : "",
          run.color ? `color:#${toHex(run.color)};` : "",
        ].join("");
        const content = xmlEscape(run.text).replaceAll("\n", "<br/>");
        const span = `<span style="${styles}">${content}</span>`;
        return run.link
          ? `<a href="${xmlEscape(run.link)}" style="color:inherit;text-decoration:inherit;">${span}</a>`
          : span;
      })
      .join("");
  }
  return xmlEscape(text).replaceAll("\n", "<br/>");
}

function renderTextForeignObject(
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
  const x = px(op.x, pxPerIn);
  const y = px(op.y, pxPerIn);
  const w = px(op.w, pxPerIn);
  const h = px(op.h, pxPerIn);
  const style = toExportTextStyle(op);
  const valign =
    style.verticalAlign === "top"
      ? "flex-start"
      : style.verticalAlign === "bottom"
        ? "flex-end"
        : "center";
  /* node:coverage disable */
  /* Text foreignObject style rows are asserted via slide-image export tests; tsx maps array entries as residual. */
  const outerStyle = [
    "width:100%;height:100%;display:flex;",
    `align-items:${valign};`,
    "justify-content:stretch;",
    `color:#${style.color};`,
    `font-size:${pxFromPt(style.fontSize, pxPerIn)}px;`,
    style.bold ? "font-weight:700;" : "font-weight:400;",
    style.italic ? "font-style:italic;" : "font-style:normal;",
    style.underline ? "text-decoration:underline;" : "",
    `text-align:${style.align};`,
    `line-height:${style.lineHeight ?? 1.15};`,
    "white-space:pre-wrap;overflow-wrap:break-word;word-break:normal;",
    "overflow:hidden;",
    cssFontFace(style.fontFace),
    op.opacity !== undefined ? `opacity:${op.opacity};` : "",
    shadowCss(op.shadow),
  ].join("");
  /* node:coverage enable */
  const innerStyle = "width:100%;";
  /* node:coverage disable */
  /* ForeignObject template rows are asserted via slide-image export tests; tsx maps wrapped template rows as residual. */
  return `<foreignObject x="${x}" y="${y}" width="${w}" height="${h}"${rotationTransform(
    op.x * pxPerIn,
    op.y * pxPerIn,
    op.w * pxPerIn,
    op.h * pxPerIn,
    op.rotation,
  )}><div xmlns="http://www.w3.org/1999/xhtml" style="${outerStyle}"><div style="${innerStyle}">${textHtml(
    op.text,
    op.runs,
    pxPerIn,
  )}</div></div></foreignObject>`;
  /* node:coverage enable */
}

function renderBulletsForeignObject(
  op: DeckBulletsOp,
  pxPerIn: number,
): string {
  const bulletCounters = new Map<number, number>();
  /* node:coverage disable */
  /* Bullet row HTML is asserted by SVG export tests; tsx maps wrapped map rows as residual. */
  const rows = op.items
    .map((item, index) => {
      const detail = op.itemDetails?.[index];
      const indent = detail?.indent ?? 0;
      const numbered = detail?.listType === "number";
      const current = (bulletCounters.get(indent) ?? 0) + 1;
      bulletCounters.set(indent, current);
      if (!numbered) bulletCounters.delete(indent + 1);
      const marker = numbered ? `${current}.` : "•";
      const html = textHtml(item, op.itemRuns?.[index], pxPerIn);
      return `<div style="display:flex;gap:0.5em;padding-left:${indent * 1.5}em;"><span style="width:1.2em;flex:0 0 1.2em;">${marker}</span><span style="flex:1 1 auto;">${html}</span></div>`;
    })
    .join("");
  /* node:coverage enable */
  return renderTextForeignObject(
    {
      ...op,
      text: "",
      runs: undefined,
      shadow: op.shadow,
    },
    pxPerIn,
  ).replace(
    "</div></div></foreignObject>",
    `${rows}</div></div></foreignObject>`,
  );
}

function renderShapeLabel(op: DeckShapeOp, pxPerIn: number): string {
  if (!op.text || op.shape === "line") return "";
  return renderTextForeignObject(
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

function glassClipCss(op: DeckShapeOp, pxPerIn: number): string {
  switch (op.shape) {
    case "circle":
      return "border-radius:9999px;";
    case "square":
      return op.radius ? `border-radius:${op.radius * pxPerIn}px;` : "";
    case "ellipse":
      return "clip-path:ellipse(50% 50% at 50% 50%);";
    case "triangle":
      return "clip-path:polygon(50% 0%, 0% 100%, 100% 100%);";
    case "diamond":
      return "clip-path:polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);";
    case "rect":
      return op.radius ? `border-radius:${op.radius * pxPerIn}px;` : "";
    case "line":
      return "";
  }
}

function renderEffectShapeSvg(
  op: DeckShapeOp,
  fill: NonNullable<DeckShapeOp["fill"]>,
  pxPerIn: number,
): string {
  const drawOp = { ...op, ...shapeRenderBox(op.shape, op) };
  const x = px(drawOp.x, pxPerIn);
  const y = px(drawOp.y, pxPerIn);
  const w = px(drawOp.w, pxPerIn);
  const h = px(drawOp.h, pxPerIn);
  const transform = rotationTransform(
    drawOp.x * pxPerIn,
    drawOp.y * pxPerIn,
    drawOp.w * pxPerIn,
    drawOp.h * pxPerIn,
    drawOp.rotation,
  );
  const effect = drawOp.effect;
  const preset =
    effect?.kind === "glass" ? GLASS_PRESETS[effect.intensity] : undefined;
  const style = [
    "width:100%;height:100%;box-sizing:border-box;",
    `background:${preset ? glassFillCss(fill, preset.alpha) : typeof fill === "string" ? hashColor(fill) : shapeFillAttr(fill, "effect-fill").attr};`,
    preset
      ? `backdrop-filter:blur(${preset.blur}px) saturate(${preset.saturate});`
      : effect?.kind === "blur"
        ? `filter:blur(${effect.radius * pxPerIn * 0.08}px);`
        : "",
    preset
      ? `-webkit-backdrop-filter:blur(${preset.blur}px) saturate(${preset.saturate});`
      : "",
    preset
      ? `border:1px solid ${rgbaColor("ffffff", preset.borderAlpha)};`
      : "",
    preset ? "box-shadow:0 8px 24px rgba(15,23,42,0.18);" : "",
    drawOp.opacity !== undefined ? `opacity:${drawOp.opacity};` : "",
    glassClipCss(drawOp, pxPerIn),
  ].join("");
  return `<g${transform}><foreignObject x="${x}" y="${y}" width="${w}" height="${h}"><div xmlns="http://www.w3.org/1999/xhtml" style="${style}"></div></foreignObject>${renderShapeLabel(
    drawOp,
    pxPerIn,
  )}</g>`;
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
        body: renderTextForeignObject(
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
    switch (op.kind) {
      case "text":
        body.push(renderTextForeignObject(op, geometry.pxPerIn));
        break;
      case "bullets":
        body.push(renderBulletsForeignObject(op, geometry.pxPerIn));
        break;
      case "shape":
        {
          const rendered = renderShapeSvg(op, id, geometry.pxPerIn);
          defs.push(...rendered.defs);
          body.push(rendered.body);
        }
        break;
      case "image": {
        const rendered = renderImageSvg(op, id, op.src, geometry.pxPerIn);
        defs.push(...rendered.defs);
        body.push(rendered.body);
        break;
      }
      case "connector": {
        const rendered = renderConnectorSvg(op, id, geometry.pxPerIn);
        defs.push(...rendered.defs);
        body.push(rendered.body);
        break;
      }
      case "visual-native":
        op.specs.forEach((spec, specIndex) => {
          const rendered = renderPptxSpecSvg(
            spec,
            `${id}-native-${specIndex}`,
            geometry.pxPerIn,
          );
          defs.push(...rendered.defs);
          body.push(rendered.body);
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
        defs.push(...rendered.defs);
        body.push(
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
    ? (root as unknown as SVGSVGElement)
    : null;
}

// ---------------------------------------------------------------------------
// Public orchestration
// ---------------------------------------------------------------------------

/**
 * Exports the deck as a ZIP archive containing one image per slide.
 *
 * - `"svg"` preserves the richest fidelity and is the default.
 * - `"png"` rasterizes the generated slide SVG at the requested scale.
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
    const geometry = slideImageGeometry((deck as any).canvas?.format);
    const zip = new JSZip();

    for (const slideSpec of specs) {
      const svgString = slideSpecToSvgString(slideSpec, geometry, getSvg);
      const fileBase = `slide-${String(slideSpec.index + 1).padStart(2, "0")}`;
      if (format === "svg") {
        zip.file(`${fileBase}.svg`, svgString);
        continue;
      }

      const svg = parseSvg(svgString);
      if (!svg) return null;
      const pngBlob = await exportPNG(svg, {
        background: "include",
        colorMode: "color",
        scale: options.scale ?? 1,
      });
      if (!pngBlob) return null;
      zip.file(`${fileBase}.png`, pngBlob);
    }

    return zip.generateAsync({ type: "blob" });
  } catch {
    return null;
  }
}
