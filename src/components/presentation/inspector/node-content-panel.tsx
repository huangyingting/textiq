"use client";

import { useState, type JSX } from "react";

import type {
  ConnectorAnchor,
  ConnectorContent,
  ImageCrop,
  ShapeKind,
  SlideChildNode,
  TableContent,
  TextContent,
} from "@/lib/presentation/schema";
import { updateTableCellContent } from "@/lib/presentation/table-cell-editing";
import { FOCUS_RING } from "@/components/ui/tokens";
import { SelectMenu, type SelectMenuOption } from "@/components/ui/select-menu";
import {
  parseFiniteNumberInput,
  sanitizePercentPoint,
  updateImageCropSide,
} from "./numeric-sanitization";

export interface NodeContentPanelProps {
  node: SlideChildNode;
  onUpdateContent: (patch: Record<string, unknown>) => void;
  assetResolver?: (assetId: string) => string | undefined;
  onReplaceImage?: () => void;
  onReplaceVisual?: () => void;
}

const SHAPE_OPTIONS: ShapeKind[] = [
  "rect",
  "ellipse",
  "line",
  "triangle",
  "diamond",
  "circle",
  "square",
];

const CONNECTOR_ANCHORS: ConnectorAnchor[] = [
  "center",
  "top",
  "right",
  "bottom",
  "left",
];

const SHAPE_MENU_OPTIONS: readonly SelectMenuOption[] = SHAPE_OPTIONS.map(
  (shape) => ({ value: shape, label: shape }),
);

const IMAGE_FIT_OPTIONS: readonly SelectMenuOption[] = [
  { value: "contain", label: "contain" },
  { value: "cover", label: "cover" },
  { value: "fill", label: "fill" },
  { value: "none", label: "none" },
];

const CONNECTOR_ROUTING_OPTIONS: readonly SelectMenuOption[] = [
  { value: "straight", label: "straight" },
  { value: "curved", label: "curved" },
  { value: "elbow", label: "step" },
];

const CONNECTOR_ENDPOINT_KIND_OPTIONS: readonly SelectMenuOption[] = [
  { value: "point", label: "Point" },
  { value: "node", label: "Node" },
];

const CONNECTOR_ANCHOR_OPTIONS: readonly SelectMenuOption[] =
  CONNECTOR_ANCHORS.map((anchor) => ({ value: anchor, label: anchor }));

export function textValue(content: TextContent): string {
  return content.paragraphs.map((paragraph) => paragraph.text).join("\n");
}

export function textContentFromValue(
  value: string,
  idPrefix: string,
): TextContent {
  const lines = value.split("\n");
  return {
    paragraphs: lines.map((text, index) => ({
      id: `${idPrefix}-p-${index + 1}`,
      text,
    })),
  };
}

export function updateTableCell(
  table: TableContent,
  rowIndex: number,
  cellIndex: number,
  text: string,
): TableContent {
  return updateTableCellContent(table, rowIndex, cellIndex, (cell) => ({
    ...cell,
    text,
  }));
}

export function emptyTableRow(table: TableContent, id: string) {
  return { id, cells: table.columns.map(() => ({ text: "" })) };
}

function uniqueTableItemId(prefix: string, existingIds: string[]): string {
  const usedIds = new Set(existingIds);
  const baseId = `${prefix}-${Date.now().toString(36)}`;
  let candidate = baseId;
  let suffix = 1;

  while (usedIds.has(candidate)) {
    candidate = `${baseId}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

export function insertTableRow(
  table: TableContent,
  index: number,
  position: "before" | "after",
  nodeId: string,
): TableContent {
  const rows = [...table.rows];
  const target = position === "before" ? index : index + 1;
  rows.splice(
    Math.max(0, Math.min(rows.length, target)),
    0,
    emptyTableRow(
      table,
      uniqueTableItemId(
        `${nodeId}-row`,
        table.rows.map((row) => row.id),
      ),
    ),
  );
  return { ...table, rows };
}

export function deleteTableRow(
  table: TableContent,
  index: number,
): TableContent {
  if (table.rows.length <= 1) return table;
  return { ...table, rows: table.rows.filter((_row, i) => i !== index) };
}

export function insertTableColumn(
  table: TableContent,
  index: number,
  position: "before" | "after",
  nodeId: string,
): TableContent {
  const target = position === "before" ? index : index + 1;
  const columnIndex = Math.max(0, Math.min(table.columns.length, target));
  const column = {
    id: uniqueTableItemId(
      `${nodeId}-col`,
      table.columns.map((column) => column.id),
    ),
    label: `Column ${columnIndex + 1}`,
  };
  return {
    ...table,
    columns: [
      ...table.columns.slice(0, columnIndex),
      column,
      ...table.columns.slice(columnIndex),
    ],
    rows: table.rows.map((row) => ({
      ...row,
      cells: [
        ...row.cells.slice(0, columnIndex),
        { text: "" },
        ...row.cells.slice(columnIndex),
      ],
    })),
  };
}

export function deleteTableColumn(
  table: TableContent,
  index: number,
): TableContent {
  if (table.columns.length <= 1) return table;
  return {
    ...table,
    columns: table.columns.filter((_column, i) => i !== index),
    rows: table.rows.map((row) => ({
      ...row,
      cells: row.cells.filter((_cell, i) => i !== index),
    })),
  };
}

export function updateConnectorPoint(
  content: ConnectorContent,
  side: "from" | "to",
  axis: "x" | "y",
  value: number,
): ConnectorContent {
  const sanitized = sanitizePercentPoint(value);
  if (sanitized === undefined) return content;
  const endpoint = content[side];
  if (endpoint.kind !== "point") return content;
  return {
    ...content,
    [side]: {
      ...endpoint,
      point: { ...endpoint.point, [axis]: sanitized },
    },
  };
}

export function nextImageCrop(
  crop: ImageCrop | undefined,
  side: keyof ImageCrop,
  value: number,
): ImageCrop | undefined {
  return updateImageCropSide(crop, side, value);
}

export function NodeContentPanel({
  node,
  onUpdateContent,
  assetResolver,
  onReplaceImage,
  onReplaceVisual,
}: NodeContentPanelProps): JSX.Element {
  const [targetRowIndex, setTargetRowIndex] = useState(0);
  const [targetColumnIndex, setTargetColumnIndex] = useState(0);
  const tableRowIndex =
    node.type === "table"
      ? Math.max(0, Math.min(targetRowIndex, node.content.rows.length - 1))
      : 0;
  const tableColumnIndex =
    node.type === "table"
      ? Math.max(
          0,
          Math.min(targetColumnIndex, node.content.columns.length - 1),
        )
      : 0;
  return (
    <section className="flex flex-col gap-2 px-3 py-2.5">
      <h4 className="text-[10px] font-bold uppercase tracking-[0.06em] text-ds-text-muted">
        Content
      </h4>
      {node.type === "text" ? (
        <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
          Text content
          <textarea
            value={textValue(node.content)}
            rows={5}
            onChange={(event) =>
              onUpdateContent(
                textContentFromValue(event.currentTarget.value, node.id),
              )
            }
            className={`min-h-24 w-full resize-y rounded-ds-md border border-ds-border-subtle bg-ds-surface px-2 py-1.5 text-xs text-ds-text-primary outline-none ${FOCUS_RING}`}
          />
        </label>
      ) : null}
      {node.type === "shape" ? (
        <div className="flex flex-col gap-1 text-xs text-ds-text-secondary">
          Shape
          <SelectMenu
            aria-label="Shape"
            variant="field"
            value={node.content.shape}
            options={SHAPE_MENU_OPTIONS}
            onChange={(next) =>
              onUpdateContent({
                shape: next as ShapeKind,
              })
            }
          />
        </div>
      ) : null}
      {node.type === "image" ? (
        <>
          {(() => {
            const assetPreview = assetResolver?.(node.content.assetId);
            return (
              <>
                <div className="overflow-hidden rounded-ds-sm border border-ds-border-subtle bg-ds-surface-raised">
                  {assetPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={assetPreview}
                      alt={node.content.alt ?? ""}
                      className="h-24 w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-24 items-center justify-center text-xs text-ds-text-muted">
                      No image preview
                    </div>
                  )}
                </div>
                <p className="text-[11px] text-ds-text-muted">
                  {assetPreview
                    ? "Image snapshot is available."
                    : "Image snapshot is unavailable."}
                </p>
              </>
            );
          })()}
          <button
            type="button"
            onClick={onReplaceImage}
            disabled={onReplaceImage === undefined}
            className="self-start rounded-ds-sm border border-ds-border-subtle px-2 py-1 text-xs text-ds-text-secondary hover:bg-ds-state-hover disabled:opacity-40"
          >
            Replace image
          </button>
          <div className="flex flex-col gap-1 text-xs text-ds-text-secondary">
            Fit
            <SelectMenu
              aria-label="Fit"
              variant="field"
              value={node.content.fit ?? "cover"}
              options={IMAGE_FIT_OPTIONS}
              onChange={(next) => onUpdateContent({ fit: next })}
            />
          </div>
          <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
            Alt text
            <input
              value={node.content.alt ?? ""}
              onChange={(event) =>
                onUpdateContent({ alt: event.currentTarget.value })
              }
              className={`rounded-ds-md border border-ds-border-subtle bg-ds-surface px-2 py-1.5 text-xs text-ds-text-primary outline-none ${FOCUS_RING}`}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            {(["top", "right", "bottom", "left"] as const).map((side) => (
              <label
                key={side}
                className="flex flex-col gap-1 text-xs text-ds-text-secondary"
              >
                Crop {side}
                <input
                  type="number"
                  value={node.content.crop?.[side] ?? 0}
                  min={0}
                  max={95}
                  step={1}
                  onChange={(event) => {
                    const next = parseFiniteNumberInput(
                      event.currentTarget.value,
                    );
                    if (next === undefined) return;
                    const crop = nextImageCrop(node.content.crop, side, next);
                    if (crop === undefined) return;
                    onUpdateContent({ crop });
                  }}
                  className={`rounded-ds-md border border-ds-border-subtle bg-ds-surface px-2 py-1.5 text-xs text-ds-text-primary outline-none ${FOCUS_RING}`}
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={() => onUpdateContent({ crop: undefined })}
            disabled={node.content.crop === undefined}
            className="self-start rounded-ds-sm border border-ds-border-subtle px-2 py-1 text-xs text-ds-text-secondary hover:bg-ds-state-hover disabled:opacity-40"
          >
            Reset crop
          </button>
          <details className="rounded-ds-sm border border-ds-border-subtle bg-ds-surface px-2 py-1.5">
            <summary className="cursor-pointer text-xs font-medium text-ds-text-secondary">
              Debug identifiers
            </summary>
            <label className="mt-1.5 flex flex-col gap-1 text-xs text-ds-text-secondary">
              Image asset id
              <input
                value={node.content.assetId}
                readOnly
                className="rounded-ds-md border border-ds-border-subtle bg-ds-surface-raised px-2 py-1.5 font-mono text-xs text-ds-text-primary"
              />
            </label>
          </details>
        </>
      ) : null}
      {node.type === "visual" ? (
        <>
          {(() => {
            const assetPreview = node.content.assetId
              ? assetResolver?.(node.content.assetId)
              : undefined;
            const statusLabel = node.content.visualId
              ? node.content.assetId
                ? "Linked visual with snapshot asset."
                : "Linked visual without snapshot asset."
              : node.content.assetId
                ? "Snapshot asset is linked."
                : "Visual source is unavailable.";
            return (
              <>
                <div className="overflow-hidden rounded-ds-sm border border-ds-border-subtle bg-ds-surface-raised">
                  {assetPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={assetPreview}
                      alt={node.content.alt ?? ""}
                      className="h-24 w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-24 items-center justify-center text-xs text-ds-text-muted">
                      No visual preview
                    </div>
                  )}
                </div>
                <p className="text-[11px] text-ds-text-muted">{statusLabel}</p>
              </>
            );
          })()}
          <button
            type="button"
            onClick={onReplaceVisual}
            disabled={onReplaceVisual === undefined}
            className="self-start rounded-ds-sm border border-ds-border-subtle px-2 py-1 text-xs text-ds-text-secondary hover:bg-ds-state-hover disabled:opacity-40"
          >
            Replace visual
          </button>
          <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
            Alt text
            <input
              value={node.content.alt ?? ""}
              onChange={(event) =>
                onUpdateContent({ alt: event.currentTarget.value })
              }
              className={`rounded-ds-md border border-ds-border-subtle bg-ds-surface px-2 py-1.5 text-xs text-ds-text-primary outline-none ${FOCUS_RING}`}
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-ds-text-secondary">
            <input
              type="checkbox"
              checked={node.content.transparentBackground === true}
              onChange={(event) =>
                onUpdateContent({
                  transparentBackground: event.currentTarget.checked,
                })
              }
            />
            Transparent background
          </label>
          <details className="rounded-ds-sm border border-ds-border-subtle bg-ds-surface px-2 py-1.5">
            <summary className="cursor-pointer text-xs font-medium text-ds-text-secondary">
              Debug identifiers
            </summary>
            <div className="mt-1.5 grid gap-1.5">
              <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
                Visual id
                <input
                  value={node.content.visualId ?? ""}
                  readOnly
                  className="rounded-ds-md border border-ds-border-subtle bg-ds-surface-raised px-2 py-1.5 font-mono text-xs text-ds-text-primary"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
                Visual asset id
                <input
                  value={node.content.assetId ?? ""}
                  readOnly
                  className="rounded-ds-md border border-ds-border-subtle bg-ds-surface-raised px-2 py-1.5 font-mono text-xs text-ds-text-primary"
                />
              </label>
            </div>
          </details>
        </>
      ) : null}
      {node.type === "table" ? (
        <div className="flex flex-col gap-2">
          <div
            className="grid gap-1"
            style={{
              gridTemplateColumns: `repeat(${node.content.columns.length}, minmax(0, 1fr))`,
            }}
          >
            {node.content.columns.map((column, columnIndex) => (
              <input
                key={column.id}
                value={column.label}
                aria-label={`Column ${columnIndex + 1} label`}
                onChange={(event) =>
                  onUpdateContent({
                    columns: node.content.columns.map(
                      (candidate, currentIndex) =>
                        currentIndex === columnIndex
                          ? { ...candidate, label: event.currentTarget.value }
                          : candidate,
                    ),
                  })
                }
                className={`min-w-0 rounded-ds-sm border border-ds-border-subtle bg-ds-surface px-1.5 py-1 text-[11px] font-medium text-ds-text-primary outline-none ${FOCUS_RING}`}
              />
            ))}
          </div>
          {node.content.rows.map((row, rowIndex) => (
            <div
              key={row.id}
              className="grid gap-1"
              style={{
                gridTemplateColumns: `repeat(${node.content.columns.length}, minmax(0, 1fr))`,
              }}
            >
              {row.cells.map((cell, cellIndex) => (
                <input
                  key={`${row.id}-${cellIndex}`}
                  value={cell.text}
                  aria-label={`Row ${rowIndex + 1} cell ${cellIndex + 1}`}
                  onChange={(event) =>
                    onUpdateContent(
                      updateTableCell(
                        node.content,
                        rowIndex,
                        cellIndex,
                        event.currentTarget.value,
                      ),
                    )
                  }
                  className={`min-w-0 rounded-ds-sm border border-ds-border-subtle bg-ds-surface px-1.5 py-1 text-[11px] text-ds-text-primary outline-none ${FOCUS_RING}`}
                />
              ))}
            </div>
          ))}
          <div className="grid grid-cols-2 gap-2 rounded-ds-sm border border-ds-border-subtle p-2">
            <div className="flex flex-col gap-1 text-xs text-ds-text-secondary">
              Target row
              <SelectMenu
                aria-label="Target row"
                variant="field"
                value={String(tableRowIndex)}
                options={node.content.rows.map((_row, index) => ({
                  value: String(index),
                  label: `Row ${index + 1}`,
                }))}
                onChange={(next) => setTargetRowIndex(Number(next))}
              />
            </div>
            <div className="flex flex-col gap-1 text-xs text-ds-text-secondary">
              Target column
              <SelectMenu
                aria-label="Target column"
                variant="field"
                value={String(tableColumnIndex)}
                options={node.content.columns.map((column, index) => ({
                  value: String(index),
                  label: column.label || `Column ${index + 1}`,
                }))}
                onChange={(next) => setTargetColumnIndex(Number(next))}
              />
            </div>
            <button
              type="button"
              onClick={() =>
                onUpdateContent(
                  insertTableRow(
                    node.content,
                    tableRowIndex,
                    "before",
                    node.id,
                  ),
                )
              }
              className="rounded-ds-sm border border-ds-border-subtle px-2 py-1 text-xs text-ds-text-secondary hover:bg-ds-state-hover"
            >
              Insert row before
            </button>
            <button
              type="button"
              onClick={() =>
                onUpdateContent(
                  insertTableRow(node.content, tableRowIndex, "after", node.id),
                )
              }
              className="rounded-ds-sm border border-ds-border-subtle px-2 py-1 text-xs text-ds-text-secondary hover:bg-ds-state-hover"
            >
              Insert row after
            </button>
            <button
              type="button"
              disabled={node.content.rows.length <= 1}
              onClick={() =>
                onUpdateContent(deleteTableRow(node.content, tableRowIndex))
              }
              className="rounded-ds-sm border border-ds-border-subtle px-2 py-1 text-xs text-ds-text-secondary hover:bg-ds-state-hover disabled:opacity-40"
            >
              Delete target row
            </button>
            <span aria-hidden="true" />
            <button
              type="button"
              onClick={() =>
                onUpdateContent(
                  insertTableColumn(
                    node.content,
                    tableColumnIndex,
                    "before",
                    node.id,
                  ),
                )
              }
              className="rounded-ds-sm border border-ds-border-subtle px-2 py-1 text-xs text-ds-text-secondary hover:bg-ds-state-hover"
            >
              Insert col before
            </button>
            <button
              type="button"
              onClick={() =>
                onUpdateContent(
                  insertTableColumn(
                    node.content,
                    tableColumnIndex,
                    "after",
                    node.id,
                  ),
                )
              }
              className="rounded-ds-sm border border-ds-border-subtle px-2 py-1 text-xs text-ds-text-secondary hover:bg-ds-state-hover"
            >
              Insert col after
            </button>
            <button
              type="button"
              disabled={node.content.columns.length <= 1}
              onClick={() =>
                onUpdateContent(
                  deleteTableColumn(node.content, tableColumnIndex),
                )
              }
              className="rounded-ds-sm border border-ds-border-subtle px-2 py-1 text-xs text-ds-text-secondary hover:bg-ds-state-hover disabled:opacity-40"
            >
              Delete target column
            </button>
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() =>
                onUpdateContent(
                  insertTableRow(
                    node.content,
                    node.content.rows.length - 1,
                    "after",
                    node.id,
                  ),
                )
              }
              className="rounded-ds-sm border border-ds-border-subtle px-2 py-1 text-xs text-ds-text-secondary hover:bg-ds-state-hover"
            >
              Add row
            </button>
            <button
              type="button"
              onClick={() =>
                onUpdateContent(
                  insertTableColumn(
                    node.content,
                    node.content.columns.length - 1,
                    "after",
                    node.id,
                  ),
                )
              }
              className="rounded-ds-sm border border-ds-border-subtle px-2 py-1 text-xs text-ds-text-secondary hover:bg-ds-state-hover"
            >
              Add column
            </button>
            <button
              type="button"
              disabled={node.content.rows.length <= 1}
              onClick={() =>
                onUpdateContent({
                  rows: node.content.rows.slice(0, -1),
                })
              }
              className="rounded-ds-sm border border-ds-border-subtle px-2 py-1 text-xs text-ds-text-secondary hover:bg-ds-state-hover disabled:opacity-40"
            >
              Delete row
            </button>
            <button
              type="button"
              disabled={node.content.columns.length <= 1}
              onClick={() =>
                onUpdateContent({
                  columns: node.content.columns.slice(0, -1),
                  rows: node.content.rows.map((row) => ({
                    ...row,
                    cells: row.cells.slice(0, -1),
                  })),
                })
              }
              className="rounded-ds-sm border border-ds-border-subtle px-2 py-1 text-xs text-ds-text-secondary hover:bg-ds-state-hover disabled:opacity-40"
            >
              Delete column
            </button>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-ds-text-secondary">
            <input
              type="checkbox"
              checked={node.content.header === true}
              onChange={(event) =>
                onUpdateContent({ header: event.currentTarget.checked })
              }
            />
            Header row
          </label>
          <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
            Caption
            <input
              value={node.content.caption ?? ""}
              onChange={(event) =>
                onUpdateContent({ caption: event.currentTarget.value })
              }
              className={`rounded-ds-md border border-ds-border-subtle bg-ds-surface px-2 py-1.5 text-xs text-ds-text-primary outline-none ${FOCUS_RING}`}
            />
          </label>
        </div>
      ) : null}
      {node.type === "connector" ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1 text-xs text-ds-text-secondary">
            Routing
            <SelectMenu
              aria-label="Routing"
              variant="field"
              value={node.content.routing ?? "straight"}
              options={CONNECTOR_ROUTING_OPTIONS}
              onChange={(next) => onUpdateContent({ routing: next })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(["from", "to"] as const).map((side) => {
              const endpoint = node.content[side];
              return (
                <div
                  key={side}
                  className="flex flex-col gap-1 rounded-ds-sm border border-ds-border-subtle p-1.5"
                >
                  <span className="text-xs font-medium text-ds-text-secondary">
                    {side}
                  </span>
                  <SelectMenu
                    aria-label={`${side} endpoint kind`}
                    variant="field"
                    value={endpoint.kind}
                    options={CONNECTOR_ENDPOINT_KIND_OPTIONS}
                    onChange={(next) => {
                      const kind = next;
                      onUpdateContent({
                        [side]:
                          kind === "node"
                            ? { kind: "node", nodeId: "", anchor: "center" }
                            : {
                                kind: "point",
                                point:
                                  endpoint.kind === "point"
                                    ? endpoint.point
                                    : { x: 50, y: 50 },
                              },
                      });
                    }}
                  />
                  {endpoint.kind === "point" ? (
                    <>
                      <input
                        type="number"
                        value={endpoint.point.x}
                        min={0}
                        max={100}
                        step={1}
                        aria-label={`${side} x`}
                        onChange={(event) => {
                          const next = parseFiniteNumberInput(
                            event.currentTarget.value,
                          );
                          if (next === undefined) return;
                          onUpdateContent(
                            updateConnectorPoint(node.content, side, "x", next),
                          );
                        }}
                        className={`rounded-ds-md border border-ds-border-subtle bg-ds-surface px-2 py-1 text-xs text-ds-text-primary outline-none ${FOCUS_RING}`}
                      />
                      <input
                        type="number"
                        value={endpoint.point.y}
                        min={0}
                        max={100}
                        step={1}
                        aria-label={`${side} y`}
                        onChange={(event) => {
                          const next = parseFiniteNumberInput(
                            event.currentTarget.value,
                          );
                          if (next === undefined) return;
                          onUpdateContent(
                            updateConnectorPoint(node.content, side, "y", next),
                          );
                        }}
                        className={`rounded-ds-md border border-ds-border-subtle bg-ds-surface px-2 py-1 text-xs text-ds-text-primary outline-none ${FOCUS_RING}`}
                      />
                    </>
                  ) : (
                    <>
                      <input
                        value={endpoint.nodeId}
                        aria-label={`${side} node id`}
                        placeholder="Node id"
                        onChange={(event) =>
                          onUpdateContent({
                            [side]: {
                              ...endpoint,
                              nodeId: event.currentTarget.value,
                            },
                          })
                        }
                        className={`rounded-ds-md border border-ds-border-subtle bg-ds-surface px-2 py-1 text-xs text-ds-text-primary outline-none ${FOCUS_RING}`}
                      />
                      <SelectMenu
                        aria-label={`${side} anchor`}
                        variant="field"
                        value={endpoint.anchor}
                        options={CONNECTOR_ANCHOR_OPTIONS}
                        onChange={(next) =>
                          onUpdateContent({
                            [side]: {
                              ...endpoint,
                              anchor: next as ConnectorAnchor,
                            },
                          })
                        }
                      />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      {node.type === "group" ? (
        <p className="text-xs text-ds-text-secondary">
          Group children are edited on the stage.
        </p>
      ) : null}
    </section>
  );
}
