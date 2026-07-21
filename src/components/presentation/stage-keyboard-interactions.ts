import type {
  ConnectorAnchor,
  ConnectorEndpoint,
  LayoutBox,
  SlideChildNode,
} from "@/lib/presentation/schema";
import {
  connectorAnchorPoint,
  connectorEndpointFromSlidePoint,
  connectorEndpointSlidePoint,
  connectorFrameFromSlidePoints,
} from "@/lib/presentation/connector-geometry";
import { nodeFactoryId } from "@/lib/presentation/node-asset-factories";

import { findNodeById, nodesInReadingOrder } from "./selection-traversal";

const KEYBOARD_CONNECTOR_ANCHORS: readonly ConnectorAnchor[] = [
  "center",
  "top",
  "bottom",
  "left",
  "right",
];

export interface KeyboardConnectorModePresentation {
  sourceId: string;
  targetId: string | null;
}

export type KeyboardConnectableNodePresentation = SlideChildNode & {
  layout: LayoutBox;
};

export function isKeyboardConnectableNode(
  node: SlideChildNode,
): node is KeyboardConnectableNodePresentation {
  if (!node.layout || node.hidden) return false;
  if (node.type === "connector") return false;
  if (node.type === "shape" && node.content.shape === "line") return false;
  return true;
}

function centerOfFrame(frame: LayoutBox["frame"]): { x: number; y: number } {
  return { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 };
}

function orderedKeyboardConnectorTargets(
  nodes: readonly SlideChildNode[],
  sourceId: string,
): KeyboardConnectableNodePresentation[] {
  const connectable = nodesInReadingOrder(nodes).filter(
    isKeyboardConnectableNode,
  );
  const source = connectable.find((node) => node.id === sourceId);
  if (!source) return [];
  const sourceCenter = centerOfFrame(source.layout.frame);
  return connectable
    .filter((node) => node.id !== sourceId)
    .sort((left, right) => {
      const leftCenter = centerOfFrame(left.layout.frame);
      const rightCenter = centerOfFrame(right.layout.frame);
      const leftDistance =
        (leftCenter.x - sourceCenter.x) ** 2 +
        (leftCenter.y - sourceCenter.y) ** 2;
      const rightDistance =
        (rightCenter.x - sourceCenter.x) ** 2 +
        (rightCenter.y - sourceCenter.y) ** 2;
      if (leftDistance !== rightDistance) return leftDistance - rightDistance;
      if (left.layout.frame.y !== right.layout.frame.y) {
        return left.layout.frame.y - right.layout.frame.y;
      }
      if (left.layout.frame.x !== right.layout.frame.x) {
        return left.layout.frame.x - right.layout.frame.x;
      }
      return left.id.localeCompare(right.id);
    });
}

export function startKeyboardConnectorModePresentation(
  nodes: readonly SlideChildNode[],
  sourceId: string,
): KeyboardConnectorModePresentation | null {
  if (!findNodeById(nodes, sourceId)) return null;
  const [target] = orderedKeyboardConnectorTargets(nodes, sourceId);
  return target ? { sourceId, targetId: target.id } : null;
}

export function nextKeyboardConnectorTargetIdPresentation(
  nodes: readonly SlideChildNode[],
  sourceId: string,
  currentTargetId: string | null,
  direction: 1 | -1,
): string | null {
  const targets = orderedKeyboardConnectorTargets(nodes, sourceId);
  if (targets.length === 0) return null;
  const currentIndex = currentTargetId
    ? targets.findIndex((target) => target.id === currentTargetId)
    : -1;
  if (currentIndex === -1) {
    return direction > 0 ? targets[0].id : targets[targets.length - 1].id;
  }
  return targets[(currentIndex + direction + targets.length) % targets.length]
    .id;
}

export function selectedKeyboardConnectablePair(
  nodes: readonly SlideChildNode[],
  selectedIds: readonly string[],
):
  | [KeyboardConnectableNodePresentation, KeyboardConnectableNodePresentation]
  | null {
  const selected = nodesInReadingOrder(nodes).filter((node) =>
    selectedIds.includes(node.id),
  );
  if (selected.length !== 2) return null;
  if (!selected.every(isKeyboardConnectableNode)) return null;
  return [selected[0], selected[1]];
}

function defaultConnectorAnchorPairPresentation(
  sourceFrame: LayoutBox["frame"],
  targetFrame: LayoutBox["frame"],
): { from: ConnectorAnchor; to: ConnectorAnchor } {
  const sourceCenter = centerOfFrame(sourceFrame);
  const targetCenter = centerOfFrame(targetFrame);
  const deltaX = targetCenter.x - sourceCenter.x;
  const deltaY = targetCenter.y - sourceCenter.y;
  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    return deltaX >= 0
      ? { from: "right", to: "left" }
      : { from: "left", to: "right" };
  }
  return deltaY >= 0
    ? { from: "bottom", to: "top" }
    : { from: "top", to: "bottom" };
}

export function buildKeyboardConnectorNodePresentation({
  from,
  to,
  zIndex,
}: {
  from: KeyboardConnectableNodePresentation;
  to: KeyboardConnectableNodePresentation;
  zIndex: number;
}): SlideChildNode {
  const anchors = defaultConnectorAnchorPairPresentation(
    from.layout.frame,
    to.layout.frame,
  );
  return {
    id: nodeFactoryId("connector"),
    type: "connector",
    role: "connector",
    layout: {
      frame: connectorFrameFromSlidePoints(
        connectorAnchorPoint(from.layout.frame, anchors.from),
        connectorAnchorPoint(to.layout.frame, anchors.to),
      ),
      zIndex,
    },
    style: { ref: "connector.primary" },
    content: {
      from: { kind: "node", nodeId: from.id, anchor: anchors.from },
      to: { kind: "node", nodeId: to.id, anchor: anchors.to },
      routing: "straight",
    },
  };
}

function connectorEndpointSlidePointPresentation(
  nodes: readonly SlideChildNode[],
  connectorFrame: LayoutBox["frame"],
  endpoint: ConnectorEndpoint,
): { x: number; y: number } {
  return connectorEndpointSlidePoint(
    endpoint,
    connectorFrame,
    (nodeId) => findNodeById(nodes, nodeId)?.layout?.frame,
  );
}

export function connectorFrameForEndpointsPresentation(
  nodes: readonly SlideChildNode[],
  connectorFrame: LayoutBox["frame"],
  from: ConnectorEndpoint,
  to: ConnectorEndpoint,
): LayoutBox["frame"] {
  return connectorFrameFromSlidePoints(
    connectorEndpointSlidePointPresentation(nodes, connectorFrame, from),
    connectorEndpointSlidePointPresentation(nodes, connectorFrame, to),
  );
}

export function detachConnectorEndpointPresentation(
  nodes: readonly SlideChildNode[],
  connector: Extract<SlideChildNode, { type: "connector" }> & {
    layout: LayoutBox;
  },
  endpoint: ConnectorEndpoint,
): ConnectorEndpoint {
  return connectorEndpointFromSlidePoint(
    connectorEndpointSlidePointPresentation(
      nodes,
      connector.layout.frame,
      endpoint,
    ),
    connector.layout.frame,
  );
}

export function cycleConnectorEndpointAnchorPresentation(
  endpoint: ConnectorEndpoint,
): ConnectorEndpoint {
  if (endpoint.kind !== "node") return endpoint;
  const currentIndex = KEYBOARD_CONNECTOR_ANCHORS.indexOf(endpoint.anchor);
  const safeIndex = currentIndex === -1 ? 0 : currentIndex;
  return {
    ...endpoint,
    anchor:
      KEYBOARD_CONNECTOR_ANCHORS[
        (safeIndex + 1) % KEYBOARD_CONNECTOR_ANCHORS.length
      ],
  };
}
