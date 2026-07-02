import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { LEGACY_DECK_SCHEMA_VERSION } from "../presentation/deck";
import { DECK_SCHEMA_VERSION_V7 } from "@/lib/presentation-vnext/schema";
import { MAX_DECK_JSON_BYTES } from "@/lib/limits";
import { writeDeckWithCas, type DeckCasDb } from "./deck-cas-writer";

const LEGACY_DECK = {
  schemaVersion: LEGACY_DECK_SCHEMA_VERSION,
  canvas: { format: "16:9" },
  design: { themeId: "default" },
  masters: [{ id: "master-default", name: "Default", elements: [] }],
  defaultMasterId: "master-default",
  slides: [
    {
      id: "s1",
      title: "Slide 1",
      index: 0,
      notes: "",
      elements: [],
    },
  ],
};

const VALID_DECK_V7 = {
  schemaVersion: DECK_SCHEMA_VERSION_V7,
  canvas: { format: "16:9", width: 100, height: 56.25, unit: "percent" },
  theme: { packageId: "neutral" },
  assets: { images: {} },
  slides: [
    {
      id: "slide-0001",
      type: "slide",
      template: { kind: "cover" },
      style: { ref: "slide.cover" },
      children: [],
    },
  ],
};

function makeDb({
  updateCount,
  serverToken = "server-token",
  exists = true,
  updateError,
  findError,
}: {
  updateCount: number;
  serverToken?: string | null;
  exists?: boolean;
  updateError?: Error;
  findError?: Error;
}) {
  const calls: unknown[] = [];
  const db = {
    document: {
      async updateMany(args: unknown) {
        calls.push(args);
        if (updateError) throw updateError;
        return { count: updateCount };
      },
      async findUnique() {
        if (findError) throw findError;
        return exists ? { deckRevisionToken: serverToken } : null;
      },
    },
  } as DeckCasDb;
  return { db, calls };
}

describe("writeDeckWithCas", () => {
  test("guards writes with the supplied revision token", async () => {
    const { db, calls } = makeDb({ updateCount: 1 });
    const result = await writeDeckWithCas({
      documentId: "doc-1",
      deckJson: VALID_DECK_V7,
      clientToken: "client-token",
      telemetryArea: "test",
      db,
    });

    assert.equal(result.ok, true);
    assert.deepEqual((calls[0] as { where: unknown }).where, {
      id: "doc-1",
      deckRevisionToken: "client-token",
    });
  });

  test("returns a conflict with the latest server token when CAS misses", async () => {
    const { db } = makeDb({ updateCount: 0, serverToken: "new-server-token" });
    const result = await writeDeckWithCas({
      documentId: "doc-1",
      deckJson: VALID_DECK_V7,
      clientToken: "stale-token",
      telemetryArea: "test",
      db,
    });

    assert.deepEqual(result, {
      ok: "conflict",
      serverRevisionToken: "new-server-token",
    });
  });

  test("does not run success side effects when a v7 CAS write conflicts", async () => {
    let snapshotCount = 0;
    const { db } = makeDb({
      updateCount: 0,
      serverToken: "server-winner-token",
    });
    const result = await writeDeckWithCas({
      documentId: "doc-1",
      deckJson: VALID_DECK_V7,
      clientToken: "stale-token",
      telemetryArea: "test",
      db,
      onSuccess: async () => {
        snapshotCount += 1;
      },
    });

    assert.deepEqual(result, {
      ok: "conflict",
      serverRevisionToken: "server-winner-token",
    });
    assert.equal(snapshotCount, 0);
  });

  test("returns document-not-found when the conflict reread misses", async () => {
    const { db } = makeDb({ updateCount: 0, exists: false });
    const result = await writeDeckWithCas({
      documentId: "missing",
      deckJson: VALID_DECK_V7,
      clientToken: "stale-token",
      telemetryArea: "test",
      db,
    });

    assert.deepEqual(result, {
      ok: false,
      error: "Document not found.",
      failure: { code: "document_not_found", retryable: false },
    });
  });

  test("returns a structured failure when updateMany throws", async () => {
    const { db } = makeDb({
      updateCount: 1,
      updateError: new Error("db unavailable"),
    });
    const result = await writeDeckWithCas({
      documentId: "doc-1",
      deckJson: VALID_DECK_V7,
      clientToken: "client-token",
      telemetryArea: "test",
      db,
    });

    assert.deepEqual(result, {
      ok: false,
      error: "Failed to save deck. Please try again.",
      failure: { code: "storage_unavailable", retryable: true },
    });
  });

  test("returns a structured failure when conflict reread throws", async () => {
    const { db } = makeDb({
      updateCount: 0,
      findError: new Error("read failed"),
    });
    const result = await writeDeckWithCas({
      documentId: "doc-1",
      deckJson: VALID_DECK_V7,
      clientToken: "stale-token",
      telemetryArea: "test",
      db,
    });

    assert.deepEqual(result, {
      ok: false,
      error: "Failed to verify deck conflict. Please try again.",
      failure: { code: "storage_unavailable", retryable: true },
    });
  });

  test("rejects invalid decks before writing", async () => {
    const { db, calls } = makeDb({ updateCount: 1 });
    const result = await writeDeckWithCas({
      documentId: "doc-1",
      deckJson: { slides: "bad" },
      clientToken: "client-token",
      telemetryArea: "test",
      db,
    });

    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.error : "", /Invalid deck:/);
    assert.equal(calls.length, 0);
  });

  test("rejects nested unknown child-node/content fields before writing", async () => {
    const { db, calls } = makeDb({ updateCount: 1 });
    const result = await writeDeckWithCas({
      documentId: "doc-v7-nested-unknown",
      deckJson: {
        ...VALID_DECK_V7,
        slides: [
          {
            ...VALID_DECK_V7.slides[0],
            children: [
              {
                id: "text-node-unknown",
                type: "text",
                content: {
                  paragraphs: [
                    { id: "p-1", text: "Hello", rogueParagraph: true },
                  ],
                  rogueContentField: true,
                },
                rogueNodeField: true,
              },
            ],
          },
        ],
      },
      clientToken: "client-token",
      telemetryArea: "test",
      db,
    });

    assert.equal(result.ok, false);
    assert.match(
      result.ok === false ? result.error : "",
      /rogueNodeField|rogueContentField|rogueParagraph/,
    );
    assert.equal(calls.length, 0);
  });

  test("rejects decks whose UTF-8 payload exceeds the save limit", async () => {
    const multibyteText = "漢🙂".repeat(80_000);
    const oversizedDeck = {
      ...VALID_DECK_V7,
      slides: [
        {
          ...VALID_DECK_V7.slides[0],
          children: [
            {
              id: "node-utf8",
              type: "text",
              content: {
                paragraphs: [
                  {
                    id: "p-utf8",
                    text: multibyteText,
                    runs: [{ text: multibyteText }],
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const serialized = JSON.stringify(oversizedDeck);

    assert.ok(serialized.length <= MAX_DECK_JSON_BYTES);
    assert.ok(Buffer.byteLength(serialized, "utf8") > MAX_DECK_JSON_BYTES);

    const { db, calls } = makeDb({ updateCount: 1 });
    const result = await writeDeckWithCas({
      documentId: "doc-utf8",
      deckJson: oversizedDeck,
      clientToken: "client-token",
      telemetryArea: "test",
      db,
    });

    assert.deepEqual(result, {
      ok: false,
      error: "Deck is too large to save.",
      failure: { code: "deck_too_large", retryable: false },
    });
    assert.equal(calls.length, 0);
  });

  test("accepts a valid v7 deck and writes it", async () => {
    const { db, calls } = makeDb({ updateCount: 1 });
    let snapshotCount = 0;
    const result = await writeDeckWithCas({
      documentId: "doc-v7",
      deckJson: VALID_DECK_V7,
      clientToken: "client-token",
      telemetryArea: "test",
      db,
      onSuccess: async () => {
        snapshotCount += 1;
      },
    });

    assert.equal(result.ok, true);
    assert.equal(snapshotCount, 1);
    // Verify the write happened with the correct CAS predicate.
    assert.deepEqual((calls[0] as { where: unknown }).where, {
      id: "doc-v7",
      deckRevisionToken: "client-token",
    });
  });

  test("keeps success when onSuccess side effects throw", async () => {
    const { db } = makeDb({ updateCount: 1 });
    const result = await writeDeckWithCas({
      documentId: "doc-v7",
      deckJson: VALID_DECK_V7,
      clientToken: "client-token",
      telemetryArea: "test",
      db,
      onSuccess: async () => {
        throw new Error("snapshot failed");
      },
    });

    assert.equal(result.ok, true);
  });

  test("rejects legacy v6 decks before writing", async () => {
    const { db, calls } = makeDb({ updateCount: 1 });
    const result = await writeDeckWithCas({
      documentId: "doc-v6",
      deckJson: LEGACY_DECK,
      clientToken: "client-token",
      telemetryArea: "test",
      db,
    });

    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.error : "", /Invalid deck:/);
    assert.equal(calls.length, 0);
  });

  test("rejects v7-shaped decks that still carry v6 slide elements", async () => {
    const { db, calls } = makeDb({ updateCount: 1 });
    const result = await writeDeckWithCas({
      documentId: "doc-v7-elements",
      deckJson: {
        ...VALID_DECK_V7,
        slides: [
          {
            ...VALID_DECK_V7.slides[0],
            elements: [],
          },
        ],
      },
      clientToken: "client-token",
      telemetryArea: "test",
      db,
    });

    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.error : "", /v6 field/);
    assert.equal(calls.length, 0);
  });

  test("rejects a structurally invalid v7 deck before writing", async () => {
    const { db, calls } = makeDb({ updateCount: 1 });
    const badV7 = {
      schemaVersion: DECK_SCHEMA_VERSION_V7,
      slides: "not-an-array",
    };
    const result = await writeDeckWithCas({
      documentId: "doc-v7",
      deckJson: badV7,
      clientToken: "client-token",
      telemetryArea: "test",
      db,
    });

    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.error : "", /Invalid deck:/);
    assert.equal(
      calls.length,
      0,
      "DB should not be called for an invalid deck",
    );
  });

  test("v7 deck survives a CAS conflict correctly", async () => {
    const { db } = makeDb({
      updateCount: 0,
      serverToken: "server-v7-token",
    });
    const result = await writeDeckWithCas({
      documentId: "doc-v7",
      deckJson: VALID_DECK_V7,
      clientToken: "stale-v7-token",
      telemetryArea: "test",
      db,
    });

    assert.deepEqual(result, {
      ok: "conflict",
      serverRevisionToken: "server-v7-token",
    });
  });
});
