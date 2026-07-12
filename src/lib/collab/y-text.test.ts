import assert from "node:assert/strict";
import { test } from "node:test";
import * as Y from "yjs";

import { adjustIndex, applyTextDiff, colorFromId, initialsOf } from "./y-text";

// ---------------------------------------------------------------------------
// applyTextDiff — minimal single-region insert/delete/retain onto a Y.Text
// ---------------------------------------------------------------------------

function textDoc(initial: string): { doc: Y.Doc; ytext: Y.Text } {
  const doc = new Y.Doc();
  const ytext = doc.getText("t");
  if (initial) {
    ytext.insert(0, initial);
  }
  return { doc, ytext };
}

test("applyTextDiff: no-op when strings are identical", () => {
  const { ytext } = textDoc("hello");
  const events: unknown[] = [];
  ytext.observe((event) => events.push(event));

  applyTextDiff(ytext, "hello", "hello");

  assert.equal(ytext.toString(), "hello");
  assert.equal(events.length, 0);
});

test("applyTextDiff: pure insertion in the middle (retain prefix/suffix)", () => {
  const { ytext } = textDoc("helo");
  applyTextDiff(ytext, "helo", "hello");
  assert.equal(ytext.toString(), "hello");
});

test("applyTextDiff: pure deletion in the middle (retain prefix/suffix)", () => {
  const { ytext } = textDoc("hello");
  applyTextDiff(ytext, "hello", "helo");
  assert.equal(ytext.toString(), "helo");
});

test("applyTextDiff: replace a middle region (delete then insert)", () => {
  const { ytext } = textDoc("the cat sat");
  applyTextDiff(ytext, "the cat sat", "the dog sat");
  assert.equal(ytext.toString(), "the dog sat");
});

test("applyTextDiff: append at the end (empty common suffix)", () => {
  const { ytext } = textDoc("abc");
  applyTextDiff(ytext, "abc", "abcdef");
  assert.equal(ytext.toString(), "abcdef");
});

test("applyTextDiff: prepend at the start (empty common prefix)", () => {
  const { ytext } = textDoc("abc");
  applyTextDiff(ytext, "abc", "xyzabc");
  assert.equal(ytext.toString(), "xyzabc");
});

test("applyTextDiff: full replace of totally different strings", () => {
  const { ytext } = textDoc("abc");
  applyTextDiff(ytext, "abc", "xyz");
  assert.equal(ytext.toString(), "xyz");
});

test("applyTextDiff: clears to empty string", () => {
  const { ytext } = textDoc("abc");
  applyTextDiff(ytext, "abc", "");
  assert.equal(ytext.toString(), "");
});

test("applyTextDiff: fills from empty string", () => {
  const { ytext } = textDoc("");
  applyTextDiff(ytext, "", "abc");
  assert.equal(ytext.toString(), "abc");
});

test("applyTextDiff: runs inside a single transaction tagged with the given origin", () => {
  const { ytext } = textDoc("helo");
  const origins: unknown[] = [];
  ytext.observe((_event, transaction) => origins.push(transaction.origin));

  const origin = Symbol("local");
  applyTextDiff(ytext, "helo", "hello", origin);

  // One transaction → one observed event, regardless of delete+insert inside it.
  assert.deepEqual(origins, [origin]);
});

// ---------------------------------------------------------------------------
// adjustIndex — remap a pre-change index through an observe delta
// ---------------------------------------------------------------------------

test("adjustIndex: empty delta leaves the index unchanged", () => {
  assert.equal(adjustIndex(3, []), 3);
});

test("adjustIndex: retain-only delta leaves the index unchanged", () => {
  assert.equal(adjustIndex(5, [{ retain: 10 }]), 5);
});

test("adjustIndex: insertion strictly before the index shifts it right", () => {
  // "abcdef" -> insert "XY" at 0 -> "XYabcdef"; index 3 ("d") becomes 5.
  assert.equal(adjustIndex(3, [{ insert: "XY" }]), 5);
});

test("adjustIndex: insertion exactly at the index sticks the cursor after it", () => {
  assert.equal(adjustIndex(2, [{ retain: 2 }, { insert: "XY" }]), 4);
});

test("adjustIndex: insertion strictly after the index leaves it unchanged", () => {
  assert.equal(adjustIndex(2, [{ retain: 5 }, { insert: "XY" }]), 2);
});

test("adjustIndex: object insert (e.g. embed) counts as length 1", () => {
  assert.equal(adjustIndex(0, [{ insert: {} }]), 1);
});

test("adjustIndex: deletion strictly before the index shifts it left", () => {
  // "abcdef" -> delete 2 at 0 -> "cdef"; index 4 ("e") becomes 2.
  assert.equal(adjustIndex(4, [{ delete: 2 }]), 2);
});

test("adjustIndex: deletion that spans past the index clamps the shift to the index", () => {
  // Deleting 5 chars starting at 0 while the cursor sat at index 2: it can only
  // move back to 0, not go negative.
  assert.equal(adjustIndex(2, [{ delete: 5 }]), 0);
});

test("adjustIndex: deletion strictly after the index leaves it unchanged", () => {
  assert.equal(adjustIndex(2, [{ retain: 5 }, { delete: 3 }]), 2);
});

test("adjustIndex: deletion starting exactly at the index leaves it unchanged", () => {
  assert.equal(adjustIndex(2, [{ retain: 2 }, { delete: 3 }]), 2);
});

test("adjustIndex: result never goes negative even with compounding deletes", () => {
  assert.equal(
    adjustIndex(1, [{ delete: 1 }, { delete: 1 }, { delete: 1 }]),
    0,
  );
});

test("adjustIndex: retain then insert then delete composes across ops", () => {
  // Start at index 5. Retain 2 (pos->2, index still ahead). Insert 3 before
  // index (pos 2 <= 5) → index becomes 8. Then delete 1 at pos 2 (before the
  // now-adjusted index) → index becomes 7.
  const delta = [{ retain: 2 }, { insert: "abc" }, { delete: 1 }];
  assert.equal(adjustIndex(5, delta), 7);
});

test("adjustIndex: index 0 with a leading insert still sticks right", () => {
  assert.equal(adjustIndex(0, [{ insert: "a" }]), 1);
});

// ---------------------------------------------------------------------------
// colorFromId — deterministic presence color from a numeric client id
// ---------------------------------------------------------------------------

test("colorFromId: is deterministic for the same id", () => {
  assert.equal(colorFromId(42), colorFromId(42));
});

test("colorFromId: returns one of the palette entries", () => {
  const color = colorFromId(3);
  assert.match(color, /^#[0-9a-f]{6}$/);
});

test("colorFromId: wraps around for ids larger than the palette size", () => {
  // Palette has 8 entries; id 8 wraps to the same slot as id 0.
  assert.equal(colorFromId(8), colorFromId(0));
});

test("colorFromId: handles negative ids by using the absolute value", () => {
  assert.equal(colorFromId(-3), colorFromId(3));
});

test("colorFromId: truncates non-integer ids", () => {
  assert.equal(colorFromId(3.9), colorFromId(3));
});

test("colorFromId: zero id resolves to the first palette entry", () => {
  assert.equal(colorFromId(0), "#6366f1");
});

// ---------------------------------------------------------------------------
// initialsOf — two-letter avatar initials from a display name
// ---------------------------------------------------------------------------

test("initialsOf: single word uses its first two letters, uppercased", () => {
  assert.equal(initialsOf("madonna"), "MA");
});

test("initialsOf: two words use first letter of each, uppercased", () => {
  assert.equal(initialsOf("ada lovelace"), "AL");
});

test("initialsOf: more than two words use first and last word initials", () => {
  assert.equal(initialsOf("Grace Brewster Hopper"), "GH");
});

test("initialsOf: collapses extra internal whitespace", () => {
  assert.equal(initialsOf("Ada   Lovelace"), "AL");
});

test("initialsOf: trims leading/trailing whitespace", () => {
  assert.equal(initialsOf("  Ada Lovelace  "), "AL");
});

test("initialsOf: empty/whitespace-only name falls back to a placeholder", () => {
  assert.equal(initialsOf(""), "?");
  assert.equal(initialsOf("   "), "?");
});

test("initialsOf: single-character name is padded by itself, not crashing", () => {
  assert.equal(initialsOf("A"), "A");
});
