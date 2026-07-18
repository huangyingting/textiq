/**
 * Resolved render tree for the presentation system.
 *
 * All consumers (canvas, present mode, public render, image export, PPTX
 * export) share this one resolved tree. Token refs are resolved to concrete
 * values before reaching any adapter.
 */

import type { NodeId, CanvasSpec } from "./types";
import type { StyleObject, FillStyle } from "./style-schema";
import type {
  AccessibilityMetadata,
  SemanticRole,
  SlideChildNode,
  TextContent,
  ImageContent,
  ShapeContent,
  ConnectorContent,
  TableContent,
  VisualContent,
  LayoutBox,
  DeckChromeKind,
} from "./schema";
import type { ResolvedTheme } from "./style-resolver";
import type { PresentationDiagnostic } from "./diagnostics";
import {
  effectiveVisualZIndex,
  flattenNodesInRenderOrder,
} from "./render-order";

// ---------------------------------------------------------------------------
// Resolved layout
// ---------------------------------------------------------------------------

export type ResolvedLayoutBox = LayoutBox & {
  framePx?: { x: number; y: number; w: number; h: number };
};

// ---------------------------------------------------------------------------
// Resolved content (mirrors node content shapes but fully resolved)
// ---------------------------------------------------------------------------

export type ResolvedNodeContent =
  | { type: "text"; content: TextContent }
  | { type: "image"; content: ImageContent }
  | { type: "shape"; content: ShapeContent }
  | { type: "connector"; content: ConnectorContent }
  | { type: "table"; content: TableContent }
  | { type: "visual"; content: VisualContent }
  | { type: "group" };

// ---------------------------------------------------------------------------
// Resolved render node
// ---------------------------------------------------------------------------

export type ResolvedRenderNode = {
  id: NodeId;
  type: SlideChildNode["type"] | "group";
  role?: SemanticRole;
  layout: ResolvedLayoutBox;
  style: StyleObject;
  content: ResolvedNodeContent;
  children?: ResolvedRenderNode[];
  source: "user" | "themeDecoration" | "deckChrome";
  chromeKind?: DeckChromeKind;
  locked?: boolean;
  name?: string;
  accessibility?: AccessibilityMetadata;
};

// ---------------------------------------------------------------------------
// Slide background
// ---------------------------------------------------------------------------

export type ResolvedSlideBackground = {
  fill: FillStyle | undefined;
  decorationLevel: "none" | "subtle" | "default" | "expressive";
};

export type ResolvedSlideRenderLists = {
  decorations: ResolvedRenderNode[];
  backgroundChrome: ResolvedRenderNode[];
  foregroundChrome: ResolvedRenderNode[];
  userNodes: ResolvedRenderNode[];
};

// ---------------------------------------------------------------------------
// Resolved slide render tree
// ---------------------------------------------------------------------------

export type ResolvedSlideRenderTree = {
  id: NodeId;
  background: ResolvedSlideBackground;
  decorations: ResolvedRenderNode[];
  chrome: ResolvedRenderNode[];
  nodes: ResolvedRenderNode[];
  renderLists?: ResolvedSlideRenderLists;
  notes?: string;
};

// ---------------------------------------------------------------------------
// Full deck render tree
// ---------------------------------------------------------------------------

export type ResolvedDeckRenderTree = {
  canvas: CanvasSpec;
  theme: ResolvedTheme;
  slides: ResolvedSlideRenderTree[];
  diagnostics: PresentationDiagnostic[];
};

function flattenRenderNodes(
  nodes: readonly ResolvedRenderNode[],
): ResolvedRenderNode[] {
  return flattenNodesInRenderOrder(nodes, (node) => node.children, {
    mode: "visual",
  });
}

export function buildSlideRenderLists(slide: {
  decorations: readonly ResolvedRenderNode[];
  chrome: readonly ResolvedRenderNode[];
  nodes: readonly ResolvedRenderNode[];
}): ResolvedSlideRenderLists {
  const decorations = flattenRenderNodes(slide.decorations);
  const backgroundChrome = flattenRenderNodes(
    slide.chrome.filter((node) => effectiveVisualZIndex(node) < 0),
  );
  const foregroundChrome = flattenRenderNodes(
    slide.chrome.filter((node) => effectiveVisualZIndex(node) >= 0),
  );
  const userNodes = flattenRenderNodes(slide.nodes);

  return {
    decorations,
    backgroundChrome,
    foregroundChrome,
    userNodes,
  };
}

const slideRenderListCache = new WeakMap<
  ResolvedSlideRenderTree,
  ResolvedSlideRenderLists
>();

export function getSlideRenderLists(
  slide: ResolvedSlideRenderTree,
): ResolvedSlideRenderLists {
  if (slide.renderLists) {
    return slide.renderLists;
  }
  const cached = slideRenderListCache.get(slide);
  if (cached) {
    return cached;
  }
  const computed = buildSlideRenderLists(slide);
  slideRenderListCache.set(slide, computed);
  return computed;
}
