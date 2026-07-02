import {
  allowAccess,
  denyAccess,
  type AccessDecision,
} from "@/lib/access-policy/taxonomy";
import {
  evaluateShareAccessDecision,
  toShareAccessInput,
  type ShareAccessFields,
  type ShareMode,
} from "@/lib/share-access";
import { shareIdFromParam } from "@/lib/slug";
import type { DocumentRoleInput } from "@/lib/auth/document-permissions";
import type { ThemePackageV1 } from "@/lib/presentation/theme-package-schema";

/* node:coverage disable */
import { buildPublicAttribution, type PublicAttribution } from "./attribution";
import {
  buildPublicPresentationModel,
  type PublicPresentationModel,
} from "./presentation";
/* node:coverage enable */

export type PublicRenderMode = "view" | "embed" | "present" | "og" | "asset";
export type PublicRenderProjection =
  | "document"
  | "presentation"
  | "metadata"
  | "assetAccess";
type PublicAssetShareMode = "present" | "embed";

export interface PublicRenderRawParams {
  shareId?: string;
  documentId?: string;
  shareMode?: string;
}

export type PublicRenderDocumentRow = ShareAccessFields &
  DocumentRoleInput & {
    id: string;
    title: string;
    contentJson: unknown;
    deckJson: unknown;
    slug: string | null;
    owner: {
      name: string | null;
      plan: string;
    };
    customThemePackages?: ThemePackageV1[];
  };

export interface PublicDocumentModel {
  id: string;
  title: string;
  contentJson: unknown;
  ownerName: string;
  showAttribution: boolean;
}

export interface PublicMetadataModel {
  title: string;
  contentJson: unknown;
  slug: string | null;
  shareId: string | null;
  metadataMode: string;
  discoverable: boolean;
}

/* node:coverage disable */
export type PublicAssetAccessDecision =
  | { allow: true; via: "share-present" | "share-embed" }
  | {
      allow: false;
      status: 403 | 404;
      reason: "document-not-found" | "forbidden";
    };
/* node:coverage enable */

export interface PublicRenderSource {
  findByShareId(shareId: string): Promise<PublicRenderDocumentRow | null>;
  findByDocumentId(documentId: string): Promise<PublicRenderDocumentRow | null>;
}

/* node:coverage disable */
type SharedProjectionResult =
  | {
      ok: true;
      mode: Exclude<PublicRenderMode, "asset">;
      projection: "document";
      shareId: string;
      document: PublicDocumentModel;
      decision: AccessDecision;
    }
  | {
      ok: true;
      mode: Exclude<PublicRenderMode, "asset">;
      projection: "metadata";
      shareId: string;
      metadata: PublicMetadataModel;
      decision: AccessDecision;
    }
  | {
      ok: true;
      mode: Exclude<PublicRenderMode, "asset">;
      projection: "presentation";
      shareId: string;
      presentation: PublicPresentationModel;
      decision: AccessDecision;
    };
/* node:coverage enable */

export type PublicRenderResult =
  | SharedProjectionResult
  | {
      ok: false;
      mode: Exclude<PublicRenderMode, "asset">;
      projection: Exclude<PublicRenderProjection, "assetAccess">;
      shareId: string;
      decision: AccessDecision;
    }
  | {
      ok: boolean;
      mode: "asset";
      projection: "assetAccess";
      documentId: string;
      document: PublicRenderDocumentRow | null;
      publicAccess: PublicAssetAccessDecision;
      decision: AccessDecision;
    };

export interface ResolvePublicRenderInput {
  params: PublicRenderRawParams;
  mode: PublicRenderMode;
  projection: PublicRenderProjection;
  now?: Date;
}

function shareModeForPublicMode(mode: PublicRenderMode): ShareMode {
  switch (mode) {
    case "embed":
      return "embed";
    case "present":
      return "present";
    case "view":
    case "og":
      return "view";
    case "asset":
      throw new Error("Asset mode uses asset access projection.");
  }
}

function missingShareDecision(mode: PublicRenderMode): AccessDecision {
  const capability = mode === "asset" ? "serve" : shareModeForPublicMode(mode);
  return denyAccess({
    resource: { kind: "share" },
    capability,
    reason: "resource-not-found",
    status: 404,
    safeMessage: "Shared document not found.",
    concealResource: true,
  });
}

function publicAssetAccessDecisionToAccessDecision(
  decision: PublicAssetAccessDecision,
): AccessDecision {
  if (decision.allow) {
    return allowAccess({
      resource: { kind: "share" },
      capability: "serve",
    });
  }

  return denyAccess({
    resource: { kind: "share" },
    capability: "serve",
    reason:
      decision.reason === "document-not-found"
        ? "resource-not-found"
        : "forbidden",
    status: decision.status,
    safeMessage: decision.status === 404 ? "Not found" : "Forbidden",
    concealResource: decision.status === 404,
  });
}

export function resolvePublicAssetAccessForDocument(
  document: (ShareAccessFields & { deletedAt: Date | null }) | null,
  requestedShareId: string,
  requestedShareMode: PublicAssetShareMode | null,
  now?: Date,
): PublicAssetAccessDecision {
  if (!document || document.deletedAt) {
    return { allow: false, status: 404, reason: "document-not-found" };
  }

  if (!requestedShareId || !requestedShareMode) {
    return { allow: false, status: 403, reason: "forbidden" };
  }

  const decision = evaluateShareAccessDecision(
    toShareAccessInput(document, requestedShareId, requestedShareMode, now),
  );
  if (decision.allow) {
    return {
      allow: true,
      via: requestedShareMode === "present" ? "share-present" : "share-embed",
    };
  }

  return { allow: false, status: 403, reason: "forbidden" };
  /* node:coverage ignore next 3 -- tsx maps the function close/next signature to non-runtime lines. */
}

/* node:coverage disable */
export async function resolvePublicRenderWithSource(
  source: PublicRenderSource,
  input: ResolvePublicRenderInput,
): Promise<PublicRenderResult> {
  /* node:coverage enable */
  if (input.mode === "asset" || input.projection === "assetAccess") {
    if (input.mode !== "asset" || input.projection !== "assetAccess") {
      throw new Error(
        "Asset public render requests require assetAccess projection.",
      );
    }

    const documentId = input.params.documentId ?? "";
    const document = documentId
      ? await source.findByDocumentId(documentId)
      : null;
    const rawShareId = input.params.shareId ?? "";
    const requestedShareId = shareIdFromParam(rawShareId) || rawShareId;
    const requestedShareMode =
      input.params.shareMode === "present" || input.params.shareMode === "embed"
        ? input.params.shareMode
        : null;
    const publicAccess = resolvePublicAssetAccessForDocument(
      document,
      requestedShareId,
      requestedShareMode,
      input.now,
    );

    return {
      ok: publicAccess.allow,
      mode: "asset",
      projection: "assetAccess",
      documentId,
      document,
      publicAccess,
      decision: publicAssetAccessDecisionToAccessDecision(publicAccess),
    };
  }

  const shareId = shareIdFromParam(input.params.shareId ?? "");
  const document = shareId ? await source.findByShareId(shareId) : null;
  const mode = input.mode;
  const projection = input.projection;

  if (!document) {
    return {
      ok: false,
      mode,
      projection,
      shareId,
      decision: missingShareDecision(mode),
    };
  }

  const shareMode = shareModeForPublicMode(mode);
  const decision = evaluateShareAccessDecision(
    toShareAccessInput(document, shareId, shareMode, input.now),
  );
  if (!decision.allow) {
    return { ok: false, mode, projection, shareId, decision };
  }

  if (projection === "document") {
    if (document.contentJson == null) {
      return {
        ok: false,
        mode,
        projection,
        shareId,
        decision: missingShareDecision(mode),
      };
    }

    const attribution: PublicAttribution = buildPublicAttribution(
      document.owner,
    );
    return {
      ok: true,
      mode,
      projection,
      shareId,
      document: {
        id: document.id,
        title: document.title,
        contentJson: document.contentJson,
        ownerName: attribution.ownerName,
        showAttribution: attribution.showAttribution,
      },
      decision,
    };
  }

  if (projection === "metadata") {
    return {
      ok: true,
      mode,
      projection,
      shareId,
      metadata: {
        title: document.title,
        contentJson: document.contentJson,
        slug: document.slug,
        shareId: document.shareId,
        metadataMode: document.shareMetadataMode ?? "generic",
        discoverable: document.shareDiscoverable ?? false,
      },
      decision,
    };
  }

  return {
    ok: true,
    mode,
    projection,
    shareId,
    presentation: buildPublicPresentationModel(document, {
      shareId,
      mode: mode === "embed" ? "embed" : "present",
    }),
    decision,
  };
}
