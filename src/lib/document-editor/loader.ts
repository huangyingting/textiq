import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { accessibleDocumentWhere } from "@/lib/access-query";
import {
  createCommentService,
  type RequireCommentDocumentContext,
} from "@/lib/comments";
import { prisma } from "@/lib/prisma";
import { loadCustomThemePackagesForDeckJson } from "@/lib/presentation/brand-kit/persistence";

import {
  buildDocumentEditorViewModel,
  type DocumentEditorViewModel,
} from "./view-model";

const documentEditorSelect = (userId: string) =>
  ({
    id: true,
    title: true,
    contentJson: true,
    deckJson: true,
    deckRevisionToken: true,
    isShared: true,
    shareId: true,
    slug: true,
    shareExpiresAt: true,
    shareEmbedEnabled: true,
    sharePresentEnabled: true,
    sharePasscodeHash: true,
    shareMetadataMode: true,
    shareDiscoverable: true,
    ownerId: true,
    workspaceId: true,
    tags: {
      orderBy: { name: "asc" },
      select: { id: true, name: true, slug: true },
    },
    workspace: {
      select: {
        name: true,
        ownerId: true,
        members: {
          where: { userId },
          select: { userId: true, role: true },
        },
      },
    },
  }) satisfies Prisma.DocumentSelect;

const userTagSelect = { id: true, name: true, slug: true } as const;

export async function loadDocumentEditorViewModel({
  documentId,
  userId,
  userName,
  requireDocumentContext,
}: {
  documentId: string;
  userId: string;
  userName: string;
  requireDocumentContext: RequireCommentDocumentContext;
}): Promise<DocumentEditorViewModel | null> {
  const commentService = createCommentService({ requireDocumentContext });

  const document = await prisma.document.findFirst({
    where: accessibleDocumentWhere(userId, documentId),
    select: documentEditorSelect(userId),
  });

  if (!document) {
    return null;
  }

  const [initialComments, allTags, customThemes] = await Promise.all([
    commentService.listComments(document.id),
    prisma.tag.findMany({
      where: { ownerId: userId },
      orderBy: { name: "asc" },
      select: userTagSelect,
    }),
    loadCustomThemePackagesForDeckJson(document.deckJson, {
      userId,
      workspaceId: document.workspaceId,
    }),
  ]);

  return buildDocumentEditorViewModel({
    document,
    userId,
    userName,
    initialComments,
    allTags,
    activeCustomThemePackage: customThemes.activePackage,
    customThemeCatalogEntries: customThemes.catalogEntries,
  });
}
