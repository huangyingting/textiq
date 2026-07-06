import assert from "node:assert/strict";
import { test, beforeEach, afterEach } from "node:test";

import {
  normalizeSearchQuery,
  buildSearchOr,
  buildDocumentSearchWhere,
  MAX_SEARCH_QUERY_LENGTH,
} from "./search";

// ---------------------------------------------------------------------------
// Helpers to temporarily override DB_PROVIDER for isolation.
// ---------------------------------------------------------------------------

let originalProvider: string | undefined;

beforeEach(() => {
  originalProvider = process.env.DB_PROVIDER;
});

afterEach(() => {
  if (originalProvider === undefined) {
    delete process.env.DB_PROVIDER;
  } else {
    process.env.DB_PROVIDER = originalProvider;
  }
});

// ---------------------------------------------------------------------------
// normalizeSearchQuery
// ---------------------------------------------------------------------------

test("normalizeSearchQuery trims surrounding whitespace", () => {
  assert.equal(normalizeSearchQuery("  hello world  "), "hello world");
  assert.equal(normalizeSearchQuery("\t textiq \n"), "textiq");
});

test("normalizeSearchQuery returns empty string for blank input", () => {
  assert.equal(normalizeSearchQuery(""), "");
  assert.equal(normalizeSearchQuery("   "), "");
  assert.equal(normalizeSearchQuery("\t\n"), "");
});

test("normalizeSearchQuery clamps to MAX_SEARCH_QUERY_LENGTH", () => {
  const long = "a".repeat(MAX_SEARCH_QUERY_LENGTH + 50);
  const result = normalizeSearchQuery(long);
  assert.equal(result.length, MAX_SEARCH_QUERY_LENGTH);
});

test("normalizeSearchQuery preserves short strings verbatim", () => {
  assert.equal(normalizeSearchQuery("my doc"), "my doc");
});

// ---------------------------------------------------------------------------
// buildSearchOr – SQLite path (default when DB_PROVIDER is unset or sqlite)
// ---------------------------------------------------------------------------

test("buildSearchOr SQLite: returns OR with title and content contains", () => {
  delete process.env.DB_PROVIDER;

  const result = buildSearchOr("hello");

  assert.equal(result.length, 2);
  assert.deepEqual(result[0], { title: { contains: "hello" } });
  assert.deepEqual(result[1], { content: { contains: "hello" } });
});

test("buildSearchOr SQLite: does NOT include mode field", () => {
  delete process.env.DB_PROVIDER;

  const result = buildSearchOr("test");
  const titleFilter = (result[0] as { title: Record<string, unknown> }).title;
  assert.ok(
    !("mode" in titleFilter),
    "SQLite filter must not include a mode field",
  );
});

test("buildSearchOr SQLite: DB_PROVIDER=sqlite also omits mode", () => {
  process.env.DB_PROVIDER = "sqlite";

  const result = buildSearchOr("query");
  const titleFilter = (result[0] as { title: Record<string, unknown> }).title;
  assert.ok(!("mode" in titleFilter));
});

// ---------------------------------------------------------------------------
// buildSearchOr – Postgres path
// ---------------------------------------------------------------------------

test("buildSearchOr Postgres: includes mode insensitive on both fields", () => {
  process.env.DB_PROVIDER = "postgres";

  const result = buildSearchOr("world");

  assert.equal(result.length, 2);
  const titleFilter = (result[0] as { title: Record<string, unknown> }).title;
  const contentFilter = (result[1] as { content: Record<string, unknown> })
    .content;

  assert.equal(titleFilter.contains, "world");
  assert.equal(titleFilter.mode, "insensitive");
  assert.equal(contentFilter.contains, "world");
  assert.equal(contentFilter.mode, "insensitive");
});

test("buildSearchOr Postgres: preserves the exact query string", () => {
  process.env.DB_PROVIDER = "postgres";

  const q = "Meeting Notes 2026";
  const result = buildSearchOr(q);
  const titleFilter = (result[0] as { title: Record<string, unknown> }).title;
  assert.equal(titleFilter.contains, q);
});

// ---------------------------------------------------------------------------
// buildDocumentSearchWhere
// ---------------------------------------------------------------------------

const fakeAccessOr = [{ ownerId: "user-1" }];

test("buildDocumentSearchWhere includes deletedAt: null", () => {
  delete process.env.DB_PROVIDER;

  const where = buildDocumentSearchWhere("hello", fakeAccessOr);
  assert.equal(where.deletedAt, null);
});

test("buildDocumentSearchWhere includes the provided accessOr", () => {
  delete process.env.DB_PROVIDER;

  const where = buildDocumentSearchWhere("hello", fakeAccessOr);
  assert.deepEqual(where.OR, fakeAccessOr);
});

test("buildDocumentSearchWhere wraps search in AND.OR", () => {
  delete process.env.DB_PROVIDER;

  const where = buildDocumentSearchWhere("textiq", fakeAccessOr);
  const andClause = where.AND as { OR: unknown[] }[];
  assert.ok(Array.isArray(andClause), "AND should be an array");
  assert.equal(andClause.length, 1);
  assert.ok(Array.isArray(andClause[0].OR), "AND[0].OR should be an array");
  assert.equal(andClause[0].OR.length, 2, "AND.OR should have title + content");
});

test("buildDocumentSearchWhere empty accessOr still builds valid where", () => {
  delete process.env.DB_PROVIDER;

  const where = buildDocumentSearchWhere("test", []);
  assert.deepEqual(where.OR, []);
  assert.equal(where.deletedAt, null);
});
