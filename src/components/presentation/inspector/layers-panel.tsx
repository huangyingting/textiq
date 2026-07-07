"use client";

import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  GripVertical,
  Lock,
  PenLine,
  Unlock,
} from "lucide-react";
import { useState, type DragEvent, type JSX, type KeyboardEvent } from "react";

import type { ResolvedRenderNode } from "@/lib/presentation/render-tree";
import type { SlideChildNode } from "@/lib/presentation/schema";
import { layerBandForNodeType } from "@/lib/presentation/layer-bands";

export interface LayersPanelProps {
  nodes: readonly SlideChildNode[];
  decorations?: readonly ResolvedRenderNode[];
  chrome?: readonly ResolvedRenderNode[];
  selectedIds: readonly string[];
  onSelectNode: (nodeId: string) => void;
  onUpdateNode: (
    nodeId: string,
    patch: { name?: string; locked?: boolean; hidden?: boolean },
  ) => void;
  onReorderNode?: (nodeId: string, targetIndex: number) => void;
}

type LayerItem = {
  id: string;
  label: string;
  depth: number;
  zIndex: number;
  band?: number;
  source: "user" | "themeDecoration" | "deckChrome";
  editable: boolean;
  node?: SlideChildNode;
};

export function layerLabel(node: SlideChildNode): string {
  if (node.name) return node.name;
  if (node.type === "text") {
    const text = node.content.paragraphs[0]?.text.trim();
    return text || "Text";
  }
  if (node.type === "shape") return `${node.content.shape} shape`;
  if (node.type === "image") return node.content.alt ?? "Image";
  if (node.type === "visual") return node.content.visualId ?? "Visual";
  if (node.type === "table") return "Table";
  if (node.type === "connector") return "Connector";
  return "Group";
}

function generatedLayerLabel(node: ResolvedRenderNode): string {
  if (node.source === "deckChrome") {
    const kind = node.chromeKind ?? "deck chrome";
    return `Deck ${kind.replace(/([A-Z])/g, " $1").toLowerCase()}`;
  }
  if (node.content.type === "text") {
    const text = node.content.content.paragraphs[0]?.text.trim();
    return text ? `Theme decoration: ${text}` : "Theme decoration";
  }
  return `Theme ${node.content.type}`;
}

export function flattenLayers(
  nodes: readonly SlideChildNode[],
  depth = 0,
): { node: SlideChildNode; depth: number }[] {
  return nodes.flatMap((node) => [
    { node, depth },
    ...(node.type === "group" ? flattenLayers(node.children, depth + 1) : []),
  ]);
}

function flattenGeneratedLayers(
  nodes: readonly ResolvedRenderNode[],
  source: "themeDecoration" | "deckChrome",
  depth = 0,
): LayerItem[] {
  return nodes.flatMap((node) => [
    {
      id: node.id,
      label: generatedLayerLabel(node),
      depth,
      zIndex: node.layout.zIndex ?? 0,
      source,
      editable: false,
    },
    ...(node.children
      ? flattenGeneratedLayers(node.children, source, depth + 1)
      : []),
  ]);
}

function sourceBadge(source: LayerItem["source"]): string {
  if (source === "themeDecoration") return "Theme";
  if (source === "deckChrome") return "Chrome";
  return "User";
}

function userLayerGroupLabel(node: SlideChildNode): string {
  if (node.type === "text") return "Text";
  if (node.type === "connector") return "Connectors";
  if (node.type === "group") return "Groups";
  if (node.type === "table") return "Tables";
  if (node.type === "image" || node.type === "visual") return "Media";
  return "Shapes";
}

export function LayersPanel({
  nodes,
  decorations = [],
  chrome = [],
  selectedIds,
  onSelectNode,
  onUpdateNode,
  onReorderNode,
}: LayersPanelProps): JSX.Element | null {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const userLayers: LayerItem[] = flattenLayers(nodes).map(
    ({ node, depth }) => {
      const band = layerBandForNodeType(node.type);
      return {
        id: node.id,
        label: layerLabel(node),
        depth,
        zIndex: node.layout?.zIndex ?? 0,
        band,
        source: "user",
        editable: true,
        node,
      };
    },
  );
  const userLayerGroupsByBand = new Map<
    number,
    { band: number; label: string; items: LayerItem[] }
  >();
  for (const layer of userLayers) {
    if (layer.band === undefined || !layer.node) continue;
    const group = userLayerGroupsByBand.get(layer.band) ?? {
      band: layer.band,
      label: userLayerGroupLabel(layer.node),
      items: [],
    };
    group.items.push(layer);
    userLayerGroupsByBand.set(layer.band, group);
  }
  const userLayerGroups = [...userLayerGroupsByBand.values()]
    .sort((a, b) => b.band - a.band)
    .map((group) => ({
      ...group,
      items: [...group.items].sort((a, b) => b.zIndex - a.zIndex),
    }));
  const userLayerIndexById = new Map<string, number>();
  const userLayerGroupSizeById = new Map<string, number>();
  const userLayerBandById = new Map<string, number>();
  for (const group of userLayerGroups) {
    group.items.forEach((item, index) => {
      userLayerIndexById.set(item.id, index);
      userLayerGroupSizeById.set(item.id, group.items.length);
      userLayerBandById.set(item.id, group.band);
    });
  }
  const userLayersById = new Map(userLayers.map((item) => [item.id, item]));
  const generatedLayers = [
    ...flattenGeneratedLayers(decorations, "themeDecoration"),
    ...flattenGeneratedLayers(chrome, "deckChrome"),
  ].sort((a, b) => b.zIndex - a.zIndex);
  if (userLayerGroups.length === 0 && generatedLayers.length === 0) {
    return null;
  }

  function handleReorder(nodeId: string, targetIndex: number) {
    if (!onReorderNode) return;
    const groupSize = userLayerGroupSizeById.get(nodeId);
    if (groupSize === undefined || groupSize === 0) return;
    const nextIndex = Math.max(0, Math.min(targetIndex, groupSize - 1));
    onReorderNode(nodeId, nextIndex);
    const movedLayer = userLayersById.get(nodeId);
    const label = movedLayer?.label ?? "Layer";
    setStatusMessage(
      `Moved ${label} to position ${nextIndex + 1} of ${groupSize}.`,
    );
  }

  function handleDragStart(event: DragEvent<HTMLDivElement>, item: LayerItem) {
    if (!item.editable || !onReorderNode || item.node?.layout === undefined)
      return;
    setDraggingId(item.id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.id);
  }

  function handleDrop(item: LayerItem) {
    const targetIndex = userLayerIndexById.get(item.id);
    const draggingBand = draggingId ? userLayerBandById.get(draggingId) : null;
    if (
      draggingId &&
      draggingId !== item.id &&
      item.editable &&
      draggingBand === item.band &&
      targetIndex !== undefined &&
      onReorderNode
    ) {
      handleReorder(draggingId, targetIndex);
    }
    setDraggingId(null);
    setDropTargetId(null);
  }

  function startRename(item: LayerItem) {
    if (!item.editable || !item.node) return;
    setRenamingId(item.id);
    setRenameValue(item.node.name ?? "");
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameValue("");
  }

  function commitRename(item: LayerItem) {
    if (!item.editable || !item.node || renamingId !== item.id) return;
    const nextName = renameValue.trim();
    const currentName = item.node.name ?? "";
    if (nextName !== currentName) {
      onUpdateNode(item.id, { name: nextName || undefined });
    }
    cancelRename();
  }

  function handleRenameKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
    item: LayerItem,
  ) {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      commitRename(item);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelRename();
    }
  }

  function handleMove(item: LayerItem, direction: "forward" | "backward") {
    const currentIndex = userLayerIndexById.get(item.id);
    const groupSize = userLayerGroupSizeById.get(item.id);
    if (currentIndex === undefined || groupSize === undefined) return;
    const targetIndex =
      direction === "forward" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= groupSize) return;
    handleReorder(item.id, targetIndex);
  }

  function renderLayerRow(item: LayerItem): JSX.Element {
    const selected = selectedIds.includes(item.id);
    const node = item.node;
    const editable = item.editable && node !== undefined;
    const renaming = renamingId === item.id;
    const reorderable =
      editable && onReorderNode !== undefined && node.layout !== undefined;
    const currentUserIndex =
      editable && reorderable ? userLayerIndexById.get(item.id) : undefined;
    const groupSize =
      editable && reorderable ? userLayerGroupSizeById.get(item.id) : undefined;
    const canMoveForward =
      currentUserIndex !== undefined && currentUserIndex > 0;
    const canMoveBackward =
      currentUserIndex !== undefined &&
      groupSize !== undefined &&
      currentUserIndex < groupSize - 1;
    const hidden = node?.hidden === true;
    const locked = node?.locked === true;

    return (
      <li key={`${item.source}-${item.id}`}>
        <div
          data-layer-source={item.source}
          draggable={reorderable && renamingId !== item.id}
          onDragStart={(event) => handleDragStart(event, item)}
          onDragEnd={() => {
            setDraggingId(null);
            setDropTargetId(null);
          }}
          onDragOver={(event) => {
            const draggingBand = draggingId
              ? userLayerBandById.get(draggingId)
              : null;
            if (
              !draggingId ||
              draggingId === item.id ||
              !editable ||
              draggingBand !== item.band
            ) {
              return;
            }
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setDropTargetId(item.id);
          }}
          onDrop={(event) => {
            event.preventDefault();
            handleDrop(item);
          }}
          onKeyDown={(event) => {
            if (event.key !== "F2" || !editable || renaming) return;
            event.preventDefault();
            event.stopPropagation();
            startRename(item);
          }}
          className={`flex items-center gap-1 rounded-ds-sm border px-1.5 py-1 text-xs ${
            selected
              ? "border-ds-accent-border bg-ds-accent-surface text-ds-accent-text"
              : dropTargetId === item.id
                ? "border-ds-accent-border bg-ds-accent-surface/50 text-ds-text-secondary"
                : "border-ds-border-subtle text-ds-text-secondary"
          }`}
          style={{ paddingLeft: `${6 + item.depth * 12}px` }}
        >
          {editable ? (
            <GripVertical
              size={12}
              aria-hidden="true"
              className="shrink-0 text-ds-text-muted"
            />
          ) : (
            <span
              aria-hidden="true"
              className="h-3 w-3 shrink-0 rounded-full bg-ds-surface-2"
            />
          )}
          {renaming ? (
            <input
              type="text"
              autoFocus
              value={renameValue}
              onChange={(event) => setRenameValue(event.currentTarget.value)}
              onBlur={() => commitRename(item)}
              onKeyDown={(event) => handleRenameKeyDown(event, item)}
              onClick={(event) => event.stopPropagation()}
              className="min-w-0 flex-1 rounded-ds-sm border border-ds-accent-border bg-ds-surface px-1 py-0.5 text-left text-xs text-ds-text-primary outline-none"
              aria-label="Rename layer"
            />
          ) : (
            <button
              type="button"
              onClick={() => onSelectNode(item.id)}
              onDoubleClick={(event) => {
                if (!editable) return;
                event.preventDefault();
                event.stopPropagation();
                startRename(item);
              }}
              className="min-w-0 flex-1 truncate text-left"
            >
              {item.label}
            </button>
          )}
          <span className="rounded-ds-sm bg-ds-surface-2 px-1.5 py-0.5 text-[10px] text-ds-text-muted">
            {sourceBadge(item.source)}
          </span>
          {reorderable ? (
            <>
              <button
                type="button"
                aria-label="Move layer forward"
                disabled={!canMoveForward}
                onClick={() => handleMove(item, "forward")}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-ds-sm hover:bg-ds-state-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronUp size={12} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Move layer backward"
                disabled={!canMoveBackward}
                onClick={() => handleMove(item, "backward")}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-ds-sm hover:bg-ds-state-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronDown size={12} aria-hidden="true" />
              </button>
            </>
          ) : null}
          {editable ? (
            <>
              {!renaming ? (
                <button
                  type="button"
                  aria-label={`Rename layer ${item.label}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    startRename(item);
                  }}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-ds-sm hover:bg-ds-state-hover"
                >
                  <PenLine size={12} aria-hidden="true" />
                </button>
              ) : null}
              <button
                type="button"
                aria-label={`${hidden ? "Show" : "Hide"} layer "${item.label}"`}
                aria-pressed={hidden}
                onClick={() => onUpdateNode(item.id, { hidden: !hidden })}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-ds-sm hover:bg-ds-state-hover"
              >
                {hidden ? (
                  <EyeOff size={12} aria-hidden="true" />
                ) : (
                  <Eye size={12} aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                aria-label={`${locked ? "Unlock" : "Lock"} layer "${item.label}"`}
                aria-pressed={locked}
                onClick={() => onUpdateNode(item.id, { locked: !locked })}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-ds-sm hover:bg-ds-state-hover"
              >
                {locked ? (
                  <Lock size={12} aria-hidden="true" />
                ) : (
                  <Unlock size={12} aria-hidden="true" />
                )}
              </button>
            </>
          ) : null}
        </div>
      </li>
    );
  }

  return (
    <section className="flex flex-col gap-2 px-3 py-2.5">
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {statusMessage}
      </div>
      <h4 className="text-[10px] font-bold uppercase tracking-[0.06em] text-ds-text-muted">
        Layers
      </h4>
      <ul className="flex flex-col gap-3" role="list">
        {userLayerGroups.map((group) => (
          <li key={`user-band-${group.band}`} className="flex flex-col gap-1">
            <div className="px-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-ds-text-muted">
              {group.label}
            </div>
            <ul className="flex flex-col gap-1" role="list">
              {group.items.map((item) => renderLayerRow(item))}
            </ul>
          </li>
        ))}
        {generatedLayers.length > 0 ? (
          <li className="flex flex-col gap-1">
            <div className="px-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-ds-text-muted">
              Generated
            </div>
            <ul className="flex flex-col gap-1" role="list">
              {generatedLayers.map((item) => renderLayerRow(item))}
            </ul>
          </li>
        ) : null}
      </ul>
    </section>
  );
}
