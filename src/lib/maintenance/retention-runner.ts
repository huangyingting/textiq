import type { Prisma } from "@/generated/prisma/client";
import { getBrandStorageAdapter } from "@/lib/brand/asset-storage";
import { prisma } from "@/lib/prisma";
import { getDefaultStorageAdapter } from "@/lib/slides/asset-storage";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export const DEFAULT_RETENTION_BATCH_SIZE = 100;
export const AUTH_TOKEN_RETENTION_MS = 7 * DAY_MS;
export const RATE_LIMIT_RETENTION_MS = HOUR_MS;
export const OPERATIONAL_ASSET_RETENTION_MS = 7 * DAY_MS;

export type RetentionAssetDomain = "slide" | "brand";

export interface RetentionLogger {
  info(event: string, context: RetentionLogContext): void;
  error(event: string, error: unknown, context: RetentionLogContext): void;
}

export type RetentionLogContext = Record<
  string,
  string | number | boolean | null
>;

interface RateLimitCandidate {
  subject: string;
}

interface TokenCandidate {
  id: string;
}

interface AssetCandidate {
  id: string;
  storageKey: string;
}

type DateCutoff = { lt: Date };

export interface RetentionDb {
  rateLimitHit: {
    findMany(args: {
      where: { resetAt: DateCutoff };
      select: { subject: true };
      orderBy: { resetAt: "asc" };
      take: number;
    }): Promise<RateLimitCandidate[]>;
    deleteMany(args: {
      where: { subject: { in: string[] } };
    }): Promise<{ count: number }>;
  };
  passwordResetToken: TokenDelegate;
  emailVerificationToken: TokenDelegate;
  asset: {
    findMany(args: {
      where:
        | {
            documentId: { not: null };
            deletedAt: { not: null; lt: Date };
          }
        | {
            brandId: { not: null };
            documentId: null;
            workspaceId: null;
            deletedAt: { not: null; lt: Date };
          };
      select: { id: true; storageKey: true };
      orderBy: { deletedAt: "asc" };
      take: number;
    }): Promise<AssetCandidate[]>;
    deleteMany(args: {
      where: { id: { in: string[] } };
    }): Promise<{ count: number }>;
  };
}

interface TokenDelegate {
  findMany(args: {
    where: {
      OR: [{ expiresAt: DateCutoff }, { usedAt: { not: null; lt: Date } }];
    };
    select: { id: true };
    orderBy: { expiresAt: "asc" };
    take: number;
  }): Promise<TokenCandidate[]>;
  deleteMany(args: { where: { id: { in: string[] } } }): Promise<{
    count: number;
  }>;
}

export interface RetentionStorage {
  delete(storageKey: string): Promise<void>;
}

export interface RetentionStorages {
  slide: RetentionStorage;
  brand: RetentionStorage;
}

export interface RetentionRunOptions {
  db?: RetentionDb;
  storages?: Partial<RetentionStorages>;
  logger?: RetentionLogger;
  dryRun?: boolean;
  now?: Date;
  batchSize?: number;
  authTokenRetentionMs?: number;
  rateLimitRetentionMs?: number;
  assetRetentionMs?: number;
}

export interface RetentionJobResult {
  candidateCount: number;
  deletedCount: number;
  failedStorageDeleteCount?: number;
}

export interface RetentionRunResult {
  dryRun: boolean;
  batchSize: number;
  now: string;
  cutoffs: {
    authTokens: string;
    rateLimits: string;
    assets: string;
  };
  rateLimits: RetentionJobResult;
  passwordResetTokens: RetentionJobResult;
  emailVerificationTokens: RetentionJobResult;
  slideAssets: RetentionJobResult;
  brandAssets: RetentionJobResult;
}

const noopLogger: RetentionLogger = {
  info: () => {},
  error: () => {},
};

let runInFlight = false;

function defaultDb(): RetentionDb {
  return {
    rateLimitHit: {
      findMany: (args) =>
        prisma.rateLimitHit.findMany(args as Prisma.RateLimitHitFindManyArgs),
      deleteMany: (args) =>
        prisma.rateLimitHit.deleteMany(
          args as Prisma.RateLimitHitDeleteManyArgs,
        ),
    },
    passwordResetToken: {
      findMany: (args) =>
        prisma.passwordResetToken.findMany(
          args as Prisma.PasswordResetTokenFindManyArgs,
        ),
      deleteMany: (args) =>
        prisma.passwordResetToken.deleteMany(
          args as Prisma.PasswordResetTokenDeleteManyArgs,
        ),
    },
    emailVerificationToken: {
      findMany: (args) =>
        prisma.emailVerificationToken.findMany(
          args as Prisma.EmailVerificationTokenFindManyArgs,
        ),
      deleteMany: (args) =>
        prisma.emailVerificationToken.deleteMany(
          args as Prisma.EmailVerificationTokenDeleteManyArgs,
        ),
    },
    asset: {
      findMany: (args) =>
        prisma.asset.findMany(args as Prisma.AssetFindManyArgs),
      deleteMany: (args) =>
        prisma.asset.deleteMany(args as Prisma.AssetDeleteManyArgs),
    },
  };
}

function resolvePositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function cutoff(now: Date, retentionMs: number): Date {
  return new Date(now.getTime() - retentionMs);
}

export async function runOperationalRetention(
  options: RetentionRunOptions = {},
): Promise<RetentionRunResult> {
  if (runInFlight) {
    throw new Error("retention runner is already in progress in this process");
  }
  runInFlight = true;

  try {
    const dryRun = options.dryRun ?? true;
    const batchSize = resolvePositiveInteger(
      options.batchSize ?? DEFAULT_RETENTION_BATCH_SIZE,
      "batchSize",
    );
    const authTokenRetentionMs = resolvePositiveInteger(
      options.authTokenRetentionMs ?? AUTH_TOKEN_RETENTION_MS,
      "authTokenRetentionMs",
    );
    const rateLimitRetentionMs = resolvePositiveInteger(
      options.rateLimitRetentionMs ?? RATE_LIMIT_RETENTION_MS,
      "rateLimitRetentionMs",
    );
    const assetRetentionMs = resolvePositiveInteger(
      options.assetRetentionMs ?? OPERATIONAL_ASSET_RETENTION_MS,
      "assetRetentionMs",
    );
    const now = options.now ?? new Date();
    const db = options.db ?? defaultDb();
    const logger = options.logger ?? noopLogger;
    const storages = {
      slide: options.storages?.slide ?? getDefaultStorageAdapter(),
      brand: options.storages?.brand ?? getBrandStorageAdapter(),
    };

    const authCutoff = cutoff(now, authTokenRetentionMs);
    const rateCutoff = cutoff(now, rateLimitRetentionMs);
    const assetCutoff = cutoff(now, assetRetentionMs);

    logger.info("maintenance.retention.started", {
      dryRun,
      batchSize,
      now: now.toISOString(),
    });

    const rateLimits = await purgeRateLimitHits({
      db,
      dryRun,
      batchSize,
      cutoff: rateCutoff,
    });
    const passwordResetTokens = await purgeTokenRows({
      delegate: db.passwordResetToken,
      dryRun,
      batchSize,
      cutoff: authCutoff,
    });
    const emailVerificationTokens = await purgeTokenRows({
      delegate: db.emailVerificationToken,
      dryRun,
      batchSize,
      cutoff: authCutoff,
    });
    const slideAssets = await purgeAssetRows({
      db,
      dryRun,
      batchSize,
      cutoff: assetCutoff,
      domain: "slide",
      storage: storages.slide,
      logger,
    });
    const brandAssets = await purgeAssetRows({
      db,
      dryRun,
      batchSize,
      cutoff: assetCutoff,
      domain: "brand",
      storage: storages.brand,
      logger,
    });

    const result: RetentionRunResult = {
      dryRun,
      batchSize,
      now: now.toISOString(),
      cutoffs: {
        authTokens: authCutoff.toISOString(),
        rateLimits: rateCutoff.toISOString(),
        assets: assetCutoff.toISOString(),
      },
      rateLimits,
      passwordResetTokens,
      emailVerificationTokens,
      slideAssets,
      brandAssets,
    };

    logger.info("maintenance.retention.completed", {
      dryRun,
      batchSize,
      rateLimitCandidates: rateLimits.candidateCount,
      rateLimitDeleted: rateLimits.deletedCount,
      passwordResetTokenCandidates: passwordResetTokens.candidateCount,
      passwordResetTokenDeleted: passwordResetTokens.deletedCount,
      emailVerificationTokenCandidates: emailVerificationTokens.candidateCount,
      emailVerificationTokenDeleted: emailVerificationTokens.deletedCount,
      slideAssetCandidates: slideAssets.candidateCount,
      slideAssetDeleted: slideAssets.deletedCount,
      slideAssetStorageFailures: slideAssets.failedStorageDeleteCount ?? 0,
      brandAssetCandidates: brandAssets.candidateCount,
      brandAssetDeleted: brandAssets.deletedCount,
      brandAssetStorageFailures: brandAssets.failedStorageDeleteCount ?? 0,
    });

    return result;
  } finally {
    runInFlight = false;
  }
}

async function purgeRateLimitHits(opts: {
  db: RetentionDb;
  dryRun: boolean;
  batchSize: number;
  cutoff: Date;
}): Promise<RetentionJobResult> {
  const candidates = await opts.db.rateLimitHit.findMany({
    where: { resetAt: { lt: opts.cutoff } },
    select: { subject: true },
    orderBy: { resetAt: "asc" },
    take: opts.batchSize,
  });

  if (opts.dryRun || candidates.length === 0) {
    return { candidateCount: candidates.length, deletedCount: 0 };
  }

  const result = await opts.db.rateLimitHit.deleteMany({
    where: {
      subject: { in: candidates.map((candidate) => candidate.subject) },
    },
  });
  return { candidateCount: candidates.length, deletedCount: result.count };
}

async function purgeTokenRows(opts: {
  delegate: TokenDelegate;
  dryRun: boolean;
  batchSize: number;
  cutoff: Date;
}): Promise<RetentionJobResult> {
  const candidates = await opts.delegate.findMany({
    where: {
      OR: [
        { expiresAt: { lt: opts.cutoff } },
        { usedAt: { not: null, lt: opts.cutoff } },
      ],
    },
    select: { id: true },
    orderBy: { expiresAt: "asc" },
    take: opts.batchSize,
  });

  if (opts.dryRun || candidates.length === 0) {
    return { candidateCount: candidates.length, deletedCount: 0 };
  }

  const result = await opts.delegate.deleteMany({
    where: { id: { in: candidates.map((candidate) => candidate.id) } },
  });
  return { candidateCount: candidates.length, deletedCount: result.count };
}

async function purgeAssetRows(opts: {
  db: RetentionDb;
  dryRun: boolean;
  batchSize: number;
  cutoff: Date;
  domain: RetentionAssetDomain;
  storage: RetentionStorage;
  logger: RetentionLogger;
}): Promise<RetentionJobResult> {
  const candidates = await opts.db.asset.findMany({
    where:
      opts.domain === "slide"
        ? {
            documentId: { not: null },
            deletedAt: { not: null, lt: opts.cutoff },
          }
        : {
            brandId: { not: null },
            documentId: null,
            workspaceId: null,
            deletedAt: { not: null, lt: opts.cutoff },
          },
    select: { id: true, storageKey: true },
    orderBy: { deletedAt: "asc" },
    take: opts.batchSize,
  });

  if (opts.dryRun || candidates.length === 0) {
    return {
      candidateCount: candidates.length,
      deletedCount: 0,
      failedStorageDeleteCount: 0,
    };
  }

  const deletedIds: string[] = [];
  let failedStorageDeleteCount = 0;
  for (const asset of candidates) {
    try {
      await opts.storage.delete(asset.storageKey);
      deletedIds.push(asset.id);
    } catch (error) {
      failedStorageDeleteCount++;
      opts.logger.error(
        "maintenance.retention.asset_storage_delete_failed",
        error,
        {
          domain: opts.domain,
          assetId: asset.id,
        },
      );
    }
  }

  if (deletedIds.length === 0) {
    return {
      candidateCount: candidates.length,
      deletedCount: 0,
      failedStorageDeleteCount,
    };
  }

  const result = await opts.db.asset.deleteMany({
    where: { id: { in: deletedIds } },
  });

  return {
    candidateCount: candidates.length,
    deletedCount: result.count,
    failedStorageDeleteCount,
  };
}
