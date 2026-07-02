import type { DeckAssetRegistry } from "@/lib/presentation-vnext/schema";
import type {
  ResolvedDeckRenderTree,
  ResolvedRenderNode,
  ResolvedSlideRenderTree,
} from "@/lib/presentation-vnext/render-tree";
import { getSlideRenderLists } from "@/lib/presentation-vnext/render-tree";
import {
  narrateNode,
  type DeckOutlineNodeRole,
} from "@/lib/presentation-vnext/a11y/node-narration";

export type DeckOutlineNode = {
  id: string;
  role: DeckOutlineNodeRole;
  label: string;
};

export type SlideOutline = {
  id: string;
  index: number;
  position: number;
  title: string;
  summary: string;
  nodes: DeckOutlineNode[];
};

export type DeckOutline = {
  slides: SlideOutline[];
};

export type BuildDeckOutlineOptions = {
  assets?: DeckAssetRegistry;
};

function compareReadingOrder(
  left: ResolvedRenderNode,
  right: ResolvedRenderNode,
): number {
  const leftOrder = left.accessibility?.readingOrder;
  const rightOrder = right.accessibility?.readingOrder;
  const hasLeftOrder = Number.isFinite(leftOrder);
  const hasRightOrder = Number.isFinite(rightOrder);
  if (hasLeftOrder && hasRightOrder) {
    return Number(leftOrder) - Number(rightOrder);
  }
  if (hasLeftOrder) return -1;
  if (hasRightOrder) return 1;
  return 0;
}

function outlineNodesForSlide(
  slide: ResolvedSlideRenderTree,
  options: BuildDeckOutlineOptions,
): DeckOutlineNode[] {
  const orderedNodes = [...getSlideRenderLists(slide).userNodes].sort(
    compareReadingOrder,
  );
  return orderedNodes
    .map((node) => narrateNode(node, { assets: options.assets }))
    .filter((node) => !node.decorative)
    .map(({ id, label, role }) => ({ id, role, label }));
}

function slideTitle(
  position: number,
  nodes: readonly DeckOutlineNode[],
): string {
  const titleNode = nodes.find((node) => node.label.startsWith("Title: "));
  if (titleNode) {
    return titleNode.label.slice("Title: ".length);
  }
  return `Slide ${position}`;
}

function slideSummary(nodes: readonly DeckOutlineNode[]): string {
  if (nodes.length === 0) return "Empty slide";
  const counts = new Map<DeckOutlineNodeRole, number>();
  for (const node of nodes) {
    counts.set(node.role, (counts.get(node.role) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([role, count]) => `${count} ${role}${count === 1 ? "" : "s"}`)
    .join(", ");
}

export function buildDeckOutline(
  deck: ResolvedDeckRenderTree,
  options: BuildDeckOutlineOptions = {},
): DeckOutline {
  return {
    slides: deck.slides.map((slide, index) => {
      const position = index + 1;
      const nodes = outlineNodesForSlide(slide, options);
      return {
        id: slide.id,
        index,
        position,
        title: slideTitle(position, nodes),
        summary: slideSummary(nodes),
        nodes,
      };
    }),
  };
}
