/**
 * Protected slide asset serving route (Epic #374, issue #395).
 *
 * Serves slide assets with document-scoped access control so private
 * documents do not leak assets through predictable public-file URLs.
 *
 * Access rules:
 *  1. Authenticated users with at least `view` capability on the document
 *     can fetch any asset scoped to that document.
 *  2. Anonymous requests must include `shareId` + `shareMode` query params
 *     that still satisfy the document's active share policy. Public
 *     presentation/embed surfaces bind these params into protected URLs.
 *  3. All other requests receive 403.
 *
 * URL pattern: GET /api/slide-assets/[documentId]/[...path]
 *
 * The `path` segments reconstruct the asset's `storageKey` suffix
 * (e.g. `${checksum}.${ext}`).  The route reads the asset row, confirms
 * ownership, and streams the file from the local storage root.
 */

import { type NextRequest, NextResponse } from "next/server";

import {
  checkAbuseBudget,
  getClientSubject,
  requireAbuseBudgetSecret,
} from "@/lib/abuse-budget";
import { accessDecisionToPlainTextApiResponse } from "@/lib/access-policy/adapters";
import { notFound, tooManyRequests } from "@/lib/api/errors";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { resolvePublicAssetAccessForDocument } from "@/lib/public-render/resolver-core";
import {
  decideSlideAssetAccess,
  slideAssetAccessDecisionToAccessDecision,
} from "@/lib/slides/asset-access";
import { SHARE_ACCESS_SELECT } from "@/lib/share-access";
import { isPublicSharePasscodeUnlocked } from "@/lib/share-passcode-server";
import { shareIdFromParam } from "@/lib/slug";
import { logError } from "@/lib/log";
import { getDefaultStorageAdapter } from "@/lib/slides/asset-storage";
import { serveStoredAsset } from "@/lib/assets/serve";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string; path: string[] }> },
): Promise<Response> {
  const secret = requireAbuseBudgetSecret();
  if (secret) {
    const budget = await checkAbuseBudget({
      namespace: "public.asset.ip",
      subject: getClientSubject(request.headers),
      secret,
    });
    if (!budget.allowed) {
      return tooManyRequests(budget.retryAfterSeconds);
    }
  }

  const { documentId, path: pathSegments } = await params;
  const filenamePart = Array.isArray(pathSegments)
    ? pathSegments.join("/")
    : pathSegments;
  const requestedShareId = request.nextUrl.searchParams.get("shareId");
  const requestedShareModeParam = request.nextUrl.searchParams.get("shareMode");

  // Reconstruct the storage key: `${documentId}/${filename}`.
  const storageKey = `${documentId}/${filenamePart}`;

  const requestedShareMode =
    requestedShareModeParam === "present" || requestedShareModeParam === "embed"
      ? requestedShareModeParam
      : null;

  // -------------------------------------------------------------------
  // 1. Look up the asset and its owning document (no access decision yet).
  // -------------------------------------------------------------------
  const asset = await prisma.asset.findFirst({
    where: { storageKey, documentId, deletedAt: null },
    select: {
      id: true,
      mimeType: true,
      storageKey: true,
      document: {
        select: {
          ownerId: true,
          workspaceId: true,
          ...SHARE_ACCESS_SELECT,
          workspace: {
            select: {
              ownerId: true,
              members: { select: { userId: true, role: true } },
            },
          },
        },
      },
    },
  });

  const user = await getCurrentUser();
  const document = asset?.document ?? null;
  const publicShareId = requestedShareId
    ? shareIdFromParam(requestedShareId) || requestedShareId
    : "";
  const passcodeUnlocked =
    document && publicShareId
      ? await isPublicSharePasscodeUnlocked(document, publicShareId)
      : false;
  const publicAssetAccess = resolvePublicAssetAccessForDocument(
    document,
    publicShareId,
    requestedShareMode,
    undefined,
    passcodeUnlocked,
  );

  // -------------------------------------------------------------------
  // 2. Access control — single composed, route-shared decision.
  // -------------------------------------------------------------------
  const decision = decideSlideAssetAccess({
    asset: asset ? { id: asset.id } : null,
    document,
    userId: user?.id ?? null,
    publicAssetAccess,
  });

  if (!decision.allow) {
    // Privacy: missing asset/document and unauthorized requests both surface as
    // plain-text bodies; existence is never leaked (404 stays a 404).
    return accessDecisionToPlainTextApiResponse(
      slideAssetAccessDecisionToAccessDecision(decision),
    )!;
  }

  // `asset` is non-null here (a null asset would have denied with 404 above).
  return serveAsset(request, asset!.storageKey, asset!.mimeType);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Reads the asset via the default storage adapter and streams the bytes.
 *
 * The adapter reads from the non-public `storage/slide-assets/` directory.
 *
 * Returns 404 if the file is not found on any storage layer (storage
 * inconsistency after a cleanup run).
 */
async function serveAsset(
  request: Request,
  storageKey: string,
  mimeType: string,
): Promise<NextResponse> {
  try {
    return await serveStoredAsset({
      adapter: getDefaultStorageAdapter(),
      storageKey,
      mimeType,
      request,
    });
  } catch (err) {
    logError("slide-asset-serve", err, { storageKey });
    return notFound();
  }
}
