import type { CanvasSpec } from "../types";
import type {
  EffectStyle,
  FillStyle,
  GradientStop,
  StyleObject,
} from "../style-schema";
import type { DiagnosticCollector } from "../diagnostics";
import type {
  VnextPptxImageFill,
  VnextPptxLayout,
  VnextPptxEffect,
  VnextPptxTextStyle,
} from "../pptx-export-types";
import { slideFontExportFace } from "@/lib/presentation-shared/slide-fonts";

export type PptxDimensions = {
  layout: VnextPptxLayout;
  slideW: number;
  slideH: number;
};

export type PptxLowererBasis = { w: number; h: number };

export type PptxLowererContext = {
  basis: PptxLowererBasis;
  dims: PptxDimensions;
  dc: DiagnosticCollector;
};

export function canvasToPptxDimensions(canvas: CanvasSpec): PptxDimensions {
  switch (canvas.format) {
    case "16:9":
      return { layout: "LAYOUT_WIDE", slideW: 13.333, slideH: 7.5 };
    case "4:3":
      return { layout: "LAYOUT_4X3", slideW: 10, slideH: 7.5 };
    case "square":
      return { layout: "LAYOUT_CUSTOM", slideW: 7.5, slideH: 7.5 };
    case "custom": {
      // Scale so the larger axis is 13.333 in.
      const ratio = canvas.width / Math.max(canvas.height, 0.01);
      const slideW = Math.min(13.333, 13.333);
      const slideH = slideW / ratio;
      return { layout: "LAYOUT_CUSTOM", slideW, slideH };
    }
  }
}

export function pxToIn(
  frame: { x: number; y: number; w: number; h: number },
  basisW: number,
  basisH: number,
  slideW: number,
  slideH: number,
): { x: number; y: number; w: number; h: number } {
  return {
    x: (frame.x / basisW) * slideW,
    y: (frame.y / basisH) * slideH,
    w: (frame.w / basisW) * slideW,
    h: (frame.h / basisH) * slideH,
  };
}

export function frameToInches(
  frame: { x: number; y: number; w: number; h: number },
  ctx: PptxLowererContext,
): { x: number; y: number; w: number; h: number } {
  return pxToIn(
    frame,
    ctx.basis.w,
    ctx.basis.h,
    ctx.dims.slideW,
    ctx.dims.slideH,
  );
}

/** Strips leading `#` for PptxGenJS bare hex strings. */
export function toHex(color: string): string {
  const s = color.trim();
  if (s.startsWith("#")) return s.slice(1).toUpperCase();
  return s.toUpperCase();
}

/** Resolves a ColorValue to a hex string, emitting a diagnostic for token refs. */
export function resolveColor(
  color: unknown,
  fallback: string,
  dc: DiagnosticCollector,
  ctx: string,
): string {
  if (typeof color === "string") return toHex(color);
  // Unresolved token ref — render resolver should have resolved these.
  dc.warning(
    "missing-token",
    `${ctx}: unresolved token ref in export; using fallback color`,
    { path: ctx },
  );
  return toHex(fallback);
}

type PptxFill = string | VnextPptxImageFill;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function svgDataUri(svg: string): string {
  const globals = globalThis as typeof globalThis & {
    Buffer?: { from(input: string): { toString(encoding: "base64"): string } };
  };
  const encoded =
    globals.Buffer !== undefined
      ? globals.Buffer.from(svg).toString("base64")
      : btoa(unescape(encodeURIComponent(svg)));
  return `data:image/svg+xml;base64,${encoded}`;
}

function stopsXml(stops: readonly GradientStop[]): string {
  return stops
    .map(
      (stop) =>
        `<stop offset="${Math.max(0, Math.min(100, stop.offsetPct))}%" stop-color="#${escapeXml(
          toHex(typeof stop.color === "string" ? stop.color : "#cccccc"),
        )}"/>`,
    )
    .join("");
}

function gradientStops(
  fill: Extract<FillStyle, { type: "linearGradient" | "radialGradient" }>,
): readonly GradientStop[] {
  if (fill.stops && fill.stops.length > 0) return fill.stops;
  if (fill.type === "linearGradient") {
    return [
      { color: fill.from, offsetPct: 0 },
      { color: fill.to, offsetPct: 100 },
    ];
  }
  return [
    { color: fill.inner, offsetPct: 0 },
    { color: fill.outer, offsetPct: 100 },
  ];
}

function fillSvg(
  fill: Exclude<FillStyle, { type: "solid" | "image" }>,
): string {
  const w = 512;
  const h = 512;
  if (fill.type === "linearGradient") {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0%" y1="50%" x2="100%" y2="50%" gradientTransform="rotate(${fill.angle ?? 0} .5 .5)">${stopsXml(
      gradientStops(fill),
    )}</linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
  }

  if (fill.type === "radialGradient") {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><radialGradient id="g" cx="${fill.cx ?? 50}%" cy="${fill.cy ?? 50}%" r="${fill.r ?? fill.rx ?? fill.ry ?? 70}%">${stopsXml(
      gradientStops(fill),
    )}</radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
  }
  if (fill.type === "pattern") {
    const fg = `#${toHex(typeof fill.color === "string" ? fill.color : "#999999")}`;
    const bg = `#${toHex(
      typeof fill.background === "string" ? fill.background : "#ffffff",
    )}`;
    const spacing = Math.max(4, Math.round(fill.spacingPct ?? 12));
    const stroke = Math.max(1, Math.round(fill.strokeWidthPct ?? 2));
    const body =
      fill.kind === "dots"
        ? `<circle cx="${spacing / 2}" cy="${spacing / 2}" r="${stroke}" fill="${fg}"/>`
        : fill.kind === "grid"
          ? `<path d="M ${spacing} 0 L 0 0 0 ${spacing}" fill="none" stroke="${fg}" stroke-width="${stroke}"/>`
          : fill.kind === "scanlines"
            ? `<path d="M 0 ${spacing / 2} H ${spacing}" stroke="${fg}" stroke-width="${stroke}"/>`
            : `<path d="M 0 ${spacing} L ${spacing} 0" stroke="${fg}" stroke-width="${stroke}"/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><pattern id="p" width="${spacing}" height="${spacing}" patternUnits="userSpaceOnUse" patternTransform="rotate(${fill.angle ?? 0})">${body}</pattern></defs><rect width="100%" height="100%" fill="${bg}"/><rect width="100%" height="100%" fill="url(#p)"/></svg>`;
  }
  const first = fill.stops[0]?.color;
  const fallback = toHex(typeof first === "string" ? first : "#cccccc");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#${fallback}"/></svg>`;
}

function cssColor(color: unknown, fallback: string): string {
  return `#${toHex(typeof color === "string" ? color : fallback)}`;
}

function effectShapeBody(shape: string, fill: string): string {
  if (shape === "ellipse" || shape === "circle") {
    return `<ellipse cx="256" cy="256" rx="230" ry="230" fill="${escapeXml(fill)}"/>`;
  }
  if (shape === "diamond") {
    return `<path d="M256 18 494 256 256 494 18 256Z" fill="${escapeXml(fill)}"/>`;
  }
  if (shape === "triangle") {
    return `<path d="M256 28 492 484 20 484Z" fill="${escapeXml(fill)}"/>`;
  }
  const rx = shape === "roundRect" ? 48 : 0;
  return `<rect x="18" y="18" width="476" height="476" rx="${rx}" fill="${escapeXml(fill)}"/>`;
}

export function effectToImageRetryFill(
  style: StyleObject,
  shape: string,
  dc: DiagnosticCollector,
  ctx: string,
): VnextPptxImageFill | undefined {
  const effect = style.effect;
  if (!effect || effect.kind === "none" || effect.kind === "glow") return;
  if (style.fill && style.fill.type !== "solid") {
    dc.warning(
      "unsupported-export-feature",
      `${ctx}: "${effect.kind}" effect needs whole-node rasterization, but this shape also has a non-solid fill; retaining editable PPTX fallback`,
      { path: `${ctx}.effect`, action: { type: "replace-style-ref" } },
    );
    return;
  }
  const fill = cssColor(style.fill?.color, "#ffffff");
  const blur =
    effect.kind === "blur"
      ? Math.max(0.5, Math.min(24, effect.radiusPt))
      : effect.intensity === "strong"
        ? 10
        : effect.intensity === "medium"
          ? 6
          : 3;
  const glassOverlay =
    effect.kind === "glass"
      ? `<rect x="18" y="18" width="476" height="238" rx="48" fill="#ffffff" opacity="0.30"/><rect x="18" y="18" width="476" height="476" rx="48" fill="none" stroke="#ffffff" stroke-opacity="0.45" stroke-width="10"/>`
      : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><defs><filter id="fx" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${blur}"/></filter></defs><g filter="url(#fx)">${effectShapeBody(shape, fill)}</g>${glassOverlay}</svg>`;
  dc.warning(
    "unsupported-export-feature",
    `${ctx}: "${effect.kind}" effect uses image-retry fallback because PptxGenJS has no faithful native effect mapping`,
    {
      path: `${ctx}.effect`,
      action: { type: "replace-style-ref" },
      details: { exportFeature: "pptx-effect-image-retry" },
    },
  );
  return { kind: "image", assetId: svgDataUri(svg), fit: "cover" };
}

export function effectToNativeGlow(
  effect: EffectStyle | undefined,
  dc: DiagnosticCollector,
  ctx: string,
): VnextPptxEffect | undefined {
  if (!effect || effect.kind === "none") return undefined;
  if (effect.kind !== "glow") return undefined;
  if (!Number.isFinite(effect.blurPt) || effect.blurPt <= 0) {
    dc.warning(
      "unsupported-export-feature",
      `${ctx}: glow effect has invalid blur radius; retaining editable PPTX fallback`,
      { path: `${ctx}.effect`, action: { type: "replace-style-ref" } },
    );
    return undefined;
  }
  return {
    kind: "glow",
    color: resolveColor(effect.color, "#ffffff", dc, `${ctx}.effect.color`),
    blurPt: Math.max(0.5, Math.min(30, effect.blurPt)),
    ...(effect.opacity !== undefined
      ? { opacity: Math.max(0, Math.min(1, effect.opacity)) }
      : {}),
  };
}
export function fillToPptxFill(
  fill: FillStyle | undefined,
  dc: DiagnosticCollector,
  ctx: string,
): PptxFill | undefined {
  if (!fill) return undefined;
  if (fill.type === "solid")
    return resolveColor(fill.color, "#cccccc", dc, ctx);
  if (fill.type === "image") {
    if (!fill.assetId) {
      dc.warning(
        "unsupported-export-feature",
        `${ctx}: image fill has no asset for PPTX image-retry fallback; using no fill`,
        { path: ctx, action: { type: "open-asset-panel" } },
      );
      return undefined;
    }
    return { kind: "image", assetId: fill.assetId, fit: "cover" };
  }

  const detail =
    fill.type === "linearGradient" || fill.type === "radialGradient"
      ? `${fill.type} cannot be expressed by PptxGenJS 4.0.1 native fill props`
      : fill.type === "pattern"
        ? `pattern "${fill.kind}" cannot be expressed by PptxGenJS 4.0.1 native fill props`
        : `${fill.type} has no native PPTX fill mapping`;
  dc.warning(
    "unsupported-export-feature",
    `${ctx}: ${detail}; using image-retry fallback in PPTX export`,
    { path: ctx, action: { type: "replace-style-ref" } },
  );
  return { kind: "image", assetId: svgDataUri(fillSvg(fill)), fit: "cover" };
}

/** Converts a FillStyle to a hex color, emitting diagnostics for unsupported types. */
export function fillToHex(
  fill: FillStyle | undefined,
  dc: DiagnosticCollector,
  ctx: string,
): string | undefined {
  if (!fill) return undefined;
  if (fill.type === "solid") {
    return resolveColor(fill.color, "#cccccc", dc, ctx);
  }
  if (fill.type === "linearGradient") {
    dc.warning(
      "unsupported-export-feature",
      `${ctx}: linear gradient fill uses from-color fallback in PPTX export`,
      { path: ctx, action: { type: "replace-style-ref" } },
    );
    return resolveColor(fill.from, "#cccccc", dc, ctx);
  }
  if (fill.type === "radialGradient") {
    dc.warning(
      "unsupported-export-feature",
      `${ctx}: radial gradient fill uses inner-color fallback in PPTX export`,
      { path: ctx, action: { type: "replace-style-ref" } },
    );
    return resolveColor(fill.inner, "#cccccc", dc, ctx);
  }
  if (fill.type === "conicGradient") {
    dc.warning(
      "unsupported-export-feature",
      `${ctx}: conic gradient fill uses first-stop fallback in PPTX export`,
      { path: ctx, action: { type: "replace-style-ref" } },
    );
    return resolveColor(fill.stops[0]?.color, "#cccccc", dc, ctx);
  }
  if (fill.type === "repeatingLinearGradient") {
    dc.warning(
      "unsupported-export-feature",
      `${ctx}: repeating gradient fill uses first-stop fallback in PPTX export`,
      { path: ctx, action: { type: "replace-style-ref" } },
    );
    return resolveColor(fill.stops[0]?.color, "#cccccc", dc, ctx);
  }
  if (fill.type === "pattern") {
    dc.warning(
      "unsupported-export-feature",
      `${ctx}: pattern fill uses background/color fallback in PPTX export`,
      { path: ctx, action: { type: "replace-style-ref" } },
    );
    return resolveColor(fill.background ?? fill.color, "#cccccc", dc, ctx);
  }
  if (fill.type === "image") {
    dc.warning(
      "unsupported-export-feature",
      `${ctx}: image fill is not supported in PPTX export; using no fill`,
      { path: ctx, action: { type: "replace-style-ref" } },
    );
    return undefined;
  }
  return undefined;
}

/** Extracts text style options from a resolved StyleObject. */
export function styleToTextOptions(style: StyleObject): VnextPptxTextStyle {
  const text = style.text;
  if (!text) return {};
  return {
    ...(text.color !== undefined
      ? {
          color: typeof text.color === "string" ? toHex(text.color) : undefined,
        }
      : {}),
    ...(text.fontSizePt !== undefined ? { fontSize: text.fontSizePt } : {}),
    ...(typeof text.fontFamily === "string"
      ? { fontFace: slideFontExportFace(text.fontFamily) }
      : {}),
    ...(text.weight !== undefined && text.weight >= 700 ? { bold: true } : {}),
    ...(text.italic ? { italic: true } : {}),
    ...(text.underline ? { underline: true } : {}),
    ...(text.strikethrough ? { strikethrough: true } : {}),
    ...(text.align ? { align: text.align } : {}),
    ...(text.verticalAlign ? { valign: text.verticalAlign } : {}),
    ...(text.lineHeight !== undefined
      ? { lineHeightMultiple: text.lineHeight }
      : {}),
    ...(text.paragraphSpacingPt !== undefined
      ? { paragraphSpacePt: text.paragraphSpacingPt }
      : {}),
  };
}

/** Emits diagnostics for unsupported effect styles. */
export function checkEffect(
  style: StyleObject,
  dc: DiagnosticCollector,
  ctx: string,
): void {
  if (!style.effect) return;
  const kind = style.effect.kind;
  if (kind === "glass" || kind === "blur") {
    dc.warning(
      "unsupported-export-feature",
      `${ctx}: "${kind}" effect needs raster image-retry fallback; retaining editable PPTX fallback because no node raster asset is available`,
      { path: `${ctx}.effect`, action: { type: "replace-style-ref" } },
    );
  }
}
