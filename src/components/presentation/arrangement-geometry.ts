import type { LayoutBox, SlideChildNode } from "@/lib/presentation/schema";

export type ArrangementAlignMode =
  | "left"
  | "center"
  | "right"
  | "top"
  | "middle"
  | "bottom";
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

function flattenLayerNodes(nodes: readonly SlideChildNode[]): SlideChildNode[] {
  return nodes.flatMap((node) =>
    node.type === "group"
      ? [node, ...flattenLayerNodes(node.children)]
      : [node],
  );
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
  const layers = flattenLayerNodes(nodes)
    .filter((node) => node.layout !== undefined)
    .sort((a, b) => (b.layout?.zIndex ?? 0) - (a.layout?.zIndex ?? 0));
  const moving = layers.find((node) => node.id === nodeId);
  if (!moving) return new Map();
  const reordered = layers.filter((node) => node.id !== nodeId);
  const insertIndex = Math.max(0, Math.min(targetIndex, reordered.length));
  reordered.splice(insertIndex, 0, moving);
  const patches = new Map<string, Partial<LayoutBox>>();
  reordered.forEach((node, index) => {
    patches.set(node.id, { zIndex: reordered.length - index });
  });
  return patches;
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
  const zIndexes = nodes
    .map((node) => node.layout?.zIndex)
    .filter((zIndex): zIndex is number => typeof zIndex === "number");
  const maxZ = zIndexes.length > 0 ? Math.max(...zIndexes) : 0;
  const minZ = zIndexes.length > 0 ? Math.min(...zIndexes) : 0;
  return selectedIds.map((id, index) => {
    const node = findNodeById(nodes, id);
    const currentZ = node?.layout?.zIndex ?? 0;
    const zIndex =
      kind === "front"
        ? maxZ + index + 1
        : kind === "back"
          ? minZ - index - 1
          : kind === "forward"
            ? currentZ + 1
            : currentZ - 1;
    return { id, zIndex };
  });
}
