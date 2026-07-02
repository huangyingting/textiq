import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

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
});
