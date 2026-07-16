import assert from "node:assert/strict";
import test from "node:test";

import {
  configureAuthEmailDeliveryPort,
  type AuthEmailMessage,
} from "@/lib/auth/email";
import {
  GENERIC_PASSWORD_RESET_SENT_MESSAGE,
  requestPasswordResetForEmail,
  resetPasswordWithToken,
} from "@/lib/auth/password-reset-service";
import {
  RESET_TOKEN_REJECTION_MESSAGE,
  hashResetToken,
} from "@/lib/auth/reset-token";
import type { prisma } from "@/lib/prisma";

type PrismaClient = typeof prisma;

function asPrismaClient<T extends object>(client: T): T & PrismaClient {
  return client as T & PrismaClient;
}

function makeClient(user: { id: string; email: string } | null) {
  const tokens: Array<{ userId: string; tokenHash: string; expiresAt: Date }> =
    [];
  return asPrismaClient({
    user: {
      findUnique() {
        return Promise.resolve(user);
      },
    },
    passwordResetToken: {
      create({
        data,
      }: {
        data: { userId: string; tokenHash: string; expiresAt: Date };
      }) {
        tokens.push(data);
        return Promise.resolve(data);
      },
    },
    _tokens: tokens,
  });
}

function makeResetClient(rawToken: string) {
  const token = {
    id: "prt_1",
    userId: "u1",
    tokenHash: hashResetToken(rawToken),
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null as Date | null,
  };
  const passwordHashes: string[] = [];
  const sessionInvalidatedAts: Date[] = [];
  const client = {
    user: {
      update({
        where,
        data,
      }: {
        where: { id: string };
        data: { passwordHash: string; sessionInvalidatedAt: Date };
      }) {
        assert.equal(where.id, "u1");
        assert.equal(data.sessionInvalidatedAt instanceof Date, true);
        sessionInvalidatedAts.push(data.sessionInvalidatedAt);
        passwordHashes.push(data.passwordHash);
        return Promise.resolve({ id: where.id, ...data });
      },
    },
    passwordResetToken: {
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
    _passwordHashes: passwordHashes,
    _sessionInvalidatedAts: sessionInvalidatedAts,
  };
  return asPrismaClient(client);
}

test("requestPasswordResetForEmail preserves anti-enumeration for unknown accounts", async () => {
  const client = makeClient(null);
  const delivered: AuthEmailMessage[] = [];
  const originalInfo = console.info;
  console.info = () => {};
  configureAuthEmailDeliveryPort({
    async send(message) {
      delivered.push(message);
    },
  });

  try {
    const result = await requestPasswordResetForEmail(
      "unknown@example.com",
      client,
    );

    assert.deepEqual(result, {
      status: "sent",
      message: GENERIC_PASSWORD_RESET_SENT_MESSAGE,
    });
    assert.deepEqual(client._tokens, []);
    assert.deepEqual(delivered, []);
  } finally {
    console.info = originalInfo;
    configureAuthEmailDeliveryPort(null);
  }
});

test("requestPasswordResetForEmail stores only a hash and sends the raw-token URL", async () => {
  const client = makeClient({ id: "u1", email: "ada@example.com" });
  const delivered: AuthEmailMessage[] = [];
  const originalInfo = console.info;
  console.info = () => {};
  configureAuthEmailDeliveryPort({
    async send(message) {
      delivered.push(message);
    },
  });

  try {
    const result = await requestPasswordResetForEmail(
      "ADA@example.com",
      client,
    );

    assert.deepEqual(result, {
      status: "sent",
      message: GENERIC_PASSWORD_RESET_SENT_MESSAGE,
    });
    assert.equal(client._tokens.length, 1);
    assert.equal(client._tokens[0]?.userId, "u1");
    assert.match(client._tokens[0]?.tokenHash ?? "", /^[0-9a-f]{64}$/);
    assert.equal(delivered[0]?.kind, "password-reset");
    assert.match(
      delivered[0]?.kind === "password-reset" ? delivered[0].resetUrl : "",
      /\/reset-password\?token=/,
    );
    assert.equal(
      delivered[0]?.kind === "password-reset"
        ? delivered[0].resetUrl.includes(client._tokens[0]?.tokenHash ?? "")
        : true,
      false,
    );
  } finally {
    console.info = originalInfo;
    configureAuthEmailDeliveryPort(null);
  }
});

test("requestPasswordResetForEmail preserves anti-enumeration and logs delivery failures", async () => {
  const client = makeClient({ id: "u1", email: "ada@example.com" });
  const loggedErrors: string[] = [];
  const originalInfo = console.info;
  const originalError = console.error;
  console.info = () => {};
  console.error = (line?: unknown) => {
    loggedErrors.push(String(line));
  };
  configureAuthEmailDeliveryPort({
    async send() {
      throw new Error(
        "smtp://provider.example/failed?token=abc123 recipient=ada@example.com",
      );
    },
  });

  try {
    const result = await requestPasswordResetForEmail(
      "ada@example.com",
      client,
    );
    assert.deepEqual(result, {
      status: "sent",
      message: GENERIC_PASSWORD_RESET_SENT_MESSAGE,
    });
  } finally {
    console.info = originalInfo;
    console.error = originalError;
    configureAuthEmailDeliveryPort(null);
  }

  assert.equal(client._tokens.length, 1);
  assert.equal(
    loggedErrors.some((line) => line.includes('"scope":"password-reset"')),
    true,
  );
  assert.equal(
    loggedErrors.some(
      (line) =>
        line.includes("token=") ||
        line.includes("/reset-password") ||
        line.includes("provider.example") ||
        line.includes("abc123") ||
        line.includes("ada@example.com"),
    ),
    false,
  );
});

test("requestPasswordResetForEmail validates email and preserves generic response on storage errors", async () => {
  assert.deepEqual(
    await requestPasswordResetForEmail("not-an-email", asPrismaClient({})),
    { status: "error", message: "Enter a valid email address." },
  );

  const originalError = console.error;
  console.error = () => {};
  try {
    const client = asPrismaClient({
      user: {
        findUnique: async () => {
          throw new Error("database unavailable");
        },
      },
    });
    assert.deepEqual(
      await requestPasswordResetForEmail("ada@example.com", client),
      {
        status: "sent",
        message: GENERIC_PASSWORD_RESET_SENT_MESSAGE,
      },
    );
  } finally {
    console.error = originalError;
  }
});

test("resetPasswordWithToken consumes the token with a race-safe conditional update", async () => {
  const client = makeResetClient("raw-reset-token");
  const originalInfo = console.info;
  console.info = () => {};

  let results: Array<Awaited<ReturnType<typeof resetPasswordWithToken>>> = [];
  try {
    results = await Promise.all([
      resetPasswordWithToken(
        {
          token: "raw-reset-token",
          newPassword: "new-password-1",
          confirmPassword: "new-password-1",
        },
        client,
      ),
      resetPasswordWithToken(
        {
          token: "raw-reset-token",
          newPassword: "new-password-2",
          confirmPassword: "new-password-2",
        },
        client,
      ),
    ]);
  } finally {
    console.info = originalInfo;
  }

  assert.equal(
    results.filter((result) => result.status === "success").length,
    1,
  );
  assert.equal(
    results.filter(
      (result) =>
        result.status === "error" &&
        result.message === RESET_TOKEN_REJECTION_MESSAGE.used,
    ).length,
    1,
  );
  assert.equal(client._passwordHashes.length, 1);
  assert.equal(client._sessionInvalidatedAts.length, 1);
});

test("resetPasswordWithToken rejects missing, unknown, expired, and invalid replacement inputs", async () => {
  assert.deepEqual(
    await resetPasswordWithToken(
      {
        token: "",
        newPassword: "new-password",
        confirmPassword: "new-password",
      },
      asPrismaClient({}),
    ),
    {
      status: "error",
      message: RESET_TOKEN_REJECTION_MESSAGE.not_found,
    },
  );

  const rawToken = "raw-rejected-token";
  const clientForRecord = (
    record: {
      id: string;
      userId: string;
      expiresAt: Date;
      usedAt: Date | null;
    } | null,
  ) =>
    asPrismaClient({
      passwordResetToken: {
        findUnique: async () => record,
      },
    });

  assert.deepEqual(
    await resetPasswordWithToken(
      {
        token: rawToken,
        newPassword: "new-password",
        confirmPassword: "new-password",
      },
      clientForRecord(null),
    ),
    {
      status: "error",
      message: RESET_TOKEN_REJECTION_MESSAGE.not_found,
    },
  );
  assert.deepEqual(
    await resetPasswordWithToken(
      {
        token: rawToken,
        newPassword: "new-password",
        confirmPassword: "new-password",
      },
      clientForRecord({
        id: "prt_expired",
        userId: "u1",
        expiresAt: new Date(Date.now() - 1_000),
        usedAt: null,
      }),
    ),
    {
      status: "error",
      message: RESET_TOKEN_REJECTION_MESSAGE.expired,
    },
  );
  assert.deepEqual(
    await resetPasswordWithToken(
      {
        token: rawToken,
        newPassword: "new-password",
        confirmPassword: "different-password",
      },
      clientForRecord({
        id: "prt_valid",
        userId: "u1",
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
      }),
    ),
    { status: "error", message: "New passwords don't match." },
  );
});

test("resetPasswordWithToken returns a generic error when storage throws", async () => {
  const originalError = console.error;
  console.error = () => {};
  const client = asPrismaClient({
    passwordResetToken: {
      findUnique: async () => {
        throw new Error("database unavailable");
      },
    },
  });

  try {
    assert.deepEqual(
      await resetPasswordWithToken(
        {
          token: "raw-token",
          newPassword: "new-password",
          confirmPassword: "new-password",
        },
        client,
      ),
      {
        status: "error",
        message: "Could not reset your password. Please try again.",
      },
    );
  } finally {
    console.error = originalError;
  }
});
