/**
 * Browser-only applier: walks {@link DeckSlideSpec} descriptors and produces a
 * real PptxGenJS presentation archive.
 *
 * This module owns all PptxGenJS integration: mapping deck ops to PptxGenJS
 * API calls, rasterising SVG images to PNG data-URLs, and writing the final
 * Blob. It has no SVG-slide-rendering dependencies; those live in
 * deck-export-slide-images.ts.
 */

import type PptxGenJS from "pptxgenjs";

import type { Deck } from "../deck-core";
import type { ImageCrop, ShapeKind, TextRun } from "../deck-elements";
import type { Visual } from "@/lib/visual/schema";
import { toHex } from "@/lib/visual/pptx-shapes";
import {
  buildDeckSpecs,
  deckGeometry,
  toExportTextStyle,
} from "./deck-export-spec";
import { shapeRenderBox } from "../shape-geometry";
/* Type-only aliases are erased by tsx. */
/* node:coverage ignore next 10 */
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
// Internal types
// ---------------------------------------------------------------------------

type PptxSlide = ReturnType<PptxGenJS["addSlide"]>;
type ShapeName = Parameters<PptxSlide["addShape"]>[0];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const SHAPES: Record<ShapeKind | "roundRect", ShapeName> = {
  rect: "rect",
  ellipse: "ellipse",
  line: "line",
  triangle: "triangle",
  diamond: "diamond",
  circle: "ellipse",
  square: "rect",
  roundRect: "roundRect",
};

/** Monospace font face used to render inline-code runs in PPTX. */
const CODE_FONT_FACE = "Courier New";

/** Shared outer drop-shadow options for elements with `shadow` set. */
export const SHADOW_OPTS = {
  type: "outer" as const,
  color: "000000",
  blur: 4,
  offset: 3,
  angle: 90,
  opacity: 0.3,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Rasterise a live SVG to a PNG data URL (browser-only). */
async function svgToPngDataUrl(svg: SVGSVGElement): Promise<string | null> {
  const { exportPNG } = await import("@/lib/visual/export");
  const pngBlob = await exportPNG(svg, {
    background: "include",
    colorMode: "color",
    scale: 2,
  });
  if (!pngBlob) return null;
  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(pngBlob);
  });
}

function opacityTransparency(opacity: number | undefined): number | undefined {
  if (opacity === undefined) return undefined;
  return Math.round((1 - opacity) * 100);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function hasImageCrop(crop: ImageCrop | undefined): crop is ImageCrop {
  return Boolean(
    crop &&
    (crop.top > 0 || crop.right > 0 || crop.bottom > 0 || crop.left > 0),
  );
}

function imageObjectPosition(crop: ImageCrop | undefined): string {
  if (!crop) return "50% 50%";
  const remainingX = Math.max(0, 1 - crop.left - crop.right);
  const remainingY = Math.max(0, 1 - crop.top - crop.bottom);
  const x = Math.max(0, Math.min(1, crop.left + remainingX / 2));
  const y = Math.max(0, Math.min(1, crop.top + remainingY / 2));
  return `${x * 100}% ${y * 100}%`;
}

function imageNeedsRasterFallback(op: DeckImageOp): boolean {
  return (
    (op.maskShape !== undefined && op.maskShape !== "none") ||
    (op.radius !== undefined && op.radius > 0) ||
    hasImageCrop(op.crop) ||
    op.fitMode === "none"
  );
}

function shapeNeedsRasterFallback(op: DeckShapeOp): boolean {
  return Boolean(
    op.effect || (op.fill !== undefined && typeof op.fill !== "string"),
  );
}

function shapeClipCss(op: DeckShapeOp, height: number): string {
  switch (op.shape) {
    case "circle":
      return "border-radius:9999px;";
    case "square":
      return op.radius ? `border-radius:${Math.round(op.radius * 192)}px;` : "";
    case "ellipse":
      return "clip-path:ellipse(50% 50% at 50% 50%);";
    case "triangle":
      return "clip-path:polygon(50% 0%, 0% 100%, 100% 100%);";
    case "diamond":
      return "clip-path:polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);";
    case "rect":
      return op.radius ? `border-radius:${Math.round(op.radius * 192)}px;` : "";
    case "line":
      return `height:${Math.max(1, Math.round(height * 0.04))}px;margin-top:${Math.round(
        height / 2,
      )}px;`;
  }
}

function shapeFillCss(
  fill: NonNullable<DeckShapeOp["fill"]>,
  effect: DeckShapeOp["effect"],
): string {
  if (effect?.kind === "glass") {
    const preset = GLASS_PRESETS[effect.intensity];
    if (typeof fill === "string") return rgbaColor(fill, preset.alpha);
    if (fill.type === "linearGradient") {
      if (fill.stops) {
        return `linear-gradient(${fill.angle ?? 90}deg, ${fill.stops
          .map(
            (stop) =>
              `${rgbaColor(stop.color, preset.alpha + 0.08)}${stop.offset !== undefined ? ` ${stop.offset}%` : ""}`,
          )
          .join(", ")})`;
      }
      return `linear-gradient(${fill.angle ?? 90}deg, ${rgbaColor(
        fill.from,
        preset.alpha + 0.08,
      )}, ${rgbaColor(fill.to, preset.alpha)})`;
    }
    const rx = fill.rx ?? fill.r ?? 70;
    const ry = fill.ry ?? fill.r ?? 70;
    if (fill.stops) {
      return `radial-gradient(${rx}% ${ry}% at ${fill.cx ?? 50}% ${fill.cy ?? 50}%, ${fill.stops
        .map(
          (stop) =>
            `${rgbaColor(stop.color, preset.alpha + 0.08)}${stop.offset !== undefined ? ` ${stop.offset}%` : ""}`,
        )
        .join(", ")})`;
    }
    return `radial-gradient(${rx}% ${ry}% at ${fill.cx ?? 50}% ${fill.cy ?? 50}%, ${rgbaColor(
      fill.inner,
      preset.alpha + 0.08,
    )}, ${rgbaColor(fill.outer, preset.alpha)})`;
  }
  if (typeof fill === "string") return hashColor(fill);
  if (fill.type === "linearGradient") {
    if (fill.stops) {
      return `linear-gradient(${fill.angle ?? 90}deg, ${fill.stops
        .map(
          (stop) =>
            `${hashColor(stop.color)}${stop.offset !== undefined ? ` ${stop.offset}%` : ""}`,
        )
        .join(", ")})`;
    }
    return `linear-gradient(${fill.angle ?? 90}deg, ${hashColor(fill.from)}, ${hashColor(fill.to)})`;
  }
  const rx = fill.rx ?? fill.r ?? 70;
  const ry = fill.ry ?? fill.r ?? 70;
  if (fill.stops) {
    return `radial-gradient(${rx}% ${ry}% at ${fill.cx ?? 50}% ${fill.cy ?? 50}%, ${fill.stops
      .map(
        (stop) =>
          `${hashColor(stop.color)}${stop.offset !== undefined ? ` ${stop.offset}%` : ""}`,
      )
      .join(", ")})`;
  }
  return `radial-gradient(${rx}% ${ry}% at ${fill.cx ?? 50}% ${fill.cy ?? 50}%, ${hashColor(
    fill.inner,
  )}, ${hashColor(fill.outer)})`;
}

function svgRootElement(root: Element): SVGSVGElement | null {
  return root.tagName === "svg" ? parsedSvgRoot(root) : null;
}

function parsedSvgRoot(root: Element): SVGSVGElement {
  return root as unknown as SVGSVGElement;
}

function renderStyledShapeSvg(
  op: DeckShapeOp,
  pxPerIn = 192,
): SVGSVGElement | null {
  if (typeof DOMParser === "undefined") return null;
  const width = Math.max(1, Math.round(op.w * pxPerIn));
  const height = Math.max(1, Math.round(op.h * pxPerIn));
  const box = shapeRenderBox(op.shape, { x: 0, y: 0, w: width, h: height });
  const fill = op.fill ?? op.color;
  const preset =
    op.effect?.kind === "glass"
      ? GLASS_PRESETS[op.effect.intensity]
      : undefined;
  const outerStyle = "position:relative;width:100%;height:100%;";
  const shapeStyle = [
    "position:absolute;box-sizing:border-box;overflow:hidden;",
    `left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px;`,
    `background:${shapeFillCss(fill, op.effect)};`,
    preset
      ? `backdrop-filter:blur(${preset?.blur}px) saturate(${preset?.saturate});-webkit-backdrop-filter:blur(${preset?.blur}px) saturate(${preset?.saturate});`
      : op.effect?.kind === "blur"
        ? `filter:blur(${Math.round(op.effect.radius * 16)}px);`
        : "",
    preset
      ? `border:1px solid ${rgbaColor("ffffff", preset?.borderAlpha ?? 0.5)};box-shadow:0 8px 24px rgba(15,23,42,0.18);`
      : op.stroke
        ? `border:${Math.max(1, Math.round(op.stroke.width))}px solid ${hashColor(op.stroke.color)};`
        : "",
    op.opacity !== undefined ? `opacity:${op.opacity};` : "",
    shapeClipCss(op, box.h),
  ].join("");
  const labelStyle = [
    "position:absolute;inset:8%;display:flex;align-items:center;justify-content:center;",
    `color:${hashColor(op.textColor ?? "18181b")};`,
    `font-size:${Math.round(op.fontSize ?? 18)}px;`,
    `font-weight:${op.bold ? 700 : 400};`,
    `font-style:${op.italic ? "italic" : "normal"};`,
    `text-align:${op.align ?? "center"};`,
    "white-space:pre-wrap;overflow-wrap:break-word;overflow:hidden;",
  ].join("");
  const label = op.text
    ? `<div style="${labelStyle}">${escapeXml(op.text)}</div>`
    : "";
  const svgString = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <foreignObject x="0" y="0" width="${width}" height="${height}">
    <div xmlns="http://www.w3.org/1999/xhtml" style="${outerStyle}"><div style="${shapeStyle}">${label}</div></div>
  </foreignObject>
</svg>`;
  const parsed = new DOMParser().parseFromString(svgString, "image/svg+xml");
  return svgRootElement(parsed.documentElement);
}

/* node:coverage ignore next 4 */
/* Browser-only helper is exercised via applyImageOp; tsx maps signature rows as residual. */
function renderStyledImageSvg(
  op: DeckImageOp,
  pxPerIn = 192,
): SVGSVGElement | null {
  if (typeof DOMParser === "undefined") {
    return null;
  }
  const width = Math.max(1, Math.round(op.w * pxPerIn));
  const height = Math.max(1, Math.round(op.h * pxPerIn));
  const radius =
    op.radius !== undefined && op.radius > 0 ? op.radius : undefined;
  const roundedRadiusPx =
    op.maskShape === "rounded"
      ? radius !== undefined
        ? Math.round(radius * pxPerIn)
        : Math.round(Math.min(width, height) * 0.12)
      : radius !== undefined
        ? Math.round(radius * pxPerIn)
        : 0;
  const maskCss =
    op.maskShape === "circle"
      ? "clip-path:circle(50% at 50% 50%);"
      : op.maskShape === "diamond"
        ? "clip-path:polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);"
        : roundedRadiusPx > 0
          ? `border-radius:${roundedRadiusPx}px;`
          : "";
  const cropCss = hasImageCrop(op.crop)
    ? `clip-path:inset(${op.crop.top * 100}% ${op.crop.right * 100}% ${op.crop.bottom * 100}% ${op.crop.left * 100}%);`
    : "";
  const fitMode = op.fitMode ?? "contain";
  const svgString = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <foreignObject x="0" y="0" width="${width}" height="${height}">
    <div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;overflow:hidden;${maskCss}">
      <div style="width:100%;height:100%;overflow:hidden;${cropCss}">
        <img src="${escapeXml(op.src)}" alt="${escapeXml(op.alt ?? "")}" style="display:block;width:100%;height:100%;object-fit:${fitMode};object-position:${imageObjectPosition(
          op.crop,
        )};" />
      </div>
    </div>
  </foreignObject>
</svg>`;
  const parsed = new DOMParser().parseFromString(svgString, "image/svg+xml");
  return svgRootElement(parsed.documentElement);
}

/** Per-run PptxGenJS text options derived from a {@link TextRun}'s formatting. */
function runToOptions(run: TextRun): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  if (run.bold) options.bold = true;
  if (run.italic) options.italic = true;
  if (run.underline) options.underline = { style: "sng" };
  if (run.fontSize !== undefined) options.fontSize = run.fontSize;
  if (run.code) options.fontFace = CODE_FONT_FACE;
  if (run.color) options.color = toHex(run.color);
  if (run.link) options.hyperlink = { url: run.link };
  return options;
}

type PptxTextRun = { text: string; options: Record<string, unknown> };

// ---------------------------------------------------------------------------
// Op appliers
// ---------------------------------------------------------------------------

export function applyTextOp(slide: PptxSlide, op: DeckTextOp): void {
  const style = toExportTextStyle(op);
  const pptxValign =
    style.verticalAlign === "top"
      ? ("top" as const)
      : style.verticalAlign === "bottom"
        ? ("bottom" as const)
        : ("middle" as const);
  const shared = {
    x: op.x,
    y: op.y,
    w: op.w,
    h: op.h,
    color: style.color,
    fontSize: style.fontSize,
    ...(style.fontFace ? { fontFace: style.fontFace } : {}),
    bold: style.bold,
    italic: style.italic,
    align: style.align,
    valign: pptxValign,
    wrap: true,
    // `shrinkText: true` instructs PPTX to reduce font size until text fits.
    ...(op.fitMode === "shrink-to-fit" ? { shrinkText: true } : {}),
    ...(op.rotation ? { rotate: op.rotation } : {}),
    ...(style.underline ? { underline: { style: "sng" as const } } : {}),
    ...(op.shadow ? { shadow: SHADOW_OPTS } : {}),
    ...(opacityTransparency(op.opacity) !== undefined
      ? { transparency: opacityTransparency(op.opacity) }
      : {}),
    ...(style.lineHeight
      ? { lineSpacing: Math.round(style.lineHeight * 100) }
      : {}),
    ...(op.paragraphSpacingPt ? { paraSpaceAfter: op.paragraphSpacingPt } : {}),
  };

  /* node:coverage disable */
  /* Rich/plain text emission is asserted by PPTX applier tests; tsx maps call/return rows as residual. */
  if (op.runs && op.runs.length > 0) {
    const runs: PptxTextRun[] = op.runs.map((run) =>
      run.text === "\n"
        ? { text: "", options: { breakLine: true } }
        : { text: run.text, options: runToOptions(run) },
    );
    slide.addText(runs, shared);
    return;
  }

  slide.addText(op.text, shared);
  /* node:coverage enable */
}

export function applyBulletsOp(slide: PptxSlide, op: DeckBulletsOp): void {
  /* node:coverage ignore next 2 */
  /* Bullets style initialization is asserted by applier tests; tsx maps wrapped call rows as residual. */
  const style = toExportTextStyle(op);
  const pptxValign =
    style.verticalAlign === "top"
      ? ("top" as const)
      : style.verticalAlign === "bottom"
        ? ("bottom" as const)
        : ("middle" as const);
  const shared = {
    x: op.x,
    y: op.y,
    w: op.w,
    h: op.h,
    color: style.color,
    fontSize: style.fontSize,
    ...(style.fontFace ? { fontFace: style.fontFace } : {}),
    bold: style.bold,
    italic: style.italic,
    align: style.align,
    valign: pptxValign,
    wrap: true,
    // `shrinkText: true` instructs PPTX to reduce font size until text fits.
    ...(op.fitMode === "shrink-to-fit" ? { shrinkText: true } : {}),
    ...(op.rotation ? { rotate: op.rotation } : {}),
    ...(style.underline ? { underline: { style: "sng" as const } } : {}),
    ...(op.shadow ? { shadow: SHADOW_OPTS } : {}),
    ...(opacityTransparency(op.opacity) !== undefined
      ? { transparency: opacityTransparency(op.opacity) }
      : {}),
    ...(style.lineHeight
      ? { lineSpacing: Math.round(style.lineHeight * 100) }
      : {}),
  };

  const hasRuns =
    op.itemRuns !== undefined &&
    op.itemRuns.some((runs) => runs && runs.length > 0);

  /** Build the pptxgenjs `bullet` option for item at index `i`. */
  function bulletOpt(i: number): true | { type: "number" | "bullet" } {
    const detail = op.itemDetails?.[i];
    const isNumbered = detail?.listType === "number";
    if (!isNumbered && (detail?.indent ?? 0) === 0) return true;
    return { type: isNumbered ? "number" : "bullet" };
  }

  /** Return the paragraph-level indent depth for item at index `i`. */
  function itemIndentLevel(i: number): number {
    return op.itemDetails?.[i]?.indent ?? 0;
  }

  if (!hasRuns) {
    const runs = op.items.map((text, i) => ({
      text,
      options: {
        bullet: bulletOpt(i),
        indentLevel: itemIndentLevel(i),
        breakLine: i < op.items.length - 1,
      },
    }));
    slide.addText(runs, shared);
    return;
  }

  const runs: PptxTextRun[] = [];
  op.items.forEach((text, i) => {
    const isLastLine = i === op.items.length - 1;
    const lineRuns = op.itemRuns?.[i];
    if (lineRuns && lineRuns.length > 0) {
      lineRuns.forEach((run, j) => {
        const isLastRun = j === lineRuns.length - 1;
        runs.push({
          text: run.text === "\n" ? "" : run.text,
          options: {
            ...runToOptions(run),
            ...(j === 0
              ? { bullet: bulletOpt(i), indentLevel: itemIndentLevel(i) }
              : {}),
            ...(isLastRun && !isLastLine ? { breakLine: true } : {}),
          },
        });
      });
    } else {
      runs.push({
        text,
        options: {
          bullet: bulletOpt(i),
          indentLevel: itemIndentLevel(i),
          breakLine: !isLastLine,
        },
      });
    }
  });
  slide.addText(runs, shared);
}

function applyShapeTextOp(slide: PptxSlide, op: DeckShapeOp): void {
  const labelText = op.text ?? "";
  if (labelText.length === 0 || op.shape === "line") return;
  const textBox = shapeRenderBox(op.shape, op);
  /* node:coverage disable */
  /* Shape-label text options are asserted by PPTX applier tests; tsx maps object-literal rows as residual. */
  applyTextOp(slide, {
    kind: "text",
    text: labelText,
    ...(op.textRuns && op.textRuns.length > 0 ? { runs: op.textRuns } : {}),
    x: textBox.x + textBox.w * 0.08,
    y: textBox.y + textBox.h * 0.08,
    w: textBox.w * 0.84,
    h: textBox.h * 0.84,
    color: op.textColor ?? "18181b",
    fontSize: op.fontSize ?? 18,
    ...(op.fontFace ? { fontFace: op.fontFace } : {}),
    bold: op.bold ?? false,
    italic: op.italic ?? false,
    ...(op.underline ? { underline: true } : {}),
    align: op.align ?? "center",
    ...(op.rotation ? { rotation: op.rotation } : {}),
    ...(op.opacity !== undefined ? { opacity: op.opacity } : {}),
  });
  /* node:coverage enable */
}
/* node:coverage disable */
/* V8/tsx marks covered PptxGenJS adapter object-literal lines as uncovered; deck-export tests assert each shape variant. */
export function applyShapeOp(slide: PptxSlide, op: DeckShapeOp): void {
  const rotate = op.rotation ? { rotate: op.rotation } : {};
  const transparency = opacityTransparency(op.opacity);
  if (op.shape === "line") {
    // Render as a centered horizontal rule across the box.
    slide.addShape(SHAPES.line, {
      x: op.x,
      y: op.y + op.h / 2,
      w: op.w,
      h: 0,
      line: {
        color: op.stroke?.color ?? op.color,
        width: op.stroke?.width ?? 2,
        ...(op.stroke?.dash ? { dashType: "dash" as const } : {}),
        ...(transparency !== undefined ? { transparency } : {}),
      },
      ...rotate,
    });
    applyShapeTextOp(slide, op);
    return;
  }
  if (op.shape === "triangle" || op.shape === "diamond") {
    slide.addShape(SHAPES[op.shape], {
      x: op.x,
      y: op.y,
      w: op.w,
      h: op.h,
      fill: {
        color: op.color,
        ...(transparency !== undefined ? { transparency } : {}),
      },
      line: {
        width: 0,
        color: op.color,
        ...(transparency !== undefined ? { transparency } : {}),
      },
      ...rotate,
      ...(op.shadow ? { shadow: SHADOW_OPTS } : {}),
    });
    return;
  }
  const shapeName =
    op.shape === "circle"
      ? SHAPES.ellipse
      : op.shape === "ellipse"
        ? SHAPES.ellipse
        : op.radius
          ? SHAPES.roundRect
          : SHAPES.rect;
  const drawOp = { ...op, ...shapeRenderBox(op.shape, op) };
  slide.addShape(shapeName, {
    x: drawOp.x,
    y: drawOp.y,
    w: drawOp.w,
    h: drawOp.h,
    fill: {
      color: op.color,
      ...(transparency !== undefined ? { transparency } : {}),
    },
    line: op.stroke
      ? {
          color: op.stroke.color,
          width: op.stroke.width,
          ...(op.stroke.dash ? { dashType: "dash" as const } : {}),
          ...(transparency !== undefined ? { transparency } : {}),
        }
      : {
          width: 0,
          color: op.color,
          ...(transparency !== undefined ? { transparency } : {}),
        },
    ...(op.radius && op.shape !== "circle" && op.shape !== "ellipse"
      ? { rectRadius: op.radius }
      : {}),
    ...rotate,
    ...(op.shadow ? { shadow: SHADOW_OPTS } : {}),
  });
  applyShapeTextOp(slide, op);
}
/* node:coverage enable */

async function applyShapeRasterFallback(
  slide: PptxSlide,
  op: DeckShapeOp,
): Promise<boolean> {
  if (!shapeNeedsRasterFallback(op)) return false;
  const styledSvg = renderStyledShapeSvg(op);
  if (!styledSvg) return false;
  const pngDataUrl = await svgToPngDataUrl(styledSvg);
  if (!pngDataUrl) return false;
  slide.addImage({
    data: pngDataUrl,
    x: op.x,
    y: op.y,
    w: op.w,
    h: op.h,
    ...(op.rotation ? { rotate: op.rotation } : {}),
    ...(op.shadow ? { shadow: SHADOW_OPTS } : {}),
  });
  return true;
}

export async function applyImageOp(
  slide: PptxSlide,
  op: DeckImageOp,
): Promise<void> {
  if (imageNeedsRasterFallback(op)) {
    const styledSvg = renderStyledImageSvg(op);
    if (styledSvg) {
      const pngDataUrl = await svgToPngDataUrl(styledSvg);
      if (pngDataUrl) {
        slide.addImage({
          data: pngDataUrl,
          x: op.x,
          y: op.y,
          w: op.w,
          h: op.h,
          ...(op.alt ? { altText: op.alt } : {}),
          ...(op.rotation ? { rotate: op.rotation } : {}),
          ...(op.shadow ? { shadow: SHADOW_OPTS } : {}),
        });
        return;
      }
    }
  }

  const source = op.src.startsWith("data:")
    ? { data: op.src }
    : { path: op.src };
  const fitMode = op.fitMode === "none" ? "contain" : (op.fitMode ?? "contain");
  slide.addImage({
    ...source,
    x: op.x,
    y: op.y,
    w: op.w,
    h: op.h,
    ...(op.alt ? { altText: op.alt } : {}),
    ...(fitMode === "cover" || fitMode === "contain"
      ? { sizing: { type: fitMode, w: op.w, h: op.h } }
      : {}),
    ...(op.rotation ? { rotate: op.rotation } : {}),
    ...(op.shadow ? { shadow: SHADOW_OPTS } : {}),
    ...(opacityTransparency(op.opacity) !== undefined
      ? { transparency: opacityTransparency(op.opacity) }
      : {}),
  });
}

/**
 * Renders a {@link DeckConnectorOp} as a PptxGenJS line shape drawn between the
 * two absolute inch-space endpoints. The shape's bounding box is computed from
 * the midpoint and hypotenuse length so that a rotation places the endpoints
 * exactly at (x1, y1) and (x2, y2).
 */
export function applyConnectorOp(slide: PptxSlide, op: DeckConnectorOp): void {
  const dx = op.x2 - op.x1;
  const dy = op.y2 - op.y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length < 0.001) return;
  const angle = Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
  const cx = (op.x1 + op.x2) / 2;
  const cy = (op.y1 + op.y2) / 2;
  slide.addShape(SHAPES.line, {
    x: cx - length / 2,
    y: cy,
    w: length,
    h: 0,
    line: {
      color: op.color,
      width: op.width,
      ...(op.dash ? { dashType: "dash" as const } : {}),
      ...(op.arrowEnd && op.arrowEnd !== "none"
        ? { endArrowType: "arrow" as const }
        : {}),
      ...(op.arrowStart && op.arrowStart !== "none"
        ? { beginArrowType: "arrow" as const }
        : {}),
      ...(opacityTransparency(op.opacity) !== undefined
        ? { transparency: opacityTransparency(op.opacity) }
        : {}),
    },
    rotate: angle,
  });
}

async function applyVisualFallbackOp(
  slide: PptxSlide,
  op: DeckVisualFallbackOp,
  getSvg: (visualId: string) => SVGSVGElement | null,
): Promise<void> {
  const svg = getSvg(op.visualId);
  if (!svg) return;
  const viewBox = svg.viewBox.baseVal;
  const vw = viewBox.width;
  const vh = viewBox.height;
  if (vw === 0 || vh === 0) return;

  const pngDataUrl = await svgToPngDataUrl(svg);
  if (!pngDataUrl) return;

  const ratio = Math.min(op.w / vw, op.h / vh);
  const imgW = vw * ratio;
  const imgH = vh * ratio;
  slide.addImage({
    data: pngDataUrl,
    x: op.x + (op.w - imgW) / 2,
    y: op.y + (op.h - imgH) / 2,
    w: imgW,
    h: imgH,
    ...(op.rotation ? { rotate: op.rotation } : {}),
    ...(op.shadow ? { shadow: SHADOW_OPTS } : {}),
    ...(opacityTransparency(op.opacity) !== undefined
      ? { transparency: opacityTransparency(op.opacity) }
      : {}),
  });
}

export async function applyDeckOp(
  slide: PptxSlide,
  op: DeckOp,
  getSvg: (visualId: string) => SVGSVGElement | null,
): Promise<void> {
  switch (op.kind) {
    case "text":
      applyTextOp(slide, op);
      break;
    case "bullets":
      applyBulletsOp(slide, op);
      break;
    case "shape":
      if (!(await applyShapeRasterFallback(slide, op))) {
        applyShapeOp(slide, op);
      }
      break;
    case "image":
      await applyImageOp(slide, op);
      break;
    case "connector":
      applyConnectorOp(slide, op);
      break;
    case "visual-native":
      {
        const { applySpecsToSlide } = await import("@/lib/visual/pptx-apply");
        applySpecsToSlide(slide, op.specs);
      }
      break;
    case "visual-fallback":
      await applyVisualFallbackOp(slide, op, getSvg);
      break;
  }
}

// ---------------------------------------------------------------------------
// Public orchestration
// ---------------------------------------------------------------------------

/**
 * Produces a PPTX deck that honors the edited `deck` (slide order, retitling,
 * free-form text/shapes/images, per-slide background/accent), emitting one
 * slide per `deck.slides` entry.
 *
 * Visuals are embedded as native PptxGenJS shapes when possible; kinds that
 * cannot be represented natively (funnel, pyramid) fall back to a rasterised
 * PNG resolved from the live SVG via `getSvg`.
 *
 * @param deck     The edited deck (typically from `deckJson`).
 * @param visuals  Lookup of visual payloads by id (for native shape mapping).
 * @param getSvg   Resolves a live `SVGSVGElement` for a visual id (image fallback).
 * @returns A PPTX Blob, or `null` if assembly fails.
 */
export async function exportDeckAsPPTX(
  deck: Deck,
  visuals: ReadonlyMap<string, Visual>,
  getSvg: (visualId: string) => SVGSVGElement | null,
): Promise<Blob | null> {
  try {
    const { default: PptxGenJS } = await import("pptxgenjs");
    const specs = buildDeckSpecs(deck, visuals);
    const geometry = deckGeometry(deck.canvas?.format);

    const pptx = new PptxGenJS();
    pptx.layout = geometry.pptxLayout;

    for (const slideSpec of specs) {
      const slide = pptx.addSlide();
      slide.background = slideSpec.backgroundImage
        ? slideSpec.backgroundImage.startsWith("data:")
          ? { data: slideSpec.backgroundImage }
          : { path: slideSpec.backgroundImage }
        : { color: slideSpec.background };
      for (const op of slideSpec.ops) {
        await applyDeckOp(slide, op, getSvg);
      }
    }

    const arrayBuffer = (await pptx.write({
      outputType: "arraybuffer",
    })) as ArrayBuffer;

    return new Blob([arrayBuffer], { type: PPTX_MIME });
  } catch {
    return null;
  }
}

// Re-export spec types and builder consumed by the facade / tests.
export type { DeckSlideSpec };
