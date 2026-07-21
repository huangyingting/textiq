/**
 * Pure, framework-free data transforms for {@link Visual} documents — the
 * single home for the "edit / restyle" operations the visual UI performs.
 *
 * Every function here is a **pure** transform: it takes a `Visual` and returns a
 * brand-new `Visual` without ever mutating its input, and its output is always
 * structurally valid against `@/lib/visual/schema` (so the result can be handed
 * straight to `node.setVisual(...)` inside an `editor.update()` and round-trips
 * through `safeParseVisual`). There are intentionally no React/Lexical imports:
 * the UI (Switch's Phase 3 chrome) calls these helpers from inside its own
 * `editor.update()` blocks, keeping the mutation logic testable in isolation.
 *
 * `contentJson` remains the single source of truth — these transforms only ever
 * compute the *next* `Visual` value; persistence/versioning is handled by the
 * unchanged save → `mirrorVisualNodes` path (`actions.ts`).
 */ /* node:coverage ignore next 18 -- type-only imports are erased by tsx but mapped as uncovered. */

import {
  DEFAULT_NODE_HEIGHT,
  DEFAULT_NODE_WIDTH,
  type ArrowStyle,
  type AspectRatioPreset,
  type CanvasStyle,
  type EffectKind,
  type FillStyle,
  type LineStyle,
  type TextAlign,
  type Visual,
  type VisualEdge,
  type VisualEffect,
  type VisualKind,
  type VisualNode,
  type VisualStyle,
} from "@/lib/visual/schema";
import { STYLE_THEMES } from "@/lib/visual/themes";
import { VISUAL_DISPLAY_STYLES } from "@/lib/visual/display-styles";
import { elasticLayout } from "@/lib/visual/elastic-layout";
import { getKindRuntimeDescriptor } from "@/lib/visual/registry";

/** Per-node color override fields the selected-element controls can set. */
export type NodeStyleField = "color" | "stroke" | "textColor";

function cloneStyle(style: VisualStyle): VisualStyle {
  return { ...style, palette: [...style.palette] };
}

function cloneNode(node: VisualNode): VisualNode {
  return { ...node };
}

function cloneEdge(edge: VisualEdge): VisualEdge {
  return { ...edge };
}

function assertUniqueEdgeIds(edges: readonly VisualEdge[]): void {
  const seen = new Set<string>();
  for (const edge of edges) {
    if (seen.has(edge.id)) {
      throw new Error(`Duplicate edge id: ${edge.id}`);
    }
    seen.add(edge.id);
  }
}

/**
 * Deep-enough clone of a {@link Visual}: a fresh top-level object with cloned
 * `style` (palette array copied), `nodes`, and `edges` so callers can never
 * observe a mutation of their input. The shared base for every transform below.
 */
function cloneVisual(visual: Visual): Visual {
  assertUniqueEdgeIds(visual.edges);
  return {
    ...visual,
    style: cloneStyle(visual.style),
    nodes: visual.nodes.map(cloneNode),
    edges: visual.edges.map(cloneEdge),
    ...(visual.effects
      ? { effects: visual.effects.map((e) => ({ ...e })) }
      : {}),
  };
}

/**
 * Applies a named palette theme (looked up by `themeId` from the
 * {@link STYLE_THEMES} registry) to the whole visual — the "theme-first,
 * one-click restyle" path. Theme colors (`palette` + base colors) are merged
 * over the current style while **typography is preserved**
 * (`fontFamily`/`fontSize`/`fontWeight` are untouched).
 *
 * The theme is resolved dynamically from the registry, so any theme Mouse adds
 * to `themes.ts` works automatically with no change here. An unknown `themeId`
 * is a safe no-op: a fresh, unchanged clone is returned (never the input).
 */
export function applyTheme(visual: Visual, themeId: string): Visual {
  const next = cloneVisual(visual);
  const theme = STYLE_THEMES.find((entry) => entry.id === themeId);
  if (!theme) {
    return next;
  }
  next.style = {
    ...next.style,
    ...theme.colors,
    palette: [...theme.colors.palette],
  };
  return next;
}

/**
 * Whether `visual`'s current style matches the theme identified by `themeId`
 * (so the UI can render the active theme chip). Compares the theme-controlled
 * colors only (typography is ignored, mirroring {@link applyTheme}). An unknown
 * `themeId` returns `false`.
 */
export function isThemeActive(visual: Visual, themeId: string): boolean {
  const theme = STYLE_THEMES.find((entry) => entry.id === themeId);
  if (!theme) {
    return false;
  }
  const { style } = visual;
  const colors = theme.colors;
  return (
    style.background === colors.background &&
    style.nodeFill === colors.nodeFill &&
    style.nodeStroke === colors.nodeStroke &&
    style.nodeText === colors.nodeText &&
    style.edgeColor === colors.edgeColor &&
    style.palette.length === colors.palette.length &&
    style.palette.every((color, index) => color === colors.palette[index])
  );
}

/**
 * Merges a partial {@link VisualStyle} patch over the visual's style — the
 * single helper behind every whole-visual style control (background / node fill
 * / border / text / edge colors, font size, font weight). When the patch
 * includes a `palette`, the array is copied so the caller's array is never
 * aliased.
 */
export function setVisualStyle(
  visual: Visual,
  patch: Partial<VisualStyle>,
): Visual {
  const next = cloneVisual(visual);
  next.style = { ...next.style, ...patch };
  if (patch.palette) {
    next.style.palette = [...patch.palette];
  }
  return next;
}

/** Sets a single per-node color override (fill / border / text) on one node. */
export function setNodeStyle(
  visual: Visual,
  id: string,
  field: NodeStyleField,
  value: string,
): Visual {
  const next = cloneVisual(visual);
  next.nodes = next.nodes.map((node) =>
    node.id === id ? { ...node, [field]: value } : node,
  );
  return next;
}

/** Clears every per-node color override, falling back to the theme defaults. */
export function resetNodeStyle(visual: Visual, id: string): Visual {
  const next = cloneVisual(visual);
  next.nodes = next.nodes.map((node) => {
    if (node.id !== id) {
      return node;
    }
    const reset = { ...node };
    delete reset.color;
    delete reset.stroke;
    delete reset.textColor;
    return reset;
  });
  return next;
}

/** Assigns a catalog icon name to a node. */
export function setNodeIcon(visual: Visual, id: string, icon: string): Visual {
  const next = cloneVisual(visual);
  next.nodes = next.nodes.map((node) =>
    node.id === id ? { ...node, icon } : node,
  );
  return next;
}

/** Removes a node's icon, falling back to no icon. */
/* node:coverage ignore next 12 -- clearNodeIcon is asserted; tsx maps the covered delete branch as uncovered. */
export function clearNodeIcon(visual: Visual, id: string): Visual {
  const next = cloneVisual(visual);
  next.nodes = next.nodes.map((node) => {
    if (node.id !== id) {
      return node;
    }
    const cleared = { ...node };
    delete cleared.icon;
    return cleared;
  });
  return next;
}

/** Sets the fill style (solid / gradient) on a single node. */
export function setNodeFillStyle(
  visual: Visual,
  id: string,
  fillStyle: FillStyle,
): Visual {
  const next = cloneVisual(visual);
  next.nodes = next.nodes.map((node) =>
    node.id === id ? { ...node, fillStyle } : node,
  );
  return next;
}

/** Sets the border (stroke) style on a single node. */
export function setNodeBorderStyle(
  visual: Visual,
  id: string,
  borderStyle: LineStyle,
): Visual {
  const next = cloneVisual(visual);
  next.nodes = next.nodes.map((node) =>
    node.id === id ? { ...node, borderStyle } : node,
  );
  return next;
}

/** Sets the border width on a single node. */
export function setNodeBorderWidth(
  visual: Visual,
  id: string,
  borderWidth: number,
): Visual {
  const next = cloneVisual(visual);
  next.nodes = next.nodes.map((node) =>
    node.id === id ? { ...node, borderWidth } : node,
  );
  return next;
}

/** Sets the text alignment on a single node. */
export function setNodeTextAlign(
  visual: Visual,
  id: string,
  textAlign: TextAlign,
): Visual {
  const next = cloneVisual(visual);
  next.nodes = next.nodes.map((node) =>
    node.id === id ? { ...node, textAlign } : node,
  );
  return next;
}

/**
 * Sets a per-node font family override. Pass an empty string or call
 * {@link resetNodeExtStyle} to clear the override and fall back to the visual's
 * global `style.fontFamily`. The value is any CSS font-family string; use the
 * `cssFamily` from {@link BRAND_WEB_FONTS} for a curated web-font, or `""`
 * to inherit.
 */
export function setNodeFontFamily(
  visual: Visual,
  id: string,
  fontFamily: string,
): Visual {
  const next = cloneVisual(visual);
  next.nodes = next.nodes.map((node) => {
    if (node.id !== id) {
      return node;
    }
    if (!fontFamily) {
      const cleared = { ...node };
      delete cleared.fontFamily;
      return cleared;
    }
    return { ...node, fontFamily };
  });
  return next;
}

/** Sets a node label and re-flows auto-layout visuals when needed. */
export function setNodeLabel(
  visual: Visual,
  id: string,
  label: string,
): Visual {
  const next = cloneVisual(visual);
  next.nodes = next.nodes.map((node) =>
    node.id === id ? { ...node, label } : node,
  );
  return next.autoLayout ? applyElasticLayout(next) : next;
}

/**
 * Clears all extended per-node style overrides (fillStyle, borderStyle,
 * borderWidth, textAlign, fontFamily), falling back to defaults. Works alongside
 * {@link resetNodeStyle} (which clears color overrides).
 */
export function resetNodeExtStyle(visual: Visual, id: string): Visual {
  const next = cloneVisual(visual);
  next.nodes = next.nodes.map((node) => {
    if (node.id !== id) {
      return node;
    }
    const reset = { ...node };
    delete reset.fillStyle;
    delete reset.borderStyle;
    /* node:coverage ignore next -- resetNodeExtStyle delete branch is asserted; tsx maps it as uncovered. */
    delete reset.borderWidth;
    delete reset.textAlign;
    delete reset.fontFamily;
    return reset;
  });
  return next;
}

/**
 * Sets the arrowhead variant on a single edge.
 * `arrowStyle: "filled"` (default closed triangle) is the baseline.
 */
export function setEdgeArrowStyle(
  visual: Visual,
  id: string,
  arrowStyle: ArrowStyle,
): Visual {
  const next = cloneVisual(visual);
  next.edges = next.edges.map((edge) =>
    edge.id === id ? { ...edge, arrowStyle } : edge,
  );
  return next;
}

/** Sets the stroke pattern (solid / dashed / dotted) on a single edge. */
export function setEdgeLineStyle(
  visual: Visual,
  id: string,
  lineStyle: LineStyle,
): Visual {
  const next = cloneVisual(visual);
  next.edges = next.edges.map((edge) =>
    edge.id === id ? { ...edge, lineStyle } : edge,
  );
  return next;
}

/** Sets the stroke width on a single edge. */
export function setEdgeLineWidth(
  visual: Visual,
  id: string,
  lineWidth: number,
): Visual {
  const next = cloneVisual(visual);
  next.edges = next.edges.map((edge) =>
    edge.id === id ? { ...edge, lineWidth } : edge,
  );
  return next;
}

/** Sets a single edge's label. */
export function setEdgeLabel(
  visual: Visual,
  id: string,
  label: string,
): Visual {
  assertUniqueEdgeIds(visual.edges);
  return {
    ...visual,
    edges: visual.edges.map((edge) =>
      edge.id === id ? { ...edge, label } : edge,
    ),
  };
}

/** Flips a connector's direction by swapping its `from`/`to` endpoints. */
export function flipEdge(visual: Visual, id: string): Visual {
  assertUniqueEdgeIds(visual.edges);
  return {
    ...visual,
    edges: visual.edges.map((edge) =>
      edge.id === id ? { ...edge, from: edge.to, to: edge.from } : edge,
    ),
  };
}

/** Toggles a connector's arrowhead (the `directed` flag; default shown). */
export function toggleEdgeDirected(visual: Visual, id: string): Visual {
  assertUniqueEdgeIds(visual.edges);
  return {
    ...visual,
    edges: visual.edges.map((edge) =>
      edge.id === id ? { ...edge, directed: edge.directed === false } : edge,
    ),
  };
}

/** Toggles a connector between curved and straight (default straight). */
export function toggleEdgeStyle(visual: Visual, id: string): Visual {
  assertUniqueEdgeIds(visual.edges);
  return {
    ...visual,
    edges: visual.edges.map((edge) =>
      edge.id === id
        ? { ...edge, style: edge.style === "curved" ? "straight" : "curved" }
        : edge,
    ),
  };
}

/**
 * Applies arrowStyle / lineStyle / lineWidth to **all** edges in the visual —
 * the "global connector style" path in the UI (no edge selection required).
 * Only the fields present in `patch` are changed; others are left untouched.
 */
export function setAllEdgesStyle(
  visual: Visual,
  patch: {
    arrowStyle?: ArrowStyle;
    lineStyle?: LineStyle;
    lineWidth?: number;
  },
): Visual {
  const next = cloneVisual(visual);
  next.edges = next.edges.map((edge) => ({ ...edge, ...patch }));
  return next;
}

/**
 * Applies a named display style (looked up by `styleId` from
 * {@link VISUAL_DISPLAY_STYLES}) to a visual — the "style gallery" restyle path.
 *
 * Changes only presentation: the color profile, font weight, node shapes, and
 * edge connector styles are replaced with the preset's values while all
 * node/edge/label content (ids, labels, values, positions, per-node color
 * overrides, icons) is kept intact. Typography (`fontFamily`/`fontSize`) is
 * never touched. An unknown `styleId` is a safe no-op clone.
 */
export function applyDisplayStyle(visual: Visual, styleId: string): Visual {
  const next = cloneVisual(visual);
  const preset = VISUAL_DISPLAY_STYLES.find((s) => s.id === styleId);
  if (!preset) {
    return next;
  }
  next.style = {
    ...next.style,
    /* node:coverage ignore next -- applyDisplayStyle is asserted; tsx maps this object spread as uncovered. */
    ...preset.colors,
    palette: [...preset.colors.palette],
    fontWeight: preset.fontWeight,
  };
  next.nodes = next.nodes.map((node) => ({
    ...node,
    shape: preset.nodeShape,
  }));
  next.edges = next.edges.map((edge) => ({
    ...edge,
    style: preset.edgeStyle,
  }));
  return next;
}

/**
 * Whether `visual`'s current presentation matches the display style identified
 * by `styleId` (so the gallery can highlight the active preset). Compares
 * colors, font weight, node shapes, and edge styles. An unknown `styleId`
 * returns `false`.
 */
export function isDisplayStyleActive(visual: Visual, styleId: string): boolean {
  const preset = VISUAL_DISPLAY_STYLES.find((s) => s.id === styleId);
  if (!preset) {
    return false;
  }
  const { style, nodes, edges } = visual;
  const c = preset.colors; /* node:coverage disable */
  if (
    style.background !== c.background ||
    style.nodeFill !== c.nodeFill ||
    style.nodeStroke !== c.nodeStroke ||
    style.nodeText !== c.nodeText ||
    style.edgeColor !== c.edgeColor ||
    style.fontWeight !== preset.fontWeight ||
    style.palette.length !== c.palette.length ||
    !style.palette.every((color, i) => color === c.palette[i])
  ) {
    return false;
  }
  if (nodes.some((n) => n.shape !== preset.nodeShape)) {
    return false;
  }
  const expectedEdge = preset.edgeStyle;
  if (edges.some((e) => (e.style ?? "straight") !== expectedEdge)) {
    return false;
  }
  return true;
}

/** The shape used as the default for each positioned kind on a kind switch. */
const POSITIONED_SHAPE: Record<
  "flowchart" | "mindmap" | "concept",
  VisualNode["shape"]
> = {
  /* node:coverage enable */ flowchart: "rounded",
  mindmap: "pill",
  concept: "ellipse",
};

function nodeWidth(node: VisualNode): number {
  return node.width ?? DEFAULT_NODE_WIDTH;
}

function nodeHeight(node: VisualNode): number {
  return node.height ?? DEFAULT_NODE_HEIGHT;
}

/**
 * Lays nodes out in a single vertical column centered horizontally — the
 * default layout for a `flowchart` kind switch. Positions are derived from node
 * order (existing `x`/`y` are replaced) so a freshly switched flowchart never
 * collapses onto a single point.
 */
function stackVerticalLayout(
  nodes: VisualNode[],
  width: number,
  height: number,
): VisualNode[] {
  const x = width / 2;
  const marginTop = 60;
  const marginBottom = 60;
  const span = Math.max(height - marginTop - marginBottom, 0);
  const step = nodes.length > 1 ? span / (nodes.length - 1) : 0;
  return nodes.map((node, index) => ({
    ...node,
    x,
    y: nodes.length > 1 ? marginTop + step * index : height / 2,
    width: nodeWidth(node),
    height: nodeHeight(node),
    shape: POSITIONED_SHAPE.flowchart,
  }));
}

/**
 * Lays nodes out with the first node at the canvas center and the rest evenly
 * spaced on a ring around it (starting at the top, going clockwise) — the
 * default layout for a `mindmap`/`concept` kind switch. Positions are derived
 * from node order/count (existing `x`/`y` are replaced).
 */
function radialLayout(
  nodes: VisualNode[],
  width: number,
  height: number,
  shape: VisualNode["shape"],
): VisualNode[] {
  const cx = width / 2;
  const cy = height / 2;
  const margin = 24;
  const maxNodeWidth = Math.max(...nodes.map(nodeWidth), DEFAULT_NODE_WIDTH);
  const maxNodeHeight = Math.max(...nodes.map(nodeHeight), DEFAULT_NODE_HEIGHT);
  const radius = Math.max(
    Math.min(cx - maxNodeWidth / 2 - margin, cy - maxNodeHeight / 2 - margin),
    40,
  );
  const branchCount = Math.max(nodes.length - 1, 1);
  return nodes.map((node, index) => {
    const base = {
      ...node,
      width: nodeWidth(node),
      height: nodeHeight(node),
      shape,
    };
    if (index === 0) {
      return { ...base, x: cx, y: cy };
    }
    const angle = -Math.PI / 2 + ((index - 1) / branchCount) * Math.PI * 2;
    return {
      ...base,
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  });
}

/**
 * Switches a visual to a different {@link VisualKind}, preserving as much
 * node/edge/label data as sensibly maps:
 *
 * - All node labels, values, icons, and per-node color overrides are kept, and
 *   every edge (which references node ids) is preserved.
 * - Switching to a **positioned** kind (`flowchart`/`mindmap`/`concept`) assigns
 *   fresh `x`/`y` positions (and the kind's default node shape) so the nodes
 *   don't overlap — a flowchart stacks vertically; mindmaps/concepts fan out
 *   radially around the first node.
 * - Switching to a **derived-layout** kind (`chart`/`list`/`timeline`/`cycle`/
 *   `comparison`/`funnel`) drops stale `x`/`y` since those kinds compute node
 *   positions from order at render time (see `layout.ts`).
 *
 * Switching to the same kind returns an unchanged clone. The result is always
 * schema-valid for the new kind.
 */
export function setVisualKind(visual: Visual, kind: VisualKind): Visual {
  const next = cloneVisual(visual);
  if (kind === visual.type) {
    return next;
  }
  next.type = kind;

  const runtime = getKindRuntimeDescriptor(kind);
  switch (runtime.transform.kindSwitchLayout) {
    case "stack-vertical":
      next.nodes = stackVerticalLayout(next.nodes, next.width, next.height);
      break;
    case "radial":
      next.nodes = radialLayout(
        next.nodes,
        next.width,
        next.height,
        runtime.transform.defaultShape,
      );
      break;
    case "strip-position":
      // Derived-layout kinds position nodes from order at render time, so any
      // stale x/y from the previous kind is dropped to keep the payload clean.
      next.nodes = next.nodes.map((node) => {
        const stripped = { ...node };
        delete stripped.x;
        delete stripped.y;
        return stripped;
      });
      break;
  }

  // If auto-layout is enabled, re-flow after the kind switch.
  if (next.autoLayout) {
    return applyElasticLayout(next);
  }

  return next;
}

/**
 * Sets the aspect-ratio export preset on a visual. Use `"auto"` (or omit the
 * field) to let the natural canvas dimensions drive the export size.
 */
export function setAspectRatio(
  visual: Visual,
  preset: AspectRatioPreset,
): Visual {
  const next = cloneVisual(visual);
  if (preset === "auto") {
    delete next.aspectRatio;
  } else {
    next.aspectRatio = preset;
  }
  return next;
}

/**
 * Sets the canvas background style. `"blank"` (default) renders a solid fill;
 * `"ruled"` adds horizontal guide lines; `"dot-grid"` adds a dot-matrix grid.
 */
export function setCanvasStyle(visual: Visual, style: CanvasStyle): Visual {
  const next = cloneVisual(visual);
  if (style === "blank") {
    delete next.canvasStyle;
  } else {
    next.canvasStyle = style;
  }
  return next;
}

/**
 * Merges a newly-generated {@link Visual} into an existing one, preserving
 * all manual style customizations while replacing the content.
 *
 * Strategy:
 * - **Content** (nodes, edges, title, type, dimensions) comes from `newVisual`.
 * - **Global style** (palette, colors, fonts) comes from `oldVisual`, so the
 *   user's chosen theme/colors survive the sync.
 * - **Per-node style overrides** (color, stroke, textColor, icon, fillStyle,
 *   borderStyle, borderWidth, textAlign) are re-applied from `oldVisual` nodes
 *   onto matching `newVisual` nodes. Matching is attempted first by label
 *   (case-insensitive trim), then by position index. No override is invented
 *   for unmatched new nodes.
 *
 * Pure, non-mutating, schema-valid output. `sourceText`/`sourceTextHash` on
 * the result are **not** set here — the caller is responsible for stamping the
 * new sync metadata after calling this function.
 */
export function mergeVisualContent(
  oldVisual: Visual,
  newVisual: Visual,
): Visual {
  const next = cloneVisual(newVisual);

  // Preserve global style from old visual (theme, colors, typography).
  next.style = cloneStyle(oldVisual.style);

  // Build a label → old-node map (first occurrence per normalized label wins).
  const byLabel = new Map<string, VisualNode>();
  for (const node of oldVisual.nodes) {
    const key = node.label.toLowerCase().trim();
    if (!byLabel.has(key)) {
      byLabel.set(key, node);
    }
  }

  // Re-apply per-node style overrides onto new nodes.
  next.nodes = next.nodes.map((newNode, index) => {
    const labelKey = newNode.label.toLowerCase().trim();
    const oldNode: VisualNode | null =
      byLabel.get(labelKey) ?? oldVisual.nodes[index] ?? null;
    if (oldNode === null) {
      return newNode;
    }
    const merged: VisualNode = { ...newNode };
    // Apply only overrides explicitly set on the matched old node.
    if (oldNode.color !== undefined) merged.color = oldNode.color;
    if (oldNode.stroke !== undefined) merged.stroke = oldNode.stroke;
    if (oldNode.textColor !== undefined) merged.textColor = oldNode.textColor;
    if (oldNode.icon !== undefined) merged.icon = oldNode.icon;
    if (oldNode.fillStyle !== undefined) merged.fillStyle = oldNode.fillStyle;
    if (oldNode.borderStyle !== undefined)
      merged.borderStyle = oldNode.borderStyle;
    if (oldNode.borderWidth !== undefined)
      merged.borderWidth = oldNode.borderWidth;
    if (oldNode.textAlign !== undefined) merged.textAlign = oldNode.textAlign;
    if (oldNode.fontFamily !== undefined)
      merged.fontFamily = oldNode.fontFamily;
    return merged;
  });

  // Drop sourceText/sourceTextHash — caller stamps the refreshed values.
  delete next.sourceText;
  delete next.sourceTextHash;

  return next;
}

/**
 * Returns `true` when the visual's stored source text differs from
 * `currentText`, indicating the visual may be out of date with its anchor
 * block. Returns `false` when either value is absent/empty or when they match
 * (after trimming).
 */
export function isSourceStale(visual: Visual, currentText: string): boolean {
  const stored = visual.sourceText?.trim();
  const current = currentText.trim();
  if (!stored || !current) {
    return false;
  }
  return stored !== current;
}

/**
 * Enables or disables the elastic auto-layout flag on a visual. When `enabled`
 * is `true`, immediately runs an elastic layout pass so the canvas grows to fit
 * the current content. When `false`, the flag is cleared (falling back to
 * manual positioning).
 *
 * Pure, non-mutating, schema-valid output.
 */
export function setAutoLayout(visual: Visual, enabled: boolean): Visual {
  const next = cloneVisual(visual);
  if (!enabled) {
    delete next.autoLayout;
    return next;
  }
  next.autoLayout = true;
  return applyElasticLayout(next);
}

/**
 * Applies the elastic layout pass to a visual that has `autoLayout: true`,
 * re-sizing nodes to their labels and growing the canvas to fit all content.
 * If the visual is not a positioned kind or `autoLayout` is not set, returns
 * an unchanged clone. Safe to call unconditionally — non-positioned kinds and
 * manuals are no-ops.
 *
 * Pure, non-mutating, schema-valid output.
 */
export function applyElasticLayout(visual: Visual): Visual {
  if (!visual.autoLayout) {
    return cloneVisual(visual);
  }
  const result = elasticLayout(visual);
  const next = cloneVisual(visual);
  next.nodes = result.nodes.map((n) => ({ ...n }));
  next.width = result.width;
  next.height = result.height;
  return next;
}

/**
 * Sets (or replaces) a single visual effect on a visual. If an effect with
 * the same `kind` is already present, it is replaced in-place; otherwise the
 * new effect is appended. Returns a new `Visual` — the input is never mutated.
 *
 * Pure, non-mutating, schema-valid output.
 */
export function setEffect(visual: Visual, effect: VisualEffect): Visual {
  const next = cloneVisual(visual);
  const existing: VisualEffect[] = next.effects ?? [];
  const idx = existing.findIndex((e) => e.kind === effect.kind);
  if (idx >= 0) {
    next.effects = [
      ...existing.slice(0, idx),
      { ...effect },
      ...existing.slice(idx + 1),
    ];
  } else {
    next.effects = [...existing, { ...effect }];
  }
  return next;
}

/**
 * Removes a single visual effect by its `kind`. Returns an unchanged clone
 * when no effect of that kind exists. When the effects list becomes empty
 * after the removal, the `effects` field is omitted from the result (keeping
 * the payload minimal and equal to a fresh default visual).
 *
 * Pure, non-mutating, schema-valid output.
 */
export function clearEffect(visual: Visual, kind: EffectKind): Visual {
  const next = cloneVisual(visual);
  if (!next.effects || next.effects.length === 0) {
    return next;
  }
  const filtered = next.effects.filter((e) => e.kind !== kind);
  if (filtered.length > 0) {
    next.effects = filtered;
  } else {
    delete next.effects;
  }
  return next;
}
