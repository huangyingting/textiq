import type { ExportTextOperation } from "../export-spec-types";
import type { PptxTextOp } from "../pptx-export-types";
import {
  checkEffect,
  effectToNativeGlow,
  frameToInches,
  styleToTextOptions,
} from "./shared";
import type { PptxLowererContext } from "./shared";

export function lowerTextOpToPptx(
  op: ExportTextOperation,
  ctx: PptxLowererContext,
): PptxTextOp {
  const frame = frameToInches(op.frame, ctx);
  checkEffect(op.style, ctx.dc, `op(text:${op.id})`);
  const effect = effectToNativeGlow(
    op.style.effect,
    ctx.dc,
    `op(text:${op.id})`,
  );
  return {
    type: "text",
    id: op.id,
    ...frame,
    content: op.content,
    textStyle: styleToTextOptions(op.style),
    ...(effect !== undefined ? { effect } : {}),
    ...(op.rotation !== undefined ? { rotation: op.rotation } : {}),
    zIndex: op.zIndex,
  };
}
