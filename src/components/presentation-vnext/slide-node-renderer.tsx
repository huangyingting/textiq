"use client";

/**
 * Renderer for a single resolved render node from the vNext render tree.
 *
 * Converts `ResolvedRenderNode` into a positioned, styled DOM element without
 * any v6 materialization.  Each node type (text, shape, image, connector,
 * table, visual, group) has its own render branch.
 *
 * Props are pure and prop-driven; no context or global state is read here.
 */

import { type JSX, memo } from "react";

import { cx, FOCUS_RING } from "@/components/ui/tokens";
import { VisualRenderer } from "@/components/visual/visual-renderer";
import type { Visual } from "@/lib/visual/schema";
import type {
  ResolvedRenderNode,
  ResolvedNodeContent,
} from "@/lib/presentation-vnext/render-tree";
import type {
  FillStyle,
  StyleObject,
} from "@/lib/presentation-vnext/style-schema";
import { visualChannelColorWithDefaults } from "@/lib/presentation-vnext/visual-channel-colors";
import type {
  TextContent,
  TextRun,
  TableContent,
  ShapeKind,
  ListMarker,
  ConnectorContent,
  ImageCrop,
  ConnectorEndpoint,
  LayoutBox,
} from "@/lib/presentation-vnext/schema";
import { tableCellEditableText } from "@/lib/presentation-vnext/table-cell-editing";
import { truncateNarrationText } from "@/lib/presentation-vnext/a11y/node-narration";
import { colorValueToCss, fillStyleToCss } from "./fill-style-css";

const STAGE_NODE_FOCUS_VISIBLE_CHROME = cx(
  FOCUS_RING,
  "motion-reduce:transition-none",
);
const TABLE_CELL_FOCUS_VISIBLE_CHROME = cx(
  FOCUS_RING,
  "motion-reduce:transition-none",
);

// ---------------------------------------------------------------------------
// CSS conversion helpers
// ---------------------------------------------------------------------------

function effectToCss(effect: StyleObject["effect"]): React.CSSProperties {
  if (!effect || effect.kind === "none") return {};
  if (effect.kind === "glass") {
    const blur =
      effect.intensity === "strong"
        ? 22
        : effect.intensity === "light"
          ? 8
          : 14;
    return {
      backdropFilter: `blur(${blur}px) saturate(1.25)`,
      WebkitBackdropFilter: `blur(${blur}px) saturate(1.25)`,
    };
  }
  if (effect.kind === "blur") {
    return { filter: `blur(${effect.radiusPt}pt)` };
  }
  const color = colorValueToCss(effect.color) ?? "currentColor";
  return {
    filter: `drop-shadow(0 0 ${effect.blurPt}pt ${color})`,
    opacity: effect.opacity,
  };
}

function strokeToCss(stroke: StyleObject["stroke"]): React.CSSProperties {
  if (!stroke) return {};
  const color = colorValueToCss(stroke.color) ?? "transparent";
  const dash =
    stroke.dash === "dashed"
      ? "dashed"
      : stroke.dash === "dotted"
        ? "dotted"
        : "solid";
  return { border: `${stroke.widthPt}pt ${dash} ${color}` };
}

function radiusToCss(radius: StyleObject["radius"]): React.CSSProperties {
  if (!radius) return {};
  if ("allPt" in radius) return { borderRadius: `${radius.allPt}pt` };
  return {
    borderTopLeftRadius: `${radius.topLeftPt}pt`,
    borderTopRightRadius: `${radius.topRightPt}pt`,
    borderBottomRightRadius: `${radius.bottomRightPt}pt`,
    borderBottomLeftRadius: `${radius.bottomLeftPt}pt`,
  };
}

function shadowToCss(shadow: StyleObject["shadow"]): React.CSSProperties {
  if (!shadow) return {};
  const color = colorValueToCss(shadow.color) ?? "rgba(0,0,0,0.2)";
  return {
    boxShadow: `${shadow.xPt}pt ${shadow.yPt}pt ${shadow.blurPt}pt ${color}`,
  };
}

function textStyleToCss(text: StyleObject["text"]): React.CSSProperties {
  if (!text) return {};
  const textDecoration = [
    text.underline ? "underline" : undefined,
    text.strikethrough ? "line-through" : undefined,
  ]
    .filter(Boolean)
    .join(" ");
  return {
    ...(text.fontFamily && typeof text.fontFamily === "string"
      ? { fontFamily: text.fontFamily }
      : {}),
    ...(text.fontSizePt ? { fontSize: `${text.fontSizePt}pt` } : {}),
    ...(text.weight ? { fontWeight: text.weight } : {}),
    ...(text.italic ? { fontStyle: "italic" } : {}),
    ...(textDecoration ? { textDecoration } : {}),
    ...(text.color ? { color: colorValueToCss(text.color) } : {}),
    ...(text.lineHeight ? { lineHeight: text.lineHeight } : {}),
    ...(text.align ? { textAlign: text.align } : {}),
    ...(text.letterSpacingEm
      ? { letterSpacing: `${text.letterSpacingEm}em` }
      : {}),
    ...(text.textTransform ? { textTransform: text.textTransform } : {}),
  };
}

function textVerticalAlignToJustifyContent(
  verticalAlign: "top" | "middle" | "bottom" | undefined,
): React.CSSProperties["justifyContent"] {
  if (verticalAlign === "middle") return "center";
  if (verticalAlign === "bottom") return "flex-end";
  return "flex-start";
}

/**
 * Converts a resolved `StyleObject` to inline CSS properties for a container.
 * Text style is applied separately on the inner text container.
 */
export function styleObjectToContainerCss(
  style: StyleObject,
  assetResolver?: (id: string) => string | undefined,
  options: { includeShapePaint?: boolean } = {},
): React.CSSProperties {
  const includeShapePaint = options.includeShapePaint ?? true;
  return {
    ...(includeShapePaint
      ? fillStyleToContainerCss(style.fill, assetResolver)
      : {}),
    ...(includeShapePaint ? strokeToCss(style.stroke) : {}),
    ...(includeShapePaint ? radiusToCss(style.radius) : {}),
    ...shadowToCss(style.shadow),
    ...effectToCss(style.effect),
    ...(style.opacity !== undefined ? { opacity: style.opacity } : {}),
    ...(style.clip?.enabled ? { overflow: "hidden" } : {}),
    ...(style.blendMode && style.blendMode !== "normal"
      ? { mixBlendMode: style.blendMode }
      : {}),
  };
}

function fillStyleToContainerCss(
  fill: FillStyle | undefined,
  assetResolver?: (id: string) => string | undefined,
): React.CSSProperties {
  if (!fill || fill.type === "image") return {};
  return fillStyleToCss(fill, assetResolver);
}

function imageFillLayerCss(
  fill: FillStyle | undefined,
  assetResolver?: (id: string) => string | undefined,
): React.CSSProperties | undefined {
  if (!fill || fill.type !== "image") return undefined;
  const imageFillCss = fillStyleToCss(fill, assetResolver);
  if (imageFillCss.backgroundImage === undefined) return undefined;
  return {
    ...imageFillCss,
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    borderRadius: "inherit",
    ...(fill.opacity !== undefined ? { opacity: fill.opacity } : {}),
  };
}

// ---------------------------------------------------------------------------
// Positioning helper
// ---------------------------------------------------------------------------

/**
 * Converts a percent-based frame into absolute-position CSS.
 * The parent canvas container must be `position: relative`.
 */
export function frameToCss(frame: LayoutBox["frame"]): React.CSSProperties {
  return {
    position: "absolute",
    left: `${frame.x}%`,
    top: `${frame.y}%`,
    width: `${frame.w}%`,
    height: `${frame.h}%`,
  };
}

export function nodeLayoutTransformToCss(
  layout: Pick<LayoutBox, "rotation" | "flipX" | "flipY">,
): React.CSSProperties {
  const transforms = [
    layout.rotation !== undefined ? `rotate(${layout.rotation}deg)` : undefined,
    layout.flipX ? "scaleX(-1)" : undefined,
    layout.flipY ? "scaleY(-1)" : undefined,
  ].filter(Boolean);
  if (transforms.length === 0) return {};
  return {
    transform: transforms.join(" "),
    transformOrigin: "center",
  };
}

export function interactiveNodeCursor({
  hasPointerHandler,
  locked,
  dragging,
}: {
  hasPointerHandler: boolean;
  locked: boolean;
  dragging: boolean;
}): React.CSSProperties["cursor"] {
  if (!hasPointerHandler) return "default";
  if (dragging) return "grabbing";
  if (locked) return "not-allowed";
  return "default";
}

// ---------------------------------------------------------------------------
// Text node content
// ---------------------------------------------------------------------------

function runStyle(run: TextRun): React.CSSProperties {
  return {
    ...(run.bold ? { fontWeight: "bold" } : {}),
    ...(run.italic ? { fontStyle: "italic" } : {}),
    ...(run.underline || run.strikethrough
      ? {
          textDecoration: [
            run.underline ? "underline" : undefined,
            run.strikethrough ? "line-through" : undefined,
          ]
            .filter(Boolean)
            .join(" "),
        }
      : {}),
    ...(run.code ? { fontFamily: "monospace" } : {}),
    ...(run.localStyle?.color ? { color: run.localStyle.color as string } : {}),
    ...(run.localStyle?.fontSizePt
      ? { fontSize: `${run.localStyle.fontSizePt}pt` }
      : {}),
    ...(run.localStyle?.fontFamily
      ? { fontFamily: run.localStyle.fontFamily as string }
      : {}),
  };
}

function renderTextRuns(runs: readonly TextRun[]): JSX.Element[] {
  return runs.map((run, i) => {
    const style = runStyle(run);
    return run.link ? (
      <a
        key={i}
        href={run.link}
        style={style}
        target="_blank"
        rel="noopener noreferrer"
      >
        {run.text}
      </a>
    ) : (
      <span key={i} style={style}>
        {run.text}
      </span>
    );
  });
}

type OrderedListNumberStyle = NonNullable<ListMarker["numberStyle"]>;

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

function formatOrderedListMarker(
  value: number,
  style: OrderedListNumberStyle | undefined,
): string {
  switch (style) {
    case "lower-alpha":
      return `${toAlphabeticMarker(value, false)}.`;
    case "upper-alpha":
      return `${toAlphabeticMarker(value, true)}.`;
    case "lower-roman":
      return `${toLowerRomanMarker(value)}.`;
    default:
      return `${value}.`;
  }
}

function resolveOrderedListMarkers(
  paragraphs: readonly TextContent["paragraphs"][number][],
): (string | undefined)[] {
  const counters = new Array(6).fill(0) as number[];
  return paragraphs.map((paragraph) => {
    if (paragraph.list?.kind !== "number") {
      counters.fill(0);
      return undefined;
    }
    const indent = Math.max(
      0,
      Math.min(counters.length - 1, paragraph.list.indent ?? 0),
    );
    for (let depth = indent + 1; depth < counters.length; depth += 1) {
      counters[depth] = 0;
    }
    counters[indent] += 1;
    return formatOrderedListMarker(
      counters[indent],
      paragraph.list.numberStyle,
    );
  });
}

function TextNodeContent({
  content,
  paragraphSpacingPt,
  verticalAlign,
}: {
  content: TextContent;
  paragraphSpacingPt?: number;
  verticalAlign?: "top" | "middle" | "bottom";
}): JSX.Element {
  const paragraphSpacing =
    paragraphSpacingPt !== undefined && paragraphSpacingPt > 0
      ? `${paragraphSpacingPt}pt`
      : undefined;
  const orderedListMarkers = resolveOrderedListMarkers(content.paragraphs);

  return (
    <div
      className="h-full w-full overflow-hidden"
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: textVerticalAlignToJustifyContent(verticalAlign),
      }}
    >
      {content.paragraphs.map((para, index) => (
        <p
          key={para.id}
          style={{
            display: para.list ? "flex" : undefined,
            gap: para.list ? "0.4em" : undefined,
            margin: 0,
            marginBottom:
              paragraphSpacing && index < content.paragraphs.length - 1
                ? paragraphSpacing
                : undefined,
            paddingLeft: para.list?.indent
              ? `${para.list.indent * 1.5}em`
              : undefined,
          }}
        >
          {para.list ? (
            <span aria-hidden="true" style={{ flex: "0 0 auto" }}>
              {para.list.kind === "number"
                ? (orderedListMarkers[index] ?? "1.")
                : "•"}
            </span>
          ) : null}
          <span>
            {para.runs && para.runs.length > 0
              ? renderTextRuns(para.runs)
              : para.text}
          </span>
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shape node content
// ---------------------------------------------------------------------------

function shapePathD(kind: ShapeKind): string | undefined {
  switch (kind) {
    case "triangle":
      return "M 50 0 L 100 100 L 0 100 Z";
    case "diamond":
      return "M 50 0 L 100 50 L 50 100 L 0 50 Z";
    case "square":
      return "M 0 0 L 100 0 L 100 100 L 0 100 Z";
    default:
      return undefined;
  }
}

function shapeUsesSvgGeometry(shape: ShapeKind): boolean {
  return shape !== "rect";
}

function shapeSvgPreserveAspectRatio(shape: ShapeKind): string | undefined {
  if (shape === "circle" || shape === "square") return "xMidYMid meet";
  return "none";
}

function ShapeNodeContent({
  shape,
  path,
  style,
}: {
  shape: ShapeKind;
  path?: string;
  style: StyleObject;
}): JSX.Element {
  const hasSvgGeometry = shapeUsesSvgGeometry(shape);
  const fillColor =
    style.fill?.type === "solid"
      ? colorValueToCss(style.fill.color)
      : undefined;
  const strokeColor = style.stroke
    ? colorValueToCss(style.stroke.color)
    : undefined;
  const lineStrokeColor = strokeColor ?? fillColor ?? "currentColor";

  return (
    <div className="relative h-full w-full">
      {hasSvgGeometry && (
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio={shapeSvgPreserveAspectRatio(shape)}
          aria-hidden="true"
        >
          {shape === "ellipse" && (
            <ellipse
              cx="50"
              cy="50"
              rx="50"
              ry="50"
              fill={fillColor ?? "currentColor"}
              stroke={strokeColor}
              strokeWidth={style.stroke?.widthPt}
            />
          )}
          {shape === "circle" && (
            <circle
              cx="50"
              cy="50"
              r="50"
              fill={fillColor ?? "currentColor"}
              stroke={strokeColor}
              strokeWidth={style.stroke?.widthPt}
            />
          )}
          {shape === "line" && (
            <line
              x1="0"
              y1="50"
              x2="100"
              y2="50"
              fill="none"
              stroke={lineStrokeColor}
              strokeWidth={style.stroke?.widthPt ?? 1}
            />
          )}
          {(shape === "triangle" ||
            shape === "diamond" ||
            shape === "square" ||
            shape === "path") && (
            <path
              d={path ?? shapePathD(shape) ?? "M0 0 L100 0 L100 100 L0 100 Z"}
              fill={fillColor ?? "currentColor"}
              stroke={strokeColor}
              strokeWidth={style.stroke?.widthPt}
            />
          )}
        </svg>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Image node content
// ---------------------------------------------------------------------------

function ImageNodeContent({
  assetId,
  alt,
  fit,
  crop,
  imageStyle,
  assetResolver,
}: {
  assetId: string;
  alt?: string;
  fit?: string;
  crop?: ImageCrop;
  imageStyle?: StyleObject["image"];
  assetResolver?: (id: string) => string | undefined;
}): JSX.Element {
  const src = assetResolver?.(assetId);
  const objectFit = (fit as React.CSSProperties["objectFit"]) ?? "cover";
  const filters = [
    imageStyle?.brightness !== undefined
      ? `brightness(${imageStyle.brightness})`
      : undefined,
    imageStyle?.contrast !== undefined
      ? `contrast(${imageStyle.contrast})`
      : undefined,
    imageStyle?.saturation !== undefined
      ? `saturate(${imageStyle.saturation})`
      : undefined,
  ].filter(Boolean);
  if (!src) {
    return (
      <div
        className="flex h-full w-full items-center justify-center bg-ds-surface-2 text-xs text-ds-text-muted"
        aria-label={alt ?? "Image placeholder"}
      >
        <span aria-hidden="true">⬜</span>
      </div>
    );
  }
  const cropStyle: React.CSSProperties | undefined = crop
    ? {
        position: "absolute",
        left: `${-crop.left}%`,
        top: `${-crop.top}%`,
        width: `${100 + crop.left + crop.right}%`,
        height: `${100 + crop.top + crop.bottom}%`,
      }
    : undefined;
  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt ?? ""}
        style={{
          objectFit,
          width: "100%",
          height: "100%",
          display: "block",
          ...(cropStyle ?? {}),
          ...(filters.length > 0 ? { filter: filters.join(" ") } : {}),
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table node content
// ---------------------------------------------------------------------------

function TableNodeContent({
  content,
  style,
  editable,
  activeCell,
  onCellFocus,
  onCellCommit,
  onCellKeyDown,
}: {
  content: TableContent;
  style: StyleObject;
  editable?: boolean;
  activeCell?: { rowIndex: number; colIndex: number } | null;
  onCellFocus?: (rowIndex: number, colIndex: number) => void;
  onCellCommit?: (rowIndex: number, colIndex: number, text: string) => void;
  onCellKeyDown?: (
    rowIndex: number,
    colIndex: number,
    event: React.KeyboardEvent<HTMLElement>,
  ) => void;
}): JSX.Element {
  const headerFill =
    style.table?.headerFill?.type === "solid"
      ? colorValueToCss(style.table.headerFill.color)
      : undefined;
  const rowFill =
    style.table?.rowFill?.type === "solid"
      ? colorValueToCss(style.table.rowFill.color)
      : undefined;
  const borderColor = style.table?.border
    ? colorValueToCss(style.table.border.color)
    : undefined;
  const borderWidth = style.table?.border?.widthPt ?? 0;
  const padding = style.table?.cellPaddingPt;
  const cellStyle: React.CSSProperties = {
    ...(borderColor && borderWidth > 0
      ? { border: `${borderWidth}pt solid ${borderColor}` }
      : {}),
    ...(padding
      ? {
          paddingTop: `${padding.top}pt`,
          paddingRight: `${padding.right}pt`,
          paddingBottom: `${padding.bottom}pt`,
          paddingLeft: `${padding.left}pt`,
        }
      : {}),
  };

  return (
    <table className="h-full w-full border-collapse text-[inherit]">
      {content.header && content.rows.length > 0 && (
        <thead>
          <tr style={{ backgroundColor: headerFill }}>
            {content.columns.map((col) => (
              <th
                key={col.id}
                className="px-2 py-1 text-left text-xs font-semibold"
                style={cellStyle}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {content.rows.map((row, rowIdx) => (
          <tr
            key={row.id}
            style={
              rowIdx % 2 === 1 &&
              style.table?.alternateRowFill?.type === "solid"
                ? {
                    backgroundColor: colorValueToCss(
                      style.table.alternateRowFill.color,
                    ),
                  }
                : { backgroundColor: rowFill }
            }
          >
            {row.cells.map((cell, colIdx) => (
              <td
                key={content.columns[colIdx]?.id ?? colIdx}
                className={cx(
                  "px-2 py-1 text-xs",
                  editable && TABLE_CELL_FOCUS_VISIBLE_CHROME,
                  editable &&
                    activeCell?.rowIndex === rowIdx &&
                    activeCell.colIndex === colIdx &&
                    "outline outline-2 outline-ds-accent",
                )}
                style={cellStyle}
                data-table-cell={editable ? `${rowIdx}:${colIdx}` : undefined}
                contentEditable={editable ? true : undefined}
                suppressContentEditableWarning={editable ? true : undefined}
                tabIndex={editable ? 0 : undefined}
                role={editable ? "textbox" : undefined}
                aria-label={
                  editable
                    ? tableCellAccessibleName(content, rowIdx, colIdx)
                    : undefined
                }
                onFocus={
                  editable ? () => onCellFocus?.(rowIdx, colIdx) : undefined
                }
                onBlur={
                  editable
                    ? (event) =>
                        onCellCommit?.(
                          rowIdx,
                          colIdx,
                          event.currentTarget.textContent ?? "",
                        )
                    : undefined
                }
                onKeyDown={
                  editable
                    ? (event) => onCellKeyDown?.(rowIdx, colIdx, event)
                    : undefined
                }
              >
                {editable
                  ? tableCellEditableText(cell)
                  : cell.runs && cell.runs.length > 0
                    ? renderTextRuns(cell.runs)
                    : cell.text}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function tableCellAccessibleName(
  content: TableContent,
  rowIdx: number,
  colIdx: number,
): string {
  const row = content.rows[rowIdx];
  const cell = row?.cells[colIdx];
  const parts = [`Table cell row ${rowIdx + 1}, column ${colIdx + 1}`];
  const caption = truncateNarrationText(content.caption ?? "", 80);
  if (caption) {
    parts.push(`table ${caption}`);
  }
  const columnHeader = content.header
    ? truncateNarrationText(content.columns[colIdx]?.label ?? "", 80)
    : "";
  if (columnHeader) {
    parts.push(`column header ${columnHeader}`);
  }
  const rowHeader =
    content.header && colIdx > 0
      ? truncateNarrationText(
          tableCellEditableText(row?.cells[0] ?? { text: "" }),
          80,
        )
      : "";
  if (rowHeader) {
    parts.push(`row header ${rowHeader}`);
  }
  const preview = truncateNarrationText(
    cell ? tableCellEditableText(cell) : "",
    80,
  );
  parts.push(`content ${preview || "empty"}`);
  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// Visual node content
// ---------------------------------------------------------------------------

function VisualNodeContent({
  assetId,
  visualId,
  alt,
  transparentBackground,
  style,
  assetResolver,
  visualResolver,
}: {
  assetId?: string;
  visualId?: string;
  alt?: string;
  transparentBackground?: boolean;
  style: StyleObject;
  assetResolver?: (id: string) => string | undefined;
  visualResolver?: (id: string) => Visual | undefined;
}): JSX.Element {
  const src = assetId ? assetResolver?.(assetId) : undefined;
  const visual = visualId ? visualResolver?.(visualId) : undefined;
  if (!src && visual) {
    return (
      <VisualRenderer
        visual={visual}
        title={alt ?? visual.title}
        transparentBackground={
          transparentBackground ?? style.visual?.transparentBackground ?? true
        }
        className="h-full w-full"
      />
    );
  }
  if (!src) {
    const colors = visualChannelColorWithDefaults(style.visual?.channelColors);
    const isTransparent =
      transparentBackground ?? style.visual?.transparentBackground ?? false;
    const backgroundColor = isTransparent ? "transparent" : `${colors.muted}22`;
    return (
      <div
        className="flex h-full w-full items-center justify-center overflow-hidden rounded-ds-sm border text-xs"
        aria-label={alt ?? visualId ?? "Visual placeholder"}
        style={{
          backgroundColor,
          borderColor: colors.muted,
          color: colors.primary,
        }}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 120 80"
          className="h-full w-full"
          preserveAspectRatio="none"
        >
          <rect
            x="14"
            y="18"
            width="18"
            height="44"
            rx="4"
            fill={colors.primary}
          />
          <rect
            x="51"
            y="31"
            width="18"
            height="31"
            rx="4"
            fill={colors.secondary}
          />
          <rect
            x="88"
            y="10"
            width="18"
            height="52"
            rx="4"
            fill={colors.accent}
          />
          <path
            d="M12 68 H108"
            stroke={colors.muted}
            strokeWidth="4"
            strokeLinecap="round"
          />
        </svg>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt ?? ""}
      style={{
        objectFit: "contain",
        width: "100%",
        height: "100%",
        display: "block",
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Connector node content
// ---------------------------------------------------------------------------

function ConnectorNodeContent({
  content,
  style,
  nodeId,
}: {
  content: ConnectorContent;
  style: StyleObject;
  nodeId: string;
}): JSX.Element {
  const stroke = style.connector?.stroke ?? style.stroke;
  const strokeColor = colorValueToCss(stroke?.color) ?? "currentColor";
  const strokeWidth = stroke?.widthPt ?? 2;
  const dashArray =
    stroke?.dash === "dashed"
      ? "6 4"
      : stroke?.dash === "dotted"
        ? "1 4"
        : undefined;
  const startArrow = style.connector?.startArrow ?? "none";
  const endArrow = style.connector?.endArrow ?? "arrow";
  const routing = content.routing ?? style.connector?.routing ?? "straight";
  const start = connectorEndpointPoint(content.from);
  const end = connectorEndpointPoint(content.to);
  const startMarkerId = `connector-start-arrow-v7-${nodeId}`;
  const endMarkerId = `connector-end-arrow-v7-${nodeId}`;
  const midX = start.x + (end.x - start.x) / 2;
  const path =
    routing === "curved"
      ? `M ${start.x} ${start.y} C ${midX} ${start.y} ${midX} ${end.y} ${end.x} ${end.y}`
      : routing === "elbow"
        ? `M ${start.x} ${start.y} L ${midX} ${start.y} L ${midX} ${end.y} L ${end.x} ${end.y}`
        : `M ${start.x} ${start.y} L ${end.x} ${end.y}`;

  // Rendered as an SVG spanning the node's frame box
  return (
    <svg
      className="absolute inset-0 h-full w-full overflow-visible"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        {startArrow !== "none" ? (
          <marker
            id={startMarkerId}
            markerWidth="8"
            markerHeight="6"
            refX="1"
            refY="3"
            orient="auto"
          >
            <path
              d="M 8 0 L 0 3 L 8 6"
              fill={startArrow === "filled" ? strokeColor : "none"}
              stroke={strokeColor}
              strokeWidth="1"
            />
          </marker>
        ) : null}
        {endArrow !== "none" ? (
          <marker
            id={endMarkerId}
            markerWidth="8"
            markerHeight="6"
            refX="7"
            refY="3"
            orient="auto"
          >
            <path
              d="M 0 0 L 8 3 L 0 6"
              fill={endArrow === "filled" ? strokeColor : "none"}
              stroke={strokeColor}
              strokeWidth="1"
            />
          </marker>
        ) : null}
      </defs>
      <path
        d={path}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeDasharray={dashArray}
        vectorEffect="non-scaling-stroke"
        markerStart={
          startArrow !== "none" ? `url(#${startMarkerId})` : undefined
        }
        markerEnd={endArrow !== "none" ? `url(#${endMarkerId})` : undefined}
      />
    </svg>
  );
}

function connectorEndpointPoint(endpoint: ConnectorEndpoint): {
  x: number;
  y: number;
} {
  if (endpoint.kind === "point") return endpoint.point;
  switch (endpoint.anchor) {
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

// ---------------------------------------------------------------------------
// SlideNodeRenderer
// ---------------------------------------------------------------------------

export interface SlideNodeRendererProps {
  node: ResolvedRenderNode;
  /** Called when the node is double-clicked (enter inline edit mode). */
  onDoubleClick?: (nodeId: string, event: React.MouseEvent) => void;
  /** Called when pointer drag starts on the node (editor usage). */
  onPointerDown?: (nodeId: string, event: React.PointerEvent) => void;
  /** When true, renders a selection ring around the node. */
  selected?: boolean;
  /** When true, renders a pre-selection hover ring. */
  hovered?: boolean;
  /** When true, this node is the current keyboard focus target. */
  focused?: boolean;
  /** Registers the outer positioned element with focus/geometry owners. */
  nodeRef?: (element: HTMLDivElement | null) => void;
  /** When true, the node participates in the stage roving-tabindex model. */
  interactive?: boolean;
  /** Tab index assigned by the stage roving-tabindex model. */
  tabIndex?: number;
  /** Called when the node receives keyboard focus. */
  onFocus?: (nodeId: string, event: React.FocusEvent) => void;
  /** Enables direct table cell editing for selected table nodes. */
  tableEditing?: boolean;
  activeTableCell?: { rowIndex: number; colIndex: number } | null;
  onTableCellFocus?: (
    nodeId: string,
    rowIndex: number,
    colIndex: number,
  ) => void;
  onTableCellCommit?: (
    nodeId: string,
    rowIndex: number,
    colIndex: number,
    text: string,
  ) => void;
  onTableCellKeyDown?: (
    nodeId: string,
    rowIndex: number,
    colIndex: number,
    event: React.KeyboardEvent<HTMLElement>,
  ) => void;
  /**
   * Resolves an asset id to its src URL for images/visuals.
   * Not required for nodes with no media.
   */
  assetResolver?: (id: string) => string | undefined;
  /** Resolves a visual id to a live document visual payload. */
  visualResolver?: (id: string) => Visual | undefined;
  /** When true, renders this node at reduced visual fidelity (e.g. thumbnail). */
  preview?: boolean;
  /**
   * When true, hides this node from the canvas (used while inline editing
   * overlays the node so the live render and the editor don't double-render).
   */
  hidden?: boolean;
  /** When true, the stage is actively dragging nodes. */
  dragging?: boolean;
}

/**
 * Renders a single `ResolvedRenderNode` positioned absolutely within the slide
 * canvas viewport.  Each node type renders its own content via a dedicated
 * sub-renderer.
 *
 * Wrapped with `React.memo` so that unchanged nodes skip re-render when a
 * sibling is mutated.
 */
export const SlideNodeRenderer = memo(function SlideNodeRenderer({
  node,
  onDoubleClick,
  onPointerDown,
  selected = false,
  hovered = false,
  focused = false,
  nodeRef,
  interactive = false,
  tabIndex,
  onFocus,
  tableEditing = false,
  activeTableCell,
  onTableCellFocus,
  onTableCellCommit,
  onTableCellKeyDown,
  assetResolver,
  visualResolver,
  preview = false,
  hidden = false,
  dragging = false,
}: SlideNodeRendererProps): JSX.Element | null {
  const { layout, style, content } = node;
  const shouldIncludeShapePaint =
    content.type !== "shape" || !shapeUsesSvgGeometry(content.content.shape);

  const isLocked = node.locked === true;

  const containerStyle: React.CSSProperties = {
    ...frameToCss(layout.frame),
    ...nodeLayoutTransformToCss(layout),
    ...styleObjectToContainerCss(style, assetResolver, {
      includeShapePaint: shouldIncludeShapePaint,
    }),
    boxSizing: "border-box",
    cursor: interactiveNodeCursor({
      hasPointerHandler: onPointerDown !== undefined,
      locked: isLocked,
      dragging,
    }),
    ...(node.source === "themeDecoration" || node.source === "deckChrome"
      ? { pointerEvents: "none" }
      : {}),
    ...(hidden ? { pointerEvents: "none" } : {}),
    ...(hidden ? { visibility: "hidden" } : {}),
  };
  const fillLayerStyle = shouldIncludeShapePaint
    ? imageFillLayerCss(style.fill, assetResolver)
    : undefined;

  const textCss = textStyleToCss(style.text);

  function handleDoubleClick(e: React.MouseEvent) {
    onDoubleClick?.(node.id, e);
  }

  function handlePointerDown(e: React.PointerEvent) {
    onPointerDown?.(node.id, e);
  }

  function handleFocus(e: React.FocusEvent) {
    onFocus?.(node.id, e);
  }

  const inner = renderContent(
    node.id,
    content,
    style,
    assetResolver,
    visualResolver,
    preview,
    {
      tableEditing,
      activeTableCell,
      onTableCellFocus: (rowIndex, colIndex) =>
        onTableCellFocus?.(node.id, rowIndex, colIndex),
      onTableCellCommit: (rowIndex, colIndex, text) =>
        onTableCellCommit?.(node.id, rowIndex, colIndex, text),
      onTableCellKeyDown: (rowIndex, colIndex, event) =>
        onTableCellKeyDown?.(node.id, rowIndex, colIndex, event),
    },
  );

  return (
    <div
      ref={nodeRef}
      data-node-id={node.id}
      data-node-type={node.type}
      data-node-source={node.source}
      data-node-selected={selected ? "true" : undefined}
      data-node-hovered={hovered ? "true" : undefined}
      data-node-focused={focused ? "true" : undefined}
      className={interactive ? STAGE_NODE_FOCUS_VISIBLE_CHROME : undefined}
      style={{ ...containerStyle, ...textCss }}
      role={interactive ? (tableEditing ? "group" : "button") : undefined}
      tabIndex={interactive ? tabIndex : undefined}
      aria-label={
        interactive
          ? tableEditing
            ? "Table node editing cells"
            : accessibleNodeName(node)
          : undefined
      }
      aria-disabled={interactive && isLocked ? true : undefined}
      aria-pressed={interactive && !tableEditing ? selected : undefined}
      onDoubleClick={onDoubleClick ? handleDoubleClick : undefined}
      onPointerDown={onPointerDown ? handlePointerDown : undefined}
      onFocus={interactive ? handleFocus : undefined}
      aria-hidden={
        node.source === "themeDecoration" || node.source === "deckChrome"
          ? true
          : undefined
      }
    >
      {fillLayerStyle ? (
        <div
          aria-hidden="true"
          data-node-fill-layer="image"
          style={fillLayerStyle}
        />
      ) : null}
      {fillLayerStyle ? (
        <div
          style={{
            position: "relative",
            zIndex: 1,
            width: "100%",
            height: "100%",
          }}
        >
          {inner}
        </div>
      ) : (
        inner
      )}
    </div>
  );
});

function accessibleNodeName(node: ResolvedRenderNode): string {
  const explicitAccessibilityName = firstNonEmptyText(
    node.accessibility?.label,
    node.accessibility?.alt,
  );
  if (explicitAccessibilityName) return explicitAccessibilityName;
  const nodeName = firstNonEmptyText(node.name);
  if (nodeName) return nodeName;
  if (node.accessibility?.decorative) {
    return `Decorative ${node.content.type}`;
  }
  if (node.content.type === "text") {
    const text = textContentSummary(node.content.content);
    return text ? `Text: ${text}` : "Text node";
  }
  if (node.content.type === "shape") {
    return `${node.content.content.shape} shape`;
  }
  if (node.content.type === "image") {
    return firstNonEmptyText(node.content.content.alt) ?? "Image node";
  }
  if (node.content.type === "visual") {
    return (
      firstNonEmptyText(
        node.content.content.alt,
        node.content.content.visualId,
      ) ?? "Visual node"
    );
  }
  if (node.content.type === "table") {
    const caption = firstNonEmptyText(node.content.content.caption);
    return caption ? `Table: ${caption}` : "Table node";
  }
  if (node.content.type === "connector") return "Connector node";
  return "Group node";
}

function textContentSummary(content: TextContent): string {
  return content.paragraphs
    .map((paragraph) => paragraph.text.trim())
    .filter(Boolean)
    .join(" ");
}

function firstNonEmptyText(
  ...values: Array<string | null | undefined>
): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function renderContent(
  nodeId: string,
  content: ResolvedNodeContent,
  style: StyleObject,
  assetResolver?: (id: string) => string | undefined,
  visualResolver?: (id: string) => Visual | undefined,
  _preview?: boolean,
  editing?: {
    tableEditing?: boolean;
    activeTableCell?: { rowIndex: number; colIndex: number } | null;
    onTableCellFocus?: (rowIndex: number, colIndex: number) => void;
    onTableCellCommit?: (
      rowIndex: number,
      colIndex: number,
      text: string,
    ) => void;
    onTableCellKeyDown?: (
      rowIndex: number,
      colIndex: number,
      event: React.KeyboardEvent<HTMLElement>,
    ) => void;
  },
): JSX.Element | null {
  switch (content.type) {
    case "text":
      return (
        <TextNodeContent
          content={content.content}
          paragraphSpacingPt={style.text?.paragraphSpacingPt}
          verticalAlign={style.text?.verticalAlign}
        />
      );

    case "shape":
      return (
        <ShapeNodeContent
          shape={content.content.shape}
          path={content.content.path}
          style={style}
        />
      );

    case "image":
      return (
        <ImageNodeContent
          assetId={content.content.assetId}
          alt={content.content.alt}
          fit={content.content.fit ?? style.image?.fit}
          crop={content.content.crop}
          imageStyle={style.image}
          assetResolver={assetResolver}
        />
      );

    case "table":
      return (
        <TableNodeContent
          content={content.content}
          style={style}
          editable={editing?.tableEditing}
          activeCell={editing?.activeTableCell}
          onCellFocus={editing?.onTableCellFocus}
          onCellCommit={editing?.onTableCellCommit}
          onCellKeyDown={editing?.onTableCellKeyDown}
        />
      );

    case "visual":
      return (
        <VisualNodeContent
          assetId={content.content.assetId}
          visualId={content.content.visualId}
          alt={content.content.alt}
          transparentBackground={content.content.transparentBackground}
          style={style}
          assetResolver={assetResolver}
          visualResolver={visualResolver}
        />
      );

    case "connector":
      return (
        <ConnectorNodeContent
          content={content.content}
          style={style}
          nodeId={nodeId}
        />
      );

    case "group":
      // Group children are rendered by the parent SlideCanvas, not here.
      return null;

    default: {
      void (content satisfies never);
      return null;
    }
  }
}
