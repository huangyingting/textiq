import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { resolveSlideEditorButtonView } from "./slide-editor-button-view";

const idleState = {
  aiEnabled: false,
  pendingJson: null,
  aiPreview: null,
  open: false,
  deck: null,
  deckOpenError: null,
};

describe("resolveSlideEditorButtonView", () => {
  test("keeps all entry surfaces closed for idle state", () => {
    assert.deepEqual(resolveSlideEditorButtonView(idleState), {
      showOpenDialog: false,
      showAiPreview: false,
      showEditor: false,
      showRecovery: false,
    });
  });

  test("shows the AI open dialog only for enabled non-empty pending content", () => {
    assert.equal(
      resolveSlideEditorButtonView({
        ...idleState,
        aiEnabled: true,
        pendingJson: '{"root":{}}',
      }).showOpenDialog,
      true,
    );
    assert.equal(
      resolveSlideEditorButtonView({
        ...idleState,
        aiEnabled: true,
        pendingJson: "",
      }).showOpenDialog,
      false,
    );
  });

  test("shows AI preview while closed and suppresses closed-state surfaces once open", () => {
    const aiPreview = { proposedDeck: "preview" };
    assert.equal(
      resolveSlideEditorButtonView({ ...idleState, aiPreview }).showAiPreview,
      true,
    );
    assert.deepEqual(
      resolveSlideEditorButtonView({
        ...idleState,
        aiEnabled: true,
        pendingJson: '{"root":{}}',
        aiPreview,
        open: true,
        deck: { id: "deck-1" },
      }),
      {
        showOpenDialog: false,
        showAiPreview: false,
        showEditor: true,
        showRecovery: false,
      },
    );
  });

  test("shows recovery only for an open failed deck and never beside the editor", () => {
    const deckOpenError = { error: "invalid deck" };
    assert.deepEqual(
      resolveSlideEditorButtonView({
        ...idleState,
        open: true,
        deckOpenError,
      }),
      {
        showOpenDialog: false,
        showAiPreview: false,
        showEditor: false,
        showRecovery: true,
      },
    );
    assert.equal(
      resolveSlideEditorButtonView({
        ...idleState,
        open: true,
        deck: { id: "deck-1" },
        deckOpenError,
      }).showRecovery,
      false,
    );
  });
});
