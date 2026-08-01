/**
 * Direct contracts for `useOptimisticDocumentTrash` (#1946).
 *
 * `document-list-async-ordering.test.ts` already exhaustively pins the pure
 * sequencing helpers this hook uses to detect stale async responses. This
 * file exercises the React/DOM boundary built on top of them: optimistic
 * removal on delete, rollback + user-facing error message on a failed
 * delete, optimistic restore on undo (+ its own rollback on a failed
 * restore), the undo-window timer (auto-clear after `UNDO_DURATION_MS`,
 * cleared early by a real undo, and cancelled on unmount), and — the
 * highest-value case — that a *stale* rejection from a superseded operation
 * never clobbers a newer operation's outcome for the same document.
 *
 * Mounted directly with `react-test-renderer` (same pattern as
 * `locale-context.test.tsx`) so `startTransition`'s async body can be driven
 * to completion with `await act(async () => { ... })` and the hook's
 * returned snapshot observed across live re-renders (not remounts).
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import type { DashboardDocument } from "@/lib/document/list";

import type { DocumentCardData } from "./document-card";
import { useOptimisticDocumentTrash } from "./use-optimistic-document-trash";

const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const [message] = args;
  if (
    typeof message === "string" &&
    message.startsWith("react-test-renderer is deprecated")
  ) {
    return;
  }
  originalConsoleError(...args);
};
after(() => {
  console.error = originalConsoleError;
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function buildDoc(
  id: string,
  overrides: Partial<DashboardDocument> = {},
): DashboardDocument {
  return {
    id,
    title: `Document ${id}`,
    favorite: false,
    editedLabel: "Edited just now",
    workspaceName: null,
    thumbnail: null,
    excerpt: "",
    readingMinutes: 1,
    createdAtMs: 1_000,
    updatedAtMs: 1_000,
    canEdit: true,
    canManage: true,
    tags: [],
    ...overrides,
  };
}

function cardDataFor(doc: DashboardDocument): DocumentCardData {
  return {
    id: doc.id,
    title: doc.title,
    favorite: doc.favorite,
    editedLabel: doc.editedLabel,
    workspaceName: doc.workspaceName,
    thumbnail: doc.thumbnail,
    excerpt: doc.excerpt,
    readingMinutes: doc.readingMinutes,
    canEdit: doc.canEdit,
    canManage: doc.canManage,
  };
}

/** A manually-resolvable/rejectable promise, for controlling async ordering. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Hook = ReturnType<typeof useOptimisticDocumentTrash>;

function mountHook(
  documents: DashboardDocument[],
  actions: {
    deleteDocument: (id: string) => Promise<void>;
    restoreDocument: (id: string) => Promise<void>;
  },
): { latest(): Hook; unmount(): void } {
  const seen: Hook[] = [];

  function Harness() {
    seen.push(useOptimisticDocumentTrash(documents, actions));
    return null;
  }

  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<Harness />);
  });

  return {
    latest: () => {
      assert.ok(seen.length > 0, "expected the hook to have rendered");
      return seen[seen.length - 1] as Hook;
    },
    unmount: () => act(() => renderer.unmount()),
  };
}

async function flush() {
  await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// Optimistic delete — success path
// ---------------------------------------------------------------------------

test("handleDelete optimistically removes the document and stashes undo data immediately", async () => {
  const docA = buildDoc("doc-a");
  const docB = buildDoc("doc-b");
  const pendingDelete = deferred<void>();
  const mounted = mountHook([docA, docB], {
    deleteDocument: () => pendingDelete.promise,
    restoreDocument: () => Promise.resolve(),
  });

  await act(async () => {
    mounted.latest().handleDelete(cardDataFor(docA));
  });

  const snapshot = mounted.latest();
  assert.deepEqual(
    snapshot.combinedDocuments.map((d) => d.id),
    ["doc-b"],
  );
  assert.equal(snapshot.removedIds.has("doc-a"), true);
  assert.equal(snapshot.undo?.id, "doc-a");
  assert.equal(snapshot.errorMessage, null);

  pendingDelete.resolve();
  await act(async () => {
    await flush();
  });
  mounted.unmount();
});

test("a resolved deleteDocument leaves the optimistic removal in place", async () => {
  const docA = buildDoc("doc-a");
  const pendingDelete = deferred<void>();
  const mounted = mountHook([docA], {
    deleteDocument: () => pendingDelete.promise,
    restoreDocument: () => Promise.resolve(),
  });

  await act(async () => {
    mounted.latest().handleDelete(cardDataFor(docA));
  });

  await act(async () => {
    pendingDelete.resolve();
    await flush();
  });

  const snapshot = mounted.latest();
  assert.deepEqual(snapshot.combinedDocuments, []);
  assert.equal(snapshot.errorMessage, null);
  mounted.unmount();
});

test("same-turn duplicate delete intent submits one server mutation", async () => {
  const docA = buildDoc("doc-a");
  const pendingDelete = deferred<void>();
  let deleteCalls = 0;
  const mounted = mountHook([docA], {
    deleteDocument: () => {
      deleteCalls += 1;
      return pendingDelete.promise;
    },
    restoreDocument: () => Promise.resolve(),
  });

  await act(async () => {
    const card = cardDataFor(docA);
    mounted.latest().handleDelete(card);
    mounted.latest().handleDelete(card);
  });

  assert.equal(deleteCalls, 1);
  assert.deepEqual(mounted.latest().combinedDocuments, []);

  pendingDelete.resolve();
  await act(async () => {
    await flush();
  });
  mounted.unmount();
});

// ---------------------------------------------------------------------------
// Optimistic delete — failure path (rollback + error message)
// ---------------------------------------------------------------------------

test("a rejected deleteDocument restores the document and surfaces an error message", async () => {
  const docA = buildDoc("doc-a", { title: "Roadmap" });
  const pendingDelete = deferred<void>();
  const mounted = mountHook([docA], {
    deleteDocument: () => pendingDelete.promise,
    restoreDocument: () => Promise.resolve(),
  });

  await act(async () => {
    mounted.latest().handleDelete(cardDataFor(docA));
  });
  assert.deepEqual(mounted.latest().combinedDocuments, []);

  await act(async () => {
    pendingDelete.reject(new Error("network down"));
    await flush();
  });

  const snapshot = mounted.latest();
  assert.deepEqual(
    snapshot.combinedDocuments.map((d) => d.id),
    ["doc-a"],
  );
  assert.equal(snapshot.removedIds.has("doc-a"), false);
  assert.equal(snapshot.undo, null);
  assert.equal(
    snapshot.errorMessage,
    "Could not move the document to trash. It was restored.",
  );
  mounted.unmount();
});

// ---------------------------------------------------------------------------
// Optimistic undo — success and failure paths
// ---------------------------------------------------------------------------

test("handleUndo optimistically restores the document and clears the undo affordance", async () => {
  const docA = buildDoc("doc-a");
  const pendingRestore = deferred<void>();
  const mounted = mountHook([docA], {
    deleteDocument: () => Promise.resolve(),
    restoreDocument: () => pendingRestore.promise,
  });

  await act(async () => {
    mounted.latest().handleDelete(cardDataFor(docA));
    await flush();
  });
  assert.deepEqual(mounted.latest().combinedDocuments, []);

  await act(async () => {
    mounted.latest().handleUndo();
  });

  const snapshot = mounted.latest();
  assert.deepEqual(
    snapshot.combinedDocuments.map((d) => d.id),
    ["doc-a"],
  );
  assert.equal(snapshot.undo, null);
  assert.equal(snapshot.errorMessage, null);

  pendingRestore.resolve();
  await act(async () => {
    await flush();
  });
  mounted.unmount();
});

test("undo waits for the pending delete mutation before submitting restore", async () => {
  const docA = buildDoc("doc-a");
  const pendingDelete = deferred<void>();
  const pendingRestore = deferred<void>();
  const calls: string[] = [];
  const mounted = mountHook([docA], {
    deleteDocument: () => {
      calls.push("delete");
      return pendingDelete.promise;
    },
    restoreDocument: () => {
      calls.push("restore");
      return pendingRestore.promise;
    },
  });

  await act(async () => {
    mounted.latest().handleDelete(cardDataFor(docA));
  });
  await act(async () => {
    mounted.latest().handleUndo();
  });

  assert.deepEqual(calls, ["delete"]);
  assert.deepEqual(
    mounted.latest().combinedDocuments.map((document) => document.id),
    ["doc-a"],
  );

  pendingDelete.resolve();
  await act(async () => {
    await flush();
  });
  assert.deepEqual(calls, ["delete", "restore"]);

  pendingRestore.resolve();
  await act(async () => {
    await flush();
  });
  mounted.unmount();
});

test("handleUndo is a no-op when there is nothing to undo", async () => {
  const docA = buildDoc("doc-a");
  const mounted = mountHook([docA], {
    deleteDocument: () => Promise.resolve(),
    restoreDocument: () => Promise.resolve(),
  });

  await act(async () => {
    mounted.latest().handleUndo();
  });

  const snapshot = mounted.latest();
  assert.deepEqual(
    snapshot.combinedDocuments.map((d) => d.id),
    ["doc-a"],
  );
  assert.equal(snapshot.undo, null);
  mounted.unmount();
});

test("a rejected restoreDocument re-removes the document and surfaces its own error message", async () => {
  const docA = buildDoc("doc-a");
  const pendingRestore = deferred<void>();
  const mounted = mountHook([docA], {
    deleteDocument: () => Promise.resolve(),
    restoreDocument: () => pendingRestore.promise,
  });

  await act(async () => {
    mounted.latest().handleDelete(cardDataFor(docA));
    await flush();
  });
  await act(async () => {
    mounted.latest().handleUndo();
  });
  assert.deepEqual(
    mounted.latest().combinedDocuments.map((d) => d.id),
    ["doc-a"],
  );

  await act(async () => {
    pendingRestore.reject(new Error("restore failed"));
    await flush();
  });

  const snapshot = mounted.latest();
  assert.deepEqual(snapshot.combinedDocuments, []);
  assert.equal(snapshot.removedIds.has("doc-a"), true);
  assert.equal(
    snapshot.errorMessage,
    "Could not restore the document. It remains in trash.",
  );
  mounted.unmount();
});

// ---------------------------------------------------------------------------
// Async ordering — a stale rejection must never clobber a newer operation
// ---------------------------------------------------------------------------

test("a stale delete rejection is ignored once a newer undo has already superseded it, but a rejection of the CURRENT operation still applies", async () => {
  const docA = buildDoc("doc-a");
  const pendingDelete = deferred<void>();
  const pendingRestore = deferred<void>();
  const mounted = mountHook([docA], {
    deleteDocument: () => pendingDelete.promise,
    restoreDocument: () => pendingRestore.promise,
  });

  // Operation 1: delete (in flight, never resolved directly).
  await act(async () => {
    mounted.latest().handleDelete(cardDataFor(docA));
  });
  assert.deepEqual(mounted.latest().combinedDocuments, []);

  // Operation 2: undo, superseding operation 1 for the same document — also
  // left in flight.
  await act(async () => {
    mounted.latest().handleUndo();
  });
  assert.deepEqual(
    mounted.latest().combinedDocuments.map((d) => d.id),
    ["doc-a"],
  );

  // The STALE operation 1 (delete) now rejects. Because operation 2 has
  // already been recorded as the latest for this document, this rejection
  // must be a no-op: the document must stay restored, with no error message.
  await act(async () => {
    pendingDelete.reject(new Error("stale delete failure"));
    await flush();
  });

  let snapshot = mounted.latest();
  assert.deepEqual(
    snapshot.combinedDocuments.map((d) => d.id),
    ["doc-a"],
    "a stale delete rejection must not re-remove the document",
  );
  assert.equal(snapshot.removedIds.has("doc-a"), false);
  assert.equal(
    snapshot.errorMessage,
    null,
    "a stale delete rejection must not surface an error message",
  );

  // Now the CURRENT operation (the undo/restore) rejects — this one must
  // still apply its own rollback.
  await act(async () => {
    pendingRestore.reject(new Error("restore failed"));
    await flush();
  });

  snapshot = mounted.latest();
  assert.deepEqual(snapshot.combinedDocuments, []);
  assert.equal(snapshot.removedIds.has("doc-a"), true);
  assert.equal(
    snapshot.errorMessage,
    "Could not restore the document. It remains in trash.",
  );
  mounted.unmount();
});

// ---------------------------------------------------------------------------
// Undo-window timer
// ---------------------------------------------------------------------------

test("the undo affordance auto-clears after the undo window elapses", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const docA = buildDoc("doc-a");
  const mounted = mountHook([docA], {
    deleteDocument: () => new Promise(() => {}),
    restoreDocument: () => Promise.resolve(),
  });

  await act(async () => {
    mounted.latest().handleDelete(cardDataFor(docA));
  });
  assert.equal(mounted.latest().undo?.id, "doc-a");

  await act(async () => {
    t.mock.timers.tick(6000);
  });

  assert.equal(mounted.latest().undo, null);
  mounted.unmount();
});

test("a second delete before the undo window elapses resets the timer for the new undo target", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const docA = buildDoc("doc-a");
  const docB = buildDoc("doc-b");
  const mounted = mountHook([docA, docB], {
    deleteDocument: () => new Promise(() => {}),
    restoreDocument: () => Promise.resolve(),
  });

  await act(async () => {
    mounted.latest().handleDelete(cardDataFor(docA));
  });
  await act(async () => {
    t.mock.timers.tick(3000);
  });
  await act(async () => {
    mounted.latest().handleDelete(cardDataFor(docB));
  });
  assert.equal(mounted.latest().undo?.id, "doc-b");

  // Only 3s further elapsed since docB's delete (< 6s window) — still shown.
  await act(async () => {
    t.mock.timers.tick(3000);
  });
  assert.equal(mounted.latest().undo?.id, "doc-b");

  // Now past docB's own 6s window.
  await act(async () => {
    t.mock.timers.tick(3000);
  });
  assert.equal(mounted.latest().undo, null);
  mounted.unmount();
});

test("unmounting cancels the pending undo-window timer", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const docA = buildDoc("doc-a");
  const mounted = mountHook([docA], {
    deleteDocument: () => new Promise(() => {}),
    restoreDocument: () => Promise.resolve(),
  });

  await act(async () => {
    mounted.latest().handleDelete(cardDataFor(docA));
  });

  mounted.unmount();

  // Ticking well past the undo window must not throw or resurrect state on
  // an unmounted tree (setUndo(null) would be a no-op React error otherwise).
  assert.doesNotThrow(() => t.mock.timers.tick(10_000));
});
