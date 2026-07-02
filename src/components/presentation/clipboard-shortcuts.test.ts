import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { clipboardShortcutActionFromKey } from "./clipboard-shortcuts";

describe("clipboardShortcutActionFromKey", () => {
  test("maps Cmd/Ctrl + X to cut", () => {
    assert.equal(
      clipboardShortcutActionFromKey({
        metaKey: true,
        ctrlKey: false,
        key: "x",
      }),
      "cut",
    );
    assert.equal(
      clipboardShortcutActionFromKey({
        metaKey: false,
        ctrlKey: true,
        key: "X",
      }),
      "cut",
    );
  });

  test("keeps copy and paste mappings unchanged", () => {
    assert.equal(
      clipboardShortcutActionFromKey({
        metaKey: true,
        ctrlKey: false,
        key: "c",
      }),
      "copy",
    );
    assert.equal(
      clipboardShortcutActionFromKey({
        metaKey: false,
        ctrlKey: true,
        key: "v",
      }),
      "paste",
    );
  });

  test("ignores non-clipboard shortcuts", () => {
    assert.equal(
      clipboardShortcutActionFromKey({
        metaKey: false,
        ctrlKey: false,
        key: "x",
      }),
      null,
    );
    assert.equal(
      clipboardShortcutActionFromKey({
        metaKey: true,
        ctrlKey: false,
        key: "z",
      }),
      null,
    );
  });
});
