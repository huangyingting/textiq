import type { PresentationDiagnostic } from "@/lib/presentation-vnext/diagnostics";
import { collectDocumentBlocks } from "@/lib/content/document-blocks";
import { createBlankDeckV7 } from "@/lib/presentation-vnext/empty-deck";
import { openDeckFromJson } from "@/lib/presentation-vnext/open-deck";
import type { DeckV7 } from "@/lib/presentation-vnext/schema";
import type { ThemePackageV1 } from "@/lib/presentation-vnext/theme-package-schema";
import { resolveThemePackageForDeck } from "@/lib/presentation-vnext/theme-package-registry";
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
  deckV7: DeckV7;
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
  deck: DeckV7,
  binding?: PublicPresentationAssetBinding,
): DeckV7 {
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
  const rawDeckV7 = opened.ok
    ? opened.deck
    : createBlankDeckV7({ title: document.title });
  const deckV7 = bindDeckAssetUrlsToShare(rawDeckV7, assetBinding);
  const themeResolution = resolveThemePackageForDeck(deckV7, {
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
    deckV7,
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
