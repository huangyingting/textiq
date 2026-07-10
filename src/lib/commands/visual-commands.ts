import {
  makeAffectedIds,
  type CrossSurfaceCommandResult,
} from "@/lib/commands/command-result-helpers";
import { validateCommandEnvelope } from "@/lib/commands/command-envelope-validation";
import type { Visual } from "@/lib/visual/schema";
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
import type {
  VisualCommand,
  VisualCommandResult,
  VisualPatch,
  VisualSideEffect,
} from "./visual-command-contracts";

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
