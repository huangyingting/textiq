import type { LayoutBox, SlideChildNode, ConnectorEndpoint } from "./schema";

export type StageHitReason =
  | "text-content"
  | "text-near"
  | "text-frame"
  | "line-stroke"
  | "connector-stroke"
  | "shape-edge"
  | "shape-interior"
  | "box-interior";

export interface StageHitCandidate {
  node: SlideChildNode;
  frame: LayoutBox["frame"];
  score: number;
  reason: StageHitReason;
}

export interface StageHitTestOptions {
  stageAspect?: number;
  includeLocked?: boolean;
  lineThresholdPct?: number;
  selectedNodeIds?: ReadonlySet<string>;
  selectedNodeBonus?: boolean;
}

interface PointPct {
  x: number;
  y: number;
}

const DEFAULT_LINE_THRESHOLD_PCT = 1.5;
const TEXT_NEAR_PADDING_PCT = 2.5;
const SHAPE_EDGE_THRESHOLD_PCT = 1.4;
const MIN_TEXT_HIT_W_PCT = 4;
const MIN_TEXT_HIT_H_PCT = 3;
const CURVE_SEGMENTS = 12;

const SCORE = {
  textContent: 100,
  textNear: 78,
  textFrame: 8,
  lineStroke: 106,
  connectorStroke: 106,
  shapeEdge: 112,
  smallShapeInterior: 104,
  mediumShapeInterior: 88,
  largeShapeInterior: 58,
  coveringShapeInterior: 24,
  boxInterior: 68,
  selectedBonus: 88,
  maxZIndexBonus: 8,
} as const;

function flattenHitNodes(nodes: readonly SlideChildNode[]): SlideChildNode[] {
  const result: SlideChildNode[] = [];
  for (const node of nodes) {
    if (node.type === "group") {
      result.push(...flattenHitNodes(node.children));
      continue;
    }
    result.push(node);
  }
  return result;
}

function flattenAllNodes(nodes: readonly SlideChildNode[]): SlideChildNode[] {
  const result: SlideChildNode[] = [];
  for (const node of nodes) {
    result.push(node);
    if (node.type === "group") {
      result.push(...flattenAllNodes(node.children));
    }
  }
  return result;
}

function pointInFrame(point: PointPct, frame: LayoutBox["frame"]): boolean {
  return (
    point.x >= frame.x &&
    point.x <= frame.x + frame.w &&
    point.y >= frame.y &&
    point.y <= frame.y + frame.h
  );
}

function inflateFrame(
  frame: LayoutBox["frame"],
  amount: number,
): LayoutBox["frame"] {
  return {
    x: frame.x - amount,
    y: frame.y - amount,
    w: frame.w + amount * 2,
    h: frame.h + amount * 2,
  };
}

function rotatePointAroundCenter(
  point: PointPct,
  frame: LayoutBox["frame"],
  rotationDeg: number,
  stageAspect: number,
): PointPct {
  if (!rotationDeg) return point;
  const center = { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 };
  const angle = (-rotationDeg * Math.PI) / 180;
  const dx = (point.x - center.x) * stageAspect;
  const dy = point.y - center.y;
  const localX = dx * Math.cos(angle) - dy * Math.sin(angle);
  const localY = dx * Math.sin(angle) + dy * Math.cos(angle);
  return {
    x: center.x + localX / stageAspect,
    y: center.y + localY,
  };
}

function pointInNodeFrame(
  point: PointPct,
  node: SlideChildNode,
  frame: LayoutBox["frame"],
  stageAspect: number,
): boolean {
  return pointInFrame(
    rotatePointAroundCenter(
      point,
      frame,
      node.layout?.rotation ?? 0,
      stageAspect,
    ),
    frame,
  );
}

function nodeTextParagraphs(node: SlideChildNode): readonly { text: string }[] {
  if (node.type === "text") {
    return node.content.paragraphs;
  }
  return [];
}

function nodeTextLines(node: SlideChildNode): string[] {
  const lines = nodeTextParagraphs(node)
    .flatMap((paragraph) => paragraph.text.split(/\r?\n/))
    .filter((line) => line.trim());
  return lines.length > 0 ? lines : [""];
}

function textVisibleFrame(
  node: SlideChildNode,
  frame: LayoutBox["frame"],
  stageAspect: number,
): LayoutBox["frame"] {
  const lines = nodeTextLines(node).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return frame;

  const textStyle: {
    fontSizePt?: number;
    lineHeight?: number;
    align?: "left" | "center" | "right";
    verticalAlign?: "top" | "middle" | "bottom";
  } = node.localStyle?.text ?? {
    fontSizePt: 4,
    align: "left",
    verticalAlign: "middle",
  };
  const lineHeight = textStyle.lineHeight ?? 1.15;
  const fontSize = textStyle.fontSizePt ?? 4;
  const maxChars = Math.max(...lines.map((line) => line.length));

  const estimatedTextWidth =
    (maxChars * fontSize * 0.56) / Math.max(0.1, stageAspect) + 2;
  const estimatedTextHeight = lines.length * fontSize * lineHeight + 2;

  const w = Math.min(frame.w, Math.max(MIN_TEXT_HIT_W_PCT, estimatedTextWidth));
  const h = Math.min(
    frame.h,
    Math.max(MIN_TEXT_HIT_H_PCT, estimatedTextHeight),
  );

  let x = frame.x;
  if (textStyle.align === "center") {
    x = frame.x + (frame.w - w) / 2;
  } else if (textStyle.align === "right") {
    x = frame.x + frame.w - w;
  }

  let y = frame.y + (frame.h - h) / 2;
  if (textStyle.verticalAlign === "top") {
    y = frame.y;
  } else if (textStyle.verticalAlign === "bottom") {
    y = frame.y + frame.h - h;
  }

  return { x, y, w, h };
}

function distanceToSegment(
  point: PointPct,
  start: PointPct,
  end: PointPct,
  stageAspect: number,
): number {
  const px = point.x * stageAspect;
  const py = point.y;
  const ax = start.x * stageAspect;
  const ay = start.y;
  const bx = end.x * stageAspect;
  const by = end.y;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function pointInTriangle(point: PointPct, frame: LayoutBox["frame"]): boolean {
  const top = { x: frame.x + frame.w / 2, y: frame.y };
  const left = { x: frame.x, y: frame.y + frame.h };
  const right = { x: frame.x + frame.w, y: frame.y + frame.h };
  const area = (a: PointPct, b: PointPct, c: PointPct) =>
    Math.abs((a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y)) / 2);
  const full = area(top, left, right);
  const sum =
    area(point, left, right) + area(top, point, right) + area(top, left, point);
  return Math.abs(sum - full) < 0.01;
}

function pointInDiamond(point: PointPct, frame: LayoutBox["frame"]): boolean {
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  const dx = Math.abs((point.x - cx) / Math.max(frame.w / 2, 0.0001));
  const dy = Math.abs((point.y - cy) / Math.max(frame.h / 2, 0.0001));
  return dx + dy <= 1;
}

function distanceToFrameEdge(
  point: PointPct,
  frame: LayoutBox["frame"],
  stageAspect: number,
): number {
  const left = Math.abs(point.x - frame.x) * stageAspect;
  const right = Math.abs(point.x - (frame.x + frame.w)) * stageAspect;
  const top = Math.abs(point.y - frame.y);
  const bottom = Math.abs(point.y - (frame.y + frame.h));
  return Math.min(left, right, top, bottom);
}

function shapeInteriorScore(frame: LayoutBox["frame"]): number {
  const area = frame.w * frame.h;
  if (area <= 450) return SCORE.smallShapeInterior;
  if (area <= 1600) return SCORE.mediumShapeInterior;
  if (area <= 3600) return SCORE.largeShapeInterior;
  return SCORE.coveringShapeInterior;
}

function zIndex(node: SlideChildNode): number {
  return node.layout?.zIndex ?? 0;
}

function zIndexBonus(node: SlideChildNode): number {
  return Math.max(0, Math.min(SCORE.maxZIndexBonus, zIndex(node) * 0.1));
}

function withBonuses(
  baseScore: number,
  node: SlideChildNode,
  selectedNodeIds: ReadonlySet<string> | undefined,
): number {
  return (
    baseScore +
    zIndexBonus(node) +
    (selectedNodeIds?.has(node.id) ? SCORE.selectedBonus : 0)
  );
}

function lineEndpoints(
  frame: LayoutBox["frame"],
  rotation: number | undefined,
  stageAspect: number,
): { start: PointPct; end: PointPct } {
  const angle = ((rotation ?? 0) * Math.PI) / 180;
  const centerX = frame.x + frame.w / 2;
  const centerY = frame.y + frame.h / 2;
  const dx = (Math.cos(angle) * frame.w) / 2;
  const dy = (Math.sin(angle) * frame.w * stageAspect) / 2;
  return {
    start: { x: centerX - dx, y: centerY - dy },
    end: { x: centerX + dx, y: centerY + dy },
  };
}

function anchorPoint(
  frame: LayoutBox["frame"],
  anchor: Extract<ConnectorEndpoint, { kind: "node" }>["anchor"],
): PointPct {
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

function connectorEndpointToSlidePoint(
  endpoint: ConnectorEndpoint,
  connectorFrame: LayoutBox["frame"],
  nodesById: ReadonlyMap<string, SlideChildNode>,
): PointPct {
  if (endpoint.kind === "point") {
    return {
      x: connectorFrame.x + (connectorFrame.w * endpoint.point.x) / 100,
      y: connectorFrame.y + (connectorFrame.h * endpoint.point.y) / 100,
    };
  }
  const target = nodesById.get(endpoint.nodeId);
  if (target?.layout) {
    return anchorPoint(target.layout.frame, endpoint.anchor);
  }
  const local =
    endpoint.anchor === "top"
      ? { x: 50, y: 0 }
      : endpoint.anchor === "right"
        ? { x: 100, y: 50 }
        : endpoint.anchor === "bottom"
          ? { x: 50, y: 100 }
          : endpoint.anchor === "left"
            ? { x: 0, y: 50 }
            : { x: 50, y: 50 };
  return {
    x: connectorFrame.x + (connectorFrame.w * local.x) / 100,
    y: connectorFrame.y + (connectorFrame.h * local.y) / 100,
  };
}

function connectorPathPoints(
  node: Extract<SlideChildNode, { type: "connector" }>,
  nodesById: ReadonlyMap<string, SlideChildNode>,
): PointPct[] {
  const frame = node.layout?.frame;
  if (!frame) return [];
  const start = connectorEndpointToSlidePoint(
    node.content.from,
    frame,
    nodesById,
  );
  const end = connectorEndpointToSlidePoint(node.content.to, frame, nodesById);
  const routing = node.content.routing ?? "straight";
  if (routing === "elbow") {
    const midX = start.x + (end.x - start.x) / 2;
    return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
  }
  if (routing === "curved") {
    const cp1 = { x: start.x + (end.x - start.x) / 2, y: start.y };
    const cp2 = { x: start.x + (end.x - start.x) / 2, y: end.y };
    const points: PointPct[] = [];
    for (let index = 0; index <= CURVE_SEGMENTS; index += 1) {
      const t = index / CURVE_SEGMENTS;
      const mt = 1 - t;
      points.push({
        x:
          mt * mt * mt * start.x +
          3 * mt * mt * t * cp1.x +
          3 * mt * t * t * cp2.x +
          t * t * t * end.x,
        y:
          mt * mt * mt * start.y +
          3 * mt * mt * t * cp1.y +
          3 * mt * t * t * cp2.y +
          t * t * t * end.y,
      });
    }
    return points;
  }
  return [start, end];
}

function distanceToPath(
  point: PointPct,
  pathPoints: readonly PointPct[],
  stageAspect: number,
): number {
  if (pathPoints.length < 2) return Number.POSITIVE_INFINITY;
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < pathPoints.length - 1; index += 1) {
    const distance = distanceToSegment(
      point,
      pathPoints[index] as PointPct,
      pathPoints[index + 1] as PointPct,
      stageAspect,
    );
    if (distance < best) {
      best = distance;
    }
  }
  return best;
}

function hitTestShape(
  point: PointPct,
  node: Extract<SlideChildNode, { type: "shape" }>,
  frame: LayoutBox["frame"],
  stageAspect: number,
  lineThresholdPct: number,
): { score: number; reason: StageHitReason } | null {
  const localPoint = rotatePointAroundCenter(
    point,
    frame,
    node.layout?.rotation ?? 0,
    stageAspect,
  );

  if (node.content.shape === "line") {
    const endpoints = lineEndpoints(frame, node.layout?.rotation, stageAspect);
    if (
      distanceToSegment(point, endpoints.start, endpoints.end, stageAspect) >
      lineThresholdPct
    ) {
      return null;
    }
    return { score: SCORE.lineStroke, reason: "line-stroke" };
  }

  if (!pointInNodeFrame(point, node, frame, stageAspect)) {
    return null;
  }

  if (node.content.shape === "ellipse" || node.content.shape === "circle") {
    const dx = (localPoint.x - (frame.x + frame.w / 2)) / (frame.w / 2);
    const dy = (localPoint.y - (frame.y + frame.h / 2)) / (frame.h / 2);
    if (dx * dx + dy * dy > 1) return null;
  }

  if (
    node.content.shape === "triangle" &&
    !pointInTriangle(localPoint, frame)
  ) {
    return null;
  }

  if (node.content.shape === "diamond" && !pointInDiamond(localPoint, frame)) {
    return null;
  }

  const edgeHit =
    distanceToFrameEdge(localPoint, frame, stageAspect) <=
    SHAPE_EDGE_THRESHOLD_PCT;
  return {
    score: edgeHit ? SCORE.shapeEdge : shapeInteriorScore(frame),
    reason: edgeHit ? "shape-edge" : "shape-interior",
  };
}

function hitTestNode(
  point: PointPct,
  node: SlideChildNode,
  frame: LayoutBox["frame"],
  nodesById: ReadonlyMap<string, SlideChildNode>,
  stageAspect: number,
  lineThresholdPct: number,
  selectedNodeIds: ReadonlySet<string> | undefined,
): StageHitCandidate | null {
  const textParagraphs = nodeTextParagraphs(node);
  if (textParagraphs.length > 0) {
    const localPoint = rotatePointAroundCenter(
      point,
      frame,
      node.layout?.rotation ?? 0,
      stageAspect,
    );
    const textFrame = textVisibleFrame(node, frame, stageAspect);
    if (pointInFrame(localPoint, textFrame)) {
      return {
        node,
        frame,
        score: withBonuses(SCORE.textContent, node, selectedNodeIds),
        reason: "text-content",
      };
    }
    if (
      pointInFrame(localPoint, inflateFrame(textFrame, TEXT_NEAR_PADDING_PCT))
    ) {
      return {
        node,
        frame,
        score: withBonuses(SCORE.textNear, node, selectedNodeIds),
        reason: "text-near",
      };
    }
    if (pointInNodeFrame(point, node, frame, stageAspect)) {
      return {
        node,
        frame,
        score: withBonuses(SCORE.textFrame, node, selectedNodeIds),
        reason: "text-frame",
      };
    }
  }

  if (node.type === "shape") {
    const shapeHit = hitTestShape(
      point,
      node,
      frame,
      stageAspect,
      lineThresholdPct,
    );
    if (!shapeHit) return null;
    return {
      node,
      frame,
      score: withBonuses(shapeHit.score, node, selectedNodeIds),
      reason: shapeHit.reason,
    };
  }

  if (node.type === "connector") {
    const path = connectorPathPoints(node, nodesById);
    if (distanceToPath(point, path, stageAspect) > lineThresholdPct) {
      return null;
    }
    return {
      node,
      frame,
      score: withBonuses(SCORE.connectorStroke, node, selectedNodeIds),
      reason: "connector-stroke",
    };
  }

  if (!pointInNodeFrame(point, node, frame, stageAspect)) {
    return null;
  }

  return {
    node,
    frame,
    score: withBonuses(SCORE.boxInterior, node, selectedNodeIds),
    reason: "box-interior",
  };
}

export function hitTestSlideNodes(
  point: PointPct,
  nodes: readonly SlideChildNode[],
  options: StageHitTestOptions = {},
): StageHitCandidate[] {
  const stageAspect = options.stageAspect ?? 1;
  const lineThresholdPct =
    options.lineThresholdPct ?? DEFAULT_LINE_THRESHOLD_PCT;
  const selectedNodeIds =
    options.selectedNodeBonus === false ? undefined : options.selectedNodeIds;
  const allNodes = flattenAllNodes(nodes);
  const nodesById = new Map(allNodes.map((node) => [node.id, node]));

  return flattenHitNodes(nodes)
    .map((node, index) => ({ node, index, frame: node.layout?.frame }))
    .filter(
      (
        candidate,
      ): candidate is {
        node: SlideChildNode;
        index: number;
        frame: LayoutBox["frame"];
      } => candidate.frame !== undefined,
    )
    .filter(({ node }) => node.hidden !== true)
    .filter(({ node }) => options.includeLocked || node.locked !== true)
    .map((candidate) => {
      const hit = hitTestNode(
        point,
        candidate.node,
        candidate.frame,
        nodesById,
        stageAspect,
        lineThresholdPct,
        selectedNodeIds,
      );
      return hit ? { ...hit, index: candidate.index } : null;
    })
    .filter(
      (
        candidate,
      ): candidate is StageHitCandidate & {
        index: number;
      } => candidate !== null,
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        zIndex(right.node) - zIndex(left.node) ||
        right.index - left.index,
    )
    .map(({ index: _index, ...candidate }) => candidate);
}
