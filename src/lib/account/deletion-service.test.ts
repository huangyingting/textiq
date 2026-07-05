import assert from "node:assert/strict";
import test from "node:test";

import { deleteAccountForUser } from "@/lib/account/deletion-service";
import type { BillingProvider } from "@/lib/billing/provider";
import type { prisma } from "@/lib/prisma";

function makeClient(email: string | null) {
  const deleted: string[] = [];
  const deletedDelegates: string[] = [];
  const invalidations: Array<{ id: string; sessionInvalidatedAt: Date }> = [];
  const countDelegate = () => ({ count: async () => 0 });
  const deleteManyDelegate = (name: string) => ({
    count: async () => 0,
    deleteMany: async () => {
      deletedDelegates.push(name);
      return { count: 1 };
    },
  });
  const client: {
    _deleted: string[];
    _deletedDelegates: string[];
    $transaction?: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
    [key: string]: unknown;
  } = {
    user: {
      findUnique() {
        return Promise.resolve(email ? { email } : null);
      },
      count: async () => 0,
      update({
        where,
        data,
      }: {
        where: { id: string };
        data: { sessionInvalidatedAt: Date };
      }) {
        invalidations.push({
          id: where.id,
          sessionInvalidatedAt: data.sessionInvalidatedAt,
        });
        return Promise.resolve({ id: where.id, ...data });
      },
      delete({ where }: { where: { id: string } }) {
        deleted.push(where.id);
        return Promise.resolve({ id: where.id });
      },
    },
    document: countDelegate(),
    documentVersion: countDelegate(),
    comment: countDelegate(),
    commentRead: countDelegate(),
    workspace: countDelegate(),
    workspaceMember: countDelegate(),
    tag: countDelegate(),
    brand: countDelegate(),
    subscription: countDelegate(),
    inviteLink: deleteManyDelegate("inviteLink"),
    inviteLinkUse: deleteManyDelegate("inviteLinkUse"),
    usageLedgerEntry: deleteManyDelegate("usageLedgerEntry"),
    rateLimitHit: deleteManyDelegate("rateLimitHit"),
    asset: {
      count: async () => 0,
      findMany: async () => [],
      deleteMany: async () => ({ count: 0 }),
    },
    _deleted: deleted,
    _deletedDelegates: deletedDelegates,
    _invalidations: invalidations,
  };
  client.$transaction = async (fn: (tx: unknown) => Promise<unknown>) =>
    fn(client);
  return client as unknown as typeof prisma & {
    _deleted: string[];
    _deletedDelegates: string[];
    _invalidations: Array<{ id: string; sessionInvalidatedAt: Date }>;
  };
}

function makeBillingProvider(
  calls: string[],
  shouldThrow = false,
): BillingProvider {
  return {
    async changePlan() {
      throw new Error("not used");
    },
    async cancelSubscription() {
      throw new Error("not used");
    },
    async cancelSubscriptionImmediately(userId: string) {
      calls.push(userId);
      if (shouldThrow) {
        throw new Error("stripe down");
      }
    },
  };
}

test("deleteAccountForUser validates confirmation before deleting", async () => {
  const client = makeClient("ada@example.com");

  const result = await deleteAccountForUser(
    { userId: "u1", confirmation: "wrong" },
    { client },
  );

  assert.deepEqual(result, {
    ok: false,
    error: 'Type your email or "DELETE" to confirm.',
  });
  assert.deepEqual(client._deleted, []);
});

test("deleteAccountForUser fails closed when the user row is unavailable", async () => {
  const client = makeClient(null);

  const result = await deleteAccountForUser(
    { userId: "missing-user", confirmation: "DELETE" },
    { client },
  );

  assert.deepEqual(result, {
    ok: false,
    error: "Could not delete your account. Please try again.",
  });
  assert.deepEqual(client._deleted, []);
});

test("deleteAccountForUser attempts billing cancellation and still deletes if cancellation fails", async () => {
  const client = makeClient("ada@example.com");
  const cancelCalls: string[] = [];
  const logs: string[] = [];
  const audits: Array<{ event: string; context: Record<string, unknown> }> = [];

  const result = await deleteAccountForUser(
    { userId: "u1", confirmation: "ADA@example.com" },
    {
      client,
      getCancellationState: async () => ({
        stripeSubscriptionId: "sub_123",
        status: "active",
      }),
      getProvider: async () => makeBillingProvider(cancelCalls, true),
      log(scope) {
        logs.push(scope);
      },
      audit(event, context) {
        audits.push({ event, context: context ?? {} });
      },
    },
  );

  assert.deepEqual(result, { ok: true, data: undefined });
  assert.deepEqual(cancelCalls, ["u1"]);
  assert.deepEqual(logs, ["billing.subscription.cancel_immediate"]);
  assert.deepEqual(audits[0], {
    event: "account.deletion.billing_reconciliation_required",
    context: {
      userId: "u1",
      subscriptionId: "sub_123",
      status: "active",
      reason: "stripe-cancellation-failed",
      outcome: "failed",
    },
  });
  assert.deepEqual(client._deleted, ["u1"]);
  assert.equal(client._invalidations.length, 1);
  assert.equal(client._invalidations[0].id, "u1");
  assert.equal(
    client._invalidations[0].sessionInvalidatedAt instanceof Date,
    true,
  );
  assert.deepEqual(client._deletedDelegates, [
    "inviteLinkUse",
    "usageLedgerEntry",
    "rateLimitHit",
    "inviteLink",
  ]);
});

test("deleteAccountForUser skips billing cancellation for terminal subscriptions", async () => {
  const client = makeClient("ada@example.com");
  const cancelCalls: string[] = [];

  const result = await deleteAccountForUser(
    { userId: "u1", confirmation: "DELETE" },
    {
      client,
      getCancellationState: async () => ({
        stripeSubscriptionId: "sub_123",
        status: "cancelled",
      }),
      getProvider: async () => makeBillingProvider(cancelCalls),
      audit() {},
    },
  );

  assert.deepEqual(result, { ok: true, data: undefined });
  assert.deepEqual(cancelCalls, []);
  assert.deepEqual(client._deleted, ["u1"]);
});

test("deleteAccountForUser fails closed when erasure verification finds residual data", async () => {
  const client = makeClient("ada@example.com");
  Object.assign(client.comment, { count: async () => 1 });
  const audits: Array<{ event: string; context: Record<string, unknown> }> = [];

  const result = await deleteAccountForUser(
    { userId: "u1", confirmation: "DELETE" },
    {
      client,
      getCancellationState: async () => null,
      audit(event, context) {
        audits.push({ event, context: context ?? {} });
      },
      log() {},
    },
  );

  assert.equal(result.ok, false);
  assert.equal(
    audits.at(-1)?.event,
    "account.deletion.erasure_verification_failed",
  );
});

test("deleteAccountForUser fails closed when deletion dependencies throw", async () => {
  const client = makeClient("ada@example.com");

  const result = await deleteAccountForUser(
    { userId: "u1", confirmation: "DELETE" },
    {
      client,
      getCancellationState: async () => {
        throw new Error("subscription lookup unavailable");
      },
    },
  );

  assert.deepEqual(result, {
    ok: false,
    error: "Could not delete your account. Please try again.",
  });
  assert.deepEqual(client._deleted, []);
});
