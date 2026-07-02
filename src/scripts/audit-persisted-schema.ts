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
 */

import { prisma } from "@/lib/prisma";
import { resolveProvider } from "@/lib/db-provider";
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

const PAGE_SIZE = 500;

async function loadDocuments(): Promise<DocumentAuditRow[]> {
  const rows: DocumentAuditRow[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.document.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: { id: true, deckJson: true, contentJson: true },
    });
    if (page.length === 0) break;
    for (const row of page) {
      rows.push({
        id: row.id,
        deckJson: row.deckJson,
        contentJson: row.contentJson,
      });
    }
    if (page.length < PAGE_SIZE) break;
    cursor = page[page.length - 1].id;
  }
  return rows;
}

async function loadVisuals(): Promise<VisualAuditRow[]> {
  const rows: VisualAuditRow[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.visual.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: { id: true, documentId: true, data: true },
    });
    if (page.length === 0) break;
    for (const row of page) {
      rows.push({ id: row.id, documentId: row.documentId, data: row.data });
    }
    if (page.length < PAGE_SIZE) break;
    cursor = page[page.length - 1].id;
  }
  return rows;
}

async function loadDocumentVersions(): Promise<DocumentVersionAuditRow[]> {
  const rows: DocumentVersionAuditRow[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.documentVersion.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        documentId: true,
        deckJson: true,
        contentJson: true,
      },
    });
    if (page.length === 0) break;
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    cursor = page[page.length - 1].id;
  }
  return rows;
}

async function loadComments(): Promise<CommentAuditRow[]> {
  const rows: CommentAuditRow[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.comment.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        documentId: true,
        anchorType: true,
        anchorText: true,
        anchorNodeId: true,
        slideId: true,
        elementId: true,
        anchorGeometry: true,
      },
    });
    if (page.length === 0) break;
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    cursor = page[page.length - 1].id;
  }
  return rows;
}

async function loadTags(): Promise<TagAuditRow[]> {
  const rows: TagAuditRow[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.tag.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: { id: true, ownerId: true, name: true, slug: true },
    });
    if (page.length === 0) break;
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    cursor = page[page.length - 1].id;
  }
  return rows;
}

async function loadRoleRows(): Promise<{
  workspaceMembers: WorkspaceRoleAuditRow[];
  inviteLinks: WorkspaceRoleAuditRow[];
  inviteLinkUses: WorkspaceRoleAuditRow[];
}> {
  const [workspaceMembers, inviteLinks, inviteLinkUses] = await Promise.all([
    prisma.workspaceMember.findMany({
      select: { id: true, role: true },
      orderBy: { id: "asc" },
    }),
    prisma.inviteLink.findMany({
      select: { id: true, role: true },
      orderBy: { id: "asc" },
    }),
    prisma.inviteLinkUse.findMany({
      select: { id: true, role: true },
      orderBy: { id: "asc" },
    }),
  ]);
  return { workspaceMembers, inviteLinks, inviteLinkUses };
}

async function loadUsers(): Promise<UserPlanAuditRow[]> {
  return prisma.user.findMany({
    select: { id: true, plan: true },
    orderBy: { id: "asc" },
  });
}

async function loadSubscriptions(): Promise<SubscriptionAuditRow[]> {
  return prisma.subscription.findMany({
    select: { id: true, plan: true, status: true },
    orderBy: { id: "asc" },
  });
}

async function loadUsageLedgerEntries(): Promise<UsageLedgerAuditRow[]> {
  return prisma.usageLedgerEntry.findMany({
    select: { id: true, status: true },
    orderBy: { id: "asc" },
  });
}

async function loadAssets(): Promise<AssetAuditRow[]> {
  const rows: AssetAuditRow[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.asset.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        documentId: true,
        workspaceId: true,
        brandId: true,
        deletedAt: true,
      },
    });
    if (page.length === 0) break;
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    cursor = page[page.length - 1].id;
  }
  return rows;
}
async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
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
    loadDocuments(),
    loadVisuals(),
    loadDocumentVersions(),
    loadComments(),
    loadTags(),
    loadRoleRows(),
    loadUsers(),
    loadSubscriptions(),
    loadUsageLedgerEntries(),
    loadAssets(),
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
    console.log(
      JSON.stringify({ provider: resolveProvider(), ...report }, null, 2),
    );
  } else {
    console.log(`Persisted schema audit (provider: ${resolveProvider()})`);
    for (const line of formatAuditReport(report)) {
      console.log(line);
    }
  }

  if (ci && report.summary.violations > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(
      `Schema audit failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
