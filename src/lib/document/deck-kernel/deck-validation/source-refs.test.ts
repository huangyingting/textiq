import assert from "node:assert/strict";
import { test } from "node:test";

import { buildDeck, buildSlide, buildTextElement } from "@/test/builders/deck";
import { validateDeck } from "./core";
import { validateSourceRef } from "./source-refs";

const VALID_SOURCE_REF = {
  documentId: "doc-1",
  blockId: "block-1",
  linkedAt: "2026-07-02T20:42:41Z",
  blockKind: "text" as const,
};

test("validateSourceRef accepts a minimal valid text source ref", () => {
  const result = validateSourceRef(VALID_SOURCE_REF, "source");
  assert.deepEqual(result, VALID_SOURCE_REF);
});

test("validateSourceRef accepts optional contentHash and unlinked fields", () => {
  const input = {
    ...VALID_SOURCE_REF,
    blockKind: "visual" as const,
    contentHash: "hash-abc",
    unlinked: true,
  };
  const result = validateSourceRef(input, "source");
  assert.deepEqual(result, input);
});

test("validateSourceRef accepts a fractional-second and offset ISO timestamp", () => {
  const withFraction = validateSourceRef(
    { ...VALID_SOURCE_REF, linkedAt: "2026-07-02T20:42:41.123Z" },
    "source",
  );
  assert.equal(withFraction.linkedAt, "2026-07-02T20:42:41.123Z");
  const withOffset = validateSourceRef(
    { ...VALID_SOURCE_REF, linkedAt: "2026-07-02T20:42:41+02:00" },
    "source",
  );
  assert.equal(withOffset.linkedAt, "2026-07-02T20:42:41+02:00");
});

test("validateSourceRef rejects a non-object input", () => {
  assert.throws(() => validateSourceRef("nope", "source"), {
    message: /^source must be an object$/,
  });
});

test("validateSourceRef rejects an empty documentId", () => {
  assert.throws(
    () => validateSourceRef({ ...VALID_SOURCE_REF, documentId: "" }, "source"),
    { message: /^source\.documentId must be a non-empty string$/ },
  );
});

test("validateSourceRef rejects a missing blockId", () => {
  const { blockId: _blockId, ...withoutBlockId } = VALID_SOURCE_REF;
  assert.throws(() => validateSourceRef(withoutBlockId, "source"), {
    message: /^source\.blockId must be a non-empty string$/,
  });
});

test("validateSourceRef rejects an empty contentHash when present", () => {
  assert.throws(
    () => validateSourceRef({ ...VALID_SOURCE_REF, contentHash: "" }, "source"),
    { message: /^source\.contentHash must be a non-empty string$/ },
  );
});

test("validateSourceRef rejects a malformed linkedAt timestamp", () => {
  assert.throws(
    () =>
      validateSourceRef(
        { ...VALID_SOURCE_REF, linkedAt: "not-a-date" },
        "source",
      ),
    { message: /^source\.linkedAt must be a valid ISO timestamp$/ },
  );
});

test("validateSourceRef rejects an ISO-shaped but calendar-invalid linkedAt", () => {
  // Matches the ISO_TIMESTAMP_PATTERN shape but Date.parse rejects month 13.
  assert.throws(
    () =>
      validateSourceRef(
        { ...VALID_SOURCE_REF, linkedAt: "2026-13-40T20:42:41Z" },
        "source",
      ),
    { message: /^source\.linkedAt must be a valid ISO timestamp$/ },
  );
});

test("validateSourceRef rejects a non-boolean unlinked flag", () => {
  assert.throws(
    () => validateSourceRef({ ...VALID_SOURCE_REF, unlinked: "yes" }, "source"),
    { message: /^source\.unlinked must be a boolean$/ },
  );
});

test("validateSourceRef rejects an unrecognised blockKind", () => {
  assert.throws(
    () =>
      validateSourceRef({ ...VALID_SOURCE_REF, blockKind: "image" }, "source"),
    { message: /^source\.blockKind must be "text", "visual", or "table"$/ },
  );
});

// ---------------------------------------------------------------------------
// validateDeck boundary — source refs threaded through a real slide element
// ---------------------------------------------------------------------------

test("validateDeck accepts a slide element carrying a valid source ref", () => {
  const deck = buildDeck({
    slides: [
      buildSlide({
        elements: [buildTextElement({ source: VALID_SOURCE_REF })],
      }),
    ],
  });
  const result = validateDeck(deck);
  assert.deepEqual(result.slides[0].elements?.[0].source, VALID_SOURCE_REF);
});

test("validateDeck rejects an element source ref with the full nested element context", () => {
  const deck = buildDeck({
    slides: [
      buildSlide({
        elements: [
          buildTextElement({
            source: { ...VALID_SOURCE_REF, blockKind: "spreadsheet" as never },
          }),
        ],
      }),
    ],
  });
  assert.throws(() => validateDeck(deck), {
    message:
      /^slides\[0\]\.elements\[0\]\.source\.blockKind must be "text", "visual", or "table"$/,
  });
});
