import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Deck } from "./schema";
import {
  SAVE_CONFLICT_AUTOSAVE_BLOCKED_MESSAGE,
  hasUnresolvedDeckSaveConflict,
  updateConflictLocalDeck,
  type SlideEditorConflictState,
} from "./slide-editor-collaboration-state";

function deck(id: string): Deck {
  return {
    schemaVersion: 7,
    id,
    canvas: { format: "16:9", width: 100, height: 56.25, unit: "percent" },
    theme: { packageId: "default" },
    assets: { images: {} },
    slides: [
      {
        id: `${id}-slide`,
        type: "slide",
        template: { kind: "content" },
        children: [],
      },
    ],
  };
}

describe("slide editor collaboration state", () => {
  test("detects unresolved save conflicts before history/autosave mutations", () => {
    assert.equal(hasUnresolvedDeckSaveConflict(null), false);
    assert.equal(
      hasUnresolvedDeckSaveConflict({
        localDeck: deck("local"),
        serverRevisionToken: "server-token",
      }),
      true,
    );
  });

  test("keeps latest local deck while preserving the server token", () => {
    const original: SlideEditorConflictState = {
      localDeck: deck("before"),
      serverRevisionToken: "server-token",
    };
    const nextDeck = deck("after");

    const updated = updateConflictLocalDeck(original, nextDeck);

    assert.equal(updated.localDeck, nextDeck);
    assert.equal(updated.serverRevisionToken, "server-token");
    assert.notEqual(updated, original);
    assert.equal(original.localDeck.id, "before");
  });

  test("uses an explicit error when autosave is suspended by conflict", () => {
    assert.match(SAVE_CONFLICT_AUTOSAVE_BLOCKED_MESSAGE, /resolve/i);
    assert.match(SAVE_CONFLICT_AUTOSAVE_BLOCKED_MESSAGE, /autosaving/i);
  });
});
