import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTH_EMAIL_DELIVERY_ERROR_CODE,
  AUTH_EMAIL_DELIVERY_ERROR_MESSAGE,
  configureAuthEmailDeliveryPort,
  type AuthEmailMessage,
} from "@/lib/auth/email";
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

type VerificationTokenRow = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
};

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

function makeRequestClient(
  options: {
    user?: {
      email: string;
      emailVerified: Date | null;
    } | null;
    initialTokens?: VerificationTokenRow[];
    createError?: Error;
    updateManyError?: Error;
    deleteManyError?: Error;
  } = {},
) {
  const tokens = [...(options.initialTokens ?? [])];
  const createdTokenHashes: string[] = [];
  const deleteManyCalls: Array<{ id?: string; userId?: string }> = [];
  let nextId = tokens.length + 1;

  const userRecord =
    options.user ??
    ({ email: "person@example.com", emailVerified: null } as const);

  const client = asPrismaClient({
    user: {
      findUnique: async () => userRecord,
    },
    emailVerificationToken: {
      create: async ({
        data,
      }: {
        data: { userId: string; tokenHash: string; expiresAt: Date };
        select?: { id: true };
      }) => {
        if (options.createError) {
          throw options.createError;
        }
        const created = {
          id: `evt_new_${nextId++}`,
          userId: data.userId,
          tokenHash: data.tokenHash,
          expiresAt: data.expiresAt,
          usedAt: null,
        };
        tokens.push(created);
        createdTokenHashes.push(created.tokenHash);
        return { id: created.id };
      },
      updateMany: async ({
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
      }) => {
        if (options.updateManyError) {
          throw options.updateManyError;
        }

        let count = 0;
        for (const token of tokens) {
          const idMatches =
            where.id === undefined
              ? true
              : typeof where.id === "string"
                ? token.id === where.id
                : token.id !== where.id.not;
          const userMatches =
            where.userId === undefined ? true : token.userId === where.userId;
          const usedMatches =
            where.usedAt === undefined ? true : token.usedAt === where.usedAt;
          const expiresMatches =
            where.expiresAt === undefined
              ? true
              : token.expiresAt > where.expiresAt.gt;
          if (idMatches && userMatches && usedMatches && expiresMatches) {
            token.usedAt = data.usedAt;
            count += 1;
          }
        }
        return { count };
      },
      deleteMany: async ({
        where,
      }: {
        where: { id?: string; userId?: string; usedAt?: null };
      }) => {
        deleteManyCalls.push({ id: where.id, userId: where.userId });
        if (options.deleteManyError) {
          throw options.deleteManyError;
        }
        const before = tokens.length;
        for (let index = tokens.length - 1; index >= 0; index -= 1) {
          const token = tokens[index];
          const idMatches =
            where.id === undefined ? true : token.id === where.id;
          const userMatches =
            where.userId === undefined ? true : token.userId === where.userId;
          const usedMatches =
            where.usedAt === undefined ? true : token.usedAt === where.usedAt;
          if (idMatches && userMatches && usedMatches) {
            tokens.splice(index, 1);
          }
        }
        return { count: before - tokens.length };
      },
    },
    _tokens: tokens,
    _createdTokenHashes: createdTokenHashes,
    _deleteManyCalls: deleteManyCalls,
  });

  return client;
}

function verificationMessageTokenHash(message: AuthEmailMessage): string {
  assert.equal(message.kind, "email-verification");
  if (message.kind !== "email-verification") {
    return "";
  }
  const url = new URL(message.verifyUrl);
  const segments = url.pathname.split("/");
  const encodedToken = segments[segments.length - 1];
  assert.ok(encodedToken);
  return hashVerificationToken(decodeURIComponent(encodedToken));
}

function countSentAuditLines(lines: string[]): number {
  return lines.filter(
    (line) =>
      line.includes('"scope":"security.audit"') &&
      line.includes('"message":"auth.email_verification.requested"') &&
      line.includes('"outcome":"sent"'),
  ).length;
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

    const verifiedClient = makeRequestClient({
      user: {
        email: "verified@example.com",
        emailVerified: new Date("2026-01-01T00:00:00Z"),
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
  const client = makeRequestClient({
    createError: new Error("database unavailable"),
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

test("requestEmailVerificationForUser keeps only the delivered token active after success", async () => {
  const oldTokenA: VerificationTokenRow = {
    id: "evt_old_1",
    userId: "user_1",
    tokenHash: hashVerificationToken("old-token-a"),
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null,
  };
  const oldTokenB: VerificationTokenRow = {
    id: "evt_old_2",
    userId: "user_1",
    tokenHash: hashVerificationToken("old-token-b"),
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null,
  };
  const client = makeRequestClient({
    initialTokens: [oldTokenA, oldTokenB],
  });
  const delivered: AuthEmailMessage[] = [];
  const infoLines: string[] = [];
  const originalInfo = console.info;
  console.info = (line?: unknown) => {
    infoLines.push(String(line));
  };
  configureAuthEmailDeliveryPort({
    async send(message) {
      delivered.push(message);
    },
  });

  try {
    const result = await requestEmailVerificationForUser("user_1", client);
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { status: "sent" });
  } finally {
    console.info = originalInfo;
    configureAuthEmailDeliveryPort(null);
  }

  assert.equal(delivered.length, 1);
  const activeTokens = client._tokens.filter((token) => token.usedAt === null);
  assert.equal(activeTokens.length, 1);
  assert.equal(
    activeTokens[0]?.tokenHash,
    verificationMessageTokenHash(delivered[0]),
  );
  assert.equal(
    client._tokens.filter((token) => token.id === "evt_old_1")[0]
      ?.usedAt instanceof Date,
    true,
  );
  assert.equal(
    client._tokens.filter((token) => token.id === "evt_old_2")[0]
      ?.usedAt instanceof Date,
    true,
  );
  assert.equal(countSentAuditLines(infoLines), 1);
});

test("requestEmailVerificationForUser preserves old tokens and cleans up the undelivered token", async () => {
  const oldToken: VerificationTokenRow = {
    id: "evt_old_1",
    userId: "user_1",
    tokenHash: hashVerificationToken("old-token"),
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null,
  };
  const client = makeRequestClient({
    initialTokens: [oldToken],
  });
  const infoLines: string[] = [];
  const errorLines: string[] = [];
  const originalInfo = console.info;
  const originalError = console.error;
  console.info = (line?: unknown) => {
    infoLines.push(String(line));
  };
  console.error = (line?: unknown) => {
    errorLines.push(String(line));
  };
  configureAuthEmailDeliveryPort({
    async send() {
      throw new Error("mail transport unavailable");
    },
  });

  try {
    assert.deepEqual(await requestEmailVerificationForUser("user_1", client), {
      ok: false,
      error: "Could not send a verification email. Please try again.",
    });
  } finally {
    console.info = originalInfo;
    console.error = originalError;
    configureAuthEmailDeliveryPort(null);
  }

  assert.equal(countSentAuditLines(infoLines), 0);
  assert.equal(client._tokens.length, 1);
  assert.equal(client._tokens[0]?.id, "evt_old_1");
  assert.equal(client._tokens[0]?.usedAt, null);
  assert.equal(client._deleteManyCalls.length, 1);
  assert.equal(
    errorLines.filter(
      (line) =>
        line.includes('"scope":"email-verification"') &&
        line.includes('"outcome":"delivery_failed"'),
    ).length,
    1,
  );
});

test("requestEmailVerificationForUser retries with a fresh delivered token after delivery failure", async () => {
  const oldToken: VerificationTokenRow = {
    id: "evt_old_1",
    userId: "user_1",
    tokenHash: hashVerificationToken("old-token"),
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null,
  };
  const client = makeRequestClient({
    initialTokens: [oldToken],
  });
  const delivered: AuthEmailMessage[] = [];
  const originalInfo = console.info;
  const originalError = console.error;
  console.info = () => {};
  console.error = () => {};

  configureAuthEmailDeliveryPort({
    async send() {
      throw new Error("mail transport unavailable");
    },
  });
  try {
    await requestEmailVerificationForUser("user_1", client);
  } finally {
    configureAuthEmailDeliveryPort({
      async send(message) {
        delivered.push(message);
      },
    });
  }

  try {
    const retry = await requestEmailVerificationForUser("user_1", client);
    assert.equal(retry.ok, true);
    assert.deepEqual(retry.data, { status: "sent" });
  } finally {
    console.info = originalInfo;
    console.error = originalError;
    configureAuthEmailDeliveryPort(null);
  }

  assert.equal(client._createdTokenHashes.length, 2);
  const firstCreatedHash = client._createdTokenHashes[0];
  const secondCreatedHash = client._createdTokenHashes[1];
  assert.notEqual(firstCreatedHash, secondCreatedHash);
  assert.equal(
    client._tokens.some((token) => token.tokenHash === firstCreatedHash),
    false,
  );
  const activeTokens = client._tokens.filter((token) => token.usedAt === null);
  assert.equal(activeTokens.length, 1);
  assert.equal(activeTokens[0]?.tokenHash, secondCreatedHash);
  assert.equal(
    secondCreatedHash,
    verificationMessageTokenHash(delivered[0] as AuthEmailMessage),
  );
});

test("requestEmailVerificationForUser logs only canonical delivery errors without transport secrets", async () => {
  const client = makeRequestClient();
  const errorLines: string[] = [];
  const originalError = console.error;
  console.error = (line?: unknown) => {
    errorLines.push(String(line));
  };
  configureAuthEmailDeliveryPort({
    async send() {
      throw new Error(
        "provider=smtp://secret.example token=raw-verification-token recipient=person@example.com callback=https://secret.example/hook",
      );
    },
  });

  try {
    assert.deepEqual(await requestEmailVerificationForUser("user_1", client), {
      ok: false,
      error: "Could not send a verification email. Please try again.",
    });
  } finally {
    console.error = originalError;
    configureAuthEmailDeliveryPort(null);
  }

  assert.equal(errorLines.length, 1);
  const serialized = errorLines[0] ?? "";
  assert.equal(serialized.includes(AUTH_EMAIL_DELIVERY_ERROR_CODE), true);
  assert.equal(serialized.includes(AUTH_EMAIL_DELIVERY_ERROR_MESSAGE), true);
  assert.equal(serialized.includes("secret.example"), false);
  assert.equal(serialized.includes("raw-verification-token"), false);
  assert.equal(serialized.includes("person@example.com"), false);
});

test("requestEmailVerificationForUser surfaces cleanup failures separately from delivery failures", async () => {
  const client = makeRequestClient({
    deleteManyError: new Error("cleanup unavailable"),
  });
  const infoLines: string[] = [];
  const errorLines: string[] = [];
  const originalInfo = console.info;
  const originalError = console.error;
  console.info = (line?: unknown) => {
    infoLines.push(String(line));
  };
  console.error = (line?: unknown) => {
    errorLines.push(String(line));
  };
  configureAuthEmailDeliveryPort({
    async send() {
      throw new Error("transport unavailable");
    },
  });

  try {
    assert.deepEqual(await requestEmailVerificationForUser("user_1", client), {
      ok: false,
      error: "Could not send a verification email. Please try again.",
    });
  } finally {
    console.info = originalInfo;
    console.error = originalError;
    configureAuthEmailDeliveryPort(null);
  }

  assert.equal(countSentAuditLines(infoLines), 0);
  assert.equal(
    errorLines.filter((line) => line.includes('"outcome":"delivery_failed"'))
      .length,
    1,
  );
  assert.equal(
    errorLines.filter((line) =>
      line.includes('"outcome":"delivery_cleanup_failed"'),
    ).length,
    1,
  );
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
