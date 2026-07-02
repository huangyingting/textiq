import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { MIN_DECK_SLIDES_MESSAGE } from "@/lib/presentation-vnext";
import { buildDeckV7, buildMinimalDeckV7 } from "@/test/builders/deck-v7";
import { deleteActiveSlideFromToolbar } from "./slide-editor-toolbar-actions";

const source = readFileSync(
  new URL("./slide-editor-vnext.tsx", import.meta.url),
  "utf8",
);
const deckToolbarSource = readFileSync(
  new URL("./toolbar/deck-toolbar.tsx", import.meta.url),
  "utf8",
);
const footerSource = readFileSync(
  new URL("./slide-editor-footer.tsx", import.meta.url),
  "utf8",
);
const shellControllerSource = readFileSync(
  new URL("./use-slide-editor-shell-controller.tsx", import.meta.url),
  "utf8",
);
const stageGestureControllerSource = readFileSync(
  new URL("./use-stage-gesture-controller.ts", import.meta.url),
  "utf8",
);

describe("SlideEditorVNext toolbar command ownership", () => {
  test("exposes the top command row as a named deck toolbar landmark", () => {
    assert.equal(source.includes("<DeckToolbar>"), true);
    assert.match(
      deckToolbarSource,
      /<header[\s\S]*role="toolbar"[\s\S]*aria-label="Deck tools"/,
    );
  });

  test("renders deck chrome in the top toolbar as a keyboard-focusable dialog command", () => {
    assert.match(
      source,
      /label="Deck chrome"[\s\S]*hasPopup="dialog"[\s\S]*setDeckChromeToolbarOpen\(\(open\) => !open\)/,
    );
    assert.equal(source.includes('aria-label="Deck chrome controls"'), true);
  });

  test("routes toolbar deck chrome updates through existing deck and slide patch handlers", () => {
    assert.match(
      source,
      /<DeckChromePanel[\s\S]*onUpdateChrome={handleUpdateDeckChrome}[\s\S]*onUpdateSlideProps={handleUpdateProps}/,
    );
  });

  test("keeps low-frequency toolbar commands behind a More menu", () => {
    assert.equal(source.includes('aria-label="Open more deck commands"'), true);
    assert.equal(source.includes('aria-label="More deck commands"'), true);
    assert.match(
      source,
      /aria-label="More deck commands"[\s\S]*Keyboard shortcuts[\s\S]*Save now[\s\S]*Diagnostics/,
    );
  });

  test("portals top toolbar popovers out of clipped editor chrome", () => {
    assert.match(
      source,
      /<Popover[\s\S]*aria-label="Document source commands"[\s\S]*portal[\s\S]*className="w-72 p-2"/,
    );
    assert.match(
      source,
      /<Popover[\s\S]*aria-label="Deck chrome controls"[\s\S]*portal[\s\S]*className="max-h-\[calc\(100vh-6rem\)\] w-\[22rem\] overflow-y-auto p-0"/,
    );
    assert.match(
      source,
      /<Popover[\s\S]*aria-label="More deck commands"[\s\S]*portal[\s\S]*className="w-64 p-2"/,
    );
  });

  test("keeps compact toolbar menu keyboard navigable", () => {
    assert.equal(
      source.includes(
        "focusFirstMenuCommand(compactToolbarMenuPanelRef.current)",
      ),
      true,
    );
    assert.equal(
      source.includes("onKeyDown={handleCompactToolbarMenuKeyDown}"),
      true,
    );
    assert.equal(
      source.includes("closeCompactToolbarMenuAndRestoreFocus();"),
      true,
    );
  });

  test("keeps first-layer deck actions visible and status actions out of the main row", () => {
    assert.equal(source.includes('label="Deck setup"'), true);
    assert.equal(source.includes('aria-label="Deck theme"'), true);
    assert.equal(source.includes('aria-label="Slide ratio"'), true);
    assert.equal(source.includes('label="Deck chrome"'), true);
    assert.equal(source.includes('aria-label="Document source"'), true);
    assert.equal(
      source.includes('label="Regenerate deck from document"'),
      true,
    );
    assert.equal(source.includes('label="Export slides"'), true);
    assert.equal(source.includes("Export PDF"), true);
    assert.equal(source.includes("Export PNGs"), true);
    assert.equal(source.includes('label="Close slide editor"'), true);
    assert.equal(source.includes('aria-label="Save slide deck"'), false);
  });

  test("exposes a pressed-state snap toggle in the deck toolbar", () => {
    assert.equal(source.includes('label="Toggle snap to guides"'), true);
    assert.equal(source.includes("active={snapToGuides}"), true);
    assert.equal(deckToolbarSource.includes("aria-pressed={active"), true);
    assert.equal(source.includes("onClick={toggleSnapToGuides}"), true);
  });

  test("gates move and resize guide snapping behind snap state", () => {
    assert.equal(
      stageGestureControllerSource.includes(
        "snapToGuides: snapToGuides && !moveEvent.altKey",
      ),
      true,
    );
    assert.match(
      stageGestureControllerSource,
      /snapToGuides && !moveEvent\.altKey[\s\S]*snapFrameToStageGuides/,
    );
  });

  test("removes generic element insertion from the top toolbar", () => {
    assert.equal(source.includes('aria-label="Insert element"'), false);
  });

  test("passes insertion handlers to the current-object context toolbar", () => {
    assert.equal(source.includes("onInsertText={handleInsertText}"), true);
    assert.equal(source.includes("onInsertShape={handleInsertShape}"), true);
    assert.equal(source.includes("onInsertImage={handleInsertImage}"), true);
    assert.equal(
      source.includes("onInsertVisual={() => void handleInsertVisual()}"),
      true,
    );
    assert.equal(
      source.includes("onInsertConnector={handleInsertConnector}"),
      true,
    );
    assert.equal(source.includes("onInsertTable={handleInsertTable}"), true);
  });

  test("passes delete availability to the current-object context toolbar", () => {
    assert.equal(
      source.includes("canDeleteSlide={deck.slides.length > 1}"),
      true,
    );
  });

  test("wires keyboard shortcut help button to the shared dialog surface", () => {
    assert.equal(source.includes("setShortcutHelpOpen(true)"), true);
    assert.equal(source.includes('aria-label="Keyboard shortcuts"'), true);
    assert.equal(
      source.includes(
        "<KeyboardShortcutHelpDialog\n        open={shortcutHelpOpen}",
      ),
      true,
    );
  });

  test("gives zoom and status popovers menu trigger semantics", () => {
    assert.equal(
      footerSource.includes(
        "aria-label={`Set slide zoom (${stageZoomPercent}%)`}",
      ),
      true,
    );
    assert.equal(
      footerSource.includes(
        "aria-controls={zoomMenuOpen ? zoomMenuId : undefined}",
      ),
      true,
    );
    assert.equal(
      footerSource.includes(
        "aria-label={`Footer status: ${saveStatusLabel}. ${diagnosticSummary}.`}",
      ),
      true,
    );
    assert.equal(
      footerSource.includes(
        "footerStatusMenuOpen ? footerStatusMenuId : undefined",
      ),
      true,
    );
    assert.equal(footerSource.includes('aria-haspopup="menu"'), true);
    assert.equal(footerSource.includes('role="menu"'), true);
  });

  test("routes toolbar menu keyboard handling through menu command helpers", () => {
    assert.equal(
      source.includes("focusFirstMenuCommand(zoomMenuPanelRef.current)"),
      true,
    );
    assert.equal(
      source.includes(
        "focusFirstMenuCommand(footerStatusMenuPanelRef.current)",
      ),
      true,
    );
    assert.equal(footerSource.includes("onKeyDown={onZoomMenuKeyDown}"), true);
    assert.equal(
      footerSource.includes("onKeyDown={onFooterStatusMenuKeyDown}"),
      true,
    );
    assert.equal(source.includes("moveMenuCommandFocus({"), true);
    assert.equal(source.includes("closeZoomMenuAndRestoreFocus();"), true);
    assert.equal(
      source.includes("closeFooterStatusMenuAndRestoreFocus();"),
      true,
    );
  });

  test("marks zoom and status commands with menu item roles", () => {
    assert.equal(footerSource.includes('role="menuitemradio"'), true);
    assert.equal(footerSource.includes('role="menuitem"'), true);
  });

  test("exposes present/share roundtrip commands in the top toolbar", () => {
    assert.equal(source.includes('label="Present slides"'), true);
    assert.equal(source.includes('label="Share slides"'), true);
    assert.equal(
      source.includes("void handleRoundtripAction(") &&
        source.includes("onPresent") &&
        source.includes("onShare"),
      true,
    );
  });

  test("routes present/share actions through explicit save-first handling", () => {
    assert.equal(
      source.includes("useSlideEditorShellController({") &&
        source.includes("deck,") &&
        source.includes("onSave,") &&
        source.includes("handleRoundtripAction") &&
        shellControllerSource.includes(
          "async function handleRoundtripAction(",
        ) &&
        shellControllerSource.includes("if (onSave)") &&
        shellControllerSource.includes(
          "const saveResult = await onSave(deck);",
        ) &&
        shellControllerSource.includes("if (!saveResult.ok)"),
      true,
    );
  });
});

describe("deleteActiveSlideFromToolbar", () => {
  test("returns invariant status for one-slide decks", () => {
    const deck = buildMinimalDeckV7();
    const result = deleteActiveSlideFromToolbar(deck, deck.slides[0]?.id);

    assert.equal(result.deleted, false);
    assert.equal(result.nextDeck, deck);
    assert.equal(result.nextIndex, 0);
    assert.equal(result.statusMessage, MIN_DECK_SLIDES_MESSAGE);
  });

  test("deletes active slide and advances to the next valid index", () => {
    const deck = buildDeckV7();
    const deletingSlideId = deck.slides[1]!.id;
    const result = deleteActiveSlideFromToolbar(deck, deletingSlideId);

    assert.equal(result.deleted, true);
    assert.equal(result.nextDeck.slides.length, deck.slides.length - 1);
    assert.equal(
      result.nextDeck.slides.some((slide) => slide.id === deletingSlideId),
      false,
    );
    assert.equal(result.nextIndex, 0);
    assert.equal(result.statusMessage, undefined);
  });
});
