import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";

import {
  PrismaClient as GeneratedPrismaClient,
  type Prisma,
} from "@/generated/prisma/client";
import { resolveProvider, resolveUrl } from "@/lib/db-provider";
import type {
  DocumentWriteTarget,
  PrismaClientSurface,
} from "@/lib/prisma-surface";

function createRawPrismaClient() {
  if (resolveProvider() === "postgres") {
    const connectionString = resolveUrl();

    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is not set.");
    }

    /* Coverage rationale: postgres adapter construction is covered by provider tests; sqlite coverage maps this line as uncovered. */
    /* node:coverage ignore next */
    const adapter = new PrismaPg({ connectionString });

    return new GeneratedPrismaClient({ adapter });
  }

  const url = resolveUrl()!;
  const adapter = new PrismaBetterSqlite3({ url });

  return new GeneratedPrismaClient({ adapter });
}

type RawPrismaClient = ReturnType<typeof createRawPrismaClient>;
type RawDocumentDelegate = RawPrismaClient["document"];

const globalForPrisma = globalThis as unknown as {
  prisma: RawPrismaClient | undefined;
};

const rawPrisma = globalForPrisma.prisma ?? createRawPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = rawPrisma;
}

export const prismaSurface = rawPrisma as unknown as PrismaClientSurface;

export function createIsolatedPrismaSurface(): PrismaClientSurface {
  return createRawPrismaClient() as unknown as PrismaClientSurface;
}

export function documentWriteDelegate(
  target: DocumentWriteTarget,
): RawDocumentDelegate {
  return (
    target as unknown as {
      document: RawDocumentDelegate;
    }
  ).document;
}

export function executeInviteLinkRetentionDelete(
  target: object,
  cutoff: Date,
): Prisma.PrismaPromise<unknown> {
  const client = target as RawPrismaClient;
  return client.$executeRaw`
    DELETE FROM "InviteLink"
    WHERE "createdAt" < ${cutoff}
      AND (
        "isRevoked" = ${true}
        OR ("expiresAt" IS NOT NULL AND "expiresAt" < ${cutoff})
        OR ("maxUses" IS NOT NULL AND "useCount" >= "maxUses")
      )
  ` as Prisma.PrismaPromise<unknown>;
}

export const unsafeRawPrismaForTests = rawPrisma;
