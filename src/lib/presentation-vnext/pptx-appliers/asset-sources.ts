import type { DeckV7 } from "../schema";
import { resolveDeckAssetSource } from "../deck-asset-source";
import type { ExportDeckSpec } from "../export-spec";
import type { FillStyle, StyleObject } from "../style-schema";

function resolveFillAsset(
  deck: DeckV7,
  fill: FillStyle | undefined,
): FillStyle | undefined {
  if (fill?.type !== "image") return fill;
  return {
    ...fill,
    assetId: resolveDeckAssetSource(deck, fill.assetId) ?? fill.assetId,
  };
}

function resolveStyleAssets(deck: DeckV7, style: StyleObject): StyleObject {
  return {
    ...style,
    fill: resolveFillAsset(deck, style.fill),
  };
}

export function resolveExportSpecAssetSources(
  deck: DeckV7,
  exportSpec: ExportDeckSpec,
): ExportDeckSpec {
  return {
    ...exportSpec,
    slides: exportSpec.slides.map((slide) => ({
      ...slide,
      background: {
        ...slide.background,
        fill: resolveFillAsset(deck, slide.background.fill),
      },
      operations: slide.operations.map((operation) => {
        if (operation.type === "image") {
          return {
            ...operation,
            assetId:
              resolveDeckAssetSource(deck, operation.assetId) ??
              operation.assetId,
          };
        }
        if (operation.type === "visual" && operation.assetId) {
          const assetSource = resolveDeckAssetSource(deck, operation.assetId);
          const visualAsset = deck.assets.visuals?.[operation.assetId];
          const { assetId: originalAssetId, ...rest } = operation;
          void originalAssetId;
          return {
            ...rest,
            style: resolveStyleAssets(deck, operation.style),
            ...(assetSource ? { assetId: assetSource } : {}),
            ...(operation.visualId === undefined && visualAsset?.visualId
              ? { visualId: visualAsset.visualId }
              : {}),
            ...(operation.alt === undefined && visualAsset?.alt
              ? { alt: visualAsset.alt }
              : {}),
          };
        }
        if (
          operation.type === "shape" ||
          operation.type === "text" ||
          operation.type === "connector" ||
          operation.type === "tableShape" ||
          operation.type === "visual"
        ) {
          return {
            ...operation,
            style: resolveStyleAssets(deck, operation.style),
          };
        }
        return operation;
      }),
    })),
  };
}
