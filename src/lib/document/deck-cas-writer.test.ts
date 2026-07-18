import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { LEGACY_DECK_SCHEMA_VERSION } from "./deck-kernel/deck";
import { DECK_SCHEMA_VERSION } from "@/lib/document/persistence/current-deck-schema";
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

const VALID_DECK = {
  schemaVersion: DECK_SCHEMA_VERSION,
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
  async function captureErrorRecords(
    fn: () => Promise<void>,
  ): Promise<Record<string, unknown>[]> {
    const original = console.error;
    const records: Record<string, unknown>[] = [];
    console.error = (line?: unknown) => {
      records.push(JSON.parse(String(line)));
    };
    try {
      await fn();
    } finally {
      console.error = original;
    }
    return records;
  }

  test("guards writes with the supplied revision token", async () => {
    const { db, calls } = makeDb({ updateCount: 1 });
    const result = await writeDeckWithCas({
      documentId: "doc-1",
      deckJson: VALID_DECK,
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

  test("treats an explicit null token as a loaded CAS predicate", async () => {
    const { db, calls } = makeDb({ updateCount: 1, serverToken: null });
    const result = await writeDeckWithCas({
      documentId: "doc-null-token",
      deckJson: VALID_DECK,
      clientToken: null,
      telemetryArea: "test",
      db,
    });

    assert.equal(result.ok, true);
    assert.deepEqual((calls[0] as { where: unknown }).where, {
      id: "doc-null-token",
      deckRevisionToken: null,
    });
  });

  test("rejects an omitted runtime token without reaching storage", async () => {
    const { db, calls } = makeDb({ updateCount: 1 });
    const result = await writeDeckWithCas({
      documentId: "doc-missing-token",
      deckJson: VALID_DECK,
      clientToken: undefined as never,
      telemetryArea: "test",
      db,
    });

    assert.deepEqual(result, {
      ok: false,
      error: "A deck revision token is required.",
      failure: { code: "invalid_revision_token", retryable: false },
    });
    assert.equal(calls.length, 0);
  });

  test("rotates the first null token and conflicts a second stale null writer", async () => {
    let currentToken: string | null = null;
    const db = {
      document: {
        async updateMany(args: {
          where: { id: string; deckRevisionToken?: string | null };
          data: { deckRevisionToken?: string | null };
        }) {
          const guarded = "deckRevisionToken" in args.where;
          if (guarded && args.where.deckRevisionToken !== currentToken) {
            return { count: 0 };
          }
          currentToken = args.data.deckRevisionToken ?? null;
          return { count: 1 };
        },
        async findUnique() {
          return { deckRevisionToken: currentToken };
        },
      },
    } as DeckCasDb;

    const first = await writeDeckWithCas({
      documentId: "doc-stale-null",
      deckJson: VALID_DECK,
      clientToken: null,
      telemetryArea: "test",
      db,
    });
    assert.equal(first.ok, true);
    assert.notEqual(currentToken, null);
    const rotatedToken = currentToken;

    const second = await writeDeckWithCas({
      documentId: "doc-stale-null",
      deckJson: VALID_DECK,
      clientToken: null,
      telemetryArea: "test",
      db,
    });
    assert.deepEqual(second, {
      ok: "conflict",
      serverRevisionToken: rotatedToken,
    });
  });

  test("returns a conflict with the latest server token when CAS misses", async () => {
    const { db } = makeDb({ updateCount: 0, serverToken: "new-server-token" });
    const result = await writeDeckWithCas({
      documentId: "doc-1",
      deckJson: VALID_DECK,
      clientToken: "stale-token",
      telemetryArea: "test",
      db,
    });

    assert.deepEqual(result, {
      ok: "conflict",
      serverRevisionToken: "new-server-token",
    });
  });

  test("returns document-not-found when the conflict reread misses", async () => {
    const { db } = makeDb({ updateCount: 0, exists: false });
    const result = await writeDeckWithCas({
      documentId: "missing",
      deckJson: VALID_DECK,
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
      deckJson: VALID_DECK,
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
      deckJson: VALID_DECK,
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

  test("never logs caught CAS provider messages, stacks, or private deck data", async () => {
    const privateText =
      "PRIVATE DECK PARAGRAPH token=sk-cas private@example.com https://cas.example unknownCasKey";
    const providerError = new Error(privateText);
    providerError.stack = `Error: ${privateText}\n at privateCasProvider`;

    for (const failure of [
      { updateCount: 1, updateError: providerError },
      { updateCount: 0, findError: providerError },
    ]) {
      const { db } = makeDb(failure);
      let result: Awaited<ReturnType<typeof writeDeckWithCas>> | undefined;
      const records = await captureErrorRecords(async () => {
        result = await writeDeckWithCas({
          documentId: "doc-safe-log",
          deckJson: VALID_DECK,
          clientToken: "client-token",
          telemetryArea: privateText,
          db,
        });
      });

      assert.equal(result?.ok, false);
      assert.equal(records.length, 1);
      assert.equal(records[0].scope, "deck.cas");
      assert.equal(records[0].code, "storage_unavailable");
      assert.equal(records[0].outcome, "failed");
      assert.ok(
        ["updateMany", "findUnique"].includes(String(records[0].operation)),
      );
      const serialized = JSON.stringify({ records, result });
      assert.ok(!serialized.includes(privateText));
      assert.ok(!serialized.includes("sk-cas"));
      assert.ok(!serialized.includes("private@example.com"));
      assert.ok(!serialized.includes("https://cas.example"));
      assert.ok(!serialized.includes("unknownCasKey"));
    }
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
    assert.equal(result.ok === false ? result.error : "", "Invalid deck.");
    assert.equal(calls.length, 0);
  });

  test("reports stable safe validation classifications for CAS input", async () => {
    const cases = [
      {
        expectedCode: "invalid_version",
        deckJson: { ...VALID_DECK, schemaVersion: 6 },
      },
      {
        expectedCode: "invalid_structure",
        deckJson: { ...VALID_DECK, slides: "not-an-array" },
      },
      {
        expectedCode: "invalid_type",
        deckJson: {
          ...VALID_DECK,
          slides: [
            {
              ...VALID_DECK.slides[0],
              children: [{ id: "unknown-node", type: "private-widget" }],
            },
          ],
        },
      },
      {
        expectedCode: "unsupported_property",
        deckJson: { ...VALID_DECK, unknownPrivateKey: "PRIVATE VALUE" },
      },
    ] as const;

    for (const testCase of cases) {
      const { db } = makeDb({ updateCount: 1 });
      const records = await captureErrorRecords(async () => {
        await writeDeckWithCas({
          documentId: "doc-classification",
          deckJson: testCase.deckJson,
          clientToken: "client-token",
          telemetryArea: "persistDeck.input",
          db,
        });
      });
      const diagnostic = records.find(
        (record) => record.category === "deck-parse-failed",
      );
      assert.equal(diagnostic?.code, testCase.expectedCode);
      assert.equal(diagnostic?.schemaVersion, DECK_SCHEMA_VERSION);
      assert.ok(!JSON.stringify(records).includes("unknownPrivateKey"));
      assert.ok(!JSON.stringify(records).includes("PRIVATE VALUE"));
    }
  });

  test("rejects nested unknown child-node/content fields before writing", async () => {
    const { db, calls } = makeDb({ updateCount: 1 });
    const result = await writeDeckWithCas({
      documentId: "doc-presentation-nested-unknown",
      deckJson: {
        ...VALID_DECK,
        slides: [
          {
            ...VALID_DECK.slides[0],
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
    const error = result.ok === false ? result.error : "";
    assert.equal(error, "Invalid deck.");
    assert.ok(!/rogueNodeField|rogueContentField|rogueParagraph/.test(error));
    assert.equal(calls.length, 0);
  });

  test("rejects decks whose UTF-8 payload exceeds the save limit", async () => {
    const multibyteText = "漢🙂".repeat(80_000);
    const oversizedDeck = {
      ...VALID_DECK,
      slides: [
        {
          ...VALID_DECK.slides[0],
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

  test("accepts a valid presentation deck and writes it", async () => {
    const { db, calls } = makeDb({ updateCount: 1 });
    const result = await writeDeckWithCas({
      documentId: "doc-presentation",
      deckJson: VALID_DECK,
      clientToken: "client-token",
      telemetryArea: "test",
      db,
    });

    assert.equal(result.ok, true);
    // Verify the write happened with the correct CAS predicate.
    assert.deepEqual((calls[0] as { where: unknown }).where, {
      id: "doc-presentation",
      deckRevisionToken: "client-token",
    });
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
    assert.equal(result.ok === false ? result.error : "", "Invalid deck.");
    assert.equal(calls.length, 0);
  });

  test("rejects presentation-shaped decks that still carry v6 slide elements", async () => {
    const { db, calls } = makeDb({ updateCount: 1 });
    const result = await writeDeckWithCas({
      documentId: "doc-presentation-elements",
      deckJson: {
        ...VALID_DECK,
        slides: [
          {
            ...VALID_DECK.slides[0],
            elements: [],
          },
        ],
      },
      clientToken: "client-token",
      telemetryArea: "test",
      db,
    });

    assert.equal(result.ok, false);
    assert.equal(result.ok === false ? result.error : "", "Invalid deck.");
    assert.equal(calls.length, 0);
  });

  test("rejects a structurally invalid presentation deck before writing", async () => {
    const { db, calls } = makeDb({ updateCount: 1 });
    const bad = {
      schemaVersion: DECK_SCHEMA_VERSION,
      slides: "not-an-array",
    };
    const result = await writeDeckWithCas({
      documentId: "doc-presentation",
      deckJson: bad,
      clientToken: "client-token",
      telemetryArea: "test",
      db,
    });

    assert.equal(result.ok, false);
    assert.equal(result.ok === false ? result.error : "", "Invalid deck.");
    assert.equal(
      calls.length,
      0,
      "DB should not be called for an invalid deck",
    );
  });

  test("presentation deck survives a CAS conflict correctly", async () => {
    const { db } = makeDb({
      updateCount: 0,
      serverToken: "server-presentation-token",
    });
    const result = await writeDeckWithCas({
      documentId: "doc-presentation",
      deckJson: VALID_DECK,
      clientToken: "stale-presentation-token",
      telemetryArea: "test",
      db,
    });

    assert.deepEqual(result, {
      ok: "conflict",
      serverRevisionToken: "server-presentation-token",
    });
  });
});
