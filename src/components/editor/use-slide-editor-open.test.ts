import assert from "node:assert/strict";
import test from "node:test";

import type { ActionResult } from "@/lib/action-result";
import { createBlankDeck } from "@/lib/presentation/empty-deck";
import type { Deck } from "@/lib/presentation/schema";

import {
  applyAiDeckProposal,
  createSerializedDeckPersistor,
  createDeckAutosaveOnDue,
  persistDeckWithRecovery,
} from "./use-slide-editor-open";

function waitForAsyncDrain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function createDeferred<T>() {
  let resolve: ((value: T | PromiseLike<T>) => void) | null = null;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return {
    promise,
    resolve: (value: T) => resolve?.(value),
  };
}

test("persistDeckWithRecovery clears saving after rejected deck writes", async () => {
  const deck = createBlankDeck({ documentId: "doc-1413" });
  const savingStates: boolean[] = [];
  const dirtyStates: boolean[] = [];
  const saveErrors: Array<string | null> = [];
  const conflicts: unknown[] = [];
  const revisionTokenRef = { current: "rev-1" as string | null };
  const lastSavedRef = { current: { preserved: true } as unknown };

  const result = await persistDeckWithRecovery({
    updatedDeck: deck,
    documentId: "doc-1413",
    deckPort: {
      saveDeckJson: async () =>
        Promise.reject(new Error("network unavailable")),
    },
    revisionTokenRef,
    lastSavedRef,
    aiAppliedDeckRef: { current: null },
    setDirty: (dirty) => dirtyStates.push(dirty),
    setSaving: (saving) => savingStates.push(saving),
    setSaveError: (error) => saveErrors.push(error),
    setConflictState: (state) => conflicts.push(state),
    onAiDeckSaved: () => {
      throw new Error("unexpected telemetry call");
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /network unavailable/);
  }
  assert.deepEqual(savingStates, [true, false]);
  assert.deepEqual(dirtyStates, []);
  assert.deepEqual(conflicts, []);
  assert.equal(revisionTokenRef.current, "rev-1");
  assert.deepEqual(lastSavedRef.current, { preserved: true });
  assert.equal(saveErrors[0], null);
  assert.match(saveErrors.at(-1) ?? "", /network unavailable/);
});

test("persistDeckWithRecovery keeps conflict result semantics", async () => {
  const deck = createBlankDeck({ documentId: "doc-1413" });
  const conflicts: unknown[] = [];
  const saveErrors: Array<string | null> = [];

  const result = await persistDeckWithRecovery({
    updatedDeck: deck,
    documentId: "doc-1413",
    deckPort: {
      saveDeckJson: async () => ({
        ok: "conflict",
        serverRevisionToken: "server-rev-2",
      }),
    },
    revisionTokenRef: { current: "rev-1" },
    lastSavedRef: { current: null },
    aiAppliedDeckRef: { current: null },
    setDirty: () => undefined,
    setSaving: () => undefined,
    setSaveError: (error) => saveErrors.push(error),
    setConflictState: (state) => conflicts.push(state),
    onAiDeckSaved: () => undefined,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /Save conflict/);
  }
  assert.equal(saveErrors.at(-1), result.ok ? null : result.error);
  assert.deepEqual(conflicts, [
    {
      localDeck: deck,
      serverRevisionToken: "server-rev-2",
    },
  ]);
});

test("persistDeckWithRecovery only uses saveDeckJson autosave path", async () => {
  const deck = createBlankDeck({ documentId: "doc-1336" });
  let saveDeckJsonCalls = 0;
  let saveDeckPatchCalls = 0;
  const deckPort = {
    saveDeckJson: async () => {
      saveDeckJsonCalls += 1;
      return { ok: true, revisionToken: "rev-2" } as const;
    },
    saveDeckPatch: async () => {
      saveDeckPatchCalls += 1;
      return { ok: "fallback" } as const;
    },
  };

  const result = await persistDeckWithRecovery({
    updatedDeck: deck,
    documentId: "doc-1336",
    deckPort,
    revisionTokenRef: { current: "rev-1" },
    lastSavedRef: { current: null },
    aiAppliedDeckRef: { current: null },
    setDirty: () => undefined,
    setSaving: () => undefined,
    setSaveError: () => undefined,
    setConflictState: () => undefined,
    onAiDeckSaved: () => undefined,
  });

  assert.equal(result.ok, true);
  assert.equal(saveDeckJsonCalls, 1);
  assert.equal(saveDeckPatchCalls, 0);
});

test("createDeckAutosaveOnDue catches rejected autosave saves and logs them", async () => {
  const deck = createBlankDeck({ documentId: "doc-1413" });
  const logs: Array<{ scope: string; message: string; context: unknown }> = [];
  const handler = createDeckAutosaveOnDue({
    persistDeck: async () =>
      Promise.reject(new Error("session expired")) as Promise<ActionResult>,
    log: (scope, message, context) => {
      logs.push({ scope, message, context });
    },
  });

  handler(deck);
  await waitForAsyncDrain();

  assert.equal(logs.length, 1);
  assert.deepEqual(logs[0].scope, "editor.slide-editor");
  assert.deepEqual(logs[0].message, "presentation-autosave-error");
  assert.match(JSON.stringify(logs[0].context), /session expired/);
});

test("createSerializedDeckPersistor serializes overlapping saves and uses refreshed revision tokens", async () => {
  const firstDeck = createBlankDeck({ documentId: "doc-1408" });
  const secondDeck = createBlankDeck({ documentId: "doc-1408" });
  const revisionTokenRef = { current: "rev-1" as string | null };
  const latestRequestIdRef = { current: 0 };
  const gate = createDeferred<void>();
  const saveCalls: Array<{ token: string | null | undefined; deck: unknown }> =
    [];
  const dirtyStates: boolean[] = [];

  type QueuedDeckSave = { deck: Deck; requestId: number };

  const persistDeck = createSerializedDeckPersistor<QueuedDeckSave>({
    persistDeck: ({ deck: updatedDeck, requestId }) =>
      persistDeckWithRecovery({
        updatedDeck,
        documentId: "doc-1408",
        deckPort: {
          saveDeckJson: async (_documentId, deckJson, revisionToken) => {
            saveCalls.push({ token: revisionToken, deck: deckJson });
            if (saveCalls.length === 1) {
              await gate.promise;
              return { ok: true, revisionToken: "rev-2" };
            }
            return { ok: true, revisionToken: "rev-3" };
          },
        },
        revisionTokenRef,
        lastSavedRef: { current: null },
        aiAppliedDeckRef: { current: null },
        setDirty: (dirty) => dirtyStates.push(dirty),
        setSaving: () => undefined,
        setSaveError: () => undefined,
        setConflictState: () => undefined,
        onAiDeckSaved: () => undefined,
        shouldApplyCompletionState: () =>
          latestRequestIdRef.current === requestId,
      }),
  });

  latestRequestIdRef.current += 1;
  const firstSave = persistDeck({
    deck: firstDeck,
    requestId: latestRequestIdRef.current,
  });
  latestRequestIdRef.current += 1;
  const secondSave = persistDeck({
    deck: secondDeck,
    requestId: latestRequestIdRef.current,
  });

  await waitForAsyncDrain();
  assert.equal(saveCalls.length, 1);
  assert.equal(saveCalls[0]?.token, "rev-1");

  gate.resolve(undefined);
  const [firstResult, secondResult] = await Promise.all([
    firstSave,
    secondSave,
  ]);

  assert.equal(firstResult.ok, true);
  assert.equal(secondResult.ok, true);
  assert.equal(saveCalls.length, 2);
  assert.equal(saveCalls[1]?.token, "rev-2");
  assert.equal(saveCalls[1]?.deck, secondDeck);
  assert.deepEqual(dirtyStates, [false]);
  assert.equal(revisionTokenRef.current, "rev-3");
});

test("createSerializedDeckPersistor ignores stale conflict outcomes once newer deck save is queued", async () => {
  const firstDeck = createBlankDeck({ documentId: "doc-1404" });
  const secondDeck = createBlankDeck({ documentId: "doc-1404" });
  const revisionTokenRef = { current: "rev-1" as string | null };
  const latestRequestIdRef = { current: 0 };
  const gate = createDeferred<void>();
  const saveErrors: Array<string | null> = [];
  const conflicts: unknown[] = [];

  type QueuedDeckSave = { deck: Deck; requestId: number };

  const persistDeck = createSerializedDeckPersistor<QueuedDeckSave>({
    persistDeck: ({ deck: updatedDeck, requestId }) =>
      persistDeckWithRecovery({
        updatedDeck,
        documentId: "doc-1404",
        deckPort: {
          saveDeckJson: async (_documentId, _deckJson, revisionToken) => {
            if (revisionToken === "rev-1") {
              await gate.promise;
              return { ok: "conflict", serverRevisionToken: "server-rev-2" };
            }
            return { ok: true, revisionToken: "rev-3" };
          },
        },
        revisionTokenRef,
        lastSavedRef: { current: null },
        aiAppliedDeckRef: { current: null },
        setDirty: () => undefined,
        setSaving: () => undefined,
        setSaveError: (error) => saveErrors.push(error),
        setConflictState: (state) => conflicts.push(state),
        onAiDeckSaved: () => undefined,
        shouldApplyCompletionState: () =>
          latestRequestIdRef.current === requestId,
      }),
  });

  latestRequestIdRef.current += 1;
  const firstSave = persistDeck({
    deck: firstDeck,
    requestId: latestRequestIdRef.current,
  });
  latestRequestIdRef.current += 1;
  const secondSave = persistDeck({
    deck: secondDeck,
    requestId: latestRequestIdRef.current,
  });

  await waitForAsyncDrain();
  gate.resolve(undefined);
  const [firstResult, secondResult] = await Promise.all([
    firstSave,
    secondSave,
  ]);

  assert.equal(firstResult.ok, false);
  assert.equal(secondResult.ok, false);
  assert.equal(revisionTokenRef.current, "rev-1");
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0], {
    localDeck: secondDeck,
    serverRevisionToken: "server-rev-2",
  });
  assert.match(saveErrors.at(-1) ?? "", /Save conflict/);
});

test("applyAiDeckProposal opens AI deck as dirty and persists immediately", async () => {
  const aiDeck = createBlankDeck({ documentId: "doc-1341" });
  const aiAppliedDeckRef = { current: null as Deck | null };
  const persistedDecks: Deck[] = [];
  const dirtyStates: boolean[] = [];
  const finished: Array<{ deck: Deck; diagnostics: unknown[] | undefined }> =
    [];
  let canceledAutosave = 0;

  applyAiDeckProposal({
    aiDeck,
    aiAppliedDeckRef,
    generationDiagnostics: [],
    enterRecovery: () => {
      throw new Error("unexpected recovery path");
    },
    finishOpen: (deck, diagnostics) => {
      finished.push({ deck, diagnostics });
    },
    cancelAutosave: () => {
      canceledAutosave += 1;
    },
    setDirty: (dirty) => dirtyStates.push(dirty),
    persistDeck: async (deck) => {
      persistedDecks.push(deck);
      return { ok: true, data: undefined };
    },
  });

  await waitForAsyncDrain();

  assert.equal(canceledAutosave, 1);
  assert.deepEqual(dirtyStates, [true]);
  assert.equal(finished.length, 1);
  assert.equal(persistedDecks.length, 1);
  assert.equal(aiAppliedDeckRef.current, persistedDecks[0]);
  assert.equal(finished[0]?.deck, persistedDecks[0]);
});

test("applyAiDeckProposal keeps malformed AI decks in recovery path", () => {
  let recoveryCalls = 0;
  let persistCalls = 0;
  let finishCalls = 0;
  let dirtyCalls = 0;
  let cancelCalls = 0;
  const aiAppliedDeckRef = { current: null as Deck | null };

  applyAiDeckProposal({
    aiDeck: invalidDeck({ invalid: true }),
    aiAppliedDeckRef,
    generationDiagnostics: [],
    enterRecovery: () => {
      recoveryCalls += 1;
    },
    finishOpen: () => {
      finishCalls += 1;
    },
    cancelAutosave: () => {
      cancelCalls += 1;
    },
    setDirty: () => {
      dirtyCalls += 1;
    },
    persistDeck: async () => {
      persistCalls += 1;
      return { ok: true, data: undefined };
    },
  });

  assert.equal(recoveryCalls, 1);
  assert.equal(finishCalls, 0);
  assert.equal(cancelCalls, 0);
  assert.equal(dirtyCalls, 0);
  assert.equal(persistCalls, 0);
  assert.equal(aiAppliedDeckRef.current, null);
});
function invalidDeck(value: unknown): Deck {
  return value as unknown as Deck;
}
