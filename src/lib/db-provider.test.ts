import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import {
  caseInsensitiveContains,
  resolveProvider,
  resolveUrl,
} from "./db-provider";

// ---------------------------------------------------------------------------
// Helpers: save / restore env vars around each test for isolation.
// ---------------------------------------------------------------------------

let savedProvider: string | undefined;
let savedUrl: string | undefined;

beforeEach(() => {
  savedProvider = process.env.DB_PROVIDER;
  savedUrl = process.env.DATABASE_URL;
});

afterEach(() => {
  if (savedProvider === undefined) {
    delete process.env.DB_PROVIDER;
  } else {
    process.env.DB_PROVIDER = savedProvider;
  }
  if (savedUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = savedUrl;
  }
});

// ---------------------------------------------------------------------------
// resolveProvider
// ---------------------------------------------------------------------------

test("resolveProvider returns sqlite when DB_PROVIDER is unset", () => {
  delete process.env.DB_PROVIDER;
  assert.equal(resolveProvider(), "sqlite");
});

test("resolveProvider returns sqlite for DB_PROVIDER=sqlite", () => {
  process.env.DB_PROVIDER = "sqlite";
  assert.equal(resolveProvider(), "sqlite");
});

test("resolveProvider rejects an unrecognised value", () => {
  process.env.DB_PROVIDER = "mysql";
  assert.throws(
    () => resolveProvider(),
    /Invalid DB_PROVIDER "mysql"\. Expected "sqlite" or "postgres"\./,
  );
});

test("resolveProvider returns postgres for DB_PROVIDER=postgres", () => {
  process.env.DB_PROVIDER = "postgres";
  assert.equal(resolveProvider(), "postgres");
});

test("resolveProvider is case-sensitive and rejects 'Postgres'", () => {
  process.env.DB_PROVIDER = "Postgres";
  assert.throws(
    () => resolveProvider(),
    /Invalid DB_PROVIDER "Postgres"\. Expected "sqlite" or "postgres"\./,
  );
});

// ---------------------------------------------------------------------------
// resolveUrl
// ---------------------------------------------------------------------------

test("resolveUrl returns DATABASE_URL when set (sqlite provider)", () => {
  delete process.env.DB_PROVIDER;
  process.env.DATABASE_URL = "file:./custom.db";
  assert.equal(resolveUrl(), "file:./custom.db");
});

test("resolveUrl returns DATABASE_URL when set (postgres provider)", () => {
  process.env.DB_PROVIDER = "postgres";
  process.env.DATABASE_URL = "postgresql://user:pass@localhost/db";
  assert.equal(resolveUrl(), "postgresql://user:pass@localhost/db");
});

test("resolveUrl returns sqlite default when DATABASE_URL is unset and provider is sqlite", () => {
  delete process.env.DB_PROVIDER;
  delete process.env.DATABASE_URL;
  assert.equal(resolveUrl(), "file:./prisma/dev.db");
});

test("resolveUrl returns undefined when DATABASE_URL is unset and provider is postgres", () => {
  process.env.DB_PROVIDER = "postgres";
  delete process.env.DATABASE_URL;
  assert.equal(resolveUrl(), undefined);
});

// ---------------------------------------------------------------------------
// caseInsensitiveContains
// ---------------------------------------------------------------------------

test("caseInsensitiveContains SQLite: returns plain contains without mode", () => {
  delete process.env.DB_PROVIDER;
  const filter = caseInsensitiveContains("hello") as Record<string, unknown>;
  assert.equal(filter.contains, "hello");
  assert.ok(!("mode" in filter), "SQLite filter must not include mode");
});

test("caseInsensitiveContains Postgres: returns contains with mode insensitive", () => {
  process.env.DB_PROVIDER = "postgres";
  const filter = caseInsensitiveContains("world") as Record<string, unknown>;
  assert.equal(filter.contains, "world");
  assert.equal(filter.mode, "insensitive");
});

test("caseInsensitiveContains preserves the exact query string", () => {
  delete process.env.DB_PROVIDER;
  const q = "Meeting Notes 2026";
  const filter = caseInsensitiveContains(q) as Record<string, unknown>;
  assert.equal(filter.contains, q);
});

test("caseInsensitiveContains Postgres preserves the exact query string", () => {
  process.env.DB_PROVIDER = "postgres";
  const q = "Meeting Notes 2026";
  const filter = caseInsensitiveContains(q) as Record<string, unknown>;
  assert.equal(filter.contains, q);
});
