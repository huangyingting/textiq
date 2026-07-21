/**
 * Protected brand-asset serving route (Epic #496).
 *
 * Serves brand logos and uploaded custom fonts with OWNER-scoped access control
 * so a brand's private media is never reachable through a predictable public
 * URL.  Brand assets are partitioned in storage by the owner's user id, which is
 * also the access boundary: only the authenticated owner may fetch the bytes.
 *
 * Access rules:
 *  1. The request must be authenticated.
 *  2. The session user id must equal the owner partition in the URL.
 *  3. The asset row must exist for the reconstructed storage key.
 *
 * All denials return the same 404/plain-text response, so anonymous and
 * non-owner callers cannot distinguish missing keys from private assets.
 *
 * URL pattern: GET /api/brand-assets/[ownerId]/[...path]
 *
 * The `path` segments reconstruct the asset's `storageKey` suffix
 * (e.g. `${checksum}.${ext}`). Same-origin browser fetches (`<img src>`,
 * `@font-face src: url(...)`) carry the session cookie, so protected brand URLs
 * load in-browser for the owner.
 */

import { type NextRequest, NextResponse } from "next/server";

import {
  checkAbuseBudget,
  getClientSubject,
  requireAbuseBudgetSecret,
} from "@/lib/abuse-budget";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { decideBrandAssetAccess } from "@/lib/brand/asset-access";
import { getBrandStorageAdapter } from "@/lib/brand/asset-storage";
import { loadCustomThemePackagesForDeckJson } from "@/lib/presentation/brand-kit/persistence";
import {
  publicAssetShareModeFromParam,
  PUBLIC_ASSET_ROUTE_DOCUMENT_SELECT,
  resolvePublicAssetAccessForDocument,
} from "@/lib/share/public-asset-policy";
import { isPublicSharePasscodeUnlocked } from "@/lib/share-passcode-server";
import { shareIdFromParam } from "@/lib/slug";
import { logError } from "@/lib/log";
import { plainTextResponse } from "@/lib/api/route-adapters";
import { serveStoredAsset } from "@/lib/assets/serve";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ownerId: string; path: string[] }> },
): Promise<NextResponse> {
  const secret = requireAbuseBudgetSecret();
  if (secret) {
    const budget = await checkAbuseBudget({
      namespace: "public.asset.ip",
      subject: getClientSubject(request.headers),
      secret,
    });
    if (!budget.allowed) {
      return new NextResponse("Too many requests", {
        status: 429,
        headers: budget.retryAfterSeconds
          ? { "Retry-After": String(budget.retryAfterSeconds) }
          : undefined,
      });
    }
  }

  const { ownerId, path: pathSegments } = await params;
  const filenamePart = Array.isArray(pathSegments)
    ? pathSegments.join("/")
    : pathSegments;

  // Reconstruct the storage key: `${ownerId}/${filename}`.
  const storageKey = `${ownerId}/${filenamePart}`;
  const requestedShareId = request.nextUrl.searchParams.get("shareId");
  const requestedShareModeParam = request.nextUrl.searchParams.get("shareMode");

  const user = await getCurrentUser();
  const canUseOwnerAccess = user?.id === ownerId;
  const canAttemptPublicAccess = requestedShareId && requestedShareModeParam;

  if (!canUseOwnerAccess && !canAttemptPublicAccess) {
    return brandAssetPrivacyResponse();
  }

  const asset = await prisma.asset.findFirst({
    where: { storageKey, deletedAt: null },
    select: { id: true, mimeType: true, storageKey: true },
  });

  if (canUseOwnerAccess) {
    const decision = decideBrandAssetAccess({
      asset: asset ? { id: asset.id } : null,
      requestedOwnerId: ownerId,
      userId: user!.id,
    });

    if (decision.allow) {
      return serveAsset(request, asset!.storageKey, asset!.mimeType);
    }
  }

  if (
    asset &&
    requestedShareId &&
    requestedShareModeParam &&
    (await canServePublicThemeAsset({
      assetStorageKey: asset.storageKey,
      request,
      requestedShareId,
      requestedShareModeParam,
    }))
  ) {
    return serveAsset(request, asset.storageKey, asset.mimeType);
  }

  return brandAssetPrivacyResponse();
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function brandAssetPrivacyResponse(): NextResponse {
  return plainTextResponse("Not found", 404);
}

async function canServePublicThemeAsset({
  assetStorageKey,
  request,
  requestedShareId,
  requestedShareModeParam,
}: {
  assetStorageKey: string;
  request: NextRequest;
  requestedShareId: string;
  requestedShareModeParam: string;
}): Promise<boolean> {
  const publicShareId = shareIdFromParam(requestedShareId) || requestedShareId;
  const requestedShareMode = publicAssetShareModeFromParam(
    requestedShareModeParam,
  );
  const document = await prisma.document.findFirst({
    where: { shareId: publicShareId },
    select: {
      deckJson: true,
      ...PUBLIC_ASSET_ROUTE_DOCUMENT_SELECT,
    },
  });
  const passcodeUnlocked = document
    ? await isPublicSharePasscodeUnlocked(document, publicShareId)
    : false;
  const publicAssetAccess = resolvePublicAssetAccessForDocument(
    document,
    publicShareId,
    requestedShareMode,
    undefined,
    passcodeUnlocked,
  );
  if (!publicAssetAccess.allow || !document) return false;

  const customThemes = await loadCustomThemePackagesForDeckJson(
    document.deckJson,
  );
  const pkg = customThemes.activePackage;
  if (!pkg?.assets) return false;

  const expectedPath = `/api/brand-assets/${assetStorageKey}`;
  const assetSources = [
    ...Object.values(pkg.assets.images ?? {}).map((asset) => asset.src),
    ...Object.values(pkg.assets.fonts ?? {}).map((asset) => asset.src),
  ];
  return assetSources.some((src) => {
    try {
      return new URL(src, request.nextUrl.origin).pathname === expectedPath;
    } catch {
      return false;
    }
  });
}

/**
 * Reads the asset via the brand storage adapter and streams the bytes.
 * Returns 404 if the file is not found on storage (inconsistency after a
 * cleanup run).
 */
async function serveAsset(
  request: Request,
  storageKey: string,
  mimeType: string,
): Promise<NextResponse> {
  try {
    return await serveStoredAsset({
      adapter: getBrandStorageAdapter(),
      storageKey,
      mimeType,
      request,
    });
  } catch (err) {
    logError("brand-asset-serve", err, { storageKey });
    return plainTextResponse("Not found", 404);
  }
}
