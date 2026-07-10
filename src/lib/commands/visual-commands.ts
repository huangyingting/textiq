import {
  makeAffectedIds,
  type CrossSurfaceCommandResult,
} from "@/lib/commands/command-result-helpers";
import { validateCommandEnvelope } from "@/lib/commands/command-envelope-validation";
import type {
  CommandEnvelope,
  CommandTarget,
} from "@/lib/commands/envelope-core";
import type { DeckPatch } from "@/lib/document/deck-kernel/slide-commands";
import type {
  ArrowStyle,
  AspectRatioPreset,
  CanvasStyle,
  EffectKind,
  FillStyle,
  LineStyle,
  TextAlign,
  Visual,
  VisualEdge,
  VisualEffect,
  VisualKind,
  VisualNode,
  VisualStyle,
} from "@/lib/visual/schema";
import { type NodeStyleField } from "@/lib/visual/transforms";
import { executeVisualEdgeFamily } from "./visual-command-edge-executor";
import { executeVisualEffectFamily } from "./visual-command-effect-executor";
import {
  failure as visualCommandFailure,
  success as visualCommandSuccess,
  uniqueIds,
  validateOutput,
} from "./visual-command-executor-helpers";
import { executeVisualLayoutFamily } from "./visual-command-layout-executor";
import { executeVisualLifecycleFamily } from "./visual-command-lifecycle-executor";
import {
  canCoalesceVisualCommands,
  mergeVisualCommands,
} from "./visual-command-metadata";
import { executeVisualNodeFamily } from "./visual-command-node-executor";
import { executeVisualStyleFamily } from "./visual-command-style-executor";

export interface EdgeStylePatch {
  arrowStyle?: ArrowStyle;
  lineStyle?: LineStyle;
  lineWidth?: number;
}

export type AllEdgesStylePatch = EdgeStylePatch;

export interface NodeExtStylePatch {
  fillStyle?: FillStyle;
  borderStyle?: LineStyle;
  borderWidth?: number;
  textAlign?: TextAlign;
  fontFamily?: string;
}

export type VisualCommandPayload =
  | { op: "visual.apply_theme"; themeId: string }
  | { op: "visual.set_style"; patch: Partial<VisualStyle> }
  | { op: "visual.apply_display_style"; styleId: string }
  | { op: "visual.set_kind"; kind: VisualKind }
  | { op: "visual.set_canvas_style"; canvasStyle: CanvasStyle }
  | { op: "visual.set_aspect_ratio"; preset: AspectRatioPreset }
  | { op: "visual.set_auto_layout"; enabled: boolean }
  | {
      op: "visual.set_node_style";
      nodeId: string;
      field: NodeStyleField;
      value: string;
    }
  | { op: "visual.reset_node_style"; nodeId: string }
  | {
      op: "visual.set_node_ext_style";
      nodeId: string;
      patch: NodeExtStylePatch;
    }
  | { op: "visual.reset_node_ext_style"; nodeId: string }
  | { op: "visual.set_node_icon"; nodeId: string; icon: string }
  | { op: "visual.clear_node_icon"; nodeId: string }
  | { op: "visual.set_node_label"; nodeId: string; label: string }
  | { op: "visual.set_edge_label"; edgeId: string; label: string }
  | { op: "visual.set_edge_style"; edgeId: string; patch: EdgeStylePatch }
  | { op: "visual.flip_edge"; edgeId: string }
  | { op: "visual.toggle_edge_directed"; edgeId: string }
  | { op: "visual.toggle_edge_style"; edgeId: string }
  | { op: "visual.set_all_edges_style"; patch: AllEdgesStylePatch }
  | { op: "visual.set_effect"; effect: VisualEffect }
  | { op: "visual.clear_effect"; kind: EffectKind }
  | { op: "visual.merge_content"; newVisual: Visual }
  // --- lifecycle operations (#446) ---
  | {
      op: "visual.add_node";
      node: Omit<VisualNode, "id"> & { id?: string };
    }
  | { op: "visual.delete_node"; nodeId: string }
  | {
      op: "visual.add_edge";
      edge: Omit<VisualEdge, "id"> & { id?: string };
    }
  | { op: "visual.delete_edge"; edgeId: string }
  | {
      op: "visual.reconnect_edge";
      edgeId: string;
      fromNodeId?: string;
      toNodeId?: string;
    }
  | { op: "visual.duplicate_node"; nodeId: string; newNodeId?: string }
  | { op: "visual.relayout_graph" };

export interface VisualCommand extends CommandEnvelope<VisualCommandPayload> {
  type: VisualCommandPayload["op"];
  target: CommandTarget & { surface: "visual"; visualId: string };
}

export interface VisualPatch {
  schemaVersion: number;
  op: VisualCommandPayload["op"];
  visualId: string;
  affectedNodeIds: string[];
  affectedEdgeIds: string[];
}

export type VisualSideEffect =
  | { kind: "visual_mirror_rebuild"; visualId: string }
  | { kind: "source_staleness_recompute"; visualId: string }
  | { kind: "render_invalidation"; visualId: string };

export interface VisualCommandResult {
  ok: boolean;
  visual: Visual;
  error?: string;
  affectedNodeIds: string[];
  affectedEdgeIds: string[];
  historyKey?: string;
  patches: VisualPatch[];
  sideEffects: VisualSideEffect[];
}

export function executeVisualCommand(
  visual: Visual,
  cmd: VisualCommand,
): VisualCommandResult {
  const validation = validateCommandEnvelope(cmd);
  if (!validation.valid) {
    return visualCommandFailure(visual, validation.errors.join(" "));
  }

  const execution = executeVisualCommandFamily(visual, cmd);
  if ("patches" in execution) {
    return execution;
  }

  const invalid = validateOutput(execution.visual, visual);
  if (invalid) {
    return invalid;
  }

  return visualCommandSuccess(
    execution.visual,
    cmd,
    uniqueIds(execution.affectedNodeIds),
    uniqueIds(execution.affectedEdgeIds),
    execution.includeSourceRecompute,
  );
}

function executeVisualCommandFamily(visual: Visual, cmd: VisualCommand) {
  switch (cmd.payload.op) {
    case "visual.apply_theme":
    case "visual.set_style":
    case "visual.apply_display_style":
    case "visual.set_kind":
    case "visual.set_canvas_style":
      return executeVisualStyleFamily(visual, cmd);
    case "visual.set_aspect_ratio":
    case "visual.set_auto_layout":
    case "visual.relayout_graph":
      return executeVisualLayoutFamily(visual, cmd);
    case "visual.set_node_style":
    case "visual.reset_node_style":
    case "visual.set_node_ext_style":
    case "visual.reset_node_ext_style":
    case "visual.set_node_icon":
    case "visual.clear_node_icon":
    case "visual.set_node_label":
      return executeVisualNodeFamily(visual, cmd);
    case "visual.set_edge_style":
    case "visual.set_edge_label":
    case "visual.flip_edge":
    case "visual.toggle_edge_directed":
    case "visual.toggle_edge_style":
    case "visual.set_all_edges_style":
      return executeVisualEdgeFamily(visual, cmd);
    case "visual.set_effect":
    case "visual.clear_effect":
      return executeVisualEffectFamily(visual, cmd);
    case "visual.merge_content":
    case "visual.add_node":
    case "visual.delete_node":
    case "visual.add_edge":
    case "visual.delete_edge":
    case "visual.reconnect_edge":
    case "visual.duplicate_node":
      return executeVisualLifecycleFamily(visual, cmd);
  }
}

export function adaptVisualCommandResult(
  command: VisualCommand,
  result: VisualCommandResult,
): CrossSurfaceCommandResult<VisualPatch, VisualSideEffect> {
  return {
    ok: result.ok,
    ...(result.error ? { error: result.error } : {}),
    affectedIds: makeAffectedIds({
      ...(command.target.documentId
        ? { documentIds: [command.target.documentId] }
        : {}),
      visualIds: [command.target.visualId],
      nodeIds: result.affectedNodeIds,
      edgeIds: result.affectedEdgeIds,
    }),
    ...(result.historyKey ? { coalesceKey: result.historyKey } : {}),
    patches: result.patches,
    sideEffects: result.sideEffects,
  };
}

export function coalesceVisualCommands(
  history: VisualCommand[],
): VisualCommand[] {
  if (history.length === 0) {
    return history;
  }

  const result: VisualCommand[] = [history[0]!];
  for (let index = 1; index < history.length; index += 1) {
    const previous = result[result.length - 1]!;
    const current = history[index]!;
    if (canCoalesceVisualCommands(previous, current)) {
      result[result.length - 1] = mergeVisualCommands(previous, current);
    } else {
      result.push(current);
    }
  }
  return result;
}

export type CrossSurfacePatch = DeckPatch | VisualPatch;
