import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CONFLICT_USE_SERVER_RELOAD_FAILED_MESSAGE,
  reloadConflictServerDeck,
} from "./conflict-recovery-reload";
import { makeDiagnostic } from "./diagnostics";
import type { DeckFetchPort } from "@/lib/action-ports";
import {
  buildMinimalDeck,
  buildMinimalThemePackage,
} from "@/test/builders/presentation-deck";

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

  test("maps structured fetch failures without parsing their null deck payload", async () => {
    const result = await reloadConflictServerDeck({
      documentId: "doc-1350",
      deckPort: {
        fetchDeckJson: async () => ({
          ok: false,
          deckJson: null,
          revisionToken: null,
          error: "storage detail that must not escape",
          failure: { code: "storage_unavailable", retryable: true },
        }),
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
          themeDiagnostics: [],
        }),
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, "invalid_server_deck");
    assert.match(result.error, /validation failed/i);
  });

  test("supports retrying after a failed reload and applies a valid server deck", async () => {
    const serverDeck = {
      ...buildMinimalDeck(),
      theme: { packageId: "neutral" },
    };
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
          themeDiagnostics: [],
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

  test("hydrates the exact owner-scoped active package without exposing catalog state", async () => {
    const activePackage = buildMinimalThemePackage(
      "brand-kit:user-owner:exact",
      { version: "1.0.0", name: "Owner exact" },
    );
    const serverDeck = {
      ...buildMinimalDeck(),
      theme: {
        packageId: activePackage.id,
        packageVersion: activePackage.version,
      },
    };

    const result = await reloadConflictServerDeck({
      documentId: "doc-collaborator",
      deckPort: {
        fetchDeckJson: async () => ({
          ok: true,
          deckJson: serverDeck,
          revisionToken: "owner-theme-rev",
          activeCustomThemePackage: activePackage,
          themeDiagnostics: [],
        }),
      },
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.activeCustomThemePackage, activePackage);
      assert.deepEqual(result.diagnostics, []);
      assert.equal(
        "customThemeCatalogEntries" in result,
        false,
        "the trusted render snapshot must not carry browseable owner catalog state",
      );
    }
  });

  test("does not substitute a same-id newer package for the exact referenced version", async () => {
    const exactPackage = buildMinimalThemePackage(
      "brand-kit:user-owner:exact",
      {
        version: "1.0.0",
      },
    );
    const newerPackage = { ...exactPackage, version: "2.0.0" };
    const serverDeck = {
      ...buildMinimalDeck(),
      theme: {
        packageId: exactPackage.id,
        packageVersion: exactPackage.version,
      },
    };

    const result = await reloadConflictServerDeck({
      documentId: "doc-collaborator",
      deckPort: {
        fetchDeckJson: async () => ({
          ok: true,
          deckJson: serverDeck,
          revisionToken: "newer-only-rev",
          activeCustomThemePackage: newerPackage,
          themeDiagnostics: [],
        }),
      },
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "theme_hydration_failed");
      assert.ok(
        result.diagnostics.some(
          (diagnostic) => diagnostic.code === "unknown-theme-package",
        ),
      );
    }
  });

  test("keeps built-in server themes independent of custom hydration", async () => {
    const serverDeck = {
      ...buildMinimalDeck(),
      theme: { packageId: "clarity", packageVersion: "1.0.0" },
    };
    const result = await reloadConflictServerDeck({
      documentId: "doc-built-in",
      deckPort: {
        fetchDeckJson: async () => ({
          ok: true,
          deckJson: serverDeck,
          revisionToken: "built-in-rev",
          themeDiagnostics: [],
        }),
      },
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.activeCustomThemePackage, undefined);
      assert.deepEqual(result.diagnostics, []);
    }
  });

  test("keeps the conflict unresolved for missing or invalid exact snapshots", async () => {
    const serverDeck = {
      ...buildMinimalDeck(),
      theme: {
        packageId: "brand-kit:user-owner:missing",
        packageVersion: "1.0.0",
      },
    };
    for (const themeDiagnostics of [
      [],
      [
        makeDiagnostic(
          "unknown-theme-package",
          "warning",
          "Custom theme package snapshot is invalid.",
          {
            path: "activeThemePackageSnapshot.packageJson",
            target: { scope: "theme" },
          },
        ),
      ],
    ]) {
      const result = await reloadConflictServerDeck({
        documentId: "doc-missing-theme",
        deckPort: {
          fetchDeckJson: async () => ({
            ok: true,
            deckJson: serverDeck,
            revisionToken: "missing-theme-rev",
            themeDiagnostics,
          }),
        },
      });

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.reason, "theme_hydration_failed");
        assert.ok(
          result.diagnostics.some(
            (diagnostic) => diagnostic.code === "unknown-theme-package",
          ),
        );
      }
    }
  });
});
