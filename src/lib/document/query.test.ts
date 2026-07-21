import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import {
  buildDocumentListArgs,
  buildDocumentListWhere,
  buildDocumentTextSearchOr,
  documentListTake,
} from "./query";

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

test("buildDocumentTextSearchOr uses provider-aware title and content filters", () => {
  process.env.DB_PROVIDER = "postgres";

  assert.deepEqual(buildDocumentTextSearchOr("launch"), [
    { title: { contains: "launch", mode: "insensitive" } },
    { content: { contains: "launch", mode: "insensitive" } },
  ]);
});

test("buildDocumentListWhere composes accessible scope, text search, tags, and favorites", () => {
  delete process.env.DB_PROVIDER;

  const where = buildDocumentListWhere({
    scope: { kind: "accessible", userId: "user-1" },
    filters: { query: "roadmap", tagSlug: "planning", favoritesOnly: true },
  });

  assert.equal(where.deletedAt, null);
  assert.deepEqual(where.OR, [
    { ownerId: "user-1" },
    {
      workspaceId: { not: null },
      workspace: {
        OR: [
          { ownerId: "user-1" },
          {
            members: {
              some: {
                userId: "user-1",
                role: { in: ["EDITOR", "VIEWER"] },
              },
            },
          },
        ],
      },
    },
  ]);
  assert.deepEqual(where.AND, [
    {
      OR: [
        { title: { contains: "roadmap" } },
        { content: { contains: "roadmap" } },
      ],
    },
    { tags: { some: { slug: "planning" } } },
    { favorite: true },
  ]);
});

test("buildDocumentListWhere preserves dashboard personal list access scope", () => {
  const where = buildDocumentListWhere({
    scope: { kind: "dashboard-personal", userId: "user-1" },
  });

  assert.deepEqual(where, {
    ownerId: "user-1",
    workspaceId: null,
    deletedAt: null,
  });
});

test("buildDocumentListWhere preserves dashboard workspace list access scope", () => {
  const where = buildDocumentListWhere({
    scope: { kind: "dashboard-workspace", userId: "user-1" },
    filters: { tagSlug: "design" },
  });

  assert.deepEqual(where, {
    workspaceId: { not: null },
    deletedAt: null,
    workspace: {
      OR: [
        { ownerId: "user-1" },
        {
          members: {
            some: {
              userId: "user-1",
              role: { in: ["EDITOR", "VIEWER"] },
            },
          },
        },
      ],
    },
    AND: [{ tags: { some: { slug: "design" } } }],
  });
});

test("buildDocumentListWhere preserves workspace list document scope", () => {
  const where = buildDocumentListWhere({
    scope: { kind: "workspace", workspaceId: "workspace-1" },
    filters: { favoritesOnly: true },
  });

  assert.deepEqual(where, {
    workspaceId: "workspace-1",
    deletedAt: null,
    AND: [{ favorite: true }],
  });
});

test("documentListTake keeps the one-extra-row cap policy", () => {
  assert.equal(documentListTake(200), 201);
  assert.equal(documentListTake(0), 1);
});

test("buildDocumentListArgs adds central order and cap policy", () => {
  const args = buildDocumentListArgs({
    scope: { kind: "workspace", workspaceId: "workspace-1" },
    limit: 10,
  });

  assert.deepEqual(args, {
    where: { workspaceId: "workspace-1", deletedAt: null },
    orderBy: { updatedAt: "desc" },
    take: 11,
  });
});
