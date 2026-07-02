import type { CSSProperties } from "react";

import type { Deck } from "@/lib/presentation/schema";
import {
  fitCanvasToViewport,
  type CanvasStageFit,
  type StageFitSize,
} from "@/lib/presentation/stage-fit";

const STAGE_VIEWPORT_FALLBACK: StageFitSize = { width: 1120, height: 630 };
const DESKTOP_INSPECTOR_OVERLAY_WIDTH = 352;

export function canvasAspectRatio(deck: Pick<Deck, "canvas">): number {
  const width = deck.canvas.width > 0 ? deck.canvas.width : 16;
  const height = deck.canvas.height > 0 ? deck.canvas.height : 9;
  return width / height;
}

export function canvasStageFit(
  deck: Pick<Deck, "canvas">,
  zoomPercent: number,
  viewport: StageFitSize | null,
  isDesktopInspectorViewport: boolean,
): CanvasStageFit {
  const safeViewport = viewport ?? STAGE_VIEWPORT_FALLBACK;
  const rightOverlayWidth = isDesktopInspectorViewport
    ? DESKTOP_INSPECTOR_OVERLAY_WIDTH
    : 0;
  return fitCanvasToViewport({
    viewport: safeViewport,
    aspectRatio: canvasAspectRatio(deck),
    zoomPercent,
    rightOverlayWidth,
  });
}

export function canvasFrameStyle(stageFit: CanvasStageFit): CSSProperties {
  return {
    position: "absolute",
    left: stageFit.frame.left,
    top: stageFit.frame.top,
    width: stageFit.frame.width,
    height: stageFit.frame.height,
  };
}

export function stageScrollContentStyle(
  stageFit: CanvasStageFit,
): CSSProperties {
  return {
    position: "relative",
    width: stageFit.scrollContentSize.width,
    height: stageFit.scrollContentSize.height,
  };
}
