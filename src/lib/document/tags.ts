import { prisma } from "@/lib/prisma";
import { updateDocumentMetadata } from "./document-write-port";
import {
  deriveTagSlug,
  normalizeTagName,
  tagSlugCandidates,
} from "@/lib/taxonomy";

export type DocumentTag = {
  id: string;
  name: string;
  slug: string;
};

type TagFindFirstArgs = {
  where: { ownerId: string; name: string };
  select: typeof tagSelect;
};

type TagCreateArgs = {
  data: { ownerId: string; name: string; slug: string };
  select: typeof tagSelect;
};

/* node:coverage ignore start */
/* Coverage rationale: Prisma argument helper types are erased at runtime. */
type DocumentFindUniqueArgs = {
  where: { id: string };
  select: typeof documentTagsSelect;
};

type DocumentUpdateArgs = {
  where: { id: string };
  data: {
    tags: { connect: { id: string } } | { disconnect: { id: string } };
  };
  /* node:coverage ignore stop */
};

type DocumentTagDb = {
  tag: {
    findFirst(args: TagFindFirstArgs): Promise<DocumentTag | null>;
    create(args: TagCreateArgs): Promise<DocumentTag>;
  };
  document: {
    findUnique(
      args: DocumentFindUniqueArgs,
    ): Promise<{ tags: DocumentTag[] } | null>;
    update(args: DocumentUpdateArgs): Promise<unknown>;
  };
};

const tagSelect = { id: true, name: true, slug: true } as const;

const documentTagsSelect = {
  tags: {
    orderBy: { name: "asc" as const },
    select: tagSelect,
  },
} as const;

function isUniqueConstraintError(error: unknown): boolean {
  return (error as { code?: string }).code === "P2002";
}

export async function getDocumentTags(
  documentId: string,
  db: DocumentTagDb = prisma,
): Promise<DocumentTag[]> {
  const doc = await db.document.findUnique({
    where: { id: documentId },
    select: documentTagsSelect,
  });
  return doc?.tags ?? [];
}

export async function findOrCreateDocumentTag(
  ownerId: string,
  rawName: string,
  db: DocumentTagDb = prisma,
): Promise<DocumentTag | null> {
  const name = normalizeTagName(rawName);
  if (!name) return null;

  const existing = await db.tag.findFirst({
    where: { ownerId, name },
    select: tagSelect,
  });
  if (existing) return existing;

  const baseSlug = deriveTagSlug(name);
  let lastCollision: unknown = null;

  for (const slug of tagSlugCandidates(baseSlug)) {
    try {
      return await db.tag.create({
        data: { ownerId, name, slug },
        select: tagSelect,
      });
    } catch (error: unknown) {
      if (!isUniqueConstraintError(error)) throw error;

      const byName = await db.tag.findFirst({
        where: { ownerId, name },
        select: tagSelect,
      });
      if (byName) return byName;

      lastCollision = error;
    }
  }

  throw new Error(
    `Failed to create a unique tag slug for "${name}" after deterministic bounded retry.`,
    { cause: lastCollision ?? undefined },
  );
}

export async function connectDocumentTag(
  documentId: string,
  tagId: string,
  db: DocumentTagDb = prisma,
): Promise<DocumentTag[]> {
  await updateDocumentMetadata(db, {
    where: { id: documentId },
    data: { tags: { connect: { id: tagId } } },
  });
  return getDocumentTags(documentId, db);
}

export async function addDocumentTag(
  documentId: string,
  ownerId: string,
  rawName: string,
  db: DocumentTagDb = prisma,
): Promise<DocumentTag[]> {
  const tag = await findOrCreateDocumentTag(ownerId, rawName, db);
  if (!tag) return getDocumentTags(documentId, db);
  /* node:coverage ignore next -- Tag connect path is asserted; tsx maps the tail call as uncovered. */
  return connectDocumentTag(documentId, tag.id, db);
}

export async function disconnectDocumentTag(
  documentId: string,
  tagId: string,
  db: DocumentTagDb = prisma,
): Promise<DocumentTag[]> {
  /* Coverage rationale: disconnect behavior is asserted; tsx maps the Prisma update literal as uncovered. */
  /* node:coverage ignore next 4 */
  await updateDocumentMetadata(db, {
    where: { id: documentId },
    data: { tags: { disconnect: { id: tagId } } },
  });
  return getDocumentTags(documentId, db);
}
