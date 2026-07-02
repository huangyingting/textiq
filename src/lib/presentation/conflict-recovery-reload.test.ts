import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CONFLICT_USE_SERVER_RELOAD_FAILED_MESSAGE,
  reloadConflictServerDeck,
} from "./conflict-recovery-reload";
import type { DeckFetchPort } from "@/lib/action-ports";
import { buildMinimalDeck } from "@/test/builders/presentation-deck";

describe("reloadConflictServerDeck", () => {
  test("keeps conflict recovery unresolved when server reload fetch fails", async () => {
    const result = await reloadConflictServerDeck({
      documentId: "doc-1350",
      deckPort: {
        fetchDeckJson: async () => {
          throw new Error("network down");
        },
      },
    });

    assert.deepEqual(result, {
      ok: false,
      reason: "fetch_failed",
      error: CONFLICT_USE_SERVER_RELOAD_FAILED_MESSAGE,
      diagnostics: [],
    });
  });

  test("returns invalid_server_deck when fetched payload cannot open as presentation", async () => {
    const result = await reloadConflictServerDeck({
      documentId: "doc-1350",
      deckPort: {
        fetchDeckJson: async () => ({
          ok: true,
          deckJson: { schemaVersion: 7, slides: null },
          revisionToken: "server-token",
        }),
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, "invalid_server_deck");
    assert.match(result.error, /validation failed/i);
  });

  test("supports retrying after a failed reload and applies a valid server deck", async () => {
    const serverDeck = buildMinimalDeck();
    let attempts = 0;
    const deckPort: Pick<DeckFetchPort, "fetchDeckJson"> = {
      fetchDeckJson: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("transient gateway");
        }
        return {
          ok: true,
          deckJson: serverDeck,
          revisionToken: "retry-token",
        };
      },
    };

    const firstTry = await reloadConflictServerDeck({
      documentId: "doc-1350",
      deckPort,
    });
    assert.equal(firstTry.ok, false);
    assert.equal(firstTry.reason, "fetch_failed");

    const retryTry = await reloadConflictServerDeck({
      documentId: "doc-1350",
      deckPort,
    });
    assert.equal(retryTry.ok, true);
    if (retryTry.ok) {
      assert.equal(retryTry.deck.schemaVersion, 7);
      assert.equal(retryTry.revisionToken, "retry-token");
      assert.equal(retryTry.deckJson, serverDeck);
    }
  });
});
