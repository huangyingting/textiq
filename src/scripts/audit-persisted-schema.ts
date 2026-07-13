/**
 * Persisted-payload schema audit CLI (#501).
 *
 * Thin DB-reading wrapper around the pure audit core in
 * `src/lib/schema-audit/audit.ts`. Connects via the app Prisma client (honoring
 * `DB_PROVIDER` / `DATABASE_URL`), scans every `Document.deckJson`, embedded
 * `Document.contentJson` visual, `Visual.data` row, and active Deck source
 * metadata (`slides[].source` and `slides[].children[].source`), and reports
 * violations using SAFE identifiers only (row id / document id / schema area /
 * failure reason) — never document content.
 *
 * Usage:
 *   node --import tsx src/scripts/audit-persisted-schema.ts            # summary, exit 0
 *   node --import tsx src/scripts/audit-persisted-schema.ts --ci       # exit 1 on any violation
 *   node --import tsx src/scripts/audit-persisted-schema.ts --json     # machine-readable JSON
 *
 * npm script: `npm run audit:schema -- [--ci] [--json]`.
 *
 * Run as part of the release gate (see docs/operations/release-gate.md) with
 * `--ci` so any persisted-schema drift blocks the release.
 *
 * The ten loaders and the CLI orchestration (`runAuditMain`) are
 * dependency-injected on an {@link AuditDb} seam — mirroring
 * `src/lib/maintenance/retention-runner.ts`'s injectable `db`/`RetentionDb`
 * pattern — so `audit-persisted-schema.test.ts` can drive pagination,
 * query-sequencing, `--ci`/`--json` output, and disconnect/error handling
 * with a fake in-memory `db` instead of a real Prisma client. Unlike
 * `retention-runner.ts` (whose CLI entry lives in a separate
 * `scripts/retention-runner.mjs`, since that wrapper runs under plain
 * `node`), this script is always invoked through `tsx` (see Usage above), so
 * the injectable runner and its `import.meta.url` main guard stay in this
 * one file rather than being split across a `scripts/*.mjs` counterpart. The
 * guard calls `runAuditMain().catch(...)` rather than a top-level `await` —
 * `tsx` transforms this file to CommonJS output when it's `import`ed from
 * `audit-persisted-schema.test.ts`, and esbuild's CJS output format rejects
 * literal top-level `await` syntax outright, so the CommonJS-safe `.catch`
 * form (already used by `scripts/account-erasure-dry-run.mjs`) keeps the
 * module importable for tests while leaving CLI behavior unchanged.
 */

import { prisma } from "@/lib/prisma";
import { resolveProvider } from "@/lib/db-provider";
import { pathToFileURL } from "node:url";
import process from "node:process";
import {
  auditRows,
  formatAuditReport,
  type AssetAuditRow,
  type CommentAuditRow,
  type DocumentAuditRow,
  type DocumentVersionAuditRow,
  type SubscriptionAuditRow,
  type TagAuditRow,
  type UsageLedgerAuditRow,
  type UserPlanAuditRow,
  type VisualAuditRow,
  type WorkspaceRoleAuditRow,
} from "@/lib/schema-audit/audit";

export const DEFAULT_PAGE_SIZE = 500;

type Cursor = { id: string } | undefined;

interface PagedDelegate<Row> {
  findMany(args: {
    take: number;
    skip?: 1;
    cursor?: { id: string };
    orderBy: { id: "asc" };
    select: Record<string, true>;
  }): Promise<Row[]>;
}

interface RoleDelegate {
  findMany(args: {
    select: { id: true; role: true };
    orderBy: { id: "asc" };
  }): Promise<WorkspaceRoleAuditRow[]>;
}

/**
 * Injectable DB seam for the audit CLI's ten read-only loaders — the same
 * shape as the real Prisma client's delegates, narrowed to only the
 * `findMany` overloads each loader actually calls. Never mutates data: every
 * method here is a plain paginated (or single-shot) read.
 */
export interface AuditDb {
  document: PagedDelegate<DocumentAuditRow>;
  visual: PagedDelegate<VisualAuditRow>;
  documentVersion: PagedDelegate<DocumentVersionAuditRow>;
  comment: PagedDelegate<CommentAuditRow>;
  tag: PagedDelegate<TagAuditRow>;
  workspaceMember: RoleDelegate;
  inviteLink: RoleDelegate;
  inviteLinkUse: RoleDelegate;
  user: {
    findMany(args: {
      select: { id: true; plan: true };
      orderBy: { id: "asc" };
    }): Promise<UserPlanAuditRow[]>;
  };
  subscription: {
    findMany(args: {
      select: { id: true; plan: true; status: true };
      orderBy: { id: "asc" };
    }): Promise<SubscriptionAuditRow[]>;
  };
  usageLedgerEntry: {
    findMany(args: {
      select: { id: true; status: true };
      orderBy: { id: "asc" };
    }): Promise<UsageLedgerAuditRow[]>;
  };
  asset: PagedDelegate<AssetAuditRow>;
  $disconnect(): Promise<void>;
}

function defaultDb(): AuditDb {
  return prisma as unknown as AuditDb;
}

async function paginate<Row extends { id: string }>(
  delegate: PagedDelegate<Row>,
  select: Record<string, true>,
  pageSize: number,
): Promise<Row[]> {
  const rows: Row[] = [];
  let cursor: Cursor;
  for (;;) {
    const page = await delegate.findMany({
      take: pageSize,
      ...(cursor ? { skip: 1, cursor } : {}),
      orderBy: { id: "asc" },
      select,
    });
    if (page.length === 0) break;
    rows.push(...page);
    if (page.length < pageSize) break;
    cursor = { id: page[page.length - 1].id };
  }
  return rows;
}

async function loadDocuments(
  db: AuditDb,
  pageSize: number,
): Promise<DocumentAuditRow[]> {
  return paginate(
    db.document,
    { id: true, deckJson: true, contentJson: true },
    pageSize,
  );
}

async function loadVisuals(
  db: AuditDb,
  pageSize: number,
): Promise<VisualAuditRow[]> {
  return paginate(
    db.visual,
    { id: true, documentId: true, data: true },
    pageSize,
  );
}

async function loadDocumentVersions(
  db: AuditDb,
  pageSize: number,
): Promise<DocumentVersionAuditRow[]> {
  return paginate(
    db.documentVersion,
    { id: true, documentId: true, deckJson: true, contentJson: true },
    pageSize,
  );
}

async function loadComments(
  db: AuditDb,
  pageSize: number,
): Promise<CommentAuditRow[]> {
  return paginate(
    db.comment,
    {
      id: true,
      documentId: true,
      anchorType: true,
      anchorText: true,
      anchorNodeId: true,
      slideId: true,
      elementId: true,
      anchorGeometry: true,
    },
    pageSize,
  );
}

async function loadTags(db: AuditDb, pageSize: number): Promise<TagAuditRow[]> {
  return paginate(
    db.tag,
    { id: true, ownerId: true, name: true, slug: true },
    pageSize,
  );
}

async function loadRoleRows(db: AuditDb): Promise<{
  workspaceMembers: WorkspaceRoleAuditRow[];
  inviteLinks: WorkspaceRoleAuditRow[];
  inviteLinkUses: WorkspaceRoleAuditRow[];
}> {
  const [workspaceMembers, inviteLinks, inviteLinkUses] = await Promise.all([
    db.workspaceMember.findMany({
      select: { id: true, role: true },
      orderBy: { id: "asc" },
    }),
    db.inviteLink.findMany({
      select: { id: true, role: true },
      orderBy: { id: "asc" },
    }),
    db.inviteLinkUse.findMany({
      select: { id: true, role: true },
      orderBy: { id: "asc" },
    }),
  ]);
  return { workspaceMembers, inviteLinks, inviteLinkUses };
}

async function loadUsers(db: AuditDb): Promise<UserPlanAuditRow[]> {
  return db.user.findMany({
    select: { id: true, plan: true },
    orderBy: { id: "asc" },
  });
}

async function loadSubscriptions(db: AuditDb): Promise<SubscriptionAuditRow[]> {
  return db.subscription.findMany({
    select: { id: true, plan: true, status: true },
    orderBy: { id: "asc" },
  });
}

async function loadUsageLedgerEntries(
  db: AuditDb,
): Promise<UsageLedgerAuditRow[]> {
  return db.usageLedgerEntry.findMany({
    select: { id: true, status: true },
    orderBy: { id: "asc" },
  });
}

async function loadAssets(
  db: AuditDb,
  pageSize: number,
): Promise<AssetAuditRow[]> {
  return paginate(
    db.asset,
    {
      id: true,
      documentId: true,
      workspaceId: true,
      brandId: true,
      deletedAt: true,
    },
    pageSize,
  );
}

export interface AuditMainOptions {
  /** Defaults to `process.argv.slice(2)`. */
  argv?: string[];
  /** Defaults to the real Prisma client. Never mutated by any loader. */
  db?: AuditDb;
  /** Defaults to the real {@link resolveProvider}. */
  resolveProviderFn?: () => "postgres" | "sqlite";
  /** Page size for the seven cursor-paginated loaders. Defaults to 500. */
  pageSize?: number;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
}

/**
 * Runs the persisted-schema audit end to end: loads every row via the
 * injected (or real) `db`, audits it through the pure `auditRows` core,
 * prints the plain-text or `--json` report, sets `process.exitCode = 1` when
 * `--ci`/`--strict` is passed and violations were found, and always
 * disconnects `db` in a `finally` — even when a loader throws.
 */
export async function runAuditMain(
  options: AuditMainOptions = {},
): Promise<void> {
  const argv = options.argv ?? process.argv.slice(2);
  const db = options.db ?? defaultDb();
  const resolveProviderFn = options.resolveProviderFn ?? resolveProvider;
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const stdout = options.stdout ?? ((message: string) => console.log(message));
  const stderr =
    options.stderr ?? ((message: string) => console.error(message));

  try {
    const args = new Set(argv);
    const ci = args.has("--ci") || args.has("--strict");
    const json = args.has("--json");

    const [
      documents,
      visuals,
      documentVersions,
      comments,
      tags,
      roles,
      users,
      subscriptions,
      usageLedgerEntries,
      assets,
    ] = await Promise.all([
      loadDocuments(db, pageSize),
      loadVisuals(db, pageSize),
      loadDocumentVersions(db, pageSize),
      loadComments(db, pageSize),
      loadTags(db, pageSize),
      loadRoleRows(db),
      loadUsers(db),
      loadSubscriptions(db),
      loadUsageLedgerEntries(db),
      loadAssets(db, pageSize),
    ]);

    const report = auditRows({
      documents,
      visuals,
      documentVersions,
      comments,
      tags,
      workspaceMembers: roles.workspaceMembers,
      inviteLinks: roles.inviteLinks,
      inviteLinkUses: roles.inviteLinkUses,
      users,
      subscriptions,
      usageLedgerEntries,
      assets,
    });

    if (json) {
      stdout(
        JSON.stringify({ provider: resolveProviderFn(), ...report }, null, 2),
      );
    } else {
      stdout(`Persisted schema audit (provider: ${resolveProviderFn()})`);
      for (const line of formatAuditReport(report)) {
        stdout(line);
      }
    }

    if (ci && report.summary.violations > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    stderr(
      `Schema audit failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  // `.catch(...)` (not top-level `await`) so this module stays importable
  // from `audit-persisted-schema.test.ts`: `tsx` transforms a `.ts` file
  // required from a test into CommonJS output, and esbuild's CJS output
  // format rejects literal top-level `await` syntax outright — mirrors the
  // established `runXMain().catch(...)` guard in
  // `scripts/account-erasure-dry-run.mjs`. `runAuditMain` already catches
  // every error from the try block internally (setting `exitCode`/`stderr`
  // itself); this `.catch` only guards the rare case where `finally`'s
  // `db.$disconnect()` itself throws, so that failure still surfaces with a
  // clear exit code instead of an unhandled rejection.
  runAuditMain().catch((error) => {
    console.error(
      `Schema audit failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
