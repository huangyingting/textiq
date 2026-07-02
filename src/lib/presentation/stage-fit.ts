export type StageFitSize = { width: number; height: number };

export type StageFitRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type CanvasStageFit = {
  frame: StageFitRect;
  scrollContentSize: StageFitSize;
  needsScroll: boolean;
};

export function fitCanvasToViewport({
  viewport,
  aspectRatio,
  zoomPercent,
  rightOverlayWidth = 0,
}: {
  viewport: StageFitSize;
  aspectRatio: number;
  zoomPercent: number;
  rightOverlayWidth?: number;
}): CanvasStageFit {
  const viewportWidth = Math.max(1, viewport.width);
  const viewportHeight = Math.max(1, viewport.height);
  const overlayWidth = Math.min(
    Math.max(0, rightOverlayWidth),
    Math.max(0, viewportWidth - 1),
  );
  const fitViewportWidth = Math.max(1, viewportWidth - overlayWidth);
  const safeAspectRatio = aspectRatio > 0 ? aspectRatio : 16 / 9;
  const safeZoom = Math.max(0.25, Math.min(2, zoomPercent / 100));
  const viewportAspectRatio = fitViewportWidth / viewportHeight;
  const fitted =
    viewportAspectRatio > safeAspectRatio
      ? {
          width: viewportHeight * safeAspectRatio,
          height: viewportHeight,
        }
      : {
          width: fitViewportWidth,
          height: fitViewportWidth / safeAspectRatio,
        };

  const frameWidth = fitted.width * safeZoom;
  const frameHeight = fitted.height * safeZoom;
  const leftMargin = Math.max(0, (fitViewportWidth - frameWidth) / 2);
  const topMargin = Math.max(0, (viewportHeight - frameHeight) / 2);
  const frameLeft = leftMargin;
  const frameTop = topMargin;
  const frameRight = frameLeft + frameWidth;
  const scrollContentSize = {
    width: Math.max(viewportWidth, frameRight + leftMargin + overlayWidth),
    height: Math.max(viewportHeight, frameTop + frameHeight + topMargin),
  };

  return {
    frame: {
      left: frameLeft,
      top: frameTop,
      width: frameWidth,
      height: frameHeight,
    },
    scrollContentSize,
    needsScroll:
      scrollContentSize.width > viewportWidth + 1 ||
      scrollContentSize.height > viewportHeight + 1,
  };
}
