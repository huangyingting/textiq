/**
 * Tests for persisted-schema parse-failure telemetry (#504).
 *
 * The critical guarantee under test: a schema diagnostic NEVER includes raw
 * document content — only safe identifiers, counts, and the opaque validator
 * `reason` string. We assert this both on the pure builder and on the emitted
 * log line (captured via a console.error stub).
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";

import {
  buildSchemaDiagnostic,
  reportSchemaFailure,
  isContentKey,
  SCHEMA_FAILURE_CATEGORIES,
  SCHEMA_TELEMETRY_SCOPE,
} from "./schema-telemetry";
import { REDACTED } from "@/lib/log";

function stringRecord(value: unknown): Record<string, string> {
  return value as unknown as Record<string, string>;
}

describe("buildSchemaDiagnostic", () => {
  test("keeps the category and safe identifiers", () => {
    const record = buildSchemaDiagnostic("deck-parse-failed", {
      documentId: "doc-1",
      rowId: "row-1",
      area: "Document.deckJson",
      reason: "Deck.slides[0].id must be a non-empty string",
      count: 3,
      flagged: true,
    });
    assert.equal(record.category, "deck-parse-failed");
    assert.equal(record.documentId, "doc-1");
    assert.equal(record.rowId, "row-1");
    assert.equal(record.area, "Document.deckJson");
    assert.equal(record.reason, "Deck.slides[0].id must be a non-empty string");
    assert.equal(record.count, 3);
    assert.equal(record.flagged, true);
  });

  test("drops content-bearing keys", () => {
    const secret = "## Confidential heading\nuser secret prose";
    const record = buildSchemaDiagnostic("visual-parse-failed", {
      documentId: "doc-1",
      deckJson: secret,
      contentJson: secret,
      data: secret,
      visual: secret,
      payload: secret,
    } as Record<string, string>);
    const serialized = JSON.stringify(record);
    assert.ok(!serialized.includes("Confidential"));
    assert.ok(!serialized.includes("secret prose"));
    assert.equal(record.documentId, "doc-1");
    assert.equal(record.deckJson, undefined);
    assert.equal(record.data, undefined);
  });

  test("drops non-scalar values that could embed content", () => {
    const record = buildSchemaDiagnostic(
      "deck-parse-failed",
      stringRecord({
        documentId: "doc-1",
        nested: { text: "leak" },
        list: ["leak"],
      }),
    );
    const serialized = JSON.stringify(record);
    assert.ok(!serialized.includes("leak"));
    assert.equal(record.documentId, "doc-1");
  });

  test("redacts sensitive scalar keys through the shared redaction helper", () => {
    const record = buildSchemaDiagnostic("deck-parse-failed", {
      documentId: "doc-1",
      apiKey: "sk-secret",
      Authorization: "Bearer token",
    } as Record<string, string>);

    assert.equal(record.documentId, "doc-1");
    assert.equal(record.apiKey, REDACTED);
    assert.equal(record.Authorization, REDACTED);
    assert.ok(!JSON.stringify(record).includes("sk-secret"));
  });

  test("redacts quoted prose in reason strings", () => {
    const paragraphText = "USER PROVIDED PARAGRAPH CONTENT";
    const record = buildSchemaDiagnostic("deck-parse-failed", {
      reason: `Deck.slides[0].children[0].content.paragraphs[0]: runs text "${paragraphText}" does not equal paragraph text "${paragraphText}"`,
    });

    assert.equal(
      record.reason,
      'Deck.slides[0].children[0].content.paragraphs[0]: runs text "[redacted]" does not equal paragraph text "[redacted]"',
    );
    assert.ok(!JSON.stringify(record).includes(paragraphText));
  });

  test("keeps short quoted enum values in reason strings", () => {
    const reason = 'blockKind must be "text" or "visual"';
    const record = buildSchemaDiagnostic("sourceref-invalid", { reason });
    assert.equal(record.reason, reason);
  });
});

describe("isContentKey", () => {
  test("matches content keys regardless of casing/separators", () => {
    for (const key of [
      "deckJson",
      "deck_json",
      "DeckJSON",
      "contentJson",
      "data",
    ]) {
      assert.equal(isContentKey(key), true, key);
    }
  });

  test("does not match safe identifier keys", () => {
    for (const key of ["documentId", "rowId", "area", "reason", "count"]) {
      assert.equal(isContentKey(key), false, key);
    }
  });
});

describe("reportSchemaFailure", () => {
  function captureLog(fn: () => void): string[] {
    const original = console.error;
    const lines: string[] = [];
    console.error = (line?: unknown) => {
      lines.push(String(line));
    };
    try {
      fn();
    } finally {
      console.error = original;
    }
    return lines;
  }

  test("emits one JSON line with category and no content", () => {
    const lines = captureLog(() => {
      reportSchemaFailure("sourceref-invalid", {
        documentId: "doc-9",
        reason: 'blockKind must be "text" or "visual"',
        deckJson: "SECRET CONTENT",
      } as Record<string, string>);
    });
    assert.equal(lines.length, 1);
    const record = JSON.parse(lines[0]);
    assert.equal(record.scope, SCHEMA_TELEMETRY_SCOPE);
    assert.equal(record.level, "error");
    assert.equal(record.category, "sourceref-invalid");
    assert.equal(record.errorName, "sourceref-invalid");
    assert.equal(record.documentId, "doc-9");
    assert.ok(!lines[0].includes("SECRET CONTENT"));
  });

  test("never throws", () => {
    assert.doesNotThrow(() => reportSchemaFailure("deck-parse-failed"));
  });

  test("every category is a stable kebab string", () => {
    for (const category of SCHEMA_FAILURE_CATEGORIES) {
      assert.match(category, /^[a-z-]+$/);
    }
  });
});
