import "server-only";

import { prisma } from "@/lib/prisma";
import { loadCustomThemePackagesForDeckJson } from "@/lib/presentation-vnext/brand-kit/persistence";

import {
  resolvePublicRenderWithSource,
  type PublicRenderDocumentRow,
  type ResolvePublicRenderInput,
} from "./resolver-core";
import {
  PUBLIC_RENDER_ASSET_ACCESS_SELECT,
  selectForPublicRenderProjection,
} from "./resolver-selects";

export async function resolvePublicRender(input: ResolvePublicRenderInput) {
  return resolvePublicRenderWithSource(
    {
      async findByShareId(shareId) {
        const document = (await prisma.document.findFirst({
          where: { shareId },
          select: selectForPublicRenderProjection(input.projection),
        })) as PublicRenderDocumentRow | null;
        if (!document || input.projection !== "presentation") return document;
        const customThemes = await loadCustomThemePackagesForDeckJson(
          document.deckJson,
        );
        return { ...document, customThemePackages: customThemes.packages };
      },
      async findByDocumentId(documentId) {
        return (await prisma.document.findUnique({
          where: { id: documentId },
          select: PUBLIC_RENDER_ASSET_ACCESS_SELECT,
        })) as PublicRenderDocumentRow | null;
      },
    },
    input,
  );
}
