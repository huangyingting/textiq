import type { LayoutBox } from "../schema";

/** Converts a slide-percent frame to pixel frame given canvas dimensions. */
export function frameToPx(
  frame: { x: number; y: number; w: number; h: number },
  canvasWidthPx: number,
  canvasHeightPx: number,
): { x: number; y: number; w: number; h: number } {
  return {
    x: (frame.x / 100) * canvasWidthPx,
    y: (frame.y / 100) * canvasHeightPx,
    w: (frame.w / 100) * canvasWidthPx,
    h: (frame.h / 100) * canvasHeightPx,
  };
}

export function resolveLayoutFramePass(
  layout: LayoutBox,
  canvasWidthPx: number,
  canvasHeightPx: number,
): LayoutBox & { framePx: { x: number; y: number; w: number; h: number } } {
  return {
    ...layout,
    framePx: frameToPx(layout.frame, canvasWidthPx, canvasHeightPx),
  };
}
