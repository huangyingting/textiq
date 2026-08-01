---
type: "architecture"
status: "current"
last_updated: "2026-08-01"
description: "This document describes saved brand styles, brand media assets, brand entitlement gates, and applying brands to visuals. Billing plans and credits live in billing.md."
---

# Brand Studio

This document describes saved brand styles, brand media assets, brand
entitlement gates, and applying brands to visuals. Billing plans and credits
live in [billing.md](billing.md).

## Source Files

| Area                        | Source                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Brand schema and validation | [`src/lib/brand/schema.ts`](../../src/lib/brand/schema.ts)                                                                     |
| Saved-brand client loader   | [`src/lib/brand/brand-list-client.ts`](../../src/lib/brand/brand-list-client.ts)                                               |
| Brand persistence service   | [`src/lib/brand/persistence-service.ts`](../../src/lib/brand/persistence-service.ts)                                           |
| Brand serialization         | [`src/lib/brand/serialize.ts`](../../src/lib/brand/serialize.ts)                                                               |
| Brand transforms            | [`src/lib/brand/transforms.ts`](../../src/lib/brand/transforms.ts)                                                             |
| Upload validation           | [`src/lib/brand/upload.ts`](../../src/lib/brand/upload.ts)                                                                     |
| Asset policy                | [`src/lib/brand/asset-policy.ts`](../../src/lib/brand/asset-policy.ts)                                                         |
| Asset storage               | [`src/lib/brand/asset-storage.ts`](../../src/lib/brand/asset-storage.ts)                                                       |
| Asset lifecycle             | [`src/lib/brand/asset-orphan.ts`](../../src/lib/brand/asset-orphan.ts)                                                         |
| Brand Studio loader         | [`src/lib/brand-studio/loader.ts`](../../src/lib/brand-studio/loader.ts)                                                       |
| Brand Studio view model     | [`src/lib/brand-studio/view-model.ts`](../../src/lib/brand-studio/view-model.ts)                                               |
| Brand server actions        | [`src/app/app/brands/actions.ts`](../../src/app/app/brands/actions.ts)                                                         |
| Brand Studio UI             | [`src/app/app/brands/brand-studio.tsx`](../../src/app/app/brands/brand-studio.tsx)                                             |
| Brand asset serving         | [`src/app/api/brand-assets/[ownerId]/[...path]/route.ts`](../../src/app/api/brand-assets/%5BownerId%5D/%5B...path%5D/route.ts) |

## Brand Style Shape

`BrandStyle` is the client-safe serialized shape of a `Brand` row. Brand styles
can control:

- name;
- palette;
- background/node/edge colors;
- font family;
- uploaded custom font asset id;
- uploaded logo asset id;
- protected display URLs derived from those asset ids.

Brand media is asset-backed. The database stores `fontAssetId` and
`logoAssetId`; display URLs are derived at read time from the asset storage key.
Brand reads use `serializeBrands` so server actions and API routes produce the
same `BrandStyle` objects without N+1 asset lookups.

## Entitlement Gates

Brand Studio loads the current user's entitlement facade and existing brands in
parallel. The view model exposes:

- `canUseBrandStyles` for creating, editing, deleting, and applying brands;
- `canUploadFont` for custom font uploads.

Brand style access and font upload are separate features. A plan can allow saved
brand styles without allowing custom font upload.

Create/update, media upload, and delete interactions each use a synchronous
operation boundary. Repeated activation cannot dispatch duplicate writes, a
form cannot save or close while its selected logo/font is still uploading, and
delete confirmation cannot close while deletion is unresolved. Typed action
failures stay visible and retryable; rejected transports use safe generic
feedback while preserving the draft or confirmation. Framework redirect and
not-found control flow is rethrown rather than rendered as an ordinary error.
Logo decoding and best-effort palette extraction remain inside the logo-upload
operation boundary, so a late image load cannot overwrite newer palette edits;
image failure, cancellation, or a bounded timeout releases the form without an
automatic palette. The palette can be edited normally after that boundary ends.
Unmounting a form invalidates its pending save or media upload: late results
cannot update detached form state, notify a detached parent, inject a custom
font into a replacement page, or run delayed logo-palette extraction.

Document-editor brand pickers load `/api/brand` through the shared saved-brand
client boundary. The complete response is parsed as `BrandStyle[]` before any
preview, font, or transform consumes it. Slow responses survive loading-state
rerenders, duplicate retries share one request, and unmount aborts outstanding
work. Network, non-OK, and malformed responses remain distinguishable from a
valid empty brand list through visible retryable feedback.

## Persistence And Asset Ownership

Brand create/update happens inside a transaction:

1. Validate the input shape and brand name/color fields.
2. Validate referenced logo/font asset ids.
3. Ensure referenced assets are active, brand-origin assets owned by the same
   user.
4. Create or update the brand row.
5. Link referenced assets to the brand and reconcile old brand assets.

Brand asset assignment requires active asset rows with no document/workspace
scope and an owner-scoped storage key prefix. Pre-save brand uploads may be
active without a `brandId` while a brand row has not been created yet; those
staging assets are valid only when they are unscoped
(`documentId`/`workspaceId`/`brandId` are null) and their storage key is in the
owner partition (`<ownerId>/<sha256>.<validated-ext>`). User-supplied filenames
do not determine storage extension; the extension is derived from validated MIME
type.

## Asset Lifecycle

Brand logos and fonts are stored under `storage/brand-assets` and served through
protected `/api/brand-assets/...` URLs. A brand asset is live only while an
active brand references it through `logoAssetId` or `fontAssetId`.

When a brand replaces media, no-longer-referenced assets are soft-deleted after
checking references across all active brands, not just the asset row's `brandId`.
When a brand is deleted, only assets with no remaining brand references are
soft-deleted. Physical purge happens only after the brand-asset retention window
elapses and repeats the same cross-brand liveness check.

Account export includes display metadata for active owner-partitioned brand
staging assets in addition to assets linked through the user's documents,
workspaces, or brands. Export scoping remains owner-bound and does not include
raw asset bytes.

## Applying A Brand

Brand transforms are pure. `brandToStylePatch` converts brand-controlled fields
to a visual style patch, and `applyBrand` merges that patch through the visual
transform helpers. Node/edge content, ids, labels, positions, and icons are not
changed by applying a brand.

## Invariants

1. Brand rows store asset ids, not raw media data or persisted display URLs.
2. Brand media display URLs are derived from active asset rows at read time.
3. Asset ids assigned to a brand must belong to the same owner.
4. Replacing or deleting brand media soft-deletes only assets unreferenced by all
   active brands.
5. Applying a brand changes style only, never visual content or topology.
6. Brand styles and custom font upload are separate entitlement gates.
7. Active unlinked brand-staging assets are valid only in the owner's storage
   partition and are exported as metadata for that owner only.

## Primary Tests

- [`src/lib/brand/brand.test.ts`](../../src/lib/brand/brand.test.ts)
- [`src/lib/brand/brand-list-client.test.ts`](../../src/lib/brand/brand-list-client.test.ts)
- [`src/lib/brand/asset-lifecycle.test.ts`](../../src/lib/brand/asset-lifecycle.test.ts)
- [`src/lib/assets/upload-policy.test.ts`](../../src/lib/assets/upload-policy.test.ts)
- [`src/lib/brand/font-face.test.ts`](../../src/lib/brand/font-face.test.ts)
- [`src/lib/brand-studio/view-model.test.ts`](../../src/lib/brand-studio/view-model.test.ts)
- [`src/lib/billing/brand-entitlements.test.ts`](../../src/lib/billing/brand-entitlements.test.ts)
- [`e2e/ui-matrix/workspace-billing-brand-ui.spec.ts`](../../e2e/ui-matrix/workspace-billing-brand-ui.spec.ts)
