"use client";

/**
 * In-app Present mode — fullscreen slide navigation with presenter tools.
 *
 * Renders a {@link Deck} (from {@link buildDeckFromBlocks}) one slide at a
 * time in a fullscreen overlay. Features:
 *
 * - Keyboard + click navigation: ArrowRight/Down/Space/PageDown → next;
 *   ArrowLeft/Up/PageUp → prev; Home → first; End → last; Esc → close / exit.
 * - Presenter tools: keyboard help (`?`), speaker notes (`N`), slide overview
 *   (`O`), timer (`T`), laser pointer (`L`), and fullscreen (`F`).
 * - Progress indicator ("3 / 12") and a progress bar.
 * - Presenter panel: current-slide speaker notes with next-slide preview.
 * - Visual slides rendered via {@link VisualRenderer}.
 * - Fullscreen API with vendor-prefixed fallbacks and a visible F11 hint.
 */

import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { FOCUS_RING } from "@/components/ui/tokens";
import { SlideCanvas } from "@/components/presentation/slide-canvas";
import type { Deck } from "@/lib/presentation/deck";
import { resolveSlideThemeColors } from "@/lib/presentation/style-cascade";
import { PRESENT_MODE_SHORTCUT_IDS } from "@/components/presentation/present-mode/presenter-shortcuts";
import {
  exitBrowserFullscreen,
  getFullscreenElement,
  requestBrowserFullscreen,
  usePresenterFullscreen,
} from "@/components/presentation/present-mode/presenter-fullscreen";
import {
  HudButton,
  KeyboardHelpOverlay,
  PresenterPanel,
  PresenterTimer,
  PresenterToolIcon,
  SlideOverviewPanel,
} from "@/components/presentation/present-mode/presenter-tools";
import { useLaserPointer } from "@/components/presentation/present-mode/use-laser-pointer";
import { usePresenterTimer } from "@/components/presentation/present-mode/use-presenter-timer";
import {
  usePresentationClickZones,
  usePresentationKeyboardNavigation,
  useSlideBounds,
  useSlideNavigation,
  useSwipeNavigation,
  type PresentationShortcutAction,
} from "@/components/presentation/runtime/navigation";
import { slideAspectRatio } from "@/lib/presentation-shared/slide-format";
import { loadSlideFonts } from "@/lib/presentation-shared/slide-font-loading";
import { fitAspectRatio } from "@/lib/presentation/stage-fit";
import type { Visual } from "@/lib/visual/schema";
import { deckCanvasFormat } from "@/components/presentation/v6-deck-ui";

export interface PresentModeProps {
  deck: Deck;
  /** Mapping of visualId → Visual for rendering visual slide content. */
  visuals: ReadonlyMap<string, Visual>;
  /** Called when the user exits presentation mode. */
  onClose: () => void;
}

/**
 * Full-screen presentation surface that renders {@link Deck} slides one at a
 * time. Mounts into a React portal over the entire viewport.
 *
 * Navigation:
 * - **Next**: ArrowRight, ArrowDown, Space, PageDown, or click the right half
 * - **Prev**: ArrowLeft, ArrowUp, PageUp, or click the left half
 * - **First / Last**: Home / End
 * - **Exit**: Esc (also exits fullscreen)
 * - **Fullscreen**: F key or toolbar button
 * - **Speaker notes**: N key or toolbar button
 * - **Slide overview**: O key or toolbar button
 * - **Timer**: T key or toolbar button
 * - **Laser pointer**: L key or toolbar button
 * - **Keyboard help**: ? key or toolbar button
 */
export function PresentMode({
  deck,
  visuals,
  onClose,
}: PresentModeProps): JSX.Element {
  const slides = deck.slides;
  const total = slides.length;

  const { currentIndex, goToSlide, goNext, goPrev, goFirst, goLast, progress } =
    useSlideNavigation(total);
  const [notesVisible, setNotesVisible] = useState(false);
  const [keyboardHelpOpen, setKeyboardHelpOpen] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [showTimer, setShowTimer] = useState(false);
  const [hudVisible, setHudVisible] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const hudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { slideAreaRef, slideAreaBounds } = useSlideBounds<HTMLDivElement>();
  const {
    isFullscreen,
    fullscreenHintVisible,
    setFullscreenHintVisible,
    toggleFullscreen,
  } = usePresenterFullscreen();
  const { elapsedSeconds, startedAtRef } = usePresenterTimer();

  const currentSlide = slides[currentIndex];
  const nextSlide =
    currentIndex + 1 < total ? slides[currentIndex + 1] : undefined;
  const slideFormat = deckCanvasFormat(deck);
  const activeSlideAspectRatio = slideAspectRatio(slideFormat);
  const fittedSlideSize = fitAspectRatio(
    slideAreaBounds,
    activeSlideAspectRatio,
  );
  const topHudVisible =
    hudVisible ||
    keyboardHelpOpen ||
    overviewOpen ||
    showTimer ||
    fullscreenHintVisible;
  const bottomHudVisible = hudVisible || keyboardHelpOpen || overviewOpen;

  const swipeHandlers = useSwipeNavigation({
    onNext: goNext,
    onPrevious: goPrev,
  });
  const clickZones = usePresentationClickZones({
    currentIndex,
    total,
    onNext: goNext,
    onPrevious: goPrev,
  });

  const handleClose = useCallback(async () => {
    if (getFullscreenElement(document)) {
      await exitBrowserFullscreen();
    }
    onClose();
  }, [onClose]);

  // Preload the self-hosted slide fonts on entry so present-mode text renders
  // with the real fonts from the first paint rather than a fallback.
  useEffect(() => {
    void loadSlideFonts();
  }, []);

  useEffect(() => {
    startedAtRef.current = Date.now();
    containerRef.current?.focus();

    let cancelled = false;
    const autoEnterFullscreen = async () => {
      const succeeded = await requestBrowserFullscreen();
      if (!cancelled) {
        setFullscreenHintVisible(!succeeded);
      }
    };

    void autoEnterFullscreen();
    return () => {
      cancelled = true;
    };
  }, [setFullscreenHintVisible, startedAtRef]);

  useEffect(() => {
    const root = document.documentElement;
    const previousRootOverflow = root.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    root.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      root.style.overflow = previousRootOverflow;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, []);

  const scheduleHudHide = useCallback(() => {
    if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
    hudTimerRef.current = setTimeout(() => setHudVisible(false), 3000);
  }, []);

  const resetHudTimer = useCallback(() => {
    setHudVisible(true);
    scheduleHudHide();
  }, [scheduleHudHide]);

  useEffect(() => {
    scheduleHudHide();
    window.addEventListener("mousemove", resetHudTimer);
    window.addEventListener("keydown", resetHudTimer);
    return () => {
      window.removeEventListener("mousemove", resetHudTimer);
      window.removeEventListener("keydown", resetHudTimer);
      if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
    };
  }, [resetHudTimer, scheduleHudHide]);

  const closeKeyboardHelp = useCallback(() => {
    setKeyboardHelpOpen(false);
    resetHudTimer();
  }, [resetHudTimer]);

  const closeOverview = useCallback(() => {
    setOverviewOpen(false);
    resetHudTimer();
  }, [resetHudTimer]);

  const toggleKeyboardHelp = useCallback(() => {
    setOverviewOpen(false);
    setKeyboardHelpOpen((open) => !open);
    resetHudTimer();
  }, [resetHudTimer]);

  const toggleNotes = useCallback(() => {
    setNotesVisible((visible) => !visible);
    resetHudTimer();
  }, [resetHudTimer]);

  const toggleOverview = useCallback(() => {
    setKeyboardHelpOpen(false);
    setOverviewOpen((open) => !open);
    resetHudTimer();
  }, [resetHudTimer]);

  const toggleTimer = useCallback(() => {
    setShowTimer((visible) => !visible);
    resetHudTimer();
  }, [resetHudTimer]);

  const { laserActive, laserPosition, toggleLaser } = useLaserPointer({
    resetHudTimer,
  });

  const handleJumpToSlide = useCallback(
    (index: number) => {
      goToSlide(index);
      closeOverview();
    },
    [closeOverview, goToSlide],
  );

  const handleShortcut = useCallback(
    (action: PresentationShortcutAction) => {
      if (action === "exit") {
        if (keyboardHelpOpen) {
          closeKeyboardHelp();
          return true;
        }
        if (overviewOpen) {
          closeOverview();
          return true;
        }
        void handleClose();
        return true;
      }

      if (action === "help") {
        toggleKeyboardHelp();
        return true;
      }

      if (keyboardHelpOpen) {
        return false;
      }

      if (overviewOpen) {
        if (action === "overview") {
          closeOverview();
          return true;
        }
        return false;
      }

      switch (action) {
        case "next":
          goNext();
          return true;
        case "previous":
          goPrev();
          return true;
        case "first":
          goFirst();
          return true;
        case "last":
          goLast();
          return true;
        case "fullscreen":
          void toggleFullscreen();
          return true;
        case "notes":
          toggleNotes();
          return true;
        case "overview":
          toggleOverview();
          return true;
        case "timer":
          toggleTimer();
          return true;
        case "laser":
          toggleLaser();
          return true;
      }
    },
    [
      closeKeyboardHelp,
      closeOverview,
      goFirst,
      goLast,
      goNext,
      goPrev,
      handleClose,
      keyboardHelpOpen,
      overviewOpen,
      toggleFullscreen,
      toggleKeyboardHelp,
      toggleLaser,
      toggleNotes,
      toggleOverview,
      toggleTimer,
    ],
  );

  usePresentationKeyboardNavigation({
    shortcuts: PRESENT_MODE_SHORTCUT_IDS,
    onShortcut: handleShortcut,
  });

  if (!currentSlide) {
    return (
      <div className="fixed inset-0 z-modal flex items-center justify-center bg-ds-inverse-surface text-ds-inverse-text">
        <p>No slides to present.</p>
        <button
          type="button"
          onClick={() => void handleClose()}
          className="ml-4 underline"
        >
          Close
        </button>
      </div>
    );
  }

  const tc = resolveSlideThemeColors(deck, currentSlide);

  const overlay = (
    <div
      ref={containerRef}
      role="region"
      aria-label="Presentation"
      aria-live="polite"
      aria-atomic="true"
      className="fixed inset-0 z-modal flex flex-col select-none outline-none"
      style={{ backgroundColor: tc.bgColor }}
      tabIndex={-1}
      onTouchStart={swipeHandlers.onTouchStart}
      onTouchEnd={swipeHandlers.onTouchEnd}
    >
      <div
        aria-label="Presentation controls"
        className={`pointer-events-none absolute inset-x-0 top-0 z-raised flex items-start justify-between gap-4 px-4 py-3 transition-opacity duration-300 ${topHudVisible ? "opacity-100" : "opacity-0"}`}
      >
        <div className="pointer-events-auto flex flex-wrap items-center gap-3">
          <span
            aria-label={`Slide ${progress.label}`}
            className="rounded-md bg-ds-inverse-surface-muted px-2 py-1 text-xs font-medium tabular-nums text-ds-inverse-muted backdrop-blur-sm"
          >
            {progress.label}
          </span>
          <div
            role="progressbar"
            aria-valuenow={currentIndex + 1}
            aria-valuemin={1}
            aria-valuemax={total}
            aria-label="Presentation progress"
            className="h-1 w-28 overflow-hidden rounded-full bg-ds-inverse-border-subtle"
          >
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${progress.percentage}%`,
                backgroundColor: tc.accentColor,
              }}
            />
          </div>
          {showTimer ? (
            <PresenterTimer elapsedSeconds={elapsedSeconds} />
          ) : null}
          {fullscreenHintVisible ? (
            <span className="rounded-md border border-amber-400/40 bg-ds-inverse-surface-muted px-2 py-1 text-xs font-medium text-ds-inverse-text backdrop-blur-sm">
              Fullscreen unavailable — press F11
            </span>
          ) : null}
        </div>

        <div className="pointer-events-auto flex flex-wrap items-center gap-2">
          <HudButton
            label={
              keyboardHelpOpen
                ? "Hide keyboard shortcuts"
                : "Show keyboard shortcuts"
            }
            active={keyboardHelpOpen}
            onClick={toggleKeyboardHelp}
          >
            <span className="text-sm font-semibold leading-none">?</span>
          </HudButton>
          <HudButton
            label={notesVisible ? "Hide speaker notes" : "Show speaker notes"}
            active={notesVisible}
            onClick={toggleNotes}
          >
            <PresenterToolIcon kind="notes" />
          </HudButton>
          <HudButton
            label={overviewOpen ? "Hide slide overview" : "Show slide overview"}
            active={overviewOpen}
            onClick={toggleOverview}
          >
            <PresenterToolIcon kind="overview" />
          </HudButton>
          <HudButton
            label={showTimer ? "Hide presenter timer" : "Show presenter timer"}
            active={showTimer}
            onClick={toggleTimer}
          >
            <PresenterToolIcon kind="timer" />
          </HudButton>
          <HudButton
            label={
              laserActive ? "Disable laser pointer" : "Enable laser pointer"
            }
            active={laserActive}
            onClick={toggleLaser}
          >
            <PresenterToolIcon kind="laser" laserActive={laserActive} />
          </HudButton>
          <HudButton
            label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            active={isFullscreen}
            onClick={() => {
              resetHudTimer();
              void toggleFullscreen();
            }}
          >
            <PresenterToolIcon kind="fullscreen" isFullscreen={isFullscreen} />
          </HudButton>
          <HudButton
            label="Exit presentation"
            onClick={() => {
              resetHudTimer();
              void handleClose();
            }}
          >
            <PresenterToolIcon kind="exit" />
          </HudButton>
        </div>
      </div>

      <div
        ref={slideAreaRef}
        className={`relative min-h-0 flex-1 overflow-hidden ${notesVisible ? "basis-[65%]" : ""}`}
      >
        <div className="flex h-full w-full items-center justify-center">
          <div
            className="overflow-hidden"
            style={{
              width: fittedSlideSize.width,
              height: fittedSlideSize.height,
            }}
          >
            <SlideCanvas slide={currentSlide} deck={deck} visuals={visuals} />
          </div>
        </div>

        <button
          type="button"
          {...clickZones.previousZone}
          className={`group absolute bottom-0 left-0 top-0 w-1/2 cursor-pointer bg-transparent ${FOCUS_RING} disabled:cursor-default`}
        >
          <span
            className={`absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-ds-inverse-control p-1.5 text-ds-inverse-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 ${currentIndex === 0 ? "hidden" : ""}`}
            aria-hidden="true"
          >
            <ChevronLeft size={20} />
          </span>
        </button>

        <button
          type="button"
          {...clickZones.nextZone}
          className={`group absolute bottom-0 right-0 top-0 w-1/2 cursor-pointer bg-transparent ${FOCUS_RING} disabled:cursor-default`}
        >
          <span
            className={`absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-ds-inverse-control p-1.5 text-ds-inverse-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 ${currentIndex === total - 1 ? "hidden" : ""}`}
            aria-hidden="true"
          >
            <ChevronRight size={20} />
          </span>
        </button>
      </div>

      {notesVisible && (
        <div
          className="flex-shrink-0 border-t border-ds-inverse-border-subtle"
          style={{ height: "35%" }}
        >
          <PresenterPanel
            currentSlide={currentSlide}
            currentIndex={currentIndex}
            total={total}
            nextSlide={nextSlide}
            deck={deck}
            visuals={visuals}
            slideFormat={slideFormat}
          />
        </div>
      )}

      <div
        className={`pointer-events-none absolute bottom-4 left-1/2 z-raised flex -translate-x-1/2 items-center gap-3 transition-opacity duration-300 ${bottomHudVisible ? "opacity-100" : "opacity-0"}`}
      >
        <div className="pointer-events-auto flex items-center gap-2 rounded-xl bg-ds-inverse-surface-muted px-3 py-2 backdrop-blur-sm">
          <button
            type="button"
            {...clickZones.previousZone}
            className={`flex h-7 w-7 items-center justify-center rounded-lg text-ds-inverse-muted transition-colors hover:bg-ds-inverse-state-hover hover:text-ds-inverse-text disabled:opacity-30 ${FOCUS_RING}`}
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <span className="text-xs font-medium tabular-nums text-ds-inverse-subtle">
            {progress.label}
          </span>
          <button
            type="button"
            {...clickZones.nextZone}
            className={`flex h-7 w-7 items-center justify-center rounded-lg text-ds-inverse-muted transition-colors hover:bg-ds-inverse-state-hover hover:text-ds-inverse-text disabled:opacity-30 ${FOCUS_RING}`}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      {laserActive && laserPosition ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-sticky h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500 shadow-[var(--ds-shadow-laser-cursor)]"
          style={{ left: laserPosition.x, top: laserPosition.y }}
        />
      ) : null}

      {overviewOpen ? (
        <SlideOverviewPanel
          slides={slides}
          deck={deck}
          visuals={visuals}
          slideFormat={slideFormat}
          currentIndex={currentIndex}
          onJump={handleJumpToSlide}
          onClose={closeOverview}
        />
      ) : null}

      {keyboardHelpOpen ? (
        <KeyboardHelpOverlay onClose={closeKeyboardHelp} />
      ) : null}

      <div className="sr-only" aria-live="assertive" aria-atomic="true">
        {currentSlide.title
          ? `Slide ${currentIndex + 1} of ${total}: ${currentSlide.title}`
          : `Slide ${currentIndex + 1} of ${total}`}
      </div>
    </div>
  );

  return typeof document !== "undefined"
    ? createPortal(overlay, document.body)
    : overlay;
}
