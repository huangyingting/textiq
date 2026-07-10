/**
 * Storage adapter + key derivation for brand assets (Epic #496).
 *
 * Brand logos and uploaded custom fonts are persisted as protected `Asset`
 * rows whose bytes live in a NON-public directory (`storage/brand-assets/`)
 * and are served only through the authorised `/api/brand-assets/…` route.
 * This mirrors the slide-asset design and reuses the neutral
 * {@link LocalAssetStorageAdapter}; only the storage root, the URL prefix,
 * and the accepted MIME→extension map differ.
 *
 * Assets are partitioned by the OWNER (`userId`) rather than by brand id, so an
 * uploaded logo/font is servable immediately — before a brand row exists — and
 * its display URL stays stable across the create/edit save that links it to a
 * brand. Owner-scoping is also the access boundary: only the partition owner
 * may fetch the bytes (see `@/lib/brand/asset-access`).
 */

import path from "node:path";

import {
  deriveAssetStorageKey,
  LocalAssetStorageAdapter,
  type AssetStorageAdapter,
} from "@/lib/assets/storage";
import { BRAND_MIME_TO_EXT } from "@/lib/brand/asset-policy";

// ---------------------------------------------------------------------------
// MIME → extension
// ---------------------------------------------------------------------------

/**
 * Derives the canonical storage key for a brand asset:
 * `${ownerId}/${checksum}.${ext}`.
 *
 * Partitioning by `ownerId` makes the key (and the resulting `/api/brand-assets`
 * URL) stable from upload time through the save that links the asset to a brand.
 * The extension is resolved from `mimeType` via {@link BRAND_MIME_TO_EXT}.
 *
 * @param ownerId  - Owning user id (becomes the first path segment).
 * @param checksum - SHA-256 hex digest of the file bytes.
 * @param mimeType - Validated MIME type (drives the file extension).
 */
/* node:coverage ignore next 11 -- Storage-key behavior is asserted; tsx maps the signature/call span as uncovered. */
export function deriveBrandStorageKey(
  /* node:coverage ignore next 3 -- Parameters are a source-map signature artifact; key derivation is asserted. */
  ownerId: string,
  checksum: string,
  mimeType: string,
): string {
  return deriveAssetStorageKey(ownerId, checksum, mimeType, BRAND_MIME_TO_EXT);
}

// ---------------------------------------------------------------------------
// Default adapter singleton
// ---------------------------------------------------------------------------

let _brandAdapter: AssetStorageAdapter | undefined;

/**
 * Returns the process-wide brand-asset storage adapter, creating a
 * {@link LocalAssetStorageAdapter} targeting `storage/brand-assets/` (a
 * non-public directory) on first call. Bytes are served through the authorised
 * `/api/brand-assets/…` route rather than the static file server.
 */
export function getBrandStorageAdapter(): AssetStorageAdapter {
  if (!_brandAdapter) {
    _brandAdapter = new LocalAssetStorageAdapter(
      path.join(process.cwd(), "storage", "brand-assets"),
      "/api/brand-assets",
    );
  }
  return _brandAdapter;
}

/** Replaces the brand adapter — for tests and alternative deployments. */
export function setBrandStorageAdapter(adapter: AssetStorageAdapter): void {
  _brandAdapter = adapter;
}

/** Resets the singleton so the next call re-initialises with defaults. */
export function resetBrandStorageAdapter(): void {
  _brandAdapter = undefined;
}
