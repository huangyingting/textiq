import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { pairDuplicatesAfterOriginals } from "./stage-duplicate";

describe("pairDuplicatesAfterOriginals", () => {
  test("pairs each original with the clone inserted right after it", () => {
    // duplicateNodes inserts the clone directly after the source.
    const topLevel = [
      { id: "a" },
      { id: "a#copy" },
      { id: "b" },
      { id: "b#copy" },
    ];
    const pairs = pairDuplicatesAfterOriginals(
      topLevel,
      new Set(["a", "b"]),
      new Set(["a#copy", "b#copy"]),
    );
    assert.deepEqual(
      [...pairs.entries()],
      [
        ["a", "a#copy"],
        ["b", "b#copy"],
      ],
    );
  });

  test("ignores untouched neighbours and non-duplicate nodes", () => {
    const topLevel = [
      { id: "keep-1" },
      { id: "a" },
      { id: "a#copy" },
      { id: "keep-2" },
    ];
    const pairs = pairDuplicatesAfterOriginals(
      topLevel,
      new Set(["a"]),
      new Set(["a#copy"]),
    );
    assert.deepEqual([...pairs.entries()], [["a", "a#copy"]]);
  });

  test("returns no pairs when duplicates were not produced", () => {
    const topLevel = [{ id: "a" }, { id: "b" }];
    const pairs = pairDuplicatesAfterOriginals(
      topLevel,
      new Set(["a", "b"]),
      new Set(),
    );
    assert.equal(pairs.size, 0);
  });
});
