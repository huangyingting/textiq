/**
 * Orphan detection and cleanup for slide assets (Epic #374, issue #396).
 *
 * Lifecycle policy:
 *  - An asset is "active" when at least one live reference exists in either:
 *      a) `Document.deckJson` — the current live deck state, or
 *      b) `DocumentVersion.deckJson` — any retained version snapshot (for
 *         restore safety).
 *  - An asset becomes "orphaned" when it is referenced by neither current
 *    deck state nor any retained version within the retention window.
 *  - Orphaned assets are soft-deleted first (`deletedAt` set) and only
 *    purged from storage after the retention window has elapsed.
 *
 * Retention policy: {@link ASSET_RETENTION_MS} — assets are not deleted
 * immediately to guard against version restores that re-reference them.
 *
 * All operations are idempotent and safe to run repeatedly:
 *  - {@link collectDeckAssetRefs} is a pure extractor with no I/O.
 *  - {@link markOrphanedAssets} performs a bounded DB update.
 *  - {@link purgeExpiredAssets} only touches assets whose `deletedAt` is
 *    older than the retention window AND that are no longer referenced.
 *
 * No React / Next / browser APIs — safe to import from server actions,
 * cron jobs, and tests running under `node --test`.
 */

import {
  markOrphanedAssetIds,
  purgeExpiredAssetRows,
  /* node:coverage ignore next -- Type-only storage adapter import is erased at runtime. */
  type AssetOrphanStorage,
} from "@/lib/assets/orphan-lifecycle";
import { isPlainObject } from "@/lib/type-guards";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Minimum time (ms) an orphaned asset must remain soft-deleted before it is
 * eligible for physical purge.  7 days allows version restores and undo/redo
 * within the standard version-history window.
 */
export const ASSET_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ---------------------------------------------------------------------------
// Reference collection
// ---------------------------------------------------------------------------

/**
 * Walks a raw `deckJson` value and collects every `assetId` referenced by
 * image elements and slide backgrounds.  Returns an empty set for null/invalid
 * deck payloads (never throws).
 *
 * Recognised locations:
 *  - `deck.slides[n].backgroundAssetId`
 *  - `deck.slides[n].elements[m].assetId`  (ImageElement)
 *  - `deck.slides[n].children[*].content.assetId` (presentation image/visual nodes)
 *  - `deck.assets.visuals[*].id` and visual registry keys
 *  - `deck.chrome.logo.assetId`
 *  - `deck.theme.overrides.chrome.logo.assetId`
 *  - `deck.slides[n].props.deckChrome.logo.value.assetId`
 */
export function collectDeckAssetRefs(deckJson: unknown): Set<string> {
  const refs = new Set<string>();
  try {
    if (!isPlainObject(deckJson)) return refs;
    collectVisualRegistryAssetRefs(deckJson.assets, refs);
    collectDeckChromeLogoAssetRefs(deckJson.chrome, refs);
    if (
      isPlainObject(deckJson.theme) &&
      isPlainObject(deckJson.theme.overrides)
    ) {
      collectDeckChromeLogoAssetRefs(deckJson.theme.overrides.chrome, refs);
    }
    const slides = deckJson.slides;
    if (!Array.isArray(slides)) return refs;
    for (const slide of slides) {
      if (!isPlainObject(slide)) continue;
      if (
        typeof slide.backgroundAssetId === "string" &&
        slide.backgroundAssetId
      ) {
        refs.add(slide.backgroundAssetId);
      }
      const elements = slide.elements;
      collectAssetIdsFromNodeArray(elements, refs);
      const children = slide.children;
      collectAssetIdsFromNodeArray(children, refs);
      collectSlideDeckChromeLogoAssetRefs(slide.props, refs);
    }
  } catch {
    // Safety net — must not throw.
  }

  function collectVisualRegistryAssetRefs(
    assets: unknown,
    refs: Set<string>,
  ): void {
    if (!isPlainObject(assets) || !isPlainObject(assets.visuals)) return;
    for (const [assetId, visualRef] of Object.entries(assets.visuals)) {
      if (assetId) refs.add(assetId);
      if (isPlainObject(visualRef) && typeof visualRef.id === "string") {
        refs.add(visualRef.id);
      }
    }
  }

  function collectAssetIdsFromNodeArray(
    nodes: unknown,
    refs: Set<string>,
  ): void {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (!isPlainObject(node)) continue;
      if (typeof node.assetId === "string" && node.assetId) {
        refs.add(node.assetId);
      }
      if (isPlainObject(node.content)) {
        const assetId = node.content.assetId;
        if (typeof assetId === "string" && assetId) {
          refs.add(assetId);
        }
      }
      collectAssetIdsFromNodeArray(node.children, refs);
    }
  }

  function collectDeckChromeLogoAssetRefs(
    chromeConfig: unknown,
    refs: Set<string>,
  ): void {
    if (!isPlainObject(chromeConfig)) return;
    collectAssetId(chromeConfig.logo, refs);
  }

  function collectSlideDeckChromeLogoAssetRefs(
    slideProps: unknown,
    refs: Set<string>,
  ): void {
    if (!isPlainObject(slideProps) || !isPlainObject(slideProps.deckChrome)) {
      return;
    }
    const logoOverride = slideProps.deckChrome.logo;
    if (!isPlainObject(logoOverride) || logoOverride.mode !== "override") {
      return;
    }
    collectAssetId(logoOverride.value, refs);
  }

  function collectAssetId(
    value: unknown,
    refs: Set<string>,
    key: string = "assetId",
  ): void {
    if (!isPlainObject(value)) return;
    const assetId = value[key];
    if (typeof assetId === "string" && assetId) {
      refs.add(assetId);
    }
  }
  return refs;
}

/* node:coverage disable */
/* Orphan DB section divider is documentation-only. */
// ---------------------------------------------------------------------------
// DB interface (injectable for tests)
// ---------------------------------------------------------------------------

/* Orphan DB interface is TypeScript-only and erased at runtime. */
/**
 * Minimal DB interface used by the orphan-management functions.
 * Matches the Prisma client subset needed.
 */
export interface OrphanDb {
  asset: {
    findMany(args: {
      where:
        | { documentId: string; deletedAt: null }
        | { documentId: string; deletedAt: { not: null; lt: Date } };
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
  document: {
    findUnique(args: {
      where: { id: string };
      select: { deckJson: true };
    }): Promise<{ deckJson: unknown } | null>;
  };
  documentVersion: {
    findMany(args: {
      where: { documentId: string };
      select: { deckJson: true };
      orderBy: { createdAt: "desc" };
    }): Promise<{ deckJson: unknown }[]>;
  };
}
/* node:coverage enable */

/**
 * Storage interface for physical file deletion.
 */
export type OrphanStorage = AssetOrphanStorage;

// ---------------------------------------------------------------------------
// Mark orphaned assets
// ---------------------------------------------------------------------------

/**
 * Marks all assets for `documentId` that are no longer referenced by the
 * current deck state or any retained version snapshot.
 *
 * Returns the number of assets soft-deleted.  Idempotent: already soft-deleted
 * assets are excluded from the scan.
 */
export async function markOrphanedAssets(
  documentId: string,
  db: OrphanDb,
  now: Date = new Date(),
): Promise<number> {
  // Collect all active asset ids across current deck + all version snapshots.
  const activeRefs = new Set<string>();

  const doc = await db.document.findUnique({
    where: { id: documentId },
    select: { deckJson: true },
  });
  if (doc?.deckJson) {
    for (const id of collectDeckAssetRefs(doc.deckJson)) {
      activeRefs.add(id);
    }
  }

  const versions = await db.documentVersion.findMany({
    where: { documentId },
    select: { deckJson: true },
    orderBy: { createdAt: "desc" },
  });
  for (const version of versions) {
    if (version.deckJson) {
      for (const id of collectDeckAssetRefs(version.deckJson)) {
        activeRefs.add(id);
      }
    }
  }

  // Find all currently live (non-deleted) assets for this document.
  const liveAssets = await db.asset.findMany({
    where: { documentId, deletedAt: null },
    select: { id: true },
  });

  return markOrphanedAssetIds({
    domain: "slide",
    message: "assets marked as orphaned",
    logContext: { documentId },
    liveRefs: activeRefs,
    liveAssets,
    now,
    updateMany: (args) => db.asset.updateMany(args),
  });
}

// ---------------------------------------------------------------------------
// Purge expired assets
// ---------------------------------------------------------------------------

/**
 * Physically deletes (from storage + DB) assets that:
 *  1. Are soft-deleted (`deletedAt` is set), AND
 *  2. Were soft-deleted more than {@link ASSET_RETENTION_MS} ago.
 *
 * Returns the number of assets physically purged.  Idempotent: already-purged
 * assets are simply absent from the result.
 */
export async function purgeExpiredAssets(
  documentId: string,
  db: OrphanDb,
  storage: OrphanStorage,
  retentionMs: number = ASSET_RETENTION_MS,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionMs);

  const expiredAssets = await db.asset.findMany({
    where: { documentId, deletedAt: { not: null, lt: cutoff } },
    select: { id: true, storageKey: true },
  });

  return purgeExpiredAssetRows({
    domain: "slide",
    message: "assets physically purged",
    logContext: { documentId },
    expiredAssets,
    storage,
    deleteMany: (args) => db.asset.deleteMany(args),
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
