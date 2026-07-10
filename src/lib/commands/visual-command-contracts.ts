/** Visual command payload/result contracts with no executor imports. */

import type { CommandEnvelope, CommandTarget } from "./envelope-core";
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
import type { NodeStyleField } from "@/lib/visual/transforms";

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

export type CrossSurfacePatch = DeckPatch | VisualPatch;
