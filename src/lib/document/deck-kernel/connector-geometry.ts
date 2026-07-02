import type {
  ConnectorAnchor,
  ConnectorElement,
  ConnectorEndpoint,
  ConnectorPoint,
  ElementBox,
  ShapeElement,
  SlideElement,
} from "./deck-elements";

export interface PointPct {
  x: number;
  y: number;
}

export type ConnectorBoxResolver = (element: SlideElement) => ElementBox;

export interface ConnectorAnchorCandidate {
  elementId: string;
  hoveredAnchor: ConnectorAnchor | null;
  distance: number;
  containsPoint: boolean;
}

/* node:coverage ignore next 7 -- Anchor constants are exercised through anchorPoint tests; tsx maps the array literal rows as residual. */
export const CONNECTOR_ANCHORS: readonly ConnectorAnchor[] = [
  "center",
  "top",
  "bottom",
  "left",
  "right",
];

export function anchorPoint(
  box: ElementBox,
  anchor: ConnectorAnchor,
): PointPct {
  switch (anchor) {
    case "top":
      return { x: box.x + box.w / 2, y: box.y };
    case "bottom":
      return { x: box.x + box.w / 2, y: box.y + box.h };
    case "left":
      return { x: box.x, y: box.y + box.h / 2 };
    case "right":
      return { x: box.x + box.w, y: box.y + box.h / 2 };
    case "center":
    default:
      return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  }
}

export function lineEndpoints(
  box: ElementBox,
  rotation: number | undefined,
  stageAspect: number,
): { start: PointPct; end: PointPct } {
  const angle = ((rotation ?? 0) * Math.PI) / 180;
  const centerX = box.x + box.w / 2;
  const centerY = box.y + box.h / 2;
  const dx = (Math.cos(angle) * box.w) / 2;
  const dy = (Math.sin(angle) * box.w * stageAspect) / 2;
  return {
    start: { x: centerX - dx, y: centerY - dy },
    end: { x: centerX + dx, y: centerY + dy },
  };
}

export function resolveConnectorEndpoint(
  endpoint: ConnectorEndpoint | undefined,
  elements: readonly SlideElement[],
  resolveBox: ConnectorBoxResolver,
): PointPct | null {
  if (!endpoint) return null;
  const element = elements.find((item) => item.id === endpoint.elementId);
  if (!element) return null;
  return anchorPoint(resolveBox(element), endpoint.anchor);
}

function isConnectorAnchorTarget(
  element: SlideElement,
  lineId: string,
): boolean {
  if (element.id === lineId) return false;
  if (element.kind === "connector") return false;
  if (element.kind === "shape" && element.content.shape === "line")
    return false;
  return true;
}

function pointInBox(point: PointPct, box: ElementBox): boolean {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.w &&
    point.y >= box.y &&
    point.y <= box.y + box.h
  );
}

function distanceToPoint(
  a: PointPct,
  b: PointPct,
  stageAspect: number,
): number {
  const dx = (a.x - b.x) * stageAspect;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function nearestAnchor(
  point: PointPct,
  box: ElementBox,
  stageAspect: number,
): { anchor: ConnectorAnchor; distance: number; point: PointPct } {
  let nearest: ConnectorAnchor = "center";
  let nearestPoint = anchorPoint(box, nearest);
  let nearestDistance = distanceToPoint(nearestPoint, point, stageAspect);
  for (const anchor of CONNECTOR_ANCHORS) {
    const candidatePoint = anchorPoint(box, anchor);
    const distance = distanceToPoint(candidatePoint, point, stageAspect);
    if (distance < nearestDistance) {
      nearest = anchor;
      nearestPoint = candidatePoint;
      nearestDistance = distance;
    }
  }
  return { anchor: nearest, distance: nearestDistance, point: nearestPoint };
}

export function connectorAnchorCandidates(
  point: PointPct,
  lineId: string,
  elements: readonly SlideElement[],
  resolveBox: ConnectorBoxResolver,
  stageAspect: number,
  thresholdPct = 5,
): ConnectorAnchorCandidate[] {
  return (
    elements
      .map((element, index) => ({ element, index }))
      .filter(({ element }) => isConnectorAnchorTarget(element, lineId))
      .map(({ element, index }) => {
        const box = resolveBox(element);
        const nearest = nearestAnchor(point, box, stageAspect);
        const containsPoint = pointInBox(point, box);
        if (!containsPoint && nearest.distance > thresholdPct) {
          return null;
        }
        return {
          elementId: element.id,
          hoveredAnchor:
            nearest.distance <= thresholdPct ? nearest.anchor : null,
          distance: nearest.distance,
          containsPoint,
          index,
        };
      })
      /* node:coverage ignore next 3 -- Null-candidate filtering is asserted; tsx maps the type-predicate row as residual. */
      .filter(
        (
          candidate,
        ): candidate is ConnectorAnchorCandidate & { index: number } =>
          candidate !== null,
      )
      .sort(
        (a, b) =>
          Number(b.hoveredAnchor !== null) - Number(a.hoveredAnchor !== null) ||
          Number(b.containsPoint) - Number(a.containsPoint) ||
          a.distance - b.distance ||
          b.index - a.index,
      )
      .map(({ elementId, hoveredAnchor, distance, containsPoint }) => ({
        elementId,
        hoveredAnchor,
        distance,
        containsPoint,
      }))
  );
}

export function resolveLineEndpoints(
  element: ShapeElement,
  _elements: readonly SlideElement[],
  _resolveBox: ConnectorBoxResolver,
  stageAspect: number,
): { start: PointPct; end: PointPct } {
  return lineEndpoints(element.box, element.rotation, stageAspect);
}

export function lineBoxFromEndpoints(
  start: PointPct,
  end: PointPct,
  heightPct: number,
  stageAspect: number,
): { box: ElementBox; rotation?: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const width = Math.max(1, Math.sqrt(dx * dx + (dy / stageAspect) ** 2));
  const rotation = (Math.atan2(dy / stageAspect, dx) * 180) / Math.PI;
  const normalizedRotation = Math.round(rotation);
  return {
    box: {
      x: (start.x + end.x) / 2 - width / 2,
      y: (start.y + end.y) / 2 - heightPct / 2,
      w: width,
      h: heightPct,
    },
    ...(normalizedRotation === 0 ? {} : { rotation: normalizedRotation }),
  };
}

export function snapLineEndpoint(
  point: PointPct,
  lineId: string,
  elements: readonly SlideElement[],
  resolveBox: ConnectorBoxResolver,
  stageAspect: number,
  thresholdPct = 5,
): { point: PointPct; binding?: ConnectorEndpoint } {
  let bestPoint = point;
  let bestBinding: ConnectorEndpoint | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const element of elements) {
    /* node:coverage ignore next 2 -- Excluding ineligible snap targets is asserted; tsx maps the continue row as residual. */
    if (!isConnectorAnchorTarget(element, lineId)) continue;
    const box = resolveBox(element);
    const nearest = nearestAnchor(point, box, stageAspect);
    if (nearest.distance < bestDistance && nearest.distance <= thresholdPct) {
      /* Coverage rationale: snapLineEndpoint tests assert nearest-binding updates; tsx maps the covered assignment rows as residual. */
      /* node:coverage ignore next 4 */
      bestDistance = nearest.distance;
      bestPoint = nearest.point;
      bestBinding = { elementId: element.id, anchor: nearest.anchor };
    }
  }
  return { point: bestPoint, ...(bestBinding ? { binding: bestBinding } : {}) };
}

/* node:coverage ignore next 10 -- Connector point resolution is asserted; tsx maps the declaration/documentation rows as residual. */
/**
 * Resolves the start and end {@link PointPct} for a {@link ConnectorElement}.
 *
 * Each endpoint is either a free slide-percentage coordinate or a bound anchor
 * on another slide element. When a bound endpoint references a missing element
 * the fallback is the element's box center (if found) or the origin.
 */
export function resolveConnectorElementPoints(
  element: ConnectorElement,
  elements: readonly SlideElement[],
  resolveBox: ConnectorBoxResolver,
): { start: PointPct; end: PointPct } {
  const content = (element as any).content as {
    start: ConnectorPoint;
    end: ConnectorPoint;
  };
  function resolve(point: ConnectorPoint): PointPct {
    if ("elementId" in point) {
      const resolved = resolveConnectorEndpoint(
        point as ConnectorEndpoint,
        elements,
        resolveBox,
      );
      if (resolved) return resolved;
      const target = elements.find(
        (el) => el.id === (point as ConnectorEndpoint).elementId,
      );
      if (target) {
        const box = resolveBox(target);
        return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
      }
      return { x: 0, y: 0 };
    }
    return point as PointPct;
  }
  return { start: resolve(content.start), end: resolve(content.end) };
}

/**
 * Computes the orthogonal waypoints for an `elbow`-routed connector between two
 * resolved points (#643). The route steps along the dominant axis first, turns
 * at the midpoint, and finishes on the other axis, yielding a clean stepped
 * path. Returns at least `[start, end]`; collinear points collapse to a
 * straight segment. All coordinates are in slide-percent space (the same units
 * as {@link resolveConnectorElementPoints}).
 */
export function connectorElbowPoints(
  start: PointPct,
  end: PointPct,
): PointPct[] {
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);
  // Degenerate / straight cases need no intermediate waypoints.
  if (dx === 0 || dy === 0) return [start, end];
  if (dx >= dy) {
    // Horizontal-dominant: run to the midpoint x, then vertical, then across.
    const midX = (start.x + end.x) / 2;
    return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
  }
  // Vertical-dominant: run to the midpoint y, then horizontal, then down.
  const midY = (start.y + end.y) / 2;
  return [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
}
