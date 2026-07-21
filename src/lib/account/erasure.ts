import { getBrandStorageAdapter } from "@/lib/brand/asset-storage";
import { getDefaultStorageAdapter } from "@/lib/slides/asset-storage";

type Delegate = {
  count?(args: unknown): Promise<number>;
  findMany?(args: unknown): Promise<unknown[]>;
  deleteMany?(args: unknown): Promise<{ count: number }>;
  delete?(args: unknown): Promise<unknown>;
};

export type AccountErasureClient = {
  user: Delegate;
  document: Delegate;
  documentVersion: Delegate;
  comment: Delegate;
  commentRead: Delegate;
  workspace: Delegate;
  workspaceMember: Delegate;
  tag: Delegate;
  brand: Delegate;
  subscription: Delegate;
  inviteLink: Delegate;
  inviteLinkUse: Delegate;
  usageLedgerEntry: Delegate;
  rateLimitHit: Delegate;
  asset: Delegate;
  $transaction?<T>(fn: (tx: AccountErasureClient) => Promise<T>): Promise<T>;
};

export interface ErasureStorageAdapter {
  delete(storageKey: string): Promise<void>;
}

export interface AccountAssetDeletionTarget {
  id: string;
  /* node:coverage ignore next -- erased nullable field is reported as a source-map gap. */
  storageKey: string | null;
  thumbnailKey: string | null;
  brandId: string | null;
  documentId: string | null;
  workspaceId: string | null;
}

export interface AccountErasureStorage {
  slide: ErasureStorageAdapter;
  brand: ErasureStorageAdapter;
}

export interface AccountErasureFinding {
  model: string;
  count: number;
}

export function defaultAccountErasureStorage(): AccountErasureStorage {
  return {
    slide: getDefaultStorageAdapter(),
    brand: getBrandStorageAdapter(),
  };
}

function delegateCount(delegate: Delegate, args: unknown): Promise<number> {
  if (!delegate.count) {
    throw new Error("Account erasure verifier requires count delegates.");
  }
  return delegate.count(args);
}

function isBrandAsset(asset: AccountAssetDeletionTarget): boolean {
  return asset.brandId !== null && asset.documentId === null;
}

export async function collectAccountAssetDeletionTargets(
  client: AccountErasureClient,
  userId: string,
): Promise<AccountAssetDeletionTarget[]> {
  if (!client.asset.findMany) {
    throw new Error("Account erasure requires asset.findMany.");
  }
  return (await client.asset.findMany({
    where: {
      OR: [
        { document: { ownerId: userId } },
        { workspace: { ownerId: userId } },
        { brand: { ownerId: userId } },
        { storageKey: { startsWith: `${userId}/` } },
      ],
    },
    select: {
      id: true,
      storageKey: true,
      thumbnailKey: true,
      brandId: true,
      documentId: true,
      workspaceId: true,
    },
  })) as AccountAssetDeletionTarget[];
}

export async function deleteAccountAssetStorage(
  assets: readonly AccountAssetDeletionTarget[],
  storage: AccountErasureStorage,
): Promise<void> {
  for (const asset of assets) {
    const adapter = isBrandAsset(asset) ? storage.brand : storage.slide;
    for (const key of [asset.storageKey, asset.thumbnailKey]) {
      if (key) {
        await adapter.delete(key);
      }
    }
  }
}

export async function deleteAccountDatabaseRows(
  client: AccountErasureClient,
  userId: string,
  assetIds: readonly string[],
): Promise<void> {
  const run = async (tx: AccountErasureClient) => {
    await tx.inviteLinkUse.deleteMany?.({ where: { userId } });
    await tx.usageLedgerEntry.deleteMany?.({ where: { userId } });
    await tx.rateLimitHit.deleteMany?.({ where: { subject: userId } });
    await tx.inviteLink.deleteMany?.({ where: { createdById: userId } });
    if (assetIds.length > 0) {
      await tx.asset.deleteMany?.({ where: { id: { in: [...assetIds] } } });
    }
    await tx.user.delete?.({ where: { id: userId } });
  };

  if (client.$transaction) {
    await client.$transaction(run);
  } else {
    await run(client);
  }
}

export async function verifyAccountErasure(
  client: AccountErasureClient,
  userId: string,
): Promise<AccountErasureFinding[]> {
  const checks: Array<[string, Delegate, unknown]> = [
    ["User", client.user, { where: { id: userId } }],
    ["Document", client.document, { where: { ownerId: userId } }],
    [
      "DocumentVersion",
      client.documentVersion,
      { where: { createdById: userId } },
    ],
    ["Comment", client.comment, { where: { authorId: userId } }],
    ["CommentRead", client.commentRead, { where: { userId } }],
    ["Workspace", client.workspace, { where: { ownerId: userId } }],
    ["WorkspaceMember", client.workspaceMember, { where: { userId } }],
    ["Tag", client.tag, { where: { ownerId: userId } }],
    ["Brand", client.brand, { where: { ownerId: userId } }],
    ["Subscription", client.subscription, { where: { userId } }],
    ["InviteLink", client.inviteLink, { where: { createdById: userId } }],
    ["InviteLinkUse", client.inviteLinkUse, { where: { userId } }],
    ["UsageLedgerEntry", client.usageLedgerEntry, { where: { userId } }],
    ["RateLimitHit", client.rateLimitHit, { where: { subject: userId } }],
    [
      "Asset",
      client.asset,
      {
        where: {
          OR: [
            { document: { ownerId: userId } },
            /* node:coverage ignore next 4 */
            { workspace: { ownerId: userId } },
            { brand: { ownerId: userId } },
            { storageKey: { startsWith: `${userId}/` } },
            { thumbnailKey: { startsWith: `${userId}/` } },
          ],
        },
      },
    ],
  ];

  const findings: AccountErasureFinding[] = [];
  for (const [model, delegate, args] of checks) {
    const count = await delegateCount(delegate, args);
    if (count > 0) {
      findings.push({ model, count });
    }
  }
  return findings;
}

export async function eraseAccountPersonalData(input: {
  client: AccountErasureClient;
  userId: string;
  storage?: AccountErasureStorage;
}): Promise<{ deletedAssetCount: number; findings: AccountErasureFinding[] }> {
  const storage = input.storage ?? defaultAccountErasureStorage();
  const assets = await collectAccountAssetDeletionTargets(
    input.client,
    input.userId,
  );
  await deleteAccountDatabaseRows(
    input.client,
    input.userId,
    assets.map((asset) => asset.id),
  );
  await deleteAccountAssetStorage(assets, storage);
  const findings = await verifyAccountErasure(input.client, input.userId);
  return { deletedAssetCount: assets.length, findings };
}
