import assert from "node:assert/strict";
import { test } from "node:test";

import {
  renameDocumentTitle,
  toggleDocumentFavorite,
} from "@/lib/document/mutations";

// ---------------------------------------------------------------------------
// renameDocumentTitle
// ---------------------------------------------------------------------------

test("renameDocumentTitle calls updateMany with exact where and data", async () => {
  const calls: unknown[] = [];
  const db = {
    document: {
      async updateMany(args: unknown) {
        calls.push(args);
        return { count: 1 };
      },
    },
  };

  await renameDocumentTitle("doc-1", "New Title", db as never);

  assert.equal(calls.length, 1);
  const call = calls[0] as {
    where: { id: string };
    data: { title: string };
  };
  assert.deepEqual(call.where, { id: "doc-1" });
  assert.deepEqual(call.data, { title: "New Title" });
});

test("renameDocumentTitle issues exactly one write", async () => {
  const calls: unknown[] = [];
  const db = {
    document: {
      async updateMany(args: unknown) {
        calls.push(args);
        return { count: 1 };
      },
    },
  };

  await renameDocumentTitle("doc-2", "Title", db as never);

  assert.equal(calls.length, 1);
});

test("renameDocumentTitle passes empty title to updateMany without pre-validation", async () => {
  const calls: unknown[] = [];
  const db = {
    document: {
      async updateMany(args: unknown) {
        calls.push(args);
        return { count: 0 };
      },
    },
  };

  await renameDocumentTitle("doc-3", "", db as never);

  assert.equal(calls.length, 1);
  const call = calls[0] as { data: { title: string } };
  assert.equal(call.data.title, "");
});

test("renameDocumentTitle propagates DB errors without swallowing", async () => {
  const boom = new Error("DB connection lost");
  const db = {
    document: {
      async updateMany() {
        throw boom;
      },
    },
  };

  await assert.rejects(
    () => renameDocumentTitle("doc-err", "Title", db as never),
    boom,
  );
});

// ---------------------------------------------------------------------------
// toggleDocumentFavorite — not-found / trashed paths
// ---------------------------------------------------------------------------

test("toggleDocumentFavorite returns { favorite: false } when document is not found", async () => {
  const updateCalls: unknown[] = [];
  const db = {
    document: {
      async findFirst() {
        return null;
      },
      async updateMany(args: unknown) {
        updateCalls.push(args);
        return { count: 0 };
      },
    },
  };

  const result = await toggleDocumentFavorite("missing-doc", db as never);

  assert.deepEqual(result, { favorite: false });
  assert.equal(updateCalls.length, 0, "must not write when document is absent");
});

test("toggleDocumentFavorite issues no updateMany when document is not found", async () => {
  const updateCalls: unknown[] = [];
  const db = {
    document: {
      async findFirst() {
        return null;
      },
      async updateMany(args: unknown) {
        updateCalls.push(args);
      },
    },
  };

  await toggleDocumentFavorite("trashed-doc", db as never);

  assert.equal(updateCalls.length, 0);
});

// ---------------------------------------------------------------------------
// toggleDocumentFavorite — findFirst query contract
// ---------------------------------------------------------------------------

test("toggleDocumentFavorite passes exact where and select to findFirst", async () => {
  const findCalls: unknown[] = [];
  const db = {
    document: {
      async findFirst(args: unknown) {
        findCalls.push(args);
        return null;
      },
      async updateMany() {
        return { count: 0 };
      },
    },
  };

  await toggleDocumentFavorite("doc-find", db as never);

  assert.equal(findCalls.length, 1);
  const call = findCalls[0] as {
    where: { id: string; deletedAt: null };
    select: { favorite: boolean };
  };
  assert.deepEqual(call.where, { id: "doc-find", deletedAt: null });
  assert.deepEqual(call.select, { favorite: true });
});

// ---------------------------------------------------------------------------
// toggleDocumentFavorite — flip-then-write paths
// ---------------------------------------------------------------------------

test("toggleDocumentFavorite flips false → true, writes, and returns { favorite: true }", async () => {
  const updateCalls: unknown[] = [];
  const db = {
    document: {
      async findFirst() {
        return { favorite: false };
      },
      async updateMany(args: unknown) {
        updateCalls.push(args);
        return { count: 1 };
      },
    },
  };

  const result = await toggleDocumentFavorite("doc-off", db as never);

  assert.deepEqual(result, { favorite: true });
  assert.equal(updateCalls.length, 1);
  const call = updateCalls[0] as {
    where: { id: string };
    data: { favorite: boolean };
  };
  assert.deepEqual(call.where, { id: "doc-off" });
  assert.deepEqual(call.data, { favorite: true });
});

test("toggleDocumentFavorite flips true → false, writes, and returns { favorite: false }", async () => {
  const updateCalls: unknown[] = [];
  const db = {
    document: {
      async findFirst() {
        return { favorite: true };
      },
      async updateMany(args: unknown) {
        updateCalls.push(args);
        return { count: 1 };
      },
    },
  };

  const result = await toggleDocumentFavorite("doc-on", db as never);

  assert.deepEqual(result, { favorite: false });
  assert.equal(updateCalls.length, 1);
  const call = updateCalls[0] as {
    where: { id: string };
    data: { favorite: boolean };
  };
  assert.deepEqual(call.where, { id: "doc-on" });
  assert.deepEqual(call.data, { favorite: false });
});

test("toggleDocumentFavorite issues exactly one write on a found document", async () => {
  const updateCalls: unknown[] = [];
  const db = {
    document: {
      async findFirst() {
        return { favorite: false };
      },
      async updateMany(args: unknown) {
        updateCalls.push(args);
        return { count: 1 };
      },
    },
  };

  await toggleDocumentFavorite("doc-count", db as never);

  assert.equal(updateCalls.length, 1);
});

// ---------------------------------------------------------------------------
// toggleDocumentFavorite — error propagation
// ---------------------------------------------------------------------------

test("toggleDocumentFavorite propagates findFirst DB errors", async () => {
  const boom = new Error("findFirst failed");
  const db = {
    document: {
      async findFirst() {
        throw boom;
      },
      async updateMany() {
        return { count: 0 };
      },
    },
  };

  await assert.rejects(
    () => toggleDocumentFavorite("doc-err-find", db as never),
    boom,
  );
});

test("toggleDocumentFavorite propagates updateMany DB errors", async () => {
  const boom = new Error("updateMany failed");
  const db = {
    document: {
      async findFirst() {
        return { favorite: false };
      },
      async updateMany() {
        throw boom;
      },
    },
  };

  await assert.rejects(
    () => toggleDocumentFavorite("doc-err-update", db as never),
    boom,
  );
});
