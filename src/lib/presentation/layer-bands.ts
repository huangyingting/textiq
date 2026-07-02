import type { SlideChildNode, SlideNode } from "./schema";

export type LayeredNodeType = SlideChildNode["type"] | "slide";

const LAYER_BAND_WIDTH = 1000;

export const NODE_LAYER_BANDS: Record<LayeredNodeType, number> = {
  slide: 0,
  shape: 1000,
  image: 2000,
  visual: 2000,
  table: 2200,
  group: 2500,
  connector: 3000,
  text: 4000,
};

function normalizedLocalZIndex(zIndex: number | undefined): number {
  if (typeof zIndex !== "number" || !Number.isFinite(zIndex)) return 0;
  return Math.max(0, Math.min(LAYER_BAND_WIDTH - 1, Math.trunc(zIndex)));
}

export function layerBandForNodeType(type: LayeredNodeType): number {
  return NODE_LAYER_BANDS[type];
}

export function layeredZIndexForNodeType(
  type: LayeredNodeType,
  localZIndex: number | undefined,
): number {
  return layerBandForNodeType(type) + normalizedLocalZIndex(localZIndex);
}

export function nextLayeredZIndex(
  slide: SlideNode | undefined,
  type: LayeredNodeType,
): number {
  const bandStart = layerBandForNodeType(type);
  const bandEnd = bandStart + LAYER_BAND_WIDTH;
  const zIndexes =
    slide?.children
      .map((node) => node.layout?.zIndex)
      .filter(
        (zIndex): zIndex is number =>
          typeof zIndex === "number" &&
          Number.isInteger(zIndex) &&
          zIndex >= bandStart &&
          zIndex < bandEnd,
      ) ?? [];
  return zIndexes.length > 0 ? Math.max(...zIndexes) + 1 : bandStart + 1;
}
