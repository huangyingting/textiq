import type { PresentationDiagnostic } from "@/lib/presentation/diagnostics";
import {
  collectDocumentBlocks,
  type DocumentBlock,
} from "@/lib/content/document-blocks";
import { deriveDeckFromDocumentContent } from "@/lib/presentation/deck-derivation";
import { createBlankDeck } from "@/lib/presentation/empty-deck";
import { openDeckFromJson } from "@/lib/presentation/open-deck";
import type { Deck } from "@/lib/presentation/schema";
import { DEFAULT_THEME_PACKAGE_ID } from "@/lib/presentation/theme-package-ids";
import type { ThemePackageV1 } from "@/lib/presentation/theme-package-schema";
import { resolveThemePackageForDeck } from "@/lib/presentation/theme-package-registry";
import type { Visual } from "@/lib/visual/schema";

import { buildPublicAttribution, type PublicAttribution } from "./attribution";

export interface PublicPresentationDocument {
  id?: string;
  title: string;
  contentJson: unknown;
  deckJson: unknown;
  owner: {
    name: string | null;
    plan: string;
  };
  activeCustomThemePackage?: ThemePackageV1;
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
  fallback: "derived" | "none";
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

function collectPresentationVisualsFromBlocks(
  blocks: readonly DocumentBlock[],
): Record<string, Visual> {
  return Object.fromEntries(
    blocks.flatMap((block) =>
      block.kind === "visual" ? [[block.visualId, block.visual]] : [],
    ),
  );
}

function hasUsablePresentationContent(
  blocks: readonly DocumentBlock[],
): boolean {
  return blocks.some((block) => {
    if (block.kind === "visual") return true;
    if (block.kind === "table") {
      return (
        (block.caption?.trim().length ?? 0) > 0 ||
        block.columns.some((column) => column.label.trim().length > 0) ||
        block.rows.some((row) =>
          row.cells.some((cell) => cell.text.trim().length > 0),
        )
      );
    }
    return block.text.trim().length > 0;
  });
}

export function publicPresentationRecoveryForViewer(
  recovery: PublicPresentationRecovery | undefined,
): PublicPresentationRecovery | undefined {
  return recovery?.fallback === "derived" ? undefined : recovery;
}

export function buildPublicPresentationModel(
  document: PublicPresentationDocument,
  assetBinding?: PublicPresentationAssetBinding,
): PublicPresentationModel {
  const contentBlocks = collectDocumentBlocks(document.contentJson);
  const opened = openDeckFromJson(document.deckJson);
  let rawDeck: Deck;
  let recovery: PublicPresentationRecovery | undefined;
  let fallbackDiagnostics: PresentationDiagnostic[] = [];

  if (opened.ok) {
    rawDeck = opened.deck;
  } else {
    const validationErrors =
      opened.errors && opened.errors.length > 0
        ? opened.errors
        : [opened.error];
    const canDeriveFallback = hasUsablePresentationContent(contentBlocks);
    const derived = canDeriveFallback
      ? deriveDeckFromDocumentContent({
          contentJson: document.contentJson,
          documentId: document.id,
          themePackageId: DEFAULT_THEME_PACKAGE_ID,
        })
      : null;
    fallbackDiagnostics = derived?.diagnostics ?? [];

    if (derived?.ok) {
      rawDeck = derived.deck;
      recovery = {
        error: opened.error,
        validationErrors,
        diagnostics: opened.diagnostics,
        fallback: "derived",
      };
    } else {
      rawDeck = createBlankDeck({
        title: document.title,
        documentId: document.id,
      });
      recovery = {
        error: opened.error,
        validationErrors: [
          ...validationErrors,
          ...(derived && !derived.ok
            ? (derived.validationErrors ?? [derived.error])
            : []),
        ],
        diagnostics: [...opened.diagnostics, ...fallbackDiagnostics],
        fallback: "none",
      };
    }
  }

  const deck = bindDeckAssetUrlsToShare(rawDeck, assetBinding);
  const themeResolution = resolveThemePackageForDeck(deck, {
    activePackages: document.activeCustomThemePackage
      ? [document.activeCustomThemePackage]
      : [],
  });

  return {
    title: document.title,
    deck,
    themePackage: themeResolution.package,
    visuals: collectPresentationVisualsFromBlocks(contentBlocks),
    diagnostics: [
      ...opened.diagnostics,
      ...fallbackDiagnostics,
      ...themeResolution.diagnostics,
    ],
    ...(recovery ? { recovery } : {}),
    attribution: buildPublicAttribution(document.owner),
  };
}
