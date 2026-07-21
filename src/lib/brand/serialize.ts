/**
 * Brand row → client `BrandStyle` serialization (Epic #496).
 *
 * Brand media is persisted as asset references (`logoAssetId` / `fontAssetId`),
 * not raw data URLs. Display URLs are derived here from the referenced asset's
 * `storageKey` via the brand storage adapter.
 *
 * Shared by `listBrands` / `createBrand` / `updateBrand` (server actions) and
 * the `GET /api/brand` route so every read produces identical, asset-backed
 * `BrandStyle` objects.
 */

import { prisma } from "@/lib/prisma";
import { getBrandStorageAdapter } from "@/lib/brand/asset-storage";
import { parsePalette } from "@/lib/brand/schema";
import type { BrandStyle } from "@/lib/brand/schema";

/** The Prisma `select` shape required to serialize a brand. */
export const BRAND_SELECT = {
  id: true,
  name: true,
  ownerId: true,
  palette: true,
  background: true,
  nodeFill: true,
  nodeStroke: true,
  nodeText: true,
  edgeColor: true,
  fontFamily: true,
  logoAssetId: true,
  fontAssetId: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** The brand row shape produced by {@link BRAND_SELECT}. */
export interface BrandRow {
  id: string;
  name: string;
  ownerId: string;
  palette: unknown;
  background: string | null;
  nodeFill: string | null;
  nodeStroke: string | null;
  nodeText: string | null;
  edgeColor: string | null;
  fontFamily: string | null;
  logoAssetId: string | null;
  fontAssetId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Serializes brand rows to `BrandStyle`, resolving asset ids to protected
 * display URLs in a single batched asset lookup (no N+1).
 */
export async function serializeBrands(
  rows: readonly BrandRow[],
): Promise<BrandStyle[]> {
  const assetIds = new Set<string>();
  for (const row of rows) {
    if (row.logoAssetId) assetIds.add(row.logoAssetId);
    if (row.fontAssetId) assetIds.add(row.fontAssetId);
  }

  const urlByAssetId = new Map<string, string>();
  if (assetIds.size > 0) {
    const assets = await prisma.asset.findMany({
      where: { id: { in: [...assetIds] }, deletedAt: null },
      select: { id: true, storageKey: true },
    });
    const adapter = getBrandStorageAdapter();
    for (const asset of assets) {
      urlByAssetId.set(asset.id, adapter.urlFor(asset.storageKey));
    }
  }

  return rows.map((row) => toBrandStyle(row, urlByAssetId));
}

/** Serializes a single brand row given a pre-resolved asset-url map. */
export function toBrandStyle(
  row: BrandRow,
  urlByAssetId: Map<string, string>,
): BrandStyle {
  const logoAssetUrl = row.logoAssetId
    ? (urlByAssetId.get(row.logoAssetId) ?? null)
    : null;
  const fontAssetUrl = row.fontAssetId
    ? (urlByAssetId.get(row.fontAssetId) ?? null)
    : null;

  return {
    id: row.id,
    name: row.name,
    ownerId: row.ownerId,
    palette: parsePalette(row.palette),
    background: row.background,
    nodeFill: row.nodeFill,
    nodeStroke: row.nodeStroke,
    nodeText: row.nodeText,
    edgeColor: row.edgeColor,
    fontFamily: row.fontFamily,
    logoAssetId: row.logoAssetId,
    fontAssetId: row.fontAssetId,
    fontAssetUrl,
    logoAssetUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
