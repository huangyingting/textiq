import type {
  ConnectorAnchor,
  ConnectorEndpoint,
  SlideChildNode,
} from "@/lib/presentation/schema";
import { connectorAnchorPoint } from "@/lib/presentation/connector-geometry";

import { flattenEditorNodes } from "./selection-traversal";

export function connectorEndpointsEqual(
  left: ConnectorEndpoint,
  right: ConnectorEndpoint,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "point" && right.kind === "point") {
    return left.point.x === right.point.x && left.point.y === right.point.y;
  }
  if (left.kind === "node" && right.kind === "node") {
    return left.nodeId === right.nodeId && left.anchor === right.anchor;
  }
  return false;
}

export function nearestConnectorAnchor(
  nodes: readonly SlideChildNode[],
  point: { x: number; y: number },
  excludedId: string,
  thresholdPct = 4,
): ConnectorEndpoint | null {
  const anchors: ConnectorAnchor[] = [
    "top",
    "right",
    "bottom",
    "left",
    "center",
  ];
  let best: { endpoint: ConnectorEndpoint; distance: number } | null = null;
  for (const node of flattenEditorNodes(nodes)) {
    if (node.id === excludedId || node.type === "connector" || !node.layout) {
      continue;
    }
    for (const anchor of anchors) {
      const anchorPoint = connectorAnchorPoint(node.layout.frame, anchor);
      const distance = Math.hypot(
        anchorPoint.x - point.x,
        anchorPoint.y - point.y,
      );
      if (distance > thresholdPct) continue;
      if (!best || distance < best.distance) {
        best = {
          endpoint: { kind: "node", nodeId: node.id, anchor },
          distance,
        };
      }
    }
  }
  return best?.endpoint ?? null;
}
