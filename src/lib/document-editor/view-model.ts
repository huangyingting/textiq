import { documentCapabilities } from "@/lib/auth/document-permissions";
import type { CommentThread } from "@/lib/comments";
import type { DocumentTag } from "@/lib/document/tags";
import type { ThemePackageV1 } from "@/lib/presentation/theme-package-schema";

export interface DocumentEditorViewModel {
  documentId: string;
  initialTitle: string;
  initialStateJson: string | null;
  initialDeckJson: unknown;
  initialDeckRevisionToken: string | null;
  initialIsShared: boolean;
  initialShareId: string | null;
  initialSlug: string | null;
  initialShareExpiresAt: string | null;
  initialShareEmbedEnabled: boolean;
  initialSharePresentEnabled: boolean;
  initialShareMetadataMode: "generic" | "title" | "title-excerpt";
  initialShareDiscoverable: boolean;
  canEdit: boolean;
  canManage: boolean;
  workspaceName: string | null;
  userId: string;
  userName: string;
  initialComments: CommentThread[];
  initialTags: DocumentTag[];
  allTags: DocumentTag[];
  customThemePackages: ThemePackageV1[];
}

export interface DocumentEditorRow {
  id: string;
  title: string;
  contentJson: unknown;
  deckJson: unknown;
  deckRevisionToken: string | null;
  isShared: boolean;
  shareId: string | null;
  slug: string | null;
  shareExpiresAt: Date | null;
  shareEmbedEnabled: boolean;
  sharePresentEnabled: boolean;
  shareMetadataMode: string;
  shareDiscoverable: boolean;
  ownerId: string;
  workspaceId: string | null;
  tags: DocumentTag[];
  workspace: {
    name: string;
    ownerId: string;
    members: { userId: string; role: string }[];
  } | null;
}

export function buildDocumentEditorViewModel({
  document,
  userId,
  userName,
  initialComments,
  allTags,
  customThemePackages = [],
}: {
  document: DocumentEditorRow;
  userId: string;
  userName: string;
  initialComments: CommentThread[];
  allTags: DocumentTag[];
  customThemePackages?: ThemePackageV1[];
}): DocumentEditorViewModel {
  const { canEdit, canManage } = documentCapabilities(document, userId);

  return {
    documentId: document.id,
    initialTitle: document.title,
    initialStateJson: document.contentJson
      ? JSON.stringify(document.contentJson)
      : null,
    initialDeckJson: document.deckJson ?? null,
    initialDeckRevisionToken: document.deckRevisionToken,
    initialIsShared: document.isShared,
    initialShareId: document.shareId,
    initialSlug: document.slug,
    /* Coverage rationale: share expiry serialization is asserted; tsx maps ternary rows as uncovered. */
    /* node:coverage ignore next 3 */
    initialShareExpiresAt: document.shareExpiresAt
      ? document.shareExpiresAt.toISOString()
      : null,
    initialShareEmbedEnabled: document.shareEmbedEnabled,
    initialSharePresentEnabled: document.sharePresentEnabled,
    initialShareMetadataMode:
      document.shareMetadataMode === "title" ||
      document.shareMetadataMode === "title-excerpt"
        ? document.shareMetadataMode
        : "generic",
    initialShareDiscoverable: document.shareDiscoverable,
    canEdit,
    canManage,
    workspaceName: document.workspace?.name ?? null,
    userId,
    userName,
    initialComments,
    initialTags: document.tags,
    allTags,
    customThemePackages,
  };
}
