import type { Visual } from "@/lib/visual/schema";

/**
 * A {@link VisualNode} extracted from a serialized Lexical editor state, paired
 * with its stable `visualId`. The order of the returned array follows document
 * order (a depth-first walk of the serialized tree), so callers can mirror the
 * nodes to `Visual` rows and reflect document order via `orderIndex`.
 */
export type CollectedVisualNode = {
  visualId: string;
  visual: Visual;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function lexicalVisualPayload(visual: unknown): Visual {
  return visual as unknown as Visual;
}

function walk(
  node: unknown,
  out: CollectedVisualNode[],
  seen: Set<string>,
): void {
  if (!isRecord(node)) {
    return;
  }

  if (
    node.type === "visual" &&
    typeof node.visualId === "string" &&
    node.visualId.length > 0 &&
    isRecord(node.visual) &&
    !seen.has(node.visualId)
  ) {
    seen.add(node.visualId);
    out.push({
      visualId: node.visualId,
      visual: lexicalVisualPayload(node.visual),
    });
  }

  const children = node.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      walk(child, out, seen);
    }
  }
}

/**
 * Collects every {@link VisualNode} payload from a serialized Lexical editor
 * state (a JSON string or already-parsed `{ root: { children } }` object), in
 * document order. Duplicate `visualId`s are de-duplicated to the first
 * occurrence. Malformed input yields an empty array (never throws), so it is
 * safe to run server-side against arbitrary stored state.
 */
export function collectVisualNodes(state: unknown): CollectedVisualNode[] {
  let parsed: unknown = state;
  if (typeof state === "string") {
    try {
      parsed = JSON.parse(state);
    } catch {
      /* Coverage rationale: malformed serialized state branch is asserted; tsx maps catch return as uncovered. */
      /* node:coverage ignore next */
      return [];
    }
  }

  const out: CollectedVisualNode[] = [];
  const root = isRecord(parsed) ? parsed.root : undefined;
  walk(root, out, new Set<string>());
  return out;
}
