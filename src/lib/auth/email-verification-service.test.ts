import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTH_EMAIL_DELIVERY_ERROR_CODE,
  AUTH_EMAIL_DELIVERY_ERROR_MESSAGE,
  configureAuthEmailDeliveryPort,
  type AuthEmailMessage,
} from "@/lib/auth/email";
import {
  AUTH_EMAIL_VERIFICATION_ACTIVATION_ERROR_CODE,
  AUTH_EMAIL_VERIFICATION_RECONCILIATION_ERROR_CODE,
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
    createErrors?: Array<Error | null>;
    createErrorsAfterPersist?: Array<Error | null>;
    reconcileError?: Error;
    reconcileErrors?: Array<Error | null>;
    beforeCreate?: (input: {
      callIndex: number;
      data: { userId: string; tokenHash: string; expiresAt: Date };
    }) => Promise<void> | void;
  } = {},
) {
  const tokens = [...(options.initialTokens ?? [])];
  const createdTokenHashes: string[] = [];
  const createInputs: Array<{
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }> = [];
  const updateManyCalls: Array<{
    where: {
      id?: string | { not: string };
      userId?: string;
      usedAt?: null;
      expiresAt?: { gt: Date };
    };
    data: { usedAt: Date };
  }> = [];
  const deleteManyCalls: Array<{ id?: string; userId?: string }> = [];
  const reconcileTokenHashes: string[] = [];
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
        const callIndex = createInputs.length;
        createInputs.push(data);
        await options.beforeCreate?.({ callIndex, data });
        const plannedPrePersistError =
          options.createErrors?.[callIndex] ?? options.createError;
        const created = {
          id: `evt_new_${nextId++}`,
          userId: data.userId,
          tokenHash: data.tokenHash,
          expiresAt: data.expiresAt,
          usedAt: null,
        };
        const plannedPostPersistError =
          options.createErrorsAfterPersist?.[callIndex] ?? null;
        if (plannedPrePersistError) {
          throw plannedPrePersistError;
        }
        tokens.push(created);
        createdTokenHashes.push(created.tokenHash);
        if (plannedPostPersistError) {
          throw plannedPostPersistError;
        }
        return { id: created.id };
      },
      findMany: async ({
        where,
        take,
      }: {
        where: { tokenHash: string };
        select: { expiresAt: true; usedAt: true };
        take?: number;
      }) => {
        const callIndex = reconcileTokenHashes.length;
        reconcileTokenHashes.push(where.tokenHash);
        const plannedError =
          options.reconcileErrors?.[callIndex] ?? options.reconcileError;
        if (plannedError) {
          throw plannedError;
        }
        const matches = tokens
          .filter((token) => token.tokenHash === where.tokenHash)
          .slice(0, take ?? tokens.length)
          .map((token) => ({
            expiresAt: token.expiresAt,
            usedAt: token.usedAt,
          }));
        return matches;
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
        updateManyCalls.push({ where, data });
        return { count: 0 };
      },
      deleteMany: async ({
        where,
      }: {
        where: { id?: string; userId?: string; usedAt?: null };
      }) => {
        deleteManyCalls.push({ id: where.id, userId: where.userId });
        return { count: 0 };
      },
    },
    _tokens: tokens,
    _createdTokenHashes: createdTokenHashes,
    _createInputs: createInputs,
    _updateManyCalls: updateManyCalls,
    _deleteManyCalls: deleteManyCalls,
    _reconcileTokenHashes: reconcileTokenHashes,
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

function countVerificationFailureLines(
  lines: string[],
  outcome: "activation_failed" | "delivery_failed" | "reconciliation_failed",
): number {
  return lines.filter(
    (line) =>
      line.includes('"scope":"email-verification"') &&
      line.includes(`"outcome":"${outcome}"`),
  ).length;
}

function deferred<T = void>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => {};
  let reject: (reason?: unknown) => void = () => {};
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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

test("requestEmailVerificationForUser persists the delivered token without retiring siblings", async () => {
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
  const deliveredHash = verificationMessageTokenHash(
    delivered[0] as AuthEmailMessage,
  );
  assert.equal(client._createInputs.length, 1);
  assert.equal(client._createInputs[0]?.tokenHash, deliveredHash);
  const activeTokens = client._tokens.filter((token) => token.usedAt === null);
  assert.equal(activeTokens.length, 3);
  assert.equal(
    activeTokens.filter((token) => token.tokenHash === deliveredHash).length,
    1,
  );
  assert.equal(
    activeTokens.filter((token) => token.id === "evt_old_1").length,
    1,
  );
  assert.equal(
    activeTokens.filter((token) => token.id === "evt_old_2").length,
    1,
  );
  assert.equal(client._updateManyCalls.length, 0);
  assert.equal(client._deleteManyCalls.length, 0);
  assert.equal(countSentAuditLines(infoLines), 1);
});

test("requestEmailVerificationForUser performs zero token writes when delivery fails", async () => {
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
  assert.equal(client._createInputs.length, 0);
  assert.equal(client._updateManyCalls.length, 0);
  assert.equal(client._deleteManyCalls.length, 0);
  assert.equal(client._tokens.length, 1);
  assert.equal(client._tokens[0]?.id, "evt_old_1");
  assert.equal(client._tokens[0]?.usedAt, null);
  assert.equal(countVerificationFailureLines(errorLines, "delivery_failed"), 1);
});

test("requestEmailVerificationForUser logs canonical activation failures after no-commit persistence rejection", async () => {
  const client = makeRequestClient({
    createError: new Error(
      "provider=smtp://secret.example token=raw-verification-token recipient=person@example.com callback=https://secret.example/hook",
    ),
  });
  const delivered: AuthEmailMessage[] = [];
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
    async send(message) {
      delivered.push(message);
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

  assert.equal(delivered.length, 1);
  assert.equal(client._createInputs.length, 1);
  assert.equal(client._tokens.length, 0);
  assert.equal(client._reconcileTokenHashes.length, 1);
  assert.equal(countSentAuditLines(infoLines), 0);
  assert.equal(
    countVerificationFailureLines(errorLines, "activation_failed"),
    1,
  );
  assert.equal(
    countVerificationFailureLines(errorLines, "reconciliation_failed"),
    0,
  );
  assert.equal(errorLines.length, 1);
  const serialized = errorLines[0] ?? "";
  assert.equal(serialized.includes('"outcome":"activation_failed"'), true);
  assert.equal(
    serialized.includes(AUTH_EMAIL_VERIFICATION_ACTIVATION_ERROR_CODE),
    true,
  );
  assert.equal(serialized.includes("secret.example"), false);
  assert.equal(serialized.includes("raw-verification-token"), false);
  assert.equal(serialized.includes("person@example.com"), false);
  assert.equal(serialized.includes("/verify-email/"), false);
});

test("requestEmailVerificationForUser confirms sent when persistence rejects after durable append and reconciliation is active", async () => {
  const client = makeRequestClient({
    createErrorsAfterPersist: [
      new Error(
        "provider=smtp://secret.example token=raw-verification-token recipient=person@example.com callback=https://secret.example/hook",
      ),
    ],
  });
  const delivered: AuthEmailMessage[] = [];
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
    async send(message) {
      delivered.push(message);
    },
  });

  try {
    assert.deepEqual(await requestEmailVerificationForUser("user_1", client), {
      ok: true,
      data: { status: "sent" },
    });
  } finally {
    console.info = originalInfo;
    console.error = originalError;
    configureAuthEmailDeliveryPort(null);
  }

  assert.equal(delivered.length, 1);
  assert.equal(client._createInputs.length, 1);
  assert.equal(client._tokens.length, 1);
  assert.equal(client._reconcileTokenHashes.length, 1);
  assert.equal(countSentAuditLines(infoLines), 1);
  assert.equal(
    countVerificationFailureLines(errorLines, "activation_failed"),
    0,
  );
  assert.equal(
    countVerificationFailureLines(errorLines, "reconciliation_failed"),
    0,
  );
});

test("requestEmailVerificationForUser logs canonical reconciliation failures when reconciliation query throws", async () => {
  const client = makeRequestClient({
    createError: new Error("write rejected"),
    reconcileError: new Error(
      "provider=smtp://secret.example token=raw-verification-token recipient=person@example.com callback=https://secret.example/hook bearer=demo-bearer-token",
    ),
  });
  const delivered: AuthEmailMessage[] = [];
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
    async send(message) {
      delivered.push(message);
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

  assert.equal(delivered.length, 1);
  assert.equal(client._createInputs.length, 1);
  assert.equal(client._tokens.length, 0);
  assert.equal(client._reconcileTokenHashes.length, 1);
  assert.equal(countSentAuditLines(infoLines), 0);
  assert.equal(
    countVerificationFailureLines(errorLines, "reconciliation_failed"),
    1,
  );
  assert.equal(
    countVerificationFailureLines(errorLines, "activation_failed"),
    0,
  );
  assert.equal(errorLines.length, 1);
  const serialized = errorLines[0] ?? "";
  assert.equal(serialized.includes('"outcome":"reconciliation_failed"'), true);
  assert.equal(
    serialized.includes(AUTH_EMAIL_VERIFICATION_RECONCILIATION_ERROR_CODE),
    true,
  );
  assert.equal(serialized.includes("secret.example"), false);
  assert.equal(serialized.includes("raw-verification-token"), false);
  assert.equal(serialized.includes("person@example.com"), false);
  assert.equal(serialized.includes("demo-bearer-token"), false);
  assert.equal(serialized.includes("/verify-email/"), false);
});

test("requestEmailVerificationForUser retries with a fresh delivered token after activation failure", async () => {
  const oldToken: VerificationTokenRow = {
    id: "evt_old_1",
    userId: "user_1",
    tokenHash: hashVerificationToken("old-token"),
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null,
  };
  const client = makeRequestClient({
    initialTokens: [oldToken],
    createErrors: [new Error("database unavailable"), null],
  });
  const delivered: AuthEmailMessage[] = [];
  const infoLines: string[] = [];
  const originalInfo = console.info;
  const originalError = console.error;
  console.info = (line?: unknown) => {
    infoLines.push(String(line));
  };
  console.error = () => {};
  configureAuthEmailDeliveryPort({
    async send(message) {
      delivered.push(message);
    },
  });

  try {
    assert.deepEqual(await requestEmailVerificationForUser("user_1", client), {
      ok: false,
      error: "Could not send a verification email. Please try again.",
    });
    const retry = await requestEmailVerificationForUser("user_1", client);
    assert.equal(retry.ok, true);
    assert.deepEqual(retry.data, { status: "sent" });
  } finally {
    console.info = originalInfo;
    console.error = originalError;
    configureAuthEmailDeliveryPort(null);
  }

  assert.equal(delivered.length, 2);
  assert.equal(client._createInputs.length, 2);
  const firstDeliveredHash = verificationMessageTokenHash(
    delivered[0] as AuthEmailMessage,
  );
  const secondDeliveredHash = verificationMessageTokenHash(
    delivered[1] as AuthEmailMessage,
  );
  assert.notEqual(firstDeliveredHash, secondDeliveredHash);
  assert.equal(
    client._tokens.some((token) => token.tokenHash === firstDeliveredHash),
    false,
  );
  assert.equal(
    client._tokens.some((token) => token.tokenHash === secondDeliveredHash),
    true,
  );
  const activeTokens = client._tokens.filter((token) => token.usedAt === null);
  assert.equal(activeTokens.length, 2);
  assert.equal(
    activeTokens.filter((token) => token.id === "evt_old_1").length,
    1,
  );
  assert.equal(countSentAuditLines(infoLines), 1);
});

test("requestEmailVerificationForUser keeps confirmed success when sent audit logging fails closed", async () => {
  const client = makeRequestClient();
  const delivered: AuthEmailMessage[] = [];
  const originalInfo = console.info;
  configureAuthEmailDeliveryPort({
    async send(message) {
      delivered.push(message);
    },
  });
  console.info = () => {
    throw new Error("stdout unavailable");
  };

  try {
    assert.deepEqual(await requestEmailVerificationForUser("user_1", client), {
      ok: true,
      data: { status: "sent" },
    });
  } finally {
    console.info = originalInfo;
    configureAuthEmailDeliveryPort(null);
  }

  assert.equal(delivered.length, 1);
  assert.equal(client._tokens.length, 1);
});

test("requestEmailVerificationForUser preserves canonical delivery error logging without transport secrets", async () => {
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

test("requestEmailVerificationForUser allows deterministic concurrent success without mutual retirement", async () => {
  const oldToken: VerificationTokenRow = {
    id: "evt_old_1",
    userId: "user_1",
    tokenHash: hashVerificationToken("old-token"),
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null,
  };
  const delivered: AuthEmailMessage[] = [];
  const infoLines: string[] = [];
  const errorLines: string[] = [];
  const bothDeliveriesStarted = deferred<void>();
  const bothPersistenceStarted = deferred<void>();
  const deliveryGates = [deferred<void>(), deferred<void>()];
  const persistenceGates = [deferred<void>(), deferred<void>()];
  let deliveryCalls = 0;
  let persistenceCalls = 0;
  const client = makeRequestClient({
    initialTokens: [oldToken],
    beforeCreate: async ({ callIndex }) => {
      persistenceCalls += 1;
      if (persistenceCalls === 2) {
        bothPersistenceStarted.resolve();
      }
      await persistenceGates[callIndex]?.promise;
    },
  });
  const originalInfo = console.info;
  const originalError = console.error;
  console.info = (line?: unknown) => {
    infoLines.push(String(line));
  };
  console.error = (line?: unknown) => {
    errorLines.push(String(line));
  };
  configureAuthEmailDeliveryPort({
    async send(message) {
      delivered.push(message);
      const callIndex = deliveryCalls;
      deliveryCalls += 1;
      if (deliveryCalls === 2) {
        bothDeliveriesStarted.resolve();
      }
      await deliveryGates[callIndex]?.promise;
    },
  });

  try {
    const firstRequest = requestEmailVerificationForUser("user_1", client);
    const secondRequest = requestEmailVerificationForUser("user_1", client);

    await bothDeliveriesStarted.promise;
    deliveryGates[0].resolve();
    deliveryGates[1].resolve();

    await bothPersistenceStarted.promise;
    persistenceGates[0].resolve();
    persistenceGates[1].resolve();

    const [firstResult, secondResult] = await Promise.all([
      firstRequest,
      secondRequest,
    ]);
    assert.deepEqual(firstResult, {
      ok: true,
      data: { status: "sent" },
    });
    assert.deepEqual(secondResult, {
      ok: true,
      data: { status: "sent" },
    });
  } finally {
    console.info = originalInfo;
    console.error = originalError;
    configureAuthEmailDeliveryPort(null);
  }

  assert.equal(delivered.length, 2);
  const deliveredHashes = delivered.map((message) =>
    verificationMessageTokenHash(message),
  );
  assert.equal(new Set(deliveredHashes).size, 2);
  const activeTokens = client._tokens.filter((token) => token.usedAt === null);
  assert.equal(activeTokens.length, 3);
  assert.equal(
    activeTokens.some((token) => token.id === "evt_old_1"),
    true,
  );
  for (const tokenHash of deliveredHashes) {
    assert.equal(
      activeTokens.some((token) => token.tokenHash === tokenHash),
      true,
    );
  }
  assert.equal(client._updateManyCalls.length, 0);
  assert.equal(client._deleteManyCalls.length, 0);
  assert.equal(countSentAuditLines(infoLines), 2);
  assert.equal(
    errorLines.filter((line) => line.includes('"scope":"email-verification"'))
      .length,
    0,
  );
});

test("requestEmailVerificationForUser returns a generic error when user lookup storage fails", async () => {
  const client = asPrismaClient({
    user: {
      findUnique: async () => {
        throw new Error("database unavailable");
      },
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

test("requestEmailVerificationForUser does not write sent audit when activation fails after concurrent delivery", async () => {
  const delivered: AuthEmailMessage[] = [];
  const infoLines: string[] = [];
  const errorLines: string[] = [];
  const firstCreateGate = deferred<void>();
  const client = makeRequestClient({
    createErrors: [new Error("first activation failure"), null],
    beforeCreate: async ({ callIndex }) => {
      if (callIndex === 0) {
        await firstCreateGate.promise;
      }
    },
  });
  const originalInfo = console.info;
  const originalError = console.error;
  console.info = (line?: unknown) => {
    infoLines.push(String(line));
  };
  console.error = (line?: unknown) => {
    errorLines.push(String(line));
  };
  configureAuthEmailDeliveryPort({
    async send(message) {
      delivered.push(message);
    },
  });

  try {
    const firstRequest = requestEmailVerificationForUser("user_1", client);
    const secondRequest = requestEmailVerificationForUser("user_1", client);
    firstCreateGate.resolve();
    const results = await Promise.all([firstRequest, secondRequest]);
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(
      results.filter(
        (result) =>
          !result.ok &&
          result.error ===
            "Could not send a verification email. Please try again.",
      ).length,
      1,
    );
  } finally {
    console.info = originalInfo;
    console.error = originalError;
    configureAuthEmailDeliveryPort(null);
  }

  assert.equal(delivered.length, 2);
  assert.equal(countSentAuditLines(infoLines), 1);
  assert.equal(
    countVerificationFailureLines(errorLines, "reconciliation_failed"),
    0,
  );
  assert.equal(
    countVerificationFailureLines(errorLines, "activation_failed"),
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
