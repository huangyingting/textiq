import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { PresentShortcutAction } from "@/lib/presentation/present-shell";

import { resolvePresentModeShortcutEffect } from "./present-mode-shortcuts";

const closedContext = {
  keyboardHelpOpen: false,
  overviewOpen: false,
};

describe("resolvePresentModeShortcutEffect", () => {
  test("maps navigation and presenter tools while overlays are closed", () => {
    const expectedEffects: Record<PresentShortcutAction, unknown> = {
      next: { type: "navigate", action: "next" },
      previous: { type: "navigate", action: "previous" },
      first: { type: "navigate", action: "first" },
      last: { type: "navigate", action: "last" },
      help: { type: "toggle-keyboard-help" },
      exit: { type: "exit" },
      fullscreen: { type: "toggle-fullscreen" },
      notes: { type: "toggle-notes" },
      overview: { type: "toggle-overview" },
      timer: { type: "toggle-timer" },
      laser: { type: "toggle-laser" },
    };

    for (const [action, expected] of Object.entries(expectedEffects)) {
      assert.deepEqual(
        resolvePresentModeShortcutEffect(
          action as PresentShortcutAction,
          closedContext,
        ),
        expected,
      );
    }
  });

  test("escape closes keyboard help before overview or presentation", () => {
    assert.deepEqual(
      resolvePresentModeShortcutEffect("exit", {
        keyboardHelpOpen: true,
        overviewOpen: true,
      }),
      { type: "close-keyboard-help" },
    );
    assert.deepEqual(
      resolvePresentModeShortcutEffect("exit", {
        keyboardHelpOpen: false,
        overviewOpen: true,
      }),
      { type: "close-overview" },
    );
    assert.deepEqual(resolvePresentModeShortcutEffect("exit", closedContext), {
      type: "exit",
    });
  });

  test("keyboard help toggles above either overlay and blocks other shortcuts", () => {
    assert.deepEqual(
      resolvePresentModeShortcutEffect("help", {
        keyboardHelpOpen: true,
        overviewOpen: true,
      }),
      { type: "toggle-keyboard-help" },
    );
    assert.deepEqual(
      resolvePresentModeShortcutEffect("next", {
        keyboardHelpOpen: true,
        overviewOpen: false,
      }),
      { type: "blocked" },
    );
    assert.deepEqual(
      resolvePresentModeShortcutEffect("overview", {
        keyboardHelpOpen: true,
        overviewOpen: true,
      }),
      { type: "blocked" },
    );
  });

  test("overview closes from its shortcut and blocks other presenter actions", () => {
    assert.deepEqual(
      resolvePresentModeShortcutEffect("overview", {
        keyboardHelpOpen: false,
        overviewOpen: true,
      }),
      { type: "close-overview" },
    );
    assert.deepEqual(
      resolvePresentModeShortcutEffect("fullscreen", {
        keyboardHelpOpen: false,
        overviewOpen: true,
      }),
      { type: "blocked" },
    );
  });
});
