"use client";

import type { JSX } from "react";

import type { SlideChildNode } from "@/lib/presentation/schema";
import type { StyleObject, StylePatch } from "@/lib/presentation/style-schema";
import { FOCUS_RING } from "@/components/ui/tokens";
import { SelectMenu, type SelectMenuOption } from "@/components/ui/select-menu";
import {
  matchSlideFont,
  SLIDE_FONT_OPTIONS,
  slideFontCssStack,
} from "@/lib/presentation/slide-fonts";

const TEXT_WEIGHT_OPTIONS: readonly SelectMenuOption[] = [
  { value: "300", label: "Light" },
  { value: "400", label: "Regular" },
  { value: "600", label: "Semibold" },
  { value: "700", label: "Bold" },
];

const TEXT_ALIGN_OPTIONS: readonly SelectMenuOption[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
];

const CONNECTOR_DASH_OPTIONS: readonly SelectMenuOption[] = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
];

const CONNECTOR_ARROW_OPTIONS: readonly SelectMenuOption[] = [
  { value: "none", label: "None" },
  { value: "arrow", label: "Arrow" },
  { value: "filled", label: "Filled" },
];

const VISUAL_THEME_OPTIONS: readonly SelectMenuOption[] = [
  { value: "default", label: "Default" },
  { value: "accent", label: "Accent" },
  { value: "muted", label: "Muted" },
  { value: "contrast", label: "Contrast" },
];

const FONT_FAMILY_OPTIONS: readonly SelectMenuOption[] = [
  { value: "", label: "Theme default", disabled: true },
  ...SLIDE_FONT_OPTIONS.map((font) => ({
    value: font.id,
    label: <span style={{ fontFamily: font.value }}>{font.label}</span>,
  })),
];
import {
  clampToRange,
  parseFiniteNumberInput,
  sanitizeBoundedNumber,
} from "./numeric-sanitization";

export interface LocalStylePanelProps {
  node: SlideChildNode;
  resolvedStyle?: StyleObject;
  onUpdateLocalStyle: (patch: StylePatch) => void;
}

function solidColor(fill: unknown): string | undefined {
  if (
    typeof fill === "object" &&
    fill !== null &&
    "type" in fill &&
    fill.type === "solid" &&
    "color" in fill &&
    typeof fill.color === "string"
  ) {
    return fill.color;
  }
  return undefined;
}

export function solidFillColor(
  localStyle: StylePatch | undefined,
  resolvedStyle?: StyleObject,
): string {
  const fill = resolvedStyle?.fill ?? localStyle?.fill;
  const color = solidColor(fill);
  if (color) return color;
  const localColor = solidColor(localStyle?.fill);
  return localColor ?? "#ffffff";
}

export function resolvedStrokeWidth(
  localStyle: StylePatch | undefined,
  resolvedStyle?: StyleObject,
): number {
  return resolvedStyle?.stroke?.widthPt ?? localStyle?.stroke?.widthPt ?? 1;
}

export function resolvedConnectorStrokeWidth(
  localStyle: StylePatch | undefined,
  resolvedStyle?: StyleObject,
): number {
  return (
    resolvedStyle?.connector?.stroke?.widthPt ??
    localStyle?.connector?.stroke?.widthPt ??
    1.5
  );
}

export function textFontSize(
  localStyle: StylePatch | undefined,
  resolvedStyle?: StyleObject,
): number {
  return resolvedStyle?.text?.fontSizePt ?? localStyle?.text?.fontSizePt ?? 14;
}

export function textLineHeight(
  localStyle: StylePatch | undefined,
  resolvedStyle?: StyleObject,
): number {
  return (
    resolvedStyle?.text?.lineHeight ?? localStyle?.text?.lineHeight ?? 1.15
  );
}

export function textFontFamily(
  localStyle: StylePatch | undefined,
  resolvedStyle?: StyleObject,
): string | undefined {
  const fontFamily =
    resolvedStyle?.text?.fontFamily ?? localStyle?.text?.fontFamily;
  return typeof fontFamily === "string" ? fontFamily : undefined;
}

export function textColorValue(
  localStyle: StylePatch | undefined,
  resolvedStyle?: StyleObject,
): string {
  const resolved = resolvedStyle?.text?.color;
  if (typeof resolved === "string") return resolved;
  const local = localStyle?.text?.color;
  if (typeof local === "string") return local;
  return "#111111";
}

export function strokeColor(
  localStyle: StylePatch | undefined,
  resolvedStyle?: StyleObject,
): string {
  if (typeof resolvedStyle?.stroke?.color === "string") {
    return resolvedStyle.stroke.color;
  }
  return typeof localStyle?.stroke?.color === "string"
    ? localStyle.stroke.color
    : "#111111";
}

export function connectorStrokeColor(
  localStyle: StylePatch | undefined,
  resolvedStyle?: StyleObject,
): string {
  if (typeof resolvedStyle?.connector?.stroke?.color === "string") {
    return resolvedStyle.connector.stroke.color;
  }
  return typeof localStyle?.connector?.stroke?.color === "string"
    ? localStyle.connector.stroke.color
    : "#111111";
}

export function tableFillColor(
  fill: StylePatch["table"] extends { headerFill?: infer F } ? F : unknown,
  fallback: string,
): string {
  return typeof fill === "object" &&
    fill !== null &&
    "type" in fill &&
    fill.type === "solid" &&
    "color" in fill &&
    typeof fill.color === "string"
    ? fill.color
    : fallback;
}

export function LocalStylePanel({
  node,
  resolvedStyle,
  onUpdateLocalStyle,
}: LocalStylePanelProps): JSX.Element {
  const textColor = textColorValue(node.localStyle, resolvedStyle);
  const fontSize = textFontSize(node.localStyle, resolvedStyle);
  const lineHeight = textLineHeight(node.localStyle, resolvedStyle);
  const currentFontFamily = textFontFamily(node.localStyle, resolvedStyle);
  const selectedFont = currentFontFamily
    ? matchSlideFont(currentFontFamily)
    : undefined;
  const selectedFontId = selectedFont?.id ?? "";
  const opacity = resolvedStyle?.opacity ?? node.localStyle?.opacity ?? 1;
  const shapeStrokeWidth = resolvedStrokeWidth(node.localStyle, resolvedStyle);
  const currentStrokeColor = strokeColor(node.localStyle, resolvedStyle);
  const connectorWidth = resolvedConnectorStrokeWidth(
    node.localStyle,
    resolvedStyle,
  );
  const currentConnectorStrokeColor = connectorStrokeColor(
    node.localStyle,
    resolvedStyle,
  );
  const textWeight =
    resolvedStyle?.text?.weight ?? node.localStyle?.text?.weight;
  const textAlign = resolvedStyle?.text?.align ?? node.localStyle?.text?.align;
  const textItalic =
    resolvedStyle?.text?.italic ?? node.localStyle?.text?.italic;
  const textUnderline =
    resolvedStyle?.text?.underline ?? node.localStyle?.text?.underline;
  const canEditText = node.type === "text";
  const canEditFill = node.type === "shape" || node.type === "text";
  const canEditStroke = node.type === "shape";
  const canEditConnector = node.type === "connector";
  const canEditVisual = node.type === "visual";
  const canEditTable = node.type === "table";
  const connectorDash =
    resolvedStyle?.connector?.stroke?.dash ??
    node.localStyle?.connector?.stroke?.dash;
  const connectorStartArrow =
    resolvedStyle?.connector?.startArrow ??
    node.localStyle?.connector?.startArrow;
  const connectorEndArrow =
    resolvedStyle?.connector?.endArrow ?? node.localStyle?.connector?.endArrow;
  const tableHeaderFillColor = tableFillColor(
    resolvedStyle?.table?.headerFill,
    tableFillColor(node.localStyle?.table?.headerFill, "#f8fafc"),
  );
  const tableRowFillColor = tableFillColor(
    resolvedStyle?.table?.rowFill,
    tableFillColor(node.localStyle?.table?.rowFill, "#ffffff"),
  );
  const tableAlternateFillColor = tableFillColor(
    resolvedStyle?.table?.alternateRowFill,
    tableFillColor(node.localStyle?.table?.alternateRowFill, "#f8fafc"),
  );

  return (
    <section className="flex flex-col gap-2 px-3 py-2.5">
      <h4 className="text-[10px] font-bold uppercase tracking-[0.06em] text-ds-text-muted">
        Local Style
      </h4>
      {canEditText ? (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
              Text color
              <input
                type="color"
                value={textColor}
                onChange={(event) =>
                  onUpdateLocalStyle({
                    text: { color: event.currentTarget.value },
                  })
                }
                className={`h-8 w-full rounded-ds-md border border-ds-border-subtle bg-ds-surface ${FOCUS_RING}`}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
              Font size
              <input
                type="number"
                value={fontSize}
                min={4}
                max={160}
                step={1}
                onChange={(event) => {
                  const parsed = parseFiniteNumberInput(
                    event.currentTarget.value,
                  );
                  const fontSize =
                    parsed === undefined
                      ? undefined
                      : sanitizeBoundedNumber(parsed, 4, 160);
                  if (fontSize === undefined) return;
                  onUpdateLocalStyle({
                    text: { fontSizePt: fontSize },
                  });
                }}
                className={`h-8 rounded-ds-md border border-ds-border-subtle bg-ds-surface px-2 text-xs text-ds-text-primary outline-none ${FOCUS_RING}`}
              />
            </label>
            <div className="flex flex-col gap-1 text-xs text-ds-text-secondary">
              Font family
              <SelectMenu
                aria-label="Font family"
                variant="field"
                value={selectedFontId}
                options={FONT_FAMILY_OPTIONS}
                buttonClassName={
                  selectedFont ? undefined : "text-ds-text-muted"
                }
                onChange={(next) => {
                  const cssStack = slideFontCssStack(next);
                  if (!cssStack) return;
                  onUpdateLocalStyle({
                    text: { fontFamily: cssStack },
                  });
                }}
              />
            </div>
            <div className="flex flex-col gap-1 text-xs text-ds-text-secondary">
              Weight
              <SelectMenu
                aria-label="Weight"
                variant="field"
                value={String(textWeight ?? 400)}
                options={TEXT_WEIGHT_OPTIONS}
                onChange={(next) => {
                  const parsed = parseFiniteNumberInput(next);
                  if (parsed === undefined) return;
                  onUpdateLocalStyle({
                    text: {
                      weight: Math.round(clampToRange(parsed, 100, 900)),
                    },
                  });
                }}
              />
            </div>
            <div className="flex flex-col gap-1 text-xs text-ds-text-secondary">
              Align
              <SelectMenu
                aria-label="Align"
                variant="field"
                value={textAlign ?? "left"}
                options={TEXT_ALIGN_OPTIONS}
                onChange={(next) =>
                  onUpdateLocalStyle({
                    text: {
                      align: next as "left" | "center" | "right",
                    },
                  })
                }
              />
            </div>
          </div>
          <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
            Line height
            <input
              type="range"
              value={lineHeight}
              min={0.8}
              max={2}
              step={0.05}
              onChange={(event) => {
                const parsed = parseFiniteNumberInput(
                  event.currentTarget.value,
                );
                const lineHeight =
                  parsed === undefined
                    ? undefined
                    : sanitizeBoundedNumber(parsed, 0.8, 2);
                if (lineHeight === undefined) return;
                onUpdateLocalStyle({
                  text: { lineHeight },
                });
              }}
            />
          </label>
          <div className="flex gap-4 text-xs text-ds-text-secondary">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={textItalic === true}
                onChange={(event) =>
                  onUpdateLocalStyle({
                    text: { italic: event.currentTarget.checked },
                  })
                }
              />
              Italic
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={textUnderline === true}
                onChange={(event) =>
                  onUpdateLocalStyle({
                    text: { underline: event.currentTarget.checked },
                  })
                }
              />
              Underline
            </label>
          </div>
        </div>
      ) : null}
      {canEditFill ? (
        <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
          Fill color
          <input
            type="color"
            value={solidFillColor(node.localStyle, resolvedStyle)}
            onChange={(event) =>
              onUpdateLocalStyle({
                fill: { type: "solid", color: event.currentTarget.value },
              })
            }
            className={`h-8 w-full rounded-ds-md border border-ds-border-subtle bg-ds-surface ${FOCUS_RING}`}
          />
        </label>
      ) : null}
      {canEditStroke ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
            Stroke color
            <input
              type="color"
              value={currentStrokeColor}
              onChange={(event) =>
                onUpdateLocalStyle({
                  stroke: {
                    color: event.currentTarget.value,
                    widthPt: shapeStrokeWidth,
                  },
                })
              }
              className={`h-8 w-full rounded-ds-md border border-ds-border-subtle bg-ds-surface ${FOCUS_RING}`}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
            Stroke width
            <input
              type="number"
              value={shapeStrokeWidth}
              min={0}
              max={24}
              step={0.5}
              onChange={(event) => {
                const parsed = parseFiniteNumberInput(
                  event.currentTarget.value,
                );
                const widthPt =
                  parsed === undefined
                    ? undefined
                    : sanitizeBoundedNumber(parsed, 0, 24);
                if (widthPt === undefined) return;
                onUpdateLocalStyle({
                  stroke: {
                    color: currentStrokeColor,
                    widthPt,
                  },
                });
              }}
              className={`h-8 rounded-ds-md border border-ds-border-subtle bg-ds-surface px-2 text-xs text-ds-text-primary outline-none ${FOCUS_RING}`}
            />
          </label>
        </div>
      ) : null}
      {canEditConnector ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
            Line color
            <input
              type="color"
              value={currentConnectorStrokeColor}
              onChange={(event) =>
                onUpdateLocalStyle({
                  connector: {
                    ...node.localStyle?.connector,
                    stroke: {
                      color: event.currentTarget.value,
                      widthPt: connectorWidth,
                    },
                  },
                })
              }
              className={`h-8 w-full rounded-ds-md border border-ds-border-subtle bg-ds-surface ${FOCUS_RING}`}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
            Line width
            <input
              type="number"
              value={connectorWidth}
              min={0.5}
              max={24}
              step={0.5}
              onChange={(event) => {
                const parsed = parseFiniteNumberInput(
                  event.currentTarget.value,
                );
                const widthPt =
                  parsed === undefined
                    ? undefined
                    : sanitizeBoundedNumber(parsed, 0.5, 24);
                if (widthPt === undefined) return;
                onUpdateLocalStyle({
                  connector: {
                    ...node.localStyle?.connector,
                    stroke: {
                      color: currentConnectorStrokeColor,
                      widthPt,
                    },
                  },
                });
              }}
              className={`h-8 rounded-ds-md border border-ds-border-subtle bg-ds-surface px-2 text-xs text-ds-text-primary outline-none ${FOCUS_RING}`}
            />
          </label>
          <div className="flex flex-col gap-1 text-xs text-ds-text-secondary">
            Dash
            <SelectMenu
              aria-label="Dash"
              variant="field"
              value={connectorDash ?? "solid"}
              options={CONNECTOR_DASH_OPTIONS}
              onChange={(next) =>
                onUpdateLocalStyle({
                  connector: {
                    ...node.localStyle?.connector,
                    stroke: {
                      color: currentConnectorStrokeColor,
                      widthPt: connectorWidth,
                      dash: next as "solid" | "dashed" | "dotted",
                    },
                  },
                })
              }
            />
          </div>
          <div className="flex flex-col gap-1 text-xs text-ds-text-secondary">
            Start arrow
            <SelectMenu
              aria-label="Start arrow"
              variant="field"
              value={connectorStartArrow ?? "none"}
              options={CONNECTOR_ARROW_OPTIONS}
              onChange={(next) =>
                onUpdateLocalStyle({
                  connector: {
                    ...node.localStyle?.connector,
                    startArrow: next as "none" | "arrow" | "filled",
                  },
                })
              }
            />
          </div>
          <div className="flex flex-col gap-1 text-xs text-ds-text-secondary">
            End arrow
            <SelectMenu
              aria-label="End arrow"
              variant="field"
              value={connectorEndArrow ?? "arrow"}
              options={CONNECTOR_ARROW_OPTIONS}
              onChange={(next) =>
                onUpdateLocalStyle({
                  connector: {
                    ...node.localStyle?.connector,
                    endArrow: next as "none" | "arrow" | "filled",
                  },
                })
              }
            />
          </div>
        </div>
      ) : null}
      {canEditVisual ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1 text-xs text-ds-text-secondary">
            Visual theme
            <SelectMenu
              aria-label="Visual theme"
              variant="field"
              value={node.localStyle?.visual?.styleThemeId ?? "default"}
              options={VISUAL_THEME_OPTIONS}
              onChange={(next) =>
                onUpdateLocalStyle({
                  visual: { styleThemeId: next },
                })
              }
            />
          </div>
          <label className="flex items-center gap-1.5 self-end text-xs text-ds-text-secondary">
            <input
              type="checkbox"
              checked={node.localStyle?.visual?.transparentBackground === true}
              onChange={(event) =>
                onUpdateLocalStyle({
                  visual: {
                    ...node.localStyle?.visual,
                    transparentBackground: event.currentTarget.checked,
                  },
                })
              }
            />
            Transparent
          </label>
          {(["primary", "secondary", "accent", "muted"] as const).map(
            (channel) => (
              <label
                key={channel}
                className="flex flex-col gap-1 text-xs text-ds-text-secondary"
              >
                {channel} color
                <input
                  type="color"
                  value={
                    typeof node.localStyle?.visual?.channelColors?.[channel] ===
                    "string"
                      ? (node.localStyle.visual.channelColors[
                          channel
                        ] as string)
                      : channel === "primary"
                        ? "#2563eb"
                        : channel === "secondary"
                          ? "#64748b"
                          : channel === "accent"
                            ? "#f59e0b"
                            : "#94a3b8"
                  }
                  onChange={(event) =>
                    onUpdateLocalStyle({
                      visual: {
                        ...node.localStyle?.visual,
                        channelColors: {
                          ...node.localStyle?.visual?.channelColors,
                          [channel]: event.currentTarget.value,
                        },
                      },
                    })
                  }
                  className={`h-8 w-full rounded-ds-md border border-ds-border-subtle bg-ds-surface ${FOCUS_RING}`}
                />
              </label>
            ),
          )}
        </div>
      ) : null}
      {canEditTable ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
            Header fill
            <input
              type="color"
              value={tableHeaderFillColor}
              onChange={(event) =>
                onUpdateLocalStyle({
                  table: {
                    ...node.localStyle?.table,
                    headerFill: {
                      type: "solid",
                      color: event.currentTarget.value,
                    },
                  },
                })
              }
              className={`h-8 w-full rounded-ds-md border border-ds-border-subtle bg-ds-surface ${FOCUS_RING}`}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
            Row fill
            <input
              type="color"
              value={tableRowFillColor}
              onChange={(event) =>
                onUpdateLocalStyle({
                  table: {
                    ...node.localStyle?.table,
                    rowFill: {
                      type: "solid",
                      color: event.currentTarget.value,
                    },
                  },
                })
              }
              className={`h-8 w-full rounded-ds-md border border-ds-border-subtle bg-ds-surface ${FOCUS_RING}`}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
            Alternate fill
            <input
              type="color"
              value={tableAlternateFillColor}
              onChange={(event) =>
                onUpdateLocalStyle({
                  table: {
                    ...node.localStyle?.table,
                    alternateRowFill: {
                      type: "solid",
                      color: event.currentTarget.value,
                    },
                  },
                })
              }
              className={`h-8 w-full rounded-ds-md border border-ds-border-subtle bg-ds-surface ${FOCUS_RING}`}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
            Border color
            <input
              type="color"
              value={
                typeof node.localStyle?.table?.border?.color === "string"
                  ? node.localStyle.table.border.color
                  : "#cbd5e1"
              }
              onChange={(event) =>
                onUpdateLocalStyle({
                  table: {
                    ...node.localStyle?.table,
                    border: {
                      color: event.currentTarget.value,
                      widthPt: node.localStyle?.table?.border?.widthPt ?? 1,
                    },
                  },
                })
              }
              className={`h-8 w-full rounded-ds-md border border-ds-border-subtle bg-ds-surface ${FOCUS_RING}`}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
            Border width
            <input
              type="number"
              value={node.localStyle?.table?.border?.widthPt ?? 1}
              min={0}
              max={8}
              step={0.5}
              onChange={(event) => {
                const parsed = parseFiniteNumberInput(
                  event.currentTarget.value,
                );
                const widthPt =
                  parsed === undefined
                    ? undefined
                    : sanitizeBoundedNumber(parsed, 0, 8);
                if (widthPt === undefined) return;
                onUpdateLocalStyle({
                  table: {
                    ...node.localStyle?.table,
                    border: {
                      color:
                        typeof node.localStyle?.table?.border?.color ===
                        "string"
                          ? node.localStyle.table.border.color
                          : "#cbd5e1",
                      widthPt,
                    },
                  },
                });
              }}
              className={`h-8 rounded-ds-md border border-ds-border-subtle bg-ds-surface px-2 text-xs text-ds-text-primary outline-none ${FOCUS_RING}`}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
            Cell padding
            <input
              type="number"
              value={node.localStyle?.table?.cellPaddingPt?.top ?? 4}
              min={0}
              max={24}
              step={1}
              onChange={(event) => {
                const parsed = parseFiniteNumberInput(
                  event.currentTarget.value,
                );
                const padding =
                  parsed === undefined
                    ? undefined
                    : sanitizeBoundedNumber(parsed, 0, 24);
                if (padding === undefined) return;
                onUpdateLocalStyle({
                  table: {
                    ...node.localStyle?.table,
                    cellPaddingPt: {
                      top: padding,
                      right: padding,
                      bottom: padding,
                      left: padding,
                    },
                  },
                });
              }}
              className={`h-8 rounded-ds-md border border-ds-border-subtle bg-ds-surface px-2 text-xs text-ds-text-primary outline-none ${FOCUS_RING}`}
            />
          </label>
        </div>
      ) : null}
      <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
        <span className="flex items-center justify-between gap-2">
          <span>Opacity</span>
          <span className="text-ds-text-muted">
            {Math.round(opacity * 100)}%
          </span>
        </span>
        <input
          type="range"
          value={opacity}
          min={0}
          max={1}
          step={0.05}
          onChange={(event) => {
            const parsed = parseFiniteNumberInput(event.currentTarget.value);
            const nextOpacity =
              parsed === undefined
                ? undefined
                : sanitizeBoundedNumber(parsed, 0, 1);
            if (nextOpacity === undefined) return;
            onUpdateLocalStyle({ opacity: nextOpacity });
          }}
        />
      </label>
    </section>
  );
}
