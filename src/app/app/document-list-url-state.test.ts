import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyDocumentListViewState,
  filterDocumentsByTag,
  filterDocumentsByView,
  parseSort,
  parseTag,
  parseView,
  replaceDocumentListQueryState,
  sortDocuments,
} from "./document-list-url-state";

type TestDocument = Parameters<typeof applyDocumentListViewState>[0][number];
type MutableGlobalWindow = Omit<typeof globalThis, "window"> & {
  window: unknown;
};

function setTestWindow(window: unknown): void {
  (globalThis as MutableGlobalWindow).window = window;
}

function doc(id: string, overrides: Partial<TestDocument> = {}): TestDocument {
  return {
    id,
    title: id,
    favorite: false,
    editedLabel: "Jan 1, 2026",
    workspaceName: null,
    thumbnail: null,
    excerpt: "",
    readingMinutes: 1,
    createdAtMs: 1,
    updatedAtMs: 1,
    canEdit: true,
    canManage: true,
    tags: [],
    ...overrides,
  };
}

test("parseSort keeps URL sort state client-local with a safe default", () => {
  assert.equal(parseSort("title"), "title");
  assert.equal(parseSort(null), "edited");
  assert.equal(parseSort("unknown"), "edited");
});

test("parseView keeps URL favorite state client-local with a safe default", () => {
  assert.equal(parseView("favorites"), "favorites");
  assert.equal(parseView("all"), "all");
  assert.equal(parseView("unknown"), "all");
});

test("parseTag accepts only tags available in client list state", () => {
  const tags = [{ slug: "design" }, { slug: "planning" }];

  assert.equal(parseTag("design", tags), "design");
  assert.equal(parseTag("missing", tags), null);
  assert.equal(parseTag(null, tags), null);
});

test("applyDocumentListViewState filters tags and favorites in client view state", () => {
  const documents = [
    doc("alpha", {
      favorite: true,
      tags: [{ slug: "design", name: "Design" }],
      updatedAtMs: 3,
    }),
    doc("beta", {
      favorite: false,
      tags: [{ slug: "design", name: "Design" }],
      updatedAtMs: 2,
    }),
    doc("gamma", {
      favorite: true,
      tags: [{ slug: "planning", name: "Planning" }],
      updatedAtMs: 1,
    }),
  ];

  const visible = applyDocumentListViewState(documents, {
    sort: "edited",
    view: "favorites",
    tagSlug: "design",
  });

  assert.deepEqual(
    visible.map((document) => document.id),
    ["alpha"],
  );
});

test("applyDocumentListViewState sorts title view state without changing input", () => {
  const documents = [doc("b", { title: "Beta" }), doc("a", { title: "Alpha" })];

  const visible = applyDocumentListViewState(documents, {
    sort: "title",
    view: "all",
    tagSlug: null,
  });

  assert.deepEqual(
    visible.map((document) => document.title),
    ["Alpha", "Beta"],
  );
  assert.deepEqual(
    documents.map((document) => document.title),
    ["Beta", "Alpha"],
  );
});

test("replaceDocumentListQueryState replaces the URL with mutated query params", () => {
  const originalWindow = globalThis.window;
  const calls: Array<[unknown, string, string]> = [];
  setTestWindow({
    history: {
      replaceState: (...args: [unknown, string, string]) => calls.push(args),
    },
  });

  try {
    replaceDocumentListQueryState(
      "/app",
      new URLSearchParams("sort=title&page=2"),
      (params) => {
        params.set("view", "favorites");
        params.delete("page");
      },
    );

    assert.deepEqual(calls, [[null, "", "/app?sort=title&view=favorites"]]);

    replaceDocumentListQueryState(
      "/app",
      new URLSearchParams("sort=title"),
      (params) => params.delete("sort"),
    );

    assert.deepEqual(calls[1], [null, "", "/app"]);
  } finally {
    setTestWindow(originalWindow);
  }
});

test("replaceDocumentListQueryState accepts search param facades from client hooks", () => {
  const originalWindow = globalThis.window;
  const calls: Array<[unknown, string, string]> = [];
  const searchParams = {
    get(name: string) {
      return name === "sort" ? "created" : null;
    },
    entries() {
      return new Map([
        ["sort", "created"],
        ["view", "favorites"],
      ]).entries();
    },
  };
  setTestWindow({
    history: {
      replaceState: (...args: [unknown, string, string]) => calls.push(args),
    },
  });

  try {
    assert.equal(searchParams.get("sort"), "created");
    replaceDocumentListQueryState("/app", searchParams, (params) => {
      params.delete("view");
    });

    assert.deepEqual(calls, [[null, "", "/app?sort=created"]]);
  } finally {
    setTestWindow(originalWindow);
  }
});

test("sortDocuments handles created sort and favorites-first grouping", () => {
  const documents = [
    doc("old-favorite", { favorite: true, createdAtMs: 1 }),
    doc("new-regular", { favorite: false, createdAtMs: 3 }),
    doc("new-favorite", { favorite: true, createdAtMs: 2 }),
  ];

  assert.deepEqual(
    sortDocuments(documents, "created", true).map((document) => document.id),
    ["new-favorite", "old-favorite", "new-regular"],
  );
  assert.deepEqual(
    sortDocuments(documents, "created", false).map((document) => document.id),
    ["new-regular", "new-favorite", "old-favorite"],
  );
});

test("filterDocuments helpers return original list for all-view filters", () => {
  const documents = [doc("alpha"), doc("beta", { favorite: true })];

  assert.equal(filterDocumentsByTag(documents, null), documents);
  assert.equal(filterDocumentsByView(documents, "all"), documents);
});

test("filterDocumentsByView returns only favorite documents for favorites view", () => {
  const documents = [doc("alpha"), doc("beta", { favorite: true })];

  assert.deepEqual(
    filterDocumentsByView(documents, "favorites").map(
      (document) => document.id,
    ),
    ["beta"],
  );
});
