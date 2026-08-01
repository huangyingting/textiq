import type { ImageCrop, LayoutBox } from "@/lib/presentation/schema";
import {
  sanitizeImageCropPercent,
  updateImageCropSide as updateImageCropSideWithinBounds,
} from "@/lib/presentation/image-crop";

export function parseFiniteNumberInput(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function clampToRange(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function clampLayoutFrame(
  frame: LayoutBox["frame"],
): LayoutBox["frame"] {
  const w = clampToRange(Number.isFinite(frame.w) ? frame.w : 0.5, 0.5, 100);
  const h = clampToRange(Number.isFinite(frame.h) ? frame.h : 0.5, 0.5, 100);
  const x = clampToRange(Number.isFinite(frame.x) ? frame.x : 0, 0, 100 - w);
  const y = clampToRange(Number.isFinite(frame.y) ? frame.y : 0, 0, 100 - h);
  return { x, y, w, h };
}

export function sanitizeCropPercent(value: number): number | undefined {
  return sanitizeImageCropPercent(value);
}

export function updateImageCropSide(
  crop: ImageCrop | undefined,
  side: keyof ImageCrop,
  value: number,
): ImageCrop | undefined {
  return updateImageCropSideWithinBounds(crop, side, value);
}

export function sanitizePercentPoint(value: number): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  return clampToRange(value, 0, 100);
}

export function sanitizeBoundedNumber(
  value: number,
  min: number,
  max: number,
): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  return clampToRange(value, min, max);
}
