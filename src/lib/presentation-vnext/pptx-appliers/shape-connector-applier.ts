import type { ConnectorEndpoint } from "../schema";
import type {
  VnextPptxConnectorOp,
  VnextPptxImageFill,
  VnextPptxShapeOp,
} from "../pptx-export-adapter";
import { effectToPptxShadow, type PptxShadow, type PptxSlide } from "./shared";

function imageSource(assetId: string): { data: string } | { path: string } {
  return assetId.startsWith("data:") ? { data: assetId } : { path: assetId };
}

function addImageFill(
  slide: PptxSlide,
  fill: VnextPptxImageFill,
  op: Pick<VnextPptxShapeOp, "x" | "y" | "w" | "h" | "rotation">,
  shadow?: PptxShadow,
): void {
  slide.addImage({
    ...imageSource(fill.assetId),
    x: op.x,
    y: op.y,
    w: op.w,
    h: op.h,
    ...(fill.fit === "contain" || fill.fit === "cover"
      ? { sizing: { type: fill.fit, w: op.w, h: op.h } }
      : {}),
    ...(op.rotation !== undefined ? { rotate: op.rotation } : {}),
    ...(shadow !== undefined ? { shadow } : {}),
  });
}

/**
 * Maps a v7 shape name string to a PptxGenJS shape name.
 * Falls back to `"rect"` for unknown shapes.
 */
export function vnextShapeToName(shape: string): string {
  const map: Record<string, string> = {
    rect: "rect",
    ellipse: "ellipse",
    circle: "ellipse",
    line: "line",
    triangle: "triangle",
    diamond: "diamond",
    roundRect: "roundRect",
  };
  return map[shape] ?? "rect";
}

export function applyVnextShapeOp(
  slide: PptxSlide,
  op: VnextPptxShapeOp,
): void {
  const { x, y, w, h, shape, fill, stroke, rotation } = op;
  const shadow = effectToPptxShadow(op.effect);
  const shapeName = vnextShapeToName(shape) as Parameters<
    PptxSlide["addShape"]
  >[0];
  if (fill !== undefined && typeof fill !== "string") {
    addImageFill(slide, fill, op, shadow);
    if (stroke !== undefined) {
      slide.addShape(shapeName, {
        x,
        y,
        w,
        h,
        fill: { transparency: 100 },
        line: { color: stroke.color, width: stroke.widthPt },
        ...(rotation !== undefined ? { rotate: rotation } : {}),
        ...(shadow !== undefined ? { shadow } : {}),
      });
    }
    return;
  }
  slide.addShape(shapeName, {
    x,
    y,
    w,
    h,
    ...(fill !== undefined ? { fill: { color: fill } } : {}),
    ...(stroke !== undefined
      ? { line: { color: stroke.color, width: stroke.widthPt } }
      : {}),
    ...(rotation !== undefined ? { rotate: rotation } : {}),
    ...(shadow !== undefined ? { shadow } : {}),
  });
}

function endpointPoint(endpoint: ConnectorEndpoint): { x: number; y: number } {
  if (endpoint.kind === "point") return endpoint.point;
  switch (endpoint.anchor) {
    case "top":
      return { x: 50, y: 0 };
    case "right":
      return { x: 100, y: 50 };
    case "bottom":
      return { x: 50, y: 100 };
    case "left":
      return { x: 0, y: 50 };
    case "center":
    default:
      return { x: 50, y: 50 };
  }
}

function endpointToInches(
  endpoint: ConnectorEndpoint,
  op: VnextPptxConnectorOp,
): { x: number; y: number } {
  const point = endpointPoint(endpoint);
  return {
    x: op.x + (op.w * point.x) / 100,
    y: op.y + (op.h * point.y) / 100,
  };
}

type ConnectorDash = NonNullable<VnextPptxConnectorOp["stroke"]>["dash"];

function dashToPptxDash(dash: ConnectorDash): "solid" | "dash" | "sysDot" {
  if (dash === "dashed") return "dash";
  if (dash === "dotted") return "sysDot";
  return "solid";
}

function arrowToPptxArrow(
  arrow: VnextPptxConnectorOp["startArrow"],
): "none" | "arrow" | "triangle" {
  if (arrow === "filled") return "triangle";
  if (arrow === "arrow") return "arrow";
  return "none";
}

function connectorLineOptions(
  op: VnextPptxConnectorOp,
  includeStartArrow: boolean,
  includeEndArrow: boolean,
): Record<string, unknown> | undefined {
  const line: Record<string, unknown> = {};
  if (op.stroke) {
    line.color = op.stroke.color;
    line.width = op.stroke.widthPt;
    line.dashType = dashToPptxDash(op.stroke.dash);
  }
  if (includeStartArrow && op.startArrow && op.startArrow !== "none") {
    line.beginArrowType = arrowToPptxArrow(op.startArrow);
  }
  if (includeEndArrow && op.endArrow && op.endArrow !== "none") {
    line.endArrowType = arrowToPptxArrow(op.endArrow);
  }
  return Object.keys(line).length > 0 ? line : undefined;
}

function addConnectorSegment(
  slide: PptxSlide,
  op: VnextPptxConnectorOp,
  start: { x: number; y: number },
  end: { x: number; y: number },
  includeStartArrow: boolean,
  includeEndArrow: boolean,
): void {
  const line = connectorLineOptions(op, includeStartArrow, includeEndArrow);
  slide.addShape("line" as Parameters<PptxSlide["addShape"]>[0], {
    x: start.x,
    y: start.y,
    w: end.x - start.x,
    h: end.y - start.y,
    ...(line !== undefined ? { line } : {}),
  });
}

export function applyVnextConnectorOp(
  slide: PptxSlide,
  op: VnextPptxConnectorOp,
): void {
  const start = endpointToInches(op.from, op);
  const end = endpointToInches(op.to, op);
  const routing = op.routing ?? "straight";

  if (routing === "elbow") {
    const midX = start.x + (end.x - start.x) / 2;
    const first = { x: midX, y: start.y };
    const second = { x: midX, y: end.y };
    addConnectorSegment(slide, op, start, first, true, false);
    addConnectorSegment(slide, op, first, second, false, false);
    addConnectorSegment(slide, op, second, end, false, true);
    return;
  }

  if (routing === "curved") {
    const line = connectorLineOptions(op, true, true);
    slide.addShape("arc" as Parameters<PptxSlide["addShape"]>[0], {
      x: op.x,
      y: op.y,
      w: op.w,
      h: op.h,
      ...(line !== undefined ? { line } : {}),
    });
    return;
  }

  addConnectorSegment(slide, op, start, end, true, true);
}
