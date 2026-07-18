import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { restoreKeyboardShortcutHelpFocus } from "./keyboard-shortcut-help-dialog";

const source = readFileSync(
  new URL("./keyboard-shortcut-help-dialog.tsx", import.meta.url),
  "utf8",
);

describe("KeyboardShortcutHelpDialog", () => {
  test("builds the overlay with the shared Dialog accessibility contract", () => {
    assert.equal(
      source.includes('import { Dialog } from "@/components/ui/dialog";'),
      true,
    );
    assert.match(
      source,
      /<Dialog[\s\S]*open={open}[\s\S]*onClose={onClose}[\s\S]*aria-labelledby="canvas-keyboard-help-title"/,
    );
    assert.equal(source.includes('id="canvas-keyboard-help-title"'), true);
  });

  test("keeps explicit close controls and shortcut definition semantics", () => {
    assert.match(
      source,
      /<IconButton[\s\S]*aria-label="Close"[\s\S]*onClick={onClose}/,
    );
    assert.equal(source.includes("<section"), true);
    assert.equal(source.includes("<dl"), true);
    assert.equal(source.includes("<dt"), true);
    assert.equal(source.includes("<kbd"), true);
  });

  test("sources shortcut entries from canvasShortcutHelp", () => {
    assert.equal(
      source.includes(
        'import { canvasShortcutHelp } from "@/lib/presentation/canvas-shortcut-help";',
      ),
      true,
    );
    assert.equal(
      source.includes(
        "const groups = useMemo(() => canvasShortcutHelp({ isMac }), [isMac]);",
      ),
      true,
    );
    assert.equal(source.includes("{groups.map((group) => ("), true);
  });

  test("restores focus to the opener and falls back when it was removed", () => {
    let openerFocusCount = 0;
    let fallbackFocusCount = 0;
    const opener = {
      isConnected: true,
      focus: () => {
        openerFocusCount += 1;
      },
    } as HTMLElement;
    const removedOpener = {
      isConnected: false,
      focus: () => {
        openerFocusCount += 1;
      },
    } as HTMLElement;
    const fallback = {
      isConnected: true,
      focus: () => {
        fallbackFocusCount += 1;
      },
    } as HTMLElement;

    restoreKeyboardShortcutHelpFocus(opener, fallback);
    restoreKeyboardShortcutHelpFocus(removedOpener, fallback);

    assert.equal(openerFocusCount, 1);
    assert.equal(fallbackFocusCount, 1);
  });
});
