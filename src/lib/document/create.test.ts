import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clampDocumentContent,
  clampDocumentTitle,
  createDocumentFromTemplateForUser,
  importedMarkdownToContentJson,
  templateContentJsonForId,
} from "./create";
import {
  DOCUMENT_CONTENT_MAX_LENGTH,
  DOCUMENT_TITLE_MAX_LENGTH,
} from "@/lib/limits";

test("clampDocumentTitle trims, clamps, and falls back", () => {
  assert.equal(
    clampDocumentTitle("  Quarterly plan  ", "Untitled"),
    "Quarterly plan",
  );
  assert.equal(clampDocumentTitle("   ", "Untitled"), "Untitled");
  assert.equal(
    clampDocumentTitle("x".repeat(DOCUMENT_TITLE_MAX_LENGTH + 5), "Untitled")
      .length,
    DOCUMENT_TITLE_MAX_LENGTH,
  );
});

test("clampDocumentContent uses the shared document content limit", () => {
  assert.equal(
    clampDocumentContent("x".repeat(DOCUMENT_CONTENT_MAX_LENGTH + 5)).length,
    DOCUMENT_CONTENT_MAX_LENGTH,
  );
});

test("importedMarkdownToContentJson produces Lexical document JSON", () => {
  const contentJson = importedMarkdownToContentJson("# Heading");
  assert.equal(typeof contentJson, "object");
  assert.notEqual(contentJson, null);
  assert.equal((contentJson as { root?: unknown }).root !== undefined, true);
});

test("templateContentJsonForId seeds named templates and keeps blank documents empty", () => {
  const seeded = templateContentJsonForId("flowchart");
  assert.equal(typeof seeded, "object");
  assert.match(JSON.stringify(seeded), /Process overview/);
  assert.equal(templateContentJsonForId("blank"), undefined);
  assert.equal(templateContentJsonForId("not-a-template"), undefined);
});

test("createDocumentFromTemplateForUser keeps blank documents owner-only", async () => {
  const calls: unknown[] = [];
  const db = {
    document: {
      async create(args: unknown) {
        calls.push(args);
        return { id: "doc-template" };
      },
    },
  };

  assert.deepEqual(
    await createDocumentFromTemplateForUser("user-1", "blank", db as never),
    { id: "doc-template" },
  );
  assert.deepEqual(calls, [
    { data: { ownerId: "user-1" }, select: { id: true } },
  ]);
});

test("createDocumentFromTemplateForUser persists named template contentJson", async () => {
  const calls: Array<{ data: Record<string, unknown>; select: unknown }> = [];
  const db = {
    document: {
      async create(args: { data: Record<string, unknown>; select: unknown }) {
        calls.push(args);
        return { id: "doc-template" };
      },
    },
  };

  assert.deepEqual(
    await createDocumentFromTemplateForUser("user-1", "flowchart", db as never),
    { id: "doc-template" },
  );
  assert.equal(calls[0]!.data.ownerId, "user-1");
  assert.equal(typeof calls[0]!.data.contentJson, "object");
  assert.match(JSON.stringify(calls[0]!.data.contentJson), /Process overview/);
  assert.deepEqual(calls[0]!.select, { id: true });
});
