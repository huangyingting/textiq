/**
 * Editor commands for the presentation system.
 *
 * Commands are immutable: each handler receives a `Deck` and returns a new
 * `Deck`. No resolved styles are written into nodes.
 *
 * Commands reference slides and nodes by stable ids.
 */

import type {
  ConnectorEndpoint,
  Deck,
  ImageContent,
  SlideNode,
  SlideChildNode,
  SemanticRole,
  NodeSourceMetadata,
  LayoutBox,
  ShapeContent,
  StyleBinding,
  SlideControls,
  DeckChromeConfig,
  DeckChromeKind,
  TextContent,
} from "./schema";
import type { StylePatch } from "./style-schema";
import type { ResolvedRenderNode } from "./render-tree";
import type { SemanticSlideSpecV1 } from "./semantic-deck-plan";
import type { SemanticTemplateV1 } from "./template-registry";
import { compileSlide } from "./template-compiler";
import { connectorEndpointToPointFallback } from "./connector-geometry";
import { mergeStylePatchDeep } from "./style-patch-merge";

export const MIN_DECK_SLIDES_MESSAGE = "A deck must keep at least one slide.";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapSlides(deck: Deck, fn: (slide: SlideNode) => SlideNode): Deck {
  return { ...deck, slides: deck.slides.map(fn) };
}

function mapChildren(
  slide: SlideNode,
  nodeId: string,
  fn: (node: SlideChildNode) => SlideChildNode,
): SlideNode {
  return {
    ...slide,
    children: slide.children.map((c) => mapNodeById(c, nodeId, fn)),
  };
}

function mapNodeById(
  node: SlideChildNode,
  targetId: string,
  fn: (n: SlideChildNode) => SlideChildNode,
): SlideChildNode {
  if (node.id === targetId) return fn(node);
  if (node.type === "group") {
    return {
      ...node,
      children: node.children.map((c) => mapNodeById(c, targetId, fn)),
    };
  }
  return node;
}

type ContentNode = Extract<SlideChildNode, { content: unknown }>;

function hasContent(node: SlideChildNode): node is ContentNode {
  return "content" in node;
}

function mergeNodeContent<TNode extends ContentNode>(
  node: TNode,
  contentPatch: Record<string, unknown>,
): TNode {
  return {
    ...node,
    content: {
      ...node.content,
      ...contentPatch,
    },
  };
}

function removeNodesById(
  nodes: SlideChildNode[],
  ids: Set<string>,
): SlideChildNode[] {
  const result: SlideChildNode[] = [];
  for (const node of nodes) {
    if (ids.has(node.id)) continue;
    if (node.type === "group") {
      const children = removeNodesById(node.children, ids);
      if (children.length > 0) {
        result.push({ ...node, children });
      }
      continue;
    }
    result.push(node);
  }
  return result;
}

function collectNodesById(
  nodes: SlideChildNode[],
  ids: Set<string>,
): SlideChildNode[] {
  const result: SlideChildNode[] = [];
  for (const node of nodes) {
    if (ids.has(node.id)) result.push(node);
    if (node.type === "group") {
      result.push(...collectNodesById(node.children, ids));
    }
  }
  return result;
}

function findNodeById(
  nodes: readonly SlideChildNode[],
  id: string,
): SlideChildNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.type === "group") {
      const found = findNodeById(node.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

function collectNodeIds(nodes: SlideChildNode[], ids: Set<string>): void {
  for (const node of nodes) {
    ids.add(node.id);
    if (node.type === "group") collectNodeIds(node.children, ids);
  }
}

function collectDescendantIds(node: SlideChildNode, ids: Set<string>): void {
  ids.add(node.id);
  if (node.type === "group") {
    for (const child of node.children) collectDescendantIds(child, ids);
  }
}

function expandNodeIds(
  nodes: readonly SlideChildNode[],
  selectedIds: ReadonlySet<string>,
): Set<string> {
  const expanded = new Set(selectedIds);
  for (const id of selectedIds) {
    const node = findNodeById(nodes, id);
    if (node) collectDescendantIds(node, expanded);
  }
  return expanded;
}

function topLevelSelectedNodeIds(
  nodes: readonly SlideChildNode[],
  selectedIds: ReadonlySet<string>,
  insideSelectedGroup = false,
  result: string[] = [],
): string[] {
  for (const node of nodes) {
    const selected = selectedIds.has(node.id);
    if (selected && !insideSelectedGroup) result.push(node.id);
    if (node.type === "group") {
      topLevelSelectedNodeIds(
        node.children,
        selectedIds,
        insideSelectedGroup || selected,
        result,
      );
    }
  }
  return result;
}

function findParentPathById(
  nodes: readonly SlideChildNode[],
  id: string,
  parentPath: string[] = [],
): string[] | null {
  for (const node of nodes) {
    if (node.id === id) return parentPath;
    if (node.type === "group") {
      const found = findParentPathById(node.children, id, [
        ...parentPath,
        node.id,
      ]);
      if (found) return found;
    }
  }
  return null;
}

function commonAncestorPath(paths: readonly string[][]): string[] {
  if (paths.length === 0) return [];
  let length = paths[0]!.length;
  for (const path of paths.slice(1)) {
    let nextLength = 0;
    while (
      nextLength < length &&
      nextLength < path.length &&
      paths[0]![nextLength] === path[nextLength]
    ) {
      nextLength += 1;
    }
    length = nextLength;
    if (length === 0) break;
  }
  return paths[0]!.slice(0, length);
}

function extractSelectedNodesForGrouping(
  nodes: readonly SlideChildNode[],
  selectedIds: ReadonlySet<string>,
  keepGroupIds: ReadonlySet<string>,
): { nodes: SlideChildNode[]; selected: SlideChildNode[] } {
  const remaining: SlideChildNode[] = [];
  const selected: SlideChildNode[] = [];
  for (const node of nodes) {
    if (selectedIds.has(node.id)) {
      selected.push(node);
      continue;
    }
    if (node.type === "group") {
      const extracted = extractSelectedNodesForGrouping(
        node.children,
        selectedIds,
        keepGroupIds,
      );
      selected.push(...extracted.selected);
      if (extracted.nodes.length > 0 || keepGroupIds.has(node.id)) {
        remaining.push({
          ...node,
          children: extracted.nodes,
        });
      }
      continue;
    }
    remaining.push(node);
  }
  return { nodes: remaining, selected };
}

function appendNodeAtPath(
  nodes: readonly SlideChildNode[],
  parentPath: readonly string[],
  node: SlideChildNode,
): SlideChildNode[] {
  if (parentPath.length === 0) return [...nodes, node];
  const [head, ...tail] = parentPath;
  return nodes.map((candidate) =>
    candidate.type === "group" && candidate.id === head
      ? {
          ...candidate,
          children: appendNodeAtPath(candidate.children, tail, node),
        }
      : candidate,
  );
}

function translateNodeTree(
  node: SlideChildNode,
  delta: { x: number; y: number },
): SlideChildNode {
  const layout = node.layout
    ? {
        ...node.layout,
        frame: {
          ...node.layout.frame,
          x: node.layout.frame.x + delta.x,
          y: node.layout.frame.y + delta.y,
        },
      }
    : node.layout;
  if (node.type === "group") {
    return {
      ...node,
      ...(layout ? { layout } : {}),
      children: node.children.map((child) => translateNodeTree(child, delta)),
    };
  }
  if (!layout) return node;
  return { ...node, layout } as SlideChildNode;
}

function duplicateNodeWithIds(
  node: SlideChildNode,
  nextId: (sourceId: string) => string,
): SlideChildNode {
  const id = nextId(node.id);
  const layout = node.layout
    ? {
        ...node.layout,
        frame: {
          ...node.layout.frame,
          x: Math.min(99, node.layout.frame.x + 2),
          y: Math.min(99, node.layout.frame.y + 2),
        },
        zIndex: node.layout.zIndex + 1,
      }
    : node.layout;
  if (node.type === "group") {
    return {
      ...node,
      id,
      layout,
      children: node.children.map((child) =>
        duplicateNodeWithIds(child, nextId),
      ),
    };
  }
  return { ...node, id, layout } as SlideChildNode;
}

function uniqueDuplicateId(existingIds: Set<string>, sourceId: string): string {
  const base = `${sourceId}-copy`;
  let candidate = base;
  let suffix = 2;
  while (existingIds.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  existingIds.add(candidate);
  return candidate;
}

function existingDeckIds(deck: Deck): Set<string> {
  const ids = new Set<string>();
  for (const slide of deck.slides) {
    ids.add(slide.id);
    collectNodeIds(slide.children, ids);
  }
  return ids;
}

function uniqueId(existingIds: Set<string>, sourceId: string): string {
  if (!existingIds.has(sourceId)) {
    existingIds.add(sourceId);
    return sourceId;
  }
  return uniqueDuplicateId(existingIds, sourceId);
}

function reidentifyNodeIfNeeded(
  node: SlideChildNode,
  existingIds: Set<string>,
): SlideChildNode {
  const id = uniqueId(existingIds, node.id);
  if (node.type === "group") {
    return {
      ...node,
      id,
      children: node.children.map((child) =>
        reidentifyNodeIfNeeded(child, existingIds),
      ),
    };
  }
  return { ...node, id } as SlideChildNode;
}

function reidentifySlideIfNeeded(
  slide: SlideNode,
  existingIds: Set<string>,
): SlideNode {
  return {
    ...slide,
    id: uniqueId(existingIds, slide.id),
    children: slide.children.map((child) =>
      reidentifyNodeIfNeeded(child, existingIds),
    ),
  };
}

function collectSlotMatches(
  nodes: readonly SlideChildNode[],
  matches: Map<string, SlideChildNode[]> = new Map(),
): Map<string, SlideChildNode[]> {
  for (const node of nodes) {
    if (node.slot) {
      const current = matches.get(node.slot) ?? [];
      current.push(node);
      matches.set(node.slot, current);
    }
    if (node.type === "group") collectSlotMatches(node.children, matches);
  }
  return matches;
}

function compatibleSlotNode(
  fresh: SlideChildNode,
  existing: SlideChildNode,
): boolean {
  return fresh.type === existing.type;
}

function preserveCommonNodeAuthoringState<T extends SlideChildNode>(
  fresh: T,
  existing: SlideChildNode,
): T {
  const merged = { ...fresh, id: existing.id } as T;
  if (existing.name !== undefined) merged.name = existing.name;
  if (existing.source !== undefined) merged.source = existing.source;
  if (existing.localStyle !== undefined)
    merged.localStyle = existing.localStyle;
  if (existing.locked !== undefined) merged.locked = existing.locked;
  if (existing.hidden !== undefined) merged.hidden = existing.hidden;
  if (existing.accessibility !== undefined) {
    merged.accessibility = existing.accessibility;
  }
  return merged;
}

function preserveSlotNodeContent(
  fresh: SlideChildNode,
  existing: SlideChildNode,
): SlideChildNode {
  if (!compatibleSlotNode(fresh, existing)) return fresh;
  if (fresh.type === "text" && existing.type === "text") {
    return {
      ...preserveCommonNodeAuthoringState(fresh, existing),
      content: existing.content,
    };
  }
  if (fresh.type === "image" && existing.type === "image") {
    return {
      ...preserveCommonNodeAuthoringState(fresh, existing),
      content: existing.content,
    };
  }
  if (fresh.type === "shape" && existing.type === "shape") {
    return {
      ...preserveCommonNodeAuthoringState(fresh, existing),
      content: existing.content,
    };
  }
  if (fresh.type === "connector" && existing.type === "connector") {
    return {
      ...preserveCommonNodeAuthoringState(fresh, existing),
      content: existing.content,
    };
  }
  if (fresh.type === "table" && existing.type === "table") {
    return {
      ...preserveCommonNodeAuthoringState(fresh, existing),
      content: existing.content,
    };
  }
  if (fresh.type === "visual" && existing.type === "visual") {
    return {
      ...preserveCommonNodeAuthoringState(fresh, existing),
      content: existing.content,
    };
  }
  if (fresh.type === "group" && existing.type === "group") {
    return {
      ...preserveCommonNodeAuthoringState(fresh, existing),
      children: existing.children,
    };
  }
  return fresh;
}

function preserveCompatibleSlotNode(
  fresh: SlideChildNode,
  matches: ReadonlyMap<string, readonly SlideChildNode[]>,
  usedMatchIds: Set<string>,
): SlideChildNode {
  const slotMatches = fresh.slot ? matches.get(fresh.slot) : undefined;
  const existing = slotMatches?.find(
    (candidate) =>
      !usedMatchIds.has(candidate.id) && compatibleSlotNode(fresh, candidate),
  );
  if (existing) {
    usedMatchIds.add(existing.id);
    return preserveSlotNodeContent(fresh, existing);
  }
  if (fresh.type === "group") {
    return {
      ...fresh,
      children: fresh.children.map((child) =>
        preserveCompatibleSlotNode(child, matches, usedMatchIds),
      ),
    };
  }
  return fresh;
}

function duplicateSelectedInChildren(
  nodes: readonly SlideChildNode[],
  ids: ReadonlySet<string>,
  nextId: (sourceId: string) => string,
  duplicatedIds: string[],
): SlideChildNode[] {
  const result: SlideChildNode[] = [];
  for (const node of nodes) {
    if (ids.has(node.id)) {
      result.push(node);
      const duplicate = duplicateNodeWithIds(node, (sourceId) => {
        const id = nextId(sourceId);
        duplicatedIds.push(id);
        return id;
      });
      result.push(duplicate);
      continue;
    }
    if (node.type === "group") {
      result.push({
        ...node,
        children: duplicateSelectedInChildren(
          node.children,
          ids,
          nextId,
          duplicatedIds,
        ),
      });
      continue;
    }
    result.push(node);
  }
  return result;
}

function connectorEndpointToPoint(
  endpoint: ConnectorEndpoint,
  connector: SlideChildNode,
  slide: SlideNode,
): ConnectorEndpoint {
  return connectorEndpointToPointFallback(
    endpoint,
    connector.layout?.frame,
    (nodeId) => findNodeById(slide.children, nodeId)?.layout?.frame,
  );
}

function repairConnectorBindingsBeforeDelete(
  nodes: readonly SlideChildNode[],
  slide: SlideNode,
  deletedIds: ReadonlySet<string>,
): SlideChildNode[] {
  return nodes.map((node) => {
    if (node.type === "group") {
      return {
        ...node,
        children: repairConnectorBindingsBeforeDelete(
          node.children,
          slide,
          deletedIds,
        ),
      };
    }
    if (node.type !== "connector") return node;
    const nextFrom =
      node.content.from.kind === "node" &&
      deletedIds.has(node.content.from.nodeId)
        ? connectorEndpointToPoint(node.content.from, node, slide)
        : node.content.from;
    const nextTo =
      node.content.to.kind === "node" && deletedIds.has(node.content.to.nodeId)
        ? connectorEndpointToPoint(node.content.to, node, slide)
        : node.content.to;
    if (nextFrom === node.content.from && nextTo === node.content.to) {
      return node;
    }
    return {
      ...node,
      content: {
        ...node.content,
        from: nextFrom,
        to: nextTo,
      },
    };
  });
}

function normalizeRotation(rotation: number): number {
  if (!Number.isFinite(rotation)) return 0;
  const normalized = ((rotation % 360) + 360) % 360;
  return Math.round(normalized * 10) / 10;
}

function reidentifyNode(
  node: SlideChildNode,
  existingIds: Set<string>,
  offset: { x: number; y: number } = { x: 0, y: 0 },
): SlideChildNode {
  const id = uniqueDuplicateId(existingIds, node.id);
  const layout = node.layout
    ? {
        ...node.layout,
        frame: {
          ...node.layout.frame,
          x: Math.min(99, node.layout.frame.x + offset.x),
          y: Math.min(99, node.layout.frame.y + offset.y),
        },
      }
    : node.layout;
  if (node.type === "group") {
    return {
      ...node,
      id,
      layout,
      children: node.children.map((child) =>
        reidentifyNode(child, existingIds, offset),
      ),
    };
  }
  return { ...node, id, layout } as SlideChildNode;
}

// ---------------------------------------------------------------------------
// Insert slide
// ---------------------------------------------------------------------------

/**
 * Inserts a new slide compiled from a semantic template spec at the given
 * position (defaults to the end).
 */
export function insertSlide(
  deck: Deck,
  spec: SemanticSlideSpecV1,
  template: SemanticTemplateV1,
  atIndex?: number,
): Deck {
  return insertTemplateSlide(deck, spec, template, atIndex).deck;
}

export function insertTemplateSlide(
  deck: Deck,
  spec: SemanticSlideSpecV1,
  template: SemanticTemplateV1,
  atIndex?: number,
): { deck: Deck; slideId: string; index: number } {
  const { slide } = compileSlide(spec, template, deck.slides.length);
  const existingIds = existingDeckIds(deck);
  const insertedSlide = reidentifySlideIfNeeded(slide, existingIds);
  const slides = [...deck.slides];
  const index =
    atIndex !== undefined
      ? Math.max(0, Math.min(slides.length, atIndex))
      : slides.length;
  slides.splice(index, 0, insertedSlide);
  return { deck: { ...deck, slides }, slideId: insertedSlide.id, index };
}

export function insertBlankSlide(
  deck: Deck,
  atIndex: number = deck.slides.length,
): { deck: Deck; slideId: string } {
  const existingIds = existingDeckIds(deck);
  const slideId = uniqueDuplicateId(existingIds, "slide");
  const slide: SlideNode = {
    id: slideId,
    type: "slide",
    template: { kind: "content" },
    style: { ref: "slide.content" },
    children: [],
  };
  const slides = [...deck.slides];
  const index = Math.max(0, Math.min(slides.length, atIndex));
  slides.splice(index, 0, slide);
  return { deck: { ...deck, slides }, slideId };
}

export function duplicateSlide(
  deck: Deck,
  slideId: string,
): { deck: Deck; slideId: string; index: number } {
  const slideIndex = deck.slides.findIndex((slide) => slide.id === slideId);
  if (slideIndex === -1) return { deck, slideId, index: -1 };
  const existingIds = existingDeckIds(deck);
  const sourceSlide = deck.slides[slideIndex];
  const nextSlideId = uniqueDuplicateId(existingIds, sourceSlide.id);
  const duplicated: SlideNode = {
    ...sourceSlide,
    id: nextSlideId,
    name: sourceSlide.name ? `${sourceSlide.name} Copy` : undefined,
    children: sourceSlide.children.map((child) =>
      duplicateNodeWithIds(child, (sourceId) =>
        uniqueDuplicateId(existingIds, sourceId),
      ),
    ),
  };
  const slides = [...deck.slides];
  slides.splice(slideIndex + 1, 0, duplicated);
  return {
    deck: { ...deck, slides },
    slideId: nextSlideId,
    index: slideIndex + 1,
  };
}

export function splitNodeToSlide(
  deck: Deck,
  slideId: string,
  nodeId: string,
  atIndex?: number,
): { deck: Deck; slideId: string; nodeId: string; index: number } {
  const sourceIndex = deck.slides.findIndex((slide) => slide.id === slideId);
  if (sourceIndex === -1) return { deck, slideId: "", nodeId, index: -1 };
  const sourceSlide = deck.slides[sourceIndex];
  const sourceNode = collectNodesById(
    sourceSlide.children,
    new Set([nodeId]),
  )[0];
  if (!sourceNode) return { deck, slideId: "", nodeId, index: -1 };

  const inserted = insertBlankSlide(deck, atIndex ?? sourceIndex + 1);
  const nextDeckWithSourceRemoved = deleteNodes(inserted.deck, slideId, [
    nodeId,
  ]);
  const sourceName = sourceSlide.name ?? `Slide ${sourceIndex + 1}`;
  const nextDeck = mapSlides(nextDeckWithSourceRemoved, (slide) =>
    slide.id === inserted.slideId
      ? {
          ...slide,
          name: `${sourceName} Split`,
          children: [sourceNode],
        }
      : slide,
  );
  return {
    deck: nextDeck,
    slideId: inserted.slideId,
    nodeId,
    index: nextDeck.slides.findIndex((slide) => slide.id === inserted.slideId),
  };
}

export function deleteSlide(
  deck: Deck,
  slideId: string,
): { deck: Deck; index: number } {
  if (deck.slides.length <= 1) return { deck, index: 0 };
  const slideIndex = deck.slides.findIndex((slide) => slide.id === slideId);
  if (slideIndex === -1) return { deck, index: 0 };
  const slides = deck.slides.filter((slide) => slide.id !== slideId);
  return {
    deck: { ...deck, slides },
    index: Math.min(slideIndex, slides.length - 1),
  };
}

export function moveSlide(
  deck: Deck,
  slideId: string,
  toIndex: number,
): { deck: Deck; index: number } {
  const fromIndex = deck.slides.findIndex((slide) => slide.id === slideId);
  if (fromIndex === -1) return { deck, index: -1 };
  const slides = [...deck.slides];
  const [slide] = slides.splice(fromIndex, 1);
  const nextIndex = Math.max(0, Math.min(slides.length, toIndex));
  slides.splice(nextIndex, 0, slide);
  return { deck: { ...deck, slides }, index: nextIndex };
}

// ---------------------------------------------------------------------------
// Apply template to existing slide
// ---------------------------------------------------------------------------

/**
 * Reapplies a semantic template to an existing slide, preserving compatible
 * slot content/source metadata and slide-level local authoring state while
 * generating fresh layout/style structure from the template spec.
 */
export function applyTemplate(
  deck: Deck,
  slideId: string,
  spec: SemanticSlideSpecV1,
  template: SemanticTemplateV1,
): Deck {
  const slideIndex = deck.slides.findIndex((s) => s.id === slideId);
  if (slideIndex === -1) return deck;

  const { slide: newSlide } = compileSlide(spec, template, slideIndex);
  const existing = deck.slides[slideIndex];
  const slotMatches = collectSlotMatches(existing.children);
  const usedMatchIds = new Set<string>();
  const merged: SlideNode = {
    ...newSlide,
    id: existing.id,
    children: newSlide.children.map((child) =>
      preserveCompatibleSlotNode(child, slotMatches, usedMatchIds),
    ),
  };
  if (existing.name !== undefined) merged.name = existing.name;
  if (existing.source !== undefined) merged.source = existing.source;
  if (existing.localStyle !== undefined)
    merged.localStyle = existing.localStyle;
  if (existing.props !== undefined) merged.props = existing.props;
  if (newSlide.controls === undefined && existing.controls !== undefined) {
    merged.controls = existing.controls;
  }
  if (newSlide.notes === undefined && existing.notes !== undefined) {
    merged.notes = existing.notes;
  }

  const slides = [...deck.slides];
  slides[slideIndex] = merged;
  return { ...deck, slides };
}

// ---------------------------------------------------------------------------
// Update slide controls
// ---------------------------------------------------------------------------

export function updateSlideControls(
  deck: Deck,
  slideId: string,
  controls: Partial<SlideControls>,
): Deck {
  return mapSlides(deck, (slide) => {
    if (slide.id !== slideId) return slide;
    return {
      ...slide,
      controls: { ...(slide.controls ?? {}), ...controls },
    };
  });
}

export function updateSlideAttributes(
  deck: Deck,
  slideId: string,
  patch: {
    name?: string;
    notes?: string;
    source?: NodeSourceMetadata;
  },
): Deck {
  return mapSlides(deck, (slide) =>
    slide.id === slideId ? { ...slide, ...patch } : slide,
  );
}

export function updateSlideLocalStyle(
  deck: Deck,
  slideId: string,
  patch: StylePatch,
): Deck {
  return mapSlides(deck, (slide) =>
    slide.id === slideId
      ? {
          ...slide,
          localStyle: mergeStylePatchDeep(
            slide.localStyle,
            patch,
          ) as StylePatch,
        }
      : slide,
  );
}

export function resetSlideLocalStyle(deck: Deck, slideId: string): Deck {
  return mapSlides(deck, (slide) => {
    if (slide.id !== slideId || !slide.localStyle) return slide;
    const { localStyle: _localStyle, ...rest } = slide;
    return rest;
  });
}

export function restoreThemeDecoration(deck: Deck, decorationId: string): Deck {
  const disabledDecorations = deck.theme.overrides?.disabledDecorations;
  if (!disabledDecorations?.includes(decorationId)) return deck;
  const nextDisabled = disabledDecorations.filter((id) => id !== decorationId);
  const overrides = { ...(deck.theme.overrides ?? {}) };
  if (nextDisabled.length > 0) {
    overrides.disabledDecorations = nextDisabled;
  } else {
    delete overrides.disabledDecorations;
  }
  const theme =
    Object.keys(overrides).length > 0
      ? { ...deck.theme, overrides }
      : (({ overrides: _overrides, ...rest }) => rest)(deck.theme);
  return { ...deck, theme };
}

export function updateSlideSourceMetadata(
  deck: Deck,
  slideId: string,
  source: NodeSourceMetadata | undefined,
): Deck {
  return mapSlides(deck, (slide) => {
    if (slide.id !== slideId) return slide;
    if (!source) {
      const { source: _source, ...rest } = slide;
      return rest;
    }
    return { ...slide, source };
  });
}

// ---------------------------------------------------------------------------
// Set theme package
// ---------------------------------------------------------------------------

/**
 * Switches the deck theme. Node `layout` and `localStyle` are preserved.
 * Resolved styles are NOT written into nodes.
 */
export function setThemePackage(
  deck: Deck,
  packageId: string,
  packageVersion?: string,
): Deck {
  return {
    ...deck,
    theme: {
      ...deck.theme,
      packageId,
      ...(packageVersion !== undefined ? { packageVersion } : {}),
    },
  };
}

export function updateDeckChrome(
  deck: Deck,
  patch: Partial<DeckChromeConfig>,
): Deck {
  return {
    ...deck,
    chrome: {
      ...(deck.chrome ?? {}),
      ...patch,
    },
  };
}

// ---------------------------------------------------------------------------
// Update node content (type-erased for flexibility — caller supplies typed patch)
// ---------------------------------------------------------------------------

export function updateNodeContent(
  deck: Deck,
  slideId: string,
  nodeId: string,
  contentPatch: Record<string, unknown>,
): Deck {
  return mapSlides(deck, (slide) => {
    if (slide.id !== slideId) return slide;
    return mapChildren(slide, nodeId, (node) =>
      hasContent(node) ? mergeNodeContent(node, contentPatch) : node,
    );
  });
}

export function resetImageCrop(
  deck: Deck,
  slideId: string,
  nodeId: string,
): Deck {
  return mapSlides(deck, (slide) => {
    if (slide.id !== slideId) return slide;
    return mapChildren(slide, nodeId, (node) => {
      if (node.type !== "image") return node;
      const { crop: _crop, ...content } = node.content;
      return { ...node, content };
    });
  });
}

export function insertNode(
  deck: Deck,
  slideId: string,
  node: SlideChildNode,
): { deck: Deck; nodeId: string } {
  const existingIds = existingDeckIds(deck);
  const inserted = existingIds.has(node.id)
    ? reidentifyNode(node, existingIds)
    : node;
  return {
    deck: mapSlides(deck, (slide) =>
      slide.id === slideId
        ? { ...slide, children: [...slide.children, inserted] }
        : slide,
    ),
    nodeId: inserted.id,
  };
}

export function pasteNodes(
  deck: Deck,
  slideId: string,
  nodes: readonly SlideChildNode[],
): { deck: Deck; nodeIds: string[] } {
  if (nodes.length === 0) return { deck, nodeIds: [] };
  const existingIds = existingDeckIds(deck);
  const pasted = nodes.map((node) =>
    reidentifyNode(node, existingIds, { x: 2, y: 2 }),
  );
  return {
    deck: mapSlides(deck, (slide) =>
      slide.id === slideId
        ? { ...slide, children: [...slide.children, ...pasted] }
        : slide,
    ),
    nodeIds: pasted.map((node) => node.id),
  };
}

export function cutNodes(
  deck: Deck,
  slideId: string,
  nodeIds: readonly string[],
): { deck: Deck; nodes: SlideChildNode[] } {
  if (nodeIds.length === 0) return { deck, nodes: [] };
  const slide = deck.slides.find((candidate) => candidate.id === slideId);
  if (!slide) return { deck, nodes: [] };
  const selected = nodeIds
    .map((id) => findNodeById(slide.children, id))
    .filter((node): node is SlideChildNode => node !== undefined);
  if (selected.length === 0) return { deck, nodes: [] };
  return {
    deck: deleteNodes(deck, slideId, nodeIds),
    nodes: selected,
  };
}

// ---------------------------------------------------------------------------
// Update node layout
// ---------------------------------------------------------------------------

export function updateNodeLayout(
  deck: Deck,
  slideId: string,
  nodeId: string,
  layoutPatch: Partial<LayoutBox>,
): Deck {
  return mapSlides(deck, (slide) => {
    if (slide.id !== slideId) return slide;
    return mapChildren(slide, nodeId, (node) => {
      const nextLayout = node.layout
        ? { ...node.layout, ...layoutPatch }
        : (layoutPatch as LayoutBox);
      if (node.type === "group" && node.layout?.frame && layoutPatch.frame) {
        const delta = {
          x: layoutPatch.frame.x - node.layout.frame.x,
          y: layoutPatch.frame.y - node.layout.frame.y,
        };
        if (delta.x !== 0 || delta.y !== 0) {
          return {
            ...node,
            layout: nextLayout,
            children: node.children.map((child) =>
              translateNodeTree(child, delta),
            ),
          };
        }
      }
      return { ...node, layout: nextLayout } as SlideChildNode;
    });
  });
}

export function updateNodeRotation(
  deck: Deck,
  slideId: string,
  nodeId: string,
  rotation: number,
): Deck {
  return updateNodeLayout(deck, slideId, nodeId, {
    rotation: normalizeRotation(rotation),
  });
}

export function updateNodeLayouts(
  deck: Deck,
  slideId: string,
  patches: ReadonlyMap<string, Partial<LayoutBox>>,
): Deck {
  let updated = deck;
  for (const [nodeId, patch] of patches) {
    updated = updateNodeLayout(updated, slideId, nodeId, patch);
  }
  return updated;
}

export function updateNodeAttributes(
  deck: Deck,
  slideId: string,
  nodeId: string,
  patch: {
    name?: string;
    role?: SemanticRole;
    locked?: boolean;
    hidden?: boolean;
  },
): Deck {
  return mapSlides(deck, (slide) => {
    if (slide.id !== slideId) return slide;
    return mapChildren(
      slide,
      nodeId,
      (node) =>
        ({
          ...node,
          ...patch,
        }) as SlideChildNode,
    );
  });
}

export function updateNodeSourceMetadata(
  deck: Deck,
  slideId: string,
  nodeId: string,
  source: NodeSourceMetadata | undefined,
): Deck {
  return mapSlides(deck, (slide) => {
    if (slide.id !== slideId) return slide;
    return mapChildren(slide, nodeId, (node) => {
      if (!source) {
        const { source: _source, ...rest } = node;
        return rest as SlideChildNode;
      }
      return { ...node, source } as SlideChildNode;
    });
  });
}

export function moveNodesBy(
  deck: Deck,
  slideId: string,
  nodeIds: readonly string[],
  delta: { x: number; y: number },
): Deck {
  const patches = new Map<string, Partial<LayoutBox>>();
  const slide = deck.slides.find((candidate) => candidate.id === slideId);
  if (!slide) return deck;
  const selectedIds = new Set(nodeIds);
  const topLevelSelectedIds = topLevelSelectedNodeIds(
    slide.children,
    selectedIds,
  );
  const nodes = collectNodesById(slide.children, new Set(topLevelSelectedIds));
  for (const node of nodes) {
    if (!node.layout || node.locked) continue;
    patches.set(node.id, {
      frame: {
        ...node.layout.frame,
        x: Math.max(
          0,
          Math.min(100 - node.layout.frame.w, node.layout.frame.x + delta.x),
        ),
        y: Math.max(
          0,
          Math.min(100 - node.layout.frame.h, node.layout.frame.y + delta.y),
        ),
      },
    });
  }
  return updateNodeLayouts(deck, slideId, patches);
}

export function deleteNodes(
  deck: Deck,
  slideId: string,
  nodeIds: readonly string[],
): Deck {
  const selectedIds = new Set(nodeIds);
  if (selectedIds.size === 0) return deck;
  return mapSlides(deck, (slide) => {
    if (slide.id !== slideId) return slide;
    const ids = expandNodeIds(slide.children, selectedIds);
    return {
      ...slide,
      children: removeNodesById(
        repairConnectorBindingsBeforeDelete(slide.children, slide, ids),
        ids,
      ),
    };
  });
}

export function duplicateNodes(
  deck: Deck,
  slideId: string,
  nodeIds: readonly string[],
): { deck: Deck; duplicatedIds: string[] } {
  const ids = new Set(nodeIds);
  if (ids.size === 0) return { deck, duplicatedIds: [] };
  const slide = deck.slides.find((candidate) => candidate.id === slideId);
  if (!slide) return { deck, duplicatedIds: [] };
  const existingIds = new Set<string>();
  for (const id of existingDeckIds(deck)) existingIds.add(id);
  const duplicatedIds: string[] = [];
  const children = duplicateSelectedInChildren(
    slide.children,
    ids,
    (sourceId) => uniqueDuplicateId(existingIds, sourceId),
    duplicatedIds,
  );
  if (duplicatedIds.length === 0) return { deck, duplicatedIds };
  return {
    deck: mapSlides(deck, (candidate) =>
      candidate.id === slideId
        ? {
            ...candidate,
            children,
          }
        : candidate,
    ),
    duplicatedIds,
  };
}

// ---------------------------------------------------------------------------
// Update node style binding
// ---------------------------------------------------------------------------

export function updateNodeStyleBinding(
  deck: Deck,
  slideId: string,
  nodeId: string,
  binding: StyleBinding,
): Deck {
  return mapSlides(deck, (slide) => {
    if (slide.id !== slideId) return slide;
    return mapChildren(
      slide,
      nodeId,
      (node) =>
        ({
          ...node,
          style: binding,
        }) as SlideChildNode,
    );
  });
}

// ---------------------------------------------------------------------------
// Update local style override
// ---------------------------------------------------------------------------

export function updateLocalStyle(
  deck: Deck,
  slideId: string,
  nodeId: string,
  patch: StylePatch,
): Deck {
  return mapSlides(deck, (slide) => {
    if (slide.id !== slideId) return slide;
    return mapChildren(
      slide,
      nodeId,
      (node) =>
        ({
          ...node,
          localStyle: mergeStylePatchDeep(node.localStyle, patch) as StylePatch,
        }) as SlideChildNode,
    );
  });
}

// ---------------------------------------------------------------------------
// Reset local style override
// ---------------------------------------------------------------------------

/**
 * Removes specified top-level keys from `node.localStyle`, restoring them to
 * the resolved theme style. Pass no keys to remove all overrides.
 */
export function resetLocalStyleOverride(
  deck: Deck,
  slideId: string,
  nodeId: string,
  keys?: readonly string[],
): Deck {
  return mapSlides(deck, (slide) => {
    if (slide.id !== slideId) return slide;
    return mapChildren(slide, nodeId, (node) => {
      if (!node.localStyle) return node;
      if (!keys || keys.length === 0) {
        const { localStyle: _, ...rest } = node;
        return rest as SlideChildNode;
      }
      const newLocal = { ...node.localStyle };
      for (const k of keys)
        delete (newLocal as Record<string, unknown>)[k as string];
      if (Object.keys(newLocal).length === 0) {
        const { localStyle: _, ...rest } = node;
        return rest as SlideChildNode;
      }
      return { ...node, localStyle: newLocal } as SlideChildNode;
    });
  });
}

// ---------------------------------------------------------------------------
// Detach theme decoration
// ---------------------------------------------------------------------------

type DetachedDecorationContent =
  | { type: "text"; content: TextContent }
  | { type: "image"; content: ImageContent }
  | { type: "shape"; content: ShapeContent };

function decorationRecipeId(decorationId: string): string {
  return decorationId.startsWith("decoration-")
    ? decorationId.slice("decoration-".length)
    : decorationId;
}

function detachedDecorationNode(
  decorationId: string,
  layout: LayoutBox,
  style: StylePatch,
  content?: DetachedDecorationContent,
): SlideChildNode {
  const base = {
    id: `detached-${decorationId}-${Date.now().toString(36)}`,
    role: "themeDecoration" as const,
    layout,
    localStyle: style,
    locked: false,
  };
  if (content?.type === "text") {
    return { ...base, type: "text", content: content.content };
  }
  if (content?.type === "image") {
    return { ...base, type: "image", content: content.content };
  }
  return {
    ...base,
    type: "shape",
    content:
      content?.type === "shape" ? content.content : { shape: "rect" as const },
  };
}

/**
 * Converts a theme decoration render node into an editable `SlideChildNode`
 * appended to the slide children. Detached decorations stop following the theme.
 *
 * Caller must supply the decoration recipe layout and style.
 */
export function detachDecoration(
  deck: Deck,
  slideId: string,
  decorationId: string,
  layout: LayoutBox,
  style: StylePatch,
  content?: DetachedDecorationContent,
): Deck {
  const recipeId = decorationRecipeId(decorationId);
  if (!deck.slides.some((slide) => slide.id === slideId)) return deck;
  const nextDeck = mapSlides(deck, (slide) => {
    if (slide.id !== slideId) return slide;
    return {
      ...slide,
      children: [
        ...slide.children,
        detachedDecorationNode(decorationId, layout, style, content),
      ],
    };
  });
  const disabledDecorations = deck.theme.overrides?.disabledDecorations ?? [];
  if (disabledDecorations.includes(recipeId)) return nextDeck;
  return {
    ...nextDeck,
    theme: {
      ...nextDeck.theme,
      overrides: {
        ...(nextDeck.theme.overrides ?? {}),
        disabledDecorations: [...disabledDecorations, recipeId],
      },
    },
  };
}

function detachedNodeFromResolved(
  node: ResolvedRenderNode,
  id: string,
): SlideChildNode | null {
  const { framePx: _framePx, ...layout } = node.layout;
  const base = {
    id,
    role: node.role,
    layout,
    localStyle: node.style as StylePatch,
    locked: false,
  };
  switch (node.content.type) {
    case "text":
      return {
        ...base,
        type: "text",
        style: { ref: "text.caption" },
        content: node.content.content,
      };
    case "image":
      return {
        ...base,
        type: "image",
        style: { ref: "media.inline" },
        content: node.content.content,
      };
    case "shape": {
      const strokeOnlyChrome =
        node.chromeKind === "border" || node.chromeKind === "safeArea";
      return {
        ...base,
        type: "shape",
        style: { ref: "surface.card" },
        localStyle: strokeOnlyChrome
          ? {
              ...(node.style as StylePatch),
              fill: { type: "solid", color: "transparent" },
              radius: { allPt: 0 },
            }
          : (node.style as StylePatch),
        content: node.content.content,
      };
    }
    default:
      return null;
  }
}

export function detachDeckChrome(
  deck: Deck,
  slideId: string,
  chromeKind: DeckChromeKind,
  node: ResolvedRenderNode,
): Deck {
  const detachedId = `detached-chrome-${chromeKind}-${Date.now().toString(36)}`;
  const detachedNode = detachedNodeFromResolved(node, detachedId);
  if (!detachedNode) return deck;

  return mapSlides(deck, (slide) => {
    if (slide.id !== slideId) return slide;
    return {
      ...slide,
      props: {
        ...(slide.props ?? {}),
        deckChrome: {
          ...(slide.props?.deckChrome ?? {}),
          [chromeKind]: { mode: "detached", nodeId: detachedId },
        },
      },
      children: [...slide.children, detachedNode],
    };
  });
}

// ---------------------------------------------------------------------------
// Group nodes
// ---------------------------------------------------------------------------

/**
 * Groups the specified nodeIds from the slide into a new GroupNode.
 * The frame of the group is the bounding box of the children's frames.
 */
export function groupNodes(
  deck: Deck,
  slideId: string,
  nodeIds: string[],
  groupId: string,
  style: StyleBinding,
): Deck {
  const selectedIds = new Set(nodeIds);
  return mapSlides(deck, (slide) => {
    if (slide.id !== slideId) return slide;
    const groupedIds = topLevelSelectedNodeIds(slide.children, selectedIds);
    if (groupedIds.length === 0) return slide;
    const groupedIdSet = new Set(groupedIds);
    const parentPaths = groupedIds
      .map((id) => findParentPathById(slide.children, id))
      .filter((path): path is string[] => path !== null);
    const insertionPath = commonAncestorPath(parentPaths);
    const keepGroupIds = new Set(insertionPath);
    const extracted = extractSelectedNodesForGrouping(
      slide.children,
      groupedIdSet,
      keepGroupIds,
    );
    const grouped = extracted.selected;
    const remaining = extracted.nodes;

    if (grouped.length === 0) return slide;

    // Compute bounding frame
    const frames = grouped
      .map((n) => n.layout?.frame)
      .filter((f): f is NonNullable<typeof f> => f !== undefined);
    const minX = Math.min(...frames.map((f) => f.x));
    const minY = Math.min(...frames.map((f) => f.y));
    const maxX = Math.max(...frames.map((f) => f.x + f.w));
    const maxY = Math.max(...frames.map((f) => f.y + f.h));
    const maxZIndex = Math.max(...grouped.map((n) => n.layout?.zIndex ?? 0));

    const groupNode: SlideChildNode = {
      id: groupId,
      type: "group",
      component: "custom",
      style,
      layout: {
        frame: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
        zIndex: maxZIndex,
      },
      children: grouped,
    };

    return {
      ...slide,
      children: appendNodeAtPath(remaining, insertionPath, groupNode),
    };
  });
}

export function ungroupNodes(
  deck: Deck,
  slideId: string,
  groupId: string,
): { deck: Deck; nodeIds: string[] } {
  const slide = deck.slides.find((candidate) => candidate.id === slideId);
  const group = slide?.children.find(
    (node): node is Extract<SlideChildNode, { type: "group" }> =>
      node.id === groupId && node.type === "group",
  );
  if (!group) return { deck, nodeIds: [] };
  return {
    deck: mapSlides(deck, (candidate) =>
      candidate.id === slideId
        ? {
            ...candidate,
            children: candidate.children.flatMap((node) =>
              node.id === groupId ? group.children : [node],
            ),
          }
        : candidate,
    ),
    nodeIds: group.children.map((node) => node.id),
  };
}

// ---------------------------------------------------------------------------
// Reorder z-index
// ---------------------------------------------------------------------------

export function reorderZIndex(
  deck: Deck,
  slideId: string,
  nodeId: string,
  zIndex: number,
): Deck {
  return mapSlides(deck, (slide) => {
    if (slide.id !== slideId) return slide;
    return mapChildren(
      slide,
      nodeId,
      (node) =>
        ({
          ...node,
          layout: node.layout
            ? { ...node.layout, zIndex }
            : { frame: { x: 0, y: 0, w: 10, h: 10 }, zIndex },
        }) as SlideChildNode,
    );
  });
}

// ---------------------------------------------------------------------------
// Update asset metadata
// ---------------------------------------------------------------------------

export function updateAssetMetadata(
  deck: Deck,
  assetId: string,
  patch: { alt?: string; contentHash?: string },
): Deck {
  const image = deck.assets.images[assetId];
  if (!image) return deck;
  return {
    ...deck,
    assets: {
      ...deck.assets,
      images: {
        ...deck.assets.images,
        [assetId]: { ...image, ...patch },
      },
    },
  };
}
