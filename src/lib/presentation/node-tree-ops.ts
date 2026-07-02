import type { GroupNode, LayoutBox, SlideChildNode } from "./schema";

export type NodeTreeEntry = {
  node: SlideChildNode;
  parent: GroupNode | null;
  parentId: string | null;
  path: number[];
  ancestorIds: string[];
  depth: number;
};

export type NodeTreeFlattenOptions = {
  includeGroups?: boolean;
};

export type NodeLayerOrder = "back-to-front" | "front-to-back";

export type NodeLayerOrderOptions = NodeTreeFlattenOptions & {
  order?: NodeLayerOrder;
  includeHidden?: boolean;
  requireLayout?: boolean;
};

export type NodeTreeMutationResult = {
  nodes: SlideChildNode[];
  changed: boolean;
};

export type InsertNodeResult = NodeTreeMutationResult & {
  inserted: boolean;
};

export type RemoveNodesResult = NodeTreeMutationResult & {
  removedNodes: SlideChildNode[];
  prunedGroupIds: string[];
};

export type ReorderNodeResult = NodeTreeMutationResult & {
  node: SlideChildNode | null;
  parentId: string | null;
  index: number;
};

export type GroupNodeFactoryContext = {
  parentPath: readonly string[];
  groupedNodeIds: readonly string[];
};

export type GroupNodesResult = NodeTreeMutationResult & {
  group: GroupNode | null;
  groupedNodes: SlideChildNode[];
  parentPath: string[];
};

export type UngroupNodeResult = NodeTreeMutationResult & {
  group: GroupNode | null;
  ungroupedNodes: SlideChildNode[];
};

type ReorderInSiblingsResult = ReorderNodeResult & {
  found: boolean;
};

function flattenEntries(
  nodes: readonly SlideChildNode[],
  options: Required<NodeTreeFlattenOptions>,
  parent: GroupNode | null,
  ancestorIds: readonly string[],
  path: readonly number[],
): NodeTreeEntry[] {
  const result: NodeTreeEntry[] = [];
  nodes.forEach((node, index) => {
    const nodePath = [...path, index];
    if (options.includeGroups || node.type !== "group") {
      result.push({
        node,
        parent,
        parentId: parent?.id ?? null,
        path: nodePath,
        ancestorIds: [...ancestorIds],
        depth: ancestorIds.length,
      });
    }
    if (node.type === "group") {
      result.push(
        ...flattenEntries(
          node.children,
          options,
          node,
          [...ancestorIds, node.id],
          nodePath,
        ),
      );
    }
  });
  return result;
}

function clampIndex(index: number | undefined, length: number): number {
  if (index === undefined) return length;
  return Math.max(0, Math.min(length, index));
}

function nodeZIndex(node: SlideChildNode): number {
  return node.layout?.zIndex ?? 0;
}

function findEntryInSiblings(
  nodes: readonly SlideChildNode[],
  id: string,
  parent: GroupNode | null,
  ancestorIds: readonly string[],
  path: readonly number[],
): NodeTreeEntry | undefined {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (!node) continue;
    const nodePath = [...path, index];
    if (node.id === id) {
      return {
        node,
        parent,
        parentId: parent?.id ?? null,
        path: nodePath,
        ancestorIds: [...ancestorIds],
        depth: ancestorIds.length,
      };
    }
    if (node.type === "group") {
      const found = findEntryInSiblings(
        node.children,
        id,
        node,
        [...ancestorIds, node.id],
        nodePath,
      );
      if (found) return found;
    }
  }
  return undefined;
}

function insertAtPath(
  nodes: readonly SlideChildNode[],
  parentPath: readonly string[],
  node: SlideChildNode,
  index: number | undefined,
): InsertNodeResult {
  if (parentPath.length === 0) {
    const nextNodes = [...nodes];
    nextNodes.splice(clampIndex(index, nextNodes.length), 0, node);
    return { nodes: nextNodes, changed: true, inserted: true };
  }

  const [parentId, ...restPath] = parentPath;
  let inserted = false;
  const nextNodes = nodes.map((candidate) => {
    if (candidate.type !== "group" || candidate.id !== parentId) {
      return candidate;
    }
    const result = insertAtPath(candidate.children, restPath, node, index);
    if (!result.inserted) return candidate;
    inserted = true;
    return { ...candidate, children: result.nodes };
  });

  return inserted
    ? { nodes: nextNodes, changed: true, inserted: true }
    : { nodes: [...nodes], changed: false, inserted: false };
}

function removeFromSiblings(
  nodes: readonly SlideChildNode[],
  ids: ReadonlySet<string>,
  pruneEmptyGroups: boolean,
  removedNodes: SlideChildNode[],
  prunedGroupIds: string[],
): NodeTreeMutationResult {
  let changed = false;
  const nextNodes: SlideChildNode[] = [];

  for (const node of nodes) {
    if (ids.has(node.id)) {
      removedNodes.push(node);
      changed = true;
      continue;
    }

    if (node.type === "group") {
      const childResult = removeFromSiblings(
        node.children,
        ids,
        pruneEmptyGroups,
        removedNodes,
        prunedGroupIds,
      );
      if (childResult.changed) {
        changed = true;
        if (childResult.nodes.length > 0 || !pruneEmptyGroups) {
          nextNodes.push({ ...node, children: childResult.nodes });
        } else {
          prunedGroupIds.push(node.id);
        }
        continue;
      }
    }

    nextNodes.push(node);
  }

  return changed
    ? { nodes: nextNodes, changed: true }
    : { nodes: [...nodes], changed: false };
}

function reorderInSiblings(
  nodes: readonly SlideChildNode[],
  nodeId: string,
  toIndex: number,
  parentId: string | null,
): ReorderInSiblingsResult {
  const currentIndex = nodes.findIndex((node) => node.id === nodeId);
  if (currentIndex !== -1) {
    const node = nodes[currentIndex] ?? null;
    if (!node) {
      return {
        nodes: [...nodes],
        changed: false,
        found: false,
        node: null,
        parentId,
        index: -1,
      };
    }
    const withoutNode = nodes.filter((_, index) => index !== currentIndex);
    const nextIndex = clampIndex(toIndex, withoutNode.length);
    if (nextIndex === currentIndex) {
      return {
        nodes: [...nodes],
        changed: false,
        found: true,
        node,
        parentId,
        index: currentIndex,
      };
    }
    const nextNodes = [...withoutNode];
    nextNodes.splice(nextIndex, 0, node);
    return {
      nodes: nextNodes,
      changed: true,
      found: true,
      node,
      parentId,
      index: nextIndex,
    };
  }

  for (const candidate of nodes) {
    if (candidate.type !== "group") continue;
    const childResult = reorderInSiblings(
      candidate.children,
      nodeId,
      toIndex,
      candidate.id,
    );
    if (!childResult.found) continue;
    if (!childResult.changed) {
      return { ...childResult, nodes: [...nodes] };
    }
    return {
      ...childResult,
      nodes: nodes.map((node) =>
        node === candidate
          ? { ...candidate, children: childResult.nodes }
          : node,
      ),
    };
  }

  return {
    nodes: [...nodes],
    changed: false,
    found: false,
    node: null,
    parentId: null,
    index: -1,
  };
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
        remaining.push({ ...node, children: extracted.nodes });
      }
      continue;
    }

    remaining.push(node);
  }

  return { nodes: remaining, selected };
}

export function flattenNodeTreeEntries(
  nodes: readonly SlideChildNode[],
  options: NodeTreeFlattenOptions = {},
): NodeTreeEntry[] {
  return flattenEntries(
    nodes,
    { includeGroups: options.includeGroups ?? true },
    null,
    [],
    [],
  );
}

export function flattenNodeTree(
  nodes: readonly SlideChildNode[],
  options: NodeTreeFlattenOptions = {},
): SlideChildNode[] {
  return flattenNodeTreeEntries(nodes, options).map((entry) => entry.node);
}

export function flattenLeafNodes(
  nodes: readonly SlideChildNode[],
): SlideChildNode[] {
  return flattenNodeTree(nodes, { includeGroups: false });
}

export function findNodeEntryById(
  nodes: readonly SlideChildNode[],
  id: string,
): NodeTreeEntry | undefined {
  return findEntryInSiblings(nodes, id, null, [], []);
}

export function findNodeById(
  nodes: readonly SlideChildNode[],
  id: string,
): SlideChildNode | undefined {
  return findNodeEntryById(nodes, id)?.node;
}

export function findParentGroupForNode(
  nodes: readonly SlideChildNode[],
  nodeId: string,
): GroupNode | undefined {
  return findNodeEntryById(nodes, nodeId)?.parent ?? undefined;
}

export function parentGroupIdForNode(
  nodes: readonly SlideChildNode[],
  nodeId: string,
): string | null {
  return findNodeEntryById(nodes, nodeId)?.parentId ?? null;
}

export function parentPathForNode(
  nodes: readonly SlideChildNode[],
  nodeId: string,
): string[] | null {
  const entry = findNodeEntryById(nodes, nodeId);
  return entry ? [...entry.ancestorIds] : null;
}

export function ancestorIdsForNode(
  nodes: readonly SlideChildNode[],
  nodeId: string,
): string[] {
  return findNodeEntryById(nodes, nodeId)?.ancestorIds ?? [];
}

export function isAncestorOfNode(
  nodes: readonly SlideChildNode[],
  ancestorId: string,
  nodeId: string,
): boolean {
  return ancestorIdsForNode(nodes, nodeId).includes(ancestorId);
}

export function collectSubtreeNodeIds(node: SlideChildNode): string[] {
  return flattenNodeTree([node]).map((entry) => entry.id);
}

export function collectDescendantNodeIds(node: SlideChildNode): string[] {
  return node.type === "group"
    ? flattenNodeTree(node.children).map((n) => n.id)
    : [];
}

export function collectNodeTreeIds(nodes: readonly SlideChildNode[]): string[] {
  return flattenNodeTree(nodes).map((node) => node.id);
}

export function expandNodeIdsWithDescendants(
  nodes: readonly SlideChildNode[],
  selectedIds: ReadonlySet<string>,
): Set<string> {
  const expanded = new Set(selectedIds);
  for (const id of selectedIds) {
    const node = findNodeById(nodes, id);
    if (!node) continue;
    for (const descendantId of collectSubtreeNodeIds(node)) {
      expanded.add(descendantId);
    }
  }
  return expanded;
}

export function topLevelSelectedNodeIds(
  nodes: readonly SlideChildNode[],
  selectedIds: ReadonlySet<string>,
): string[] {
  const result: string[] = [];

  function visit(
    candidates: readonly SlideChildNode[],
    insideSelectedGroup: boolean,
  ): void {
    for (const node of candidates) {
      const selected = selectedIds.has(node.id);
      if (selected && !insideSelectedGroup) result.push(node.id);
      if (node.type === "group") {
        visit(node.children, insideSelectedGroup || selected);
      }
    }
  }

  visit(nodes, false);
  return result;
}

export function commonAncestorPath(
  paths: readonly (readonly string[])[],
): string[] {
  if (paths.length === 0) return [];
  const firstPath = paths[0] ?? [];
  let length = firstPath.length;
  for (const path of paths.slice(1)) {
    let nextLength = 0;
    while (
      nextLength < length &&
      nextLength < path.length &&
      firstPath[nextLength] === path[nextLength]
    ) {
      nextLength += 1;
    }
    length = nextLength;
    if (length === 0) break;
  }
  return firstPath.slice(0, length);
}

export function nodesInLayerOrder(
  nodes: readonly SlideChildNode[],
  options: NodeLayerOrderOptions = {},
): SlideChildNode[] {
  const order = options.order ?? "back-to-front";
  const includeHidden = options.includeHidden ?? true;
  const requireLayout = options.requireLayout ?? true;
  return flattenNodeTreeEntries(nodes, {
    includeGroups: options.includeGroups ?? true,
  })
    .filter((entry) => includeHidden || entry.node.hidden !== true)
    .filter((entry) => !requireLayout || entry.node.layout !== undefined)
    .map((entry, treeIndex) => ({ entry, treeIndex }))
    .sort((left, right) => {
      const zDelta = nodeZIndex(left.entry.node) - nodeZIndex(right.entry.node);
      const orderedDelta = order === "back-to-front" ? zDelta : -zDelta;
      return orderedDelta || left.treeIndex - right.treeIndex;
    })
    .map(({ entry }) => entry.node);
}

export function buildLayerReorderPatches(
  nodes: readonly SlideChildNode[],
  nodeId: string,
  targetIndex: number,
  options: NodeTreeFlattenOptions = {},
): Map<string, Partial<LayoutBox>> {
  const layers = nodesInLayerOrder(nodes, {
    includeGroups: options.includeGroups ?? true,
    order: "front-to-back",
  });
  const moving = layers.find((node) => node.id === nodeId);
  if (!moving) return new Map();

  const reordered = layers.filter((node) => node.id !== nodeId);
  reordered.splice(clampIndex(targetIndex, reordered.length), 0, moving);

  const patches = new Map<string, Partial<LayoutBox>>();
  reordered.forEach((node, index) => {
    patches.set(node.id, { zIndex: reordered.length - index });
  });
  return patches;
}

export function insertNodeAtPath(
  nodes: readonly SlideChildNode[],
  parentPath: readonly string[],
  node: SlideChildNode,
  index?: number,
): InsertNodeResult {
  return insertAtPath(nodes, parentPath, node, index);
}

export function insertNodeRelativeTo(
  nodes: readonly SlideChildNode[],
  referenceId: string,
  node: SlideChildNode,
  placement: "before" | "after" | "inside-start" | "inside-end",
): InsertNodeResult {
  const reference = findNodeEntryById(nodes, referenceId);
  if (!reference) {
    return { nodes: [...nodes], changed: false, inserted: false };
  }

  if (placement === "inside-start" || placement === "inside-end") {
    if (reference.node.type !== "group") {
      return { nodes: [...nodes], changed: false, inserted: false };
    }
    return insertNodeAtPath(
      nodes,
      [...reference.ancestorIds, reference.node.id],
      node,
      placement === "inside-start" ? 0 : undefined,
    );
  }

  const index = reference.path[reference.path.length - 1] ?? 0;
  return insertNodeAtPath(
    nodes,
    reference.ancestorIds,
    node,
    placement === "before" ? index : index + 1,
  );
}

export function removeNodesById(
  nodes: readonly SlideChildNode[],
  ids: ReadonlySet<string>,
  options: { pruneEmptyGroups?: boolean } = {},
): RemoveNodesResult {
  if (ids.size === 0) {
    return {
      nodes: [...nodes],
      changed: false,
      removedNodes: [],
      prunedGroupIds: [],
    };
  }

  const removedNodes: SlideChildNode[] = [];
  const prunedGroupIds: string[] = [];
  const result = removeFromSiblings(
    nodes,
    ids,
    options.pruneEmptyGroups ?? false,
    removedNodes,
    prunedGroupIds,
  );
  return {
    ...result,
    removedNodes,
    prunedGroupIds,
  };
}

export function removeNodeById(
  nodes: readonly SlideChildNode[],
  id: string,
  options: { pruneEmptyGroups?: boolean } = {},
): RemoveNodesResult {
  return removeNodesById(nodes, new Set([id]), options);
}

export function reorderNodeWithinParent(
  nodes: readonly SlideChildNode[],
  nodeId: string,
  toIndex: number,
): ReorderNodeResult {
  const result = reorderInSiblings(nodes, nodeId, toIndex, null);
  return {
    nodes: result.nodes,
    changed: result.changed,
    node: result.node,
    parentId: result.parentId,
    index: result.index,
  };
}

export function groupNodesById(
  nodes: readonly SlideChildNode[],
  selectedIds: ReadonlySet<string>,
  createGroup: (
    children: readonly SlideChildNode[],
    context: GroupNodeFactoryContext,
  ) => GroupNode,
): GroupNodesResult {
  const groupedIds = topLevelSelectedNodeIds(nodes, selectedIds);
  if (groupedIds.length === 0) {
    return {
      nodes: [...nodes],
      changed: false,
      group: null,
      groupedNodes: [],
      parentPath: [],
    };
  }

  const parentPaths = groupedIds
    .map((id) => parentPathForNode(nodes, id))
    .filter((path): path is string[] => path !== null);
  const insertionPath = commonAncestorPath(parentPaths);
  const keepGroupIds = new Set(insertionPath);
  const extracted = extractSelectedNodesForGrouping(
    nodes,
    new Set(groupedIds),
    keepGroupIds,
  );
  if (extracted.selected.length === 0) {
    return {
      nodes: [...nodes],
      changed: false,
      group: null,
      groupedNodes: [],
      parentPath: insertionPath,
    };
  }

  const group = createGroup(extracted.selected, {
    parentPath: insertionPath,
    groupedNodeIds: groupedIds,
  });
  const inserted = insertNodeAtPath(extracted.nodes, insertionPath, group);
  return {
    nodes: inserted.nodes,
    changed: inserted.changed,
    group,
    groupedNodes: extracted.selected,
    parentPath: insertionPath,
  };
}

export function ungroupNodeById(
  nodes: readonly SlideChildNode[],
  groupId: string,
): UngroupNodeResult {
  let group: GroupNode | null = null;
  let ungroupedNodes: SlideChildNode[] = [];
  let changed = false;

  function visit(candidates: readonly SlideChildNode[]): SlideChildNode[] {
    const nextNodes: SlideChildNode[] = [];
    for (const node of candidates) {
      if (node.id === groupId && node.type === "group") {
        group = node;
        ungroupedNodes = node.children;
        changed = true;
        nextNodes.push(...node.children);
        continue;
      }
      if (node.type === "group") {
        const children = visit(node.children);
        nextNodes.push(
          children === node.children ? node : { ...node, children },
        );
        continue;
      }
      nextNodes.push(node);
    }
    return changed ? nextNodes : [...candidates];
  }

  const nextNodes = visit(nodes);
  return {
    nodes: nextNodes,
    changed,
    group,
    ungroupedNodes,
  };
}
