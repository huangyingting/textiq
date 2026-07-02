import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { escapeInlineEditorSelectorValue } from "./use-inline-text-editing-controller";

describe("escapeInlineEditorSelectorValue", () => {
  test("escapes ids used by inline editor commit focus lookup", () => {
    assert.equal(escapeInlineEditorSelectorValue('node"a'), 'node\\"a');
    assert.equal(escapeInlineEditorSelectorValue("node\\a"), "node\\\\a");
  });
});
