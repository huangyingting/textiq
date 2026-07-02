import type { VnextPptxImageOp } from "../pptx-export-adapter";
import { effectToPptxShadow, type PptxCoord, type PptxSlide } from "./shared";

export async function applyVnextImageOp(
  slide: PptxSlide,
  op: VnextPptxImageOp,
): Promise<void> {
  const { x, y, w, h, assetId, alt, rotation } = op;
  if (!assetId) return;
  // assetId is treated as a URL/data-URI; in a full integration
  // the caller resolves it before export.
  const source = assetId.startsWith("data:")
    ? { data: assetId }
    : { path: assetId };
  const sizing = imageSizingOptions(op);
  const shadow = effectToPptxShadow(op.effect);
  slide.addImage({
    ...source,
    x,
    y,
    w,
    h,
    ...(sizing !== undefined ? { sizing } : {}),
    ...(alt ? { altText: alt } : {}),
    ...(rotation !== undefined ? { rotate: rotation } : {}),
    ...(shadow !== undefined ? { shadow } : {}),
  });
}

function imageSizingOptions(op: VnextPptxImageOp):
  | {
      type: "contain" | "cover" | "crop";
      w: PptxCoord;
      h: PptxCoord;
      x?: PptxCoord;
      y?: PptxCoord;
    }
  | undefined {
  const crop = op.crop;
  const cropValues = crop ? [crop.top, crop.right, crop.bottom, crop.left] : [];
  const hasCrop = cropValues.some((value) => value > 0);
  if (crop && hasCrop) {
    const visibleW = Math.max(0, 100 - crop.left - crop.right);
    const visibleH = Math.max(0, 100 - crop.top - crop.bottom);
    return {
      type: "crop",
      x: toPercentCoord(crop.left),
      y: toPercentCoord(crop.top),
      w: toPercentCoord(visibleW),
      h: toPercentCoord(visibleH),
    };
  }
  if (op.fit === "contain" || op.fit === "cover") {
    return { type: op.fit, w: op.w, h: op.h };
  }

  function toPercentCoord(value: number): `${number}%` {
    return `${value}%`;
  }
  return undefined;
}
