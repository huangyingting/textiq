import type { Prisma } from "@/generated/prisma/client";

import {
  evaluateShareAccessDecision,
  toShareAccessInput,
  SHARE_ACCESS_SELECT,
  type ShareAccessFields,
} from "@/lib/share-access";

export type PublicAssetShareMode = "present" | "embed";

export type PublicAssetAccessDecision =
  | { allow: true; via: "share-present" | "share-embed" }
  | {
      allow: false;
      status: 403 | 404;
      reason: "document-not-found" | "forbidden";
    };

export const PUBLIC_ASSET_ROUTE_DOCUMENT_SELECT = {
  ownerId: true,
  workspaceId: true,
  ...SHARE_ACCESS_SELECT,
  workspace: {
    select: {
      ownerId: true,
      members: { select: { userId: true, role: true } },
    },
  },
} satisfies Prisma.DocumentSelect;

export function publicAssetShareModeFromParam(
  shareMode: string | null,
): PublicAssetShareMode | null {
  return shareMode === "present" || shareMode === "embed" ? shareMode : null;
}

export function resolvePublicAssetAccessForDocument(
  document: ShareAccessFields | null,
  requestedShareId: string,
  requestedShareMode: PublicAssetShareMode | null,
  now?: Date,
  passcodeUnlocked = false,
): PublicAssetAccessDecision {
  if (!document || document.deletedAt) {
    return { allow: false, status: 404, reason: "document-not-found" };
  }

  if (!requestedShareId || !requestedShareMode) {
    return { allow: false, status: 403, reason: "forbidden" };
  }

  const decision = evaluateShareAccessDecision(
    toShareAccessInput(
      document,
      requestedShareId,
      requestedShareMode,
      now,
      passcodeUnlocked,
    ),
  );
  if (decision.allow) {
    return {
      allow: true,
      via: requestedShareMode === "present" ? "share-present" : "share-embed",
    };
  }

  return { allow: false, status: 403, reason: "forbidden" };
}
