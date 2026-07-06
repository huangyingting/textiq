import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";

// Seed and maintenance scripts run through tsx/Prisma CLI entry points, so keep
// this helper on relative imports instead of app-only TS path aliases.
function resolveScriptPrismaProvider(): "postgres" | "sqlite" {
  const rawProvider = process.env.DB_PROVIDER;
  if (rawProvider === undefined) return "sqlite";

  const provider = rawProvider.trim();
  if (provider === "sqlite" || provider === "postgres") return provider;

  throw new Error(
    `Invalid DB_PROVIDER "${rawProvider}". Expected "sqlite" or "postgres".`,
  );
}

function resolveScriptPrismaUrl(): string | undefined {
  const explicit = process.env.DATABASE_URL;
  if (explicit !== undefined) return explicit;
  return resolveScriptPrismaProvider() === "sqlite"
    ? "file:./prisma/dev.db"
    : undefined;
}

export function createScriptPrismaClient() {
  if (resolveScriptPrismaProvider() === "postgres") {
    const connectionString = resolveScriptPrismaUrl();

    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is not set.");
    }

    const adapter = new PrismaPg({ connectionString });

    return new PrismaClient({ adapter });
  }

  const url = resolveScriptPrismaUrl()!;
  const adapter = new PrismaBetterSqlite3({ url });

  return new PrismaClient({ adapter });
}
