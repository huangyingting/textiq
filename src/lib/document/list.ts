import type { Prisma } from "@/generated/prisma/client";
import { workspaceMemberAccessWhere } from "@/lib/access-query";
import { documentCapabilities } from "@/lib/auth/document-permissions";
import { deriveFromContentJson } from "@/lib/document-stats";
import { capList, DOCUMENT_LIST_LIMIT } from "@/lib/documents";
import { buildDocumentListArgs } from "@/lib/document/query";
import { prisma } from "@/lib/prisma";
import { normalizeSearchQuery, SEARCH_RESULT_LIMIT } from "@/lib/search";
import { safeParseVisual, type Visual } from "@/lib/visual/schema";

type DocumentListDb = Pick<typeof prisma, "document" | "tag">;
type DocumentSearchDb = Pick<typeof prisma, "document">;

export type DashboardDocument = {
  id: string;
  title: string;
  favorite: boolean;
  editedLabel: string;
  workspaceName: string | null;
  thumbnail: Visual | null;
  excerpt: string;
  readingMinutes: number;
  createdAtMs: number;
  updatedAtMs: number;
  canEdit: boolean;
  canManage: boolean;
  tags: { slug: string; name: string }[];
};

export type AvailableTag = { slug: string; name: string };

export type DashboardDocumentList = {
  documents: DashboardDocument[];
  availableTags: AvailableTag[];
  listCapped: boolean;
  hasDocuments: boolean;
};

export type SearchResult = DashboardDocument;

export type SearchResults = {
  results: SearchResult[];
  hasMore: boolean;
};

export type DocumentListServiceFilters = {
  tagSlug?: string | null;
  favoritesOnly?: boolean;
};

function isDocumentListDb(value: unknown): value is DocumentListDb {
  return (
    typeof value === "object" &&
    value !== null &&
    "document" in value &&
    "tag" in value
  );
}

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export const DASHBOARD_DOCUMENT_CARD_SELECT = {
  id: true,
  title: true,
  favorite: true,
  contentJson: true,
  createdAt: true,
  updatedAt: true,
  ownerId: true,
  workspaceId: true,
  visuals: {
    orderBy: [{ orderIndex: "asc" as const }, { createdAt: "asc" as const }],
    take: 1,
    select: { data: true },
  },
  tags: {
    orderBy: { name: "asc" as const },
    select: { slug: true, name: true },
  },
  workspace: {
    select: {
      name: true,
      ownerId: true,
      members: {
        select: { userId: true, role: true },
      },
    },
  },
} satisfies Prisma.DocumentSelect;

function thumbnailFromVisuals(row: {
  visuals: { data: unknown }[];
}): Visual | null {
  const firstVisual = row.visuals[0];
  if (!firstVisual) return null;
  const parsed = safeParseVisual(firstVisual.data);
  return parsed.success ? parsed.data : null;
}

function toDashboardDocument(
  document: {
    id: string;
    title: string;
    favorite: boolean;
    contentJson: unknown;
    createdAt: Date;
    updatedAt: Date;
    ownerId: string;
    workspaceId: string | null;
    visuals: { data: unknown }[];
    tags: { slug: string; name: string }[];
    workspace: {
      name: string;
      ownerId: string;
      members: { userId: string; role: string }[];
    } | null;
  },
  userId: string,
): DashboardDocument {
  const { canEdit, canManage } = documentCapabilities(document, userId);
  const { excerpt: docExcerpt, readingMinutes } = deriveFromContentJson(
    document.contentJson,
  );
  return {
    id: document.id,
    title: document.title,
    favorite: document.favorite,
    editedLabel: dateFormatter.format(document.updatedAt),
    workspaceName: document.workspace?.name ?? null,
    thumbnail: thumbnailFromVisuals(document),
    excerpt: docExcerpt,
    readingMinutes,
    createdAtMs: document.createdAt.getTime(),
    updatedAtMs: document.updatedAt.getTime(),
    canEdit,
    canManage,
    tags: document.tags,
  };
}

function availableTagsForDocuments(
  ownTags: AvailableTag[],
  documents: DashboardDocument[],
): AvailableTag[] {
  const tagMap = new Map<string, string>();
  for (const tag of ownTags) tagMap.set(tag.slug, tag.name);
  for (const document of documents) {
    for (const tag of document.tags) {
      if (!tagMap.has(tag.slug)) tagMap.set(tag.slug, tag.name);
    }
  }
  return Array.from(tagMap, ([slug, name]) => ({ slug, name })).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

export async function listDashboardDocumentsForUser(
  userId: string,
  filtersOrDb: DocumentListServiceFilters | DocumentListDb = {},
  db: DocumentListDb = prisma,
): Promise<DashboardDocumentList> {
  const filters = isDocumentListDb(filtersOrDb) ? {} : filtersOrDb;
  const client = isDocumentListDb(filtersOrDb) ? filtersOrDb : db;

  const [personalRows, workspaceRows] = await Promise.all([
    client.document.findMany({
      ...buildDocumentListArgs({
        scope: { kind: "dashboard-personal", userId },
        filters,
        limit: DOCUMENT_LIST_LIMIT,
      }),
      select: {
        ...DASHBOARD_DOCUMENT_CARD_SELECT,
        workspace: false,
      },
    }),
    client.document.findMany({
      ...buildDocumentListArgs({
        scope: { kind: "dashboard-workspace", userId },
        filters,
        limit: DOCUMENT_LIST_LIMIT,
      }),
      select: {
        ...DASHBOARD_DOCUMENT_CARD_SELECT,
        workspace: {
          select: {
            ...DASHBOARD_DOCUMENT_CARD_SELECT.workspace.select,
            members: {
              where: workspaceMemberAccessWhere(userId),
              select: { userId: true, role: true },
            },
          },
        },
      },
    }),
  ]);

  const personal = capList(personalRows, DOCUMENT_LIST_LIMIT);
  const workspace = capList(workspaceRows, DOCUMENT_LIST_LIMIT);
  const allRows = [
    ...personal.items.map((document) => ({ ...document, workspace: null })),
    ...workspace.items,
  ].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  /* node:coverage ignore next 3 -- dashboard row mapping is covered; tsx maps the multiline arrow as uncovered. */
  const documents = allRows.map((document) =>
    toDashboardDocument(document, userId),
  );

  const ownTags = await client.tag.findMany({
    where: { ownerId: userId },
    select: { slug: true, name: true },
  });

  return {
    documents,
    availableTags: availableTagsForDocuments(ownTags, documents),
    listCapped: personal.hasMore || workspace.hasMore,
    hasDocuments: allRows.length > 0,
  };
}

export async function searchDocumentsForUser(
  userId: string,
  rawQuery: string,
  db: DocumentSearchDb = prisma,
): Promise<SearchResults> {
  const q = normalizeSearchQuery(rawQuery);
  if (!q) return { results: [], hasMore: false };

  const rows = await db.document.findMany({
    ...buildDocumentListArgs({
      scope: { kind: "accessible", userId },
      filters: { query: q },
      limit: SEARCH_RESULT_LIMIT,
    }),
    select: {
      ...DASHBOARD_DOCUMENT_CARD_SELECT,
      workspace: {
        select: {
          ...DASHBOARD_DOCUMENT_CARD_SELECT.workspace.select,
          members: {
            where: workspaceMemberAccessWhere(userId),
            select: { userId: true, role: true },
          },
        },
      },
    },
  });

  const { items, hasMore } = capList(rows, SEARCH_RESULT_LIMIT);
  return {
    results: items.map((document) => toDashboardDocument(document, userId)),
    hasMore,
  };
}
