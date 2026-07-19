import type { LayoutBox, SlideChildNode } from "@/lib/presentation/schema";
import { orderSiblingsByVisualOrder } from "@/lib/presentation/render-order";

export type ArrangementAlignMode =
  "left" | "center" | "right" | "top" | "middle" | "bottom";
export type ArrangementDistributeMode = "horizontal" | "vertical";
export type ArrangementMatchSizeMode = "width" | "height" | "both";
export type ArrangementZOrderKind = "forward" | "backward" | "front" | "back";

export type SelectedLayoutEntry = {
  id: string;
  node: SlideChildNode;
  frame: LayoutBox["frame"];
};

export type ZOrderSelectionOperation = {
  id: string;
  zIndex: number;
};

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

function siblingListForNode(
  nodes: readonly SlideChildNode[],
  nodeId: string,
): readonly SlideChildNode[] | null {
  if (nodes.some((node) => node.id === nodeId)) return nodes;
  for (const node of nodes) {
    if (node.type !== "group") continue;
    const siblings = siblingListForNode(node.children, nodeId);
    if (siblings) return siblings;
  }
  return null;
}

function sameNodeOrder(
  left: readonly SlideChildNode[],
  right: readonly SlideChildNode[],
): boolean {
  return (
    left.length === right.length &&
    left.every((node, index) => node.id === right[index]?.id)
  );
}

function normalizedSiblingPatches(
  siblings: readonly SlideChildNode[],
): Map<string, Partial<LayoutBox>> {
  const patches = new Map<string, Partial<LayoutBox>>();
  siblings.forEach((node, zIndex) => {
    if (node.layout) patches.set(node.id, { zIndex });
  });
  return patches;
}

export function collectSelectedLayoutEntries(
  nodes: readonly SlideChildNode[],
  selectedIds: readonly string[],
): SelectedLayoutEntry[] {
  return selectedIds
    .map((id) => {
      const node = findNodeById(nodes, id);
      return node?.layout && !node.locked
        ? { id, node, frame: node.layout.frame }
        : null;
    })
    .filter((entry): entry is SelectedLayoutEntry => entry !== null);
}

export function buildLayerReorderPatches(
  nodes: readonly SlideChildNode[],
  nodeId: string,
  targetIndex: number,
): Map<string, Partial<LayoutBox>> {
  const siblings = siblingListForNode(nodes, nodeId);
  if (!siblings) return new Map();
  const ordered = orderSiblingsByVisualOrder(siblings);
  const moving = ordered.find((node) => node.id === nodeId);
  if (!moving?.layout) return new Map();
  const reordered = ordered.filter((node) => node.id !== nodeId);
  const insertIndex = Math.max(0, Math.min(targetIndex, reordered.length));
  reordered.splice(insertIndex, 0, moving);
  return sameNodeOrder(ordered, reordered)
    ? new Map()
    : normalizedSiblingPatches(reordered);
}

export function buildAlignSelectionPatches(
  entries: readonly SelectedLayoutEntry[],
  mode: ArrangementAlignMode,
): Map<string, Partial<LayoutBox>> {
  if (entries.length < 2) return new Map();
  const left = Math.min(...entries.map((entry) => entry.frame.x));
  const top = Math.min(...entries.map((entry) => entry.frame.y));
  const right = Math.max(
    ...entries.map((entry) => entry.frame.x + entry.frame.w),
  );
  const bottom = Math.max(
    ...entries.map((entry) => entry.frame.y + entry.frame.h),
  );
  const centerX = left + (right - left) / 2;
  const centerY = top + (bottom - top) / 2;
  const patches = new Map<string, Partial<LayoutBox>>();
  for (const entry of entries) {
    const nextFrame = { ...entry.frame };
    if (mode === "left") nextFrame.x = left;
    if (mode === "center") nextFrame.x = centerX - entry.frame.w / 2;
    if (mode === "right") nextFrame.x = right - entry.frame.w;
    if (mode === "top") nextFrame.y = top;
    if (mode === "middle") nextFrame.y = centerY - entry.frame.h / 2;
    if (mode === "bottom") nextFrame.y = bottom - entry.frame.h;
    patches.set(entry.id, { frame: nextFrame });
  }
  return patches;
}

export function buildDistributeSelectionPatches(
  entries: readonly SelectedLayoutEntry[],
  mode: ArrangementDistributeMode,
): Map<string, Partial<LayoutBox>> {
  if (entries.length < 3) return new Map();
  const sorted = [...entries].sort((a, b) =>
    mode === "horizontal" ? a.frame.x - b.frame.x : a.frame.y - b.frame.y,
  );
  const first = sorted[0]?.frame;
  const last = sorted[sorted.length - 1]?.frame;
  if (!first || !last) return new Map();
  const start = mode === "horizontal" ? first.x : first.y;
  const end = mode === "horizontal" ? last.x + last.w : last.y + last.h;
  const totalSize = sorted.reduce(
    (sum, entry) =>
      sum + (mode === "horizontal" ? entry.frame.w : entry.frame.h),
    0,
  );
  const gap = (end - start - totalSize) / (sorted.length - 1);
  const patches = new Map<string, Partial<LayoutBox>>();
  let cursor = start;
  for (const entry of sorted) {
    patches.set(entry.id, {
      frame:
        mode === "horizontal"
          ? { ...entry.frame, x: cursor }
          : { ...entry.frame, y: cursor },
    });
    cursor += (mode === "horizontal" ? entry.frame.w : entry.frame.h) + gap;
  }
  return patches;
}

export function buildMatchSizeSelectionPatches(
  entries: readonly SelectedLayoutEntry[],
  mode: ArrangementMatchSizeMode,
): Map<string, Partial<LayoutBox>> {
  if (entries.length < 2) return new Map();
  const base = entries[0]?.frame;
  if (!base) return new Map();
  const patches = new Map<string, Partial<LayoutBox>>();
  for (const entry of entries.slice(1)) {
    patches.set(entry.id, {
      frame: {
        ...entry.frame,
        w: mode === "height" ? entry.frame.w : base.w,
        h: mode === "width" ? entry.frame.h : base.h,
      },
    });
  }
  return patches;
}

export function buildZOrderSelectionOperations(
  nodes: readonly SlideChildNode[],
  selectedIds: readonly string[],
  kind: ArrangementZOrderKind,
): ZOrderSelectionOperation[] {
  if (selectedIds.length === 0) return [];
  const selected = new Set(selectedIds);
  const operations = new Map<string, number>();

  function collect(siblings: readonly SlideChildNode[]) {
    const ordered = orderSiblingsByVisualOrder(siblings);
    const selectedHere = ordered.filter(
      (node) =>
        selected.has(node.id) && node.layout !== undefined && !node.locked,
    );
    if (selectedHere.length > 0) {
      let reordered = [...ordered];
      if (kind === "front") {
        reordered = [
          ...ordered.filter((node) => !selectedHere.includes(node)),
          ...selectedHere,
        ];
      } else if (kind === "back") {
        reordered = [
          ...selectedHere,
          ...ordered.filter((node) => !selectedHere.includes(node)),
        ];
      } else if (kind === "forward") {
        for (let index = reordered.length - 2; index >= 0; index -= 1) {
          const current = reordered[index];
          const next = reordered[index + 1];
          if (
            current &&
            next &&
            selected.has(current.id) &&
            !selected.has(next.id)
          ) {
            reordered[index] = next;
            reordered[index + 1] = current;
          }
        }
      } else {
        for (let index = 1; index < reordered.length; index += 1) {
          const previous = reordered[index - 1];
          const current = reordered[index];
          if (
            previous &&
            current &&
            !selected.has(previous.id) &&
            selected.has(current.id)
          ) {
            reordered[index - 1] = current;
            reordered[index] = previous;
          }
        }
      }
      if (!sameNodeOrder(ordered, reordered)) {
        reordered.forEach((node, zIndex) => {
          if (node.layout) operations.set(node.id, zIndex);
        });
      }
    }
    for (const node of siblings) {
      if (node.type === "group") collect(node.children);
    }
  }

  collect(nodes);
  return [...operations].map(([id, zIndex]) => ({ id, zIndex }));
}
