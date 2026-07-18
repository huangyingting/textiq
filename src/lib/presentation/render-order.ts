export type RenderOrderTraversalOptions<T> =
  | {
      mode: "visual";
      isHidden?: (node: T) => boolean;
    }
  | {
      mode: "management";
    };

type VisualOrderNode = {
  layout?: {
    zIndex?: number;
  };
};

type IndexedVisualOrderNode<T> = {
  node: T;
  sourceIndex: number;
};

export function effectiveVisualZIndex(node: VisualOrderNode): number {
  const zIndex = node.layout?.zIndex;
  return typeof zIndex === "number" && Number.isFinite(zIndex) ? zIndex : 0;
}

export function compareSiblingVisualOrder<T extends VisualOrderNode>(
  left: IndexedVisualOrderNode<T>,
  right: IndexedVisualOrderNode<T>,
): number {
  return (
    effectiveVisualZIndex(left.node) - effectiveVisualZIndex(right.node) ||
    left.sourceIndex - right.sourceIndex
  );
}

export function orderSiblingsByVisualOrder<T extends VisualOrderNode>(
  nodes: readonly T[],
): T[] {
  return nodes
    .map((node, sourceIndex) => ({ node, sourceIndex }))
    .sort(compareSiblingVisualOrder)
    .map(({ node }) => node);
}

export function flattenNodesInRenderOrder<T extends VisualOrderNode>(
  nodes: readonly T[],
  childrenFor: (node: T) => readonly T[] | undefined,
  options: RenderOrderTraversalOptions<T>,
): T[] {
  const result: T[] = [];
  const siblings = orderSiblingsByVisualOrder(nodes);
  for (const node of siblings) {
    if (options.mode === "visual" && options.isHidden?.(node) === true) {
      continue;
    }
    result.push(node);
    const children = childrenFor(node);
    if (children && children.length > 0) {
      result.push(...flattenNodesInRenderOrder(children, childrenFor, options));
    }
  }
  return result;
}
