import assert from "node:assert/strict";
import { test } from "node:test";

import Database from "better-sqlite3";

import {
  softDeleteDocument,
  restoreDocumentFromTrash,
  listTrashDocumentsForUser,
  permanentDeleteDocument,
  runDocumentMaintenance,
  runDashboardLoadMaintenance,
} from "@/lib/document/trash";
import { SOFT_DELETE_RETENTION_MS } from "@/lib/trash";
import {
  INVITE_LINK_RETENTION_MS,
  PURGE_MIN_INTERVAL_MS,
  resetPurgeLockForTesting,
} from "@/lib/maintenance";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// softDeleteDocument
// ---------------------------------------------------------------------------

test("softDeleteDocument stamps deletedAt on the given document", async () => {
  const calls: unknown[] = [];
  const db = {
    document: {
      async updateMany(args: unknown) {
        calls.push(args);
        return { count: 1 };
      },
    },
  };

  await softDeleteDocument("doc-1", db as never);

  assert.equal(calls.length, 1);
  const call = calls[0] as { where: { id: string }; data: { deletedAt: Date } };
  assert.equal(call.where.id, "doc-1");
  assert.ok(call.data.deletedAt instanceof Date);
  const skew = Date.now() - call.data.deletedAt.getTime();
  assert.ok(skew >= 0 && skew < 2000, "deletedAt should be approximately now");
});

test("softDeleteDocument passes id unchanged to the update", async () => {
  const calls: unknown[] = [];
  const db = {
    document: {
      async updateMany(args: unknown) {
        calls.push(args);
        return { count: 0 };
      },
    },
  };

  await softDeleteDocument("other-id", db as never);

  const call = calls[0] as { where: { id: string } };
  assert.equal(call.where.id, "other-id");
});

// ---------------------------------------------------------------------------
// restoreDocumentFromTrash
// ---------------------------------------------------------------------------

test("restoreDocumentFromTrash clears deletedAt and requires it to be non-null", async () => {
  const calls: unknown[] = [];
  const db = {
    document: {
      async updateMany(args: unknown) {
        calls.push(args);
        return { count: 1 };
      },
    },
  };

  await restoreDocumentFromTrash("doc-2", db as never);

  assert.equal(calls.length, 1);
  const call = calls[0] as {
    where: { id: string; deletedAt: { not: null } };
    data: { deletedAt: null };
  };
  assert.equal(call.where.id, "doc-2");
  assert.deepEqual(call.where.deletedAt, { not: null });
  assert.equal(call.data.deletedAt, null);
});

test("restoreDocumentFromTrash does not restore a document that is not deleted", async () => {
  // The where clause `deletedAt: { not: null }` ensures only trashed docs are
  // affected; verify the shape without a live database.
  const calls: unknown[] = [];
  const db = {
    document: {
      async updateMany(args: unknown) {
        calls.push(args);
        return { count: 0 };
      },
    },
  };

  await restoreDocumentFromTrash("live-doc", db as never);

  const call = calls[0] as {
    where: { id: string; deletedAt: unknown };
  };
  assert.deepEqual(call.where.deletedAt, { not: null });
});

// ---------------------------------------------------------------------------
// listTrashDocumentsForUser
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

test("listTrashDocumentsForUser returns documents within the retention window ordered by deletedAt desc", async () => {
  const now = new Date("2026-06-01T12:00:00Z");
  const recent = new Date(now.getTime() - 2 * DAY_MS);
  const older = new Date(now.getTime() - 5 * DAY_MS);

  const db = {
    document: {
      async findMany() {
        // Simulate DB returning rows already ordered desc
        return [
          { id: "doc-a", title: "Recent", deletedAt: recent },
          { id: "doc-b", title: "Older", deletedAt: older },
        ];
      },
    },
  };

  const result = await listTrashDocumentsForUser("user-1", db as never, now);

  assert.equal(result.length, 2);
  assert.equal(result[0]!.id, "doc-a");
  assert.equal(result[0]!.title, "Recent");
  assert.equal(result[0]!.deletedAtMs, recent.getTime());
  assert.equal(
    result[0]!.remainingMs,
    SOFT_DELETE_RETENTION_MS - (now.getTime() - recent.getTime()),
  );
  assert.equal(result[1]!.id, "doc-b");
});

test("listTrashDocumentsForUser passes correct where/orderBy/select to Prisma", async () => {
  const now = new Date("2026-06-01T00:00:00Z");
  const cutoff = new Date(now.getTime() - SOFT_DELETE_RETENTION_MS);
  const calls: unknown[] = [];

  const db = {
    document: {
      async findMany(args: unknown) {
        calls.push(args);
        return [];
      },
    },
  };

  await listTrashDocumentsForUser("user-xyz", db as never, now);

  assert.equal(calls.length, 1);
  const call = calls[0] as {
    where: { ownerId: string; deletedAt: { not: null; gt: Date } };
    orderBy: { deletedAt: string };
    select: { id: boolean; title: boolean; deletedAt: boolean };
  };
  assert.equal(call.where.ownerId, "user-xyz");
  assert.deepEqual(call.where.deletedAt, { not: null, gt: cutoff });
  assert.deepEqual(call.orderBy, { deletedAt: "desc" });
  assert.deepEqual(call.select, { id: true, title: true, deletedAt: true });
});

test("listTrashDocumentsForUser returns empty list when no documents match", async () => {
  const db = {
    document: {
      async findMany() {
        return [];
      },
    },
  };

  const result = await listTrashDocumentsForUser(
    "user-empty",
    db as never,
    new Date(),
  );

  assert.deepEqual(result, []);
});

test("listTrashDocumentsForUser maps remainingMs to one for documents one millisecond inside the retention window", async () => {
  const now = new Date("2026-06-01T00:00:00Z");
  // Document deleted at exactly the boundary — 1 ms within the window
  const borderline = new Date(now.getTime() - SOFT_DELETE_RETENTION_MS + 1);

  const db = {
    document: {
      async findMany() {
        return [{ id: "border", title: "Border Doc", deletedAt: borderline }];
      },
    },
  };

  const result = await listTrashDocumentsForUser("user-1", db as never, now);

  assert.equal(result.length, 1);
  assert.equal(result[0]!.remainingMs, 1);
});

test("listTrashDocumentsForUser output shape has id, title, deletedAtMs, remainingMs", async () => {
  const now = new Date("2026-06-01T00:00:00Z");
  const deletedAt = new Date(now.getTime() - 1 * DAY_MS);

  const db = {
    document: {
      async findMany() {
        return [{ id: "doc-shape", title: "Shape Test", deletedAt }];
      },
    },
  };

  const [doc] = await listTrashDocumentsForUser("user-1", db as never, now);

  assert.ok(doc);
  assert.equal(typeof doc.id, "string");
  assert.equal(typeof doc.title, "string");
  assert.equal(typeof doc.deletedAtMs, "number");
  assert.equal(typeof doc.remainingMs, "number");
  assert.equal(doc.deletedAtMs, deletedAt.getTime());
  assert.ok(doc.remainingMs > 0);
});

// ---------------------------------------------------------------------------
// permanentDeleteDocument
// ---------------------------------------------------------------------------

test("permanentDeleteDocument calls deleteMany with the supplied id", async () => {
  const calls: unknown[] = [];
  const db = {
    document: {
      async deleteMany(args: unknown) {
        calls.push(args);
        return { count: 1 };
      },
    },
  };

  await permanentDeleteDocument("doc-perm", db as never);

  assert.equal(calls.length, 1);
  const call = calls[0] as { where: { id: string; deletedAt: { not: null } } };
  assert.equal(call.where.id, "doc-perm");
});

test("permanentDeleteDocument guards with deletedAt: { not: null } safety check", async () => {
  const calls: unknown[] = [];
  const db = {
    document: {
      async deleteMany(args: unknown) {
        calls.push(args);
        return { count: 0 };
      },
    },
  };

  await permanentDeleteDocument("doc-live", db as never);

  const call = calls[0] as { where: { id: string; deletedAt: unknown } };
  assert.deepEqual(call.where.deletedAt, { not: null });
});

// ---------------------------------------------------------------------------
// runDocumentMaintenance — document purge cutoff / preservation contracts
// ---------------------------------------------------------------------------
//
// `runDocumentMaintenance` delegates row selection to Prisma via a `where`
// clause and a raw SQL statement; the correctness of Prisma's comparison
// operators and the SQLite engine itself are out of scope here (and, per the
// CI quality gate, the shared `dev.db` is not schema-migrated before tests
// run — only `db:generate` runs, not `db:push`/`db:migrate` — so a real
// connection has no tables to write against). These contracts instead pin
// down the exact cutoff timestamps and query shapes `runDocumentMaintenance`
// sends for each purge category, using the already-public `MaintenanceDb`
// dependency-injection seam — the same technique the sibling
// `softDeleteDocument`/`listTrashDocumentsForUser` contracts above use for
// the same reason.

type RecordedMaintenanceCall = {
  deleteManyArgs?: unknown;
  executeRawStrings?: readonly string[];
  executeRawValues?: unknown[];
};

function createRecordingMaintenanceDb(call: RecordedMaintenanceCall) {
  return {
    document: {
      deleteMany: async (args: unknown) => {
        call.deleteManyArgs = args;
        return { count: 0 };
      },
    },
    $executeRaw: (strings: readonly string[], ...values: unknown[]) => {
      call.executeRawStrings = strings;
      call.executeRawValues = values;
      return Promise.resolve(0);
    },
  };
}

test("runDocumentMaintenance purges documents by comparing deletedAt with strict less-than against the retention cutoff", async () => {
  resetPurgeLockForTesting();
  const now = new Date("2026-06-01T00:00:00.000Z");
  const call: RecordedMaintenanceCall = {};
  const db = createRecordingMaintenanceDb(call);

  const result = await runDocumentMaintenance(
    "dashboard-load",
    db as never,
    now,
  );

  assert.deepEqual(result, { policy: "dashboard-load", skipped: false });
  const expectedCutoff = new Date(now.getTime() - SOFT_DELETE_RETENTION_MS);
  assert.deepEqual(call.deleteManyArgs, {
    where: { deletedAt: { lt: expectedCutoff } },
  });
  // `lt` (strict) rather than `lte` means a document deleted exactly at the
  // cutoff is NOT purged — it is preserved for one more sweep.
  assert.equal(
    Object.keys(
      (call.deleteManyArgs as { where: { deletedAt: object } }).where.deletedAt,
    ).length,
    1,
    "deletedAt filter should use exactly one comparator (lt)",
  );
});

test("runDocumentMaintenance computes the document purge cutoff as exactly now - SOFT_DELETE_RETENTION_MS", async () => {
  resetPurgeLockForTesting();
  for (const now of [
    new Date("2026-01-15T08:30:00.000Z"),
    new Date("2026-12-31T23:59:59.999Z"),
  ]) {
    resetPurgeLockForTesting();
    const call: RecordedMaintenanceCall = {};
    const db = createRecordingMaintenanceDb(call);

    await runDocumentMaintenance("dashboard-load", db as never, now);

    const expectedCutoff = new Date(now.getTime() - SOFT_DELETE_RETENTION_MS);
    const args = call.deleteManyArgs as {
      where: { deletedAt: { lt: Date } };
    };
    assert.equal(args.where.deletedAt.lt.getTime(), expectedCutoff.getTime());
  }
});

test("runDocumentMaintenance's document filter relies on SQL NULL semantics to preserve never-deleted documents", async () => {
  resetPurgeLockForTesting();
  const call: RecordedMaintenanceCall = {};
  const db = createRecordingMaintenanceDb(call);

  await runDocumentMaintenance("dashboard-load", db as never, new Date());

  // No explicit `deletedAt: { not: null } ` guard is present — the query
  // relies on SQL's `NULL < x` evaluating to unknown/false, which already
  // excludes documents that were never soft-deleted. This pins that
  // reliance so a future refactor can't silently drop it without a test
  // failure.
  const where = (call.deleteManyArgs as { where: { deletedAt: object } }).where
    .deletedAt as Record<string, unknown>;
  assert.deepEqual(Object.keys(where), ["lt"]);
});

// ---------------------------------------------------------------------------
// runDocumentMaintenance — invite-link purge cutoff / branch contracts
// ---------------------------------------------------------------------------

test("runDocumentMaintenance purges invite links via a single raw DELETE covering revoked, expired, and exhausted branches", async () => {
  resetPurgeLockForTesting();
  const now = new Date("2026-06-01T00:00:00.000Z");
  const call: RecordedMaintenanceCall = {};
  const db = createRecordingMaintenanceDb(call);

  await runDocumentMaintenance("dashboard-load", db as never, now);

  assert.ok(call.executeRawStrings, "expected a single $executeRaw call");
  const sql = call.executeRawStrings!.join("?");
  assert.match(sql, /DELETE FROM "InviteLink"/);
  assert.match(sql, /WHERE "createdAt" < /);
  assert.match(sql, /"isRevoked" = /);
  assert.match(sql, /OR \("expiresAt" IS NOT NULL AND "expiresAt" < \?\)/);
  assert.match(sql, /OR \("maxUses" IS NOT NULL AND "useCount" >= "maxUses"\)/);
});

test("runDocumentMaintenance's invite-link purge uses one inviteCutoff for the age filter, the expiry branch, and true for the revoked branch", async () => {
  resetPurgeLockForTesting();
  const now = new Date("2026-06-01T00:00:00.000Z");
  const call: RecordedMaintenanceCall = {};
  const db = createRecordingMaintenanceDb(call);

  await runDocumentMaintenance("dashboard-load", db as never, now);

  const expectedCutoff = new Date(now.getTime() - INVITE_LINK_RETENTION_MS);
  assert.deepEqual(call.executeRawValues, [
    expectedCutoff,
    true,
    expectedCutoff,
  ]);
});

test("runDocumentMaintenance computes the invite-link purge cutoff as exactly now - INVITE_LINK_RETENTION_MS", async () => {
  for (const now of [
    new Date("2026-01-15T08:30:00.000Z"),
    new Date("2026-12-31T23:59:59.999Z"),
  ]) {
    resetPurgeLockForTesting();
    const call: RecordedMaintenanceCall = {};
    const db = createRecordingMaintenanceDb(call);

    await runDocumentMaintenance("dashboard-load", db as never, now);

    const expectedCutoff = new Date(now.getTime() - INVITE_LINK_RETENTION_MS);
    const [cutoffArg] = call.executeRawValues as [Date, boolean, Date];
    assert.equal(cutoffArg.getTime(), expectedCutoff.getTime());
  }
});

// ---------------------------------------------------------------------------
// runDocumentMaintenance — invite-link purge: real SQLite branch semantics
//
// The tests above pin the query *text* and *parameters* Prisma is asked to
// send. They can't observe per-row purge outcomes because the recording DB
// never executes SQL. The tests below close that gap: they capture the exact
// DELETE statement `runDocumentMaintenance` produces (via the same recording
// seam) and execute it, verbatim, against a real in-memory SQLite table
// (better-sqlite3 — already a project dependency; this bypasses Prisma/
// migrations entirely, so it needs no schema push). Because the SQL text is
// captured rather than hand-copied, these tests can't drift from production
// behavior — if trash.ts's query changes, the captured text changes with it.
//
// This is the authoritative, single eligibility contract for invite-link
// purging (see src/lib/maintenance.ts's module doc): revoked and exhausted
// links anchor solely on `createdAt` (there is no `revokedAt`/`exhaustedAt`
// column), while the expired branch additionally requires `expiresAt` itself
// to be older than the cutoff.
// ---------------------------------------------------------------------------

type InviteLinkFixture = {
  id: string;
  createdAt: Date;
  isRevoked: boolean;
  expiresAt: Date | null;
  maxUses: number | null;
  useCount: number;
};

/** Creates an in-memory SQLite table with just the columns the raw DELETE touches. */
function seedRealInviteLinkTable(rows: InviteLinkFixture[]): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE "InviteLink" (
      "id" TEXT PRIMARY KEY,
      "createdAt" INTEGER NOT NULL,
      "isRevoked" INTEGER NOT NULL,
      "expiresAt" INTEGER,
      "maxUses" INTEGER,
      "useCount" INTEGER NOT NULL
    );
  `);
  const insert = db.prepare(
    `INSERT INTO "InviteLink" ("id", "createdAt", "isRevoked", "expiresAt", "maxUses", "useCount") VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const row of rows) {
    insert.run(
      row.id,
      row.createdAt.getTime(),
      row.isRevoked ? 1 : 0,
      row.expiresAt ? row.expiresAt.getTime() : null,
      row.maxUses,
      row.useCount,
    );
  }
  return db;
}

/**
 * Runs `runDocumentMaintenance` against the recording DB to capture the exact
 * DELETE statement and bound values it sends, then replays that captured
 * statement against a real in-memory SQLite table seeded with `rows`.
 * Returns the ids that survive the purge.
 */
async function purgeInviteLinkFixturesWithCapturedSql(
  now: Date,
  rows: InviteLinkFixture[],
): Promise<string[]> {
  resetPurgeLockForTesting();
  const call: RecordedMaintenanceCall = {};
  const recordingDb = createRecordingMaintenanceDb(call);
  await runDocumentMaintenance("dashboard-load", recordingDb as never, now);

  const sql = call.executeRawStrings!.join("?");
  const values = (call.executeRawValues as unknown[]).map((value) =>
    value instanceof Date ? value.getTime() : value === true ? 1 : value,
  );

  const sqliteDb = seedRealInviteLinkTable(rows);
  try {
    sqliteDb.prepare(sql).run(...values);
    return sqliteDb
      .prepare(`SELECT "id" FROM "InviteLink" ORDER BY "id"`)
      .all()
      .map((row) => (row as { id: string }).id);
  } finally {
    sqliteDb.close();
  }
}

test("runDocumentMaintenance's invite-link DELETE purges a revoked link whose createdAt is past the cutoff, even with a future expiresAt", async () => {
  const now = new Date("2026-06-01T00:00:00.000Z");
  const cutoff = new Date(now.getTime() - INVITE_LINK_RETENTION_MS);
  const survivors = await purgeInviteLinkFixturesWithCapturedSql(now, [
    {
      // Revoked, created well before the cutoff, but with an expiresAt far
      // in the future. Production purges this on createdAt alone — the
      // revoked branch never consults expiresAt. (This is the exact case
      // the removed isInviteLinkPurgeEligible helper got wrong: it anchored
      // on max(createdAt, expiresAt), which would have kept this link alive
      // indefinitely.)
      id: "revoked-future-expiry",
      createdAt: new Date(cutoff.getTime() - 1),
      isRevoked: true,
      expiresAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
      maxUses: null,
      useCount: 0,
    },
  ]);
  assert.deepEqual(survivors, []);
});

test("runDocumentMaintenance's invite-link DELETE preserves a revoked link whose createdAt has not yet passed the cutoff", async () => {
  const now = new Date("2026-06-01T00:00:00.000Z");
  const cutoff = new Date(now.getTime() - INVITE_LINK_RETENTION_MS);
  const survivors = await purgeInviteLinkFixturesWithCapturedSql(now, [
    {
      id: "revoked-too-recent",
      createdAt: new Date(cutoff.getTime() + 1),
      isRevoked: true,
      expiresAt: null,
      maxUses: null,
      useCount: 0,
    },
  ]);
  assert.deepEqual(survivors, ["revoked-too-recent"]);
});

test("runDocumentMaintenance's invite-link DELETE purges an exhausted link (useCount >= maxUses) past the cutoff", async () => {
  const now = new Date("2026-06-01T00:00:00.000Z");
  const cutoff = new Date(now.getTime() - INVITE_LINK_RETENTION_MS);
  const survivors = await purgeInviteLinkFixturesWithCapturedSql(now, [
    {
      id: "exhausted-exact",
      createdAt: new Date(cutoff.getTime() - 1),
      isRevoked: false,
      expiresAt: null,
      maxUses: 10,
      useCount: 10, // boundary: useCount === maxUses purges via >=
    },
    {
      id: "exhausted-over",
      createdAt: new Date(cutoff.getTime() - 1),
      isRevoked: false,
      expiresAt: null,
      maxUses: 5,
      useCount: 99,
    },
  ]);
  assert.deepEqual(survivors, []);
});

test("runDocumentMaintenance's invite-link DELETE preserves a link within its usage cap regardless of age", async () => {
  const now = new Date("2026-06-01T00:00:00.000Z");
  const cutoff = new Date(now.getTime() - INVITE_LINK_RETENTION_MS);
  const survivors = await purgeInviteLinkFixturesWithCapturedSql(now, [
    {
      id: "within-cap",
      createdAt: new Date(cutoff.getTime() - 1),
      isRevoked: false,
      expiresAt: null,
      maxUses: 5,
      useCount: 3,
    },
  ]);
  assert.deepEqual(survivors, ["within-cap"]);
});

test("runDocumentMaintenance's invite-link DELETE purges an expired link only when both createdAt and expiresAt are past the cutoff", async () => {
  const now = new Date("2026-06-01T00:00:00.000Z");
  const cutoff = new Date(now.getTime() - INVITE_LINK_RETENTION_MS);
  const survivors = await purgeInviteLinkFixturesWithCapturedSql(now, [
    {
      // Both createdAt and expiresAt precede the cutoff → purged.
      id: "expired-both-old",
      createdAt: new Date(cutoff.getTime() - 2),
      isRevoked: false,
      expiresAt: new Date(cutoff.getTime() - 1),
      maxUses: null,
      useCount: 0,
    },
    {
      // expiresAt precedes the cutoff, but createdAt does not (unusual data:
      // expiresAt set earlier than createdAt) → the createdAt age filter
      // gates every branch, so this survives despite the expired expiresAt.
      id: "expired-but-too-new",
      createdAt: new Date(cutoff.getTime() + 1),
      isRevoked: false,
      expiresAt: new Date(cutoff.getTime() - 1),
      maxUses: null,
      useCount: 0,
    },
  ]);
  assert.deepEqual(survivors, ["expired-but-too-new"]);
});

test("runDocumentMaintenance's invite-link DELETE preserves a link that is not yet expired, regardless of age", async () => {
  const now = new Date("2026-06-01T00:00:00.000Z");
  const cutoff = new Date(now.getTime() - INVITE_LINK_RETENTION_MS);
  const survivors = await purgeInviteLinkFixturesWithCapturedSql(now, [
    {
      id: "future-expiry-old-created",
      createdAt: new Date(cutoff.getTime() - 1),
      isRevoked: false,
      expiresAt: new Date(now.getTime() + 1_000),
      maxUses: null,
      useCount: 0,
    },
  ]);
  assert.deepEqual(survivors, ["future-expiry-old-created"]);
});

test("runDocumentMaintenance's invite-link DELETE preserves a live link with a null expiresAt regardless of age", async () => {
  const now = new Date("2026-06-01T00:00:00.000Z");
  const cutoff = new Date(now.getTime() - INVITE_LINK_RETENTION_MS);
  const survivors = await purgeInviteLinkFixturesWithCapturedSql(now, [
    {
      id: "null-expiry-live",
      createdAt: new Date(cutoff.getTime() - 1),
      isRevoked: false,
      expiresAt: null,
      maxUses: null,
      useCount: 0,
    },
  ]);
  assert.deepEqual(survivors, ["null-expiry-live"]);
});

test("runDocumentMaintenance's invite-link DELETE treats the createdAt cutoff comparison as strict less-than", async () => {
  const now = new Date("2026-06-01T00:00:00.000Z");
  const cutoff = new Date(now.getTime() - INVITE_LINK_RETENTION_MS);
  const survivors = await purgeInviteLinkFixturesWithCapturedSql(now, [
    {
      // createdAt === cutoff is NOT "< cutoff" → preserved for one more sweep.
      id: "created-at-cutoff-boundary",
      createdAt: new Date(cutoff.getTime()),
      isRevoked: true,
      expiresAt: null,
      maxUses: null,
      useCount: 0,
    },
    {
      // createdAt one millisecond older than the cutoff → purged.
      id: "created-just-past-cutoff",
      createdAt: new Date(cutoff.getTime() - 1),
      isRevoked: true,
      expiresAt: null,
      maxUses: null,
      useCount: 0,
    },
  ]);
  assert.deepEqual(survivors, ["created-at-cutoff-boundary"]);
});

test("runDocumentMaintenance's invite-link DELETE treats the expiresAt cutoff comparison as strict less-than", async () => {
  const now = new Date("2026-06-01T00:00:00.000Z");
  const cutoff = new Date(now.getTime() - INVITE_LINK_RETENTION_MS);
  const survivors = await purgeInviteLinkFixturesWithCapturedSql(now, [
    {
      // expiresAt === cutoff is NOT "< cutoff" → preserved (not dead yet).
      id: "expires-at-cutoff-boundary",
      createdAt: new Date(cutoff.getTime() - 10),
      isRevoked: false,
      expiresAt: new Date(cutoff.getTime()),
      maxUses: null,
      useCount: 0,
    },
    {
      // expiresAt one millisecond older than the cutoff → purged.
      id: "expires-just-past-cutoff",
      createdAt: new Date(cutoff.getTime() - 10),
      isRevoked: false,
      expiresAt: new Date(cutoff.getTime() - 1),
      maxUses: null,
      useCount: 0,
    },
  ]);
  assert.deepEqual(survivors, ["expires-at-cutoff-boundary"]);
});

// ---------------------------------------------------------------------------
// runDocumentMaintenance — lock acquisition / skip behavior
// ---------------------------------------------------------------------------

test("runDocumentMaintenance acquires the purge lock and issues both purge queries on the first dashboard-load call", async () => {
  resetPurgeLockForTesting();
  const call: RecordedMaintenanceCall = {};
  const db = createRecordingMaintenanceDb(call);

  const result = await runDocumentMaintenance(
    "dashboard-load",
    db as never,
    new Date(),
  );

  assert.deepEqual(result, { policy: "dashboard-load", skipped: false });
  assert.ok(call.deleteManyArgs, "document.deleteMany should have run");
  assert.ok(call.executeRawStrings, "$executeRaw should have run");
});

test("runDocumentMaintenance skips a second dashboard-load call within the throttle interval and issues no queries", async () => {
  resetPurgeLockForTesting();
  const first = new Date("2026-06-01T00:00:00.000Z");
  const firstCall: RecordedMaintenanceCall = {};
  const firstDb = createRecordingMaintenanceDb(firstCall);

  const firstResult = await runDocumentMaintenance(
    "dashboard-load",
    firstDb as never,
    first,
  );
  assert.equal(firstResult.skipped, false);

  const secondCall: RecordedMaintenanceCall = {};
  const secondDb = createRecordingMaintenanceDb(secondCall);
  const withinInterval = new Date(first.getTime() + PURGE_MIN_INTERVAL_MS - 1);

  const secondResult = await runDocumentMaintenance(
    "dashboard-load",
    secondDb as never,
    withinInterval,
  );

  assert.deepEqual(secondResult, { policy: "dashboard-load", skipped: true });
  // A true no-op: neither query surface was touched by the throttled call.
  assert.equal(secondCall.deleteManyArgs, undefined);
  assert.equal(secondCall.executeRawStrings, undefined);
});

test("runDocumentMaintenance re-acquires the lock and issues both queries once the throttle interval elapses", async () => {
  resetPurgeLockForTesting();
  const first = new Date("2026-06-01T00:00:00.000Z");
  const firstDb = createRecordingMaintenanceDb({});

  const firstResult = await runDocumentMaintenance(
    "dashboard-load",
    firstDb as never,
    first,
  );
  assert.equal(firstResult.skipped, false);

  const afterInterval = new Date(first.getTime() + PURGE_MIN_INTERVAL_MS);
  const secondCall: RecordedMaintenanceCall = {};
  const secondDb = createRecordingMaintenanceDb(secondCall);

  const secondResult = await runDocumentMaintenance(
    "dashboard-load",
    secondDb as never,
    afterInterval,
  );

  assert.deepEqual(secondResult, { policy: "dashboard-load", skipped: false });
  assert.ok(secondCall.deleteManyArgs, "document.deleteMany should have run");
  assert.ok(secondCall.executeRawStrings, "$executeRaw should have run");
});

// ---------------------------------------------------------------------------
// runDocumentMaintenance — returned result shape
// ---------------------------------------------------------------------------

test("runDocumentMaintenance returns exactly { policy, skipped } with policy echoed back", async () => {
  resetPurgeLockForTesting();
  const db = createRecordingMaintenanceDb({});

  const result = await runDocumentMaintenance(
    "dashboard-load",
    db as never,
    new Date(),
  );

  assert.deepEqual(Object.keys(result).sort(), ["policy", "skipped"]);
  assert.equal(result.policy, "dashboard-load");
  assert.equal(result.skipped, false);
});

test("runDocumentMaintenance returns skipped:true with the policy still echoed back when throttled", async () => {
  resetPurgeLockForTesting();
  const now = new Date("2026-06-01T00:00:00.000Z");
  await runDocumentMaintenance(
    "dashboard-load",
    createRecordingMaintenanceDb({}) as never,
    now,
  );

  const result = await runDocumentMaintenance(
    "dashboard-load",
    createRecordingMaintenanceDb({}) as never,
    new Date(now.getTime() + 1),
  );

  assert.deepEqual(Object.keys(result).sort(), ["policy", "skipped"]);
  assert.equal(result.policy, "dashboard-load");
  assert.equal(result.skipped, true);
});
// --- error propagation -------------------------------------------------------
//
// Forcing a genuine SQLite failure deterministically depends on driver/OS
// state, so these two contracts use the already-public `MaintenanceDb`
// dependency-injection seam to prove errors from either query surface a real
// rejection instead of being caught, logged, or replaced with a default
// result.

test("runDocumentMaintenance propagates a document.deleteMany failure without swallowing it", async () => {
  resetPurgeLockForTesting();
  const failure = new Error("document purge failed");
  const db = {
    document: {
      deleteMany: async () => {
        throw failure;
      },
    },
    $executeRaw: async () => 0,
  };

  await assert.rejects(
    runDocumentMaintenance("dashboard-load", db as never, new Date()),
    failure,
  );
});

test("runDocumentMaintenance propagates an invite-link $executeRaw failure without swallowing it", async () => {
  resetPurgeLockForTesting();
  const failure = new Error("invite link purge failed");
  const db = {
    document: {
      deleteMany: async () => ({ count: 0 }),
    },
    $executeRaw: async () => {
      throw failure;
    },
  };

  await assert.rejects(
    runDocumentMaintenance("dashboard-load", db as never, new Date()),
    failure,
  );
});

// ---------------------------------------------------------------------------
// runDashboardLoadMaintenance — dashboard delegation
// ---------------------------------------------------------------------------

test("runDashboardLoadMaintenance delegates to runDocumentMaintenance with the dashboard-load policy against the live prisma client", async (t) => {
  resetPurgeLockForTesting();

  const deleteManyCalls: unknown[] = [];
  const executeRawCalls: unknown[] = [];

  const originalDeleteMany = prisma.document.deleteMany;
  const originalExecuteRaw = prisma.$executeRaw;

  Object.defineProperty(prisma.document, "deleteMany", {
    configurable: true,
    value: async (args: unknown) => {
      deleteManyCalls.push(args);
      return { count: 0 };
    },
  });
  Object.defineProperty(prisma, "$executeRaw", {
    configurable: true,
    value: (...args: unknown[]) => {
      executeRawCalls.push(args);
      return Promise.resolve(0);
    },
  });

  t.after(() => {
    Object.defineProperty(prisma.document, "deleteMany", {
      configurable: true,
      value: originalDeleteMany,
    });
    Object.defineProperty(prisma, "$executeRaw", {
      configurable: true,
      value: originalExecuteRaw,
    });
  });

  const result = await runDashboardLoadMaintenance();

  assert.deepEqual(result, { policy: "dashboard-load", skipped: false });
  assert.equal(deleteManyCalls.length, 1);
  assert.equal(executeRawCalls.length, 1);
});

test("runDashboardLoadMaintenance is skipped when the dashboard-load lock was just acquired", async (t) => {
  resetPurgeLockForTesting();

  const deleteManyCalls: unknown[] = [];
  const originalDeleteMany = prisma.document.deleteMany;
  const originalExecuteRaw = prisma.$executeRaw;
  Object.defineProperty(prisma.document, "deleteMany", {
    configurable: true,
    value: async (args: unknown) => {
      deleteManyCalls.push(args);
      return { count: 0 };
    },
  });
  Object.defineProperty(prisma, "$executeRaw", {
    configurable: true,
    value: () => Promise.resolve(0),
  });
  t.after(() => {
    Object.defineProperty(prisma.document, "deleteMany", {
      configurable: true,
      value: originalDeleteMany,
    });
    Object.defineProperty(prisma, "$executeRaw", {
      configurable: true,
      value: originalExecuteRaw,
    });
  });

  // First call (via the direct API, current real time) acquires the lock.
  // `runDashboardLoadMaintenance` below runs moments later — well inside
  // PURGE_MIN_INTERVAL_MS (5 minutes) — so it must observe the held lock.
  await runDocumentMaintenance("dashboard-load", prisma, new Date());
  deleteManyCalls.length = 0;

  const result = await runDashboardLoadMaintenance();

  assert.deepEqual(result, { policy: "dashboard-load", skipped: true });
  assert.equal(deleteManyCalls.length, 0);
});
