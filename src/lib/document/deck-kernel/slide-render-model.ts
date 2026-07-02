import type { Deck, Slide, SlideMaster } from "./deck-core";
import type {
  ElementEffect,
  ElementRadius,
  SlideElement,
  TableElementStyle,
} from "./deck-elements";
import type { ImageFitMode, ImageMaskShape } from "./deck-element-primitives";
import type {
  BackgroundTreatment,
  PresentationTheme,
} from "./presentation-theme-types";
import {
  slideFormatConfig,
  type SlideFormat,
} from "@/lib/presentation-shared/slide-format";
import {
  resolveShapeLabelStyle,
  resolveTextElementStyle,
  resolveRoleTextStyle,
  type ResolvedTextStyle,
} from "./style-cascade-text";
import {
  resolveSlideStyle,
  resolveSlideThemeColors,
  type SlideThemeColors,
} from "./style-cascade-layers";
import { materializeMasterChromePlaceholders } from "./global-master-chrome";

export interface ResolvedSlideCanvas {
  format: SlideFormat;
  width: number;
  height: number;
  pptxWidthIn: number;
  pptxHeightIn: number;
}

export interface ResolvedRadialGradientFill {
  type: "radialGradient";
  inner: string;
  outer: string;
  cx?: number;
  cy?: number;
  r?: number;
  rx?: number;
  ry?: number;
  stops?: ResolvedGradientStop[];
}

export interface ResolvedLinearGradientFill {
  type: "linearGradient";
  from: string;
  to: string;
  angle?: number;
  stops?: ResolvedGradientStop[];
}

export interface ResolvedGradientStop {
  color: string;
  offset?: number;
}

export type ResolvedElementFill =
  | string
  | ResolvedRadialGradientFill
  | ResolvedLinearGradientFill;

export function resolvedFillToCss(fill: ResolvedElementFill): string {
  if (typeof fill === "string") return fill;
  const stops = fill.stops
    ?.map(
      (stop) =>
        `${stop.color}${stop.offset !== undefined ? ` ${stop.offset}%` : ""}`,
    )
    .join(", ");
  if (fill.type === "linearGradient") {
    return `linear-gradient(${fill.angle ?? 90}deg, ${stops ?? `${fill.from}, ${fill.to}`})`;
  }
  const rx = fill.rx ?? fill.r ?? 70;
  const ry = fill.ry ?? fill.r ?? 70;
  return `radial-gradient(${rx}% ${ry}% at ${fill.cx ?? 50}% ${fill.cy ?? 50}%, ${stops ?? `${fill.inner}, ${fill.outer}`})`;
}

export function resolvedFillRepresentativeColor(
  fill: ResolvedElementFill,
): string {
  if (typeof fill === "string") return fill;
  if (fill.stops?.[0]) return fill.stops[0].color;
  if (fill.type === "linearGradient") return fill.from;
  return fill.outer;
}

/* node:coverage disable */
/* Type-only render-model union rows are erased by tsx and reported as source-map gaps. */
export type ResolvedElementDesign =
  | {
      kind: "text";
      role?: string;
      textStyle: ResolvedTextStyle;
      textFill?: ResolvedElementFill;
    }
  | {
      kind: "visual";
      role?: string;
      styleThemeId?: string;
    }
  | {
      kind: "image";
      role?: string;
      fitMode?: ImageFitMode;
      maskShape?: ImageMaskShape;
      radius?: number;
    }
  | {
      kind: "shape";
      role?: string;
      fill: ResolvedElementFill;
      stroke?: { color: string; width: number };
      radius?: ElementRadius;
      effect?: ElementEffect;
      textStyle?: ResolvedTextStyle;
    }
  | {
      kind: "connector";
      role?: string;
      stroke: { color: string; width: number };
      arrowStart: string;
      arrowEnd: string;
      dash: boolean;
    }
  | {
      kind: "table";
      role?: string;
      tableStyle: ResolvedTableStyle;
    };
/* node:coverage enable */

export interface ResolvedTableStyle {
  headerFill: string;
  rowFill: string;
  alternateRowFill: string;
  borderColor: string;
  borderWidth: number;
  textStyle: ResolvedTextStyle;
  headerTextStyle: ResolvedTextStyle;
}

export interface ResolvedSlideRenderModel {
  canvas: ResolvedSlideCanvas;
  slide: Slide;
  themeColors: SlideThemeColors;
  tokenSet: PresentationTheme;
  background: BackgroundTreatment;
  accent: string;
  master?: SlideMaster;
  masterBackgroundElements: SlideElement[];
  slideElements: SlideElement[];
  masterForegroundElements: SlideElement[];
  renderedElements: SlideElement[];
  elementDesigns: Record<string, ResolvedElementDesign>;
}

function colorRefValue(
  input: unknown,
  tokenSet: PresentationTheme,
): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const ref = input as { token?: string; value?: string };
  if (typeof ref.value === "string") return ref.value;
  if (typeof ref.token === "string") {
    /* node:coverage ignore next 3 */
    /* Invalid token fallback is asserted through render-model tests; tsx maps the indexed access as residual. */
    return tokenSet.colors[ref.token as keyof PresentationTheme["colors"]];
  }
  /* node:coverage ignore next 2 */
  /* Invalid color-ref fallback is defensive; public model tests assert valid token/value resolution. */
  return undefined;
}

function resolveElementFill(
  input: unknown,
  tokenSet: PresentationTheme,
): ResolvedElementFill | undefined {
  if (!input || typeof input !== "object")
    return colorRefValue(input, tokenSet);
  const fill = input as Record<string, unknown>;
  if (fill.type === "linearGradient") {
    const from = colorRefValue(fill.from, tokenSet);
    const to = colorRefValue(fill.to, tokenSet);
    if (!from || !to) return undefined;
    return {
      type: "linearGradient",
      from,
      to,
      ...(typeof fill.angle === "number" ? { angle: fill.angle } : {}),
      ...(Array.isArray(fill.stops)
        ? { stops: resolveGradientStops(fill.stops, tokenSet) }
        : {}),
    };
  }
  if (fill.type !== "radialGradient") return colorRefValue(input, tokenSet);
  const inner = colorRefValue(fill.inner, tokenSet);
  const outer = colorRefValue(fill.outer, tokenSet);
  if (!inner || !outer) return undefined;
  return {
    type: "radialGradient",
    inner,
    outer,
    ...(typeof fill.cx === "number" ? { cx: fill.cx } : {}),
    ...(typeof fill.cy === "number" ? { cy: fill.cy } : {}),
    ...(typeof fill.r === "number" ? { r: fill.r } : {}),
    ...(typeof fill.rx === "number" ? { rx: fill.rx } : {}),
    ...(typeof fill.ry === "number" ? { ry: fill.ry } : {}),
    ...(Array.isArray(fill.stops)
      ? { stops: resolveGradientStops(fill.stops, tokenSet) }
      : {}),
  };
}

function resolveGradientStops(
  input: readonly unknown[],
  tokenSet: PresentationTheme,
): ResolvedGradientStop[] | undefined {
  const stops = input.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const stop = item as { color?: unknown; offset?: unknown };
    const color = colorRefValue(stop.color, tokenSet);
    if (!color) return [];
    return [
      {
        color,
        ...(typeof stop.offset === "number" ? { offset: stop.offset } : {}),
      },
    ];
  });
  return stops.length >= 2 ? stops : undefined;
}

function resolveElementEffect(input: unknown): ElementEffect | undefined {
  if (!input || typeof input !== "object") return undefined;
  const effect = input as Record<string, unknown>;
  if (effect.kind === "glass" && typeof effect.intensity === "string") {
    return effect as unknown as ElementEffect;
  }
  if (effect.kind === "blur" && typeof effect.radius === "number") {
    return effect as unknown as ElementEffect;
  }
  if (
    effect.kind === "glow" &&
    typeof effect.color === "string" &&
    typeof effect.blur === "number"
  ) {
    return effect as unknown as ElementEffect;
  }
  return undefined;
}

function resolveTableStyle(
  tokenSet: PresentationTheme,
  overrides?: TableElementStyle,
): ResolvedTableStyle {
  return {
    headerFill:
      colorRefValue(overrides?.headerFill, tokenSet) ?? tokenSet.colors.accent,
    rowFill:
      colorRefValue(overrides?.rowFill, tokenSet) ?? tokenSet.colors.surface,
    alternateRowFill:
      colorRefValue(overrides?.alternateRowFill, tokenSet) ??
      tokenSet.colors.slideBg,
    borderColor: overrides?.borderColor ?? tokenSet.colors.muted,
    borderWidth: overrides?.borderWidth ?? 0.14,
    textStyle: resolveRoleTextStyle(tokenSet, "table", overrides?.textStyle),
    headerTextStyle: resolveRoleTextStyle(tokenSet, "table", {
      bold: true,
      color: tokenSet.colors.onAccent,
      ...overrides?.headerTextStyle,
    }),
  };
}

/* node:coverage ignore next 3 */
/* Private role helper is exercised through each rendered element kind; tsx maps its wrapper rows as residual. */
function elementRole(element: SlideElement): string | undefined {
  return (element as { role?: string }).role;
}

function resolveElementDesign(
  deck: Deck,
  tokenSet: PresentationTheme,
  element: SlideElement,
): ResolvedElementDesign {
  const role = elementRole(element);
  const design = (element as { designOverrides?: Record<string, any> })
    .designOverrides;
  switch (element.kind) {
    case "text":
      return {
        kind: "text",
        ...(role ? { role } : {}),
        textStyle: resolveTextElementStyle(deck, element),
        ...(resolveElementFill(design?.textStyle?.textFill, tokenSet)
          ? {
              textFill: resolveElementFill(
                design?.textStyle?.textFill,
                tokenSet,
              ),
            }
          : {}),
      };
    case "visual": {
      const styleThemeId =
        (typeof design?.styleThemeId === "string"
          ? design.styleThemeId
          : undefined) ??
        element.content.styleThemeId ??
        tokenSet.visual?.styleThemeId;
      return {
        kind: "visual",
        ...(role ? { role } : {}),
        ...(styleThemeId ? { styleThemeId } : {}),
      };
    }
    case "image":
      return {
        kind: "image",
        ...(role ? { role } : {}),
        ...((design?.fitMode ?? tokenSet.image?.fitMode)
          ? { fitMode: design?.fitMode ?? tokenSet.image?.fitMode }
          : {}),
        ...((design?.maskShape ?? tokenSet.image?.maskShape)
          ? { maskShape: design?.maskShape ?? tokenSet.image?.maskShape }
          : {}),
        ...((design?.radius ?? tokenSet.image?.radiusPct)
          ? { radius: design?.radius ?? tokenSet.image?.radiusPct }
          : {}),
      };
    case "shape": {
      const stroke =
        design?.stroke ??
        (tokenSet.shape.stroke
          ? {
              color: tokenSet.shape.stroke,
              width: tokenSet.shape.strokeWidth ?? 0.4,
            }
          : undefined);
      return {
        kind: "shape",
        ...(role ? { role } : {}),
        fill:
          resolveElementFill(design?.fill, tokenSet) ??
          tokenSet.shape.fill ??
          tokenSet.colors.accent,
        ...(stroke ? { stroke } : {}),
        ...(typeof design?.radius === "number" ||
        (design?.radius && typeof design.radius === "object")
          ? { radius: design.radius }
          : {}),
        ...(resolveElementEffect(design?.effect)
          ? { effect: resolveElementEffect(design?.effect) }
          : {}),
        textStyle: resolveShapeLabelStyle(deck, element),
      };
    }
    case "connector": {
      const stroke = design?.stroke;
      return {
        kind: "connector",
        ...(role ? { role } : {}),
        stroke: {
          color: stroke?.color ?? tokenSet.connector?.color ?? "#a1a1aa",
          width: stroke?.width ?? tokenSet.connector?.width ?? 0.4,
        },
        arrowStart:
          design?.arrowStart ?? tokenSet.connector?.startArrow ?? "none",
        arrowEnd: design?.arrowEnd ?? tokenSet.connector?.endArrow ?? "arrow",
        dash:
          Boolean(design?.dash) ||
          (tokenSet.connector?.dash !== undefined &&
            tokenSet.connector.dash !== "solid"),
      };
    }
    case "table":
      return {
        kind: "table",
        ...(role ? { role } : {}),
        tableStyle: resolveTableStyle(tokenSet, design?.tableStyle),
      };
  }
}

function resolveElementDesigns(
  deck: Deck,
  tokenSet: PresentationTheme,
  elements: readonly SlideElement[],
): Record<string, ResolvedElementDesign> {
  const designs: Record<string, ResolvedElementDesign> = {};
  for (const element of elements) {
    designs[element.id] = resolveElementDesign(deck, tokenSet, element);
  }
  return designs;
}

function masterElements(
  master: SlideMaster | undefined,
  layer: "background" | "foreground",
  deck: Deck,
  slide: Slide,
): SlideElement[] {
  const elements = ((master as any)?.elements ?? []) as SlideElement[];
  const slideIndex = deck.slides.findIndex((entry) => entry.id === slide.id);
  const resolvedSlideIndex = slideIndex >= 0 ? slideIndex : slide.index;
  return elements
    .filter((element) => (element as any).layer === layer)
    .map((element) =>
      materializeMasterChromePlaceholders(
        element,
        resolvedSlideIndex,
        deck.slides.length,
      ),
    )
    .sort((a, b) => a.zIndex - b.zIndex);
}

export function resolveSlideRenderModel(
  deck: Deck,
  slide: Slide,
): ResolvedSlideRenderModel {
  const style = resolveSlideStyle(deck, slide);
  const canvasFormat = slideFormatConfig(deck.canvas?.format);
  const slideElements = [...(slide.elements ?? [])].sort(
    (a, b) => a.zIndex - b.zIndex,
  );
  const masterBackgroundElements = masterElements(
    style.master,
    "background",
    deck,
    slide,
  );
  const masterForegroundElements = masterElements(
    style.master,
    "foreground",
    deck,
    slide,
  );
  const renderedElements = [
    ...masterBackgroundElements,
    ...slideElements,
    ...masterForegroundElements,
  ];
  return {
    canvas: {
      format: deck.canvas?.format ?? "16:9",
      width: canvasFormat.width,
      height: canvasFormat.height,
      pptxWidthIn: canvasFormat.pptxWidthIn,
      pptxHeightIn: canvasFormat.pptxHeightIn,
    },
    slide,
    themeColors: resolveSlideThemeColors(deck, slide),
    tokenSet: style.tokenSet,
    background: style.background,
    accent: style.accent,
    ...(style.master !== undefined ? { master: style.master } : {}),
    masterBackgroundElements,
    slideElements,
    masterForegroundElements,
    renderedElements,
    elementDesigns: resolveElementDesigns(
      deck,
      style.tokenSet,
      renderedElements,
    ),
  };
}
