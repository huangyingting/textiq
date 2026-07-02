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

function warnVisualPlaceholderFallback(
  op: ExportVisualOperation,
  ctx: PptxLowererContext,
): void {
  if (op.assetId) return;
  const preflight = op.pptxAssetPreflight;
  const visualId =
    preflight?.status === "missing" || preflight?.status === "unsupported"
      ? (preflight.visualId ?? op.visualId)
      : op.visualId;
  if (preflight?.status === "unsupported") {
    ctx.dc.warning(
      "unsupported-export-feature",
      `Visual op "${op.id}" has a rendered asset${
        preflight.mimeType ? ` (${preflight.mimeType})` : ""
      }, but PPTX export cannot embed that asset type; using a labeled placeholder fallback`,
      {
        path: `op(visual:${op.id})`,
        action: { type: "open-asset-panel" },
        details: {
          exportFeature: "pptx-visual-asset-preflight",
          assetId: preflight.requestedAssetId,
          ...(preflight.visualId ? { visualId: preflight.visualId } : {}),
        },
      },
    );
    return;
  }

  ctx.dc.warning(
    "missing-asset",
    `Visual op "${op.id}" asset preflight found no rendered asset for PPTX image-retry; regenerate the visual or attach a rendered asset from the asset panel before export. Using a labeled placeholder fallback`,
    {
      path: `op(visual:${op.id})`,
      action: { type: "open-asset-panel" },
      details: {
        exportFeature: "pptx-visual-asset-preflight",
        ...(preflight?.status === "missing" && preflight.requestedAssetId
          ? { assetId: preflight.requestedAssetId }
          : {}),
        ...(visualId ? { visualId } : {}),
      },
    },
  );
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
  warnVisualPlaceholderFallback(op, ctx);
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
