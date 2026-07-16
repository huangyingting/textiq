import type { Prisma } from "@/generated/prisma/client";
import { documentAccessOr, workspaceAccessOr } from "@/lib/access-query";
import { caseInsensitiveContains } from "@/lib/db-provider";
import { DOCUMENT_LIST_LIMIT } from "@/lib/documents";

export type DocumentListQueryFilters = {
  query?: string | null;
  tagSlug?: string | null;
  favoritesOnly?: boolean;
};

export type DocumentListQueryScope =
  | { kind: "accessible"; userId: string }
  | {
      kind: "custom-access";
      accessOr: NonNullable<Prisma.DocumentWhereInput["OR"]>;
    }
  | { kind: "dashboard-personal"; userId: string }
  | { kind: "dashboard-workspace"; userId: string }
  | { kind: "workspace"; workspaceId: string };

export type DocumentListQueryPolicy = {
  scope: DocumentListQueryScope;
  filters?: DocumentListQueryFilters;
  limit?: number;
};

export function buildDocumentTextSearchOr(
  query: string,
): Prisma.DocumentWhereInput[] {
  const filter = caseInsensitiveContains(query);
  // `content` is the plain-text projection written atomically with contentJson.
  return [{ title: filter }, { content: filter }];
}

function baseDocumentWhere(
  scope: DocumentListQueryScope,
): Prisma.DocumentWhereInput {
  switch (scope.kind) {
    case "dashboard-personal":
      return {
        ownerId: scope.userId,
        workspaceId: null,
        deletedAt: null,
      };
    case "dashboard-workspace":
      return {
        workspaceId: { not: null },
        deletedAt: null,
        workspace: { OR: workspaceAccessOr(scope.userId) },
      };
    case "workspace":
      return {
        workspaceId: scope.workspaceId,
        deletedAt: null,
      };
    case "custom-access":
      return {
        deletedAt: null,
        OR: scope.accessOr,
      };
    case "accessible":
    default:
      return {
        deletedAt: null,
        OR: documentAccessOr(scope.userId),
      };
  }
}

function filterClauses(
  filters: DocumentListQueryFilters = {},
): Prisma.DocumentWhereInput[] {
  const clauses: Prisma.DocumentWhereInput[] = [];
  const query = filters.query?.trim();
  const tagSlug = filters.tagSlug?.trim();

  if (query) clauses.push({ OR: buildDocumentTextSearchOr(query) });
  if (tagSlug) clauses.push({ tags: { some: { slug: tagSlug } } });
  if (filters.favoritesOnly) clauses.push({ favorite: true });

  return clauses;
}

export function buildDocumentListWhere(
  policy: Omit<DocumentListQueryPolicy, "limit">,
): Prisma.DocumentWhereInput {
  const base = baseDocumentWhere(policy.scope);
  const clauses = filterClauses(policy.filters);
  return clauses.length > 0 ? { ...base, AND: clauses } : base;
}

export function documentListTake(limit = DOCUMENT_LIST_LIMIT): number {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
  return safeLimit + 1;
}

export function buildDocumentListArgs(
  policy: DocumentListQueryPolicy,
): Pick<Prisma.DocumentFindManyArgs, "where" | "orderBy" | "take"> {
  return {
    where: buildDocumentListWhere(policy),
    orderBy: { updatedAt: "desc" },
    take: documentListTake(policy.limit),
  };
}
