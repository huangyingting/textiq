import type { CanvasSpec } from "../types";
import type { FillStyle, StyleObject } from "../style-schema";
import type { DiagnosticCollector } from "../diagnostics";
import type { VnextPptxLayout, VnextPptxTextStyle } from "../pptx-export-types";

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
      ? { fontFace: text.fontFamily }
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
  if (kind === "glass" || kind === "blur" || kind === "glow") {
    dc.warning(
      "unsupported-export-feature",
      `${ctx}: "${kind}" effect uses a deterministic export fallback`,
      { path: ctx, action: { type: "replace-style-ref" } },
    );
  }
}
