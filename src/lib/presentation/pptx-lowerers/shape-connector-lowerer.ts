import type {
  ExportConnectorOperation,
  ExportShapeOperation,
} from "../export-spec-types";
import type { PptxConnectorOp, PptxShapeOp } from "../pptx-export-types";
import {
  effectToImageRetryFill,
  effectToNativeGlow,
  fillToPptxFill,
  frameToInches,
  resolveColor,
} from "./shared";
import type { PptxLowererContext } from "./shared";

export function lowerShapeOpToPptx(
  op: ExportShapeOperation,
  ctx: PptxLowererContext,
): PptxShapeOp {
  const frame = frameToInches(op.frame, ctx);
  const effectFill = effectToImageRetryFill(
    op.style,
    op.shape,
    ctx.dc,
    `op(shape:${op.id})`,
  );
  const fill =
    effectFill ??
    fillToPptxFill(op.style.fill, ctx.dc, `op(shape:${op.id}).fill`);
  const effect = effectToNativeGlow(
    op.style.effect,
    ctx.dc,
    `op(shape:${op.id})`,
  );
  const stroke = op.style.stroke
    ? {
        color: resolveColor(
          op.style.stroke.color,
          "#000000",
          ctx.dc,
          `op(shape:${op.id}).stroke`,
        ),
        widthPt: op.style.stroke.widthPt,
      }
    : undefined;
  return {
    type: "shape",
    id: op.id,
    shape: op.shape,
    ...frame,
    ...(fill !== undefined ? { fill } : {}),
    ...(stroke !== undefined ? { stroke } : {}),
    ...(effect !== undefined ? { effect } : {}),
    ...(op.rotation !== undefined ? { rotation: op.rotation } : {}),
    zIndex: op.zIndex,
  };
}

function isSimpleNativeCurve(op: ExportConnectorOperation): boolean {
  if (op.from.kind !== "point" || op.to.kind !== "point") return false;
  if (op.frame.w <= 0 || op.frame.h <= 0) return false;
  const dx = Math.abs(op.to.point.x - op.from.point.x);
  const dy = Math.abs(op.to.point.y - op.from.point.y);
  return dx > 0 || dy > 0;
}

export function lowerConnectorOpToPptx(
  op: ExportConnectorOperation,
  ctx: PptxLowererContext,
): PptxConnectorOp {
  const frame = frameToInches(op.frame, ctx);
  const connectorStyle = op.style.connector;
  const sourceStroke = connectorStyle?.stroke ?? op.style.stroke;
  const stroke = sourceStroke
    ? {
        color: resolveColor(
          sourceStroke.color,
          "#000000",
          ctx.dc,
          `op(connector:${op.id}).stroke`,
        ),
        widthPt: sourceStroke.widthPt,
        ...(sourceStroke.dash !== undefined ? { dash: sourceStroke.dash } : {}),
      }
    : undefined;
  const routing = op.routing ?? connectorStyle?.routing;
  const nativeRouting =
    routing === "curved" && !isSimpleNativeCurve(op) ? "straight" : routing;
  if (routing === "curved" && nativeRouting !== "curved") {
    ctx.dc.warning(
      "unsupported-export-feature",
      `Connector op "${op.id}" uses unsupported curved routing geometry; PPTX export keeps an editable straight-line fallback`,
      {
        path: `op(connector:${op.id}).routing`,
        action: { type: "replace-style-ref" },
      },
    );
  }
  return {
    type: "connector",
    id: op.id,
    from: op.from,
    to: op.to,
    ...(nativeRouting !== undefined ? { routing: nativeRouting } : {}),
    ...frame,
    ...(stroke !== undefined ? { stroke } : {}),
    startArrow: connectorStyle?.startArrow ?? "none",
    endArrow: connectorStyle?.endArrow ?? "arrow",
    zIndex: op.zIndex,
  };
}
