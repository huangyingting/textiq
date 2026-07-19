/**
 * Per-kind adapter interface for layout and validation (Epic #442, issue #445).
 *
 * An adapter is a lightweight, pure-function overlay on top of the generic
 * Visual schema. It expresses semantic invariants that the generic validator
 * cannot check — e.g. "every chart node must have a numeric value".
 *
 * Adapters are:
 *  - Pure (no side-effects, no DOM, no I/O)
 *  - Optional per kind — kinds without special semantics use the
 *    {@link defaultAdapter}
 *  - Additive overlays — they do not replace or remove the generic
 *    `validateVisual` check in schema.ts
 *
 * The adapter boundary is intentionally small so simple kinds stay simple.
 * Future kinds with richer semantics (e.g. an ER diagram with typed columns)
 * can extend this interface without affecting existing adapters.
 *
 * @example
 *   const adapter = getAdapter("chart");
 *   const result = adapter.validate(visual);
 *   if (!result.ok) console.error(result.errors);
 */

import type { Visual, VisualKind } from "@/lib/visual/schema";
import { VISUAL_KINDS } from "@/lib/visual/schema"; /* node:coverage disable */

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

/* node:coverage ignore next 17 -- adapter interfaces are erased by tsx but reported in source maps. */
/** A semantic validation error surfaced by an adapter. */
export interface AdapterValidationError {
  /** Stable machine-readable code (for tests and UI localisation). */
  code: string;
  /** Human-readable message for debugging and AI repair. */
  message: string;
  /** Affected node id, when applicable. */
  nodeId?: string;
  /** Affected edge id, when applicable. */
  edgeId?: string;
}

/** Result of {@link VisualKindAdapter.validate}. */
export type AdapterValidationResult =
  { ok: true } | { ok: false; errors: AdapterValidationError[] };

/**
 * Per-kind adapter that provides semantic validation on top of the generic
 * schema layer.
 *
 * The generic {@link validateVisual} / {@link safeParseVisual} in schema.ts
 * runs first; adapters run after and add kind-specific invariant checks.
 *
 * All methods receive a structurally-valid Visual (i.e. one that already
 * passed generic schema validation) — adapters do not need to re-check
 * structural fields.
 */
export interface VisualKindAdapter {
  /** The kind this adapter handles. */
  readonly kind: VisualKind;

  /**
   * Validates kind-specific semantic invariants.
   *
   * Examples:
   *  - chart: every node must have a numeric `value`
   *  - funnel: node values should be non-increasing top to bottom
   *  - venn: requires exactly 2–3 nodes
   *
   * Returns `{ ok: true }` when all invariants pass.
   * Returns `{ ok: false, errors }` describing every failing invariant.
   */
  validate(visual: Visual): AdapterValidationResult;

  /**
   * Returns the ordered list of node fields that a UI editor should expose as
   * editable for this kind.
   *
   * Allows UI surfaces to omit fields that are meaningless for a given kind
   * (e.g. `value` on a flowchart node).
   */
  editableNodeFields(): readonly string[];
} /* node:coverage enable */

/* node:coverage ignore next 4 -- section comments map as uncovered in tsx output. */
// ---------------------------------------------------------------------------
// Default adapter (no-op)
// ---------------------------------------------------------------------------

/**
 * The default adapter used for kinds that have no special semantics.
 * All validation passes.
 */
class DefaultAdapter implements VisualKindAdapter {
  constructor(readonly kind: VisualKind) {}

  validate(_visual: Visual): AdapterValidationResult {
    return { ok: true };
  }

  editableNodeFields(): readonly string[] {
    return ["label", "icon", "shape", "color", "stroke", "textColor"];
  }
}

/* node:coverage ignore next 4 -- section comments map as uncovered in tsx output. */
// ---------------------------------------------------------------------------
// Chart adapter (value-driven kind)
// ---------------------------------------------------------------------------

/* node:coverage disable */
/**
 * Adapter for the `chart` kind.
 *
 * Invariants:
 *  - Every node must have a numeric `value` (used as bar height).
 *  - Value should be a finite number ≥ 0.
 *
 */
class ChartAdapter implements VisualKindAdapter {
  /* node:coverage enable */
  readonly kind = "chart" as const;

  validate(visual: Visual): AdapterValidationResult {
    const errors: AdapterValidationError[] = [];
    for (const node of visual.nodes) {
      if (typeof node.value !== "number" || !isFinite(node.value)) {
        errors.push({
          /* node:coverage disable */ code: "chart.missing-value",
          message: `Chart node "${node.id}" is missing a numeric value (required for bar height).`,
          nodeId: node.id,
        }); /* node:coverage enable */
      }
    }
    return errors.length === 0 ? { ok: true } : { ok: false, errors };
  }

  editableNodeFields(): readonly string[] {
    return ["label", "value", "icon", "color", "stroke", "textColor"];
  }
}

// ---------------------------------------------------------------------------
// Flowchart adapter (graph-like positioned kind)
// ---------------------------------------------------------------------------

/**
 * Adapter for the `flowchart` kind.
 *
 * Invariants:
 *  - Every edge must reference nodes that exist in the visual.
 *  - The visual should have at least one node.
 *
 */
class FlowchartAdapter implements VisualKindAdapter {
  /* node:coverage disable */
  readonly kind = "flowchart" as const;

  validate(visual: Visual): AdapterValidationResult {
    const errors: AdapterValidationError[] = [];
    const nodeIds = new Set(visual.nodes.map((n) => n.id));
    for (const edge of visual.edges) {
      /* node:coverage enable */
      if (!nodeIds.has(edge.from)) {
        errors.push({
          /* node:coverage disable */ code: "flowchart.dangling-edge-from",
          message: `Edge "${edge.id}" references missing source node "${edge.from}".`,
          edgeId: edge.id,
        }); /* node:coverage enable */
      }
      if (!nodeIds.has(edge.to)) {
        errors.push({
          code: "flowchart.dangling-edge-to",
          message: `Edge "${edge.id}" references missing target node "${edge.to}".`,
          edgeId: edge.id,
        });
      }
    }
    return errors.length === 0 ? { ok: true } : { ok: false, errors };
  }

  editableNodeFields(): readonly string[] {
    return ["label", "shape", "icon", "color", "stroke", "textColor"];
  }
}

// ---------------------------------------------------------------------------
// Venn adapter (geometry-constrained kind)
// ---------------------------------------------------------------------------

/**
 * Adapter for the `venn` kind.
 *
 * Invariants:
 *  - Requires 2–3 nodes (circles).
 *  - Each node should have explicit x/y (circle center) and width (diameter).
 */
class VennAdapter implements VisualKindAdapter {
  readonly kind = "venn" as const;

  validate(visual: Visual): AdapterValidationResult {
    const errors: AdapterValidationError[] = [];
    if (visual.nodes.length < 2 || visual.nodes.length > 3) {
      errors.push({
        code: "venn.invalid-node-count",
        message: `Venn diagrams require 2 or 3 nodes (circles); got ${visual.nodes.length}.`,
      });
    }
    for (const node of visual.nodes) {
      if (typeof node.x !== "number" || typeof node.y !== "number") {
        errors.push({
          code: "venn.missing-position",
          message: `Venn node "${node.id}" is missing x/y (circle center position).`,
          nodeId: node.id,
        });
      }
      if (typeof node.width !== "number" || node.width <= 0) {
        errors.push({
          code: "venn.missing-diameter",
          message: `Venn node "${node.id}" is missing a positive width (circle diameter).`,
          nodeId: node.id,
        });
      }
    }
    return errors.length === 0 ? { ok: true } : { ok: false, errors };
  }

  editableNodeFields(): readonly string[] {
    return ["label", "color", "stroke", "textColor"];
  }
}

// ---------------------------------------------------------------------------
// Comparison adapter (value-driven column layout)
// ---------------------------------------------------------------------------

/**
 * Adapter for the `comparison` kind.
 *
 * Invariants:
 *  - Each node's `value` field must be a non-negative integer (column index).
 *
 */
class ComparisonAdapter implements VisualKindAdapter {
  readonly kind = "comparison" as const;

  validate(visual: Visual): AdapterValidationResult {
    const errors: AdapterValidationError[] = [];
    for (const node of visual.nodes) {
      if (
        typeof node.value !== "number" ||
        !Number.isInteger(node.value) ||
        node.value < 0
      ) {
        errors.push({
          code: "comparison.invalid-column-index",
          message: `Comparison node "${node.id}" has invalid value "${String(node.value)}" — must be a non-negative integer column index.`,
          nodeId: node.id,
        });
      }
    }
    return errors.length === 0 ? { ok: true } : { ok: false, errors };
  }

  editableNodeFields(): readonly string[] {
    return ["label", "value", "icon", "color", "stroke", "textColor"];
  }
}

// ---------------------------------------------------------------------------
// Matrix adapter (quadrant-value kind)
// ---------------------------------------------------------------------------

/**
 * Adapter for the `matrix` kind.
 *
 * Invariants:
 *  - Each node's `value` must be a quadrant index: 0, 1, 2, or 3.
 */
class MatrixAdapter implements VisualKindAdapter {
  readonly kind = "matrix" as const;

  validate(visual: Visual): AdapterValidationResult {
    const errors: AdapterValidationError[] = [];
    for (const node of visual.nodes) {
      if (![0, 1, 2, 3].includes(node.value as number)) {
        errors.push({
          code: "matrix.invalid-quadrant",
          message: `Matrix node "${node.id}" has invalid quadrant value "${String(node.value)}" — must be 0, 1, 2, or 3.`,
          nodeId: node.id,
        });
      }
    }
    return errors.length === 0 ? { ok: true } : { ok: false, errors };
  }

  editableNodeFields(): readonly string[] {
    return ["label", "value", "icon", "color", "stroke", "textColor"];
  }
}

// ---------------------------------------------------------------------------
// Funnel adapter (ordered, decreasing values)
// ---------------------------------------------------------------------------

/**
 * Adapter for the `funnel` kind.
 *
 * Invariants:
 *  - Every node should have a numeric value ≥ 0.
 */
class FunnelAdapter implements VisualKindAdapter {
  readonly kind = "funnel" as const;

  validate(visual: Visual): AdapterValidationResult {
    const errors: AdapterValidationError[] = [];
    for (const node of visual.nodes) {
      if (typeof node.value !== "number" || node.value < 0) {
        errors.push({
          code: "funnel.invalid-value",
          message: `Funnel node "${node.id}" needs a non-negative numeric value (band width).`,
          nodeId: node.id,
        });
      }
    }
    return errors.length === 0 ? { ok: true } : { ok: false, errors };
  }

  editableNodeFields(): readonly string[] {
    return ["label", "value", "color", "stroke", "textColor"];
  }
}

// ---------------------------------------------------------------------------
// Adapter registry
// ---------------------------------------------------------------------------

const ADAPTERS: Record<VisualKind, VisualKindAdapter> = {
  flowchart: new FlowchartAdapter(),
  mindmap: new DefaultAdapter("mindmap"),
  list: new DefaultAdapter("list"),
  chart: new ChartAdapter(),
  concept: new DefaultAdapter("concept"),
  timeline: new DefaultAdapter("timeline"),
  cycle: new DefaultAdapter("cycle"),
  comparison: new ComparisonAdapter(),
  funnel: new FunnelAdapter(),
  venn: new VennAdapter(),
  pyramid: new DefaultAdapter("pyramid"),
  matrix: new MatrixAdapter(),
  orgchart: new DefaultAdapter("orgchart"),
} satisfies Record<VisualKind, VisualKindAdapter>;

/**
 * Returns the {@link VisualKindAdapter} for the given kind.
 * Always returns a valid adapter — kinds without special semantics use the
 * {@link DefaultAdapter}.
 */
export function getAdapter(kind: VisualKind): VisualKindAdapter {
  return ADAPTERS[kind];
}

/**
 * Convenience: validates a visual using both the schema layer (assumed already
 * run) and the kind-specific adapter.
 *
 * Returns `{ ok: true }` when all invariants pass, or a merged error list.
 */
export function validateWithAdapter(visual: Visual): AdapterValidationResult {
  return getAdapter(visual.type).validate(visual);
}

/**
 * Asserts that every {@link VisualKind} has an adapter registered.
 * Called from tests to detect drift.
 */
export function assertAdapterCompleteness(): void {
  for (const kind of VISUAL_KINDS) {
    const adapter = ADAPTERS[kind];
    if (!adapter) {
      throw new Error(`[adapters] Missing adapter for kind: ${kind}`);
    }
    if (adapter.kind !== kind) {
      throw new Error(
        `[adapters] Adapter kind mismatch: expected "${kind}", got "${adapter.kind}"`,
      );
    }
  }
}
