import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  EDITOR_TEXT_TOOL_SHORTCUT_IDS,
  SHORTCUT_REGISTRY,
  SHORTCUT_SCOPES,
  formatShortcut,
  matchesShortcut,
  shortcutById,
  shortcutCanonical,
  shortcutDisplayLabel,
  shortcutDisplayTokens,
  shortcutsForScope,
} from "./catalog";
import { _CANVAS_RUNTIME_SHORTCUT_IDS } from "./canvas-runtime";

describe("shortcut catalog registry (#737, #751)", () => {
  test("has unique ids and complete executable metadata", () => {
    const ids = new Set<string>();
    for (const shortcut of SHORTCUT_REGISTRY) {
      assert.equal(ids.has(shortcut.id), false, `duplicate id ${shortcut.id}`);
      ids.add(shortcut.id);
      assert.ok(shortcut.scope.length > 0);
      assert.ok(shortcut.surface.length > 0);
      assert.ok(shortcut.description.length > 0);
      assert.ok(shortcut.displayTokens.length > 0);
      assert.ok(shortcut.match.key);
      assert.equal(typeof shortcut.allowInTextInput, "boolean");
    }
  });

  test("scope helper follows declared scope order and hides no-op groups", () => {
    for (const scope of SHORTCUT_SCOPES) {
      const entries = shortcutsForScope(scope);
      assert.ok(entries.every((entry) => entry.scope === scope));
    }
    assert.deepEqual(
      shortcutsForScope("Global").map((entry) => entry.id),
      ["global.help"],
    );
  });

  test("pure matcher uses registry metadata for global shortcuts", () => {
    assert.equal(matchesShortcut("global.help", key("?")), true);
    assert.equal(
      matchesShortcut("global.help", key("?", { metaKey: true })),
      false,
    );
    assert.equal(matchesShortcut("dashboard.new-document", key("N")), true);
    assert.equal(
      matchesShortcut("dashboard.new-document", key("n", { shiftKey: true })),
      false,
    );
    assert.equal(
      matchesShortcut(
        "editor.toggle-preview",
        key("p", { ctrlKey: true, shiftKey: true }),
      ),
      true,
    );
  });

  test("editor text tool shortcut ids resolve from the same registry", () => {
    assert.deepEqual(
      EDITOR_TEXT_TOOL_SHORTCUT_IDS.map((id) => shortcutById(id).surface),
      Array.from(
        { length: EDITOR_TEXT_TOOL_SHORTCUT_IDS.length },
        () => "text-toolbar",
      ),
    );
    assert.equal(shortcutCanonical("editor.format.bold"), "Mod+B");
    assert.equal(
      formatShortcut(shortcutCanonical("editor.align.left"), true),
      "⌘⇧L",
    );
    assert.equal(
      formatShortcut(shortcutCanonical("editor.align.left"), false),
      "Ctrl+Shift+L",
    );
  });

  test("app-level shortcuts have no conflicting matcher metadata per surface", () => {
    const appShortcuts = SHORTCUT_REGISTRY.filter(
      (shortcut) => shortcut.handler === "global",
    );
    const signatures = new Set<string>();
    for (const shortcut of appShortcuts) {
      const signature = `${shortcut.surface}:${JSON.stringify(shortcut.match)}`;
      assert.equal(
        signatures.has(signature),
        false,
        `${shortcut.id} conflicts with another app-level shortcut`,
      );
      signatures.add(signature);
    }
  });

  test("editor shortcuts shown in help have unique matcher metadata", () => {
    const signatures = new Set<string>();
    for (const shortcut of shortcutsForScope("Editor")) {
      const signature = JSON.stringify(shortcut.match);
      assert.equal(
        signatures.has(signature),
        false,
        `${shortcut.id} conflicts with another editor shortcut`,
      );
      signatures.add(signature);
    }
  });

  test("display helpers support generic and platform-specific labels", () => {
    const togglePreview = shortcutById("editor.toggle-preview");
    assert.deepEqual(shortcutDisplayTokens(togglePreview), [
      "Ctrl/⌘",
      "Shift",
      "P",
    ]);

    const group = shortcutById("canvas.arrange.group");
    assert.equal(shortcutDisplayLabel(group, { isMac: true }), "⌘ + G");
    assert.equal(shortcutDisplayLabel(group, { isMac: false }), "Ctrl + G");
  });

  test("presentation shortcuts expose runtime navigation and in-app-only tools", () => {
    assert.equal(matchesShortcut("presentation.next", key("PageDown")), true);
    assert.equal(
      matchesShortcut("presentation.previous", key("ArrowUp")),
      true,
    );
    assert.equal(matchesShortcut("presentation.first", key("Home")), true);
    assert.equal(matchesShortcut("presentation.last", key("End")), true);
    assert.deepEqual(shortcutDisplayTokens(shortcutById("presentation.next")), [
      "→",
      "↓",
      "Space",
      "PgDn",
    ]);
    assert.equal(shortcutById("presentation.timer").surface, "present-mode");
    assert.equal(shortcutById("presentation.laser").showInGlobalHelp, false);
  });

  test("canvas arrange shortcuts use bracket keys and modifier variants", () => {
    assert.equal(
      matchesShortcut("canvas.arrange.forward-backward", key("]")),
      true,
    );
    assert.equal(
      matchesShortcut("canvas.arrange.forward-backward", key("ArrowRight")),
      false,
    );
    assert.equal(
      matchesShortcut("canvas.arrange.front-back", key("]", { ctrlKey: true })),
      true,
    );
    assert.equal(
      matchesShortcut(
        "canvas.arrange.front-back",
        key("[", { shiftKey: true }),
      ),
      false,
    );
  });

  test("canvas rotation shortcut uses shifted brackets", () => {
    assert.equal(
      matchesShortcut("canvas.rotate.step", key("{", { shiftKey: true })),
      true,
    );
    assert.equal(matchesShortcut("canvas.rotate.step", key("}")), false);
  });

  test("presentation canvas catalog ids stay aligned with runtime handler ids", () => {
    const canvasIds = SHORTCUT_REGISTRY.filter(
      (shortcut) => shortcut.surface === "slide-canvas",
    ).map((shortcut) => shortcut.id);
    assert.equal(canvasIds.length, _CANVAS_RUNTIME_SHORTCUT_IDS.length);
    assert.deepEqual(
      canvasIds.slice().sort(),
      Array.from(_CANVAS_RUNTIME_SHORTCUT_IDS).sort(),
    );
  });
});

function key(
  k: string,
  mods: Partial<{
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
  }> = {},
) {
  return {
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  };
}
