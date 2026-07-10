"use client";

import { ArrowRight, FlipHorizontal2, Spline } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Tooltip } from "@/components/ui";
import { VisualRenderer } from "@/components/visual/visual-renderer";
import { resolveIconComponent } from "@/components/visual/icon-registry";
import {
  contentViewBox,
  edgeSegments,
  isPositionedKind,
  nodeBoxes,
  resizeNodeBox,
  type EdgeSegment,
  type NodeBox,
  type ResizeHandle,
} from "@/lib/visual/layout";
import { useIsPointerFine } from "@/lib/pointer";
import {
  flipEdge,
  setEdgeLabel,
  setNodeLabel,
  toggleEdgeDirected,
  toggleEdgeStyle,
} from "@/lib/visual/transforms";
import type { Visual, VisualEdge, VisualNode } from "@/lib/visual/schema";
import type { VisualCommandPayload } from "@/lib/commands/visual-command-contracts";

/** Pointer travel (px) under which a press counts as a click, not a drag. */
const CLICK_THRESHOLD = 4;
/** Minimum node box size (canvas units) enforced while resizing. */
const MIN_NODE_WIDTH = 40;
const MIN_NODE_HEIGHT = 24;
/** The four corner handles, in render order (NW, NE, SE, SW). */
const RESIZE_HANDLES: readonly ResizeHandle[] = ["nw", "ne", "se", "sw"];
const INPUT_HEIGHT = 34;
/** Edge toolbar (inline label input + flip / arrowhead / curve controls) size. */
const EDGE_TOOLBAR_WIDTH = 236;
const EDGE_TOOLBAR_HEIGHT = 36;
/** Stroke width of the invisible, clickable hit-area drawn over each edge. */
const EDGE_HIT_WIDTH = 14;

function caretIndexFromRatio(label: string, ratio: number): number {
  if (label.length === 0) {
    return 0;
  }
  return clamp(Math.round(label.length * ratio), 0, label.length);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function setNodePosition(
  visual: Visual,
  id: string,
  x: number,
  y: number,
): Visual {
  return {
    ...visual,
    nodes: visual.nodes.map((node) =>
      node.id === id ? { ...node, x, y } : node,
    ),
  };
}

/** Commits a resized node's center and dimensions (mirrors setNodePosition). */
function setNodeSize(visual: Visual, id: string, box: NodeBox): Visual {
  return {
    ...visual,
    nodes: visual.nodes.map((node) =>
      node.id === id
        ? {
            ...node,
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
          }
        : node,
    ),
  };
}

/** Removes a node and any edge that referenced it (criterion: edges update). */
function deleteNode(visual: Visual, id: string): Visual {
  return {
    ...visual,
    nodes: visual.nodes.filter((node) => node.id !== id),
    edges: visual.edges.filter((edge) => edge.from !== id && edge.to !== id),
  };
}

interface DragState {
  id: string;
  startClientX: number;
  startClientY: number;
  startRatioX: number;
  startCenterX: number;
  startCenterY: number;
  positioned: boolean;
  moved: boolean;
  wasSelected: boolean;
}

/** Active corner-resize gesture state (canvas-unit math via resizeNodeBox). */
interface ResizeState {
  id: string;
  handle: ResizeHandle;
  startClientX: number;
  startClientY: number;
  startBox: NodeBox;
}

/**
 * Interactive editing layer for a {@link Visual}. It renders the canonical
 * {@link VisualRenderer} as the visible base (so it always reflects the current
 * data and looks identical to read-only views) and overlays an SVG of
 * per-node hit-boxes in the same coordinate space. Nodes can be:
 *
 * - clicked to edit their label inline (a `<foreignObject>` input),
 * - dragged to a new position (positioned kinds: flowchart/mindmap/concept),
 * - deleted (which also drops connected edges).
 *
 * Every change is pushed up through `onChange` so the parent can persist it;
 * because the base re-renders from `visual`, edits appear immediately.
 */
export function VisualEditor({
  visual,
  onChange,
  onCommand,
  onSelectNode,
  onSelectEdge,
  initialSelectedNodeId = null,
  initialSelectedEdgeId = null,
  rendererRef,
  canEdit = true,
}: {
  visual: Visual;
  onChange: (next: Visual) => void;
  /**
   * Optional command sink (#507). When provided, discrete graph-structure and
   * user-intent edits (node deletion, edge flip / arrowhead / curve toggle, and
   * the inline node/edge label commit) route through the visual command
   * executor for validation + command metadata, falling back to `onChange` when
   * omitted. Continuous gesture edits (drag/resize/reposition) and inline label
   * typing stay on `onChange` — they are high-frequency transforms, not discrete
   * commands.
   */
  onCommand?: (payload: VisualCommandPayload, coalesceKey?: string) => void;
  onSelectNode?: (id: string | null) => void;
  onSelectEdge?: (id: string | null) => void;
  initialSelectedNodeId?: string | null;
  initialSelectedEdgeId?: string | null;
  /** Optional ref to the rendered SVG (for exports). */
  rendererRef?: React.RefObject<SVGSVGElement | null>;
  canEdit?: boolean;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const edgeInputRef = useRef<HTMLInputElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);
  // Tracks the last click-release for manual double-click detection (native
  // dblclick is unreliable here because the node uses pointer capture).
  const lastClickRef = useRef<{ id: string; time: number } | null>(null);
  const editStartLabel = useRef<string>("");
  const editStartEdgeLabel = useRef<string>("");
  const editStartCaretIndex = useRef<number | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  // The node explicitly picked for styling (US-014). Distinct from `activeId`
  // (which also tracks hover) so the style panel targets a stable selection.
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSelectedNodeId,
  );
  // The connector (edge) selected for inline label/direction editing (US-016).
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(
    initialSelectedEdgeId,
  );
  const [hoverEdgeId, setHoverEdgeId] = useState<string | null>(null);

  const positioned = isPositionedKind(visual.type) && !visual.autoLayout;
  const pointerFine = useIsPointerFine();
  const boxes = useMemo(() => nodeBoxes(visual), [visual]);
  // Keep the interactive overlay's coordinate system identical to the renderer
  // (which expands the viewBox to enclose any nodes overflowing the canvas).
  const overlayViewBox = useMemo(() => contentViewBox(visual), [visual]);

  // While editing a node, blank its label in the read-only render so the live
  // text isn't drawn behind the inline input (node sizes are label-independent,
  // so positions/layout stay identical — only the text disappears).
  const displayVisual = useMemo(() => {
    if (!editingId) return visual;
    return {
      ...visual,
      nodes: visual.nodes.map((node) =>
        node.id === editingId ? { ...node, label: "" } : node,
      ),
    };
  }, [visual, editingId]);
  const segments = useMemo(() => edgeSegments(visual), [visual]);
  const nodeById = useMemo(
    () => new Map(visual.nodes.map((node) => [node.id, node])),
    [visual],
  );
  const edgeById = useMemo(
    () => new Map(visual.edges.map((edge) => [edge.id, edge])),
    [visual],
  );
  const canDelete = visual.nodes.length > 1;

  // Stale ids (after a regeneration swaps the visual) resolve to nothing.
  const editingNode = editingId ? nodeById.get(editingId) : undefined;
  // The selected connector resolves to nothing if its id went stale.
  const selectedEdge = selectedEdgeId
    ? edgeById.get(selectedEdgeId)
    : undefined;
  const selectedEdgeSeg = selectedEdgeId
    ? segments.get(selectedEdgeId)
    : undefined;

  // Report the current selection so the parent's style panel can target it.
  // A stale id (after a regeneration) reports as no selection.
  useEffect(() => {
    onSelectNode?.(selectedId && nodeById.has(selectedId) ? selectedId : null);
  }, [selectedId, nodeById, onSelectNode]);

  useEffect(() => {
    onSelectEdge?.(
      selectedEdgeId && edgeById.has(selectedEdgeId) ? selectedEdgeId : null,
    );
  }, [edgeById, onSelectEdge, selectedEdgeId]);

  // Focus the node's label field when editing begins. Keyed on the id only, so
  // it doesn't re-`select()` on every keystroke — which selected all text and
  // made each typed character replace the previous one.
  useEffect(() => {
    if (editingId && inputRef.current) {
      const input = inputRef.current;
      input.focus();
      const caretIndex = editStartCaretIndex.current;
      editStartCaretIndex.current = null;
      const index = Math.min(
        Math.max(caretIndex ?? input.value.length, 0),
        input.value.length,
      );
      input.setSelectionRange(index, index);
    }
  }, [editingId]);

  // Focus the connector's label field when an edge is freshly selected so it can
  // be typed immediately (mirrors the node inline-edit pattern). Keyed on the id
  // only, so it doesn't steal focus on every keystroke / control click.
  useEffect(() => {
    if (selectedEdgeId && edgeInputRef.current) {
      edgeInputRef.current.focus();
      edgeInputRef.current.select();
    }
  }, [selectedEdgeId]);

  const beginEdit = useCallback(
    (id: string) => {
      if (!canEdit) {
        return;
      }
      const node = nodeById.get(id);
      if (!node) {
        return;
      }
      editStartLabel.current = node.label;
      setSelectedEdgeId(null);
      setActiveId(id);
      setEditingId(id);
    },
    [canEdit, nodeById],
  );

  // Selecting a connector opens its inline toolbar and clears any node edit.
  const selectEdge = useCallback(
    (id: string) => {
      if (!canEdit) {
        return;
      }
      const edge = edgeById.get(id);
      if (!edge) {
        return;
      }
      editStartEdgeLabel.current = edge.label ?? "";
      setEditingId(null);
      setActiveId(null);
      setSelectedId(null);
      setSelectedEdgeId(id);
    },
    [canEdit, edgeById],
  );

  const removeNode = useCallback(
    (id: string) => {
      if (!canEdit || visual.nodes.length <= 1) {
        return;
      }
      setEditingId((current) => (current === id ? null : current));
      setActiveId((current) => (current === id ? null : current));
      setHoverId((current) => (current === id ? null : current));
      setSelectedId((current) => (current === id ? null : current));
      // #507: discrete user-intent deletion routes through the command sink
      // when available; the `nodes.length <= 1` guard above preserves UX.
      if (onCommand) {
        onCommand({ op: "visual.delete_node", nodeId: id });
      } else {
        onChange(deleteNode(visual, id));
      }
    },
    [canEdit, visual, onChange, onCommand],
  );

  const endDrag = useCallback((event: React.PointerEvent) => {
    dragRef.current = null;
    resizeRef.current = null;
    svgRef.current?.releasePointerCapture?.(event.pointerId);
  }, []);

  // Begins a corner-resize gesture. Stops propagation so the underlying node
  // hit-box never starts a drag-move from the same press.
  const onHandlePointerDown = useCallback(
    (event: React.PointerEvent, node: VisualNode, handle: ResizeHandle) => {
      if (!canEdit || editingId || !positioned) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const box = boxes.get(node.id);
      if (!box) {
        return;
      }
      setActiveId(node.id);
      setSelectedId(node.id);
      setSelectedEdgeId(null);
      resizeRef.current = {
        id: node.id,
        handle,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startBox: box,
      };
      svgRef.current?.setPointerCapture?.(event.pointerId);
    },
    [boxes, canEdit, editingId, positioned],
  );

  const onNodePointerDown = useCallback(
    (event: React.PointerEvent, node: VisualNode) => {
      if (!canEdit || editingId) {
        return;
      }
      event.preventDefault();
      setActiveId(node.id);
      setSelectedId(node.id);
      setSelectedEdgeId(null);
      const box = boxes.get(node.id);
      if (!box) {
        return;
      }
      dragRef.current = {
        id: node.id,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startRatioX: clamp(
          (event.clientX - event.currentTarget.getBoundingClientRect().left) /
            Math.max(1, event.currentTarget.getBoundingClientRect().width),
          0,
          1,
        ),
        startCenterX: box.x,
        startCenterY: box.y,
        positioned,
        moved: false,
        wasSelected: selectedId === node.id,
      };
      svgRef.current?.setPointerCapture?.(event.pointerId);
    },
    [boxes, canEdit, editingId, positioned, selectedId],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const svg = svgRef.current;
      if (!svg) {
        return;
      }
      const resize = resizeRef.current;
      if (resize) {
        const rect = svg.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          return;
        }
        const dx =
          (event.clientX - resize.startClientX) * (visual.width / rect.width);
        const dy =
          (event.clientY - resize.startClientY) * (visual.height / rect.height);
        const next = resizeNodeBox({
          start: resize.startBox,
          handle: resize.handle,
          dx,
          dy,
          lockAspect: event.shiftKey,
          min: { w: MIN_NODE_WIDTH, h: MIN_NODE_HEIGHT },
          bounds: { width: visual.width, height: visual.height },
        });
        onChange(setNodeSize(visual, resize.id, next));
        return;
      }
      const drag = dragRef.current;
      if (!drag) {
        return;
      }
      const dxClient = event.clientX - drag.startClientX;
      const dyClient = event.clientY - drag.startClientY;
      if (!drag.moved && Math.hypot(dxClient, dyClient) > CLICK_THRESHOLD) {
        drag.moved = true;
      }
      if (!drag.positioned || !drag.moved) {
        return;
      }
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return;
      }
      const nextX = clamp(
        drag.startCenterX + dxClient * (visual.width / rect.width),
        0,
        visual.width,
      );
      const nextY = clamp(
        drag.startCenterY + dyClient * (visual.height / rect.height),
        0,
        visual.height,
      );
      onChange(setNodePosition(visual, drag.id, nextX, nextY));
    },
    [onChange, visual],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent) => {
      const drag = dragRef.current;
      endDrag(event);
      // A plain click only selects. A second click on the same node within the
      // double-click window opens inline editing.
      if (drag && !drag.moved) {
        if (drag.wasSelected) {
          lastClickRef.current = null;
          const node = nodeById.get(drag.id);
          editStartCaretIndex.current = node
            ? caretIndexFromRatio(node.label, drag.startRatioX)
            : null;
          beginEdit(drag.id);
          return;
        }
        const now = Date.now();
        const last = lastClickRef.current;
        if (last && last.id === drag.id && now - last.time < 350) {
          lastClickRef.current = null;
          const node = nodeById.get(drag.id);
          editStartCaretIndex.current = node
            ? caretIndexFromRatio(node.label, drag.startRatioX)
            : null;
          beginEdit(drag.id);
        } else {
          lastClickRef.current = { id: drag.id, time: now };
        }
      }
    },
    [beginEdit, endDrag, nodeById],
  );

  const onInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        setEditingId(null);
      } else if (event.key === "Escape") {
        event.preventDefault();
        if (editingId) {
          // #507: the discrete label commit (restoring the pre-edit value)
          // routes through the command sink when available.
          if (onCommand) {
            onCommand({
              op: "visual.set_node_label",
              nodeId: editingId,
              label: editStartLabel.current,
            });
          } else {
            onChange(setNodeLabel(visual, editingId, editStartLabel.current));
          }
        }
        setEditingId(null);
      }
    },
    [editingId, onChange, onCommand, visual],
  );

  const onNodeKeyDown = useCallback(
    (event: React.KeyboardEvent, node: VisualNode) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        beginEdit(node.id);
      } else if (
        (event.key === "Delete" || event.key === "Backspace") &&
        canDelete
      ) {
        event.preventDefault();
        removeNode(node.id);
      } else if (event.key === "Escape") {
        event.preventDefault();
        setActiveId((current) => (current === node.id ? null : current));
        setSelectedId((current) => (current === node.id ? null : current));
        (event.currentTarget as SVGElement).blur?.();
      } else if (
        positioned &&
        canEdit &&
        (event.key === "ArrowLeft" ||
          event.key === "ArrowRight" ||
          event.key === "ArrowUp" ||
          event.key === "ArrowDown")
      ) {
        event.preventDefault();
        const box = boxes.get(node.id);
        if (!box) {
          return;
        }
        const step = event.shiftKey ? 10 : 1;
        const dx =
          event.key === "ArrowLeft"
            ? -step
            : event.key === "ArrowRight"
              ? step
              : 0;
        const dy =
          event.key === "ArrowUp"
            ? -step
            : event.key === "ArrowDown"
              ? step
              : 0;
        const nextX = clamp(box.x + dx, 0, visual.width);
        const nextY = clamp(box.y + dy, 0, visual.height);
        onChange(setNodePosition(visual, node.id, nextX, nextY));
      }
    },
    [
      beginEdit,
      boxes,
      canDelete,
      canEdit,
      onChange,
      positioned,
      removeNode,
      visual,
    ],
  );

  const onEdgeInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        setSelectedEdgeId(null);
      } else if (event.key === "Escape") {
        event.preventDefault();
        if (selectedEdgeId) {
          // #507: the discrete edge-label commit (restoring the pre-edit
          // value) routes through the command sink when available.
          if (onCommand) {
            onCommand({
              op: "visual.set_edge_label",
              edgeId: selectedEdgeId,
              label: editStartEdgeLabel.current,
            });
          } else {
            onChange(
              setEdgeLabel(visual, selectedEdgeId, editStartEdgeLabel.current),
            );
          }
        }
        setSelectedEdgeId(null);
      }
    },
    [onChange, onCommand, selectedEdgeId, visual],
  );

  const onEdgeKeyDown = useCallback(
    (event: React.KeyboardEvent, id: string) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectEdge(id);
      }
    },
    [selectEdge],
  );

  // Clicking the empty canvas commits any inline edit and clears selection.
  const onBackgroundPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.target === event.currentTarget) {
      setActiveId(null);
      setEditingId(null);
      setSelectedId(null);
      setSelectedEdgeId(null);
    }
  }, []);

  /**
   * The four corner resize handles for the selected positioned node. Only
   * rendered on fine pointers (mouse/trackpad); hidden on touch so drag-move
   * stays the sole gesture. Each handle pins the opposite corner via
   * {@link resizeNodeBox}; hold Shift while dragging to lock the aspect ratio.
   */
  function renderResizeHandles(node: VisualNode, box: NodeBox) {
    const left = box.x - box.width / 2;
    const right = box.x + box.width / 2;
    const top = box.y - box.height / 2;
    const bottom = box.y + box.height / 2;
    const points: Record<ResizeHandle, { x: number; y: number }> = {
      nw: { x: left, y: top },
      ne: { x: right, y: top },
      se: { x: right, y: bottom },
      sw: { x: left, y: bottom },
    };
    const cursors: Record<ResizeHandle, string> = {
      nw: "nwse-resize",
      ne: "nesw-resize",
      se: "nwse-resize",
      sw: "nesw-resize",
    };
    const size = 9;
    return (
      <g>
        {RESIZE_HANDLES.map((handle) => {
          const p = points[handle];
          return (
            <rect
              key={handle}
              data-resize-handle={handle}
              role="button"
              aria-label={`Resize ${node.label || "node"} ${handle}`}
              x={p.x - size / 2}
              y={p.y - size / 2}
              width={size}
              height={size}
              rx={2}
              fill="#ffffff"
              stroke="#6366f1"
              strokeWidth={1.5}
              style={{ cursor: cursors[handle] }}
              onPointerDown={(event) =>
                onHandlePointerDown(event, node, handle)
              }
            />
          );
        })}
      </g>
    );
  }

  function renderEditingInput(node: VisualNode, box: NodeBox) {
    const fx = clamp(box.x - box.width / 2, 0, visual.width);
    const fw = Math.max(40, Math.min(box.width, visual.width - fx));
    // Match the renderer's text centre. When the node has an icon, the label is
    // stacked below it (not centred on the node), so the input must sit there
    // too — otherwise the text jumps up when entering edit mode.
    const fontSize = visual.style.fontSize;
    const Icon = node.icon ? resolveIconComponent(node.icon) : null;
    const lineHeight = fontSize * 1.2;
    const iconSize = Icon
      ? clamp(Math.min(box.height * 0.4, fontSize * 1.6), 14, 30)
      : 0;
    const iconGap = Icon ? Math.max(2, fontSize * 0.2) : 0;
    const blockTop = box.y - (iconSize + iconGap + lineHeight) / 2;
    const textCy = Icon
      ? blockTop + iconSize + iconGap + lineHeight / 2
      : box.y;
    const fy = clamp(
      textCy - INPUT_HEIGHT / 2,
      0,
      visual.height - INPUT_HEIGHT,
    );
    return (
      <foreignObject x={fx} y={fy} width={fw} height={INPUT_HEIGHT}>
        <input
          ref={inputRef}
          aria-label="Node label"
          value={node.label}
          onChange={(event) =>
            onChange(setNodeLabel(visual, node.id, event.target.value))
          }
          onKeyDown={onInputKeyDown}
          onBlur={() => setEditingId(null)}
          onPointerDown={(event) => event.stopPropagation()}
          className="h-full w-full border-0 bg-transparent p-0 leading-none caret-current outline-none"
          style={{
            color: node.textColor ?? visual.style.nodeText,
            fontSize: visual.style.fontSize,
            fontWeight: visual.style.fontWeight,
            fontFamily: node.fontFamily ?? visual.style.fontFamily,
            textAlign: node.textAlign ?? "center",
          }}
        />
      </foreignObject>
    );
  }

  function renderEdgeHitAreas() {
    return visual.edges.map((edge) => {
      const seg = segments.get(edge.id);
      if (!seg) {
        return null;
      }
      const isActive = selectedEdgeId === edge.id || hoverEdgeId === edge.id;
      return (
        <g key={edge.id}>
          {isActive ? (
            <line
              x1={seg.start.x}
              y1={seg.start.y}
              x2={seg.end.x}
              y2={seg.end.y}
              stroke="#6366f1"
              strokeWidth={3}
              strokeLinecap="round"
              pointerEvents="none"
            />
          ) : null}
          <line
            data-edge-id={edge.id}
            role="button"
            aria-label={`Edit connector ${edge.label || "connector"}`}
            tabIndex={0}
            x1={seg.start.x}
            y1={seg.start.y}
            x2={seg.end.x}
            y2={seg.end.y}
            stroke="transparent"
            strokeWidth={EDGE_HIT_WIDTH}
            strokeLinecap="round"
            pointerEvents="stroke"
            className="cursor-pointer outline-none"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              selectEdge(edge.id);
            }}
            onPointerEnter={() => setHoverEdgeId(edge.id)}
            onPointerLeave={() =>
              setHoverEdgeId((current) =>
                current === edge.id ? null : current,
              )
            }
            onFocus={() => setHoverEdgeId(edge.id)}
            onBlur={() =>
              setHoverEdgeId((current) =>
                current === edge.id ? null : current,
              )
            }
            onKeyDown={(event) => onEdgeKeyDown(event, edge.id)}
          />
        </g>
      );
    });
  }

  function renderEdgeToolbar(edge: VisualEdge, seg: EdgeSegment) {
    const fx = clamp(
      seg.mid.x - EDGE_TOOLBAR_WIDTH / 2,
      4,
      Math.max(4, visual.width - EDGE_TOOLBAR_WIDTH - 4),
    );
    const fy = clamp(
      seg.mid.y - EDGE_TOOLBAR_HEIGHT / 2,
      4,
      Math.max(4, visual.height - EDGE_TOOLBAR_HEIGHT - 4),
    );
    const directedOn = edge.directed !== false;
    const curvedOn = edge.style === "curved";
    return (
      <foreignObject
        x={fx}
        y={fy}
        width={EDGE_TOOLBAR_WIDTH}
        height={EDGE_TOOLBAR_HEIGHT}
      >
        <div
          role="toolbar"
          aria-label="Connector tools"
          className="flex h-full w-full items-center gap-1 rounded-lg border border-ds-border-subtle bg-ds-surface-overlay px-1.5 shadow-ds-raised"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <input
            ref={edgeInputRef}
            aria-label="Connector label"
            placeholder="Label"
            value={edge.label ?? ""}
            onChange={(event) =>
              onChange(setEdgeLabel(visual, edge.id, event.target.value))
            }
            onKeyDown={onEdgeInputKeyDown}
            className="h-6 min-w-0 flex-1 rounded-md border border-ds-border-strong bg-ds-surface-raised px-2 text-xs text-ds-text-primary outline-none focus-visible:ring-2 focus-visible:ring-ds-accent focus-visible:ring-offset-1"
          />
          <Tooltip label="Flip direction" side="bottom">
            <button
              type="button"
              aria-label="Flip connector direction"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() =>
                onCommand
                  ? onCommand({ op: "visual.flip_edge", edgeId: edge.id })
                  : onChange(flipEdge(visual, edge.id))
              }
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-ds-border-subtle text-ds-text-secondary transition hover:bg-ds-state-hover hover:text-ds-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent focus-visible:ring-offset-1"
            >
              <FlipHorizontal2 aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          <Tooltip
            label={directedOn ? "Hide arrowhead" : "Show arrowhead"}
            side="bottom"
          >
            <button
              type="button"
              aria-label={directedOn ? "Hide arrowhead" : "Show arrowhead"}
              aria-pressed={directedOn}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() =>
                onCommand
                  ? onCommand({
                      op: "visual.toggle_edge_directed",
                      edgeId: edge.id,
                    })
                  : onChange(toggleEdgeDirected(visual, edge.id))
              }
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent focus-visible:ring-offset-1 ${
                directedOn
                  ? "border-ds-accent bg-ds-accent text-ds-accent-contrast"
                  : "border-ds-border-subtle text-ds-text-secondary"
              }`}
            >
              <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          <Tooltip
            label={curvedOn ? "Straight line" : "Curved line"}
            side="bottom"
          >
            <button
              type="button"
              aria-label={
                curvedOn ? "Use straight connector" : "Use curved connector"
              }
              aria-pressed={curvedOn}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() =>
                onCommand
                  ? onCommand({
                      op: "visual.toggle_edge_style",
                      edgeId: edge.id,
                    })
                  : onChange(toggleEdgeStyle(visual, edge.id))
              }
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent focus-visible:ring-offset-1 ${
                curvedOn
                  ? "border-ds-accent bg-ds-accent text-ds-accent-contrast"
                  : "border-ds-border-subtle text-ds-text-secondary"
              }`}
            >
              <Spline aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </div>
      </foreignObject>
    );
  }

  return (
    <div className="relative w-full max-w-3xl">
      <VisualRenderer
        ref={rendererRef}
        visual={displayVisual}
        className="block h-auto w-full select-none"
      />
      <svg
        ref={svgRef}
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`${overlayViewBox.x} ${overlayViewBox.y} ${overlayViewBox.width} ${overlayViewBox.height}`}
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 h-full w-full"
        style={{ touchAction: "none" }}
        onPointerDown={onBackgroundPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={endDrag}
      >
        {/* Edge hit-areas render first so node hit-boxes take pointer
            precedence wherever they overlap near a node boundary. */}
        {renderEdgeHitAreas()}

        {visual.nodes.map((node) => {
          const box = boxes.get(node.id);
          if (!box) {
            return null;
          }
          const isActive =
            activeId === node.id ||
            hoverId === node.id ||
            selectedId === node.id;
          const isEditing = editingId === node.id;
          return (
            <g key={node.id}>
              <rect
                data-node-id={node.id}
                role="button"
                aria-label={`Edit ${node.label || "node"}`}
                tabIndex={0}
                x={box.x - box.width / 2}
                y={box.y - box.height / 2}
                width={box.width}
                height={box.height}
                rx={10}
                fill="transparent"
                stroke={isActive && !isEditing ? "#6366f1" : "transparent"}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                pointerEvents="all"
                className={
                  positioned
                    ? "cursor-move outline-none"
                    : "cursor-text outline-none"
                }
                style={{ outline: "none" }}
                onPointerDown={(event) => onNodePointerDown(event, node)}
                onPointerEnter={() => {
                  setHoverId(node.id);
                  setActiveId(node.id);
                }}
                onFocus={() => {
                  setActiveId(node.id);
                  setSelectedId(node.id);
                }}
                onPointerLeave={() =>
                  setHoverId((current) =>
                    current === node.id ? null : current,
                  )
                }
                onKeyDown={(event) => onNodeKeyDown(event, node)}
              />
            </g>
          );
        })}

        {/* Corner resize handles for the selected positioned node (mouse only;
            hidden on coarse/touch pointers where drag-move stays the gesture). */}
        {positioned &&
        pointerFine &&
        canEdit &&
        selectedId &&
        !editingId &&
        nodeById.get(selectedId) &&
        boxes.get(selectedId)
          ? renderResizeHandles(
              nodeById.get(selectedId)!,
              boxes.get(selectedId)!,
            )
          : null}

        {editingNode && boxes.get(editingNode.id)
          ? renderEditingInput(editingNode, boxes.get(editingNode.id)!)
          : null}

        {/* The selected connector's inline toolbar renders last so it sits
            above every hit-area and is fully clickable. */}
        {selectedEdge && selectedEdgeSeg
          ? renderEdgeToolbar(selectedEdge, selectedEdgeSeg)
          : null}
      </svg>
    </div>
  );
}
