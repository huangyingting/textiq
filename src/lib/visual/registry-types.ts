import type { NodeShape, VisualKind } from "@/lib/visual/schema";

/**
 * "positioned" means nodes carry explicit x/y coordinates. "derived" means the
 * renderer computes positions from order/value at render time.
 */
export type LayoutFamily = "positioned" | "derived";

/** Describes how well a visual kind renders to each export format. */
export interface KindExportSupport {
  svg: boolean;
  png: boolean;
  pdf: boolean;
  pptxNative: boolean;
  pptxRasterFallback: boolean;
  pptxDegradations: readonly string[];
}

/** Per-kind flags that control which graph-editing operations are available. */
export interface KindEditingCapabilities {
  nodeAddable: boolean;
  nodeDeletable: boolean;
  edgeAddable: boolean;
  edgeDeletable: boolean;
  edgeReconnectable: boolean;
  nodeDuplicatable: boolean;
  autoLayoutSupported: boolean;
}

/** Registry-derived AI generation hints for a kind. */
export interface KindPromptConstraints {
  guidance: string;
  requiresNodeValue: boolean;
  requiresNodePosition: boolean;
  edgesRelevant: boolean;
}

export type RuntimeLayoutAlgorithm =
  | "explicit-position"
  | "flowchart-column"
  | "radial"
  | "orgchart-tree"
  | "list-stack"
  | "bar-chart"
  | "timeline-axis"
  | "cycle-ring"
  | "comparison-columns"
  | "funnel-bands"
  | "venn-circles"
  | "pyramid-bands"
  | "matrix-quadrants";

export type RuntimeRendererFamily =
  | "positioned-graph"
  | "ordered-list"
  | "bar-chart"
  | "timeline"
  | "cycle"
  | "comparison"
  | "funnel"
  | "venn"
  | "pyramid"
  | "matrix"
  | "orgchart";

export type RuntimeTransformLayout =
  "stack-vertical" | "radial" | "strip-position";

/** Descriptor-owned runtime contract for one visual kind. */
export interface VisualRuntimeDescriptor {
  readonly schema: {
    readonly core: "validateVisual";
    readonly nodes: "validateNode";
    readonly edges: "validateEdge";
    readonly style: "normalizeStyle";
    readonly effects: "parseEffects";
    readonly exportOptions: "parseVisualExportOptions";
  };
  readonly layout: {
    readonly family: LayoutFamily;
    readonly algorithm: RuntimeLayoutAlgorithm;
    readonly elasticAlgorithm?: "flowchart-column" | "radial" | "orgchart-tree";
  };
  readonly render: {
    readonly family: RuntimeRendererFamily;
    readonly component: string;
    readonly primitives: readonly (
      "canvas" | "effects" | "nodes" | "edges" | "labels" | "icons"
    )[];
  };
  readonly transform: {
    readonly kindSwitchLayout: RuntimeTransformLayout;
    readonly defaultShape: NodeShape;
    readonly preservesEdges: boolean;
    readonly autoLayoutSupported: boolean;
  };
  readonly validation: {
    readonly requiresNodeValue: boolean;
    readonly requiresNodePosition: boolean;
    readonly edgesRelevant: boolean;
  };
  readonly checklist: {
    readonly schema: true;
    readonly layout: true;
    readonly render: true;
    readonly edit: true;
    readonly export: true;
    readonly prompt: true;
    readonly transforms: true;
    readonly validation: true;
  };
}

/** Display, layout, and shape metadata owned separately from capabilities. */
export interface VisualKindDisplayMetadata {
  readonly label: string;
  readonly description: string;
  readonly keywords: readonly string[];
  readonly iconName: string;
  /** Tool-icon key (camelCase, used by the lexical tool layer). */
  readonly icon: string;
  readonly layoutFamily: LayoutFamily;
  readonly allowedShapes: readonly NodeShape[];
  readonly defaultShape: NodeShape;
}

/** The complete capability contract for a single VisualKind. */
export interface VisualKindEntry extends VisualKindDisplayMetadata {
  readonly id: VisualKind;
  readonly runtime: VisualRuntimeDescriptor;
  readonly editing: KindEditingCapabilities;
  readonly export: KindExportSupport;
  readonly prompt: KindPromptConstraints;
}

/** The complete registry: one entry per VisualKind. */
export type VisualRegistry = Record<VisualKind, VisualKindEntry>;
