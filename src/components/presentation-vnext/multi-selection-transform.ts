import type { LayoutBox } from "@/lib/presentation-vnext/schema";

export interface MultiSelectionTransformEntry {
  id: string;
  frame: LayoutBox["frame"];
  rotation?: number;
}

export function multiSelectionBounds(
  entries: readonly MultiSelectionTransformEntry[],
): LayoutBox["frame"] | null {
  if (entries.length === 0) return null;
  const left = Math.min(...entries.map((entry) => entry.frame.x));
  const top = Math.min(...entries.map((entry) => entry.frame.y));
  const right = Math.max(
    ...entries.map((entry) => entry.frame.x + entry.frame.w),
  );
  const bottom = Math.max(
    ...entries.map((entry) => entry.frame.y + entry.frame.h),
  );
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function scaleMultiSelectionFrames(
  entries: readonly MultiSelectionTransformEntry[],
  oldBounds: LayoutBox["frame"],
  newBounds: LayoutBox["frame"],
): Map<string, Partial<LayoutBox>> {
  const patches = new Map<string, Partial<LayoutBox>>();
  if (oldBounds.w <= 0 || oldBounds.h <= 0) return patches;
  for (const entry of entries) {
    const relX = (entry.frame.x - oldBounds.x) / oldBounds.w;
    const relY = (entry.frame.y - oldBounds.y) / oldBounds.h;
    const relW = entry.frame.w / oldBounds.w;
    const relH = entry.frame.h / oldBounds.h;
    patches.set(entry.id, {
      frame: {
        x: newBounds.x + relX * newBounds.w,
        y: newBounds.y + relY * newBounds.h,
        w: Math.max(0.5, relW * newBounds.w),
        h: Math.max(0.5, relH * newBounds.h),
      },
    });
  }
  return patches;
}

function normalizeRotationDegrees(rotation: number): number {
  if (!Number.isFinite(rotation)) return 0;
  const normalized = ((rotation % 360) + 360) % 360;
  return Math.round(normalized * 10) / 10;
}

export function rotateMultiSelectionFrames(
  entries: readonly MultiSelectionTransformEntry[],
  centerX: number,
  centerY: number,
  deltaDegrees: number,
): Map<string, Partial<LayoutBox>> {
  const patches = new Map<string, Partial<LayoutBox>>();
  const radians = (deltaDegrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  for (const entry of entries) {
    const nodeCenterX = entry.frame.x + entry.frame.w / 2;
    const nodeCenterY = entry.frame.y + entry.frame.h / 2;
    const dx = nodeCenterX - centerX;
    const dy = nodeCenterY - centerY;
    const nextCenterX = centerX + dx * cos - dy * sin;
    const nextCenterY = centerY + dx * sin + dy * cos;
    patches.set(entry.id, {
      frame: {
        ...entry.frame,
        x: nextCenterX - entry.frame.w / 2,
        y: nextCenterY - entry.frame.h / 2,
      },
      rotation: normalizeRotationDegrees((entry.rotation ?? 0) + deltaDegrees),
    });
  }
  return patches;
}
