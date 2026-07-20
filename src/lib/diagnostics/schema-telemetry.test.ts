import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildSchemaDiagnostic,
  isContentKey,
  reportSchemaFailure,
  SCHEMA_FAILURE_CATEGORIES,
  SCHEMA_TELEMETRY_CODES,
  SCHEMA_TELEMETRY_SCOPE,
} from "./schema-telemetry";
import { DECK_VALIDATION_CODES } from "@/lib/presentation/validation";

describe("buildSchemaDiagnostic", () => {
  test("keeps every canonical validator code", () => {
    for (const code of DECK_VALIDATION_CODES) {
      assert.equal(
        buildSchemaDiagnostic("deck-parse-failed", { code }).code,
        code,
      );
    }
  });

  test("maps unknown codes to a generic classification without caller content", () => {
    const privateText = "PRIVATE PARAGRAPH https://secret.example/user";
    const record = buildSchemaDiagnostic("deck-parse-failed", {
      area: privateText,
      code: privateText,
      documentId: privateText,
      rowId: privateText,
      reason: privateText,
      path: privateText,
      message: privateText,
      stack: privateText,
      nested: { text: privateText },
    });
    const serialized = JSON.stringify(record);

    assert.deepEqual(record, {
      category: "deck-parse-failed",
      code: "schema_validation_failed",
    });
    assert.ok(!serialized.includes(privateText));
    assert.equal(
      buildSchemaDiagnostic("deck-parse-failed", {
        code: "unsupported_type",
      }).code,
      "schema_validation_failed",
    );
    assert.equal(
      buildSchemaDiagnostic("deck-parse-failed", {
        code: "schema_validation_failed",
      }).code,
      "schema_validation_failed",
    );
  });

  test("keeps only canonical counts, versions, and known areas", () => {
    const record = buildSchemaDiagnostic("deck-parse-failed", {
      area: "Document.deckJson",
      code: "unsupported_property",
      issueCount: 3,
      schemaVersion: 7,
    });

    assert.deepEqual(record, {
      category: "deck-parse-failed",
      code: "unsupported_property",
      area: "Document.deckJson",
      issueCount: 3,
      schemaVersion: 7,
    });
  });

  test("keeps well-formed opaque repair identifiers", () => {
    const record = buildSchemaDiagnostic("visual-parse-failed", {
      documentId: "clx0abc123",
      rowId: "row_42",
      anchorBlockId: "blk-AbC9",
    });

    assert.deepEqual(record, {
      category: "visual-parse-failed",
      code: "schema_validation_failed",
      documentId: "clx0abc123",
      rowId: "row_42",
      anchorBlockId: "blk-AbC9",
    });
  });

  test("drops malformed identifiers and content-bearing fields", () => {
    const record = buildSchemaDiagnostic("visual-parse-failed", {
      documentId: "has space",
      rowId: "https://x/y",
      anchorBlockId: "a".repeat(200),
      reason: "PRIVATE validator reason",
      path: "slides.0.secret",
      message: "PRIVATE parser message",
      stack: "PRIVATE stack trace",
      data: { text: "PRIVATE nested content" },
    });
    const serialized = JSON.stringify(record);

    assert.deepEqual(record, {
      category: "visual-parse-failed",
      code: "schema_validation_failed",
    });
    assert.ok(!("documentId" in record));
    assert.ok(!("rowId" in record));
    assert.ok(!("anchorBlockId" in record));
    assert.ok(!serialized.includes("has space"));
    assert.ok(!serialized.includes("https://x/y"));
    assert.ok(!serialized.includes("PRIVATE"));
    assert.ok(!serialized.includes("slides.0.secret"));
  });
});

describe("isContentKey", () => {
  test("matches content keys regardless of casing or separators", () => {
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

  test("emits a canonical Error and never serializes validator content", () => {
    const privateText = "PRIVATE KEY NAME AND THROWN MESSAGE";
    const lines = captureLog(() => {
      reportSchemaFailure("deck-parse-failed", {
        area: "Document.deckJson",
        code: "unsupported_property",
        issueCount: 2,
        reason: privateText,
        documentId: privateText,
        caughtError: new Error(privateText),
      });
    });
    assert.equal(lines.length, 1);
    const record = JSON.parse(lines[0]);
    assert.equal(record.scope, SCHEMA_TELEMETRY_SCOPE);
    assert.equal(record.errorName, "SchemaValidationError");
    assert.equal(record.message, "Persisted schema validation failed");
    assert.equal(record.code, "unsupported_property");
    assert.equal(record.issueCount, 2);
    assert.ok(!lines[0].includes(privateText));
  });

  test("categories and codes are stable machine strings", () => {
    for (const value of [
      ...SCHEMA_FAILURE_CATEGORIES,
      ...SCHEMA_TELEMETRY_CODES,
    ]) {
      assert.match(value, /^[a-z_-]+$/);
    }
    assert.deepEqual(SCHEMA_TELEMETRY_CODES, [
      "schema_validation_failed",
      ...DECK_VALIDATION_CODES,
    ]);
  });
});
