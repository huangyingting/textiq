import type { Deck } from "../schema";
import { resolveDeckAssetSource } from "../deck-asset-source";
import type { ThemePackageV1 } from "../theme-package-schema";
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
  deck: Deck,
  fill: FillStyle | undefined,
  pkg?: ThemePackageV1 | null,
): FillStyle | undefined {
  if (fill?.type !== "image") return fill;
  return {
    ...fill,
    assetId: resolveDeckAssetSource(deck, fill.assetId, pkg) ?? fill.assetId,
  };
}

function resolveStyleAssets(
  deck: Deck,
  style: StyleObject,
  pkg?: ThemePackageV1 | null,
): StyleObject {
  return {
    ...style,
    fill: resolveFillAsset(deck, style.fill, pkg),
  };
}

function assetCandidateForId(
  deck: Deck,
  assetId: string,
  source: AssetCandidate["source"],
  pkg?: ThemePackageV1 | null,
): AssetCandidate {
  const visualAsset = deck.assets.visuals?.[assetId];
  const backingAssetId = visualAsset?.id;
  const imageAsset =
    deck.assets.images[assetId] ??
    pkg?.assets?.images?.[assetId] ??
    (backingAssetId ? deck.assets.images[backingAssetId] : undefined);
  const fileAsset =
    deck.assets.files?.[assetId] ??
    (backingAssetId ? deck.assets.files?.[backingAssetId] : undefined);
  return {
    src: resolveDeckAssetSource(deck, assetId, pkg),
    mimeType: imageAsset?.mimeType ?? fileAsset?.mimeType,
    requestedAssetId: assetId,
    ...(visualAsset?.visualId ? { visualId: visualAsset.visualId } : {}),
    ...(visualAsset?.alt ? { alt: visualAsset.alt } : {}),
    source,
  };
}

function assetCandidateForVisualId(
  deck: Deck,
  visualId: string,
  pkg?: ThemePackageV1 | null,
): AssetCandidate | undefined {
  const entry = Object.entries(deck.assets.visuals ?? {}).find(
    ([, asset]) => asset.visualId === visualId,
  );
  if (!entry) return undefined;
  return assetCandidateForId(deck, entry[0], "visual-registry", pkg);
}

function isUnsupportedRenderedAsset(
  src: string,
  mimeType: string | undefined,
): boolean {
  if (mimeType !== undefined && !mimeType.startsWith("image/")) return true;
  return src.startsWith("data:") && !src.startsWith("data:image/");
}

function preflightVisualAsset(
  deck: Deck,
  operation: ExportVisualOperation,
  pkg?: ThemePackageV1 | null,
): {
  candidate?: AssetCandidate;
  preflight: ExportVisualAssetPreflight;
} {
  const candidate = operation.assetId
    ? assetCandidateForId(deck, operation.assetId, "declared-asset", pkg)
    : operation.visualId
      ? assetCandidateForVisualId(deck, operation.visualId, pkg)
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
  deck: Deck,
  operation: ExportVisualOperation,
  pkg?: ThemePackageV1 | null,
): ExportVisualOperation {
  const { candidate, preflight } = preflightVisualAsset(deck, operation, pkg);
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
  deck: Deck,
  exportSpec: ExportDeckSpec,
  pkg?: ThemePackageV1 | null,
): ExportDeckSpec {
  return {
    ...exportSpec,
    slides: exportSpec.slides.map((slide) => ({
      ...slide,
      background: {
        ...slide.background,
        fill: resolveFillAsset(deck, slide.background.fill, pkg),
      },
      operations: slide.operations.map((operation) => {
        if (operation.type === "image") {
          return {
            ...operation,
            assetId:
              resolveDeckAssetSource(deck, operation.assetId, pkg) ??
              operation.assetId,
          };
        }
        if (operation.type === "visual") {
          return resolveVisualOperationAssets(deck, operation, pkg);
        }
        if (
          operation.type === "shape" ||
          operation.type === "text" ||
          operation.type === "connector" ||
          operation.type === "tableShape"
        ) {
          return {
            ...operation,
            style: resolveStyleAssets(deck, operation.style, pkg),
          };
        }
        return operation;
      }),
    })),
  };
}
