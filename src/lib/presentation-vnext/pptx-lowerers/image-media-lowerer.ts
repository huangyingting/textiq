import type { ExportImageOperation } from "../export-spec-types";
import type { VnextPptxImageOp } from "../pptx-export-types";
import { checkEffect, effectToNativeGlow, frameToInches } from "./shared";
import type { PptxLowererContext } from "./shared";

export function lowerImageOpToPptx(
  op: ExportImageOperation,
  ctx: PptxLowererContext,
): VnextPptxImageOp {
  const frame = frameToInches(op.frame, ctx);
  checkEffect(op.style, ctx.dc, `op(image:${op.id})`);
  const effect = effectToNativeGlow(
    op.style.effect,
    ctx.dc,
    `op(image:${op.id})`,
  );
  return {
    type: "image",
    id: op.id,
    assetId: op.assetId,
    ...frame,
    ...(op.fit !== undefined ? { fit: op.fit } : {}),
    ...(op.crop !== undefined ? { crop: op.crop } : {}),
    ...(op.alt !== undefined ? { alt: op.alt } : {}),
    ...(effect !== undefined ? { effect } : {}),
    ...(op.rotation !== undefined ? { rotation: op.rotation } : {}),
    zIndex: op.zIndex,
  };
}
