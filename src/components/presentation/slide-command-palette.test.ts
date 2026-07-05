import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const source = readFileSync(
  new URL("./slide-command-palette.tsx", import.meta.url),
  "utf8",
);

describe("SlideCommandPalette", () => {
  test("uses the shared Dialog so Escape and focus restoration stay consistent", () => {
    assert.equal(
      source.includes('import { Dialog } from "@/components/ui/dialog";'),
      true,
    );
    assert.match(
      source,
      /<Dialog[\s\S]*open={open}[\s\S]*onClose={onClose}[\s\S]*aria-labelledby="slide-command-palette-title"/,
    );
    assert.equal(source.includes('aria-label="Close command palette"'), true);
  });

  test("implements searchable active-descendant keyboard navigation", () => {
    assert.equal(
      source.includes("filterSlideCommandPaletteCommands(commands, query)"),
      true,
    );
    assert.equal(source.includes('role="combobox"'), true);
    assert.equal(source.includes('role="listbox"'), true);
    assert.equal(source.includes('role="option"'), true);
    assert.equal(source.includes("aria-activedescendant="), true);
    assert.match(source, /event\.key === "ArrowDown"[\s\S]*setActiveIndex/);
    assert.match(source, /event\.key === "ArrowUp"[\s\S]*setActiveIndex/);
    assert.match(source, /event\.key === "Enter"[\s\S]*runCommand/);
  });

  test("renders disabled reasons instead of dropping invalid commands", () => {
    assert.equal(source.includes("command.disabledReason"), true);
    assert.equal(source.includes("aria-disabled={disabled}"), true);
    assert.equal(source.includes("disabled={disabled}"), true);
  });
});
