import { updateDocumentMetadata } from "@/lib/document/document-write-port";
import { prisma } from "@/lib/prisma";

async function verifyDocumentPrismaBoundary(): Promise<void> {
  await prisma.document.findMany({ select: { id: true, title: true } });
  const { findUnique } = prisma.document;
  await findUnique({ where: { id: "doc" }, select: { id: true } });

  // @ts-expect-error Document mutation methods are absent from the public delegate.
  const { update } = prisma.document;
  void update;

  let reassigned: { update(args: unknown): unknown } | undefined = undefined;
  // @ts-expect-error A restricted Document delegate cannot be reassigned as a mutation delegate.
  reassigned = prisma.document;
  void reassigned;

  function transfer(delegate: { deleteMany(args: unknown): unknown }): void {
    void delegate;
  }
  // @ts-expect-error Parameter transfer cannot recover a Document mutation delegate.
  transfer(prisma.document);

  const model = "document" as const;
  // @ts-expect-error Dynamic model access still exposes the restricted Document delegate.
  await prisma[model].upsert({ where: { id: "doc" }, create: {}, update: {} });

  await prisma.$transaction(async (tx) => {
    await tx.document.findUnique({ where: { id: "doc" } });
    // @ts-expect-error Transaction clients expose the same restricted Document delegate.
    await tx.document.update({ where: { id: "doc" }, data: {} });
  });

  await updateDocumentMetadata(prisma, {
    where: { id: "doc" },
    data: { title: "Owned adapter mutation" },
  });
}

void verifyDocumentPrismaBoundary;
