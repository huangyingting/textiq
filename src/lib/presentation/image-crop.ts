import type { ImageCrop } from "./schema";

export const MAX_IMAGE_CROP_SIDE_PERCENT = 95;
export const MAX_IMAGE_CROP_OPPOSING_TOTAL_PERCENT = 98;

const OPPOSITE_CROP_SIDE: Record<keyof ImageCrop, keyof ImageCrop> = {
  top: "bottom",
  right: "left",
  bottom: "top",
  left: "right",
};

export function sanitizeImageCropPercent(
  value: number,
  max = MAX_IMAGE_CROP_SIDE_PERCENT,
): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(max, Math.round(value * 10) / 10));
}

export function updateImageCropSide(
  crop: ImageCrop | undefined,
  side: keyof ImageCrop,
  value: number,
): ImageCrop | undefined {
  const currentCrop: ImageCrop = {
    top: crop?.top ?? 0,
    right: crop?.right ?? 0,
    bottom: crop?.bottom ?? 0,
    left: crop?.left ?? 0,
  };
  const oppositeValue = currentCrop[OPPOSITE_CROP_SIDE[side]];
  const maxForSide = Number.isFinite(oppositeValue)
    ? Math.max(
        0,
        Math.min(
          MAX_IMAGE_CROP_SIDE_PERCENT,
          MAX_IMAGE_CROP_OPPOSING_TOTAL_PERCENT - oppositeValue,
        ),
      )
    : 0;
  const sanitized = sanitizeImageCropPercent(value, maxForSide);
  if (sanitized === undefined) return undefined;
  return { ...currentCrop, [side]: sanitized };
}
