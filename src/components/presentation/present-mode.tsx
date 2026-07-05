"use client";

/**
 * presentation present mode — renders a `Deck` through the `resolveDeckRenderTree`
 * pipeline and `SlideCanvas` without any v6 materialisation.
 *
 * Navigation, fit, keyboard shortcuts, HUD hiding, fullscreen, timer, and laser
 * pointer come from the shared presentation present shell. Route-specific chrome and
 * private presenter affordances stay in this component.
 *
 * Theme decorations are rendered behind user nodes and are excluded from
 * presenter interactions (they are aria-hidden inside `SlideCanvas`).
 */

import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { FOCUS_RING } from "@/components/ui/tokens";
import type { Deck } from "@/lib/presentation/schema";
import type { ThemePackageV1 } from "@/lib/presentation/theme-package-schema";
import { NEUTRAL_THEME_PACKAGE } from "@/lib/presentation/neutral-theme-package";
import type { Visual } from "@/lib/visual/schema";
import {
  exitBrowserFullscreen,
  getFullscreenElement,
  PRESENT_MODE_SHORTCUT_IDS,
  requestBrowserFullscreen,
  useLaserPointer,
  usePresentKeyboardNavigation,
  usePresentNavigationShellPresentation,
  usePresenterFullscreen,
  usePresenterTimer,
  type PresentShortcutAction,
} from "@/components/presentation/present-shell";
import {
  HudButton,
  KeyboardHelpOverlay,
  PresenterPanelPresentation,
  PresenterTimer,
  PresenterToolIcon,
  SlideOverviewPanelPresentation,
} from "@/components/presentation/present-mode/presenter-tools";
import { resolveDeckAssetSource } from "@/lib/presentation/deck-asset-source";
import { presentCanvasAspectRatio } from "@/lib/presentation/present-shell";
import { useDeckRenderTree } from "./use-deck-render-tree";
import { SlideCanvas } from "./slide-canvas";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PresentModeProps {
  deck: Deck;
  /** Theme package to use for rendering. Defaults to the neutral package. */
  themePackage?: ThemePackageV1 | null;
  /** Live document visual payloads keyed by visual id. */
  visuals?: Record<string, Visual>;
  /** Called when the user exits presentation mode. */
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Full-screen presentation surface rendering `Deck` slides through the presentation
 * resolved render tree.
 *
 * Mounts into a React portal over the entire viewport.
 */
export function PresentMode({
  deck,
  themePackage,
  visuals,
  onClose,
}: PresentModeProps): JSX.Element {
  const pkg = themePackage ?? NEUTRAL_THEME_PACKAGE;
  const renderTree = useDeckRenderTree(deck, pkg);

  const total = renderTree?.slides.length ?? 0;
  const canvas = renderTree?.canvas;

  const {
    currentIndex,
    goToSlide,
    goNext,
    goPrev,
    goFirst,
    goLast,
    progress,
    slideAreaRef,
    fittedSlideSize,
    swipeHandlers,
    clickZones,
    hudVisible,
    resetHudTimer,
  } = usePresentNavigationShellPresentation<HTMLDivElement>({
    total,
    aspectRatio: presentCanvasAspectRatio(canvas),
  });
  const [notesVisible, setNotesVisible] = useState(false);
  const [keyboardHelpOpen, setKeyboardHelpOpen] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [showTimer, setShowTimer] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const {
    isFullscreen,
    fullscreenHintVisible,
    setFullscreenHintVisible,
    toggleFullscreen,
  } = usePresenterFullscreen();
  const { elapsedSeconds, startedAtRef } = usePresenterTimer();

  const currentSlideTree = renderTree?.slides[currentIndex];
  const nextSlide =
    currentIndex + 1 < total ? deck.slides[currentIndex + 1] : undefined;
  const nextSlideTree =
    currentIndex + 1 < total ? renderTree?.slides[currentIndex + 1] : undefined;
  function resolveDeckAsset(assetId: string): string | undefined {
    return resolveDeckAssetSource(deck, assetId);
  }
  const resolveVisual = useCallback(
    (visualId: string): Visual | undefined => visuals?.[visualId],
    [visuals],
  );

  const topHudVisible =
    hudVisible ||
    keyboardHelpOpen ||
    overviewOpen ||
    showTimer ||
    fullscreenHintVisible;
  const bottomHudVisible = hudVisible || keyboardHelpOpen || overviewOpen;

  const handleClose = useCallback(async () => {
    if (getFullscreenElement(document)) {
      await exitBrowserFullscreen();
    }
    onClose();
  }, [onClose]);

  useEffect(() => {
    void (async () => {
      startedAtRef.current = Date.now();
      containerRef.current?.focus();
      const succeeded = await requestBrowserFullscreen();
      setFullscreenHintVisible(!succeeded);
    })();
  }, [setFullscreenHintVisible, startedAtRef]);

  useEffect(() => {
    const root = document.documentElement;
    const prevRoot = root.style.overflow;
    const prevBody = document.body.style.overflow;
    root.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      root.style.overflow = prevRoot;
      document.body.style.overflow = prevBody;
    };
  }, []);

  const closeKeyboardHelp = useCallback(() => {
    setKeyboardHelpOpen(false);
    resetHudTimer();
  }, [resetHudTimer]);

  const closeOverview = useCallback(() => {
    setOverviewOpen(false);
    resetHudTimer();
  }, [resetHudTimer]);

  const handleJumpToSlide = useCallback(
    (index: number) => {
      goToSlide(index);
      closeOverview();
    },
    [closeOverview, goToSlide],
  );

  const { laserActive, laserPosition, toggleLaser } = useLaserPointer({
    resetHudTimer,
  });

  const handleShortcut = useCallback(
    (action: PresentShortcutAction) => {
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
        setKeyboardHelpOpen((o) => !o);
        resetHudTimer();
        return true;
      }
      if (keyboardHelpOpen) return false;
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
          setNotesVisible((v) => !v);
          resetHudTimer();
          return true;
        case "overview":
          setOverviewOpen((o) => !o);
          resetHudTimer();
          return true;
        case "timer":
          setShowTimer((v) => !v);
          resetHudTimer();
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
      resetHudTimer,
      toggleFullscreen,
      toggleLaser,
    ],
  );

  usePresentKeyboardNavigation({
    shortcuts: PRESENT_MODE_SHORTCUT_IDS,
    onShortcut: handleShortcut,
  });

  if (!currentSlideTree || !renderTree) {
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

  const overlay = (
    <div
      ref={containerRef}
      role="region"
      aria-label="Presentation"
      aria-live="polite"
      aria-atomic="true"
      className="fixed inset-0 z-modal flex flex-col select-none bg-ds-inverse-surface outline-none"
      tabIndex={-1}
      onTouchStart={swipeHandlers.onTouchStart}
      onTouchEnd={swipeHandlers.onTouchEnd}
    >
      {/* Top HUD */}
      <div
        aria-label="Presentation controls"
        className={`tiq-safe-present-top pointer-events-none absolute inset-x-0 top-0 z-raised flex items-start justify-between gap-4 pb-3 transition-opacity duration-300 motion-reduce:transition-none ${topHudVisible ? "opacity-100" : "opacity-0"}`}
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
              className="h-full rounded-full bg-ds-inverse-subtle transition-all duration-300 motion-reduce:transition-none"
              style={{ width: `${progress.percentage}%` }}
            />
          </div>
          {showTimer ? (
            <PresenterTimer elapsedSeconds={elapsedSeconds} />
          ) : null}
          {fullscreenHintVisible ? (
            <span className="rounded-md border border-ds-warning-border bg-ds-inverse-surface-muted px-2 py-1 text-xs font-medium text-ds-inverse-text backdrop-blur-sm">
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
            onClick={() => {
              setKeyboardHelpOpen((o) => !o);
              resetHudTimer();
            }}
          >
            <span className="text-sm font-semibold leading-none">?</span>
          </HudButton>
          <HudButton
            label={notesVisible ? "Hide speaker notes" : "Show speaker notes"}
            active={notesVisible}
            onClick={() => {
              setNotesVisible((v) => !v);
              resetHudTimer();
            }}
          >
            <PresenterToolIcon kind="notes" />
          </HudButton>
          <HudButton
            label={overviewOpen ? "Hide slide overview" : "Show slide overview"}
            active={overviewOpen}
            onClick={() => {
              setOverviewOpen((o) => !o);
              resetHudTimer();
            }}
          >
            <PresenterToolIcon kind="overview" />
          </HudButton>
          <HudButton
            label={showTimer ? "Hide timer" : "Show timer"}
            active={showTimer}
            onClick={() => {
              setShowTimer((v) => !v);
              resetHudTimer();
            }}
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

      {/* Slide area */}
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
            <SlideCanvas
              slide={currentSlideTree}
              canvas={canvas}
              assetResolver={resolveDeckAsset}
              visualResolver={resolveVisual}
            />
          </div>
        </div>

        <button
          type="button"
          {...clickZones.previousZone}
          className={`group absolute bottom-0 left-0 top-0 w-1/2 cursor-pointer bg-transparent ${FOCUS_RING} disabled:cursor-default`}
        >
          <span
            className={`absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-ds-inverse-control p-1.5 text-ds-inverse-muted opacity-0 transition-opacity motion-reduce:transition-none group-hover:opacity-100 group-focus-visible:opacity-100 ${currentIndex === 0 ? "hidden" : ""}`}
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
            className={`absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-ds-inverse-control p-1.5 text-ds-inverse-muted opacity-0 transition-opacity motion-reduce:transition-none group-hover:opacity-100 group-focus-visible:opacity-100 ${currentIndex === total - 1 ? "hidden" : ""}`}
            aria-hidden="true"
          >
            <ChevronRight size={20} />
          </span>
        </button>
      </div>

      {/* Speaker notes */}
      {notesVisible && (
        <div
          className="flex-shrink-0 border-t border-ds-inverse-border-subtle p-4"
          style={{ height: "35%" }}
        >
          <PresenterPanelPresentation
            currentSlide={deck.slides[currentIndex]}
            currentIndex={currentIndex}
            total={total}
            nextSlide={nextSlide}
            nextSlideTree={nextSlideTree}
            canvas={canvas ?? deck.canvas}
            assetResolver={resolveDeckAsset}
            visualResolver={resolveVisual}
          />
        </div>
      )}

      {/* Bottom nav bar */}
      <div
        className={`tiq-safe-present-bottom pointer-events-none absolute left-1/2 z-raised flex -translate-x-1/2 items-center gap-3 transition-opacity duration-300 motion-reduce:transition-none ${bottomHudVisible ? "opacity-100" : "opacity-0"}`}
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

      {/* Laser pointer */}
      {laserActive && laserPosition ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-sticky h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ds-danger shadow-[var(--ds-shadow-laser-cursor)]"
          style={{ left: laserPosition.x, top: laserPosition.y }}
        />
      ) : null}

      {/* Slide overview */}
      {overviewOpen && renderTree ? (
        <SlideOverviewPanelPresentation
          slides={deck.slides}
          renderTree={renderTree}
          currentIndex={currentIndex}
          assetResolver={resolveDeckAsset}
          visualResolver={resolveVisual}
          onJump={handleJumpToSlide}
          onClose={closeOverview}
        />
      ) : null}

      {keyboardHelpOpen ? (
        <KeyboardHelpOverlay onClose={closeKeyboardHelp} />
      ) : null}

      <div className="sr-only" aria-live="assertive" aria-atomic="true">
        {`Slide ${currentIndex + 1} of ${total}`}
      </div>
    </div>
  );

  return typeof document !== "undefined"
    ? createPortal(overlay, document.body)
    : overlay;
}
