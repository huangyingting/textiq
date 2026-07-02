import type {
  ExportConnectorOperation,
  ExportShapeOperation,
} from "../export-spec-types";
import type {
  VnextPptxConnectorOp,
  VnextPptxShapeOp,
} from "../pptx-export-types";
import {
  checkEffect,
  fillToPptxFill,
  frameToInches,
  resolveColor,
} from "./shared";
import type { PptxLowererContext } from "./shared";

export function lowerShapeOpToPptx(
  op: ExportShapeOperation,
  ctx: PptxLowererContext,
): VnextPptxShapeOp {
  const frame = frameToInches(op.frame, ctx);
  checkEffect(op.style, ctx.dc, `op(shape:${op.id})`);
  const fill = fillToPptxFill(op.style.fill, ctx.dc, `op(shape:${op.id}).fill`);
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
    ...(op.rotation !== undefined ? { rotation: op.rotation } : {}),
    zIndex: op.zIndex,
  };
}

export function lowerConnectorOpToPptx(
  op: ExportConnectorOperation,
  ctx: PptxLowererContext,
): VnextPptxConnectorOp {
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
  if (routing === "curved") {
    ctx.dc.warning(
      "unsupported-export-feature",
      `Connector op "${op.id}" uses curved routing; PPTX export uses a straight-line fallback`,
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
    ...(routing !== undefined ? { routing } : {}),
    ...frame,
    ...(stroke !== undefined ? { stroke } : {}),
    startArrow: connectorStyle?.startArrow ?? "none",
    endArrow: connectorStyle?.endArrow ?? "arrow",
    zIndex: op.zIndex,
  };
}
