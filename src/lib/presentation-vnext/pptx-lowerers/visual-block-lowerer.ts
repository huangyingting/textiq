import type { ExportVisualOperation } from "../export-spec-types";
import type { VnextPptxVisualOp } from "../pptx-export-types";
import {
  checkEffect,
  effectToNativeGlow,
  fillToHex,
  frameToInches,
  resolveColor,
} from "./shared";
import type { PptxLowererContext } from "./shared";

function checkVisualStyle(
  op: ExportVisualOperation,
  ctx: PptxLowererContext,
): void {
  const visual = op.style.visual;
  if (!visual) return;
  if (visual.channelColors && Object.keys(visual.channelColors).length > 0) {
    ctx.dc.warning(
      "unsupported-export-feature",
      `op(visual:${op.id}): visual channel colors require a rendered-asset fallback in PPTX export`,
      {
        path: `op(visual:${op.id}).visual.channelColors`,
        action: { type: "replace-style-ref" },
      },
    );
  }
  if (visual.transparentBackground === true) {
    ctx.dc.warning(
      "unsupported-export-feature",
      `op(visual:${op.id}): transparent visual background requires a rendered-asset fallback in PPTX export`,
      {
        path: `op(visual:${op.id}).visual.transparentBackground`,
        action: { type: "replace-style-ref" },
      },
    );
  }
}

export function lowerVisualOpToPptx(
  op: ExportVisualOperation,
  ctx: PptxLowererContext,
): VnextPptxVisualOp {
  const frame = frameToInches(op.frame, ctx);
  checkEffect(op.style, ctx.dc, `op(visual:${op.id})`);
  const effect = effectToNativeGlow(
    op.style.effect,
    ctx.dc,
    `op(visual:${op.id})`,
  );
  checkVisualStyle(op, ctx);
  const fill = fillToHex(op.style.fill, ctx.dc, `op(visual:${op.id}).fill`);
  const stroke = op.style.stroke
    ? {
        color: resolveColor(
          op.style.stroke.color,
          "#94a3b8",
          ctx.dc,
          `op(visual:${op.id}).stroke`,
        ),
        widthPt: op.style.stroke.widthPt,
      }
    : undefined;
  if (!op.assetId && !op.visualId) {
    ctx.dc.warning(
      "missing-asset",
      `Visual op "${op.id}" has neither assetId nor visualId; PPTX export uses a labeled placeholder fallback`,
      { path: `op(visual:${op.id})`, action: { type: "open-asset-panel" } },
    );
  } else if (!op.assetId && op.visualId) {
    ctx.dc.warning(
      "unsupported-export-feature",
      `Visual op "${op.id}" has no rendered asset; PPTX export uses a labeled placeholder fallback`,
      { path: `op(visual:${op.id})`, action: { type: "open-asset-panel" } },
    );
  }
  return {
    type: "visual",
    id: op.id,
    ...(op.assetId !== undefined ? { assetId: op.assetId } : {}),
    ...(op.visualId !== undefined ? { visualId: op.visualId } : {}),
    ...frame,
    ...(op.channelColors !== undefined
      ? { channelColors: op.channelColors }
      : {}),
    ...(op.transparentBackground !== undefined
      ? { transparentBackground: op.transparentBackground }
      : {}),
    ...(op.alt !== undefined ? { alt: op.alt } : {}),
    ...(effect !== undefined ? { effect } : {}),
    ...(op.rotation !== undefined ? { rotation: op.rotation } : {}),
    ...(fill !== undefined ? { fill } : {}),
    ...(stroke !== undefined ? { stroke } : {}),
    fallbackLabel: op.alt ?? op.visualId ?? "Visual unavailable",
    zIndex: op.zIndex,
  };
}
