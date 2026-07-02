import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { canvasShortcutHelp } from "./canvas-shortcut-help";

describe("canvasShortcutHelp (#535)", () => {
  test("returns labelled groups with non-empty entries", () => {
    const groups = canvasShortcutHelp();
    assert.ok(groups.length >= 5);
    for (const group of groups) {
      assert.ok(group.title.length > 0);
      assert.ok(group.entries.length > 0);
      for (const entry of group.entries) {
        assert.ok(entry.keys.length > 0);
        assert.ok(entry.description.length > 0);
      }
    }
  });

  test("documents the resize and traversal shortcuts", () => {
    const flat = canvasShortcutHelp().flatMap((g) => g.entries);
    assert.ok(flat.some((e) => e.keys === "Alt + Arrow"));
    assert.ok(flat.some((e) => e.keys === "Alt + Shift + Arrow"));
    assert.ok(flat.some((e) => e.keys === "[ / ]"));
    assert.ok(flat.some((e) => e.keys === "Ctrl/⌘ + [ / ]"));
    assert.ok(flat.some((e) => e.keys === "Shift + [ / ]"));
    assert.ok(flat.some((e) => e.keys === "Tab / Shift + Tab"));
  });

  test("uses ⌘ on mac and Ctrl elsewhere", () => {
    const mac = canvasShortcutHelp({ isMac: true }).flatMap((g) => g.entries);
    const win = canvasShortcutHelp({ isMac: false }).flatMap((g) => g.entries);
    assert.ok(mac.some((e) => e.keys.includes("⌘")));
    assert.ok(win.some((e) => e.keys.includes("Ctrl")));
  });
});
