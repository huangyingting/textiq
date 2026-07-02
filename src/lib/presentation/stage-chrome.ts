export const STAGE_CHROME_Z_INDEX = {
  elementOverlayOffset: 1,
  selectedElementOverlay: 2000,
  preselectedFrame: 2100,
  selectedFrame: 2110,
  groupFrame: 2120,
  multiSelectionBounds: 2130,
  connectorAnchorPreview: 2200,
  cropHandle: 2210,
  snapGuide: 2300,
  marquee: 2400,
  liveBadge: 2450,
  inlineEditor: 2500,
} as const;

export function stageElementOverlayZIndex({
  elementZIndex,
  selected,
}: {
  elementZIndex: number;
  selected: boolean;
}): number {
  return selected
    ? STAGE_CHROME_Z_INDEX.selectedElementOverlay
    : elementZIndex + STAGE_CHROME_Z_INDEX.elementOverlayOffset;
}

export interface SelectionFrameChrome {
  borderWidthPx: number;
  opacity: number;
  zIndex: number;
}

export function selectionFrameChrome(
  variant: "selected" | "preselected" | "activeGroup",
): SelectionFrameChrome {
  if (variant === "activeGroup") {
    return {
      borderWidthPx: 2,
      opacity: 0.9,
      zIndex: STAGE_CHROME_Z_INDEX.groupFrame,
    };
  }
  return variant === "selected"
    ? {
        borderWidthPx: 2,
        opacity: 1,
        zIndex: STAGE_CHROME_Z_INDEX.selectedFrame,
      }
    : {
        borderWidthPx: 2,
        opacity: 0.7,
        zIndex: STAGE_CHROME_Z_INDEX.preselectedFrame,
      };
}
