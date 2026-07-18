import type { SlideChildNode } from "@/lib/presentation/schema";
import type { StageHitCandidate } from "@/lib/presentation/stage-hit-test";

import { findNodeById, parentGroupIdForNode } from "./selection-traversal";

export interface StageNodeInteractionTarget {
  node: SlideChildNode;
  nodeId: string;
  candidateIds: string[];
  parentGroupId: string | null;
}

export function stageCandidateNodeIds(
  hits: readonly StageHitCandidate[],
): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const hit of hits) {
    if (seen.has(hit.node.id)) continue;
    seen.add(hit.node.id);
    ids.push(hit.node.id);
  }
  return ids;
}

export function unlockedStageCandidateNodeIds(
  hits: readonly StageHitCandidate[],
): string[] {
  return stageCandidateNodeIds(
    hits.filter((hit) => hit.node.locked !== true && hit.node.hidden !== true),
  );
}

export function resolveStageNodeTarget({
  hits,
  nodes,
  fallbackNodeId,
}: {
  hits: readonly StageHitCandidate[];
  nodes: readonly SlideChildNode[];
  fallbackNodeId?: string;
}): StageNodeInteractionTarget | null {
  const fallbackNode = fallbackNodeId
    ? findNodeById(nodes, fallbackNodeId)
    : undefined;
  const node =
    hits.find((hit) => hit.node.locked !== true && hit.node.hidden !== true)
      ?.node ??
    (fallbackNode?.locked !== true && fallbackNode?.hidden !== true
      ? fallbackNode
      : undefined);
  if (!node) return null;
  return {
    node,
    nodeId: node.id,
    candidateIds: unlockedStageCandidateNodeIds(hits),
    parentGroupId: parentGroupIdForNode(nodes, node.id),
  };
}

export function nextActiveGroupIdForStageTarget({
  target,
}: {
  currentActiveGroupId: string | null;
  target: StageNodeInteractionTarget;
}): string | null {
  return target.parentGroupId;
}

export function resolveProgressiveGroupTarget({
  target,
  nodes,
  selectedNodeIds,
  activeGroupId,
}: {
  target: StageNodeInteractionTarget;
  nodes: readonly SlideChildNode[];
  selectedNodeIds: readonly string[];
  activeGroupId: string | null;
}): StageNodeInteractionTarget {
  if (!target.parentGroupId) return target;
  if (
    selectedNodeIds.includes(target.parentGroupId) ||
    selectedNodeIds.includes(target.nodeId) ||
    activeGroupId === target.parentGroupId
  ) {
    return target;
  }
  const group = findNodeById(nodes, target.parentGroupId);
  if (!group || group.type !== "group") return target;
  return {
    node: group,
    nodeId: group.id,
    candidateIds: [group.id, ...target.candidateIds],
    parentGroupId: parentGroupIdForNode(nodes, group.id),
  };
}

export function isStageNodeTargetSelected(
  target: StageNodeInteractionTarget,
  selectedNodeIds: readonly string[],
): boolean {
  return selectedNodeIds.includes(target.nodeId);
}
