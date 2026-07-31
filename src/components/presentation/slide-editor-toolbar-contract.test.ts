import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { MIN_DECK_SLIDES_MESSAGE } from "@/lib/presentation";
import { buildDeck, buildMinimalDeck } from "@/test/builders/presentation-deck";
import { deleteActiveSlideFromToolbar } from "./slide-editor-toolbar-actions";

const source = readFileSync(
  new URL("./slide-editor.tsx", import.meta.url),
  "utf8",
);
const deckToolbarSource = readFileSync(
  new URL("./toolbar/deck-toolbar.tsx", import.meta.url),
  "utf8",
);
const topToolbarSource = readFileSync(
  new URL("./slide-editor-top-toolbar.tsx", import.meta.url),
  "utf8",
);
const toolbarSource = `${source}\n${topToolbarSource}`;
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
const commandPaletteControllerSource = readFileSync(
  new URL("./use-slide-command-palette-controller.ts", import.meta.url),
  "utf8",
);
const precisionGuidesControlsSource = readFileSync(
  new URL("./precision-guides-controls.tsx", import.meta.url),
  "utf8",
);

describe("SlideEditor toolbar command ownership", () => {
  test("exposes the top command row as a named deck toolbar landmark", () => {
    assert.equal(
      topToolbarSource.includes("<DeckToolbar busy={toolbarActionPending}>"),
      true,
    );
    assert.match(
      deckToolbarSource,
      /<header[\s\S]*role="toolbar"[\s\S]*aria-label="Deck tools"[\s\S]*aria-busy={busy}/,
    );
  });

  test("renders slide master controls in the top toolbar as a keyboard-focusable dialog command", () => {
    assert.match(
      topToolbarSource,
      /label="Slide master"[\s\S]*hasPopup="dialog"[\s\S]*setDeckChromeToolbarOpen\(\(open\) => !open\)/,
    );
    assert.equal(
      topToolbarSource.includes('aria-label="Slide master controls"'),
      true,
    );
  });

  test("routes slide master updates through existing deck and slide patch handlers", () => {
    assert.match(
      topToolbarSource,
      /<DeckChromePanel[\s\S]*onUpdateChrome={handleUpdateDeckChrome}[\s\S]*onUpdateSlideProps={handleUpdateProps}/,
    );
  });

  test("blocks stage pointer handling while floating toolbar layers are open", () => {
    assert.equal(source.includes("const stageInteractionsBlocked ="), true);
    assert.equal(source.includes("deckChromeToolbarOpen ||"), true);
    assert.equal(source.includes("compactToolbarMenuOpen ||"), true);
    assert.equal(source.includes("topToolbarSelectMenuOpen ||"), true);
    assert.equal(topToolbarSource.includes("onSelectMenuOpenChange"), true);
    assert.equal(source.includes("stageInteractionsBlocked,"), true);
    assert.match(
      stageGestureControllerSource,
      /handleStagePointerDown[\s\S]*stageInteractionsBlocked[\s\S]*return;/,
    );
    assert.match(
      stageGestureControllerSource,
      /handleStagePointerMove[\s\S]*stageInteractionsBlocked[\s\S]*setHoveredNodeId/,
    );
  });

  test("resolves inline text editor styles from flattened render nodes", () => {
    assert.match(
      source,
      /const resolvedEditNode = getSlideRenderLists\(\s*activeSlideTree,\s*\)\.userNodes\.find/,
    );
    assert.equal(source.includes("activeSlideTree.nodes.find"), false);
  });

  test("keeps low-frequency toolbar commands behind a More menu", () => {
    assert.equal(
      topToolbarSource.includes('aria-label="Open more deck commands"'),
      true,
    );
    assert.equal(
      topToolbarSource.includes('aria-label="More deck commands"'),
      true,
    );
    assert.match(
      topToolbarSource,
      /aria-label="More deck commands"[\s\S]*Command palette[\s\S]*Keyboard shortcuts[\s\S]*Save now[\s\S]*Diagnostics/,
    );
  });

  test("portals top toolbar popovers out of clipped editor chrome", () => {
    assert.match(
      topToolbarSource,
      /<Popover[\s\S]*aria-label="Slide master controls"[\s\S]*portal[\s\S]*className="max-h-\[calc\(100vh-6rem\)\] w-\[22rem\] overflow-y-auto p-0"/,
    );
    assert.match(
      topToolbarSource,
      /<Popover[\s\S]*aria-label="More deck commands"[\s\S]*portal[\s\S]*className="w-64 p-2"/,
    );
    assert.match(
      topToolbarSource,
      /<Popover[\s\S]*aria-label="Export slides"[\s\S]*portal[\s\S]*className="w-44 p-1"/,
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
      topToolbarSource.includes("onKeyDown={handleCompactToolbarMenuKeyDown}"),
      true,
    );
    assert.equal(
      source.includes("closeCompactToolbarMenuAndRestoreFocus();"),
      true,
    );
  });

  test("keeps the export menu keyboard navigable from the toolbar trigger", () => {
    assert.equal(
      source.includes("focusFirstMenuCommand(exportMenuPanelRef.current)"),
      true,
    );
    assert.equal(
      topToolbarSource.includes("buttonRef={exportMenuTriggerRef}"),
      true,
    );
    assert.equal(topToolbarSource.includes('hasPopup="menu"'), true);
    assert.equal(topToolbarSource.includes("expanded={exportMenuOpen}"), true);
    assert.equal(
      topToolbarSource.includes(
        "controls={exportMenuOpen ? exportMenuId : undefined}",
      ),
      true,
    );
    assert.equal(
      topToolbarSource.includes("onKeyDown={handleExportMenuKeyDown}"),
      true,
    );
    assert.equal(
      source.includes("closeExportMenuAndRestoreFocus();") &&
        source.includes("container: exportMenuPanelRef.current"),
      true,
    );
  });

  test("keeps first-layer deck actions visible and status actions out of the main row", () => {
    assert.equal(topToolbarSource.includes('label="Deck setup"'), true);
    assert.equal(topToolbarSource.includes('aria-label="Deck theme"'), true);
    assert.equal(topToolbarSource.includes('aria-label="Slide ratio"'), true);
    assert.equal(topToolbarSource.includes('label="Slide master"'), true);
    assert.equal(topToolbarSource.includes("sourceActionLabel"), true);
    assert.equal(
      topToolbarSource.includes('label="Regenerate deck from document"'),
      true,
    );
    assert.equal(topToolbarSource.includes('label="Export slides"'), true);
    assert.equal(topToolbarSource.includes("Export PDF"), true);
    assert.equal(topToolbarSource.includes("Export PNGs"), true);
    assert.equal(topToolbarSource.includes('label="Close slide editor"'), true);
    assert.equal(toolbarSource.includes('aria-label="Save slide deck"'), false);
  });

  test("exposes a pressed-state snap toggle in the deck toolbar", () => {
    assert.equal(
      topToolbarSource.includes('label="Toggle snap to guides"'),
      true,
    );
    assert.equal(topToolbarSource.includes("active={snapToGuides}"), true);
    assert.equal(deckToolbarSource.includes("aria-pressed={active"), true);
    assert.equal(
      topToolbarSource.includes("onClick={toggleSnapToGuides}"),
      true,
    );
  });

  test("exposes persistent grid, ruler, and custom guide controls", () => {
    assert.equal(
      precisionGuidesControlsSource.includes('label="Toggle grid overlay"'),
      true,
    );
    assert.equal(
      precisionGuidesControlsSource.includes('label="Toggle rulers"'),
      true,
    );
    assert.equal(
      precisionGuidesControlsSource.includes('label="Manage custom guides"'),
      true,
    );
    assert.equal(
      precisionGuidesControlsSource.includes('aria-label="Custom guides"'),
      true,
    );
    assert.equal(
      precisionGuidesControlsSource.includes("data-precision-grid-overlay"),
      true,
    );
    assert.equal(
      precisionGuidesControlsSource.includes("data-precision-ruler-overlay"),
      true,
    );
    assert.equal(
      precisionGuidesControlsSource.includes("data-precision-guides-overlay"),
      true,
    );
  });

  test("offers brand authoring from the theme picker rather than slide master", () => {
    assert.equal(
      topToolbarSource.includes("onCustomize={onCustomizeTheme}"),
      true,
    );
    assert.equal(
      precisionGuidesControlsSource.includes("BrandKitAuthoringPanel"),
      false,
    );
    const authoringDialogWiring = source.match(
      /<BrandKitAuthoringDialog[\s\S]*?onClose=\{closeBrandKitAuthoring\}/,
    )?.[0];
    assert.ok(authoringDialogWiring);
    assert.equal(
      authoringDialogWiring.includes("onBrandKitSaved?.(result)"),
      true,
    );
    assert.equal(
      authoringDialogWiring.includes(
        "onBrandKitSaved?.(result);\n            setBrandKitAuthoringOpen(false)",
      ),
      false,
    );
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
    assert.equal(
      stageGestureControllerSource.includes("...customGuides"),
      true,
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

  test("keeps slide deletion out of the current-object context toolbar", () => {
    assert.equal(
      source.includes("canDeleteSlide={deck.slides.length > 1}"),
      false,
    );
  });

  test("wires keyboard shortcut help button to the shared dialog surface", () => {
    assert.equal(topToolbarSource.includes("onOpenShortcutHelp()"), true);
    assert.equal(
      topToolbarSource.includes('aria-label="Keyboard shortcuts"'),
      true,
    );
    assert.equal(
      source.includes(
        "<KeyboardShortcutHelpDialog\n        open={shortcutHelpOpen}",
      ),
      true,
    );
  });

  test("wires the slide command palette to Cmd/Ctrl+K and the More menu", () => {
    assert.equal(
      topToolbarSource.includes("setCommandPaletteOpen(true)"),
      true,
    );
    assert.equal(
      topToolbarSource.includes('aria-label="Command palette"'),
      true,
    );
    assert.equal(
      source.includes(
        "<SlideCommandPalette\n        open={commandPaletteOpen}",
      ),
      true,
    );
    assert.match(
      commandPaletteControllerSource,
      /event\.key\.toLowerCase\(\) === "k"[\s\S]*event\.metaKey \|\| event\.ctrlKey/,
    );
    assert.equal(
      commandPaletteControllerSource.includes(
        "resolveSlideCommandPaletteCommands({",
      ),
      true,
    );
    assert.equal(
      commandPaletteControllerSource.includes(
        'else args.openInspectorPanel("source")',
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
    assert.equal(topToolbarSource.includes('label="Present slides"'), true);
    assert.equal(topToolbarSource.includes('label="Share slides"'), true);
    assert.equal(
      topToolbarSource.includes("void handleRoundtripAction(") &&
        topToolbarSource.includes("onPresent") &&
        topToolbarSource.includes("onShare"),
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

  test("routes Save now and all async deck commands through one pending operation boundary", () => {
    assert.equal(
      topToolbarSource.includes("void handleSaveNow();") &&
        !topToolbarSource.includes("void onSave(deck);") &&
        topToolbarSource.includes(
          'disabled={saveStatus === "saving" || toolbarActionPending}',
        ) &&
        shellControllerSource.includes(
          "if (!claimToolbarOperation(operation))",
        ) &&
        shellControllerSource.includes("unstable_rethrow(error)") &&
        commandPaletteControllerSource.includes("void args.handleSaveNow();"),
      true,
    );
  });
});

describe("deleteActiveSlideFromToolbar", () => {
  test("returns invariant status for one-slide decks", () => {
    const deck = buildMinimalDeck();
    const result = deleteActiveSlideFromToolbar(deck, deck.slides[0]?.id);

    assert.equal(result.deleted, false);
    assert.equal(result.nextDeck, deck);
    assert.equal(result.nextIndex, 0);
    assert.equal(result.statusMessage, MIN_DECK_SLIDES_MESSAGE);
  });

  test("deletes active slide and advances to the next valid index", () => {
    const deck = buildDeck();
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
