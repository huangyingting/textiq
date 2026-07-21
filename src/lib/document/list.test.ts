import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DASHBOARD_DOCUMENT_CARD_SELECT,
  listDashboardDocumentsForUser,
  searchDocumentsForUser,
  type DashboardDocument,
} from "@/lib/document/list";
import { importedMarkdownToContentJson } from "@/lib/document/create";
import { SEARCH_RESULT_LIMIT } from "@/lib/search";
import { FIXTURES } from "@/lib/visual/fixtures";

test("dashboard card select stays skinny and excludes heavy document JSON", () => {
  const select = DASHBOARD_DOCUMENT_CARD_SELECT as Record<string, unknown>;
  assert.equal(select.contentJson, true);
  assert.equal(select.deckJson, undefined);
  assert.equal(select.collabRecoverySnapshot, undefined);
  assert.equal(select.content, undefined);
  assert.deepEqual((select.visuals as { select: unknown }).select, {
    data: true,
  });
});

test("dashboard list uses two capped document queries plus tags only", async () => {
  const documentCalls: unknown[] = [];
  const tagCalls: unknown[] = [];
  const db = {
    document: {
      async findMany(args: unknown) {
        documentCalls.push(args);
        return [];
      },
    },
    tag: {
      async findMany(args: unknown) {
        tagCalls.push(args);
        return [];
      },
    },
  };

  const result = await listDashboardDocumentsForUser("user-1", {}, db as never);

  assert.equal(result.documents.length, 0);
  assert.equal(documentCalls.length, 2);
  assert.equal(tagCalls.length, 1);
  assert.deepEqual(
    (
      documentCalls[1] as {
        select: { workspace: { select: { members: unknown } } };
      }
    ).select.workspace.select.members,
    {
      where: { userId: "user-1", role: { in: ["EDITOR", "VIEWER"] } },
      select: { userId: true, role: true },
    },
  );
  for (const call of documentCalls as Array<{
    select: Record<string, unknown>;
  }>) {
    assert.equal(call.select.contentJson, true);
    assert.equal(call.select.deckJson, undefined);
    assert.equal(call.select.content, undefined);
  }
});

function row(
  overrides: Partial<{
    id: string;
    title: string;
    favorite: boolean;
    contentJson: unknown;
    createdAt: Date;
    updatedAt: Date;
    ownerId: string;
    workspaceId: string | null;
    visuals: { data: unknown }[];
    tags: { slug: string; name: string }[];
    workspace: {
      name: string;
      ownerId: string;
      members: { userId: string; role: string }[];
    } | null;
  }> = {},
) {
  return {
    id: "doc-1",
    title: "Roadmap",
    favorite: false,
    contentJson: importedMarkdownToContentJson(
      "# Launch plan\n\nShip the MVP.",
    ),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    ownerId: "user-1",
    workspaceId: null,
    visuals: [],
    tags: [],
    workspace: null,
    ...overrides,
  };
}

test("dashboard list maps personal and workspace rows into sorted cards with tags", async () => {
  const personal = row({
    id: "personal",
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    tags: [{ slug: "alpha", name: "Alpha" }],
    visuals: [{ data: FIXTURES.flowchart }],
  });
  const workspace = row({
    id: "workspace",
    title: "Workspace doc",
    ownerId: "someone-else",
    workspaceId: "ws-1",
    updatedAt: new Date("2026-01-03T00:00:00Z"),
    tags: [{ slug: "beta", name: "Beta" }],
    workspace: {
      name: "Team Space",
      ownerId: "workspace-owner",
      members: [{ userId: "user-1", role: "EDITOR" }],
    },
  });
  const db = {
    document: {
      async findMany(args: { where?: { workspaceId?: null } }) {
        return args.where?.workspaceId === null ? [personal] : [workspace];
      },
    },
    tag: {
      async findMany() {
        return [{ slug: "owned", name: "Owned" }];
      },
    },
  };

  const result = await listDashboardDocumentsForUser("user-1", {}, db as never);

  assert.deepEqual(
    result.documents.map((doc) => ({
      id: doc.id,
      workspaceName: doc.workspaceName,
      canEdit: doc.canEdit,
      thumbnailType: doc.thumbnail?.type ?? null,
    })),
    [
      {
        id: "workspace",
        workspaceName: "Team Space",
        canEdit: true,
        thumbnailType: null,
      },
      {
        id: "personal",
        workspaceName: null,
        canEdit: true,
        thumbnailType: "flowchart",
      },
    ],
  );
  assert.deepEqual(result.availableTags, [
    { slug: "alpha", name: "Alpha" },
    { slug: "beta", name: "Beta" },
    { slug: "owned", name: "Owned" },
  ]);
  assert.equal(result.listCapped, false);
  assert.equal(result.hasDocuments, true);
});

test("dashboard list reports capping when either source returns an extra row", async () => {
  const db = {
    document: {
      async findMany(args: { where?: { workspaceId?: null }; take?: number }) {
        if (args.where?.workspaceId === null) {
          return Array.from({ length: args.take ?? 0 }, (_, index) =>
            row({ id: `personal-${index}` }),
          );
        }
        return [];
      },
    },
    tag: {
      async findMany() {
        return [];
      },
    },
  };

  const result = await listDashboardDocumentsForUser("user-1", {}, db as never);

  assert.equal(result.documents.length, 200);
  assert.equal(result.listCapped, true);
  assert.equal(result.hasDocuments, true);
});

test("dashboard search trims empty queries without hitting the database", async () => {
  let called = false;
  const db = {
    document: {
      async findMany() {
        called = true;
        return [];
      },
    },
  };

  assert.deepEqual(await searchDocumentsForUser("user-1", "   ", db as never), {
    results: [],
    hasMore: false,
  });
  assert.equal(called, false);
});

test("dashboard search maps results and hasMore from the capped result set", async () => {
  const db = {
    document: {
      async findMany(args: { take?: number }) {
        return Array.from({ length: args.take ?? 0 }, (_, index) =>
          row({
            id: `result-${index}`,
            ownerId: "other",
            workspaceId: "ws-1",
            workspace: {
              name: "Search Space",
              ownerId: "owner",
              members: [{ userId: "user-1", role: "VIEWER" }],
            },
          }),
        );
      },
    },
  };

  const result = await searchDocumentsForUser(
    "user-1",
    " roadmap ",
    db as never,
  );
  const first: DashboardDocument = result.results[0]!;

  assert.equal(result.results.length, SEARCH_RESULT_LIMIT);
  assert.equal(result.hasMore, true);
  assert.equal(first.id, "result-0");
  assert.equal(first.canEdit, false);
  assert.equal(first.canManage, false);
  assert.equal(first.workspaceName, "Search Space");
});

test("dashboard search uses one skinny accessible document query", async () => {
  const calls: unknown[] = [];
  const db = {
    document: {
      async findMany(args: unknown) {
        calls.push(args);
        return [];
      },
    },
  };

  const result = await searchDocumentsForUser("user-1", "report", db as never);

  assert.deepEqual(result, { results: [], hasMore: false });
  assert.equal(calls.length, 1);
  const select = (calls[0] as { select: Record<string, unknown> }).select;
  assert.equal(select.contentJson, true);
  assert.equal(select.deckJson, undefined);
  assert.equal(select.content, undefined);
});
