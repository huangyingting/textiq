"use client";

import {
  Box,
  ChevronDown,
  Command as CommandIcon,
  FileDown,
  Keyboard,
  Link2,
  Magnet,
  MoreHorizontal,
  MonitorPlay,
  Redo2,
  RefreshCw,
  Share2,
  Undo2,
  X,
} from "lucide-react";
import {
  type Dispatch,
  type KeyboardEvent,
  type RefObject,
  type SetStateAction,
} from "react";

import type { ActionResult } from "@/lib/action-result";
import type { PresentationExportFormat } from "@/lib/presentation/export-preflight";
import type { SaveStatus } from "@/lib/presentation/save-status";
import type { Deck, SlideNode } from "@/lib/presentation/schema";
import type { SourceReviewItem } from "@/lib/presentation/source-links";
import type { ThemePackageV1 } from "@/lib/presentation/theme-package-schema";
import type {
  ThemePackageCatalogEntry,
  ThemePackageSelection,
} from "@/lib/presentation/theme-package-registry";
import { Popover } from "@/components/ui/popover";
import { SelectMenu } from "@/components/ui/select-menu";
import type { SelectMenuOption } from "@/components/ui/select-menu";
import { cx, FOCUS_RING } from "@/components/ui/tokens";
import { ThemePreviewPicker } from "./theme-preview-picker";

const CANVAS_RATIO_OPTIONS: readonly SelectMenuOption[] = [
  { value: "16:9", label: "16:9" },
  { value: "4:3", label: "4:3" },
  { value: "square", label: "1:1" },
];

import { DeckChromePanel } from "./inspector";
import type { PrecisionGuidePreferences } from "./precision-guides-storage";
import { PrecisionGuideToolbarControls } from "./precision-guides-controls";
import type { StageGuideInput } from "@/lib/presentation/stage-guides";
import {
  DeckToolbar,
  DeckToolbarButton,
  DeckToolbarDivider,
  DeckToolbarGroup,
  DeckToolbarIconButton,
  DeckToolbarRow,
} from "./toolbar/deck-toolbar";

export interface SlideEditorTopToolbarProps {
  deck: Deck;
  activeSlide: SlideNode | undefined;
  themeCatalogEntries: readonly ThemePackageCatalogEntry[];
  activeThemePackage: ThemePackageV1;
  themePickerTriggerRef: RefObject<HTMLButtonElement | null>;
  currentCanvasFormat: "16:9" | "4:3" | "square";
  deckChromeToolbarOpen: boolean;
  deckChromeToolbarPanelRef: RefObject<HTMLDivElement | null>;
  snapToGuides: boolean;
  precisionGuides: PrecisionGuidePreferences;
  sourceReview: readonly SourceReviewItem[];
  documentSourceIndex: unknown;
  onRegenerate: (() => Promise<ActionResult>) | undefined;
  saveStatus: SaveStatus;
  compactToolbarMenuOpen: boolean;
  compactToolbarMenuTriggerRef: RefObject<HTMLButtonElement | null>;
  compactToolbarMenuPanelRef: RefObject<HTMLDivElement | null>;
  compactToolbarMenuId: string;
  onSave: ((deck: Deck) => Promise<ActionResult>) | undefined;
  saveStatusLabel: string;
  diagnosticsCount: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: (() => void) | undefined;
  onRedo: (() => void) | undefined;
  onPresent: (() => Promise<ActionResult>) | undefined;
  onShare: (() => Promise<ActionResult>) | undefined;
  onExportPptx: (() => Promise<void>) | undefined;
  onExportPdf: (() => Promise<void>) | undefined;
  onExportPng: (() => Promise<void>) | undefined;
  exportMenuOpen: boolean;
  exportMenuId: string;
  exportMenuTriggerRef: RefObject<HTMLButtonElement | null>;
  exportMenuPanelRef: RefObject<HTMLDivElement | null>;
  onClose: (() => void) | undefined;
  handleThemePackageChange: (selection: ThemePackageSelection) => void;
  onCustomizeTheme?: () => void;
  handleCanvasRatioChange: (format: "16:9" | "4:3" | "square") => void;
  onSelectMenuOpenChange: (open: boolean) => void;
  setDeckChromeToolbarOpen: Dispatch<SetStateAction<boolean>>;
  handleUpdateDeckChrome: Parameters<
    typeof DeckChromePanel
  >[0]["onUpdateChrome"];
  handleUpdateProps: Parameters<
    typeof DeckChromePanel
  >[0]["onUpdateSlideProps"];
  toggleSnapToGuides: () => void;
  togglePrecisionGrid: () => void;
  togglePrecisionRulers: () => void;
  toggleCustomGuidesVisible: () => void;
  addCustomGuide: (axis: StageGuideInput["axis"], position: string) => void;
  removeCustomGuide: (index: number) => void;
  handleSyncFromDocument: () => void;
  handleReviewSourceLinks: () => void;
  handleRegenerate: () => Promise<void>;
  setCompactToolbarMenuOpen: Dispatch<SetStateAction<boolean>>;
  handleCompactToolbarMenuKeyDown: (
    event: KeyboardEvent<HTMLDivElement>,
  ) => void;
  setCommandPaletteOpen: Dispatch<SetStateAction<boolean>>;
  closeCompactToolbarMenuAndRestoreFocus: () => void;
  onOpenShortcutHelp: () => void;
  setDeckDiagnosticsReviewOpen: Dispatch<SetStateAction<boolean>>;
  handleRoundtripAction: (
    action: () => Promise<ActionResult>,
    failureMessage: string,
  ) => Promise<void>;
  setExportMenuOpen: Dispatch<SetStateAction<boolean>>;
  handleExportRequest: (format: PresentationExportFormat) => void;
  handleExportMenuKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  handleCloseRequest: () => void;
}

export function SlideEditorTopToolbar({
  deck,
  activeSlide,
  themeCatalogEntries,
  activeThemePackage,
  themePickerTriggerRef,
  currentCanvasFormat,
  deckChromeToolbarOpen,
  deckChromeToolbarPanelRef,
  snapToGuides,
  precisionGuides,
  sourceReview,
  documentSourceIndex,
  onRegenerate,
  saveStatus,
  compactToolbarMenuOpen,
  compactToolbarMenuTriggerRef,
  compactToolbarMenuPanelRef,
  compactToolbarMenuId,
  onSave,
  saveStatusLabel,
  diagnosticsCount,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onPresent,
  onShare,
  onExportPptx,
  onExportPdf,
  onExportPng,
  exportMenuOpen,
  exportMenuId,
  exportMenuTriggerRef,
  exportMenuPanelRef,
  onClose,
  handleThemePackageChange,
  onCustomizeTheme,
  handleCanvasRatioChange,
  onSelectMenuOpenChange,
  setDeckChromeToolbarOpen,
  handleUpdateDeckChrome,
  handleUpdateProps,
  toggleSnapToGuides,
  togglePrecisionGrid,
  togglePrecisionRulers,
  toggleCustomGuidesVisible,
  addCustomGuide,
  removeCustomGuide,
  handleSyncFromDocument,
  handleReviewSourceLinks,
  handleRegenerate,
  setCompactToolbarMenuOpen,
  handleCompactToolbarMenuKeyDown,
  setCommandPaletteOpen,
  closeCompactToolbarMenuAndRestoreFocus,
  onOpenShortcutHelp,
  setDeckDiagnosticsReviewOpen,
  handleRoundtripAction,
  setExportMenuOpen,
  handleExportRequest,
  handleExportMenuKeyDown,
  handleCloseRequest,
}: SlideEditorTopToolbarProps) {
  const hasSourceIssues = sourceReview.length > 0;
  const canRefreshSourceLinks = Boolean(documentSourceIndex);
  const sourceActionLabel = hasSourceIssues
    ? "Review source links"
    : canRefreshSourceLinks
      ? "Refresh all source links"
      : "No live document source";
  const sourceActionDisabled = !hasSourceIssues && !canRefreshSourceLinks;

  function handleDocumentSourceAction() {
    if (hasSourceIssues) {
      handleReviewSourceLinks();
      return;
    }
    if (canRefreshSourceLinks) {
      handleSyncFromDocument();
    }
  }

  return (
    <DeckToolbar>
      <div aria-hidden="true" className="flex-1" />
      <DeckToolbarRow>
        <DeckToolbarGroup label="Deck setup">
          <ThemePreviewPicker
            aria-label="Deck theme"
            value={deck.theme}
            activeThemePackage={activeThemePackage}
            themes={themeCatalogEntries}
            onChange={handleThemePackageChange}
            onOpenChange={onSelectMenuOpenChange}
            onCustomize={onCustomizeTheme}
            triggerRef={themePickerTriggerRef}
          />
          <SelectMenu
            aria-label="Slide ratio"
            value={currentCanvasFormat}
            onChange={(value) =>
              handleCanvasRatioChange(value as "16:9" | "4:3" | "square")
            }
            onOpenChange={onSelectMenuOpenChange}
            options={CANVAS_RATIO_OPTIONS}
          />
          <Popover
            open={deckChromeToolbarOpen}
            onClose={() => setDeckChromeToolbarOpen(false)}
            aria-label="Slide master controls"
            portal
            className="max-h-[calc(100vh-6rem)] w-[22rem] overflow-y-auto p-0"
            trigger={
              <DeckToolbarIconButton
                label="Slide master"
                active={deckChromeToolbarOpen}
                hasPopup="dialog"
                expanded={deckChromeToolbarOpen}
                onClick={() => setDeckChromeToolbarOpen((open) => !open)}
              >
                <Box size={14} aria-hidden="true" />
              </DeckToolbarIconButton>
            }
          >
            <div
              ref={deckChromeToolbarPanelRef}
              data-deck-chrome-toolbar-panel="true"
            >
              <DeckChromePanel
                idPrefix="deck-chrome-toolbar"
                chrome={deck.chrome}
                slideProps={activeSlide?.props}
                onUpdateChrome={handleUpdateDeckChrome}
                onUpdateSlideProps={handleUpdateProps}
              />
            </div>
          </Popover>
          <DeckToolbarIconButton
            label="Toggle snap to guides"
            tooltip={
              snapToGuides ? "Snap to guides: on" : "Snap to guides: off"
            }
            active={snapToGuides}
            onClick={toggleSnapToGuides}
          >
            <Magnet size={14} aria-hidden="true" />
          </DeckToolbarIconButton>
          <PrecisionGuideToolbarControls
            preferences={precisionGuides}
            onToggleGrid={togglePrecisionGrid}
            onToggleRulers={togglePrecisionRulers}
            onToggleCustomGuides={toggleCustomGuidesVisible}
            onAddCustomGuide={addCustomGuide}
            onRemoveCustomGuide={removeCustomGuide}
          />
        </DeckToolbarGroup>

        <DeckToolbarDivider />

        <DeckToolbarGroup label="Document source">
          <DeckToolbarIconButton
            label={sourceActionLabel}
            tooltip={sourceActionLabel}
            disabled={sourceActionDisabled}
            onClick={handleDocumentSourceAction}
            className="relative"
          >
            <Link2 size={14} aria-hidden="true" />
            {hasSourceIssues ? (
              <span className="absolute -right-1 -top-1 rounded-full bg-ds-warning-surface px-1 text-[10px] font-bold text-ds-warning-text">
                {sourceReview.length}
              </span>
            ) : null}
          </DeckToolbarIconButton>
          {onRegenerate ? (
            <DeckToolbarIconButton
              label="Regenerate deck from document"
              tooltip="Regenerate deck from document"
              disabled={saveStatus === "saving"}
              onClick={() => void handleRegenerate()}
            >
              <RefreshCw size={14} aria-hidden="true" />
            </DeckToolbarIconButton>
          ) : null}
        </DeckToolbarGroup>
      </DeckToolbarRow>

      <div className="flex flex-1 justify-end">
        <DeckToolbarGroup label="Deck actions">
          <Popover
            open={compactToolbarMenuOpen}
            onClose={() => setCompactToolbarMenuOpen(false)}
            role="menu"
            aria-label="More deck commands"
            portal
            className="w-64 p-2"
            trigger={
              <button
                ref={compactToolbarMenuTriggerRef}
                type="button"
                aria-label="Open more deck commands"
                aria-haspopup="menu"
                aria-expanded={compactToolbarMenuOpen}
                aria-controls={
                  compactToolbarMenuOpen ? compactToolbarMenuId : undefined
                }
                onClick={() => setCompactToolbarMenuOpen((open) => !open)}
                className={cx(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-ds-md text-ds-text-muted transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary",
                  FOCUS_RING,
                )}
              >
                <MoreHorizontal size={15} aria-hidden="true" />
              </button>
            }
          >
            <div
              ref={compactToolbarMenuPanelRef}
              id={compactToolbarMenuId}
              className="space-y-1"
              onKeyDown={handleCompactToolbarMenuKeyDown}
            >
              <button
                type="button"
                role="menuitem"
                aria-label="Command palette"
                onClick={() => {
                  setCommandPaletteOpen(true);
                  closeCompactToolbarMenuAndRestoreFocus();
                }}
                className={cx(
                  "flex w-full items-center gap-2 rounded-ds-sm px-2 py-1.5 text-left text-xs text-ds-text-secondary transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary",
                  FOCUS_RING,
                )}
              >
                <CommandIcon size={14} aria-hidden="true" />
                Command palette
              </button>
              <button
                type="button"
                role="menuitem"
                aria-label="Keyboard shortcuts"
                onClick={() => {
                  onOpenShortcutHelp();
                  setCompactToolbarMenuOpen(false);
                }}
                className={cx(
                  "flex w-full items-center gap-2 rounded-ds-sm px-2 py-1.5 text-left text-xs text-ds-text-secondary transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary",
                  FOCUS_RING,
                )}
              >
                <Keyboard size={14} aria-hidden="true" />
                Keyboard shortcuts
              </button>
              {onSave ? (
                <button
                  type="button"
                  role="menuitem"
                  aria-label="Save now"
                  disabled={saveStatus === "saving"}
                  onClick={() => {
                    void onSave(deck);
                    closeCompactToolbarMenuAndRestoreFocus();
                  }}
                  className={cx(
                    "flex w-full items-center justify-between rounded-ds-sm px-2 py-1.5 text-left text-xs text-ds-text-secondary transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary disabled:opacity-40",
                    FOCUS_RING,
                  )}
                >
                  <span>Save now</span>
                  <span className="text-[10px] text-ds-text-muted">
                    {saveStatusLabel}
                  </span>
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setDeckDiagnosticsReviewOpen(true);
                  closeCompactToolbarMenuAndRestoreFocus();
                }}
                className={cx(
                  "flex w-full items-center justify-between rounded-ds-sm px-2 py-1.5 text-left text-xs text-ds-text-secondary transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary",
                  FOCUS_RING,
                )}
              >
                <span>Diagnostics</span>
                <span className="text-[10px] text-ds-text-muted">
                  {diagnosticsCount}
                </span>
              </button>
            </div>
          </Popover>

          <DeckToolbarDivider />

          <DeckToolbarGroup label="Undo and redo">
            <DeckToolbarIconButton
              label="Undo"
              disabled={!canUndo}
              onClick={onUndo}
            >
              <Undo2 size={14} aria-hidden="true" />
            </DeckToolbarIconButton>
            <DeckToolbarIconButton
              label="Redo"
              disabled={!canRedo}
              onClick={onRedo}
            >
              <Redo2 size={14} aria-hidden="true" />
            </DeckToolbarIconButton>
          </DeckToolbarGroup>

          {onPresent ? (
            <DeckToolbarIconButton
              label="Present slides"
              disabled={saveStatus === "saving"}
              onClick={() =>
                void handleRoundtripAction(
                  onPresent,
                  "Presentation route failed. Please try again.",
                )
              }
            >
              <MonitorPlay size={14} aria-hidden="true" />
            </DeckToolbarIconButton>
          ) : null}
          {onShare ? (
            <DeckToolbarIconButton
              label="Share slides"
              disabled={saveStatus === "saving"}
              onClick={() =>
                void handleRoundtripAction(
                  onShare,
                  "Share route failed. Please try again.",
                )
              }
            >
              <Share2 size={14} aria-hidden="true" />
            </DeckToolbarIconButton>
          ) : null}
          {onExportPptx || onExportPdf || onExportPng ? (
            <Popover
              open={exportMenuOpen}
              onClose={() => setExportMenuOpen(false)}
              role="menu"
              aria-label="Export slides"
              placement="bottom"
              align="end"
              portal
              className="w-44 p-1"
              trigger={
                <DeckToolbarButton
                  label="Export slides"
                  buttonRef={exportMenuTriggerRef}
                  hasPopup="menu"
                  expanded={exportMenuOpen}
                  controls={exportMenuOpen ? exportMenuId : undefined}
                  onClick={() => setExportMenuOpen((open) => !open)}
                  className="font-semibold"
                >
                  <FileDown size={14} aria-hidden="true" />
                  Export
                  <ChevronDown size={12} aria-hidden="true" />
                </DeckToolbarButton>
              }
            >
              <div
                ref={exportMenuPanelRef}
                id={exportMenuId}
                className="flex flex-col"
                onKeyDown={handleExportMenuKeyDown}
              >
                {onExportPptx ? (
                  <button
                    type="button"
                    role="menuitem"
                    aria-label="Export PPTX"
                    onClick={() => {
                      handleExportRequest("pptx");
                    }}
                    className={cx(
                      "rounded-ds-sm px-2 py-1.5 text-left text-xs font-medium text-ds-text-secondary transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary",
                      FOCUS_RING,
                    )}
                  >
                    Export PPTX
                  </button>
                ) : null}
                {onExportPdf ? (
                  <button
                    type="button"
                    role="menuitem"
                    aria-label="Export PDF"
                    onClick={() => {
                      handleExportRequest("pdf");
                    }}
                    className={cx(
                      "rounded-ds-sm px-2 py-1.5 text-left text-xs font-medium text-ds-text-secondary transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary",
                      FOCUS_RING,
                    )}
                  >
                    Export PDF
                  </button>
                ) : null}
                {onExportPng ? (
                  <button
                    type="button"
                    role="menuitem"
                    aria-label="Export PNGs"
                    onClick={() => {
                      handleExportRequest("png");
                    }}
                    className={cx(
                      "rounded-ds-sm px-2 py-1.5 text-left text-xs font-medium text-ds-text-secondary transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary",
                      FOCUS_RING,
                    )}
                  >
                    Export PNGs
                  </button>
                ) : null}
              </div>
            </Popover>
          ) : null}
          {onClose ? (
            <DeckToolbarIconButton
              label="Close slide editor"
              onClick={handleCloseRequest}
            >
              <X size={16} aria-hidden="true" />
            </DeckToolbarIconButton>
          ) : null}
        </DeckToolbarGroup>
      </div>
    </DeckToolbar>
  );
}
