export type PersonalDataCategory =
  | "user_content"
  | "identifier"
  | "operational_metadata"
  | "billing_metadata"
  | "public_metadata"
  | "security_only"
  | "relation";

export type ErasurePolicy =
  | "delete_with_account"
  | "delete_owned"
  | "delete_attributed"
  | "delete_non_fk_identifier"
  | "not_account_personal_data";

export type ExportSection =
  | "user"
  | "documents"
  | "workspacesOwned"
  | "workspaceMemberships"
  | "comments"
  | "commentReads"
  | "tags"
  | "brands"
  | "assets"
  | "subscription"
  | "inviteLinkUses"
  | "usageLedger";

export interface PersonalDataFieldInventory {
  category: PersonalDataCategory;
  erasure: ErasurePolicy;
  exportSection?: ExportSection;
}

export interface PersonalDataModelInventory {
  model: string;
  fields: Record<string, PersonalDataFieldInventory>;
}

const relation = (): PersonalDataFieldInventory => ({
  category: "relation",
  erasure: "not_account_personal_data",
});

const field = (
  category: PersonalDataCategory,
  erasure: ErasurePolicy,
  exportSection?: ExportSection,
): PersonalDataFieldInventory => ({ category, erasure, exportSection });

export const PERSONAL_DATA_EXPORT_SECTIONS = [
  "user",
  "documents",
  "workspacesOwned",
  "workspaceMemberships",
  "comments",
  "commentReads",
  "tags",
  "brands",
  "assets",
  "subscription",
  "inviteLinkUses",
  "usageLedger",
] as const satisfies readonly ExportSection[];

export const PERSONAL_DATA_INVENTORY = [
  {
    model: "User",
    fields: {
      id: field("identifier", "delete_with_account", "user"),
      email: field("identifier", "delete_with_account", "user"),
      name: field("identifier", "delete_with_account", "user"),
      image: field("identifier", "delete_with_account", "user"),
      passwordHash: field("security_only", "delete_with_account"),
      sessionInvalidatedAt: field("security_only", "delete_with_account"),
      emailVerified: field(
        "operational_metadata",
        "delete_with_account",
        "user",
      ),
      createdAt: field("operational_metadata", "delete_with_account", "user"),
      updatedAt: field("operational_metadata", "delete_with_account"),
      plan: field("billing_metadata", "delete_with_account", "user"),
      creditBalance: field("billing_metadata", "delete_with_account"),
      creditPeriodStart: field("billing_metadata", "delete_with_account"),
      onboardingDismissed: field("operational_metadata", "delete_with_account"),
      documents: relation(),
      ownedWorkspaces: relation(),
      memberships: relation(),
      comments: relation(),
      tags: relation(),
      brands: relation(),
      brandKitDrafts: relation(),
      themePackageSnapshots: relation(),
      publishedThemePackageSnapshots: relation(),
      subscription: relation(),
      passwordResetTokens: relation(),
      emailVerificationTokens: relation(),
      documentVersions: relation(),
      commentReads: relation(),
    },
  },
  {
    model: "EmailVerificationToken",
    fields: {
      id: field("security_only", "delete_with_account"),
      userId: field("identifier", "delete_with_account"),
      tokenHash: field("security_only", "delete_with_account"),
      expiresAt: field("security_only", "delete_with_account"),
      usedAt: field("security_only", "delete_with_account"),
      createdAt: field("security_only", "delete_with_account"),
      user: relation(),
    },
  },
  {
    model: "PasswordResetToken",
    fields: {
      id: field("security_only", "delete_with_account"),
      userId: field("identifier", "delete_with_account"),
      tokenHash: field("security_only", "delete_with_account"),
      expiresAt: field("security_only", "delete_with_account"),
      usedAt: field("security_only", "delete_with_account"),
      createdAt: field("security_only", "delete_with_account"),
      user: relation(),
    },
  },
  {
    model: "Workspace",
    fields: {
      id: field("identifier", "delete_owned", "workspacesOwned"),
      name: field("user_content", "delete_owned", "workspacesOwned"),
      ownerId: field("identifier", "delete_owned", "workspacesOwned"),
      createdAt: field(
        "operational_metadata",
        "delete_owned",
        "workspacesOwned",
      ),
      updatedAt: field(
        "operational_metadata",
        "delete_owned",
        "workspacesOwned",
      ),
      owner: relation(),
      members: relation(),
      documents: relation(),
      assets: relation(),
      inviteLinks: relation(),
      brandKitDrafts: relation(),
      themePackageSnapshots: relation(),
    },
  },
  {
    model: "WorkspaceMember",
    fields: {
      id: field("identifier", "delete_attributed", "workspaceMemberships"),
      workspaceId: field(
        "identifier",
        "delete_attributed",
        "workspaceMemberships",
      ),
      userId: field("identifier", "delete_attributed", "workspaceMemberships"),
      role: field(
        "operational_metadata",
        "delete_attributed",
        "workspaceMemberships",
      ),
      createdAt: field(
        "operational_metadata",
        "delete_attributed",
        "workspaceMemberships",
      ),
      workspace: relation(),
      user: relation(),
    },
  },
  {
    model: "Document",
    fields: {
      id: field("identifier", "delete_owned", "documents"),
      title: field("user_content", "delete_owned", "documents"),
      content: field("user_content", "delete_owned", "documents"),
      contentJson: field("user_content", "delete_owned", "documents"),
      deckJson: field("user_content", "delete_owned", "documents"),
      deckRevisionToken: field("operational_metadata", "delete_owned"),
      ownerId: field("identifier", "delete_owned", "documents"),
      workspaceId: field("identifier", "delete_owned", "documents"),
      shareId: field("public_metadata", "delete_owned", "documents"),
      slug: field("public_metadata", "delete_owned", "documents"),
      isShared: field("public_metadata", "delete_owned", "documents"),
      shareExpiresAt: field("public_metadata", "delete_owned", "documents"),
      shareEmbedEnabled: field("public_metadata", "delete_owned", "documents"),
      sharePresentEnabled: field(
        "public_metadata",
        "delete_owned",
        "documents",
      ),
      shareMetadataMode: field("public_metadata", "delete_owned", "documents"),
      shareDiscoverable: field("public_metadata", "delete_owned", "documents"),
      sharePasscodeHash: field("security_only", "delete_owned"),
      favorite: field("operational_metadata", "delete_owned"),
      createdAt: field("operational_metadata", "delete_owned", "documents"),
      updatedAt: field("operational_metadata", "delete_owned", "documents"),
      deletedAt: field("operational_metadata", "delete_owned"),
      collabRecoverySnapshot: field("user_content", "delete_owned"),
      collabRecoverySavedAt: field("operational_metadata", "delete_owned"),
      owner: relation(),
      workspace: relation(),
      visuals: relation(),
      comments: relation(),
      tags: relation(),
      versions: relation(),
      commentReads: relation(),
      assets: relation(),
    },
  },
  {
    model: "Tag",
    fields: {
      id: field("identifier", "delete_owned", "tags"),
      name: field("user_content", "delete_owned", "tags"),
      slug: field("user_content", "delete_owned", "tags"),
      ownerId: field("identifier", "delete_owned", "tags"),
      createdAt: field("operational_metadata", "delete_owned", "tags"),
      updatedAt: field("operational_metadata", "delete_owned", "tags"),
      owner: relation(),
      documents: relation(),
    },
  },
  {
    model: "Visual",
    fields: {
      id: field("identifier", "delete_owned", "documents"),
      documentId: field("identifier", "delete_owned", "documents"),
      anchorBlockId: field("user_content", "delete_owned", "documents"),
      orderIndex: field("operational_metadata", "delete_owned", "documents"),
      type: field("user_content", "delete_owned", "documents"),
      title: field("user_content", "delete_owned", "documents"),
      data: field("user_content", "delete_owned", "documents"),
      createdAt: field("operational_metadata", "delete_owned", "documents"),
      updatedAt: field("operational_metadata", "delete_owned", "documents"),
      document: relation(),
      revisions: relation(),
    },
  },
  {
    model: "VisualRevision",
    fields: {
      id: field("identifier", "delete_owned", "documents"),
      visualId: field("identifier", "delete_owned", "documents"),
      data: field("user_content", "delete_owned", "documents"),
      type: field("user_content", "delete_owned", "documents"),
      title: field("user_content", "delete_owned", "documents"),
      createdAt: field("operational_metadata", "delete_owned", "documents"),
      visual: relation(),
    },
  },
  {
    model: "DocumentVersion",
    fields: {
      id: field("identifier", "delete_owned", "documents"),
      documentId: field("identifier", "delete_owned", "documents"),
      contentJson: field("user_content", "delete_owned", "documents"),
      deckJson: field("user_content", "delete_owned", "documents"),
      label: field("user_content", "delete_owned", "documents"),
      createdById: field("identifier", "delete_attributed", "documents"),
      createdAt: field("operational_metadata", "delete_owned", "documents"),
      document: relation(),
      createdBy: relation(),
    },
  },
  {
    model: "Comment",
    fields: {
      id: field("identifier", "delete_attributed", "comments"),
      documentId: field("identifier", "delete_attributed", "comments"),
      authorId: field("identifier", "delete_attributed", "comments"),
      body: field("user_content", "delete_attributed", "comments"),
      resolved: field("operational_metadata", "delete_attributed", "comments"),
      parentId: field("identifier", "delete_attributed", "comments"),
      anchorType: field("user_content", "delete_attributed", "comments"),
      anchorText: field("user_content", "delete_attributed", "comments"),
      anchorNodeId: field("user_content", "delete_attributed", "comments"),
      slideId: field("identifier", "delete_attributed", "comments"),
      elementId: field("identifier", "delete_attributed", "comments"),
      anchorGeometry: field("user_content", "delete_attributed", "comments"),
      createdAt: field("operational_metadata", "delete_attributed", "comments"),
      updatedAt: field("operational_metadata", "delete_attributed", "comments"),
      document: relation(),
      author: relation(),
      parent: relation(),
      replies: relation(),
    },
  },
  {
    model: "CommentRead",
    fields: {
      id: field("identifier", "delete_attributed", "commentReads"),
      userId: field("identifier", "delete_attributed", "commentReads"),
      documentId: field("identifier", "delete_attributed", "commentReads"),
      lastReadAt: field(
        "operational_metadata",
        "delete_attributed",
        "commentReads",
      ),
      user: relation(),
      document: relation(),
    },
  },
  {
    model: "InviteLink",
    fields: {
      id: field("identifier", "delete_attributed"),
      workspaceId: field("identifier", "delete_owned"),
      token: field("security_only", "delete_owned"),
      role: field("operational_metadata", "delete_owned"),
      isRevoked: field("operational_metadata", "delete_owned"),
      expiresAt: field("operational_metadata", "delete_owned"),
      maxUses: field("operational_metadata", "delete_owned"),
      useCount: field("operational_metadata", "delete_owned"),
      createdById: field("identifier", "delete_attributed"),
      createdAt: field("operational_metadata", "delete_owned"),
      workspace: relation(),
      uses: relation(),
    },
  },
  {
    model: "InviteLinkUse",
    fields: {
      id: field("identifier", "delete_non_fk_identifier", "inviteLinkUses"),
      inviteLinkId: field(
        "identifier",
        "delete_non_fk_identifier",
        "inviteLinkUses",
      ),
      userId: field("identifier", "delete_non_fk_identifier", "inviteLinkUses"),
      role: field(
        "operational_metadata",
        "delete_non_fk_identifier",
        "inviteLinkUses",
      ),
      usedAt: field(
        "operational_metadata",
        "delete_non_fk_identifier",
        "inviteLinkUses",
      ),
      inviteLink: relation(),
    },
  },
  {
    model: "RateLimitHit",
    fields: {
      subject: field("identifier", "delete_non_fk_identifier"),
      count: field("operational_metadata", "delete_non_fk_identifier"),
      resetAt: field("operational_metadata", "delete_non_fk_identifier"),
      updatedAt: field("operational_metadata", "delete_non_fk_identifier"),
    },
  },
  {
    model: "Brand",
    fields: {
      id: field("identifier", "delete_owned", "brands"),
      name: field("user_content", "delete_owned", "brands"),
      ownerId: field("identifier", "delete_owned", "brands"),
      palette: field("user_content", "delete_owned", "brands"),
      background: field("user_content", "delete_owned", "brands"),
      nodeFill: field("user_content", "delete_owned", "brands"),
      nodeStroke: field("user_content", "delete_owned", "brands"),
      nodeText: field("user_content", "delete_owned", "brands"),
      edgeColor: field("user_content", "delete_owned", "brands"),
      fontFamily: field("user_content", "delete_owned", "brands"),
      logoAssetId: field("identifier", "delete_owned", "brands"),
      fontAssetId: field("identifier", "delete_owned", "brands"),
      createdAt: field("operational_metadata", "delete_owned", "brands"),
      updatedAt: field("operational_metadata", "delete_owned", "brands"),
      owner: relation(),
      assets: relation(),
    },
  },
  {
    model: "BrandKitDraft",
    fields: {
      id: field("identifier", "delete_owned"),
      slug: field("user_content", "delete_owned"),
      name: field("user_content", "delete_owned"),
      ownerId: field("identifier", "delete_owned"),
      workspaceId: field("identifier", "delete_owned"),
      scope: field("operational_metadata", "delete_owned"),
      scopeKey: field("identifier", "delete_owned"),
      sourcePresetId: field("operational_metadata", "delete_owned"),
      version: field("operational_metadata", "delete_owned"),
      revisionId: field("identifier", "delete_owned"),
      revisionNumber: field("operational_metadata", "delete_owned"),
      draftJson: field("user_content", "delete_owned"),
      latestPackageId: field("identifier", "delete_owned"),
      latestPackageVersion: field("operational_metadata", "delete_owned"),
      createdAt: field("operational_metadata", "delete_owned"),
      updatedAt: field("operational_metadata", "delete_owned"),
      owner: relation(),
      workspace: relation(),
      snapshots: relation(),
    },
  },
  {
    model: "ThemePackageSnapshot",
    fields: {
      id: field("identifier", "delete_owned"),
      packageId: field("identifier", "delete_owned"),
      packageVersion: field("operational_metadata", "delete_owned"),
      draftId: field("identifier", "delete_owned"),
      ownerId: field("identifier", "delete_owned"),
      workspaceId: field("identifier", "delete_owned"),
      publishedById: field("identifier", "delete_attributed"),
      packageJson: field("user_content", "delete_owned"),
      createdAt: field("operational_metadata", "delete_owned"),
      draft: relation(),
      owner: relation(),
      workspace: relation(),
      publishedBy: relation(),
    },
  },
  {
    model: "Subscription",
    fields: {
      id: field("identifier", "delete_with_account", "subscription"),
      userId: field("identifier", "delete_with_account", "subscription"),
      plan: field("billing_metadata", "delete_with_account", "subscription"),
      status: field("billing_metadata", "delete_with_account", "subscription"),
      stripeCustomerId: field(
        "billing_metadata",
        "delete_with_account",
        "subscription",
      ),
      stripeSubscriptionId: field(
        /* Coverage rationale: static personal-data inventory entries are asserted; tsx maps repeated literal tails as uncovered. */
        /* node:coverage ignore next 4 */
        "billing_metadata",
        "delete_with_account",
        "subscription",
      ),
      currentPeriodStart: field(
        "billing_metadata",
        "delete_with_account",
        "subscription",
      ),
      currentPeriodEnd: field(
        "billing_metadata",
        "delete_with_account",
        "subscription",
      ),
      cancelAtPeriodEnd: field(
        "billing_metadata",
        "delete_with_account",
        "subscription",
      ),
      createdAt: field(
        "operational_metadata",
        "delete_with_account",
        "subscription",
      ),
      updatedAt: field(
        "operational_metadata",
        "delete_with_account",
        "subscription",
      ),
      user: relation(),
    },
  },
  {
    model: "StripeWebhookEvent",
    fields: {
      id: field("security_only", "not_account_personal_data"),
      type: field("security_only", "not_account_personal_data"),
      createdAt: field("security_only", "not_account_personal_data"),
    },
  },
  {
    model: "Asset",
    fields: {
      id: field("identifier", "delete_owned", "assets"),
      documentId: field("identifier", "delete_owned", "assets"),
      workspaceId: field("identifier", "delete_owned", "assets"),
      brandId: field("identifier", "delete_owned", "assets"),
      mimeType: field("operational_metadata", "delete_owned", "assets"),
      byteSize: field("operational_metadata", "delete_owned", "assets"),
      widthPx: field("operational_metadata", "delete_owned", "assets"),
      heightPx: field("operational_metadata", "delete_owned", "assets"),
      checksum: field("operational_metadata", "delete_owned", "assets"),
      storageKey: field("identifier", "delete_owned"),
      thumbnailKey: field("identifier", "delete_owned"),
      originalName: field("user_content", "delete_owned", "assets"),
      createdAt: field("operational_metadata", "delete_owned", "assets"),
      deletedAt: field("operational_metadata", "delete_owned"),
      document: relation(),
      workspace: relation(),
      brand: relation(),
    },
  },
  {
    model: "UsageLedgerEntry",
    fields: {
      id: field("identifier", "delete_non_fk_identifier", "usageLedger"),
      keyHash: field("identifier", "delete_non_fk_identifier"),
      keyHashVersion: field("billing_metadata", "delete_non_fk_identifier"),
      userId: field("identifier", "delete_non_fk_identifier", "usageLedger"),
      operation: field(
        "billing_metadata",
        "delete_non_fk_identifier",
        "usageLedger",
      ),
      creditCost: field(
        "billing_metadata",
        "delete_non_fk_identifier",
        "usageLedger",
      ),
      status: field(
        "billing_metadata",
        "delete_non_fk_identifier",
        "usageLedger",
      ),
      reservationVersion: field(
        "billing_metadata",
        "delete_non_fk_identifier",
        "usageLedger",
      ),
      reservedAt: field(
        "billing_metadata",
        "delete_non_fk_identifier",
        "usageLedger",
      ),
      capturedAt: field(
        "billing_metadata",
        "delete_non_fk_identifier",
        "usageLedger",
      ),
      refundedAt: field(
        "billing_metadata",
        "delete_non_fk_identifier",
        "usageLedger",
      ),
    },
  },
] as const satisfies readonly PersonalDataModelInventory[];

export function inventoryExportSections(): ExportSection[] {
  return Array.from(
    new Set(
      PERSONAL_DATA_INVENTORY.flatMap((model) =>
        Object.values(model.fields).flatMap((entry) =>
          entry.exportSection ? [entry.exportSection] : [],
        ),
      ),
    ),
  ).sort();
}
