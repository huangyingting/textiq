import type { ConnectorAnchor, ConnectorEndpoint, LayoutBox } from "./schema";

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function normalizePointToPercent(
  value: number,
  offset: number,
  size: number,
): number {
  if (size <= 0) return 0;
  return clampPercent(((value - offset) / size) * 100);
}

export function connectorAnchorPoint(
  frame: LayoutBox["frame"],
  anchor: ConnectorAnchor,
): { x: number; y: number } {
  switch (anchor) {
    case "top":
      return { x: frame.x + frame.w / 2, y: frame.y };
    case "right":
      return { x: frame.x + frame.w, y: frame.y + frame.h / 2 };
    case "bottom":
      return { x: frame.x + frame.w / 2, y: frame.y + frame.h };
    case "left":
      return { x: frame.x, y: frame.y + frame.h / 2 };
    case "center":
    default:
      return { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 };
  }
}

export function connectorEndpointFromSlidePoint(
  point: { x: number; y: number },
  connectorFrame: LayoutBox["frame"],
): Extract<ConnectorEndpoint, { kind: "point" }> {
  return {
    kind: "point",
    point: {
      x: normalizePointToPercent(point.x, connectorFrame.x, connectorFrame.w),
      y: normalizePointToPercent(point.y, connectorFrame.y, connectorFrame.h),
    },
  };
}

export function connectorEndpointSlidePoint(
  endpoint: ConnectorEndpoint,
  connectorFrame: LayoutBox["frame"],
  resolveNodeFrame: (nodeId: string) => LayoutBox["frame"] | undefined,
): { x: number; y: number } {
  if (endpoint.kind === "point") {
    return {
      x: connectorFrame.x + (connectorFrame.w * endpoint.point.x) / 100,
      y: connectorFrame.y + (connectorFrame.h * endpoint.point.y) / 100,
    };
  }
  const targetFrame = resolveNodeFrame(endpoint.nodeId);
  return targetFrame
    ? connectorAnchorPoint(targetFrame, endpoint.anchor)
    : connectorAnchorPoint(connectorFrame, endpoint.anchor);
}

export function connectorFrameFromSlidePoints(
  fromPoint: { x: number; y: number },
  toPoint: { x: number; y: number },
): LayoutBox["frame"] {
  return {
    x: Math.min(fromPoint.x, toPoint.x),
    y: Math.min(fromPoint.y, toPoint.y),
    w: Math.max(Math.abs(toPoint.x - fromPoint.x), 1),
    h: Math.max(Math.abs(toPoint.y - fromPoint.y), 1),
  };
}

export function connectorEndpointToPointFallback(
  endpoint: ConnectorEndpoint,
  connectorFrame: LayoutBox["frame"] | undefined,
  resolveNodeFrame: (nodeId: string) => LayoutBox["frame"] | undefined,
): ConnectorEndpoint {
  if (endpoint.kind === "point") return endpoint;
  if (!connectorFrame || connectorFrame.w <= 0 || connectorFrame.h <= 0) {
    return endpoint;
  }
  const targetFrame = resolveNodeFrame(endpoint.nodeId);
  if (!targetFrame) return endpoint;
  const targetPoint = connectorAnchorPoint(targetFrame, endpoint.anchor);
  return connectorEndpointFromSlidePoint(targetPoint, connectorFrame);
}
