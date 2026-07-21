/**
 * Direct behavior coverage for `runAuditMain` (#1964) — the injectable CLI
 * orchestration in `audit-persisted-schema.ts`: pagination, the twelve loaders'
 * query-sequencing, `auditRows`/`formatAuditReport` wiring, `--json` vs
 * plain-text output, `--ci`/`--strict` exit-code gating, and
 * `db.$disconnect()`/error-propagation behavior in the `finally` block.
 *
 * Every test drives `runAuditMain` through the {@link AuditDb} dependency
 * seam with an in-memory fake `db` (never a real Prisma client) — mirroring
 * `scripts/retention-runner.test.mjs`'s fake-delegate-with-call-tracking
 * pattern. Unlike that file, this suite does not add a `spawnSync`
 * subprocess test: `retention-runner.mjs`'s subprocess test relies on an
 * unsafe-config validation error that throws *before* any DB dependency is
 * touched, but `runAuditMain` has no equivalent pre-DB failure path (unknown
 * argv flags are silently ignored), so a real subprocess invocation would
 * need a working seeded SQLite database to behave deterministically — none
 * exists in this worktree, and creating one here would be exactly the kind
 * of DB mutation/side effect this suite must avoid. In-process DI coverage
 * exercises the same orchestration logic without that risk.
 *
 * The pure per-row audit logic (`auditRows`, `auditDocumentDeck`,
 * `auditUserPlan`, etc.) is already fully covered by
 * `src/lib/schema-audit/audit.test.ts` — out of scope to duplicate here.
 * This file only asserts that `runAuditMain` wires loader results into that
 * core correctly (using one deliberately-invalid `User.plan` row as the
 * cheapest deterministic single-violation fixture).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  runAuditMain,
  DEFAULT_PAGE_SIZE,
  type AuditDb,
} from "./audit-persisted-schema";
import type {
  AssetAuditRow,
  BrandAuditRow,
  CommentAuditRow,
  DocumentAuditRow,
  DocumentVersionAuditRow,
  SubscriptionAuditRow,
  TagAuditRow,
  UsageLedgerAuditRow,
  UserPlanAuditRow,
  VisualAuditRow,
  VisualRevisionAuditRow,
  WorkspaceRoleAuditRow,
} from "@/lib/schema-audit/audit";

/** Permissive superset of every delegate's real `findMany` argument shape. */
interface DelegateCallArgs {
  take?: number;
  skip?: number;
  cursor?: { id: string };
  orderBy?: unknown;
  select?: unknown;
}

interface TrackedDelegate<Row> {
  findMany: (args: DelegateCallArgs) => Promise<Row[]>;
  calls: DelegateCallArgs[];
}

function createTrackedDelegate<Row>(
  name: string,
  callOrder: string[],
  handler: (args: DelegateCallArgs) => Row[],
): TrackedDelegate<Row> {
  const calls: DelegateCallArgs[] = [];
  return {
    calls,
    findMany: async (args: DelegateCallArgs) => {
      callOrder.push(name);
      calls.push(args);
      return handler(args);
    },
  };
}

/** Models real Prisma cursor pagination: sort by `id`, slice after cursor. */
function pagedHandler<Row extends { id: string }>(
  rows: Row[],
): (args: DelegateCallArgs) => Row[] {
  const sorted = [...rows].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  return (args: DelegateCallArgs) => {
    const take = args.take ?? sorted.length;
    let start = 0;
    if (args.cursor) {
      start = sorted.findIndex((row) => row.id === args.cursor?.id) + 1;
    }
    return sorted.slice(start, start + take);
  };
}

function createPagedDelegate<Row extends { id: string }>(
  name: string,
  rows: Row[],
  callOrder: string[],
): TrackedDelegate<Row> {
  return createTrackedDelegate(name, callOrder, pagedHandler(rows));
}

function createStaticDelegate<Row>(
  name: string,
  rows: Row[],
  callOrder: string[],
): TrackedDelegate<Row> {
  return createTrackedDelegate(name, callOrder, () => rows);
}

interface Fixtures {
  documents?: DocumentAuditRow[];
  visuals?: VisualAuditRow[];
  visualRevisions?: VisualRevisionAuditRow[];
  documentVersions?: DocumentVersionAuditRow[];
  comments?: CommentAuditRow[];
  tags?: TagAuditRow[];
  workspaceMembers?: WorkspaceRoleAuditRow[];
  inviteLinks?: WorkspaceRoleAuditRow[];
  inviteLinkUses?: WorkspaceRoleAuditRow[];
  users?: UserPlanAuditRow[];
  subscriptions?: SubscriptionAuditRow[];
  usageLedgerEntries?: UsageLedgerAuditRow[];
  assets?: AssetAuditRow[];
  brands?: BrandAuditRow[];
}

function createFakeDb(fixtures: Fixtures = {}) {
  const callOrder: string[] = [];
  let disconnectCalls = 0;

  const delegates = {
    document: createPagedDelegate(
      "document",
      fixtures.documents ?? [],
      callOrder,
    ),
    visual: createPagedDelegate("visual", fixtures.visuals ?? [], callOrder),
    visualRevision: createPagedDelegate(
      "visualRevision",
      fixtures.visualRevisions ?? [],
      callOrder,
    ),
    documentVersion: createPagedDelegate(
      "documentVersion",
      fixtures.documentVersions ?? [],
      callOrder,
    ),
    comment: createPagedDelegate("comment", fixtures.comments ?? [], callOrder),
    tag: createPagedDelegate("tag", fixtures.tags ?? [], callOrder),
    workspaceMember: createStaticDelegate(
      "workspaceMember",
      fixtures.workspaceMembers ?? [],
      callOrder,
    ),
    inviteLink: createStaticDelegate(
      "inviteLink",
      fixtures.inviteLinks ?? [],
      callOrder,
    ),
    inviteLinkUse: createStaticDelegate(
      "inviteLinkUse",
      fixtures.inviteLinkUses ?? [],
      callOrder,
    ),
    user: createStaticDelegate("user", fixtures.users ?? [], callOrder),
    subscription: createStaticDelegate(
      "subscription",
      fixtures.subscriptions ?? [],
      callOrder,
    ),
    usageLedgerEntry: createStaticDelegate(
      "usageLedgerEntry",
      fixtures.usageLedgerEntries ?? [],
      callOrder,
    ),
    asset: createPagedDelegate("asset", fixtures.assets ?? [], callOrder),
    brand: createPagedDelegate("brand", fixtures.brands ?? [], callOrder),
  };

  const db: AuditDb = {
    ...delegates,
    $disconnect: async () => {
      disconnectCalls++;
    },
  };

  return {
    db,
    callOrder,
    delegates,
    get disconnectCalls() {
      return disconnectCalls;
    },
  };
}

function doc(id: string): DocumentAuditRow {
  // deckJson/contentJson: null skips validation entirely (see
  // `auditDocumentDeck`/`auditDocumentContentVisuals`) — these fixtures only
  // exercise pagination/sequencing, never schema-validation correctness.
  return { id, deckJson: null, contentJson: null };
}

describe("runAuditMain: pagination", () => {
  test("pages a delegate using the injected pageSize, advancing the cursor to the last row's id until a short page ends it", async () => {
    const fake = createFakeDb({ documents: [doc("a"), doc("b"), doc("c")] });
    const out: string[] = [];
    await runAuditMain({
      argv: ["--json"],
      db: fake.db,
      pageSize: 2,
      resolveProviderFn: () => "sqlite",
      stdout: (message) => out.push(message),
      stderr: () => {},
    });

    assert.equal(fake.delegates.document.calls.length, 2);
    assert.deepEqual(fake.delegates.document.calls[0], {
      take: 2,
      orderBy: { id: "asc" },
      select: { id: true, deckJson: true, contentJson: true },
    });
    assert.deepEqual(fake.delegates.document.calls[1], {
      take: 2,
      skip: 1,
      cursor: { id: "b" },
      orderBy: { id: "asc" },
      select: { id: true, deckJson: true, contentJson: true },
    });

    const report = JSON.parse(out[0]);
    assert.equal(report.summary.scannedDocuments, 3);
  });

  test("stops after a single page when the first page is shorter than pageSize", async () => {
    const fake = createFakeDb({ documents: [doc("only")] });
    await runAuditMain({
      argv: [],
      db: fake.db,
      pageSize: 500,
      stdout: () => {},
      stderr: () => {},
    });
    assert.equal(fake.delegates.document.calls.length, 1);
  });

  test("stops immediately, with one call, when a delegate has zero rows", async () => {
    const fake = createFakeDb();
    await runAuditMain({
      argv: [],
      db: fake.db,
      stdout: () => {},
      stderr: () => {},
    });
    assert.equal(fake.delegates.asset.calls.length, 1);
  });

  test("defaults pageSize to DEFAULT_PAGE_SIZE when not provided", async () => {
    const fake = createFakeDb({ documents: [doc("a")] });
    await runAuditMain({
      argv: [],
      db: fake.db,
      stdout: () => {},
      stderr: () => {},
    });
    assert.equal(fake.delegates.document.calls[0]?.take, DEFAULT_PAGE_SIZE);
  });
});

describe("runAuditMain: loader query sequencing", () => {
  test("starts all twelve loaders' first findMany call in the documented Promise.all order", async () => {
    const fake = createFakeDb();
    await runAuditMain({
      argv: [],
      db: fake.db,
      stdout: () => {},
      stderr: () => {},
    });
    assert.deepEqual(fake.callOrder, [
      "document",
      "visual",
      "visualRevision",
      "documentVersion",
      "comment",
      "tag",
      "workspaceMember",
      "inviteLink",
      "inviteLinkUse",
      "user",
      "subscription",
      "usageLedgerEntry",
      "asset",
      "brand",
    ]);
  });
});

describe("runAuditMain: loader-to-auditRows-to-summary wiring", () => {
  test("an invalid User.plan row surfaces as exactly one violation in the report", async () => {
    const fake = createFakeDb({ users: [{ id: "u1", plan: "bogus" }] });
    const out: string[] = [];
    await runAuditMain({
      argv: ["--json"],
      db: fake.db,
      resolveProviderFn: () => "sqlite",
      stdout: (message) => out.push(message),
      stderr: () => {},
    });
    const report = JSON.parse(out[0]);
    assert.equal(report.summary.violations, 1);
    assert.equal(report.summary.scannedUsers, 1);
    assert.equal(report.violations.length, 1);
    assert.equal(report.violations[0].area, "User.plan");
    assert.equal(report.violations[0].rowId, "u1");
  });

  test("zero rows across every loader produces zero violations", async () => {
    const fake = createFakeDb();
    const out: string[] = [];
    await runAuditMain({
      argv: ["--json"],
      db: fake.db,
      stdout: (message) => out.push(message),
      stderr: () => {},
    });
    const report = JSON.parse(out[0]);
    assert.equal(report.summary.violations, 0);
  });
});

describe("runAuditMain: --json vs plain-text output", () => {
  test("--json prints exactly one line: the provider plus the full report as JSON", async () => {
    const fake = createFakeDb();
    const out: string[] = [];
    await runAuditMain({
      argv: ["--json"],
      db: fake.db,
      resolveProviderFn: () => "sqlite",
      stdout: (message) => out.push(message),
      stderr: () => {},
    });
    assert.equal(out.length, 1);
    const parsed = JSON.parse(out[0]);
    assert.equal(parsed.provider, "sqlite");
    assert.equal(parsed.summary.violations, 0);
  });

  test("plain text (no --json) prints a provider header line then formatAuditReport's lines", async () => {
    const fake = createFakeDb({ users: [{ id: "u1", plan: "bogus" }] });
    const out: string[] = [];
    await runAuditMain({
      argv: [],
      db: fake.db,
      resolveProviderFn: () => "postgres",
      stdout: (message) => out.push(message),
      stderr: () => {},
    });
    assert.equal(out[0], "Persisted schema audit (provider: postgres)");
    assert.match(out[1] ?? "", /^Scanned 0 document\(s\)/);
    const rest = out.slice(1).join("\n");
    assert.match(rest, /Found 1 violation\(s\):/);
    assert.match(rest, /\[User\.plan\] row=u1 —/);
  });

  test("plain text reports 'No schema violations found.' when there are none", async () => {
    const fake = createFakeDb();
    const out: string[] = [];
    await runAuditMain({
      argv: [],
      db: fake.db,
      stdout: (message) => out.push(message),
      stderr: () => {},
    });
    assert.ok(out.some((line) => line === "No schema violations found."));
  });
});

describe("runAuditMain: --ci/--strict exit-code gating", () => {
  test("without --ci/--strict, process.exitCode is left untouched even with violations", async (t) => {
    const saved = process.exitCode;
    t.after(() => {
      process.exitCode = saved;
    });
    process.exitCode = undefined;
    const fake = createFakeDb({ users: [{ id: "u1", plan: "bogus" }] });
    await runAuditMain({
      argv: [],
      db: fake.db,
      stdout: () => {},
      stderr: () => {},
    });
    assert.equal(process.exitCode, undefined);
  });

  test("--ci sets process.exitCode = 1 when violations are found", async (t) => {
    const saved = process.exitCode;
    t.after(() => {
      process.exitCode = saved;
    });
    process.exitCode = undefined;
    const fake = createFakeDb({ users: [{ id: "u1", plan: "bogus" }] });
    await runAuditMain({
      argv: ["--ci"],
      db: fake.db,
      stdout: () => {},
      stderr: () => {},
    });
    assert.equal(process.exitCode, 1);
  });

  test("--strict also sets process.exitCode = 1 when violations are found", async (t) => {
    const saved = process.exitCode;
    t.after(() => {
      process.exitCode = saved;
    });
    process.exitCode = undefined;
    const fake = createFakeDb({ users: [{ id: "u1", plan: "bogus" }] });
    await runAuditMain({
      argv: ["--strict"],
      db: fake.db,
      stdout: () => {},
      stderr: () => {},
    });
    assert.equal(process.exitCode, 1);
  });

  test("--ci leaves process.exitCode untouched when there are zero violations", async (t) => {
    const saved = process.exitCode;
    t.after(() => {
      process.exitCode = saved;
    });
    process.exitCode = undefined;
    const fake = createFakeDb();
    await runAuditMain({
      argv: ["--ci"],
      db: fake.db,
      stdout: () => {},
      stderr: () => {},
    });
    assert.equal(process.exitCode, undefined);
  });
});

describe("runAuditMain: disconnect + error propagation", () => {
  test("calls db.$disconnect() exactly once on success", async () => {
    const fake = createFakeDb();
    await runAuditMain({
      argv: [],
      db: fake.db,
      stdout: () => {},
      stderr: () => {},
    });
    assert.equal(fake.disconnectCalls, 1);
  });

  test("still calls db.$disconnect() exactly once, sets exitCode=1, and reports an Error's message when a loader throws", async (t) => {
    const saved = process.exitCode;
    t.after(() => {
      process.exitCode = saved;
    });
    process.exitCode = undefined;
    const fake = createFakeDb();
    fake.delegates.document.findMany = async () => {
      throw new Error("connection lost");
    };
    const errOut: string[] = [];
    await runAuditMain({
      argv: [],
      db: fake.db,
      stdout: () => {},
      stderr: (message) => errOut.push(message),
    });
    assert.equal(process.exitCode, 1);
    assert.equal(fake.disconnectCalls, 1);
    assert.deepEqual(errOut, ["Schema audit failed: connection lost"]);
  });

  test("formats a non-Error thrown value via String() and still disconnects", async (t) => {
    const saved = process.exitCode;
    t.after(() => {
      process.exitCode = saved;
    });
    process.exitCode = undefined;
    const fake = createFakeDb();
    fake.delegates.tag.findMany = async () => {
      throw "raw string failure";
    };
    const errOut: string[] = [];
    await runAuditMain({
      argv: [],
      db: fake.db,
      stdout: () => {},
      stderr: (message) => errOut.push(message),
    });
    assert.deepEqual(errOut, ["Schema audit failed: raw string failure"]);
    assert.equal(fake.disconnectCalls, 1);
  });
});
