"use client";

import {
  Box,
  ChevronDown,
  Command as CommandIcon,
  FileDown,
  Keyboard,
  Magnet,
  MoreHorizontal,
  MonitorPlay,
  Palette,
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
import { sourceBlockKindLabel } from "@/lib/presentation/document-source-commands";
import type { DocumentSourceInsertBlock } from "@/lib/presentation/document-source-commands";
import type { PresentationExportFormat } from "@/lib/presentation/export-preflight";
import type { SaveStatus } from "@/lib/presentation/save-status";
import type {
  Deck,
  SlideChildNode,
  SlideNode,
} from "@/lib/presentation/schema";
import type { SourceReviewItem } from "@/lib/presentation/source-links";
import type { ThemePackageV1 } from "@/lib/presentation/theme-package-schema";
import { Popover } from "@/components/ui/popover";
import { cx, FOCUS_RING } from "@/components/ui/tokens";

import { DeckChromePanel } from "./inspector";
import type { PrecisionGuidePreferences } from "./precision-guides-storage";
import { PrecisionGuideToolbarControls } from "./precision-guides-controls";
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
  themePackages: readonly ThemePackageV1[];
  currentCanvasFormat: "16:9" | "4:3" | "square";
  brandKitAuthoringOpen: boolean;
  deckChromeToolbarOpen: boolean;
  deckChromeToolbarPanelRef: RefObject<HTMLDivElement | null>;
  snapToGuides: boolean;
  precisionGuides: PrecisionGuidePreferences;
  sourceMenuOpen: boolean;
  sourceMenuTriggerRef: RefObject<HTMLButtonElement | null>;
  sourceMenuPanelRef: RefObject<HTMLDivElement | null>;
  sourceMenuId: string;
  sourceStatusLabel: string;
  sourceReview: readonly SourceReviewItem[];
  documentSourceIndex: unknown;
  selectedSource: SlideChildNode["source"] | undefined;
  selectedNode: SlideChildNode | undefined;
  documentInsertBlocks: readonly DocumentSourceInsertBlock[];
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
  onClose: (() => void) | undefined;
  handleThemePackageChange: (packageId: string) => void;
  handleCanvasRatioChange: (format: "16:9" | "4:3" | "square") => void;
  handleOpenBrandKitAuthoring: () => void;
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
  addCustomGuide: Parameters<
    typeof PrecisionGuideToolbarControls
  >[0]["onAddGuide"];
  removeCustomGuide: Parameters<
    typeof PrecisionGuideToolbarControls
  >[0]["onRemoveGuide"];
  setSourceMenuOpen: Dispatch<SetStateAction<boolean>>;
  handleSourceMenuKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  handleSyncFromDocument: () => void;
  handleReviewSourceLinks: () => void;
  handleRefreshSelectedSource: () => Promise<void>;
  closeSourceMenuAndRestoreFocus: () => void;
  handleUnlinkSourceAt: (slideId: string, nodeId: string) => void;
  handleInsertDocumentSourceBlock: (block: DocumentSourceInsertBlock) => void;
  handleRegenerate: () => Promise<void>;
  setCompactToolbarMenuOpen: Dispatch<SetStateAction<boolean>>;
  handleCompactToolbarMenuKeyDown: (
    event: KeyboardEvent<HTMLDivElement>,
  ) => void;
  setCommandPaletteOpen: Dispatch<SetStateAction<boolean>>;
  closeCompactToolbarMenuAndRestoreFocus: () => void;
  setShortcutHelpOpen: Dispatch<SetStateAction<boolean>>;
  setDeckDiagnosticsReviewOpen: Dispatch<SetStateAction<boolean>>;
  handleRoundtripAction: (
    action: () => Promise<ActionResult>,
    failureMessage: string,
  ) => Promise<void>;
  setExportMenuOpen: Dispatch<SetStateAction<boolean>>;
  handleExportRequest: (format: PresentationExportFormat) => void;
  handleCloseRequest: () => void;
}

export function SlideEditorTopToolbar({
  deck,
  activeSlide,
  themePackages,
  currentCanvasFormat,
  brandKitAuthoringOpen,
  deckChromeToolbarOpen,
  deckChromeToolbarPanelRef,
  snapToGuides,
  precisionGuides,
  sourceMenuOpen,
  sourceMenuTriggerRef,
  sourceMenuPanelRef,
  sourceMenuId,
  sourceStatusLabel,
  sourceReview,
  documentSourceIndex,
  selectedSource,
  selectedNode,
  documentInsertBlocks,
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
  onClose,
  handleThemePackageChange,
  handleCanvasRatioChange,
  handleOpenBrandKitAuthoring,
  setDeckChromeToolbarOpen,
  handleUpdateDeckChrome,
  handleUpdateProps,
  toggleSnapToGuides,
  togglePrecisionGrid,
  togglePrecisionRulers,
  toggleCustomGuidesVisible,
  addCustomGuide,
  removeCustomGuide,
  setSourceMenuOpen,
  handleSourceMenuKeyDown,
  handleSyncFromDocument,
  handleReviewSourceLinks,
  handleRefreshSelectedSource,
  closeSourceMenuAndRestoreFocus,
  handleUnlinkSourceAt,
  handleInsertDocumentSourceBlock,
  handleRegenerate,
  setCompactToolbarMenuOpen,
  handleCompactToolbarMenuKeyDown,
  setCommandPaletteOpen,
  closeCompactToolbarMenuAndRestoreFocus,
  setShortcutHelpOpen,
  setDeckDiagnosticsReviewOpen,
  handleRoundtripAction,
  setExportMenuOpen,
  handleExportRequest,
  handleCloseRequest,
}: SlideEditorTopToolbarProps) {
  return (
    <DeckToolbar>
      <DeckToolbarRow>
        <DeckToolbarGroup label="Deck setup">
          <select
            aria-label="Deck theme"
            value={deck.theme.packageId}
            onChange={(event) =>
              handleThemePackageChange(event.currentTarget.value)
            }
            className={cx(
              "h-[26px] max-w-36 shrink-0 rounded-ds-sm border-0 bg-transparent px-1.5 text-[11px] font-medium text-ds-text-secondary hover:bg-ds-state-hover",
              FOCUS_RING,
            )}
          >
            {themePackages.map((themePackageOption) => (
              <option key={themePackageOption.id} value={themePackageOption.id}>
                {themePackageOption.name}
              </option>
            ))}
          </select>
          <DeckToolbarIconButton
            label="Author brand kit"
            hasPopup="dialog"
            expanded={brandKitAuthoringOpen}
            active={brandKitAuthoringOpen}
            onClick={handleOpenBrandKitAuthoring}
          >
            <Palette size={14} aria-hidden="true" />
          </DeckToolbarIconButton>
          <select
            aria-label="Slide ratio"
            value={currentCanvasFormat}
            onChange={(event) =>
              handleCanvasRatioChange(
                event.currentTarget.value as "16:9" | "4:3" | "square",
              )
            }
            className={cx(
              "h-[26px] shrink-0 rounded-ds-sm border-0 bg-transparent px-1.5 text-[11px] font-medium text-ds-text-secondary hover:bg-ds-state-hover",
              FOCUS_RING,
            )}
          >
            <option value="16:9">16:9</option>
            <option value="4:3">4:3</option>
            <option value="square">1:1</option>
          </select>
          <Popover
            open={deckChromeToolbarOpen}
            onClose={() => setDeckChromeToolbarOpen(false)}
            aria-label="Deck chrome controls"
            portal
            className="max-h-[calc(100vh-6rem)] w-[22rem] overflow-y-auto p-0"
            trigger={
              <DeckToolbarIconButton
                label="Deck chrome"
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
            onToggleGuides={toggleCustomGuidesVisible}
            onAddGuide={addCustomGuide}
            onRemoveGuide={removeCustomGuide}
          />
        </DeckToolbarGroup>

        <DeckToolbarDivider />

        <DeckToolbarGroup label="Document source">
          <Popover
            open={sourceMenuOpen}
            onClose={() => setSourceMenuOpen(false)}
            role="menu"
            aria-label="Document source commands"
            portal
            className="w-72 p-2"
            trigger={
              <button
                ref={sourceMenuTriggerRef}
                type="button"
                aria-label="Document source"
                aria-haspopup="menu"
                aria-expanded={sourceMenuOpen}
                aria-controls={sourceMenuOpen ? sourceMenuId : undefined}
                onClick={() => setSourceMenuOpen((open) => !open)}
                className={cx(
                  "relative flex h-[26px] items-center gap-1 rounded-ds-sm bg-transparent px-1.5 text-[11px] font-medium text-ds-text-secondary transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary",
                  FOCUS_RING,
                )}
              >
                Source
                <ChevronDown size={12} aria-hidden="true" />
                {sourceReview.length > 0 ? (
                  <span className="absolute -right-1 -top-1 rounded-full bg-ds-warning-surface px-1 text-[10px] font-bold text-ds-warning-text">
                    {sourceReview.length}
                  </span>
                ) : null}
              </button>
            }
          >
            <div
              ref={sourceMenuPanelRef}
              id={sourceMenuId}
              className="space-y-1"
              onKeyDown={handleSourceMenuKeyDown}
            >
              <div className="rounded-ds-sm border border-ds-border-subtle bg-ds-surface px-2 py-1.5 text-xs text-ds-text-secondary">
                {sourceStatusLabel}
              </div>
              {documentSourceIndex ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleSyncFromDocument}
                  className={cx(
                    "flex w-full items-center rounded-ds-sm px-2 py-1.5 text-left text-xs text-ds-text-secondary transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary",
                    FOCUS_RING,
                  )}
                >
                  Refresh all source links
                </button>
              ) : null}
              {sourceReview.length > 0 ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleReviewSourceLinks}
                  className={cx(
                    "flex w-full items-center rounded-ds-sm px-2 py-1.5 text-left text-xs text-ds-text-secondary transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary",
                    FOCUS_RING,
                  )}
                >
                  Review source links
                </button>
              ) : null}
              {selectedSource && selectedNode && activeSlide ? (
                <>
                  <div className="my-1 border-t border-ds-border-subtle" />
                  <p className="px-2 text-[10px] font-semibold uppercase tracking-wide text-ds-text-muted">
                    Selected source
                  </p>
                  <p className="truncate px-2 py-1 text-[11px] text-ds-text-secondary">
                    {(selectedSource.blockKind ?? "source").toString()} ·{" "}
                    {selectedSource.blockId ?? "linked"}
                  </p>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      void handleRefreshSelectedSource();
                      closeSourceMenuAndRestoreFocus();
                    }}
                    className={cx(
                      "flex w-full items-center rounded-ds-sm px-2 py-1.5 text-left text-xs text-ds-text-secondary transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary",
                      FOCUS_RING,
                    )}
                  >
                    Refresh selected source
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      handleUnlinkSourceAt(activeSlide.id, selectedNode.id);
                      closeSourceMenuAndRestoreFocus();
                    }}
                    className={cx(
                      "flex w-full items-center rounded-ds-sm px-2 py-1.5 text-left text-xs text-ds-text-secondary transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary",
                      FOCUS_RING,
                    )}
                  >
                    Mark selected as unlinked
                  </button>
                </>
              ) : null}
              {documentInsertBlocks.length > 0 ? (
                <>
                  <div className="my-1 border-t border-ds-border-subtle" />
                  <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-ds-text-muted">
                    From document
                  </p>
                  {documentInsertBlocks.map((block) => (
                    <button
                      key={`${block.kind}:${block.id}`}
                      type="button"
                      role="menuitem"
                      onClick={() => handleInsertDocumentSourceBlock(block)}
                      className={cx(
                        "flex w-full min-w-0 flex-col items-start rounded-ds-sm px-2 py-1.5 text-left text-xs text-ds-text-secondary transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary",
                        FOCUS_RING,
                      )}
                    >
                      <span className="w-full truncate font-medium text-ds-text-primary">
                        {block.displayLabel}
                      </span>
                      <span className="w-full truncate text-[10px] text-ds-text-muted">
                        {sourceBlockKindLabel(block.kind)} · {block.id}
                      </span>
                    </button>
                  ))}
                </>
              ) : null}
            </div>
          </Popover>
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

      <DeckToolbarGroup label="Deck actions" className="justify-end">
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
                "flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-ds-sm bg-transparent text-ds-text-muted transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary",
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
                setShortcutHelpOpen(true);
                closeCompactToolbarMenuAndRestoreFocus();
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
            className="w-44 p-1"
            trigger={
              <DeckToolbarButton
                label="Export slides"
                onClick={() => setExportMenuOpen((open) => !open)}
                className="font-semibold"
              >
                <FileDown size={14} aria-hidden="true" />
                Export
                <ChevronDown size={12} aria-hidden="true" />
              </DeckToolbarButton>
            }
          >
            <div id={exportMenuId} className="flex flex-col">
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
    </DeckToolbar>
  );
}
