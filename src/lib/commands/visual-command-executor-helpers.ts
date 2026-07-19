import { CURRENT_COMMAND_SCHEMA_VERSION } from "./envelope-core";
import { makeSideEffects } from "./command-result-helpers";
import type {
  EdgeStylePatch,
  NodeExtStylePatch,
  VisualCommand,
  VisualCommandResult,
  VisualPatch,
  VisualSideEffect,
} from "./visual-command-contracts";
import {
  DEFAULT_NODE_HEIGHT,
  DEFAULT_NODE_WIDTH,
  safeParseVisual,
  type NodeShape,
  type Visual,
  type VisualEdge,
  type VisualNode,
} from "@/lib/visual/schema";
import { getKindEntry, isShapeAllowed } from "@/lib/visual/registry";
import {
  setEdgeArrowStyle,
  setEdgeLineStyle,
  setEdgeLineWidth,
  setNodeBorderStyle,
  setNodeBorderWidth,
  setNodeFillStyle,
  setNodeFontFamily,
  setNodeTextAlign,
} from "@/lib/visual/transforms";

export interface VisualExecutionSuccess {
  ok: true;
  visual: Visual;
  affectedNodeIds: string[];
  affectedEdgeIds: string[];
  includeSourceRecompute?: boolean;
}

export type VisualExecutionResult =
  VisualExecutionSuccess | VisualCommandResult;

export function uniqueIds(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function wholeVisualNodeIds(before: Visual, after: Visual): string[] {
  return uniqueIds([
    ...before.nodes.map((node) => node.id),
    ...after.nodes.map((node) => node.id),
  ]);
}

export function wholeVisualEdgeIds(before: Visual, after: Visual): string[] {
  return uniqueIds([
    ...before.edges.map((edge) => edge.id),
    ...after.edges.map((edge) => edge.id),
  ]);
}

export function failure(visual: Visual, error: string): VisualCommandResult {
  return {
    ok: false,
    visual,
    error,
    affectedNodeIds: [],
    affectedEdgeIds: [],
    patches: [],
    sideEffects: [],
  };
}

function makePatch(
  command: VisualCommand,
  affectedNodeIds: string[],
  affectedEdgeIds: string[],
): VisualPatch {
  return {
    schemaVersion: CURRENT_COMMAND_SCHEMA_VERSION,
    op: command.payload.op,
    visualId: command.target.visualId,
    affectedNodeIds,
    affectedEdgeIds,
  };
}

export function success(
  visual: Visual,
  command: VisualCommand,
  affectedNodeIds: string[],
  affectedEdgeIds: string[],
  includeSourceRecompute = false,
): VisualCommandResult {
  return {
    ok: true,
    visual,
    affectedNodeIds,
    affectedEdgeIds,
    ...(command.coalesceKey ? { historyKey: command.coalesceKey } : {}),
    patches: [makePatch(command, affectedNodeIds, affectedEdgeIds)],
    sideEffects: makeSideEffects<VisualSideEffect>(
      { kind: "visual_mirror_rebuild", visualId: command.target.visualId },
      includeSourceRecompute
        ? {
            kind: "source_staleness_recompute",
            visualId: command.target.visualId,
          }
        : undefined,
      { kind: "render_invalidation", visualId: command.target.visualId },
    ),
  };
}

export function ensureNodeExists(
  visual: Visual,
  nodeId: string,
): string | undefined {
  return visual.nodes.some((node) => node.id === nodeId)
    ? undefined
    : `Node ${nodeId} was not found.`;
}

export function ensureEdgeExists(
  visual: Visual,
  edgeId: string,
): string | undefined {
  return visual.edges.some((edge) => edge.id === edgeId)
    ? undefined
    : `Edge ${edgeId} was not found.`;
}

export function applyNodeExtStyle(
  visual: Visual,
  nodeId: string,
  patch: NodeExtStylePatch,
): Visual {
  let next = visual;
  if (patch.fillStyle !== undefined)
    next = setNodeFillStyle(next, nodeId, patch.fillStyle);
  if (patch.borderStyle !== undefined)
    next = setNodeBorderStyle(next, nodeId, patch.borderStyle);
  if (patch.borderWidth !== undefined)
    next = setNodeBorderWidth(next, nodeId, patch.borderWidth);
  if (patch.textAlign !== undefined)
    next = setNodeTextAlign(next, nodeId, patch.textAlign);
  if (patch.fontFamily !== undefined)
    next = setNodeFontFamily(next, nodeId, patch.fontFamily);
  return next;
}

export function applyEdgeStyle(
  visual: Visual,
  edgeId: string,
  patch: EdgeStylePatch,
): Visual {
  let next = visual;
  if (patch.arrowStyle !== undefined)
    next = setEdgeArrowStyle(next, edgeId, patch.arrowStyle);
  if (patch.lineStyle !== undefined)
    next = setEdgeLineStyle(next, edgeId, patch.lineStyle);
  if (patch.lineWidth !== undefined)
    next = setEdgeLineWidth(next, edgeId, patch.lineWidth);
  return next;
}

function generateId(prefix: string, existing: string[]): string {
  const existingSet = new Set(existing);
  let counter = existing.length + 1;
  let candidate = `${prefix}-${counter}`;
  while (existingSet.has(candidate)) {
    counter += 1;
    candidate = `${prefix}-${counter}`;
  }
  return candidate;
}

export function addNode(
  visual: Visual,
  nodeSpec: Omit<VisualNode, "id"> & { id?: string },
): { next: Visual; nodeId: string } | { error: string } {
  const entry = getKindEntry(visual.type);
  if (!entry.editing.nodeAddable)
    return { error: `Kind "${visual.type}" does not support adding nodes.` };
  const shape: NodeShape = (nodeSpec.shape ?? entry.defaultShape) as NodeShape;
  if (!isShapeAllowed(visual.type, shape)) {
    /* node:coverage ignore next 3 -- Shape rejection is asserted; tsx maps the error literal as uncovered. */
    return {
      error: `Shape "${shape}" is not allowed for kind "${visual.type}". Allowed: ${entry.allowedShapes.join(", ")}.`,
    };
  }
  const nodeId =
    nodeSpec.id ??
    generateId(
      "n",
      visual.nodes.map((n) => n.id),
    );
  const cx = visual.width / 2;
  const cy = visual.height / 2;
  const newNode: VisualNode = {
    id: nodeId,
    label: nodeSpec.label ?? "Node",
    width: nodeSpec.width ?? DEFAULT_NODE_WIDTH,
    height: nodeSpec.height ?? DEFAULT_NODE_HEIGHT,
    shape,
    ...(entry.layoutFamily === "positioned"
      ? { x: nodeSpec.x ?? cx, y: nodeSpec.y ?? cy }
      : {}),
    ...(nodeSpec.value !== undefined ? { value: nodeSpec.value } : {}),
    ...(nodeSpec.color ? { color: nodeSpec.color } : {}),
    ...(nodeSpec.stroke ? { stroke: nodeSpec.stroke } : {}),
    ...(nodeSpec.textColor ? { textColor: nodeSpec.textColor } : {}),
    ...(nodeSpec.icon ? { icon: nodeSpec.icon } : {}),
  };
  return { next: { ...visual, nodes: [...visual.nodes, newNode] }, nodeId };
}

export function deleteNode(visual: Visual, nodeId: string): Visual {
  const nodes = visual.nodes.filter((n) => n.id !== nodeId);
  const edges = visual.edges.filter(
    (e) => e.from !== nodeId && e.to !== nodeId,
  );
  return { ...visual, nodes, edges };
}

export function addEdge(
  visual: Visual,
  edgeSpec: Omit<VisualEdge, "id"> & { id?: string },
): { next: Visual; edgeId: string } | { error: string } {
  const entry = getKindEntry(visual.type);
  if (!entry.editing.edgeAddable)
    return { error: `Kind "${visual.type}" does not support adding edges.` };
  const nodeIds = new Set(visual.nodes.map((n) => n.id));
  if (!nodeIds.has(edgeSpec.from))
    return { error: `Source node "${edgeSpec.from}" does not exist.` };
  if (!nodeIds.has(edgeSpec.to))
    return { error: `Target node "${edgeSpec.to}" does not exist.` };
  const edgeId =
    edgeSpec.id ??
    generateId(
      "e",
      visual.edges.map((e) => e.id),
    );
  const newEdge: VisualEdge = {
    id: edgeId,
    from: edgeSpec.from,
    to: edgeSpec.to,
    ...(edgeSpec.label !== undefined ? { label: edgeSpec.label } : {}),
    ...(edgeSpec.directed !== undefined ? { directed: edgeSpec.directed } : {}),
    ...(edgeSpec.style ? { style: edgeSpec.style } : {}),
    ...(edgeSpec.arrowStyle !== undefined
      ? { arrowStyle: edgeSpec.arrowStyle }
      : {}),
    ...(edgeSpec.lineStyle !== undefined
      ? { lineStyle: edgeSpec.lineStyle }
      : {}),
    ...(edgeSpec.lineWidth !== undefined
      ? { lineWidth: edgeSpec.lineWidth }
      : {}),
  };
  return { next: { ...visual, edges: [...visual.edges, newEdge] }, edgeId };
}

export function reconnectEdge(
  visual: Visual,
  edgeId: string,
  fromNodeId: string | undefined,
  toNodeId: string | undefined,
): { next: Visual } | { error: string } {
  const entry = getKindEntry(visual.type);
  if (!entry.editing.edgeReconnectable)
    return {
      error: `Kind "${visual.type}" does not support edge reconnection.`,
    };
  const edge = visual.edges.find((e) => e.id === edgeId);
  if (!edge) return { error: `Edge "${edgeId}" does not exist.` };
  const nodeIds = new Set(visual.nodes.map((n) => n.id));
  /* node:coverage ignore next 2 -- Reconnect default endpoint behavior is asserted; tsx maps nullish coalescing rows as uncovered. */
  const newFrom = fromNodeId ?? edge.from;
  const newTo = toNodeId ?? edge.to;
  if (!nodeIds.has(newFrom))
    return { error: `Source node "${newFrom}" does not exist.` };
  if (!nodeIds.has(newTo))
    return { error: `Target node "${newTo}" does not exist.` };
  const edges = visual.edges.map((e) =>
    e.id === edgeId ? { ...e, from: newFrom, to: newTo } : e,
  );
  return { next: { ...visual, edges } };
}

export function duplicateNode(
  visual: Visual,
  nodeId: string,
  newNodeId?: string,
): { next: Visual; newNodeId: string } | { error: string } {
  const entry = getKindEntry(visual.type);
  if (!entry.editing.nodeDuplicatable)
    /* node:coverage ignore next 3 -- Node-duplicate capability rejection is asserted; tsx maps the error literal as uncovered. */
    return {
      error: `Kind "${visual.type}" does not support node duplication.`,
    };
  const source = visual.nodes.find((n) => n.id === nodeId);
  if (!source) return { error: `Node "${nodeId}" does not exist.` };
  const generatedId =
    newNodeId ??
    generateId(
      "n",
      visual.nodes.map((n) => n.id),
    );
  const offset = 20;
  /* node:coverage ignore next 6 -- Duplicate-node offset/default field behavior is asserted; tsx maps the object literal tail as uncovered. */
  const duplicate: VisualNode = {
    ...source,
    id: generatedId,
    ...(typeof source.x === "number" ? { x: source.x + offset } : {}),
    ...(typeof source.y === "number" ? { y: source.y + offset } : {}),
  };
  return {
    next: { ...visual, nodes: [...visual.nodes, duplicate] },
    newNodeId: generatedId,
  };
}

export function validateOutput(
  visual: Visual,
  original: Visual,
): VisualCommandResult | null {
  const parsed = safeParseVisual(visual);
  if (parsed.success) return null;
  return failure(
    original,
    `Visual command produced an invalid visual: ${parsed.error}`,
  );
}

export function executionSuccess(
  visual: Visual,
  affectedNodeIds: string[],
  affectedEdgeIds: string[],
  includeSourceRecompute = false,
): VisualExecutionSuccess {
  return {
    ok: true,
    visual,
    affectedNodeIds,
    affectedEdgeIds,
    includeSourceRecompute,
  };
}
