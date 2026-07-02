import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { inlineTextAlignForCommand } from "./inline-text-editor";

describe("inlineTextAlignForCommand", () => {
  test("maps toolbar align commands to persisted text align values", () => {
    assert.equal(inlineTextAlignForCommand("align-left"), "left");
    assert.equal(inlineTextAlignForCommand("align-center"), "center");
    assert.equal(inlineTextAlignForCommand("align-right"), "right");
  });

  test("ignores non-align inline commands", () => {
    assert.equal(inlineTextAlignForCommand("bold"), undefined);
    assert.equal(inlineTextAlignForCommand("bullet-list"), undefined);
    assert.equal(inlineTextAlignForCommand("font-size"), undefined);
  });
});
