/**
 * Pure shaping for the "Download my data" export (#162, #484).
 *
 * I/O-free so it can be unit-tested DOM-free: the route handler does the Prisma
 * reads and JSON serialization; this module decides the shape and is the single
 * source of truth for what an export contains. Keeping it pure also guarantees
 * we never accidentally include another user's data — the function only ever
 * sees the already-owner-scoped rows passed in.
 *
 * ---------------------------------------------------------------------------
 * Compliance boundary (issue #484)
 * ---------------------------------------------------------------------------
 *
 * The export is scoped to the **authenticated user** only. No other user's data
 * is ever included.  Specifically the export includes:
 *
 *   INCLUDED:
 *   - user profile (id, email, name, image, emailVerified, plan, createdAt)
 *   - documents owned by the user (not deleted) + their visuals
 *   - document versions for owned documents
 *   - workspaces owned by the user
 *   - workspace memberships where the user is a non-owner member
 *   - comments authored by the user (body, timestamps; document id for context)
 *   - tags owned by the user
 *   - brands owned by the user (incl. logo/font asset references — ids only)
 *   - brand-kit drafts and theme-package snapshots owned by the user
 *   - assets owned by the user via documents, workspaces, brands, OR owner-
 *     partitioned brand-staging uploads (metadata only — mimeType/byteSize/
 *     checksum/createdAt; NOT the raw file bytes)
 *   - active subscription (if any)
 *
 *   EXCLUDED:
 *   - other users' data (docs, comments, profiles)
 *   - soft-deleted documents (deletedAt != null)
 *   - raw file bytes for assets, including brand logo/font bytes (identified by
 *     asset id only, never inlined)
 *   - Stripe webhook events, rate-limit hits, and other operational tables
 *   - invite-link tokens (security — tokens are not user data)
 *
 * The export is a point-in-time snapshot; real-time consistency within a
 * single request is the responsibility of the caller (route handler). Dates
 * are normalized to ISO 8601 UTC strings for portability.
 */

import { PERSONAL_DATA_EXPORT_SECTIONS } from "@/lib/privacy/personal-data-inventory";
import { lexicalStateToPlainText } from "@/lib/content/plain-text";

export const ACCOUNT_EXPORT_VERSION = 4;

/* node:coverage ignore next 46 -- Export snapshot interfaces are TypeScript-only payload contracts. */
export interface ExportUserInput {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  emailVerified: Date | null;
  plan: string;
  createdAt: Date;
}

interface ExportVisualInput {
  id: string;
  type: string;
  title: string | null;
  anchorBlockId: string | null;
  orderIndex: number;
  data: unknown;
  createdAt: Date;
  updatedAt: Date;
}

interface ExportDocumentVersionInput {
  id: string;
  label: string | null;
  createdAt: Date;
}

export interface ExportDocumentInput {
  id: string;
  title: string;
  content?: string | null;
  contentJson: unknown;
  deckJson: unknown;
  workspaceId: string | null;
  isShared: boolean;
  sharePolicy: {
    expiresAt: Date | null;
    embedEnabled: boolean;
    presentEnabled: boolean;
    metadataMode: string;
    discoverable: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
  visuals: ExportVisualInput[];
  versions: ExportDocumentVersionInput[];
}

export interface ExportWorkspaceInput {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExportMembershipInput {
  id: string;
  workspaceId: string;
  role: string;
  createdAt: Date;
}

export interface ExportCommentInput {
  id: string;
  documentId: string;
  body: string;
  resolved: boolean;
  parentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExportCommentReadInput {
  id: string;
  documentId: string;
  lastReadAt: Date;
}

export interface ExportTagInput {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExportBrandInput {
  id: string;
  name: string;
  /** Asset reference for the brand logo, when set (Epic #496). Metadata only. */
  logoAssetId?: string | null;
  /** Asset reference for the brand font, when set (Epic #496). Metadata only. */
  fontAssetId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExportBrandKitDraftInput {
  id: string;
  slug: string;
  name: string;
  ownerId: string;
  workspaceId: string | null;
  scope: string;
  scopeKey: string;
  sourcePresetId: string | null;
  version: string;
  revisionId: string;
  revisionNumber: number;
  draftJson: unknown;
  latestPackageId: string | null;
  latestPackageVersion: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExportThemePackageSnapshotInput {
  id: string;
  packageId: string;
  packageVersion: string;
  draftId: string | null;
  ownerId: string;
  workspaceId: string | null;
  publishedById: string | null;
  packageJson: unknown;
  createdAt: Date;
}

export interface ExportAssetInput {
  id: string;
  mimeType: string;
  byteSize: number;
  widthPx: number | null;
  heightPx: number | null;
  checksum: string;
  originalName: string | null;
  createdAt: Date;
}

export interface ExportSubscriptionInput {
  id: string;
  plan: string;
  status: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExportInviteLinkUseInput {
  id: string;
  inviteLinkId: string;
  workspaceId: string | null;
  role: string;
  usedAt: Date;
}

export interface ExportUsageLedgerEntryInput {
  id: string;
  userId: string;
  operation: string;
  creditCost: number;
  status: string;
  reservationVersion: number;
  reservedAt: Date;
  capturedAt: Date | null;
  refundedAt: Date | null;
}

export const ACCOUNT_EXPORT_USAGE_LEDGER_FIELDS = [
  "id",
  "userId",
  "operation",
  "creditCost",
  "status",
  "reservationVersion",
  "reservedAt",
  "capturedAt",
  "refundedAt",
] as const;

export interface AccountExport {
  exportVersion: number;
  exportedAt: string;
  /** Compliance scope: describes what is and is not included. */
  scope: {
    description: string;
    includedEntities: string[];
    excludedEntities: string[];
  };
  manifest: {
    personalDataSections: string[];
    assetBytesIncluded: false;
    assetBytesDecision: string;
  };
  user: {
    id: string;
    email: string;
    name: string | null;
    image: string | null;
    emailVerified: string | null;
    plan: string;
    createdAt: string;
  };
  documents: Array<{
    id: string;
    title: string;
    content: string;
    contentJson: unknown;
    deckJson: unknown;
    workspaceId: string | null;
    isShared: boolean;
    sharePolicy: {
      expiresAt: string | null;
      embedEnabled: boolean;
      presentEnabled: boolean;
      metadataMode: string;
      discoverable: boolean;
    };
    createdAt: string;
    updatedAt: string;
    /* node:coverage ignore next 9 -- Nested export payload interface rows are TypeScript-only. */
    visuals: Array<{
      id: string;
      type: string;
      title: string | null;
      anchorBlockId: string | null;
      orderIndex: number;
      data: unknown;
      createdAt: string;
      updatedAt: string;
    }>;
    versions: Array<{
      id: string;
      label: string | null;
      createdAt: string;
    }>;
  }>;
  workspacesOwned: Array<{
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
  }>;
  workspaceMemberships: Array<{
    id: string;
    workspaceId: string;
    role: string;
    createdAt: string;
  }>;
  comments: Array<{
    id: string;
    documentId: string;
    body: string;
    resolved: boolean;
    parentId: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  commentReads: Array<{
    id: string;
    documentId: string;
    lastReadAt: string;
  }>;
  tags: Array<{
    id: string;
    name: string;
    slug: string;
    createdAt: string;
    updatedAt: string;
  }>;
  brands: Array<{
    id: string;
    name: string;
    logoAssetId: string | null;
    fontAssetId: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  brandKitDrafts: Array<{
    id: string;
    slug: string;
    name: string;
    ownerId: string;
    workspaceId: string | null;
    scope: string;
    scopeKey: string;
    sourcePresetId: string | null;
    version: string;
    revisionId: string;
    revisionNumber: number;
    draftJson: unknown;
    latestPackageId: string | null;
    latestPackageVersion: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  themePackageSnapshots: Array<{
    id: string;
    packageId: string;
    packageVersion: string;
    draftId: string | null;
    ownerId: string;
    workspaceId: string | null;
    publishedById: string | null;
    packageJson: unknown;
    createdAt: string;
  }>;
  assets: Array<{
    id: string;
    mimeType: string;
    byteSize: number;
    widthPx: number | null;
    heightPx: number | null;
    checksum: string;
    displayName: string | null;
    createdAt: string;
  }>;
  subscription: {
    id: string;
    plan: string;
    status: string;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
    createdAt: string;
    updatedAt: string;
  } | null;
  inviteLinkUses: Array<{
    id: string;
    inviteLinkId: string;
    workspaceId: string | null;
    role: string;
    usedAt: string;
  }>;
  usageLedger: Array<{
    id: string;
    userId: string;
    operation: string;
    creditCost: number;
    status: string;
    reservationVersion: number;
    reservedAt: string;
    capturedAt: string | null;
    refundedAt: string | null;
  }>;
}

const EXPORT_SCOPE: {
  description: string;
  includedEntities: string[];
  excludedEntities: string[];
} = {
  description:
    "Point-in-time snapshot of all data owned by or attributed to the authenticated user. " +
    "Scoped strictly to the requesting user — no other user's data is ever included.",
  includedEntities: [
    "user profile",
    "owned documents (non-deleted) + visuals + versions",
    "owned workspaces",
    "workspace memberships (non-owner member rows)",
    "authored comments",
    "comment read state",
    "owned tags",
    "owned brands (logo/font asset references — ids only)",
    "owned brand-kit drafts",
    "owned theme-package snapshots",
    "owned assets via documents/workspaces/brands and owner-partitioned brand-staging uploads (display metadata only, not raw file bytes)",
    "active subscription",
    "invite-link uses attributed to the user (without invite tokens)",
    "usage ledger entries attributed to the user",
  ],
  excludedEntities: [
    "soft-deleted documents",
    "other users' documents, comments, or profile data",
    "raw asset file bytes (incl. brand logo/font bytes)",
    "invite-link tokens",
    "Stripe webhook events",
    "operational rate-limit records (erased on account deletion)",
  ],
};

/** Serializes a Date to ISO, preserving null. */
function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

function sanitizeDisplayName(name: string | null): string | null {
  if (!name) return null;
  const sanitized = name
    .replace(/[^\p{L}\p{N}._ -]+/gu, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return sanitized || null;
}

/**
 * Builds a self-contained JSON-serializable snapshot of the user's account and
 * content. Dates are normalized to ISO strings so the output is stable and
 * portable. `now` is injected so the export timestamp is deterministic in tests.
 */
export function buildAccountExport(input: {
  user: ExportUserInput;
  documents: ExportDocumentInput[];
  workspacesOwned: ExportWorkspaceInput[];
  workspaceMemberships: ExportMembershipInput[];
  comments: ExportCommentInput[];
  commentReads: ExportCommentReadInput[];
  tags: ExportTagInput[];
  brands: ExportBrandInput[];
  brandKitDrafts: ExportBrandKitDraftInput[];
  themePackageSnapshots: ExportThemePackageSnapshotInput[];
  assets: ExportAssetInput[];
  subscription: ExportSubscriptionInput | null;
  inviteLinkUses: ExportInviteLinkUseInput[];
  usageLedger: ExportUsageLedgerEntryInput[];
  now: Date;
}): AccountExport {
  const {
    user,
    documents,
    workspacesOwned,
    workspaceMemberships,
    comments,
    commentReads,
    tags,
    brands,
    brandKitDrafts,
    themePackageSnapshots,
    assets,
    subscription,
    inviteLinkUses,
    usageLedger,
    now,
  } = input;

  return {
    exportVersion: ACCOUNT_EXPORT_VERSION,
    exportedAt: now.toISOString(),
    scope: EXPORT_SCOPE,
    manifest: {
      personalDataSections: [...PERSONAL_DATA_EXPORT_SECTIONS],
      assetBytesIncluded: false,
      assetBytesDecision:
        "Raw asset bytes are not embedded in JSON exports; asset display metadata is included for portability without copying protected blobs.",
    },
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      emailVerified: iso(user.emailVerified),
      plan: user.plan,
      createdAt: user.createdAt.toISOString(),
    },
    documents: documents.map((doc) => ({
      id: doc.id,
      title: doc.title,
      content: lexicalStateToPlainText(doc.contentJson),
      contentJson: doc.contentJson ?? null,
      deckJson: doc.deckJson ?? null,
      workspaceId: doc.workspaceId,
      isShared: doc.isShared,
      sharePolicy: {
        expiresAt: iso(doc.sharePolicy.expiresAt),
        embedEnabled: doc.sharePolicy.embedEnabled,
        presentEnabled: doc.sharePolicy.presentEnabled,
        metadataMode: doc.sharePolicy.metadataMode,
        discoverable: doc.sharePolicy.discoverable,
      },
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
      visuals: doc.visuals.map((v) => ({
        id: v.id,
        type: v.type,
        title: v.title,
        anchorBlockId: v.anchorBlockId,
        orderIndex: v.orderIndex,
        data: v.data ?? null,
        createdAt: v.createdAt.toISOString(),
        updatedAt: v.updatedAt.toISOString(),
      })),
      versions: doc.versions.map((ver) => ({
        id: ver.id,
        label: ver.label,
        createdAt: ver.createdAt.toISOString(),
      })),
    })),
    workspacesOwned: workspacesOwned.map((ws) => ({
      id: ws.id,
      name: ws.name,
      createdAt: ws.createdAt.toISOString(),
      updatedAt: ws.updatedAt.toISOString(),
    })),
    workspaceMemberships: workspaceMemberships.map((m) => ({
      id: m.id,
      workspaceId: m.workspaceId,
      role: m.role,
      createdAt: m.createdAt.toISOString(),
    })),
    comments: comments.map((c) => ({
      id: c.id,
      documentId: c.documentId,
      body: c.body,
      resolved: c.resolved,
      parentId: c.parentId,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    })),
    commentReads: commentReads.map((read) => ({
      id: read.id,
      documentId: read.documentId,
      lastReadAt: read.lastReadAt.toISOString(),
    })),
    tags: tags.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    })),
    brands: brands.map((b) => ({
      id: b.id,
      name: b.name,
      logoAssetId: b.logoAssetId ?? null,
      fontAssetId: b.fontAssetId ?? null,
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
    })),
    brandKitDrafts: brandKitDrafts.map((draft) => ({
      id: draft.id,
      slug: draft.slug,
      name: draft.name,
      ownerId: draft.ownerId,
      workspaceId: draft.workspaceId,
      scope: draft.scope,
      scopeKey: draft.scopeKey,
      sourcePresetId: draft.sourcePresetId,
      version: draft.version,
      revisionId: draft.revisionId,
      revisionNumber: draft.revisionNumber,
      draftJson: draft.draftJson ?? null,
      latestPackageId: draft.latestPackageId,
      latestPackageVersion: draft.latestPackageVersion,
      createdAt: draft.createdAt.toISOString(),
      updatedAt: draft.updatedAt.toISOString(),
    })),
    themePackageSnapshots: themePackageSnapshots.map((snapshot) => ({
      id: snapshot.id,
      packageId: snapshot.packageId,
      packageVersion: snapshot.packageVersion,
      draftId: snapshot.draftId,
      ownerId: snapshot.ownerId,
      workspaceId: snapshot.workspaceId,
      publishedById: snapshot.publishedById,
      packageJson: snapshot.packageJson ?? null,
      createdAt: snapshot.createdAt.toISOString(),
    })),
    assets: assets.map((a) => ({
      id: a.id,
      mimeType: a.mimeType,
      byteSize: a.byteSize,
      widthPx: a.widthPx,
      heightPx: a.heightPx,
      checksum: a.checksum,
      displayName: sanitizeDisplayName(a.originalName),
      createdAt: a.createdAt.toISOString(),
    })),
    subscription: subscription
      ? {
          id: subscription.id,
          plan: subscription.plan,
          status: subscription.status,
          currentPeriodStart: subscription.currentPeriodStart.toISOString(),
          currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          createdAt: subscription.createdAt.toISOString(),
          updatedAt: subscription.updatedAt.toISOString(),
        }
      : null,
    inviteLinkUses: inviteLinkUses.map((use) => ({
      id: use.id,
      inviteLinkId: use.inviteLinkId,
      workspaceId: use.workspaceId,
      role: use.role,
      usedAt: use.usedAt.toISOString(),
    })),
    usageLedger: usageLedger.map((entry) => ({
      id: entry.id,
      userId: entry.userId,
      operation: entry.operation,
      creditCost: entry.creditCost,
      status: entry.status,
      reservationVersion: entry.reservationVersion,
      reservedAt: entry.reservedAt.toISOString(),
      capturedAt: iso(entry.capturedAt),
      refundedAt: iso(entry.refundedAt),
    })),
  };
}
