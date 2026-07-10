import type { Prisma } from "@/generated/prisma/client";
import { acquirePurgeLock, INVITE_LINK_RETENTION_MS } from "@/lib/maintenance";
import { prisma } from "@/lib/prisma";
import { getTrashStatus, SOFT_DELETE_RETENTION_MS } from "@/lib/trash";

type TrashDb = Pick<typeof prisma, "document">;
type MaintenanceDb = Pick<typeof prisma, "document" | "$executeRaw">;

export type TrashDocument = {
  id: string;
  title: string;
  deletedAtMs: number;
  remainingMs: number;
};

/**
 * Returns the current user's soft-deleted documents still within the recovery
 * window, ordered by most recently deleted first.
 *
 * Only documents deleted within SOFT_DELETE_RETENTION_MS are returned.
 * Documents past the window are excluded — they are purged opportunistically
 * by the maintenance sweep on the next dashboard load.
 */
export async function listTrashDocumentsForUser(
  userId: string,
  db: TrashDb = prisma,
  now: Date = new Date(),
): Promise<TrashDocument[]> {
  const cutoff = new Date(now.getTime() - SOFT_DELETE_RETENTION_MS);

  const rows = await db.document.findMany({
    where: {
      ownerId: userId,
      deletedAt: { not: null, gt: cutoff },
    },
    orderBy: { deletedAt: "desc" },
    select: { id: true, title: true, deletedAt: true },
  });

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    deletedAtMs: row.deletedAt!.getTime(),
    remainingMs: getTrashStatus(row.deletedAt, now)!.remainingMs,
  }));
}

export async function softDeleteDocument(
  id: string,
  db: TrashDb = prisma,
): Promise<void> {
  await db.document.updateMany({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

export async function restoreDocumentFromTrash(
  id: string,
  db: TrashDb = prisma,
): Promise<void> {
  await db.document.updateMany({
    where: { id, deletedAt: { not: null } },
    data: { deletedAt: null },
  });
}

export async function permanentDeleteDocument(
  id: string,
  db: TrashDb = prisma,
): Promise<void> {
  await db.document.deleteMany({
    where: { id, deletedAt: { not: null } },
  });
}

export type MaintenancePolicy = "dashboard-load";

export type MaintenanceResult = {
  policy: MaintenancePolicy;
  skipped: boolean;
};

export async function runDocumentMaintenance(
  policy: MaintenancePolicy,
  db: MaintenanceDb = prisma,
  now: Date = new Date(),
): Promise<MaintenanceResult> {
  if (policy === "dashboard-load" && !acquirePurgeLock(now.getTime())) {
    return { policy, skipped: true };
  }

  const docCutoff = new Date(now.getTime() - SOFT_DELETE_RETENTION_MS);
  const inviteCutoff = new Date(now.getTime() - INVITE_LINK_RETENTION_MS);

  await Promise.all([
    db.document.deleteMany({
      where: { deletedAt: { lt: docCutoff } },
    }),

    db.$executeRaw`
      DELETE FROM "InviteLink"
      WHERE "createdAt" < ${inviteCutoff}
        AND (
          "isRevoked" = ${true}
          OR ("expiresAt" IS NOT NULL AND "expiresAt" < ${inviteCutoff})
          OR ("maxUses" IS NOT NULL AND "useCount" >= "maxUses")
        )
    ` as Prisma.PrismaPromise<unknown>,
  ]);

  return { policy, skipped: false };
}

export async function runDashboardLoadMaintenance(): Promise<MaintenanceResult> {
  return runDocumentMaintenance("dashboard-load");
}
