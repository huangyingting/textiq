import { denyAccess, type AccessDecision } from "@/lib/access-policy/taxonomy";
import {
  evaluateShareAccessDecision,
  toShareAccessInput,
  type ShareAccessFields,
  type ShareMode,
} from "@/lib/share-access";
import { shareIdFromParam } from "@/lib/slug";
import type { ThemePackageV1 } from "@/lib/presentation/theme-package-schema";

/* node:coverage disable */
import { buildPublicAttribution, type PublicAttribution } from "./attribution";
import {
  buildPublicPresentationModel,
  type PublicPresentationModel,
} from "./presentation";
/* node:coverage enable */
import type { PublicMetadataDocument } from "./metadata-contract";

export type PublicRenderMode = "view" | "embed" | "present" | "og";
export type PublicRenderProjection = "document" | "presentation" | "metadata";

type PublicRenderModeProjectionPair =
  | { mode: "view"; projection: "document" }
  | { mode: "view"; projection: "metadata" }
  | { mode: "embed"; projection: "document" }
  | { mode: "embed"; projection: "presentation" }
  | { mode: "present"; projection: "presentation" }
  | { mode: "present"; projection: "metadata" }
  | { mode: "og"; projection: "metadata" };

const PUBLIC_RENDER_PROJECTIONS_BY_MODE = {
  view: ["document", "metadata"],
  embed: ["document", "presentation"],
  present: ["presentation", "metadata"],
  og: ["metadata"],
} as const satisfies Record<
  PublicRenderMode,
  readonly PublicRenderProjection[]
>;

export function isPublicRenderModeProjectionPair(
  mode: PublicRenderMode,
  projection: PublicRenderProjection,
): boolean {
  return (
    PUBLIC_RENDER_PROJECTIONS_BY_MODE[mode] as readonly PublicRenderProjection[]
  ).includes(projection);
}

export function assertPublicRenderModeProjectionPair(
  mode: PublicRenderMode,
  projection: PublicRenderProjection,
): void {
  if (isPublicRenderModeProjectionPair(mode, projection)) {
    return;
  }

  throw new Error(
    `Invalid public render request pair: mode "${mode}" does not support projection "${projection}".`,
  );
}

export interface PublicRenderRawParams {
  shareId?: string;
}

interface PublicRenderOwner {
  name: string | null;
  plan: string;
}

export type PublicRenderDocumentRow = ShareAccessFields & {
  id: string;
  title: string;
  contentJson: unknown;
  owner: PublicRenderOwner;
};

export type PublicRenderMetadataRow = ShareAccessFields & {
  title: string;
  contentJson: unknown;
  slug: string | null;
};

export type PublicRenderPresentationRow = ShareAccessFields & {
  id: string;
  title: string;
  contentJson: unknown;
  deckJson: unknown;
  owner: PublicRenderOwner;
  customThemePackages?: ThemePackageV1[];
};

export interface PublicDocumentModel {
  id: string;
  title: string;
  contentJson: unknown;
  ownerName: string;
  showAttribution: boolean;
}

export type PublicMetadataModel = PublicMetadataDocument;

export interface PublicRenderSource {
  findDocumentByShareId(
    shareId: string,
  ): Promise<PublicRenderDocumentRow | null>;
  findMetadataByShareId(
    shareId: string,
  ): Promise<PublicRenderMetadataRow | null>;
  findPresentationByShareId(
    shareId: string,
  ): Promise<PublicRenderPresentationRow | null>;
}

/* node:coverage disable */
type SharedProjectionResult =
  | {
      ok: true;
      mode: "view" | "embed";
      projection: "document";
      shareId: string;
      document: PublicDocumentModel;
      decision: AccessDecision;
    }
  | {
      ok: true;
      mode: "view" | "present" | "og";
      projection: "metadata";
      shareId: string;
      metadata: PublicMetadataModel;
      decision: AccessDecision;
    }
  | {
      ok: true;
      mode: "embed" | "present";
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
      mode: PublicRenderMode;
      projection: PublicRenderProjection;
      shareId: string;
      decision: AccessDecision;
    };

export type ResolvePublicRenderInput = {
  params: PublicRenderRawParams;
  now?: Date;
  passcodeUnlocked?:
    | boolean
    | ((
        document: ShareAccessFields,
        shareId: string,
      ) => boolean | Promise<boolean>);
} & PublicRenderModeProjectionPair;

function shareModeForPublicMode(mode: PublicRenderMode): ShareMode {
  switch (mode) {
    case "embed":
      return "embed";
    case "present":
      return "present";
    case "view":
    case "og":
      return "view";
  }
}

function missingShareDecision(mode: PublicRenderMode): AccessDecision {
  return denyAccess({
    resource: { kind: "share" },
    capability: shareModeForPublicMode(mode),
    reason: "resource-not-found",
    status: 404,
    safeMessage: "Shared document not found.",
    concealResource: true,
  });
}

async function resolvePasscodeUnlocked(
  input: ResolvePublicRenderInput,
  document: ShareAccessFields,
  shareId: string,
): Promise<boolean> {
  if (typeof input.passcodeUnlocked === "function") {
    return input.passcodeUnlocked(document, shareId);
  }
  return input.passcodeUnlocked ?? false;
}

async function evaluatePublicShareDecision(
  input: ResolvePublicRenderInput,
  document: ShareAccessFields,
  shareId: string,
): Promise<AccessDecision> {
  const shareMode = shareModeForPublicMode(input.mode);
  const passcodeUnlocked = await resolvePasscodeUnlocked(
    input,
    document,
    shareId,
  );

  return evaluateShareAccessDecision(
    toShareAccessInput(
      document,
      shareId,
      shareMode,
      input.now,
      passcodeUnlocked,
    ),
  );
}

/* node:coverage disable */
export async function resolvePublicRenderWithSource(
  source: PublicRenderSource,
  input: ResolvePublicRenderInput,
): Promise<PublicRenderResult> {
  /* node:coverage enable */
  assertPublicRenderModeProjectionPair(input.mode, input.projection);

  const rawShareId = input.params.shareId ?? "";
  const shareId = shareIdFromParam(rawShareId) || rawShareId;

  if (input.projection === "document") {
    const document = shareId
      ? await source.findDocumentByShareId(shareId)
      : null;
    if (!document) {
      return {
        ok: false,
        mode: input.mode,
        projection: "document",
        shareId,
        decision: missingShareDecision(input.mode),
      };
    }

    const decision = await evaluatePublicShareDecision(
      input,
      document,
      shareId,
    );
    if (!decision.allow) {
      return {
        ok: false,
        mode: input.mode,
        projection: "document",
        shareId,
        decision,
      };
    }

    if (document.contentJson == null) {
      return {
        ok: false,
        mode: input.mode,
        projection: "document",
        shareId,
        decision: missingShareDecision(input.mode),
      };
    }

    const attribution: PublicAttribution = buildPublicAttribution(
      document.owner,
    );
    return {
      ok: true,
      mode: input.mode,
      projection: "document",
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

  if (input.projection === "metadata") {
    const document = shareId
      ? await source.findMetadataByShareId(shareId)
      : null;
    if (!document) {
      return {
        ok: false,
        mode: input.mode,
        projection: "metadata",
        shareId,
        decision: missingShareDecision(input.mode),
      };
    }

    const decision = await evaluatePublicShareDecision(
      input,
      document,
      shareId,
    );
    if (!decision.allow) {
      return {
        ok: false,
        mode: input.mode,
        projection: "metadata",
        shareId,
        decision,
      };
    }

    return {
      ok: true,
      mode: input.mode,
      projection: "metadata",
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

  const document = shareId
    ? await source.findPresentationByShareId(shareId)
    : null;
  if (!document) {
    return {
      ok: false,
      mode: input.mode,
      projection: "presentation",
      shareId,
      decision: missingShareDecision(input.mode),
    };
  }

  const decision = await evaluatePublicShareDecision(input, document, shareId);
  if (!decision.allow) {
    return {
      ok: false,
      mode: input.mode,
      projection: "presentation",
      shareId,
      decision,
    };
  }

  return {
    ok: true,
    mode: input.mode,
    projection: "presentation",
    shareId,
    presentation: buildPublicPresentationModel(document, {
      shareId,
      mode: input.mode === "embed" ? "embed" : "present",
    }),
    decision,
  };
}
