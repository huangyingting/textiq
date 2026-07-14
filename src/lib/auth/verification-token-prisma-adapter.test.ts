import assert from "node:assert/strict";
import test from "node:test";

import { createPrismaVerificationTokenPort } from "@/lib/auth/verification-token-prisma-adapter";
import type { VerificationTokenPersistenceInput } from "@/lib/auth/verification-token";
import type { prisma } from "@/lib/prisma";

type PrismaClient = typeof prisma;

function asPrismaClient<T extends object>(client: T): T & PrismaClient {
  return client as T & PrismaClient;
}

type VerificationTokenRow = {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
};

function makeClient(
  options: {
    rows?: VerificationTokenRow[];
    findManyError?: Error;
  } = {},
) {
  const rows = [...(options.rows ?? [])];
  const createInputs: VerificationTokenPersistenceInput[] = [];
  const findManyTokenHashes: string[] = [];

  const client = asPrismaClient({
    emailVerificationToken: {
      async create({ data }: { data: VerificationTokenPersistenceInput }) {
        createInputs.push(data);
        rows.push({
          userId: data.userId,
          tokenHash: data.tokenHash,
          expiresAt: data.expiresAt,
          usedAt: null,
        });
        return { id: `evt_${rows.length}` };
      },
      async findMany({
        where,
        take,
      }: {
        where: { tokenHash: string };
        select: { expiresAt: true; usedAt: true };
        take?: number;
      }) {
        findManyTokenHashes.push(where.tokenHash);
        if (options.findManyError) {
          throw options.findManyError;
        }
        const matches = rows
          .filter((row) => row.tokenHash === where.tokenHash)
          .slice(0, take ?? rows.length);
        return matches.map((row) => ({
          expiresAt: row.expiresAt,
          usedAt: row.usedAt,
        }));
      },
    },
    _rows: rows,
    _createInputs: createInputs,
    _findManyTokenHashes: findManyTokenHashes,
  });

  return client;
}

test("createPrismaVerificationTokenPort.create stores the durable token fields", async () => {
  const client = makeClient();
  const port = createPrismaVerificationTokenPort(client);
  const expiresAt = new Date("2026-07-14T10:00:00.000Z");
  const persistenceInput: VerificationTokenPersistenceInput = {
    userId: "user_1",
    tokenHash: "hash_1",
    expiresAt,
  };

  await port.create(persistenceInput);

  assert.deepEqual(client._createInputs, [persistenceInput]);
  assert.deepEqual(client._rows, [
    {
      userId: "user_1",
      tokenHash: "hash_1",
      expiresAt,
      usedAt: null,
    },
  ]);
});

test("createPrismaVerificationTokenPort.reconcileByTokenHash confirms active tokens", async () => {
  const now = new Date("2026-07-14T09:00:00.000Z");
  const client = makeClient({
    rows: [
      {
        userId: "user_1",
        tokenHash: "hash_1",
        expiresAt: new Date("2026-07-14T10:00:00.000Z"),
        usedAt: null,
      },
    ],
  });
  const port = createPrismaVerificationTokenPort(client);

  const result = await port.reconcileByTokenHash({
    tokenHash: "hash_1",
    now,
  });

  assert.deepEqual(result, { status: "active" });
  assert.deepEqual(client._findManyTokenHashes, ["hash_1"]);
});

test("createPrismaVerificationTokenPort.reconcileByTokenHash reports missing hashes as inactive", async () => {
  const client = makeClient();
  const port = createPrismaVerificationTokenPort(client);

  const result = await port.reconcileByTokenHash({
    tokenHash: "missing_hash",
    now: new Date("2026-07-14T09:00:00.000Z"),
  });

  assert.deepEqual(result, {
    status: "inactive",
    reason: "missing",
  });
});

test("createPrismaVerificationTokenPort.reconcileByTokenHash reports used and expired rows as inactive", async () => {
  const now = new Date("2026-07-14T09:00:00.000Z");
  const client = makeClient({
    rows: [
      {
        userId: "user_1",
        tokenHash: "used_hash",
        expiresAt: new Date("2026-07-14T10:00:00.000Z"),
        usedAt: new Date("2026-07-14T08:00:00.000Z"),
      },
      {
        userId: "user_1",
        tokenHash: "expired_hash",
        expiresAt: new Date("2026-07-14T08:59:59.000Z"),
        usedAt: null,
      },
    ],
  });
  const port = createPrismaVerificationTokenPort(client);

  assert.deepEqual(
    await port.reconcileByTokenHash({
      tokenHash: "used_hash",
      now,
    }),
    {
      status: "inactive",
      reason: "used",
    },
  );
  assert.deepEqual(
    await port.reconcileByTokenHash({
      tokenHash: "expired_hash",
      now,
    }),
    {
      status: "inactive",
      reason: "expired",
    },
  );
});

test("createPrismaVerificationTokenPort.reconcileByTokenHash reports ambiguous duplicate rows", async () => {
  const now = new Date("2026-07-14T09:00:00.000Z");
  const client = makeClient({
    rows: [
      {
        userId: "user_1",
        tokenHash: "dup_hash",
        expiresAt: new Date("2026-07-14T10:00:00.000Z"),
        usedAt: null,
      },
      {
        userId: "user_2",
        tokenHash: "dup_hash",
        expiresAt: new Date("2026-07-14T10:00:00.000Z"),
        usedAt: null,
      },
    ],
  });
  const port = createPrismaVerificationTokenPort(client);

  const result = await port.reconcileByTokenHash({
    tokenHash: "dup_hash",
    now,
  });

  assert.deepEqual(result, { status: "ambiguous" });
});

test("createPrismaVerificationTokenPort.reconcileByTokenHash propagates read failures", async () => {
  const port = createPrismaVerificationTokenPort(
    makeClient({
      findManyError: new Error("db unavailable"),
    }),
  );

  await assert.rejects(
    port.reconcileByTokenHash({
      tokenHash: "hash_1",
      now: new Date("2026-07-14T09:00:00.000Z"),
    }),
    /db unavailable/,
  );
});
