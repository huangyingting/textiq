/**
 * Stage helpers for fitting a canvas into a container and converting between
 * canvas-relative percent coordinates and container pixel coordinates.
 *
 * All helpers are pure and dependency-free so they can be used in both the
 * editor and present-mode surfaces without bringing in React or DOM globals.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StageFit = {
  /** Uniform scale factor applied to the canvas. */
  scale: number;
  /** Horizontal pixel offset from container origin to canvas origin. */
  offsetX: number;
  /** Vertical pixel offset from container origin to canvas origin. */
  offsetY: number;
};

// ---------------------------------------------------------------------------
// Fit calculation
// ---------------------------------------------------------------------------

/**
 * Computes the scale and offset needed to fit a canvas of `canvasW × canvasH`
 * inside a container of `containerW × containerH` with optional uniform
 * `padding` on all sides.  The canvas is centred within the available space.
 */
export function fitCanvasToContainer(
  containerW: number,
  containerH: number,
  canvasW: number,
  canvasH: number,
  padding = 0,
): StageFit {
  const availW = Math.max(0, containerW - padding * 2);
  const availH = Math.max(0, containerH - padding * 2);

  const scale =
    canvasW > 0 && canvasH > 0
      ? Math.min(availW / canvasW, availH / canvasH)
      : 1;

  const scaledW = canvasW * scale;
  const scaledH = canvasH * scale;
  const offsetX = padding + (availW - scaledW) / 2;
  const offsetY = padding + (availH - scaledH) / 2;

  return { scale, offsetX, offsetY };
}

// ---------------------------------------------------------------------------
// Coordinate conversion
// ---------------------------------------------------------------------------

/**
 * Converts a canvas-relative percent point to container pixel coordinates.
 *
 * @param pctX - canvas-relative x percent (0–100)
 * @param pctY - canvas-relative y percent (0–100)
 * @param canvasW - canvas logical width (in the same unit used for `fit`)
 * @param canvasH - canvas logical height
 * @param fit - stage fit produced by {@link fitCanvasToContainer}
 */
export function canvasPctToContainerPx(
  pctX: number,
  pctY: number,
  canvasW: number,
  canvasH: number,
  fit: StageFit,
): { x: number; y: number } {
  return {
    x: fit.offsetX + (pctX / 100) * canvasW * fit.scale,
    y: fit.offsetY + (pctY / 100) * canvasH * fit.scale,
  };
}

/**
 * Converts container pixel coordinates back to canvas-relative percent.
 *
 * Values are not clamped — the caller should clamp to [0, 100] when needed.
 */
export function containerPxToCanvasPct(
  px: number,
  py: number,
  canvasW: number,
  canvasH: number,
  fit: StageFit,
): { x: number; y: number } {
  const scaledW = canvasW * fit.scale;
  const scaledH = canvasH * fit.scale;
  return {
    x: scaledW > 0 ? ((px - fit.offsetX) / scaledW) * 100 : 0,
    y: scaledH > 0 ? ((py - fit.offsetY) / scaledH) * 100 : 0,
  };
}
