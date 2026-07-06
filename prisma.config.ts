// Prisma CLI config. `prisma` and `dotenv` are runtime dependencies because
// production installs run `db:generate` after `npm ci --omit=dev`.
import "dotenv/config";
import { defineConfig } from "prisma/config";

// Select the database engine at runtime. SQLite is the zero-setup default only
// when DB_PROVIDER is unset; unknown values fail closed instead of silently
// selecting the wrong database.
//
// NOTE: this file is loaded by Prisma CLI tooling which may run outside the
// app's TS path aliases, so it cannot import from src/lib/db-provider.ts.
// The logic below intentionally mirrors that single source of truth.
function resolvePrismaProvider(): "postgres" | "sqlite" {
  const rawProvider = process.env["DB_PROVIDER"];
  if (rawProvider === undefined) return "sqlite";

  const provider = rawProvider.trim();
  if (provider === "sqlite" || provider === "postgres") return provider;

  throw new Error(
    `Invalid DB_PROVIDER "${rawProvider}". Expected "sqlite" or "postgres".`,
  );
}

const provider = resolvePrismaProvider();
const isSqlite = provider === "sqlite";

// Each provider has its own schema file. Development applies the selected
// schema directly with `prisma db push` while schemas are changing quickly.
const schema = isSqlite
  ? "prisma/schema.sqlite.prisma"
  : "prisma/schema.prisma";

// DATABASE_URL wins when set; SQLite falls back to a local file so a fresh clone
// works with no configuration.
const url =
  process.env["DATABASE_URL"] ??
  (isSqlite ? "file:./prisma/dev.db" : undefined);

export default defineConfig({
  schema,
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url,
  },
});
