import type { LayoutBox, SlideChildNode } from "./schema";

export type SelectionFrame = LayoutBox["frame"];

function intersects(a: SelectionFrame, b: SelectionFrame): boolean {
  return !(
    a.x + a.w < b.x ||
    b.x + b.w < a.x ||
    a.y + a.h < b.y ||
    b.y + b.h < a.y
  );
}

export function normalizeSelectionFrame(
  start: { x: number; y: number },
  end: { x: number; y: number },
): SelectionFrame {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    x,
    y,
    w: Math.abs(end.x - start.x),
    h: Math.abs(end.y - start.y),
  };
}

export function selectNodesInFrame(
  nodes: readonly SlideChildNode[],
  frame: SelectionFrame,
): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    if (node.hidden) {
      continue;
    }
    if (node.layout && intersects(node.layout.frame, frame)) {
      ids.push(node.id);
    }
    if (node.type === "group") {
      ids.push(...selectNodesInFrame(node.children, frame));
    }
  }
  return ids;
}
