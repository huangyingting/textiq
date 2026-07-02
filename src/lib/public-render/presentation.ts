import type { PresentationDiagnostic } from "@/lib/presentation/diagnostics";
import { collectDocumentBlocks } from "@/lib/content/document-blocks";
import { createBlankDeck } from "@/lib/presentation/empty-deck";
import { openDeckFromJson } from "@/lib/presentation/open-deck";
import type { Deck } from "@/lib/presentation/schema";
import type { ThemePackageV1 } from "@/lib/presentation/theme-package-schema";
import { resolveThemePackageForDeck } from "@/lib/presentation/theme-package-registry";
import type { Visual } from "@/lib/visual/schema";

import { buildPublicAttribution, type PublicAttribution } from "./attribution";

export interface PublicPresentationDocument {
  title: string;
  contentJson: unknown;
  deckJson: unknown;
  owner: {
    name: string | null;
    plan: string;
  };
  customThemePackages?: ThemePackageV1[];
}

export interface PublicPresentationAssetBinding {
  shareId: string;
  mode: "present" | "embed";
}

export interface PublicPresentationModel {
  title: string;
  deck: Deck;
  themePackage: ThemePackageV1;
  visuals: Record<string, Visual>;
  diagnostics: PresentationDiagnostic[];
  recovery?: PublicPresentationRecovery;
  attribution: PublicAttribution;
}

export interface PublicPresentationRecovery {
  error: string;
  validationErrors: string[];
  diagnostics: PresentationDiagnostic[];
}

export function buildPublicPresentationModelAny(
  document: PublicPresentationDocument,
): PublicPresentationModel {
  return buildPublicPresentationModel(document);
}

const PUBLIC_ASSET_ROUTE_PREFIX = "/api/slide-assets/";
const URL_PARSE_BASE = "https://textiq.local";

function bindSlideAssetUrlToShare(
  src: string,
  binding: PublicPresentationAssetBinding,
): string {
  if (!binding.shareId) {
    return src;
  }

  let parsed: URL;
  try {
    parsed = new URL(src, URL_PARSE_BASE);
  } catch {
    return src;
  }

  if (!parsed.pathname.startsWith(PUBLIC_ASSET_ROUTE_PREFIX)) {
    return src;
  }

  parsed.searchParams.set("shareId", binding.shareId);
  parsed.searchParams.set("shareMode", binding.mode);

  if (src.startsWith("/")) {
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  }
  return parsed.toString();
}

function bindDeckAssetUrlsToShare(
  deck: Deck,
  binding?: PublicPresentationAssetBinding,
): Deck {
  if (!binding?.shareId) {
    return deck;
  }

  const images = Object.fromEntries(
    Object.entries(deck.assets.images).map(([assetId, asset]) => [
      assetId,
      { ...asset, src: bindSlideAssetUrlToShare(asset.src, binding) },
    ]),
  );

  const files = deck.assets.files
    ? Object.fromEntries(
        Object.entries(deck.assets.files).map(([assetId, asset]) => [
          assetId,
          { ...asset, src: bindSlideAssetUrlToShare(asset.src, binding) },
        ]),
      )
    : undefined;

  return {
    ...deck,
    assets: {
      ...deck.assets,
      images,
      ...(files ? { files } : {}),
    },
  };
}

function collectPresentationVisuals(
  contentJson: unknown,
): Record<string, Visual> {
  return Object.fromEntries(
    collectDocumentBlocks(contentJson).flatMap((block) =>
      block.kind === "visual" ? [[block.visualId, block.visual]] : [],
    ),
  );
}

export function buildPublicPresentationModel(
  document: PublicPresentationDocument,
  assetBinding?: PublicPresentationAssetBinding,
): PublicPresentationModel {
  const opened = openDeckFromJson(document.deckJson);
  const rawDeck = opened.ok
    ? opened.deck
    : createBlankDeck({ title: document.title });
  const deck = bindDeckAssetUrlsToShare(rawDeck, assetBinding);
  const themeResolution = resolveThemePackageForDeck(deck, {
    customPackages: document.customThemePackages ?? [],
  });
  const recovery = opened.ok
    ? undefined
    : {
        error: opened.error,
        validationErrors:
          opened.errors && opened.errors.length > 0
            ? opened.errors
            : [opened.error],
        diagnostics: opened.diagnostics,
      };

  return {
    title: document.title,
    deck,
    themePackage: themeResolution.package,
    visuals: collectPresentationVisuals(document.contentJson),
    diagnostics: [
      ...(opened.ok ? opened.diagnostics : opened.diagnostics),
      ...themeResolution.diagnostics,
    ],
    ...(recovery ? { recovery } : {}),
    attribution: buildPublicAttribution(document.owner),
  };
}
