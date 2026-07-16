import { prisma, type PrismaTransactionClient } from "@/lib/prisma";

import { reconcileBrandAssets } from "./asset-orphan";
import { BRAND_SELECT, type BrandRow } from "./serialize";
import type { BrandInput } from "./schema";

export class BrandAssetValidationError extends Error {
  constructor(message = "Brand asset not found or unauthorized.") {
    super(message);
    this.name = "BrandAssetValidationError";
  }
}

function referencedAssetIds(data: {
  logoAssetId?: string | null;
  fontAssetId?: string | null;
}): string[] {
  return [data.logoAssetId, data.fontAssetId].filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
}

export function brandAssetBelongsToOwner(
  storageKey: string,
  ownerId: string,
): boolean {
  return storageKey.startsWith(`${ownerId}/`);
}

async function assertAssignableBrandAssets(
  tx: PrismaTransactionClient,
  ownerId: string,
  assetIds: string[],
): Promise<void> {
  if (assetIds.length === 0) return;

  const assets = await tx.asset.findMany({
    where: {
      id: { in: assetIds },
      deletedAt: null,
      documentId: null,
      workspaceId: null,
    },
    select: { id: true, storageKey: true },
  });
  const owned = new Set(
    assets
      .filter((asset) => brandAssetBelongsToOwner(asset.storageKey, ownerId))
      .map((asset) => asset.id),
  );

  if (assetIds.some((id) => !owned.has(id))) {
    throw new BrandAssetValidationError();
  }
}

async function linkAndReconcileBrandAssets(
  tx: PrismaTransactionClient,
  ownerId: string,
  brandId: string,
  assetIds: string[],
): Promise<void> {
  await assertAssignableBrandAssets(tx, ownerId, assetIds);

  if (assetIds.length > 0) {
    await tx.asset.updateMany({
      where: { id: { in: assetIds }, deletedAt: null },
      data: { brandId },
    });
  }

  await reconcileBrandAssets(brandId, tx, new Date());
}

export async function createBrandForOwner(
  ownerId: string,
  data: BrandInput,
): Promise<BrandRow> {
  return prisma.$transaction(async (tx) => {
    const assetIds = referencedAssetIds(data);
    await assertAssignableBrandAssets(tx, ownerId, assetIds);

    const row = await tx.brand.create({
      data: {
        name: data.name,
        ownerId,
        palette: data.palette ?? undefined,
        background: data.background ?? undefined,
        nodeFill: data.nodeFill ?? undefined,
        nodeStroke: data.nodeStroke ?? undefined,
        nodeText: data.nodeText ?? undefined,
        edgeColor: data.edgeColor ?? undefined,
        fontFamily: data.fontFamily ?? undefined,
        logoAssetId: data.logoAssetId ?? undefined,
        fontAssetId: data.fontAssetId ?? undefined,
      },
      select: BRAND_SELECT,
    });

    await linkAndReconcileBrandAssets(tx, ownerId, row.id, assetIds);
    return row;
  });
}

export async function updateBrandForOwner(
  id: string,
  ownerId: string,
  data: BrandInput,
): Promise<BrandRow | null> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.brand.findUnique({
      where: { id },
      select: { ownerId: true },
    });
    if (!existing) return null;
    if (existing.ownerId !== ownerId) throw new Error("Not authorized.");

    const assetIds = referencedAssetIds(data);
    await assertAssignableBrandAssets(tx, ownerId, assetIds);

    const row = await tx.brand.update({
      where: { id },
      data: {
        name: data.name,
        palette: data.palette ?? undefined,
        background: data.background,
        nodeFill: data.nodeFill,
        nodeStroke: data.nodeStroke,
        nodeText: data.nodeText,
        edgeColor: data.edgeColor,
        fontFamily: data.fontFamily,
        logoAssetId: data.logoAssetId ?? null,
        fontAssetId: data.fontAssetId ?? null,
      },
      select: BRAND_SELECT,
    });

    await linkAndReconcileBrandAssets(tx, ownerId, row.id, assetIds);
    return row;
  });
}

export async function deleteBrandForOwner(
  id: string,
  ownerId: string,
): Promise<"deleted" | "missing" | "unauthorized"> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.brand.findUnique({
      where: { id },
      select: { ownerId: true },
    });
    if (!existing) return "missing";
    if (existing.ownerId !== ownerId) return "unauthorized";

    const brandAssets = await tx.asset.findMany({
      where: { brandId: id, deletedAt: null },
      select: { id: true },
    });

    await tx.brand.delete({ where: { id } });

    if (brandAssets.length > 0) {
      await tx.asset.updateMany({
        where: { id: { in: brandAssets.map((a) => a.id) }, deletedAt: null },
        data: { deletedAt: new Date() },
      });
    }

    return "deleted";
  });
}
