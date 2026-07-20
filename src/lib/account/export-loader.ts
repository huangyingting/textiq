import "server-only";

import { buildAccountExport, type AccountExport } from "@/lib/account/export";
import { prisma } from "@/lib/prisma";

export async function loadAccountExport(
  userId: string,
  now = new Date(),
): Promise<AccountExport | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      emailVerified: true,
      plan: true,
      createdAt: true,
    },
  });
  if (!user) {
    return null;
  }

  const [
    documents,
    workspacesOwned,
    workspaceMemberships,
    comments,
    commentReads,
    tags,
    brands,
    brandKitDrafts,
    themePackageSnapshots,
    assets,
    subscription,
    inviteLinkUses,
    usageLedger,
  ] = await Promise.all([
    prisma.document.findMany({
      where: { ownerId: userId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        title: true,
        contentJson: true,
        deckJson: true,
        workspaceId: true,
        isShared: true,
        shareExpiresAt: true,
        shareEmbedEnabled: true,
        sharePresentEnabled: true,
        shareMetadataMode: true,
        shareDiscoverable: true,
        createdAt: true,
        updatedAt: true,
        visuals: {
          orderBy: { orderIndex: "asc" },
          select: {
            id: true,
            type: true,
            title: true,
            anchorBlockId: true,
            orderIndex: true,
            data: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        versions: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            label: true,
            createdAt: true,
          },
        },
      },
    }),
    prisma.workspace.findMany({
      where: { ownerId: userId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, createdAt: true, updatedAt: true },
    }),
    prisma.workspaceMember.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { id: true, workspaceId: true, role: true, createdAt: true },
    }),
    prisma.comment.findMany({
      where: { authorId: userId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        documentId: true,
        body: true,
        resolved: true,
        parentId: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.commentRead.findMany({
      where: { userId },
      orderBy: { lastReadAt: "asc" },
      select: { id: true, documentId: true, lastReadAt: true },
    }),
    prisma.tag.findMany({
      where: { ownerId: userId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        slug: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.brand.findMany({
      where: { ownerId: userId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        logoAssetId: true,
        fontAssetId: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.brandKitDraft.findMany({
      where: { ownerId: userId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        slug: true,
        name: true,
        ownerId: true,
        workspaceId: true,
        scope: true,
        scopeKey: true,
        sourcePresetId: true,
        version: true,
        revisionId: true,
        revisionNumber: true,
        draftJson: true,
        latestPackageId: true,
        latestPackageVersion: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.themePackageSnapshot.findMany({
      where: { ownerId: userId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        packageId: true,
        packageVersion: true,
        draftId: true,
        ownerId: true,
        workspaceId: true,
        publishedById: true,
        packageJson: true,
        createdAt: true,
      },
    }),
    prisma.asset.findMany({
      where: {
        OR: [
          { document: { ownerId: userId } },
          { workspace: { ownerId: userId } },
          { brand: { ownerId: userId } },
          {
            documentId: null,
            workspaceId: null,
            brandId: null,
            storageKey: { startsWith: `${userId}/` },
          },
        ],
        deletedAt: null,
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        mimeType: true,
        byteSize: true,
        widthPx: true,
        heightPx: true,
        checksum: true,
        originalName: true,
        createdAt: true,
      },
    }),
    prisma.subscription.findUnique({
      where: { userId },
      select: {
        id: true,
        plan: true,
        status: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.inviteLinkUse.findMany({
      where: { userId },
      orderBy: { usedAt: "asc" },
      select: {
        id: true,
        inviteLinkId: true,
        role: true,
        usedAt: true,
        inviteLink: { select: { workspaceId: true } },
      },
    }),
    prisma.usageLedgerEntry.findMany({
      where: { userId },
      orderBy: { reservedAt: "asc" },
      select: {
        id: true,
        userId: true,
        operation: true,
        creditCost: true,
        status: true,
        reservationVersion: true,
        reservedAt: true,
        capturedAt: true,
        refundedAt: true,
      },
    }),
  ]);

  return buildAccountExport({
    user,
    documents: documents.map((doc) => ({
      ...doc,
      sharePolicy: {
        expiresAt: doc.shareExpiresAt ?? null,
        embedEnabled: doc.shareEmbedEnabled ?? true,
        presentEnabled: doc.sharePresentEnabled ?? true,
        metadataMode: doc.shareMetadataMode ?? "generic",
        discoverable: doc.shareDiscoverable ?? false,
      },
    })),
    workspacesOwned,
    workspaceMemberships,
    comments,
    commentReads,
    tags,
    brands,
    brandKitDrafts,
    themePackageSnapshots,
    assets,
    subscription: subscription ?? null,
    inviteLinkUses: inviteLinkUses.map((use) => ({
      id: use.id,
      inviteLinkId: use.inviteLinkId,
      workspaceId: use.inviteLink?.workspaceId ?? null,
      role: use.role,
      usedAt: use.usedAt,
    })),
    usageLedger,
    now,
  });
}
