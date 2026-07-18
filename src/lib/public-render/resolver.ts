import "server-only";

import { prisma } from "@/lib/prisma";
import { loadCustomThemePackagesForDeckJson } from "@/lib/presentation/brand-kit/persistence";

import {
  resolvePublicRenderWithSource,
  type ResolvePublicRenderInput,
} from "./resolver-core";
import {
  mapPublicRenderDocumentRow,
  mapPublicRenderMetadataRow,
  mapPublicRenderPresentationRow,
  PUBLIC_RENDER_DOCUMENT_SELECT,
  PUBLIC_RENDER_METADATA_SELECT,
  PUBLIC_RENDER_PRESENTATION_SELECT,
} from "./resolver-selects";

export async function resolvePublicRender(input: ResolvePublicRenderInput) {
  return resolvePublicRenderWithSource(
    {
      async findDocumentByShareId(shareId) {
        const row = await prisma.document.findFirst({
          where: { shareId },
          select: PUBLIC_RENDER_DOCUMENT_SELECT,
        });
        return row ? mapPublicRenderDocumentRow(row) : null;
      },
      async findMetadataByShareId(shareId) {
        const row = await prisma.document.findFirst({
          where: { shareId },
          select: PUBLIC_RENDER_METADATA_SELECT,
        });
        return row ? mapPublicRenderMetadataRow(row) : null;
      },
      async findPresentationByShareId(shareId) {
        const row = await prisma.document.findFirst({
          where: { shareId },
          select: PUBLIC_RENDER_PRESENTATION_SELECT,
        });
        return row ? mapPublicRenderPresentationRow(row) : null;
      },
      async loadActiveCustomThemeForAuthorizedPresentation(presentation) {
        const customThemes = await loadCustomThemePackagesForDeckJson(
          presentation.deckJson,
        );
        return customThemes.activePackage;
      },
    },
    input,
  );
}
