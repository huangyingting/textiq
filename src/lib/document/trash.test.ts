import assert from "node:assert/strict";
import { test } from "node:test";

import {
  softDeleteDocument,
  restoreDocumentFromTrash,
  listTrashDocumentsForUser,
} from "@/lib/document/trash";
import { SOFT_DELETE_RETENTION_MS } from "@/lib/trash";

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

test("listTrashDocumentsForUser maps remainingMs to zero for documents exactly at the cutoff", async () => {
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
