/**
 * Orphan detection and cleanup for brand assets (Epic #496, issue #516).
 *
 * Mirrors the slide-asset lifecycle (`@/lib/slides/asset-orphan`) for brand
 * logos / fonts:
 *
 *  - An asset is "live" when an ACTIVE `Brand` references it through
 *    `logoAssetId` or `fontAssetId`.
 *  - When a brand replaces its logo/font, the previously-referenced asset is no
 *    longer live → it is soft-deleted (`deletedAt` set).
 *  - When a brand is deleted, `Asset.brandId` is nulled by the `onDelete:
 *    SetNull` relation; the delete path soft-deletes those assets so they do
 *    not linger as permanent orphans.
 *  - Soft-deleted brand assets are physically purged only after
 *    {@link BRAND_ASSET_RETENTION_MS} has elapsed.
 *
 * Brand-origin assets are identified by the absence of a document/workspace
 * scope (`documentId == null && workspaceId == null`): unlike slide assets they
 * are never document-scoped, and their bytes live under `storage/brand-assets/`.
 *
 * Pure helpers ({@link selectBrandOrphanIds}) have no I/O; the DB/storage
 * interfaces are injectable so the control flow is fully unit-testable without a
 * live database. No React / Next / browser APIs.
 */

import {
  markOrphanedAssetIds,
  purgeExpiredAssetRows,
  selectOrphanAssetIds,
  type AssetOrphanStorage,
} from "@/lib/assets/orphan-lifecycle";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Minimum time (ms) an orphaned brand asset must remain soft-deleted before it
 * is eligible for physical purge. Matches the slide-asset window (7 days).
 */
export const BRAND_ASSET_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Pure selection
// ---------------------------------------------------------------------------

/**
 * Given the set of asset ids still referenced by an active brand and the brand's
 * currently-live (non-deleted) assets, returns the ids that are orphaned (live
 * in storage but no longer referenced). Pure — no I/O.
 */
export function selectBrandOrphanIds(
  liveRefs: ReadonlySet<string>,
  brandAssets: readonly { id: string }[],
): string[] {
  return selectOrphanAssetIds(liveRefs, brandAssets);
}

// ---------------------------------------------------------------------------
// DB / storage interfaces (injectable for tests)
// ---------------------------------------------------------------------------

export interface BrandOrphanDb {
  brand: {
    findUnique(args: {
      where: { id: string };
      select: { logoAssetId: true; fontAssetId: true };
    }): Promise<{
      logoAssetId: string | null;
      fontAssetId: string | null;
    } | null>;
    findMany(args: {
      where: {
        OR: [
          { logoAssetId: { in: string[] } },
          { fontAssetId: { in: string[] } },
        ];
      };
      select: { logoAssetId: true; fontAssetId: true };
    }): Promise<
      {
        logoAssetId: string | null;
        fontAssetId: string | null;
      }[]
    >;
  };
  asset: {
    findMany(args: {
      where:
        | { brandId: string; deletedAt: null }
        | {
            documentId: null;
            workspaceId: null;
            deletedAt: { not: null; lt: Date };
          };
      select: { id?: true; storageKey?: true };
    }): Promise<{ id: string; storageKey?: string }[]>;
    updateMany(args: {
      where: { id: { in: string[] } };
      data: { deletedAt: Date };
    }): Promise<{ count: number }>;
    deleteMany(args: {
      where: { id: { in: string[] } };
    }): Promise<{ count: number }>;
  };
}

export type BrandOrphanStorage = AssetOrphanStorage;

async function referencedAssetIdsAcrossBrands(
  db: BrandOrphanDb,
  assetIds: readonly string[],
): Promise<Set<string>> {
  const ids = [...new Set(assetIds)].filter(Boolean);
  const refs = new Set<string>();
  if (ids.length === 0) return refs;

  const brands = await db.brand.findMany({
    where: {
      OR: [{ logoAssetId: { in: ids } }, { fontAssetId: { in: ids } }],
    },
    select: { logoAssetId: true, fontAssetId: true },
  });
  for (const brand of brands) {
    if (brand.logoAssetId) refs.add(brand.logoAssetId);
    if (brand.fontAssetId) refs.add(brand.fontAssetId);
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Reconcile a single brand's assets
// ---------------------------------------------------------------------------

/**
 * Soft-deletes the assets scoped to `brandId` that the brand no longer
 * references (`logoAssetId` / `fontAssetId`). Idempotent: already soft-deleted
 * assets are excluded from the scan. Returns the number of assets orphaned.
 */
export async function reconcileBrandAssets(
  brandId: string,
  db: BrandOrphanDb,
  now: Date = new Date(),
): Promise<number> {
  const brand = await db.brand.findUnique({
    where: { id: brandId },
    select: { logoAssetId: true, fontAssetId: true },
  });
  if (!brand) return 0;

  const liveAssets = await db.asset.findMany({
    where: { brandId, deletedAt: null },
    select: { id: true },
  });
  const liveRefs = await referencedAssetIdsAcrossBrands(
    db,
    liveAssets.map((asset) => asset.id),
  );
  if (brand.logoAssetId) liveRefs.add(brand.logoAssetId);
  if (brand.fontAssetId) liveRefs.add(brand.fontAssetId);

  return markOrphanedAssetIds({
    domain: "brand",
    message: "brand assets marked as orphaned",
    logContext: { brandId },
    liveRefs,
    liveAssets,
    now,
    updateMany: (args) => db.asset.updateMany(args),
  });
}

// ---------------------------------------------------------------------------
// Purge expired brand assets
// ---------------------------------------------------------------------------

/**
 * Physically deletes (from storage + DB) brand-origin assets that are
 * soft-deleted and whose `deletedAt` is older than {@link
 * BRAND_ASSET_RETENTION_MS}. Brand-origin assets are those with neither a
 * document nor a workspace scope. Idempotent and storage-failure tolerant: a
 * key whose storage delete fails is left in the DB for a later retry.
 */
export async function purgeExpiredBrandAssets(
  db: BrandOrphanDb,
  storage: BrandOrphanStorage,
  retentionMs: number = BRAND_ASSET_RETENTION_MS,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionMs);

  const expiredAssets = await db.asset.findMany({
    where: {
      documentId: null,
      workspaceId: null,
      deletedAt: { not: null, lt: cutoff },
    },
    select: { id: true, storageKey: true },
  });
  const liveRefs = await referencedAssetIdsAcrossBrands(
    db,
    expiredAssets.map((asset) => asset.id),
  );
  const purgeableAssets = expiredAssets.filter(
    (asset) => !liveRefs.has(asset.id),
  );

  return purgeExpiredAssetRows({
    domain: "brand",
    message: "brand assets physically purged",
    logContext: {},
    expiredAssets: purgeableAssets,
    storage,
    deleteMany: (args) => db.asset.deleteMany(args),
  });
}
