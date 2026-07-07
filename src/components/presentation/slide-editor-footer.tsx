import type { KeyboardEvent, RefObject } from "react";
import {
  ChevronDown,
  ChevronUp,
  LayoutPanelLeft,
  StickyNote,
} from "lucide-react";

import type { SaveStatus } from "@/lib/presentation/save-status";
import {
  presencePeerLabel,
  type SlidePresencePeer,
} from "@/lib/presentation/use-slide-presence";
import type { Deck, SlideNode } from "@/lib/presentation/schema";
import { Popover } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { cx, FOCUS_RING } from "@/components/ui/tokens";

export const ZOOM_PERCENT_PRESETS = [200, 150, 125, 100, 75, 50, 25] as const;

function slideDisplayName(slide: SlideNode | undefined, index: number): string {
  return slide?.name ?? `Slide ${index + 1}`;
}

export function selectedSummary(count: number): string {
  if (count === 0) return "No selection";
  if (count === 1) return "1 node selected";
  return `${count} nodes selected`;
}

export function diagnosticsSummary(count: number): string {
  if (count === 0) return "No diagnostics";
  if (count === 1) return "1 diagnostic";
  return `${count} diagnostics`;
}

type SaveFocalVariant = "saved" | "progress" | "unsaved" | "error";

/**
 * Maps a {@link SaveStatus} to the accent-save-state focal chip variant: the
 * footer's save status is the visual focal point, shifting color to reflect the
 * document's persistence state.
 */
export function saveFocalVariant(status: SaveStatus): SaveFocalVariant {
  switch (status) {
    case "saved":
      return "saved";
    case "saving":
    case "retrying":
    case "queued":
      return "progress";
    case "pending":
    case "offline":
      return "unsaved";
    case "conflict":
    case "error":
      return "error";
  }
}

const SAVE_FOCAL_CHIP_BASE =
  "inline-flex items-center gap-1.5 rounded-ds-md border px-2 py-0.5 text-[11px] font-semibold";

const SAVE_FOCAL_CHIP: Record<SaveFocalVariant, string> = {
  saved: "border-ds-accent-border bg-ds-accent-surface text-ds-accent-text",
  progress:
    "border-ds-border-subtle bg-ds-surface-sunken text-ds-text-secondary",
  unsaved:
    "border-ds-warning-border bg-ds-warning-surface text-ds-warning-text",
  error: "border-ds-danger-border bg-ds-danger-surface text-ds-danger-text",
};

const SAVE_FOCAL_DOT: Record<SaveFocalVariant, string> = {
  saved: "bg-ds-accent",
  progress: "bg-ds-text-muted motion-safe:animate-pulse",
  unsaved: "bg-ds-warning",
  error: "bg-ds-danger",
};

export function presencePeerSummary(
  peer: SlidePresencePeer,
  deck: Deck,
  activeSlideId: string | undefined,
): string {
  const label = presencePeerLabel(peer);
  if (!peer.selectedSlideId) return `${label}: in deck`;
  if (peer.selectedSlideId === activeSlideId) {
    if (peer.selectedNodeIds.length === 1) return `${label}: selecting 1 node`;
    if (peer.selectedNodeIds.length > 1) {
      return `${label}: selecting ${peer.selectedNodeIds.length} nodes`;
    }
    return `${label}: viewing this slide`;
  }
  const slideIndex = deck.slides.findIndex(
    (slide) => slide.id === peer.selectedSlideId,
  );
  return slideIndex >= 0
    ? `${label}: on ${slideDisplayName(deck.slides[slideIndex], slideIndex)}`
    : `${label}: in deck`;
}

interface SlideEditorFooterProps {
  deck: Deck;
  activeSlide: SlideNode | undefined;
  activeSlideIndex: number;
  filmstripCollapsed: boolean;
  inspectorPanel: string | undefined;
  stageZoomPercent: number;
  zoomMenuOpen: boolean;
  zoomMenuId: string;
  zoomMenuTriggerRef: RefObject<HTMLButtonElement | null>;
  zoomMenuPanelRef: RefObject<HTMLDivElement | null>;
  footerStatusMenuOpen: boolean;
  footerStatusMenuId: string;
  footerStatusMenuTriggerRef: RefObject<HTMLButtonElement | null>;
  footerStatusMenuPanelRef: RefObject<HTMLDivElement | null>;
  hasUnsavedWork: boolean;
  saveStatus: SaveStatus;
  saveStatusLabel: string;
  saveErrorMessage: string | null | undefined;
  sourceReviewCount: number;
  sourceStatusLabel: string;
  diagnosticsCount: number;
  activeGroupId: string | null;
  tableEditingNodeId: string | null;
  selectionMode: "normal" | "layers";
  selectedCount: number;
  remotePresencePeers: readonly SlidePresencePeer[];
  onSave?: (deck: Deck) => unknown;
  onToggleFilmstripCollapsed: () => void;
  onNotesClick: () => void;
  onSetStageZoomPercent: (percent: number) => void;
  onSetFooterZoom: (percent: number) => void;
  onSetZoomMenuOpen: (open: boolean | ((open: boolean) => boolean)) => void;
  onSetFooterStatusMenuOpen: (
    open: boolean | ((open: boolean) => boolean),
  ) => void;
  onCloseZoomMenuAndRestoreFocus: () => void;
  onCloseFooterStatusMenuAndRestoreFocus: () => void;
  onZoomMenuKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onFooterStatusMenuKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onReviewSourceLinks: () => void;
  onOpenDiagnosticsReview: () => void;
}

export function SlideEditorFooter({
  deck,
  activeSlide,
  activeSlideIndex,
  filmstripCollapsed,
  inspectorPanel,
  stageZoomPercent,
  zoomMenuOpen,
  zoomMenuId,
  zoomMenuTriggerRef,
  zoomMenuPanelRef,
  footerStatusMenuOpen,
  footerStatusMenuId,
  footerStatusMenuTriggerRef,
  footerStatusMenuPanelRef,
  hasUnsavedWork,
  saveStatus,
  saveStatusLabel,
  saveErrorMessage,
  sourceReviewCount,
  sourceStatusLabel,
  diagnosticsCount,
  activeGroupId,
  tableEditingNodeId,
  selectionMode,
  selectedCount,
  remotePresencePeers,
  onSave,
  onToggleFilmstripCollapsed,
  onNotesClick,
  onSetStageZoomPercent,
  onSetFooterZoom,
  onSetZoomMenuOpen,
  onSetFooterStatusMenuOpen,
  onCloseZoomMenuAndRestoreFocus,
  onCloseFooterStatusMenuAndRestoreFocus,
  onZoomMenuKeyDown,
  onFooterStatusMenuKeyDown,
  onReviewSourceLinks,
  onOpenDiagnosticsReview,
}: SlideEditorFooterProps) {
  const activeSlideName = slideDisplayName(activeSlide, activeSlideIndex);
  const selectedNodeSummary = selectedSummary(selectedCount);
  const diagnosticSummary = diagnosticsSummary(diagnosticsCount);
  const hasCustomDeckTitle = Boolean(
    deck.title && deck.title.trim() && deck.title.trim() !== "Slides",
  );
  const shouldShowSourceStatus = sourceReviewCount > 0;
  const shouldShowSaveStatus = saveStatus !== "saved" || hasUnsavedWork;
  const shouldShowDiagnosticsStatus = diagnosticsCount > 0;
  const shouldShowPresenceStatus = remotePresencePeers.length > 0;
  const shouldShowSelectionStatus = selectedCount > 0;
  const saveErrorAnnouncement =
    saveStatus === "error"
      ? saveErrorMessage
        ? `${saveStatusLabel}. ${saveErrorMessage}`
        : saveStatusLabel
      : null;
  const selectionModeLabel =
    selectionMode === "layers" ? "Layers mode" : "Normal mode";

  return (
    <footer
      data-slide-bottom-dock="true"
      className="tiq-safe-bottom-dock grid min-h-9 shrink-0 grid-cols-1 items-center gap-2 bg-transparent px-3 py-1 text-[11px] text-ds-text-muted sm:h-9 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-3 sm:py-0"
    >
      <div className="hidden min-w-0 items-center gap-2 sm:flex">
        {hasCustomDeckTitle ? (
          <span className="truncate font-medium text-ds-text-secondary">
            {deck.title}
          </span>
        ) : null}
        {hasCustomDeckTitle && shouldShowSourceStatus ? (
          <span aria-hidden="true" className="text-ds-border-strong">
            ·
          </span>
        ) : null}
        {shouldShowSourceStatus ? (
          <button
            type="button"
            onClick={onReviewSourceLinks}
            className={cx(
              "truncate rounded-ds-sm px-1.5 py-1 text-ds-warning-text transition-colors hover:bg-ds-warning-surface",
              FOCUS_RING,
            )}
          >
            {sourceReviewCount} source{" "}
            {sourceReviewCount === 1 ? "issue" : "issues"}
          </button>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-start gap-1.5 sm:flex-nowrap sm:justify-center">
        <Tooltip
          label={
            filmstripCollapsed
              ? "Show slide thumbnails"
              : "Hide slide thumbnails"
          }
          side="top"
        >
          <button
            type="button"
            aria-label={
              filmstripCollapsed
                ? "Show slide thumbnails"
                : "Hide slide thumbnails"
            }
            aria-pressed={!filmstripCollapsed}
            onClick={onToggleFilmstripCollapsed}
            className={cx(
              "flex h-7 items-center gap-1 rounded-ds-md px-1.5 text-[11px] font-semibold transition-colors sm:px-2",
              !filmstripCollapsed
                ? "bg-ds-accent-surface text-ds-accent-text"
                : "text-ds-text-secondary hover:bg-ds-state-hover hover:text-ds-text-primary",
              FOCUS_RING,
            )}
          >
            <LayoutPanelLeft size={13} aria-hidden />
            Slides
            {filmstripCollapsed ? (
              <ChevronUp size={11} aria-hidden />
            ) : (
              <ChevronDown size={11} aria-hidden />
            )}
          </button>
        </Tooltip>
        <button
          type="button"
          aria-pressed={inspectorPanel === "notes"}
          onClick={onNotesClick}
          className={cx(
            "flex h-7 items-center gap-1 rounded-ds-md px-1.5 text-[11px] font-semibold transition-colors sm:px-2",
            inspectorPanel === "notes"
              ? "bg-ds-accent-surface text-ds-accent-text"
              : "text-ds-text-secondary hover:bg-ds-state-hover hover:text-ds-text-primary",
            FOCUS_RING,
          )}
        >
          <StickyNote size={13} aria-hidden />
          Notes
        </button>
        <span className="hidden truncate font-medium text-ds-text-muted sm:inline">
          Slide {Math.min(activeSlideIndex + 1, deck.slides.length)} of{" "}
          {deck.slides.length}
        </span>
        <div
          className="mx-1 hidden h-5 w-px bg-ds-border-subtle sm:block"
          aria-hidden="true"
        />
        <input
          type="range"
          min={25}
          max={200}
          step={5}
          value={stageZoomPercent}
          onChange={(event) =>
            onSetStageZoomPercent(Number(event.currentTarget.value))
          }
          aria-label="Slide zoom"
          className="hidden w-24 accent-ds-accent sm:block sm:w-28 lg:w-32"
        />
        <Popover
          open={zoomMenuOpen}
          onClose={() => onSetZoomMenuOpen(false)}
          role="menu"
          aria-label="Zoom presets"
          placement="top"
          className="w-20 p-1"
          trigger={
            <button
              ref={zoomMenuTriggerRef}
              type="button"
              aria-haspopup="menu"
              aria-expanded={zoomMenuOpen}
              aria-controls={zoomMenuOpen ? zoomMenuId : undefined}
              aria-label={`Set slide zoom (${stageZoomPercent}%)`}
              onClick={() => onSetZoomMenuOpen((open) => !open)}
              className={cx(
                "h-7 min-w-12 rounded-ds-md px-1.5 text-[11px] font-semibold tabular-nums text-ds-text-secondary transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary sm:min-w-14 sm:px-2",
                FOCUS_RING,
              )}
            >
              {stageZoomPercent}%
            </button>
          }
        >
          <div
            ref={zoomMenuPanelRef}
            id={zoomMenuId}
            className="flex flex-col"
            onKeyDown={onZoomMenuKeyDown}
          >
            {ZOOM_PERCENT_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                role="menuitemradio"
                aria-checked={preset === stageZoomPercent}
                onClick={() => {
                  onSetFooterZoom(preset);
                  onCloseZoomMenuAndRestoreFocus();
                }}
                className={cx(
                  "rounded-ds-sm px-2 py-1.5 text-left text-xs font-medium transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary",
                  preset === stageZoomPercent
                    ? "bg-ds-state-hover text-ds-text-primary"
                    : "text-ds-text-secondary",
                  FOCUS_RING,
                )}
              >
                {preset}%
              </button>
            ))}
            <div className="my-1 border-t border-ds-border-subtle" />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onSetFooterZoom(100);
                onCloseZoomMenuAndRestoreFocus();
              }}
              className={cx(
                "rounded-ds-sm px-2 py-1.5 text-left text-xs font-medium text-ds-text-secondary transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary",
                FOCUS_RING,
              )}
            >
              Fit
            </button>
          </div>
        </Popover>
        <Popover
          open={footerStatusMenuOpen}
          onClose={() => onSetFooterStatusMenuOpen(false)}
          role="menu"
          aria-label="Footer status"
          placement="top"
          align="end"
          className="w-56 p-2.5 sm:hidden"
          trigger={
            <button
              ref={footerStatusMenuTriggerRef}
              type="button"
              aria-haspopup="menu"
              aria-expanded={footerStatusMenuOpen}
              aria-controls={
                footerStatusMenuOpen ? footerStatusMenuId : undefined
              }
              aria-label={`Footer status: ${saveStatusLabel}. ${diagnosticSummary}.`}
              onClick={() => onSetFooterStatusMenuOpen((open) => !open)}
              className={cx(
                "h-7 rounded-ds-md px-2 text-[11px] font-semibold text-ds-text-secondary transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary sm:hidden",
                FOCUS_RING,
              )}
            >
              Status
            </button>
          }
        >
          <div
            ref={footerStatusMenuPanelRef}
            id={footerStatusMenuId}
            className="space-y-2 text-xs"
            onKeyDown={onFooterStatusMenuKeyDown}
          >
            <p className="truncate font-medium text-ds-text-primary">
              {deck.title ?? "Slides"}
            </p>
            <p>
              {activeSlideName} (
              {Math.min(activeSlideIndex + 1, deck.slides.length)}/
              {deck.slides.length})
            </p>
            {hasCustomDeckTitle ? <p>{deck.title}</p> : null}
            {shouldShowSourceStatus ? <p>{sourceStatusLabel}</p> : null}
            {saveStatus === "error" && onSave ? (
              <button
                type="button"
                role="menuitem"
                aria-label={saveStatusLabel}
                onClick={() => {
                  void onSave(deck);
                  onCloseFooterStatusMenuAndRestoreFocus();
                }}
                className="text-ds-danger-text underline-offset-2 hover:underline"
              >
                {saveStatusLabel}
              </button>
            ) : shouldShowSaveStatus ? (
              <p>{saveStatusLabel}</p>
            ) : null}
            {saveStatus === "error" && saveErrorMessage ? (
              <p className="max-w-[200px] text-ds-danger-text">
                {saveErrorMessage}
              </p>
            ) : null}
            {shouldShowDiagnosticsStatus ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onOpenDiagnosticsReview();
                  onCloseFooterStatusMenuAndRestoreFocus();
                }}
                aria-label={`Open deck diagnostics review (${diagnosticSummary})`}
                className={cx(
                  "rounded-ds-sm px-1.5 py-1 text-left font-medium text-ds-text-secondary transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary",
                  FOCUS_RING,
                )}
              >
                {diagnosticSummary}
              </button>
            ) : null}
            {activeGroupId ? <p>Group edit</p> : null}
            {tableEditingNodeId ? <p>Table edit</p> : null}
            {selectionMode !== "normal" ? <p>{selectionModeLabel}</p> : null}
            {shouldShowSelectionStatus ? <p>{selectedNodeSummary}</p> : null}
            {shouldShowPresenceStatus ? (
              <p>
                {remotePresencePeers
                  .map((peer) =>
                    presencePeerSummary(peer, deck, activeSlide?.id),
                  )
                  .join(" · ")}
              </p>
            ) : null}
          </div>
        </Popover>
      </div>
      {saveErrorAnnouncement ? (
        <span role="alert" className="sr-only">
          {saveErrorAnnouncement}
        </span>
      ) : null}
      <div className="hidden min-w-0 shrink-0 items-center justify-end gap-3 sm:flex">
        {saveStatus === "error" && onSave ? (
          <button
            type="button"
            onClick={() => void onSave(deck)}
            aria-label={saveStatusLabel}
            className={cx(
              SAVE_FOCAL_CHIP_BASE,
              SAVE_FOCAL_CHIP.error,
              "transition hover:opacity-90",
              FOCUS_RING,
            )}
          >
            <span
              aria-hidden="true"
              className={cx("h-1.5 w-1.5 rounded-full", SAVE_FOCAL_DOT.error)}
            />
            {saveStatusLabel}
          </button>
        ) : shouldShowSaveStatus ? (
          <span
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className={cx(
              SAVE_FOCAL_CHIP_BASE,
              SAVE_FOCAL_CHIP[saveFocalVariant(saveStatus)],
            )}
          >
            <span
              aria-hidden="true"
              className={cx(
                "h-1.5 w-1.5 rounded-full",
                SAVE_FOCAL_DOT[saveFocalVariant(saveStatus)],
              )}
            />
            {saveStatusLabel}
          </span>
        ) : null}
        {saveStatus === "error" && saveErrorMessage ? (
          <span
            role="status"
            aria-live="assertive"
            aria-atomic="true"
            className="max-w-[260px] truncate text-ds-danger-text"
          >
            {saveErrorMessage}
          </span>
        ) : null}
        {shouldShowPresenceStatus ? (
          <span
            aria-label={`Slide collaborators: ${remotePresencePeers
              .map((peer) => presencePeerSummary(peer, deck, activeSlide?.id))
              .join("; ")}`}
          >
            {remotePresencePeers.length} present
          </span>
        ) : null}
        {shouldShowDiagnosticsStatus ? (
          <button
            type="button"
            onClick={onOpenDiagnosticsReview}
            aria-label={`Open deck diagnostics review (${diagnosticSummary})`}
            className={cx(
              "rounded-ds-sm px-1.5 py-1 text-ds-text-secondary transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary",
              FOCUS_RING,
            )}
          >
            {diagnosticSummary}
          </button>
        ) : null}
        {activeGroupId ? <span>Group edit</span> : null}
        {tableEditingNodeId ? <span>Table edit</span> : null}
        {selectionMode !== "normal" ? <span>{selectionModeLabel}</span> : null}
        {shouldShowSelectionStatus ? (
          <span className="truncate">{selectedNodeSummary}</span>
        ) : null}
      </div>
    </footer>
  );
}
