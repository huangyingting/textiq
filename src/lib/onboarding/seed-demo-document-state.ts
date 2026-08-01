import { Prisma } from "@/generated/prisma/client";
import type { DocumentWriteTarget } from "@/lib/prisma-surface";
import { updateDocumentWithCanonicalContent } from "@/lib/document/document-write-port";

type SyncSeededDemoDocumentArgs = Readonly<{
  documentId: string;
  contentSnapshot: unknown;
}>;

export async function syncSeededDemoDocument(
  db: DocumentWriteTarget,
  args: SyncSeededDemoDocumentArgs,
): Promise<void> {
  await updateDocumentWithCanonicalContent(db, {
    where: { id: args.documentId },
    contentSnapshot: args.contentSnapshot,
    data: {
      deckJson: Prisma.DbNull,
      deckRevisionToken: null,
    },
  });
}
