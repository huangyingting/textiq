import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SAVE_STATUS_LABEL,
  SLIDE_SAVE_DEBOUNCE_MS,
  resolveSaveErrorMessage,
  resolveSaveStatus,
  shouldPersist,
  shouldScheduleAutosave,
  type SaveStatus,
} from "./save-status";

type TestDeck = { themeId: string; slides: unknown[] };

/** Builds a distinguishable deck (a fresh reference each call). */
function deck(themeId = "default"): TestDeck {
  return { themeId, slides: [] };
}

// ---------------------------------------------------------------------------
// resolveSaveStatus — the dirty/saving/error → label state machine
// ---------------------------------------------------------------------------

test("resolveSaveStatus: resting state is 'saved'", () => {
  assert.equal(
    resolveSaveStatus({ isDirty: false, isSaving: false, hasError: false }),
    "saved",
  );
});

test("resolveSaveStatus: unsaved edits map to 'pending'", () => {
  assert.equal(
    resolveSaveStatus({ isDirty: true, isSaving: false, hasError: false }),
    "pending",
  );
});

test("resolveSaveStatus: an in-flight save maps to 'saving'", () => {
  assert.equal(
    resolveSaveStatus({ isDirty: true, isSaving: true, hasError: false }),
    "saving",
  );
});

test("resolveSaveStatus: a failed save maps to 'error'", () => {
  assert.equal(
    resolveSaveStatus({ isDirty: true, isSaving: false, hasError: true }),
    "error",
  );
});

test("resolveSaveStatus: error wins over an in-flight save", () => {
  assert.equal(
    resolveSaveStatus({ isDirty: true, isSaving: true, hasError: true }),
    "error",
  );
});

test("resolveSaveStatus: queued-save states map to specific UX states", () => {
  assert.equal(
    resolveSaveStatus({
      isDirty: true,
      isSaving: false,
      hasError: false,
      queueStatus: "queued",
    }),
    "queued",
  );
  assert.equal(
    resolveSaveStatus({
      isDirty: true,
      isSaving: false,
      hasError: false,
      queueStatus: "offline",
    }),
    "offline",
  );
  assert.equal(
    resolveSaveStatus({
      isDirty: true,
      isSaving: false,
      hasError: true,
      queueStatus: "conflict",
    }),
    "conflict",
  );
});

test("resolveSaveStatus: saving wins over pending", () => {
  // A retry after an error clears hasError before the request starts.
  assert.equal(
    resolveSaveStatus({ isDirty: true, isSaving: true, hasError: false }),
    "saving",
  );
});

test("SAVE_STATUS_LABEL covers every status with the mirrored copy", () => {
  const statuses: SaveStatus[] = [
    "saved",
    "pending",
    "queued",
    "offline",
    "saving",
    "retrying",
    "conflict",
    "error",
  ];
  for (const status of statuses) {
    assert.equal(typeof SAVE_STATUS_LABEL[status], "string");
    assert.ok(SAVE_STATUS_LABEL[status].length > 0);
  }
  assert.equal(SAVE_STATUS_LABEL.saved, "All changes saved");
  assert.equal(SAVE_STATUS_LABEL.pending, "Unsaved changes…");
  assert.equal(SAVE_STATUS_LABEL.saving, "Saving…");
  // The error label doubles as the Retry affordance.
  assert.match(SAVE_STATUS_LABEL.error, /Retry/);
});

// ---------------------------------------------------------------------------
// shouldScheduleAutosave — the debounce/autosave decision
// ---------------------------------------------------------------------------

test("shouldScheduleAutosave: the initial load (lastSeen=null) is never autosaved", () => {
  assert.equal(
    shouldScheduleAutosave({ current: deck(), lastSeen: null }),
    false,
  );
});

test("shouldScheduleAutosave: an unchanged reference is a no-op", () => {
  const d = deck();
  assert.equal(shouldScheduleAutosave({ current: d, lastSeen: d }), false);
});

test("shouldScheduleAutosave: a new deck reference is a real edit", () => {
  assert.equal(
    shouldScheduleAutosave({ current: deck(), lastSeen: deck() }),
    true,
  );
});

test("SLIDE_SAVE_DEBOUNCE_MS is a positive debounce window", () => {
  assert.ok(SLIDE_SAVE_DEBOUNCE_MS > 0);
});

// ---------------------------------------------------------------------------
// shouldPersist — the no-op autosave suppression (issue #247)
// ---------------------------------------------------------------------------

test("shouldPersist: nothing saved yet (null) always persists", () => {
  assert.equal(shouldPersist(null, '{"theme":"default","slides":[]}'), true);
});

test("shouldPersist: an identical serialization is suppressed", () => {
  const payload = '{"theme":"default","slides":[]}';
  assert.equal(shouldPersist(payload, payload), false);
});

test("shouldPersist: a changed serialization persists", () => {
  const prev = '{"theme":"default","slides":[]}';
  const next = '{"theme":"midnight","slides":[]}';
  assert.equal(shouldPersist(prev, next), true);
});

// ---------------------------------------------------------------------------
// resolveSaveErrorMessage — surface the real server reason (#303)
// ---------------------------------------------------------------------------

test("resolveSaveErrorMessage: server error string is returned verbatim", () => {
  assert.equal(
    resolveSaveErrorMessage("Deck is too large to save."),
    "Deck is too large to save.",
  );
});

test("resolveSaveErrorMessage: null falls back to the generic Retry label", () => {
  assert.equal(resolveSaveErrorMessage(null), SAVE_STATUS_LABEL.error);
});

test("resolveSaveErrorMessage: undefined falls back to the generic Retry label", () => {
  assert.equal(resolveSaveErrorMessage(undefined), SAVE_STATUS_LABEL.error);
});

test("resolveSaveErrorMessage: whitespace-only string falls back to the generic label", () => {
  assert.equal(resolveSaveErrorMessage("   "), SAVE_STATUS_LABEL.error);
});
