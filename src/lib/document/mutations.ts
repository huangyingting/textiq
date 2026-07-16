import { prisma } from "@/lib/prisma";
import { updateDocumentsMetadata } from "./document-write-port";

type DocumentMutationDb = Pick<typeof prisma, "document">;

export async function renameDocumentTitle(
  id: string,
  title: string,
  db: DocumentMutationDb = prisma,
): Promise<void> {
  await updateDocumentsMetadata(db, {
    where: { id },
    data: { title },
  });
}

export async function toggleDocumentFavorite(
  id: string,
  db: DocumentMutationDb = prisma,
): Promise<{ favorite: boolean }> {
  const document = await db.document.findFirst({
    where: { id, deletedAt: null },
    select: { favorite: true },
  });

  if (!document) {
    return { favorite: false };
  }

  const favorite = !document.favorite;

  await updateDocumentsMetadata(db, {
    where: { id },
    data: { favorite },
  });

  return { favorite };
}
