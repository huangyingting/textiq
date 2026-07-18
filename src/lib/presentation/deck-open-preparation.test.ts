import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildMinimalDeck } from "@/test/builders/presentation-deck";

import {
  DECK_OPEN_FETCH_REJECTED_MESSAGE_,
  prepareDeckForOpen,
} from "./deck-open-preparation";

describe("prepareDeckForOpen", () => {
  test("surfaces rejected fetch failures before any blank fallback", async () => {
    let fallbackCalls = 0;
    const failures: Array<{ reason: string; error: string }> = [];
    const result = await prepareDeckForOpen({
      documentId: "doc-1309",
      deckPort: {
        fetchDeckJson: async () => {
          throw new Error("session expired");
        },
      },
      fallbackDeck: () => {
        fallbackCalls += 1;
        return buildMinimalDeck();
      },
      onFetchFailure: (failure) => failures.push(failure),
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /session expired/);
    }
    assert.equal(fallbackCalls, 0);
    assert.deepEqual(failures, [
      {
        reason: "rejected",
        error: `${DECK_OPEN_FETCH_REJECTED_MESSAGE_} (session expired)`,
      },
    ]);
  });

  test("surfaces fetch result errors before fallback", async () => {
    let fallbackCalls = 0;
    const failures: Array<{ reason: string; error: string }> = [];
    const result = await prepareDeckForOpen({
      documentId: "doc-1309",
      deckPort: {
        fetchDeckJson: async () => ({
          ok: false,
          deckJson: null,
          revisionToken: null,
          error: "Unauthorized",
          failure: {
            code: "storage_unavailable",
            retryable: false,
          },
        }),
      },
      fallbackDeck: () => {
        fallbackCalls += 1;
        return buildMinimalDeck();
      },
      onFetchFailure: (failure) => failures.push(failure),
    });

    assert.deepEqual(result, {
      ok: false,
      error: "Unauthorized",
      diagnostics: [],
    });
    assert.equal(fallbackCalls, 0);
    assert.deepEqual(failures, [
      {
        reason: "result_error",
        error: "Unauthorized",
      },
    ]);
  });

  test("keeps normal blank fallback when fetch succeeds with absent deck json", async () => {
    const fallbackDeck = buildMinimalDeck();
    const result = await prepareDeckForOpen({
      documentId: "doc-1309",
      deckPort: {
        fetchDeckJson: async () => ({
          ok: true,
          deckJson: null,
          revisionToken: "server-rev",
          themeDiagnostics: [],
        }),
      },
      fallbackDeck: () => fallbackDeck,
    });

    assert.deepEqual(result, {
      ok: true,
      deck: fallbackDeck,
      diagnostics: [],
      revisionToken: "server-rev",
    });
  });

  test("carries fallback diagnostics when absent deck json uses a derived deck", async () => {
    const fallbackDeck = buildMinimalDeck();
    const result = await prepareDeckForOpen({
      documentId: "doc-1309",
      deckPort: {
        fetchDeckJson: async () => ({
          ok: true,
          deckJson: null,
          revisionToken: "server-rev",
          themeDiagnostics: [],
        }),
      },
      fallbackDeck: () => ({
        deck: fallbackDeck,
        diagnostics: [
          {
            code: "unknown-theme-package",
            category: "theme",
            severity: "warning",
            target: { scope: "theme", themePackageId: "custom" },
            message: "Theme fallback was used.",
          },
        ],
      }),
    });

    assert.deepEqual(result, {
      ok: true,
      deck: fallbackDeck,
      diagnostics: [
        {
          code: "unknown-theme-package",
          category: "theme",
          severity: "warning",
          target: { scope: "theme", themePackageId: "custom" },
          message: "Theme fallback was used.",
        },
      ],
      revisionToken: "server-rev",
    });
  });
});
