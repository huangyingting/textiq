import type { LayoutBox, SlideChildNode } from "@/lib/presentation/schema";
import {
  findNodeById,
  flattenNodeTree,
  parentGroupIdForNode,
} from "@/lib/presentation/node-tree-ops";

export { findNodeById, parentGroupIdForNode };

export function flattenEditorNodes(
  nodes: readonly SlideChildNode[],
): SlideChildNode[] {
  return flattenNodeTree(nodes);
}

export function nodesInReadingOrder(
  nodes: readonly SlideChildNode[],
): SlideChildNode[] {
  return flattenEditorNodes(nodes)
    .filter((node) => node.layout !== undefined && node.hidden !== true)
    .sort((a, b) => {
      const readingA = a.accessibility?.readingOrder;
      const readingB = b.accessibility?.readingOrder;
      if (readingA !== undefined || readingB !== undefined) {
        return (
          (readingA ?? Number.MAX_SAFE_INTEGER) -
          (readingB ?? Number.MAX_SAFE_INTEGER)
        );
      }
      const frameA = a.layout?.frame;
      const frameB = b.layout?.frame;
      if (!frameA || !frameB) return 0;
      return frameA.y === frameB.y ? frameA.x - frameB.x : frameA.y - frameB.y;
    });
}

export function inlineEditableNodes(
  nodes: readonly SlideChildNode[],
): SlideChildNode[] {
  return nodesInReadingOrder(nodes).filter((node) => node.type === "text");
}

export function adjacentNodeId(
  nodes: readonly SlideChildNode[],
  currentId: string | undefined,
  direction: 1 | -1,
): string | undefined {
  const ordered = nodesInReadingOrder(nodes);
  if (ordered.length === 0) return undefined;
  const currentIndex = currentId
    ? ordered.findIndex((node) => node.id === currentId)
    : -1;
  const nextIndex =
    currentIndex === -1
      ? direction === 1
        ? 0
        : ordered.length - 1
      : (currentIndex + direction + ordered.length) % ordered.length;
  return ordered[nextIndex]?.id;
}

export function adjacentInlineEditableNodeId(
  nodes: readonly SlideChildNode[],
  currentId: string,
  direction: 1 | -1,
): string | undefined {
  const ordered = inlineEditableNodes(nodes);
  if (ordered.length === 0) return undefined;
  const currentIndex = ordered.findIndex((node) => node.id === currentId);
  const nextIndex =
    currentIndex === -1
      ? direction === 1
        ? 0
        : ordered.length - 1
      : (currentIndex + direction + ordered.length) % ordered.length;
  return ordered[nextIndex]?.id;
}

export function childIdsForGroup(
  nodes: readonly SlideChildNode[],
  groupId: string,
): string[] {
  const group = findNodeById(nodes, groupId);
  if (!group || group.type !== "group") return [];
  return flattenNodeTree(group.children).map((node) => node.id);
}

export function layoutFramesExcluding(
  nodes: readonly SlideChildNode[],
  excludedIds: ReadonlySet<string>,
): LayoutBox["frame"][] {
  return nodes.flatMap((node) => {
    const children =
      node.type === "group"
        ? layoutFramesExcluding(node.children, excludedIds)
        : [];
    if (excludedIds.has(node.id) || !node.layout) return children;
    return [node.layout.frame, ...children];
  });
}
