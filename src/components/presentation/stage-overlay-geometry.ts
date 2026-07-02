import type { ImageCrop, LayoutBox } from "@/lib/presentation/schema";

import type { CropHandlePosition, ResizeHandlePosition } from "./slide-canvas";

export function clampFrame(frame: LayoutBox["frame"]): LayoutBox["frame"] {
  const w = Math.max(
    0.5,
    Math.min(100, Number.isFinite(frame.w) ? frame.w : 0.5),
  );
  const h = Math.max(
    0.5,
    Math.min(100, Number.isFinite(frame.h) ? frame.h : 0.5),
  );
  return {
    x: Math.max(0, Math.min(100 - w, Number.isFinite(frame.x) ? frame.x : 0)),
    y: Math.max(0, Math.min(100 - h, Number.isFinite(frame.y) ? frame.y : 0)),
    w,
    h,
  };
}

export function framesEqual(
  left: LayoutBox["frame"],
  right: LayoutBox["frame"],
): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.w === right.w &&
    left.h === right.h
  );
}

export function clampCrop(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(95, Math.round(value * 10) / 10));
}

export function cropsEqual(a: ImageCrop, b: ImageCrop): boolean {
  return (
    a.top === b.top &&
    a.right === b.right &&
    a.bottom === b.bottom &&
    a.left === b.left
  );
}

export function normalizeRotationDegrees(rotation: number): number {
  if (!Number.isFinite(rotation)) return 0;
  const normalized = ((rotation % 360) + 360) % 360;
  return Math.round(normalized * 10) / 10;
}

export function snapRotationDegrees(rotation: number, snap: boolean): number {
  return normalizeRotationDegrees(
    snap ? Math.round(rotation / 15) * 15 : rotation,
  );
}

export function resizeFrame(
  frame: LayoutBox["frame"],
  handle: ResizeHandlePosition,
  deltaX: number,
  deltaY: number,
): LayoutBox["frame"] {
  let { x, y, w, h } = frame;
  if (handle.includes("w")) {
    x += deltaX;
    w -= deltaX;
  }
  if (handle.includes("e")) {
    w += deltaX;
  }
  if (handle.includes("n")) {
    y += deltaY;
    h -= deltaY;
  }
  if (handle.includes("s")) {
    h += deltaY;
  }
  if (w < 0.5 && handle.includes("w")) x -= 0.5 - w;
  if (h < 0.5 && handle.includes("n")) y -= 0.5 - h;
  return clampFrame({ x, y, w, h });
}

export function applyAspectLock(
  original: LayoutBox["frame"],
  next: LayoutBox["frame"],
): LayoutBox["frame"] {
  const aspect = original.w / original.h;
  if (!Number.isFinite(aspect) || aspect <= 0) return next;
  const widthDelta = Math.abs(next.w - original.w);
  const heightDelta = Math.abs(next.h - original.h);
  return widthDelta >= heightDelta
    ? clampFrame({ ...next, h: next.w / aspect })
    : clampFrame({ ...next, w: next.h * aspect });
}

export function cropForHandleDrag({
  handle,
  startCrop,
  startPoint,
  nextPoint,
  frame,
}: {
  handle: CropHandlePosition;
  startCrop: ImageCrop;
  startPoint: { x: number; y: number };
  nextPoint: { x: number; y: number };
  frame: LayoutBox["frame"];
}): ImageCrop {
  const deltaX = ((nextPoint.x - startPoint.x) / frame.w) * 100;
  const deltaY = ((nextPoint.y - startPoint.y) / frame.h) * 100;
  const nextCrop: ImageCrop = { ...startCrop };
  if (handle === "left") nextCrop.left = clampCrop(startCrop.left + deltaX);
  if (handle === "right") nextCrop.right = clampCrop(startCrop.right - deltaX);
  if (handle === "top") nextCrop.top = clampCrop(startCrop.top + deltaY);
  if (handle === "bottom")
    nextCrop.bottom = clampCrop(startCrop.bottom - deltaY);
  return nextCrop;
}

export function clientDeltaPct({
  startClientX,
  startClientY,
  nextClientX,
  nextClientY,
  rectWidth,
  rectHeight,
}: {
  startClientX: number;
  startClientY: number;
  nextClientX: number;
  nextClientY: number;
  rectWidth: number;
  rectHeight: number;
}): { x: number; y: number } {
  return {
    x: ((nextClientX - startClientX) / rectWidth) * 100,
    y: ((nextClientY - startClientY) / rectHeight) * 100,
  };
}

export function frameCenterClientPoint(
  frame: LayoutBox["frame"],
  rect: Pick<DOMRect, "left" | "top" | "width" | "height">,
): { x: number; y: number } {
  return {
    x: rect.left + ((frame.x + frame.w / 2) / 100) * rect.width,
    y: rect.top + ((frame.y + frame.h / 2) / 100) * rect.height,
  };
}

export function clientAngleDegrees(
  point: { x: number; y: number },
  center: { x: number; y: number },
): number {
  return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
}
