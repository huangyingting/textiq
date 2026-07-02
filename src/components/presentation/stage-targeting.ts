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

export function resolveStageNodeTarget({
  hits,
  nodes,
  fallbackNodeId,
}: {
  hits: readonly StageHitCandidate[];
  nodes: readonly SlideChildNode[];
  fallbackNodeId?: string;
}): StageNodeInteractionTarget | null {
  const node =
    hits[0]?.node ??
    (fallbackNodeId ? findNodeById(nodes, fallbackNodeId) : undefined);
  if (!node) return null;
  return {
    node,
    nodeId: node.id,
    candidateIds: stageCandidateNodeIds(hits),
    parentGroupId: parentGroupIdForNode(nodes, node.id),
  };
}

export function nextActiveGroupIdForStageTarget({
  currentActiveGroupId,
  target,
}: {
  currentActiveGroupId: string | null;
  target: StageNodeInteractionTarget;
}): string | null {
  if (target.parentGroupId) return target.parentGroupId;
  if (currentActiveGroupId && target.nodeId !== currentActiveGroupId) {
    return null;
  }
  return currentActiveGroupId;
}

export function isStageNodeTargetSelected(
  target: StageNodeInteractionTarget,
  selectedNodeIds: readonly string[],
): boolean {
  return selectedNodeIds.includes(target.nodeId);
}
