import type { Prisma } from "@/generated/prisma/client";
import {
  SHARE_ACCESS_SELECT,
  type ShareAccessFields,
} from "@/lib/share-access";

import type {
  PublicRenderDocumentRow,
  PublicRenderMetadataRow,
  PublicRenderPresentationRow,
  PublicRenderProjection,
} from "./resolver-core";

const PUBLIC_RENDER_ACCESS_SELECT = {
  ...SHARE_ACCESS_SELECT,
} satisfies Prisma.DocumentSelect;

export const PUBLIC_RENDER_METADATA_SELECT = {
  title: true,
  contentJson: true,
  slug: true,
  ...PUBLIC_RENDER_ACCESS_SELECT,
} satisfies Prisma.DocumentSelect;

export const PUBLIC_RENDER_DOCUMENT_SELECT = {
  id: true,
  title: true,
  contentJson: true,
  ...PUBLIC_RENDER_ACCESS_SELECT,
  owner: {
    select: {
      name: true,
      plan: true,
    },
  },
} satisfies Prisma.DocumentSelect;

export const PUBLIC_RENDER_PRESENTATION_SELECT = {
  id: true,
  title: true,
  contentJson: true,
  deckJson: true,
  ...PUBLIC_RENDER_ACCESS_SELECT,
  owner: {
    select: {
      name: true,
      plan: true,
    },
  },
} satisfies Prisma.DocumentSelect;

export type PublicRenderMetadataPrismaRow = Prisma.DocumentGetPayload<{
  select: typeof PUBLIC_RENDER_METADATA_SELECT;
}>;

export type PublicRenderDocumentPrismaRow = Prisma.DocumentGetPayload<{
  select: typeof PUBLIC_RENDER_DOCUMENT_SELECT;
}>;

export type PublicRenderPresentationPrismaRow = Prisma.DocumentGetPayload<{
  select: typeof PUBLIC_RENDER_PRESENTATION_SELECT;
}>;

type ShareAccessSelectRow = {
  shareId: string | null;
  isShared: boolean;
  deletedAt: Date | null;
  shareExpiresAt: Date | null;
  shareEmbedEnabled: boolean;
  sharePresentEnabled: boolean;
  sharePasscodeHash: string | null;
  shareMetadataMode: string;
  shareDiscoverable: boolean;
};

function mapShareAccessFields(row: ShareAccessSelectRow): ShareAccessFields {
  return {
    shareId: row.shareId,
    isShared: row.isShared,
    deletedAt: row.deletedAt,
    shareExpiresAt: row.shareExpiresAt,
    shareEmbedEnabled: row.shareEmbedEnabled,
    sharePresentEnabled: row.sharePresentEnabled,
    sharePasscodeHash: row.sharePasscodeHash,
    shareMetadataMode: row.shareMetadataMode,
    shareDiscoverable: row.shareDiscoverable,
  };
}

export function mapPublicRenderMetadataRow(
  row: PublicRenderMetadataPrismaRow,
): PublicRenderMetadataRow {
  return {
    ...mapShareAccessFields(row),
    title: row.title,
    contentJson: row.contentJson,
    slug: row.slug,
  };
}

export function mapPublicRenderDocumentRow(
  row: PublicRenderDocumentPrismaRow,
): PublicRenderDocumentRow {
  return {
    ...mapShareAccessFields(row),
    id: row.id,
    title: row.title,
    contentJson: row.contentJson,
    owner: row.owner,
  };
}

export function mapPublicRenderPresentationRow(
  row: PublicRenderPresentationPrismaRow,
): PublicRenderPresentationRow {
  return {
    ...mapShareAccessFields(row),
    id: row.id,
    title: row.title,
    contentJson: row.contentJson,
    deckJson: row.deckJson,
    owner: row.owner,
  };
}

export function selectForPublicRenderProjection(
  projection: PublicRenderProjection,
): Prisma.DocumentSelect {
  switch (projection) {
    case "metadata":
      return PUBLIC_RENDER_METADATA_SELECT;
    case "document":
      return PUBLIC_RENDER_DOCUMENT_SELECT;
    case "presentation":
      return PUBLIC_RENDER_PRESENTATION_SELECT;
  }
}
