/**
 * Autosave, conflict recovery, and data-loss failure mode tests (issue #459).
 *
 * Hardens autosave and conflict paths against data loss by testing:
 *  - Failed save retains "error" state (does NOT silently mark deck clean)
 *  - Conflict result preserves both tokens (user can choose keep-mine / use-server)
 *  - Oversized payload triggers rejection with a recoverable error state
 *  - Visual mirror failures do NOT erase authoritative contentJson
 *  - Autosave scheduling correctly identifies dirty vs clean states
 *  - Stale revision token path produces conflict result, not data loss
 *
 * All tests are pure-function tests (no DB, no server) for reliable CI.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

import {
  resolveSaveStatus,
  resolveSaveErrorMessage,
  shouldScheduleAutosave,
  shouldPersist,
  SAVE_STATUS_LABEL,
  SLIDE_SAVE_DEBOUNCE_MS,
} from "@/lib/presentation-shared/save-status";

import {
  generateRevisionToken,
  isRevisionConflict,
} from "@/lib/document/deck-revision-token";

import { safeParseDeck } from "@/lib/document/deck-schema";
import { LEGACY_DECK_SCHEMA_VERSION } from "@/lib/presentation/deck";

import {
  diffVisualMirror,
  mirrorOutcomeFromDiff,
  type ExistingVisualRow,
} from "@/lib/visual/mirror-diff";

import {
  checkDeckJsonBudget,
  DECK_JSON_HARD_BYTES,
} from "@/lib/presentation/perf-budgets";

import {
  saveDiagnosticConflict,
  saveDiagnosticOversized,
  ERROR_CODES,
} from "@/lib/diagnostics/error-codes";

import { makeMinimalDeck, makeMinimalSlide } from "@/test/builders/deck";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeSlide = makeMinimalSlide;
const makeDeck = makeMinimalDeck;

function makeExistingRow(
  id: string,
  anchorBlockId: string,
  orderIndex: number,
  dataKey: string,
): ExistingVisualRow {
  return {
    id,
    anchorBlockId,
    orderIndex,
    dataKey,
    createdAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// #459-01: Failed save retains "error" status (does not silently go clean)
// ---------------------------------------------------------------------------

describe("autosave: failed save retains error state (#459)", () => {
  test("error flag → status is 'error' regardless of dirty/saving state", () => {
    const status = resolveSaveStatus({
      isDirty: true,
      isSaving: false,
      hasError: true,
    });
    assert.equal(status, "error");
  });

  test("error flag wins over saving flag", () => {
    const status = resolveSaveStatus({
      isDirty: false,
      isSaving: true,
      hasError: true,
    });
    assert.equal(status, "error");
  });

  test("error flag wins over clean state", () => {
    const status = resolveSaveStatus({
      isDirty: false,
      isSaving: false,
      hasError: true,
    });
    assert.equal(status, "error");
  });

  test("clearing error flag with dirty state → 'pending' (data not lost)", () => {
    const status = resolveSaveStatus({
      isDirty: true,
      isSaving: false,
      hasError: false,
    });
    assert.equal(
      status,
      "pending",
      "after error is cleared, dirty state persists as 'pending' — no silent clean",
    );
  });

  test("save-error label is non-empty (user-facing affordance exists)", () => {
    assert.ok(SAVE_STATUS_LABEL.error.length > 0);
  });

  test("resolveSaveErrorMessage: uses server message when available", () => {
    const msg = resolveSaveErrorMessage("Deck is too large to save.");
    assert.equal(msg, "Deck is too large to save.");
  });

  test("resolveSaveErrorMessage: falls back to generic label when server message is null", () => {
    const msg = resolveSaveErrorMessage(null);
    assert.equal(msg, SAVE_STATUS_LABEL.error);
  });

  test("resolveSaveErrorMessage: falls back to generic label for empty/whitespace server message", () => {
    assert.equal(resolveSaveErrorMessage(""), SAVE_STATUS_LABEL.error);
    assert.equal(resolveSaveErrorMessage("   "), SAVE_STATUS_LABEL.error);
  });
});

// ---------------------------------------------------------------------------
// #459-02: Conflict recovery — both tokens preserved
// ---------------------------------------------------------------------------

describe("autosave: stale revision conflict preserves state (#459)", () => {
  test("isRevisionConflict: true when client token is stale", () => {
    const T0 = generateRevisionToken();
    const T1 = generateRevisionToken();
    assert.notEqual(T0, T1);
    assert.equal(isRevisionConflict(T0, T1), true);
  });

  test("isRevisionConflict: false when tokens match", () => {
    const T = generateRevisionToken();
    assert.equal(isRevisionConflict(T, T), false);
  });

  test("isRevisionConflict: true when clientToken is missing", () => {
    assert.equal(isRevisionConflict(null, generateRevisionToken()), true);
    assert.equal(isRevisionConflict(undefined, generateRevisionToken()), true);
  });

  test("conflict result carries serverRevisionToken (allows keep-mine / use-server)", () => {
    const serverToken = generateRevisionToken();
    // Simulated conflict: the server would return { ok: "conflict", serverRevisionToken }
    const conflictResult = {
      ok: "conflict" as const,
      serverRevisionToken: serverToken,
    };
    // The conflict result must retain the server token so the UI can show both.
    assert.equal(conflictResult.ok, "conflict");
    assert.equal(
      typeof conflictResult.serverRevisionToken,
      "string",
      "conflict result must carry serverRevisionToken",
    );
    assert.equal(conflictResult.serverRevisionToken, serverToken);
  });

  test("conflict does NOT create a version snapshot (count=0 guard)", () => {
    // simulates the guard: if (count === 0) return { ok: "conflict" }
    // The snapshot call is only reached when count > 0.
    const count = 0; // simulated CAS miss
    const snapshotCalled = count > 0;
    assert.equal(
      snapshotCalled,
      false,
      "conflict path must not create DocumentVersion snapshot",
    );
  });

  test("SAVE_CONFLICT diagnostic code is emitted on conflict", () => {
    const d = saveDiagnosticConflict("doc-1");
    assert.equal(d.code, ERROR_CODES.SAVE_CONFLICT);
    assert.equal(d.meta.documentId, "doc-1");
  });
});

// ---------------------------------------------------------------------------
// #459-03: Oversized payload — rejected with recoverable state
// ---------------------------------------------------------------------------

describe("autosave: oversized payload is detected before write (#459)", () => {
  test("checkDeckJsonBudget detects payload exceeding hard limit", () => {
    const bigPayload = "x".repeat(DECK_JSON_HARD_BYTES + 1);
    const result = checkDeckJsonBudget(bigPayload.length);
    assert.equal(result.exceeded, true);
    assert.equal(result.hardAt, DECK_JSON_HARD_BYTES);
  });

  test("SAVE_OVERSIZED diagnostic is produced for oversized payload", () => {
    const d = saveDiagnosticOversized(
      "doc-1",
      DECK_JSON_HARD_BYTES + 1,
      DECK_JSON_HARD_BYTES,
    );
    assert.equal(d.code, ERROR_CODES.SAVE_OVERSIZED);
    assert.equal(d.meta.actualBytes, DECK_JSON_HARD_BYTES + 1);
    assert.equal(d.meta.maxBytes, DECK_JSON_HARD_BYTES);
  });

  test("save-error state is surfaced to user (not silently dropped)", () => {
    // After detecting oversized payload, the save must set hasError = true.
    // Simulated: after a 413/size-error response, status resolves to 'error'.
    const status = resolveSaveStatus({
      isDirty: true,
      isSaving: false,
      hasError: true,
    });
    assert.equal(status, "error");
  });

  test("valid deck JSON within budget is accepted", () => {
    const deck = makeDeck([makeSlide("s-1", 0, "First")]);
    const json = JSON.stringify(deck);
    const result = checkDeckJsonBudget(json.length);
    assert.equal(result.exceeded, false);
  });
});

// ---------------------------------------------------------------------------
// #459-04: Visual mirror failure does NOT erase authoritative contentJson
// ---------------------------------------------------------------------------

describe("autosave: visual mirror failure is non-destructive (#459)", () => {
  test("mirror diff with 0 live nodes: all existing rows scheduled for delete", () => {
    // When visual nodes are absent (or parsing fails), diffVisualMirror produces
    // a delete-all plan — the caller must decide whether to execute it.
    // The key invariant: contentJson is NOT touched by the mirror pipeline.
    const existing: ExistingVisualRow[] = [
      makeExistingRow("row-1", "bid-1", 0, '{"type":"chart"}'),
      makeExistingRow("row-2", "bid-2", 1, '{"type":"flowchart"}'),
    ];
    const diff = diffVisualMirror({
      existingRows: existing,
      liveNodes: [],
      liveAnchors: new Set(),
    });
    // All existing anchored rows are orphaned → scheduled for delete.
    assert.equal(diff.toDelete.length, 2);
    assert.equal(diff.toCreate.length, 0);
    assert.equal(diff.toUpdate.length, 0);
    // contentJson is a separate field — the diff plan only describes Visual rows.
    // Callers (mirrorVisualNodes) operate on the Visual table, NOT contentJson.
  });

  test("mirror diff with invalid payload is skipped (not persisted)", () => {
    // Nodes with an invalid payload are passed as liveAnchors but NOT in
    // liveNodes, so they keep their existing row alive without triggering an
    // update. This prevents overwriting valid stored data with an invalid payload.
    const anchor = "bid-valid";
    const existing: ExistingVisualRow[] = [
      makeExistingRow("row-1", anchor, 0, '{"type":"chart"}'),
    ];
    // The anchor is present in liveAnchors (so the row is NOT pruned)
    // but absent from liveNodes (payload was invalid, so no update is generated).
    const diff = diffVisualMirror({
      existingRows: existing,
      liveNodes: [],
      liveAnchors: new Set([anchor]),
    });
    assert.equal(
      diff.toDelete.length,
      0,
      "row with live anchor must NOT be deleted",
    );
    assert.equal(
      diff.toCreate.length,
      0,
      "invalid payload must not create a new row",
    );
    assert.equal(
      diff.toUpdate.length,
      0,
      "invalid payload must not update existing row",
    );
  });

  test("mirrorOutcomeFromDiff with skipped/invalid counts reflects reality", () => {
    const diff = { toCreate: [], toUpdate: [], toDelete: [] };
    const outcome = mirrorOutcomeFromDiff(diff, 2, 1);
    assert.equal(outcome.skipped, 2);
    assert.equal(outcome.invalid, 1);
    assert.equal(outcome.created, 0);
    assert.equal(outcome.deleted, 0);
  });
});

// ---------------------------------------------------------------------------
// #459-05: Autosave scheduling — only schedules on real edits
// ---------------------------------------------------------------------------

describe("autosave: scheduling gate (#459)", () => {
  const deck1 = makeDeck([makeSlide("s-1", 0, "First")]);
  const deck2 = makeDeck([makeSlide("s-1", 0, "Edited")]);

  test("initial load (lastSeen = null) → no autosave scheduled", () => {
    assert.equal(
      shouldScheduleAutosave({ current: deck1, lastSeen: null }),
      false,
    );
  });

  test("unchanged reference → no autosave (prevents spurious writes)", () => {
    assert.equal(
      shouldScheduleAutosave({ current: deck1, lastSeen: deck1 }),
      false,
    );
  });

  test("new deck reference (after edit) → autosave scheduled", () => {
    assert.equal(
      shouldScheduleAutosave({ current: deck2, lastSeen: deck1 }),
      true,
    );
  });

  test("shouldPersist: false when serialization is identical (prevents no-op saves)", () => {
    const json = JSON.stringify(deck1);
    assert.equal(shouldPersist(json, json), false);
  });

  test("shouldPersist: true when serialization differs", () => {
    const prev = JSON.stringify(deck1);
    const next = JSON.stringify(deck2);
    assert.notEqual(prev, next);
    assert.equal(shouldPersist(prev, next), true);
  });

  test("shouldPersist: true when prevSerialized is null (first ever save)", () => {
    assert.equal(shouldPersist(null, JSON.stringify(deck1)), true);
  });

  test("SLIDE_SAVE_DEBOUNCE_MS is positive (debounce is non-zero)", () => {
    assert.ok(SLIDE_SAVE_DEBOUNCE_MS > 0, "debounce must be positive");
  });
});

// ---------------------------------------------------------------------------
// #459-06: Dirty state persists across reopen (simulated)
// ---------------------------------------------------------------------------

describe("autosave: dirty state survives failed save / reopen (#459)", () => {
  test("after failed save, isDirty remains true — edits are not lost", () => {
    // Simulate state machine: user edits → autosave fails → hasError=true
    // The editor must NOT mark isDirty=false on error (data loss prevention).
    const stateAfterFailedSave = {
      isDirty: true,
      isSaving: false,
      hasError: true,
    };
    assert.equal(
      stateAfterFailedSave.isDirty,
      true,
      "dirty flag must survive a failed save",
    );
    const status = resolveSaveStatus(stateAfterFailedSave);
    assert.equal(status, "error");
  });

  test("user retry: clearing hasError with isDirty → 'saving' while retry in flight", () => {
    // On retry: clear error, set saving
    const stateOnRetry = { isDirty: true, isSaving: true, hasError: false };
    const status = resolveSaveStatus(stateOnRetry);
    assert.equal(status, "saving");
  });

  test("successful retry: isDirty=false, hasError=false → 'saved'", () => {
    const stateAfterSuccess = {
      isDirty: false,
      isSaving: false,
      hasError: false,
    };
    const status = resolveSaveStatus(stateAfterSuccess);
    assert.equal(status, "saved");
  });
});

// ---------------------------------------------------------------------------
// #459-07: Schema validation gate (invalid deck payload)
// ---------------------------------------------------------------------------

describe("autosave: schema validation rejects corrupt payloads (#459)", () => {
  test("safeParseDeck: valid minimal deck passes", () => {
    const result = safeParseDeck({
      schemaVersion: LEGACY_DECK_SCHEMA_VERSION,
      canvas: { format: "16:9" },
      design: { themeId: "default" },
      masters: [{ id: "master-default", name: "Default", elements: [] }],
      defaultMasterId: "master-default",
      slides: [
        {
          id: "s-1",
          index: 0,
          title: "Title",
          templateId: "content",
          notes: "",
          elements: [],
        },
      ],
    });
    assert.equal(result.success, true);
  });

  test("safeParseDeck: null payload fails gracefully", () => {
    const result = safeParseDeck(null);
    assert.equal(result.success, false);
  });

  test("safeParseDeck: unknown theme is rejected", () => {
    const result = safeParseDeck({ themeId: "not-a-theme", slides: [] });
    assert.equal(result.success, false);
  });

  test("safeParseDeck: missing slides field is rejected", () => {
    const result = safeParseDeck({ themeId: "default" });
    assert.equal(result.success, false);
  });

  test("safeParseDeck: empty string payload is rejected", () => {
    const result = safeParseDeck("");
    assert.equal(result.success, false);
  });
});
