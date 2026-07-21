import assert from "node:assert/strict";
import test from "node:test";

import {
  collectAccountAssetDeletionTargets,
  deleteAccountDatabaseRows,
  deleteAccountAssetStorage,
  eraseAccountPersonalData,
  verifyAccountErasure,
  type AccountAssetDeletionTarget,
  type AccountErasureClient,
} from "@/lib/account/erasure";

function clientWithCounts(
  counts: Record<string, number>,
): AccountErasureClient {
  const delegate = (model: string) => ({
    count: async () => counts[model] ?? 0,
  });
  return {
    user: delegate("User"),
    document: delegate("Document"),
    documentVersion: delegate("DocumentVersion"),
    comment: delegate("Comment"),
    commentRead: delegate("CommentRead"),
    workspace: delegate("Workspace"),
    workspaceMember: delegate("WorkspaceMember"),
    tag: delegate("Tag"),
    brand: delegate("Brand"),
    subscription: delegate("Subscription"),
    inviteLink: delegate("InviteLink"),
    inviteLinkUse: delegate("InviteLinkUse"),
    usageLedgerEntry: delegate("UsageLedgerEntry"),
    rateLimitHit: delegate("RateLimitHit"),
    asset: delegate("Asset"),
  };
}

test("verifyAccountErasure reports residual inventoried personal data", async () => {
  const findings = await verifyAccountErasure(
    clientWithCounts({ Comment: 2, RateLimitHit: 1 }),
    "user_1",
  );

  assert.deepEqual(findings, [
    { model: "Comment", count: 2 },
    { model: "RateLimitHit", count: 1 },
  ]);
});

test("deleteAccountAssetStorage purges slide and brand storage keys", async () => {
  const assets: AccountAssetDeletionTarget[] = [
    {
      id: "slide_asset",
      storageKey: "doc/file.png",
      thumbnailKey: "doc/thumb.png",
      brandId: null,
      documentId: "doc_1",
      workspaceId: null,
    },
    {
      id: "brand_asset",
      storageKey: "user/logo.png",
      thumbnailKey: null,
      brandId: "brand_1",
      documentId: null,
      workspaceId: null,
    },
  ];
  const deleted: string[] = [];

  await deleteAccountAssetStorage(assets, {
    slide: {
      delete: async (key) => {
        deleted.push(`slide:${key}`);
      },
    },
    brand: {
      delete: async (key) => {
        deleted.push(`brand:${key}`);
      },
    },
  });

  assert.deepEqual(deleted, [
    "slide:doc/file.png",
    "slide:doc/thumb.png",
    "brand:user/logo.png",
  ]);
});

test("collectAccountAssetDeletionTargets queries all account-owned asset links", async () => {
  let receivedArgs: unknown;
  const asset: AccountAssetDeletionTarget = {
    id: "asset_1",
    storageKey: "user/file.png",
    thumbnailKey: null,
    brandId: null,
    documentId: "doc_1",
    workspaceId: null,
  };
  const client = clientWithCounts({});
  client.asset.findMany = async (args) => {
    receivedArgs = args;
    return [asset];
  };

  assert.deepEqual(await collectAccountAssetDeletionTargets(client, "user_1"), [
    asset,
  ]);
  assert.deepEqual(receivedArgs, {
    where: {
      OR: [
        { document: { ownerId: "user_1" } },
        { workspace: { ownerId: "user_1" } },
        { brand: { ownerId: "user_1" } },
        { storageKey: { startsWith: "user_1/" } },
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
  });
});

test("collectAccountAssetDeletionTargets requires an asset findMany delegate", async () => {
  const client = clientWithCounts({});
  delete client.asset.findMany;

  await assert.rejects(
    () => collectAccountAssetDeletionTargets(client, "user_1"),
    /requires asset\.findMany/,
  );
});

test("verifyAccountErasure requires count delegates for every inventoried model", async () => {
  const client = clientWithCounts({});
  delete client.comment.count;

  await assert.rejects(
    () => verifyAccountErasure(client, "user_1"),
    /requires count delegates/,
  );
});

test("verifyAccountErasure checks storage and thumbnail user-key asset leftovers", async () => {
  let assetCountArgs: unknown;
  const client = clientWithCounts({});
  client.asset.count = async (args) => {
    assetCountArgs = args;
    return 0;
  };

  await verifyAccountErasure(client, "user_1");

  assert.deepEqual(assetCountArgs, {
    where: {
      OR: [
        { document: { ownerId: "user_1" } },
        { workspace: { ownerId: "user_1" } },
        { brand: { ownerId: "user_1" } },
        { storageKey: { startsWith: "user_1/" } },
        { thumbnailKey: { startsWith: "user_1/" } },
      ],
    },
  });
});

test("deleteAccountDatabaseRows deletes related rows inside a transaction", async () => {
  const calls: string[] = [];
  const client = clientWithCounts({});
  client.inviteLinkUse.deleteMany = async (args) => {
    calls.push(`inviteLinkUse:${JSON.stringify(args)}`);
    return { count: 1 };
  };
  client.usageLedgerEntry.deleteMany = async () => {
    calls.push("usageLedgerEntry");
    return { count: 1 };
  };
  client.rateLimitHit.deleteMany = async () => {
    calls.push("rateLimitHit");
    return { count: 1 };
  };
  client.inviteLink.deleteMany = async () => {
    calls.push("inviteLink");
    return { count: 1 };
  };
  client.asset.deleteMany = async (args) => {
    calls.push(`asset:${JSON.stringify(args)}`);
    return { count: 2 };
  };
  client.user.delete = async (args) => {
    calls.push(`user:${JSON.stringify(args)}`);
    return {};
  };
  client.$transaction = async (run) => {
    calls.push("transaction:start");
    const result = await run(client);
    calls.push("transaction:end");
    return result;
  };

  await deleteAccountDatabaseRows(client, "user_1", ["asset_1", "asset_2"]);

  assert.deepEqual(calls, [
    "transaction:start",
    'inviteLinkUse:{"where":{"userId":"user_1"}}',
    "usageLedgerEntry",
    "rateLimitHit",
    "inviteLink",
    'asset:{"where":{"id":{"in":["asset_1","asset_2"]}}}',
    'user:{"where":{"id":"user_1"}}',
    "transaction:end",
  ]);
});

test("eraseAccountPersonalData deletes asset bytes, rows, and verifies leftovers", async () => {
  const deleted: string[] = [];
  const calls: string[] = [];
  const client = clientWithCounts({ Subscription: 1 });
  client.asset.findMany = async () => [
    {
      id: "asset_1",
      storageKey: "user/file.png",
      thumbnailKey: null,
      brandId: null,
      documentId: "doc_1",
      workspaceId: null,
    },
  ];
  client.inviteLinkUse.deleteMany = async () => ({ count: 0 });
  client.usageLedgerEntry.deleteMany = async () => ({ count: 0 });
  client.rateLimitHit.deleteMany = async () => ({ count: 0 });
  client.inviteLink.deleteMany = async () => ({ count: 0 });
  client.asset.deleteMany = async () => {
    calls.push("asset.deleteMany");
    return { count: 1 };
  };
  client.user.delete = async () => {
    calls.push("user.delete");
    return {};
  };

  const result = await eraseAccountPersonalData({
    client,
    userId: "user_1",
    storage: {
      slide: {
        delete: async (key) => {
          calls.push(`slide.delete:${key}`);
          deleted.push(`slide:${key}`);
        },
      },
      brand: {
        delete: async (key) => {
          deleted.push(`brand:${key}`);
        },
      },
    },
  });

  assert.deepEqual(deleted, ["slide:user/file.png"]);
  assert.deepEqual(calls, [
    "asset.deleteMany",
    "user.delete",
    "slide.delete:user/file.png",
  ]);
  assert.deepEqual(result, {
    deletedAssetCount: 1,
    findings: [{ model: "Subscription", count: 1 }],
  });
});

test("eraseAccountPersonalData does not delete asset bytes when database erasure fails", async () => {
  const deleted: string[] = [];
  const client = clientWithCounts({});
  client.asset.findMany = async () => [
    {
      id: "asset_1",
      storageKey: "user/file.png",
      thumbnailKey: null,
      brandId: null,
      documentId: "doc_1",
      workspaceId: null,
    },
  ];
  client.inviteLinkUse.deleteMany = async () => ({ count: 0 });
  client.usageLedgerEntry.deleteMany = async () => ({ count: 0 });
  client.rateLimitHit.deleteMany = async () => ({ count: 0 });
  client.inviteLink.deleteMany = async () => ({ count: 0 });
  client.asset.deleteMany = async () => {
    throw new Error("db erasure failed");
  };
  client.user.delete = async () => ({});

  await assert.rejects(
    () =>
      eraseAccountPersonalData({
        client,
        userId: "user_1",
        storage: {
          slide: {
            delete: async (key) => {
              deleted.push(`slide:${key}`);
            },
          },
          brand: {
            delete: async (key) => {
              deleted.push(`brand:${key}`);
            },
          },
        },
      }),
    /db erasure failed/,
  );

  assert.deepEqual(deleted, []);
});
