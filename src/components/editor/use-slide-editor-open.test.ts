import assert from "node:assert/strict";
import test from "node:test";

import { createBlankDeck } from "@/lib/presentation/empty-deck";
import type { Deck } from "@/lib/presentation/schema";

import {
  applyAiDeckProposal,
  persistDeckWithRecovery,
  resolveDeckSaveRejectionError,
} from "./use-slide-editor-open";

function waitForAsyncDrain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test("resolveDeckSaveRejectionError adds fallback details only for non-empty errors", () => {
  assert.equal(
    resolveDeckSaveRejectionError(new Error("")),
    "Couldn't save your deck. Check your connection and retry.",
  );
  assert.equal(
    resolveDeckSaveRejectionError("disk full"),
    "Couldn't save your deck. Check your connection and retry. (disk full)",
  );
});

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

test("persistDeckWithRecovery uses only the full-deck autosave port", async () => {
  const deck = createBlankDeck({ documentId: "doc-1336" });
  let saveDeckJsonCalls = 0;
  const deckPort = {
    saveDeckJson: async () => {
      saveDeckJsonCalls += 1;
      return { ok: true, revisionToken: "rev-2" } as const;
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
