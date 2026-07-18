import assert from "node:assert/strict";
import { test } from "node:test";

import { COLLABORATION_TAG, HISTORIC_TAG, HISTORY_MERGE_TAG } from "lexical";

import {
  IMPORT_TAG,
  RESTORE_TAG,
  importRequiresConfirmation,
  resolveImportStep,
  shouldAutosaveUpdate,
} from "./import-persistence";

test("autosave persists ordinary local edits (no special tags)", () => {
  assert.equal(shouldAutosaveUpdate(new Set()), true);
  assert.equal(shouldAutosaveUpdate(new Set(["history-push"])), true);
  assert.equal(shouldAutosaveUpdate(new Set([HISTORY_MERGE_TAG])), true);
});

test("autosave ignores remote CRDT merges and history replays", () => {
  assert.equal(shouldAutosaveUpdate(new Set([COLLABORATION_TAG])), false);
  assert.equal(shouldAutosaveUpdate(new Set([HISTORIC_TAG])), false);
  assert.equal(
    shouldAutosaveUpdate(new Set([COLLABORATION_TAG, HISTORIC_TAG])),
    false,
  );
});

test("accepted import persists even though it is a content replacement", () => {
  assert.equal(shouldAutosaveUpdate(new Set([IMPORT_TAG])), true);
  // IMPORT_TAG overrides the HISTORIC_TAG skip if both are ever present.
  assert.equal(shouldAutosaveUpdate(new Set([IMPORT_TAG, HISTORIC_TAG])), true);
});

test("restoring a version updates the live room without autosaving again", () => {
  assert.equal(shouldAutosaveUpdate(new Set([RESTORE_TAG])), false);
});

test("import into an empty document does not require confirmation", () => {
  assert.equal(importRequiresConfirmation(true), false);
});

test("import into a non-empty document requires confirmation", () => {
  assert.equal(importRequiresConfirmation(false), true);
});

test("empty document imports immediately without confirmation", () => {
  assert.equal(resolveImportStep(true, false), "insert");
  assert.equal(resolveImportStep(true, true), "insert");
});

test("non-empty document asks for confirmation before importing", () => {
  assert.equal(resolveImportStep(false, false), "confirm");
});

test("confirmed import into a non-empty document proceeds to insert", () => {
  assert.equal(resolveImportStep(false, true), "insert");
});
