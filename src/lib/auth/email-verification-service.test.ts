import assert from "node:assert/strict";
import test from "node:test";

import { configureAuthEmailDeliveryPort } from "@/lib/auth/email";
import {
  consumeEmailVerificationToken,
  requestEmailVerificationForUser,
} from "@/lib/auth/email-verification-service";
import {
  VERIFICATION_TOKEN_REJECTION_MESSAGE,
  hashVerificationToken,
} from "@/lib/auth/verification-token";
import type { prisma } from "@/lib/prisma";

type PrismaClient = typeof prisma;

function asPrismaClient<T extends object>(client: T): T & PrismaClient {
  return client as T & PrismaClient;
}

function makeVerificationClient(rawToken: string) {
  const token = {
    id: "evt_1",
    userId: "u1",
    tokenHash: hashVerificationToken(rawToken),
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null as Date | null,
  };
  const verifiedAt: Date[] = [];
  const client = asPrismaClient({
    user: {
      update({
        where,
        data,
      }: {
        where: { id: string };
        data: { emailVerified: Date };
      }) {
        assert.equal(where.id, "u1");
        verifiedAt.push(data.emailVerified);
        return Promise.resolve({ id: where.id, ...data });
      },
    },
    emailVerificationToken: {
      findUnique({ where }: { where: { tokenHash: string } }) {
        return Promise.resolve(
          where.tokenHash === token.tokenHash ? token : null,
        );
      },
      updateMany({
        where,
        data,
      }: {
        where: {
          id?: string | { not: string };
          userId?: string;
          usedAt?: null;
          expiresAt?: { gt: Date };
        };
        data: { usedAt: Date };
      }) {
        if (where.id === token.id) {
          const canConsume =
            token.usedAt === null &&
            (!where.expiresAt || token.expiresAt > where.expiresAt.gt);
          if (canConsume) {
            token.usedAt = data.usedAt;
            return Promise.resolve({ count: 1 });
          }
          return Promise.resolve({ count: 0 });
        }
        return Promise.resolve({ count: 0 });
      },
    },
    $transaction<T>(fn: (tx: unknown) => Promise<T>) {
      return fn(client);
    },
    _verifiedAt: verifiedAt,
  });
  return client;
}

test("consumeEmailVerificationToken allows exactly one concurrent consumer", async () => {
  const client = makeVerificationClient("raw-verification-token");
  const originalInfo = console.info;
  console.info = () => {};

  let results: Array<
    Awaited<ReturnType<typeof consumeEmailVerificationToken>>
  > = [];
  try {
    results = await Promise.all([
      consumeEmailVerificationToken("raw-verification-token", client),
      consumeEmailVerificationToken("raw-verification-token", client),
    ]);
  } finally {
    console.info = originalInfo;
  }

  assert.equal(
    results.filter((result) => result.status === "verified").length,
    1,
  );
  assert.equal(
    results.filter(
      (result) =>
        result.status === "error" &&
        result.message === VERIFICATION_TOKEN_REJECTION_MESSAGE.used,
    ).length,
    1,
  );
  assert.equal(client._verifiedAt.length, 1);
});

test("consumeEmailVerificationToken verifies a valid token and revokes sibling tokens", async () => {
  const client = makeVerificationClient("raw-verification-token");
  const originalInfo = console.info;
  console.info = () => {};

  try {
    const result = await consumeEmailVerificationToken(
      "raw-verification-token",
      client,
    );
    assert.deepEqual(result, { status: "verified" });
    assert.equal(client._verifiedAt.length, 1);
  } finally {
    console.info = originalInfo;
  }
});

test("consumeEmailVerificationToken rejects when the atomic consume loses the race", async () => {
  const rawToken = "race-loser-token";
  const client = asPrismaClient({
    emailVerificationToken: {
      findUnique: async () => ({
        id: "evt_1",
        userId: "u1",
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
      }),
    },
    $transaction: async () => false,
  });
  const originalInfo = console.info;
  console.info = () => {};

  try {
    assert.deepEqual(await consumeEmailVerificationToken(rawToken, client), {
      status: "error",
      message: VERIFICATION_TOKEN_REJECTION_MESSAGE.used,
    });
  } finally {
    console.info = originalInfo;
  }
});

test("requestEmailVerificationForUser handles missing and already-verified users", async () => {
  const originalInfo = console.info;
  console.info = () => {};
  try {
    const missingClient = asPrismaClient({
      user: {
        findUnique: async () => null,
      },
    });
    assert.deepEqual(
      await requestEmailVerificationForUser("missing-user", missingClient),
      {
        ok: false,
        error: "Could not send a verification email. Please try again.",
      },
    );

    const verifiedClient = asPrismaClient({
      user: {
        findUnique: async () => ({
          email: "verified@example.com",
          emailVerified: new Date("2026-01-01T00:00:00Z"),
        }),
      },
    });
    const result = await requestEmailVerificationForUser(
      "verified-user",
      verifiedClient,
    );
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { status: "already_verified" });
  } finally {
    console.info = originalInfo;
  }
});

test("requestEmailVerificationForUser returns a generic error when storage fails", async () => {
  const client = asPrismaClient({
    user: {
      findUnique: async () => ({
        email: "person@example.com",
        emailVerified: null,
      }),
    },
    emailVerificationToken: {
      updateMany: () => Promise.resolve({ count: 1 }),
      create: () => Promise.resolve({ id: "evt_new" }),
    },
    $transaction: async () => {
      throw new Error("database unavailable");
    },
  });
  const originalError = console.error;
  console.error = () => {};

  try {
    assert.deepEqual(await requestEmailVerificationForUser("user_1", client), {
      ok: false,
      error: "Could not send a verification email. Please try again.",
    });
  } finally {
    console.error = originalError;
  }
});

test("requestEmailVerificationForUser revokes old tokens, creates a new token, and sends email", async () => {
  const sentMessages: unknown[] = [];
  const transactionOps: unknown[] = [];
  configureAuthEmailDeliveryPort({
    async send(message) {
      sentMessages.push(message);
    },
  });
  const client = asPrismaClient({
    user: {
      findUnique: async () => ({
        email: "person@example.com",
        emailVerified: null,
      }),
    },
    emailVerificationToken: {
      updateMany: (args: unknown) => {
        transactionOps.push(args);
        return Promise.resolve({ count: 1 });
      },
      create: (args: unknown) => {
        transactionOps.push(args);
        return Promise.resolve({ id: "evt_new" });
      },
    },
    $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops),
  });

  const originalInfo = console.info;
  console.info = () => {};
  try {
    const result = await requestEmailVerificationForUser("user_1", client);
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { status: "sent" });
    assert.equal(transactionOps.length, 2);
    assert.equal(sentMessages.length, 1);
    assert.match(JSON.stringify(sentMessages[0]), /person@example\.com/);
  } finally {
    console.info = originalInfo;
    configureAuthEmailDeliveryPort(null);
  }
});

test("consumeEmailVerificationToken rejects empty, missing, expired, and used tokens", async () => {
  assert.deepEqual(
    await consumeEmailVerificationToken("", asPrismaClient({})),
    {
      status: "error",
      message: VERIFICATION_TOKEN_REJECTION_MESSAGE.not_found,
    },
  );

  const rawToken = "rejected-token";
  const clientForRecord = (
    record: {
      id: string;
      userId: string;
      expiresAt: Date;
      usedAt: Date | null;
    } | null,
  ) =>
    asPrismaClient({
      emailVerificationToken: {
        findUnique: async () => record,
      },
    });

  assert.deepEqual(
    await consumeEmailVerificationToken(rawToken, clientForRecord(null)),
    {
      status: "error",
      message: VERIFICATION_TOKEN_REJECTION_MESSAGE.not_found,
    },
  );
  assert.deepEqual(
    await consumeEmailVerificationToken(
      rawToken,
      clientForRecord({
        id: "evt_expired",
        userId: "user_1",
        expiresAt: new Date(Date.now() - 1_000),
        usedAt: null,
      }),
    ),
    {
      status: "error",
      message: VERIFICATION_TOKEN_REJECTION_MESSAGE.expired,
    },
  );
  assert.deepEqual(
    await consumeEmailVerificationToken(
      rawToken,
      clientForRecord({
        id: "evt_used",
        userId: "user_1",
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: new Date(),
      }),
    ),
    {
      status: "error",
      message: VERIFICATION_TOKEN_REJECTION_MESSAGE.used,
    },
  );
});

test("consumeEmailVerificationToken returns a retryable error when storage throws", async () => {
  const originalError = console.error;
  console.error = () => {};
  const client = asPrismaClient({
    emailVerificationToken: {
      findUnique: async () => {
        throw new Error("database unavailable");
      },
    },
  });

  try {
    assert.deepEqual(await consumeEmailVerificationToken("raw-token", client), {
      status: "error",
      message: "Could not verify your email. Please try again.",
    });
  } finally {
    console.error = originalError;
  }
});
