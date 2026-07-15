import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { projectDocumentContent } from "./content-projection";

type ContentProjectionBackfillDb = Pick<typeof prisma, "document">;

export const CONTENT_PROJECTION_BACKFILL_DEFAULT_BATCH_SIZE = 200;
export const CONTENT_PROJECTION_BACKFILL_MAX_BATCH_SIZE = 1_000;
export const CONTENT_PROJECTION_BACKFILL_DEFAULT_RETRIES = 2;
export const CONTENT_PROJECTION_BACKFILL_MAX_RETRIES = 10;
export const CONTENT_PROJECTION_BACKFILL_DEFAULT_SAMPLE_LIMIT = 20;
export const CONTENT_PROJECTION_BACKFILL_MAX_SAMPLE_LIMIT = 100;

export type ContentProjectionBackfillOptions = {
  batchSize?: number;
  dryRun?: boolean;
  maxRetries?: number;
  sampleLimit?: number;
};

export type ContentProjectionBackfillResult = {
  scanned: number;
  drifted: number;
  updated: number;
  skippedConcurrent: number;
  retries: number;
  sampleDocumentIds: string[];
};

type ContentProjectionRow = {
  id: string;
  content: string;
  contentJson: Prisma.JsonValue;
  updatedAt: Date;
};

function boundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < min || resolved > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}`);
  }
  return resolved;
}

export function resolveContentProjectionBackfillOptions(
  options: ContentProjectionBackfillOptions = {},
): Required<ContentProjectionBackfillOptions> {
  return {
    batchSize: boundedInteger(
      options.batchSize,
      CONTENT_PROJECTION_BACKFILL_DEFAULT_BATCH_SIZE,
      1,
      CONTENT_PROJECTION_BACKFILL_MAX_BATCH_SIZE,
      "batchSize",
    ),
    dryRun: options.dryRun ?? false,
    maxRetries: boundedInteger(
      options.maxRetries,
      CONTENT_PROJECTION_BACKFILL_DEFAULT_RETRIES,
      0,
      CONTENT_PROJECTION_BACKFILL_MAX_RETRIES,
      "maxRetries",
    ),
    sampleLimit: boundedInteger(
      options.sampleLimit,
      CONTENT_PROJECTION_BACKFILL_DEFAULT_SAMPLE_LIMIT,
      0,
      CONTENT_PROJECTION_BACKFILL_MAX_SAMPLE_LIMIT,
      "sampleLimit",
    ),
  };
}

function contentJsonSnapshotFilter(
  contentJson: Prisma.JsonValue,
): Prisma.JsonNullableFilter<"Document"> {
  return {
    equals:
      contentJson === null
        ? Prisma.JsonNull
        : (contentJson as Prisma.InputJsonValue),
  };
}

export async function backfillDocumentContentProjection(
  db: ContentProjectionBackfillDb = prisma,
  options: ContentProjectionBackfillOptions = {},
): Promise<ContentProjectionBackfillResult> {
  const config = resolveContentProjectionBackfillOptions(options);
  const result: ContentProjectionBackfillResult = {
    scanned: 0,
    drifted: 0,
    updated: 0,
    skippedConcurrent: 0,
    retries: 0,
    sampleDocumentIds: [],
  };
  let cursor: string | undefined;

  while (true) {
    const rows = await db.document.findMany({
      where: { contentJson: { not: Prisma.DbNull } },
      orderBy: { id: "asc" },
      take: config.batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        content: true,
        contentJson: true,
        updatedAt: true,
      },
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      result.scanned += 1;
      let snapshot = row as ContentProjectionRow;
      if (
        snapshot.content ===
        projectDocumentContent(snapshot.contentJson).content
      ) {
        continue;
      }

      result.drifted += 1;
      if (result.sampleDocumentIds.length < config.sampleLimit) {
        result.sampleDocumentIds.push(snapshot.id);
      }
      if (config.dryRun) continue;

      for (let attempt = 0; ; attempt += 1) {
        const projected = projectDocumentContent(snapshot.contentJson);
        if (snapshot.content === projected.content) {
          result.skippedConcurrent += 1;
          break;
        }

        const update = await db.document.updateMany({
          where: {
            id: snapshot.id,
            updatedAt: snapshot.updatedAt,
            contentJson: contentJsonSnapshotFilter(snapshot.contentJson),
          },
          data: { content: projected.content },
        });
        if (update.count === 1) {
          result.updated += 1;
          break;
        }
        if (attempt >= config.maxRetries) {
          result.skippedConcurrent += 1;
          break;
        }

        result.retries += 1;
        const latest = await db.document.findUnique({
          where: { id: snapshot.id },
          select: {
            id: true,
            content: true,
            contentJson: true,
            updatedAt: true,
          },
        });
        if (!latest || latest.contentJson === null) {
          result.skippedConcurrent += 1;
          break;
        }
        snapshot = latest as ContentProjectionRow;
      }
    }

    cursor = rows.at(-1)!.id;
  }

  return result;
}
