import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readPositiveInt } from "./collab-utils.mjs";

describe("readPositiveInt", () => {
  it("returns the fallback for empty, negative, malformed, or unsafe values", () => {
    assert.equal(readPositiveInt(undefined, 7), 7);
    assert.equal(readPositiveInt("", 7), 7);
    assert.equal(readPositiveInt("-3", 7), 7);
    assert.equal(readPositiveInt("1e6", 7), 7);
    assert.equal(readPositiveInt("5000ms", 7), 7);
    assert.equal(readPositiveInt(`${Number.MAX_SAFE_INTEGER + 1}`, 7), 7);
  });

  it("returns valid positive decimal integers", () => {
    assert.equal(readPositiveInt("5000", 7), 5000);
    assert.equal(readPositiveInt(" 42 ", 7), 42);
  });
});
