import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AUTH_TOKEN_RETENTION_MS,
  RATE_LIMIT_RETENTION_MS,
  runOperationalRetention,
  type RetentionDb,
  type RetentionLogger,
  type RetentionStorage,
} from "@/lib/maintenance/retention-runner";

type RateRow = { subject: string; resetAt: Date };
type TokenRow = { id: string; expiresAt: Date; usedAt: Date | null };
type AssetRow = {
  id: string;
  storageKey: string;
  documentId: string | null;
  workspaceId: string | null;
  deletedAt: Date | null;
};

const NOW = new Date("2026-01-10T00:00:00.000Z");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

function makeTokenDelegate(rows: TokenRow[]) {
  return {
    rows,
    async findMany(args: {
      take: number;
      where: {
        OR: [{ expiresAt: { lt: Date } }, { usedAt: { not: null; lt: Date } }];
      };
    }) {
      const [expired, used] = args.where.OR;
      return rows
        .filter(
          (row) =>
            row.expiresAt < expired.expiresAt.lt ||
            (row.usedAt !== null && row.usedAt < used.usedAt.lt),
        )
        .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime())
        .slice(0, args.take)
        .map(({ id }) => ({ id }));
    },
    async deleteMany(args: { where: { id: { in: string[] } } }) {
      const ids = new Set(args.where.id.in);
      const before = rows.length;
      rows.splice(0, rows.length, ...rows.filter((row) => !ids.has(row.id)));
      return { count: before - rows.length };
    },
  };
}

function makeDb(seed?: {
  rateLimits?: RateRow[];
  passwordResetTokens?: TokenRow[];
  emailVerificationTokens?: TokenRow[];
  assets?: AssetRow[];
}): RetentionDb & {
  rows: {
    rateLimits: RateRow[];
    passwordResetTokens: TokenRow[];
    emailVerificationTokens: TokenRow[];
    assets: AssetRow[];
  };
} {
  const rows = {
    rateLimits: seed?.rateLimits ?? [],
    passwordResetTokens: seed?.passwordResetTokens ?? [],
    emailVerificationTokens: seed?.emailVerificationTokens ?? [],
    assets: seed?.assets ?? [],
  };
  return {
    rows,
    rateLimitHit: {
      async findMany(args: { take: number; where: { resetAt: { lt: Date } } }) {
        return rows.rateLimits
          .filter((row) => row.resetAt < args.where.resetAt.lt)
          .sort((a, b) => a.resetAt.getTime() - b.resetAt.getTime())
          .slice(0, args.take)
          .map(({ subject }) => ({ subject }));
      },
      async deleteMany(args: { where: { subject: { in: string[] } } }) {
        const subjects = new Set(args.where.subject.in);
        const before = rows.rateLimits.length;
        rows.rateLimits.splice(
          0,
          rows.rateLimits.length,
          ...rows.rateLimits.filter((row) => !subjects.has(row.subject)),
        );
        return { count: before - rows.rateLimits.length };
      },
    },
    passwordResetToken: makeTokenDelegate(rows.passwordResetTokens),
    emailVerificationToken: makeTokenDelegate(rows.emailVerificationTokens),
    asset: {
      async findMany(args: { take: number; where: Record<string, unknown> }) {
        const deletedAt = args.where.deletedAt as { lt: Date };
        return rows.assets
          .filter((asset) => {
            if (asset.deletedAt === null || asset.deletedAt >= deletedAt.lt) {
              return false;
            }
            if ("workspaceId" in args.where) {
              return asset.documentId === null && asset.workspaceId === null;
            }
            return asset.documentId !== null;
          })
          .sort(
            (a, b) =>
              (a.deletedAt?.getTime() ?? 0) - (b.deletedAt?.getTime() ?? 0),
          )
          .slice(0, args.take)
          .map(({ id, storageKey }) => ({ id, storageKey }));
      },
      async deleteMany(args: { where: { id: { in: string[] } } }) {
        const ids = new Set(args.where.id.in);
        const before = rows.assets.length;
        rows.assets.splice(
          0,
          rows.assets.length,
          ...rows.assets.filter((asset) => !ids.has(asset.id)),
        );
        return { count: before - rows.assets.length };
      },
    },
  } as RetentionDb & {
    rows: {
      rateLimits: RateRow[];
      passwordResetTokens: TokenRow[];
      emailVerificationTokens: TokenRow[];
      assets: AssetRow[];
    };
  };
}

function makeStorage(failingKeyPart = ""): RetentionStorage & {
  deletedKeys: string[];
} {
  const deletedKeys: string[] = [];
  return {
    deletedKeys,
    async delete(storageKey: string) {
      if (failingKeyPart && storageKey.includes(failingKeyPart)) {
        throw new Error("storage unavailable");
      }
      deletedKeys.push(storageKey);
    },
  };
}

function makeLogger(): RetentionLogger & {
  errors: { event: string; context: Record<string, unknown> }[];
} {
  const errors: { event: string; context: Record<string, unknown> }[] = [];
  return {
    errors,
    info: () => {},
    error: (event, _error, context) => {
      errors.push({ event, context });
    },
  };
}

describe("runOperationalRetention", () => {
  it("dry-runs expired rows without deleting database rows or asset bytes", async () => {
    const db = makeDb({
      rateLimits: [
        { subject: "old-rate", resetAt: daysAgo(1) },
        { subject: "current-rate", resetAt: NOW },
      ],
      passwordResetTokens: [
        { id: "old-reset", expiresAt: daysAgo(8), usedAt: null },
        { id: "current-reset", expiresAt: NOW, usedAt: null },
      ],
      emailVerificationTokens: [
        { id: "old-verify", expiresAt: NOW, usedAt: daysAgo(8) },
        { id: "current-verify", expiresAt: NOW, usedAt: null },
      ],
      assets: [
        {
          id: "slide-old",
          storageKey: "doc/old.png",
          documentId: "doc-1",
          workspaceId: null,
          deletedAt: daysAgo(8),
        },
        {
          id: "brand-old",
          storageKey: "owner/old.png",
          documentId: null,
          workspaceId: null,
          deletedAt: daysAgo(8),
        },
      ],
    });
    const slideStorage = makeStorage();
    const brandStorage = makeStorage();

    const result = await runOperationalRetention({
      db,
      storages: { slide: slideStorage, brand: brandStorage },
      dryRun: true,
      now: NOW,
    });

    assert.equal(result.rateLimits.candidateCount, 1);
    assert.equal(result.passwordResetTokens.candidateCount, 1);
    assert.equal(result.emailVerificationTokens.candidateCount, 1);
    assert.equal(result.slideAssets.candidateCount, 1);
    assert.equal(result.brandAssets.candidateCount, 1);
    assert.equal(db.rows.rateLimits.length, 2);
    assert.equal(db.rows.passwordResetTokens.length, 2);
    assert.equal(db.rows.emailVerificationTokens.length, 2);
    assert.equal(db.rows.assets.length, 2);
    assert.deepEqual(slideStorage.deletedKeys, []);
    assert.deepEqual(brandStorage.deletedKeys, []);
  });

  it("executes bounded deletes for expired rows while preserving current rows", async () => {
    const db = makeDb({
      rateLimits: [
        { subject: "old-rate", resetAt: daysAgo(1) },
        {
          subject: "recent-rate",
          resetAt: new Date(NOW.getTime() - RATE_LIMIT_RETENTION_MS + 1),
        },
      ],
      passwordResetTokens: [
        { id: "old-reset", expiresAt: daysAgo(8), usedAt: null },
        {
          id: "recent-reset",
          expiresAt: new Date(NOW.getTime() - AUTH_TOKEN_RETENTION_MS + 1),
          usedAt: null,
        },
      ],
      emailVerificationTokens: [
        { id: "old-verify", expiresAt: NOW, usedAt: daysAgo(8) },
        { id: "current-verify", expiresAt: NOW, usedAt: null },
      ],
      assets: [
        {
          id: "slide-old",
          storageKey: "doc/old.png",
          documentId: "doc-1",
          workspaceId: null,
          deletedAt: daysAgo(8),
        },
        {
          id: "slide-current",
          storageKey: "doc/current.png",
          documentId: "doc-1",
          workspaceId: null,
          deletedAt: daysAgo(1),
        },
      ],
    });
    const slideStorage = makeStorage();

    const result = await runOperationalRetention({
      db,
      storages: { slide: slideStorage, brand: makeStorage() },
      dryRun: false,
      now: NOW,
      batchSize: 1,
    });

    assert.equal(result.rateLimits.deletedCount, 1);
    assert.equal(result.passwordResetTokens.deletedCount, 1);
    assert.equal(result.emailVerificationTokens.deletedCount, 1);
    assert.equal(result.slideAssets.deletedCount, 1);
    assert.deepEqual(
      db.rows.rateLimits.map((row) => row.subject),
      ["recent-rate"],
    );
    assert.deepEqual(
      db.rows.passwordResetTokens.map((row) => row.id),
      ["recent-reset"],
    );
    assert.deepEqual(
      db.rows.emailVerificationTokens.map((row) => row.id),
      ["current-verify"],
    );
    assert.deepEqual(
      db.rows.assets.map((row) => row.id),
      ["slide-current"],
    );
    assert.deepEqual(slideStorage.deletedKeys, ["doc/old.png"]);
  });

  it("honors batch size when more expired rate-limit rows remain", async () => {
    const db = makeDb({
      rateLimits: [
        { subject: "old-1", resetAt: daysAgo(3) },
        { subject: "old-2", resetAt: daysAgo(2) },
        { subject: "old-3", resetAt: daysAgo(1) },
      ],
    });

    const result = await runOperationalRetention({
      db,
      storages: { slide: makeStorage(), brand: makeStorage() },
      dryRun: false,
      now: NOW,
      batchSize: 2,
    });

    assert.equal(result.rateLimits.candidateCount, 2);
    assert.equal(result.rateLimits.deletedCount, 2);
    assert.deepEqual(
      db.rows.rateLimits.map((row) => row.subject),
      ["old-3"],
    );
  });

  it("leaves asset rows for retry when storage deletion fails without logging storage keys", async () => {
    const db = makeDb({
      assets: [
        {
          id: "slide-ok",
          storageKey: "doc/ok.png",
          documentId: "doc-1",
          workspaceId: null,
          deletedAt: daysAgo(8),
        },
        {
          id: "slide-fail",
          storageKey: "doc/fail.png",
          documentId: "doc-1",
          workspaceId: null,
          deletedAt: daysAgo(8),
        },
      ],
    });
    const logger = makeLogger();

    const result = await runOperationalRetention({
      db,
      storages: { slide: makeStorage("fail"), brand: makeStorage() },
      logger,
      dryRun: false,
      now: NOW,
    });

    assert.equal(result.slideAssets.deletedCount, 1);
    assert.equal(result.slideAssets.failedStorageDeleteCount, 1);
    assert.deepEqual(
      db.rows.assets.map((row) => row.id),
      ["slide-fail"],
    );
    assert.equal(logger.errors.length, 1);
    assert.equal(
      logger.errors[0]?.event,
      "maintenance.retention.asset_storage_delete_failed",
    );
    assert.deepEqual(logger.errors[0]?.context, {
      domain: "slide",
      assetId: "slide-fail",
    });
    assert.ok(!JSON.stringify(logger.errors).includes("doc/fail.png"));
  });
});
