import {
  logAssetOrphanEvent,
  logAssetOrphanFailure,
} from "@/lib/diagnostics/domain-events";

export type AssetOrphanDomain = "slide" | "brand";

export interface AssetOrphanStorage {
  delete(storageKey: string): Promise<void>;
}

export function selectOrphanAssetIds(
  liveRefs: ReadonlySet<string>,
  assets: readonly { id: string }[],
): string[] {
  return assets
    .filter((asset) => !liveRefs.has(asset.id))
    .map((asset) => asset.id);
}

export async function markOrphanedAssetIds(opts: {
  domain: AssetOrphanDomain;
  message: string;
  logContext: Record<string, unknown>;
  liveRefs: ReadonlySet<string>;
  liveAssets: readonly { id: string }[];
  now: Date;
  updateMany(args: {
    where: { id: { in: string[] } };
    data: { deletedAt: Date };
  }): Promise<{ count: number }>;
}): Promise<number> {
  const orphanIds = selectOrphanAssetIds(opts.liveRefs, opts.liveAssets);
  if (orphanIds.length === 0) return 0;

  const result = await opts.updateMany({
    where: { id: { in: orphanIds } },
    data: { deletedAt: opts.now },
  });

  logAssetOrphanEvent(opts.domain, "mark", opts.message, {
    ...opts.logContext,
    markedCount: result.count,
  });

  return result.count;
}

export async function purgeExpiredAssetRows(opts: {
  domain: AssetOrphanDomain;
  message: string;
  logContext: Record<string, unknown>;
  expiredAssets: readonly { id: string; storageKey?: string }[];
  storage: AssetOrphanStorage;
  deleteMany(args: {
    where: { id: { in: string[] } };
  }): Promise<{ count: number }>;
}): Promise<number> {
  const expired = opts.expiredAssets.filter(
    (asset): asset is { id: string; storageKey: string } =>
      typeof asset.storageKey === "string",
  );
  if (expired.length === 0) return 0;

  const purgedIds: string[] = [];
  for (const asset of expired) {
    try {
      await opts.storage.delete(asset.storageKey);
      purgedIds.push(asset.id);
    } catch (err) {
      logAssetOrphanFailure(opts.domain, "storage_delete", err, {
        assetId: asset.id,
      });
    }
  }
  if (purgedIds.length === 0) return 0;

  const result = await opts.deleteMany({
    where: { id: { in: purgedIds } },
  });

  logAssetOrphanEvent(opts.domain, "purge", opts.message, {
    ...opts.logContext,
    purgedCount: result.count,
  });

  return result.count;
}
