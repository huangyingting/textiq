/**
 * Pure, DOM-free transform from a {@link Deck} into an ordered array of
 * {@link DeckSlideSpec} descriptors. One spec is produced per `deck.slides`
 * entry, in order.
 *
 * This module owns the spec descriptor types (DeckOp family, DeckSlideSpec)
 * and the `buildDeckSpecs` function. It has no browser or PptxGenJS
 * dependencies and is fully testable under `node --test`.
 *
 * Units: the deck uses percentage-based element boxes; `buildDeckSpecs`
 * converts them to inches against the chosen slide format's physical
 * dimensions. Font sizes are authored as a percent of slide height (`cqh`)
 * and converted to points.
 */

import type { Deck, Slide } from "../deck-core";
import type {
  ElementEffect,
  ElementAlign,
  ElementBox,
  ImageCrop,
  ImageFitMode,
  ImageMaskShape,
  ShapeKind,
  SlideElement,
  TableElement,
  TextElementStyle,
  TextFitMode,
  TextRun,
} from "../deck-elements";
import { resolveConnectorElementPoints } from "../connector-geometry";
import { normalizeTextParagraphs } from "../deck-elements";
import {
  slideFormatConfig,
  type SlideFormat,
} from "@/lib/document/deck-kernel/slide-format";
import {
  resolvedFillRepresentativeColor,
  resolveSlideRenderModel,
  type ResolvedElementFill,
} from "../slide-render-model";
import { slideFontExportFace } from "../slide-fonts";
import {
  adaptShapeLabelForExport,
  adaptTextElementForExport,
} from "../style-export-normalizers";
import { slideHeightPctToPoints } from "../style-units";
import type { Visual } from "@/lib/visual/schema";
import {
  buildDeckImageOp,
  buildDeckVisualOp,
} from "@/lib/visual/deck-fallback-ops";
import { toHex, type PptxSpec } from "@/lib/visual/pptx-shapes";
import { assertNever } from "@/lib/assert-never";

// ---------------------------------------------------------------------------
// Slide geometry
// ---------------------------------------------------------------------------

export interface DeckGeometry {
  pptxLayout: "LAYOUT_WIDE" | "LAYOUT_4X3";
  slideW: number;
  slideH: number;
  slideHPt: number;
}

export function deckGeometry(format: SlideFormat | undefined): DeckGeometry {
  const config = slideFormatConfig(format);
  return {
    pptxLayout: config.pptxLayout,
    slideW: config.pptxWidthIn,
    slideH: config.pptxHeightIn,
    slideHPt: config.pptxHeightIn * 72,
  };
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object"
    ? (value as Record<string, any>)
    : {};
}

function deckFormat(deck: Deck): SlideFormat | undefined {
  return (deck as any).canvas?.format as SlideFormat | undefined;
}

function elementContent(element: SlideElement): Record<string, any> {
  return record((element as any).content);
}

function elementDesign(element: SlideElement): Record<string, any> {
  return record((element as any).designOverrides);
}

function textStyleOverride(
  element: SlideElement,
): Partial<TextElementStyle> | undefined {
  const design = elementDesign(element);
  return design.textStyle;
}

function colorRefValue(
  input: unknown,
  tokenSet: ReturnType<typeof resolveSlideRenderModel>["tokenSet"],
): string | undefined {
  if (typeof input === "string") return input;
  if (!input || typeof input !== "object") return undefined;
  const ref = input as { token?: string; value?: string };
  if (typeof ref.value === "string") return ref.value;
  if (typeof ref.token === "string") {
    return tokenSet.colors[ref.token as keyof typeof tokenSet.colors];
  }
  return undefined;
}

function exportTextRuns(
  runs: readonly TextRun[] | undefined,
  slideHeightPt: number,
): TextRun[] | undefined {
  if (!runs || runs.length === 0) return undefined;
  return runs.map((run) => ({
    ...run,
    ...(run.fontSize !== undefined
      ? { fontSize: slideHeightPctToPoints(run.fontSize, slideHeightPt) }
      : {}),
  }));
}

function tableTextOp({
  box,
  text,
  runs,
  color,
  fontSize,
  fontFamily,
  bold,
  italic,
  underline,
  align,
  geometry,
}: {
  box: InchBox;
  text: string;
  runs?: TextRun[];
  color: string;
  fontSize: number;
  fontFamily?: string;
  bold: boolean;
  italic: boolean;
  underline?: boolean;
  align: ElementAlign;
  geometry: DeckGeometry;
}): DeckTextOp {
  const fontFace = slideFontExportFace(fontFamily, text);
  return {
    kind: "text",
    ...box,
    text,
    ...(runs && runs.length > 0
      ? { runs: exportTextRuns(runs, geometry.slideHPt) }
      : {}),
    color: toHex(color),
    fontSize: slideHeightPctToPoints(fontSize, geometry.slideHPt),
    ...(fontFace ? { fontFace } : {}),
    bold,
    italic,
    ...(underline ? { underline: true } : {}),
    align,
    verticalAlign: "middle",
    fitMode: "shrink-to-fit",
  };
}

function buildTableOps(
  element: TableElement,
  box: InchBox,
  renderModel: ReturnType<typeof resolveSlideRenderModel>,
  geometry: DeckGeometry,
): DeckOp[] {
  const design = renderModel.elementDesigns[element.id];
  const tableStyle = design?.kind === "table" ? design.tableStyle : undefined;
  const headerFill = tableStyle?.headerFill ?? renderModel.accent;
  const rowFill = tableStyle?.rowFill ?? renderModel.tokenSet.colors.surface;
  const alternateRowFill =
    tableStyle?.alternateRowFill ?? renderModel.tokenSet.colors.slideBg;
  const borderColor =
    tableStyle?.borderColor ?? renderModel.tokenSet.colors.muted;
  const borderWidthPt = Math.max(
    0.25,
    ((tableStyle?.borderWidth ?? 0.14) / 100) *
      Math.min(geometry.slideW, geometry.slideH) *
      72,
  );
  const bodyText = tableStyle?.textStyle;
  const headerText = tableStyle?.headerTextStyle;
  const bodyFontSize = bodyText?.fontSize ?? 2.2;
  const headerFontSize = headerText?.fontSize ?? bodyFontSize;
  const captionH = element.content.caption ? Math.min(box.h * 0.16, 0.34) : 0;
  const tableH = Math.max(0.1, box.h - captionH);
  const rowCount =
    element.content.rows.length + (element.content.header ? 1 : 0);
  const rowH = tableH / Math.max(1, rowCount);
  const totalColumnWidth = element.content.columns.reduce(
    (sum, column) => sum + (column.width ?? 1),
    0,
  );
  const columnWidths = element.content.columns.map(
    (column) => ((column.width ?? 1) / totalColumnWidth) * box.w,
  );
  const ops: DeckOp[] = [];

  function cellBox(rowIndex: number, columnIndex: number): InchBox {
    const x =
      box.x +
      columnWidths.slice(0, columnIndex).reduce((sum, width) => sum + width, 0);
    return {
      x,
      y: box.y + rowIndex * rowH,
      w: columnWidths[columnIndex] ?? 0,
      h: rowH,
      ...(box.rotation !== undefined ? { rotation: box.rotation } : {}),
      ...(box.opacity !== undefined ? { opacity: box.opacity } : {}),
    };
  }

  function insetTextBox(input: InchBox): InchBox {
    const padX = Math.min(0.08, input.w * 0.12);
    const padY = Math.min(0.04, input.h * 0.2);
    return {
      x: input.x + padX,
      y: input.y + padY,
      w: Math.max(0.01, input.w - padX * 2),
      h: Math.max(0.01, input.h - padY * 2),
      ...(input.rotation !== undefined ? { rotation: input.rotation } : {}),
      ...(input.opacity !== undefined ? { opacity: input.opacity } : {}),
    };
  }

  let rowOffset = 0;
  if (element.content.header) {
    element.content.columns.forEach((column, columnIndex) => {
      const cell = cellBox(0, columnIndex);
      ops.push({
        kind: "shape",
        ...cell,
        shape: "rect",
        color: toHex(headerFill),
        stroke: { color: toHex(borderColor), width: borderWidthPt },
      });
      ops.push(
        tableTextOp({
          box: insetTextBox(cell),
          text: column.label,
          color: headerText?.color ?? renderModel.tokenSet.colors.onAccent,
          fontSize: headerFontSize,
          fontFamily: headerText?.fontFamily ?? bodyText?.fontFamily,
          bold: headerText ? headerText.weight >= 600 : true,
          italic: headerText?.italic ?? false,
          underline: headerText?.underline,
          align: headerText?.align ?? bodyText?.align ?? "left",
          geometry,
        }),
      );
    });
    rowOffset = 1;
  }

  element.content.rows.forEach((row, rowIndex) => {
    row.cells.forEach((cellContent, columnIndex) => {
      const cell = cellBox(rowIndex + rowOffset, columnIndex);
      ops.push({
        kind: "shape",
        ...cell,
        shape: "rect",
        color: toHex(rowIndex % 2 === 1 ? alternateRowFill : rowFill),
        stroke: { color: toHex(borderColor), width: borderWidthPt },
      });
      ops.push(
        tableTextOp({
          box: insetTextBox(cell),
          text: cellContent.text,
          runs: cellContent.runs,
          color: bodyText?.color ?? renderModel.tokenSet.colors.onSurface,
          fontSize: bodyFontSize,
          fontFamily: bodyText?.fontFamily,
          bold: bodyText ? bodyText.weight >= 600 : false,
          italic: bodyText?.italic ?? false,
          underline: bodyText?.underline,
          align: bodyText?.align ?? "left",
          geometry,
        }),
      );
    });
  });

  if (element.content.caption && captionH > 0) {
    ops.push(
      tableTextOp({
        box: {
          x: box.x,
          y: box.y + tableH,
          w: box.w,
          h: captionH,
          ...(box.rotation !== undefined ? { rotation: box.rotation } : {}),
          ...(box.opacity !== undefined ? { opacity: box.opacity } : {}),
        },
        text: element.content.caption,
        color: bodyText?.color ?? renderModel.tokenSet.colors.muted,
        fontSize: Math.max(0.8, bodyFontSize * 0.8),
        fontFamily: bodyText?.fontFamily,
        bold: false,
        italic: bodyText?.italic ?? false,
        underline: bodyText?.underline,
        align: bodyText?.align ?? "left",
        geometry,
      }),
    );
  }

  return ops;
}

// ---------------------------------------------------------------------------
// Slide-spec descriptor model (pure, DOM-free)
// ---------------------------------------------------------------------------

/** Inch-space rectangle. */
interface InchBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Optional clockwise rotation in degrees (mirrors `element.rotation`). */
  rotation?: number;
  /** Optional drop shadow (mirrors `element.shadow`). */
  shadow?: boolean;
  /** Optional opacity in the `[0, 1]` range. */
  opacity?: number;
}

/** A run of text (single block) placed at an inch box. */
export interface DeckTextOp extends InchBox {
  kind: "text";
  text: string;
  /**
   * Optional rich-text runs for `text`. When present, the applier emits
   * run-level bold/italic/code/color formatting; absent → the plain `text`
   * string with the op-level defaults below.
   */
  runs?: TextRun[];
  /** Hex color without leading `#`. */
  color: string;
  /** Font size in points. */
  fontSize: number;
  /** Optional preferred font face (first resolved family only). */
  fontFace?: string;
  bold: boolean;
  italic: boolean;
  underline?: boolean;
  align: ElementAlign;
  /** Vertical alignment of text within its box. */
  verticalAlign?: "top" | "middle" | "bottom";
  /** CSS line-height multiplier. */
  lineHeight?: number;
  /** Extra space below the text block, in points. */
  paragraphSpacingPt?: number;
  /** How content that exceeds the box is handled (mirrors `TextFitMode`). */
  fitMode?: TextFitMode;
}

/** A bulleted list placed at an inch box. */
export interface DeckBulletsOp extends InchBox {
  kind: "bullets";
  items: string[];
  underline?: boolean;
  /**
   * Optional rich-text runs, parallel to `items`: `itemRuns[i]` holds the
   * formatted spans for bullet line `i`. When an entry is present and non-empty
   * the applier emits run-level formatting for that line; otherwise it falls
   * back to the plain `items[i]` string.
   */
  itemRuns?: TextRun[][];
  /**
   * Per-item indent and list-type metadata (#335).  Parallel to `items`.
   * When present, `applyBulletsOp` uses indent levels and numbered-list
   * markers instead of the default flat bullet.
   */
  itemDetails?: ReadonlyArray<{
    indent?: number;
    listType?: "bullet" | "number";
  }>;
  color: string;
  fontSize: number;
  /** Optional preferred font face (first resolved family only). */
  fontFace?: string;
  bold: boolean;
  italic: boolean;
  align: ElementAlign;
  /** Vertical alignment of the bullet list within its box. */
  verticalAlign?: "top" | "middle" | "bottom";
  /** CSS line-height multiplier. */
  lineHeight?: number;
  /** How content that exceeds the box is handled (mirrors `TextFitMode`). */
  fitMode?: TextFitMode;
}

/** A primitive shape placed at an inch box. */
export interface DeckShapeOp extends InchBox {
  kind: "shape";
  shape: ShapeKind;
  /** Hex color without leading `#`. */
  color: string;
  /** Optional rich fill; strings are hex colors without leading `#`. */
  fill?:
    | string
    | {
        type: "radialGradient";
        inner: string;
        outer: string;
        cx?: number;
        cy?: number;
        r?: number;
        rx?: number;
        ry?: number;
        stops?: { color: string; offset?: number }[];
      }
    | {
        type: "linearGradient";
        from: string;
        to: string;
        angle?: number;
        stops?: { color: string; offset?: number }[];
      };
  effect?: ElementEffect;
  /** Optional centered label inside the shape. */
  text?: string;
  textRuns?: TextRun[];
  textColor?: string;
  fontSize?: number;
  fontFace?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: ElementAlign;
  /** Optional border/line stroke; `width` already converted to points. */
  stroke?: { color: string; width: number; dash?: boolean };
  /** Optional rect corner radius, already converted to inches. */
  radius?: number;
}

/** A raster image (data URL or path) placed at an inch box. */
export interface DeckImageOp extends InchBox {
  kind: "image";
  src: string;
  alt?: string;
  fitMode?: ImageFitMode;
  maskShape?: ImageMaskShape;
  crop?: ImageCrop;
  radius?: number;
}

/** A first-class connector element drawn between two absolute inch-space points. */
export interface DeckConnectorOp {
  kind: "connector";
  /** Start point in inches. */
  x1: number;
  y1: number;
  /** End point in inches. */
  x2: number;
  y2: number;
  /** Hex stroke color without leading `#`. */
  color: string;
  /** Stroke width in points. */
  width: number;
  /** When true the connector is rendered with a dash pattern. */
  dash?: boolean;
  /** Arrowhead at the start end of the line. */
  arrowStart?: "none" | "arrow" | "filled";
  /** Arrowhead at the end of the line. */
  arrowEnd?: "none" | "arrow" | "filled";
  /** Optional opacity in the `[0, 1]` range. */
  opacity?: number;
}

/** A visual rendered as native PptxGenJS shapes (no rasterisation needed). */
export interface DeckVisualNativeOp {
  kind: "visual-native";
  specs: PptxSpec[];
}

/** A visual that must be rasterised from its live SVG at apply time. */
export interface DeckVisualFallbackOp extends InchBox {
  kind: "visual-fallback";
  visualId: string;
}

export type DeckOp =
  | DeckTextOp
  | DeckBulletsOp
  | DeckShapeOp
  | DeckImageOp
  | DeckVisualNativeOp
  | DeckVisualFallbackOp
  | DeckConnectorOp;

/** One slide's worth of background + ordered draw operations. */
export interface DeckSlideSpec {
  /** Zero-based slide position, preserving `deck.slides` order. */
  index: number;
  /** Slide background — hex color without leading `#`. */
  background: string;
  /** Optional rich slide background fill for image/SVG exports. */
  backgroundFill?: DeckShapeOp["fill"];
  /** Optional background image (data URL or path); takes precedence in render. */
  backgroundImage?: string;
  /** Slide accent — hex color without leading `#`. */
  accent: string;
  /** Draw operations in z-order (earlier = drawn first / underneath). */
  ops: DeckOp[];
}

// ---------------------------------------------------------------------------
// Shared text-style helper
// ---------------------------------------------------------------------------

/** Normalised text-style fields common to {@link DeckTextOp} and {@link DeckBulletsOp}. */
export interface ExportTextStyle {
  /** Hex color without leading `#`. */
  color: string;
  /** Font size in points. */
  fontSize: number;
  fontFace?: string;
  bold: boolean;
  italic: boolean;
  underline?: boolean;
  align: ElementAlign;
  /** Vertical alignment of text within its box. */
  verticalAlign?: "top" | "middle" | "bottom";
  /** CSS line-height multiplier. */
  lineHeight?: number;
}

/**
 * Extract the text-styling fields shared by {@link DeckTextOp} and
 * {@link DeckBulletsOp} into a single {@link ExportTextStyle} record.
 *
 * Both the PPTX applier (`deck-export-pptx.ts`) and the SVG renderer
 * (`deck-export-slide-images.ts`) call this helper, giving the set of
 * "text style" properties a single definition.
 */
export function toExportTextStyle(
  op: Pick<
    DeckTextOp,
    | "color"
    | "fontSize"
    | "fontFace"
    | "bold"
    | "italic"
    | "underline"
    | "align"
    | "verticalAlign"
    | "lineHeight"
  >,
): ExportTextStyle {
  return {
    color: op.color,
    fontSize: op.fontSize,
    bold: op.bold,
    italic: op.italic,
    align: op.align,
    ...(op.fontFace !== undefined ? { fontFace: op.fontFace } : {}),
    ...(op.underline ? { underline: true } : {}),
    ...(op.verticalAlign !== undefined
      ? { verticalAlign: op.verticalAlign }
      : {}),
    ...(op.lineHeight !== undefined ? { lineHeight: op.lineHeight } : {}),
  };
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Convert a percentage {@link ElementBox} to an inch-space box. */
function boxToInches(box: ElementBox, geometry: DeckGeometry): InchBox {
  return {
    x: (box.x / 100) * geometry.slideW,
    y: (box.y / 100) * geometry.slideH,
    w: (box.w / 100) * geometry.slideW,
    h: (box.h / 100) * geometry.slideH,
  };
}

function exportResolvedFill(
  fill: ResolvedElementFill,
): NonNullable<DeckShapeOp["fill"]> {
  if (typeof fill === "string") return toHex(fill);
  if (fill.type === "linearGradient") {
    return {
      type: "linearGradient",
      from: toHex(fill.from),
      to: toHex(fill.to),
      ...(fill.angle !== undefined ? { angle: fill.angle } : {}),
      ...(fill.stops
        ? {
            stops: fill.stops.map((stop) => ({
              color: toHex(stop.color),
              ...(stop.offset !== undefined ? { offset: stop.offset } : {}),
            })),
          }
        : {}),
    };
  }
  return {
    type: "radialGradient",
    inner: toHex(fill.inner),
    outer: toHex(fill.outer),
    ...(fill.cx !== undefined ? { cx: fill.cx } : {}),
    ...(fill.cy !== undefined ? { cy: fill.cy } : {}),
    ...(fill.r !== undefined ? { r: fill.r } : {}),
    ...(fill.rx !== undefined ? { rx: fill.rx } : {}),
    ...(fill.ry !== undefined ? { ry: fill.ry } : {}),
    ...(fill.stops
      ? {
          stops: fill.stops.map((stop) => ({
            color: toHex(stop.color),
            ...(stop.offset !== undefined ? { offset: stop.offset } : {}),
          })),
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Pure transform: Deck → DeckSlideSpec[]
// ---------------------------------------------------------------------------

/**
 * Pure, DOM-free transform turning a {@link Deck} into an ordered array of
 * {@link DeckSlideSpec}. One spec is produced per `deck.slides` entry, in order.
 *
 * @param deck     The edited deck (from `deckJson`).
 * @param visuals  Lookup of visual payloads by id, used for native shape mapping.
 */
export function buildDeckSpecs(
  deck: Deck,
  visuals: ReadonlyMap<string, Visual>,
): DeckSlideSpec[] {
  const geometry = deckGeometry(deckFormat(deck));
  return deck.slides.map((slide, index) =>
    buildSlideSpec(deck, slide, index, visuals, geometry),
  );
}

function buildSlideSpec(
  deck: Deck,
  slide: Slide,
  index: number,
  visuals: ReadonlyMap<string, Visual>,
  geometry: DeckGeometry,
): DeckSlideSpec {
  const renderModel = resolveSlideRenderModel(deck, slide);
  const backgroundFill =
    renderModel.background.type === "radialGradient"
      ? exportResolvedFill(renderModel.background)
      : undefined;
  const background = toHex(
    renderModel.background.type === "solid"
      ? renderModel.background.color
      : renderModel.background.type === "gradient"
        ? renderModel.background.from
        : renderModel.background.type === "radialGradient"
          ? renderModel.background.outer
          : "#ffffff",
  );
  const accent = toHex(renderModel.accent);

  const elements = renderModel.renderedElements
    .filter((element) => !element.hidden)
    .map((element) => element);

  const ops: DeckOp[] = [];

  for (const element of elements) {
    const elementBox = element.box;
    const elementRotation = element.rotation;
    const box = boxToInches(elementBox, geometry);
    if (elementRotation) {
      box.rotation = elementRotation;
    }
    if (element.shadow) {
      box.shadow = true;
    }
    if (element.opacity !== undefined && element.opacity < 1) {
      box.opacity = Math.max(0, Math.min(1, element.opacity));
    }

    switch (element.kind) {
      case "text": {
        const content = elementContent(element);
        const resolvedTextStyle = textStyleOverride(element);
        const exportStyle = adaptTextElementForExport(
          deck,
          element,
          geometry.slideHPt,
        );
        const verticalAlign = resolvedTextStyle?.verticalAlign;
        const fitMode = content.fitMode;
        const paragraphs = normalizeTextParagraphs(element);
        const hasListParagraphs = paragraphs.some(
          (paragraph) => paragraph.listType !== undefined,
        );
        if (hasListParagraphs) {
          const hasRichRuns = paragraphs.some(
            (paragraph) => paragraph.runs && paragraph.runs.length > 0,
          );
          const hasItemMeta = paragraphs.some(
            (paragraph) =>
              (paragraph.indent ?? 0) !== 0 || paragraph.listType === "number",
          );
          const bulletsFontFace = slideFontExportFace(
            exportStyle.resolved.fontFamily,
            paragraphs.map((paragraph) => paragraph.text).join(" "),
          );
          ops.push({
            kind: "bullets",
            ...box,
            items: paragraphs.map((paragraph) => paragraph.text),
            ...(hasRichRuns
              ? {
                  itemRuns: paragraphs.map(
                    (paragraph) =>
                      exportTextRuns(paragraph.runs, geometry.slideHPt) ?? [],
                  ),
                }
              : {}),
            ...(hasItemMeta
              ? {
                  itemDetails: paragraphs.map((paragraph) => ({
                    indent: paragraph.indent,
                    listType: paragraph.listType,
                  })),
                }
              : {}),
            color: toHex(exportStyle.color),
            fontSize: exportStyle.fontSizePt,
            ...(bulletsFontFace ? { fontFace: bulletsFontFace } : {}),
            bold: exportStyle.bold,
            italic: exportStyle.italic,
            ...(exportStyle.underline ? { underline: true } : {}),
            align: exportStyle.align,
            ...(verticalAlign ? { verticalAlign } : {}),
            ...(exportStyle.lineHeight
              ? { lineHeight: exportStyle.lineHeight }
              : {}),
            ...(fitMode ? { fitMode } : {}),
          });
          break;
        }
        // Content-aware editable-PPTX font face: registry fonts map to an
        // Office-compatible face, switching to the CJK face for Chinese text.
        const text = content.text ?? "";
        const textFontFace = slideFontExportFace(
          exportStyle.resolved.fontFamily,
          text,
        );
        ops.push({
          kind: "text",
          ...box,
          text,
          ...(content.runs?.length > 0
            ? {
                runs: exportTextRuns(content.runs, geometry.slideHPt),
              }
            : {}),
          color: toHex(exportStyle.color),
          fontSize: exportStyle.fontSizePt,
          ...(textFontFace ? { fontFace: textFontFace } : {}),
          bold: exportStyle.bold,
          italic: exportStyle.italic,
          ...(exportStyle.underline ? { underline: true } : {}),
          align: exportStyle.align,
          ...(verticalAlign ? { verticalAlign } : {}),
          ...(exportStyle.lineHeight
            ? { lineHeight: exportStyle.lineHeight }
            : {}),
          ...(exportStyle.paragraphSpacingPt
            ? { paragraphSpacingPt: exportStyle.paragraphSpacingPt }
            : {}),
          ...(fitMode ? { fitMode } : {}),
        });
        break;
      }
      case "shape": {
        const content = elementContent(element);
        const design = elementDesign(element);
        const resolvedDesign = renderModel.elementDesigns[element.id];
        const shapeDesign =
          resolvedDesign?.kind === "shape" ? resolvedDesign : undefined;
        const labelStyle = adaptShapeLabelForExport(
          deck,
          element as any,
          geometry.slideHPt,
        );
        const minInch = Math.min(box.w, box.h);
        const shape = content.shape;
        const text = content.text;
        const textRuns = content.textRuns;
        const fill =
          shapeDesign?.fill ??
          colorRefValue(design.fill, renderModel.tokenSet) ??
          "#000000";
        const color = resolvedFillRepresentativeColor(fill);
        const stroke = shapeDesign?.stroke ?? design.stroke;
        const radius = shapeDesign?.radius ?? design.radius;
        ops.push({
          kind: "shape",
          ...box,
          shape,
          color: toHex(color),
          fill: exportResolvedFill(fill),
          ...(shapeDesign?.effect ? { effect: shapeDesign.effect } : {}),
          ...(text && shape !== "line"
            ? {
                text,
                ...(textRuns && textRuns.length > 0
                  ? {
                      textRuns: exportTextRuns(textRuns, geometry.slideHPt),
                    }
                  : {}),
                textColor: toHex(labelStyle.color),
                fontSize: labelStyle.fontSizePt,
                ...(labelStyle.fontFace
                  ? { fontFace: labelStyle.fontFace }
                  : {}),
                bold: labelStyle.bold,
                italic: labelStyle.italic,
                ...(labelStyle.underline ? { underline: true } : {}),
                align: labelStyle.align,
              }
            : {}),
          ...(stroke
            ? {
                stroke: {
                  color: toHex(stroke.color),
                  width: (stroke.width / 100) * minInch * 72,
                },
              }
            : {}),
          ...(radius ? { radius: (radius / 100) * minInch } : {}),
        });
        break;
      }
      case "image": {
        const op = buildDeckImageOp(element, box, renderModel.tokenSet.image);
        if (op?.src) ops.push(op as DeckOp);
        break;
      }
      case "visual": {
        const content = elementContent(element);
        const visualId = content.visualId;
        const visual = visuals.get(visualId);
        if (!visual) break;
        ops.push(
          buildDeckVisualOp(element, visual, box, renderModel.tokenSet.visual),
        );
        break;
      }
      case "connector": {
        const content = elementContent(element);
        const design = elementDesign(element);
        const connectorElement = {
          ...element,
          start: content.start,
          end: content.end,
          routing: content.routing,
          stroke: design.stroke,
          dash: design.dash,
          arrowStart: design.arrowStart,
          arrowEnd: design.arrowEnd,
        };
        const { start: startPct, end: endPct } = resolveConnectorElementPoints(
          connectorElement,
          elements,
          (candidate) => candidate.box,
        );
        const connectorDefaults = renderModel.tokenSet.connector;
        const strokeColor =
          connectorElement.stroke?.color ??
          connectorDefaults?.color ??
          "#a1a1aa";
        // Width is authored in `cqmin` (percent of shortest slide side); convert to pt.
        const minInch = Math.min(geometry.slideW, geometry.slideH);
        const strokeWidthPt = Math.max(
          1,
          ((connectorElement.stroke?.width ?? connectorDefaults?.width ?? 0.4) /
            100) *
            minInch *
            72,
        );
        const dashed =
          connectorElement.dash ||
          (connectorDefaults?.dash !== undefined &&
            connectorDefaults.dash !== "solid");
        const arrowStart =
          connectorElement.arrowStart ?? connectorDefaults?.startArrow;
        const arrowEnd =
          connectorElement.arrowEnd ?? connectorDefaults?.endArrow;
        ops.push({
          kind: "connector",
          x1: (startPct.x / 100) * geometry.slideW,
          y1: (startPct.y / 100) * geometry.slideH,
          x2: (endPct.x / 100) * geometry.slideW,
          y2: (endPct.y / 100) * geometry.slideH,
          color: toHex(strokeColor),
          width: strokeWidthPt,
          ...(dashed ? { dash: true } : {}),
          ...(arrowStart ? { arrowStart } : {}),
          ...(arrowEnd ? { arrowEnd } : {}),
          ...(element.opacity !== undefined && element.opacity < 1
            ? { opacity: element.opacity }
            : {}),
        });
        break;
      }
      case "table": {
        ops.push(...buildTableOps(element, box, renderModel, geometry));
        break;
      }
      default:
        assertNever(element);
    }
  }

  return {
    index,
    background,
    ...(backgroundFill ? { backgroundFill } : {}),
    ...((slide as any).designOverrides?.background?.type === "image"
      ? { backgroundImage: (slide as any).designOverrides.background.url }
      : {}),
    accent,
    ops,
  };
}
