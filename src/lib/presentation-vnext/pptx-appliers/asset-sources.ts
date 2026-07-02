import type { DeckV7 } from "../schema";
import { resolveDeckAssetSource } from "../deck-asset-source";
import type { ExportDeckSpec, ExportVisualOperation } from "../export-spec";
import type { ExportVisualAssetPreflight } from "../export-spec-types";
import type { FillStyle, StyleObject } from "../style-schema";

type AssetCandidate = {
  src?: string;
  mimeType?: string;
  requestedAssetId: string;
  visualId?: string;
  alt?: string;
  source: "declared-asset" | "visual-registry";
};

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

function assetCandidateForId(
  deck: DeckV7,
  assetId: string,
  source: AssetCandidate["source"],
): AssetCandidate {
  const visualAsset = deck.assets.visuals?.[assetId];
  const backingAssetId = visualAsset?.id;
  const imageAsset =
    deck.assets.images[assetId] ??
    (backingAssetId ? deck.assets.images[backingAssetId] : undefined);
  const fileAsset =
    deck.assets.files?.[assetId] ??
    (backingAssetId ? deck.assets.files?.[backingAssetId] : undefined);
  return {
    src: resolveDeckAssetSource(deck, assetId),
    mimeType: imageAsset?.mimeType ?? fileAsset?.mimeType,
    requestedAssetId: assetId,
    ...(visualAsset?.visualId ? { visualId: visualAsset.visualId } : {}),
    ...(visualAsset?.alt ? { alt: visualAsset.alt } : {}),
    source,
  };
}

function assetCandidateForVisualId(
  deck: DeckV7,
  visualId: string,
): AssetCandidate | undefined {
  const entry = Object.entries(deck.assets.visuals ?? {}).find(
    ([, asset]) => asset.visualId === visualId,
  );
  if (!entry) return undefined;
  return assetCandidateForId(deck, entry[0], "visual-registry");
}

function isUnsupportedRenderedAsset(
  src: string,
  mimeType: string | undefined,
): boolean {
  if (mimeType !== undefined && !mimeType.startsWith("image/")) return true;
  return src.startsWith("data:") && !src.startsWith("data:image/");
}

function preflightVisualAsset(
  deck: DeckV7,
  operation: ExportVisualOperation,
): {
  candidate?: AssetCandidate;
  preflight: ExportVisualAssetPreflight;
} {
  const candidate = operation.assetId
    ? assetCandidateForId(deck, operation.assetId, "declared-asset")
    : operation.visualId
      ? assetCandidateForVisualId(deck, operation.visualId)
      : undefined;

  if (!candidate?.src) {
    return {
      candidate,
      preflight: {
        status: "missing",
        ...(operation.assetId ? { requestedAssetId: operation.assetId } : {}),
        ...(operation.visualId ? { visualId: operation.visualId } : {}),
      },
    };
  }

  if (isUnsupportedRenderedAsset(candidate.src, candidate.mimeType)) {
    return {
      candidate,
      preflight: {
        status: "unsupported",
        requestedAssetId: candidate.requestedAssetId,
        ...((candidate.visualId ?? operation.visualId)
          ? { visualId: candidate.visualId ?? operation.visualId }
          : {}),
        ...(candidate.mimeType ? { mimeType: candidate.mimeType } : {}),
      },
    };
  }

  return {
    candidate,
    preflight: {
      status: "ready",
      assetId: candidate.src,
      source: candidate.source,
    },
  };
}

function resolveVisualOperationAssets(
  deck: DeckV7,
  operation: ExportVisualOperation,
): ExportVisualOperation {
  const { candidate, preflight } = preflightVisualAsset(deck, operation);
  const { assetId: originalAssetId, ...rest } = operation;
  void originalAssetId;
  return {
    ...rest,
    style: resolveStyleAssets(deck, operation.style),
    ...(preflight.status === "ready" ? { assetId: preflight.assetId } : {}),
    ...(operation.visualId === undefined && candidate?.visualId
      ? { visualId: candidate.visualId }
      : {}),
    ...(operation.alt === undefined && candidate?.alt
      ? { alt: candidate.alt }
      : {}),
    pptxAssetPreflight: preflight,
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
        if (operation.type === "visual") {
          return resolveVisualOperationAssets(deck, operation);
        }
        if (
          operation.type === "shape" ||
          operation.type === "text" ||
          operation.type === "connector" ||
          operation.type === "tableShape"
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
