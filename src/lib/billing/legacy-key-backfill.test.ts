import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { after, before, describe, it } from "node:test";
import { promisify } from "node:util";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";

import {
  backfillLegacyUsageLedgerKeys,
  DEFAULT_LEGACY_KEY_BACKFILL_BATCH_SIZE,
} from "./legacy-key-backfill";
import {
  deriveUsageLedgerKeyHash,
  USAGE_LEDGER_KEY_HASH_VERSION_CURRENT,
} from "./usage-ledger-key";

interface LegacyBackfillHarness {
  databaseFilePath: string;
  databaseUrl: string;
  client: PrismaClient;
}

const REPO_ROOT = process.cwd();
const SQLITE_TEST_DB_DIRECTORY = resolvePath(REPO_ROOT, "prisma", ".test-dbs");
const execFileAsync = promisify(execFile);

function testRawKey(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${randomUUID().replaceAll("-", "")}`;
}

async function createHarness(): Promise<LegacyBackfillHarness> {
  await mkdir(SQLITE_TEST_DB_DIRECTORY, { recursive: true });
  const databaseFilePath = resolvePath(
    SQLITE_TEST_DB_DIRECTORY,
    `legacy-key-backfill-${randomUUID()}.db`,
  );
  const databaseUrl = `file:${databaseFilePath}`;

  await execFileAsync(
    "npx",
    ["prisma", "db", "push", "--schema", "prisma/schema.sqlite.prisma"],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        DB_PROVIDER: "sqlite",
        DATABASE_URL: databaseUrl,
      },
    },
  );

  const adapter = new PrismaBetterSqlite3({ url: databaseUrl });
  const client = new PrismaClient({ adapter });

  return {
    databaseFilePath,
    databaseUrl,
    client,
  };
}

async function disposeHarness(harness: LegacyBackfillHarness): Promise<void> {
  await harness.client.$disconnect();
  await rm(harness.databaseFilePath, { force: true });
  await rm(`${harness.databaseFilePath}-journal`, { force: true });
  await rm(`${harness.databaseFilePath}-wal`, { force: true });
  await rm(`${harness.databaseFilePath}-shm`, { force: true });
}

async function createUser(client: PrismaClient): Promise<string> {
  const userId = `legacy-backfill-user-${randomUUID()}`;
  await client.user.create({
    data: {
      id: userId,
      email: `${userId}@example.test`,
      plan: "free",
      creditBalance: 10,
      creditPeriodStart: new Date("2026-01-01T00:00:00.000Z"),
    },
  });
  return userId;
}

describe("legacy usage-ledger key backfill", () => {
  let harness: LegacyBackfillHarness;

  before(async () => {
    harness = await createHarness();
  });

  after(async () => {
    await disposeHarness(harness);
  });

  it("dry-run is default and does not mutate ledger rows", async (t) => {
    const userId = await createUser(harness.client);
    const operation = "generate";
    const rawKey = testRawKey("legacy-dry-run");

    await harness.client.usageLedgerEntry.create({
      data: {
        keyHash: rawKey,
        keyHashVersion: 0,
        userId,
        operation,
        creditCost: 2,
        status: "reserved",
        reservationVersion: 0,
      },
    });

    t.after(async () => {
      await harness.client.usageLedgerEntry.deleteMany({ where: { userId } });
      await harness.client.user.deleteMany({ where: { id: userId } });
    });

    const result = await backfillLegacyUsageLedgerKeys({
      client: harness.client,
      batchSize: DEFAULT_LEGACY_KEY_BACKFILL_BATCH_SIZE,
    });

    assert.equal(result.mode, "dry-run");
    assert.equal(result.scanned, 1);
    assert.equal(result.eligible, 1);
    assert.equal(result.updated, 0);
    assert.equal(result.skippedCollision, 0);

    const stored = await harness.client.usageLedgerEntry.findFirstOrThrow({
      where: { userId, operation, reservationVersion: 0 },
      select: {
        keyHash: true,
        keyHashVersion: true,
      },
    });

    assert.equal(stored.keyHash, rawKey);
    assert.equal(stored.keyHashVersion, 0);
    assert.equal(JSON.stringify(result).includes(rawKey), false);
  });

  it("apply rewrites key hashes and marks keyHashVersion without changing reservationVersion", async (t) => {
    const userId = await createUser(harness.client);
    const operation = "generate";
    const rawKey = testRawKey("legacy-apply");
    const expectedKeyHash = deriveUsageLedgerKeyHash({
      idempotencyKey: rawKey,
      userId,
      operation,
    });

    await harness.client.usageLedgerEntry.create({
      data: {
        keyHash: rawKey,
        keyHashVersion: 0,
        userId,
        operation,
        creditCost: 3,
        status: "captured",
        reservationVersion: 0,
      },
    });

    t.after(async () => {
      await harness.client.usageLedgerEntry.deleteMany({ where: { userId } });
      await harness.client.user.deleteMany({ where: { id: userId } });
    });

    const result = await backfillLegacyUsageLedgerKeys({
      client: harness.client,
      apply: true,
      batchSize: 10,
    });

    assert.equal(result.mode, "apply");
    assert.equal(result.scanned, 1);
    assert.equal(result.updated, 1);
    assert.equal(result.rows[0]?.outcome, "updated");
    assert.equal(result.rows[0]?.keyHash, expectedKeyHash);

    const stored = await harness.client.usageLedgerEntry.findUniqueOrThrow({
      where: { keyHash: expectedKeyHash },
      select: {
        keyHashVersion: true,
        reservationVersion: true,
        status: true,
      },
    });

    assert.equal(stored.keyHashVersion, USAGE_LEDGER_KEY_HASH_VERSION_CURRENT);
    assert.equal(stored.reservationVersion, 0);
    assert.equal(stored.status, "captured");
  });

  it("skips collisions and keeps the legacy row untouched", async (t) => {
    const userId = await createUser(harness.client);
    const operation = "generate";
    const rawKey = testRawKey("legacy-collision");
    const derivedKeyHash = deriveUsageLedgerKeyHash({
      idempotencyKey: rawKey,
      userId,
      operation,
    });

    await harness.client.usageLedgerEntry.createMany({
      data: [
        {
          keyHash: derivedKeyHash,
          keyHashVersion: USAGE_LEDGER_KEY_HASH_VERSION_CURRENT,
          userId,
          operation,
          creditCost: 2,
          status: "captured",
          reservationVersion: 1,
        },
        {
          keyHash: rawKey,
          keyHashVersion: 0,
          userId,
          operation,
          creditCost: 2,
          status: "reserved",
          reservationVersion: 0,
        },
      ],
    });

    t.after(async () => {
      await harness.client.usageLedgerEntry.deleteMany({ where: { userId } });
      await harness.client.user.deleteMany({ where: { id: userId } });
    });

    const result = await backfillLegacyUsageLedgerKeys({
      client: harness.client,
      apply: true,
      batchSize: 10,
    });

    assert.equal(result.scanned, 1);
    assert.equal(result.updated, 0);
    assert.equal(result.skippedCollision, 1);
    assert.equal(result.rows[0]?.outcome, "skipped-collision");
    assert.equal(result.rows[0]?.keyHash, derivedKeyHash);

    const legacyRow = await harness.client.usageLedgerEntry.findUniqueOrThrow({
      where: { keyHash: rawKey },
      select: {
        keyHashVersion: true,
        reservationVersion: true,
      },
    });
    assert.equal(legacyRow.keyHashVersion, 0);
    assert.equal(legacyRow.reservationVersion, 0);
  });
});
