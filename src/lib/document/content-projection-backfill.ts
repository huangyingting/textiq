import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { projectDocumentContent } from "./content-projection";

type ContentProjectionBackfillDb = Pick<typeof prisma, "document">;

export type ContentProjectionBackfillResult = {
  scanned: number;
  updated: number;
  skippedConcurrent: number;
};

export async function backfillDocumentContentProjection(
  db: ContentProjectionBackfillDb = prisma,
  batchSize = 200,
): Promise<ContentProjectionBackfillResult> {
  const take =
    Number.isFinite(batchSize) && batchSize > 0 ? Math.floor(batchSize) : 200;
  const result: ContentProjectionBackfillResult = {
    scanned: 0,
    updated: 0,
    skippedConcurrent: 0,
  };
  let cursor: string | undefined;

  while (true) {
    const rows = await db.document.findMany({
      where: { contentJson: { not: Prisma.DbNull } },
      orderBy: { id: "asc" },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, content: true, contentJson: true },
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      result.scanned += 1;
      const projected = projectDocumentContent(row.contentJson);
      if (row.content === projected.content) continue;

      const update = await db.document.updateMany({
        where: { id: row.id, content: row.content },
        data: { content: projected.content },
      });
      if (update.count === 1) {
        result.updated += 1;
      } else {
        result.skippedConcurrent += 1;
      }
    }

    cursor = rows.at(-1)!.id;
  }

  return result;
}
