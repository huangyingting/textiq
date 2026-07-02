"use client";

/**
 * vNext public present viewer — renders a `DeckV7` on the
 * `/present/[shareId]` route through `resolveDeckRenderTree` +
 * `SlideCanvasVNext` without any v6 materialisation.
 *
 * Features:
 * - Keyboard navigation (ArrowRight/Space/PageDown → next, ArrowLeft/PageUp → prev)
 * - Click/tap zones + swipe navigation
 * - URL hash deep-linking (`#3` → slide 3, 1-based)
 * - Progress indicator and bar
 * - Auto-hiding HUD
 * - `embed` mode suppresses the top HUD chrome
 */

import { useCallback, type JSX } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import type { PresentationDiagnostic } from "@/lib/presentation-vnext/diagnostics";
import type { DeckV7 } from "@/lib/presentation-vnext/schema";
import type { ThemePackageV1 } from "@/lib/presentation-vnext/theme-package-schema";
import { NEUTRAL_THEME_PACKAGE } from "@/lib/presentation-vnext/neutral-theme-package";
import { resolveDeckAssetSource } from "@/lib/presentation-vnext/deck-asset-source";
import { presentCanvasAspectRatio } from "@/lib/presentation-vnext/present-shell";
import type { Visual } from "@/lib/visual/schema";
import {
  PRESENTATION_NAVIGATION_SHORTCUT_IDS,
  initialPublicPresentHashSlideIndex,
  usePresentKeyboardNavigation,
  usePresentNavigationShellVNext,
  usePublicPresentSlideHash,
  type PresentShortcutAction,
} from "@/components/presentation-vnext/present-shell-vnext";
import { MadeWithBadge } from "@/components/made-with-badge";
import { useDeckV7RenderTree } from "./use-deck-v7-render-tree";
import { SlideCanvasVNext } from "./slide-canvas";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PublicPresentViewerVNextProps {
  deck: DeckV7;
  /** Theme package for rendering. Defaults to the neutral package. */
  themePackage?: ThemePackageV1 | null;
  /** Live document visual payloads keyed by visual id. */
  visuals?: Record<string, Visual>;
  /** Document title — used for accessibility labelling. */
  title: string;
  /** When true, suppresses the top-bar HUD for chrome-free iframe embedding. */
  embed?: boolean;
  /** When true, shows the "Made with TextIQ" attribution badge. */
  showAttribution?: boolean;
  /** Recovery details from the open boundary when public deck JSON is invalid. */
  recovery?: {
    error: string;
    validationErrors?: string[];
    diagnostics: PresentationDiagnostic[];
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PublicPresentViewerVNext({
  deck,
  themePackage,
  visuals,
  title,
  embed = false,
  showAttribution = false,
  recovery,
}: PublicPresentViewerVNextProps): JSX.Element {
  const pkg = themePackage ?? NEUTRAL_THEME_PACKAGE;
  const renderTree = useDeckV7RenderTree(deck, pkg);

  const total = renderTree?.slides.length ?? 0;
  const canvas = renderTree?.canvas;

  const {
    currentIndex,
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
  } = usePresentNavigationShellVNext<HTMLDivElement>({
    total,
    initialIndex: initialPublicPresentHashSlideIndex(total),
    aspectRatio: presentCanvasAspectRatio(canvas),
    autoHideHud: !embed,
  });

  usePublicPresentSlideHash(currentIndex);

  const handleShortcut = useCallback(
    (action: PresentShortcutAction) => {
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
      }
    },
    [goFirst, goLast, goNext, goPrev],
  );

  usePresentKeyboardNavigation({
    shortcuts: PRESENTATION_NAVIGATION_SHORTCUT_IDS,
    onShortcut: handleShortcut,
  });

  function resolveDeckAsset(assetId: string): string | undefined {
    return resolveDeckAssetSource(deck, assetId);
  }

  const resolveVisual = useCallback(
    (visualId: string): Visual | undefined => visuals?.[visualId],
    [visuals],
  );

  if (recovery) {
    const details = [
      ...recovery.diagnostics.map((diagnostic) => diagnostic.message),
      ...(recovery.validationErrors ?? []),
    ];
    return (
      <div className="flex h-screen items-center justify-center bg-ds-inverse-surface p-6 text-ds-inverse-text">
        <section
          role="alert"
          aria-labelledby="presentation-recovery-title"
          className="max-w-xl rounded-ds-lg border border-ds-inverse-border-subtle bg-ds-inverse-surface-muted p-5 shadow-ds-overlay"
        >
          <h1
            id="presentation-recovery-title"
            className="text-lg font-semibold"
          >
            Presentation deck could not be opened
          </h1>
          <p className="mt-2 text-sm opacity-80">{recovery.error}</p>
          {details.length > 0 ? (
            <ul className="mt-4 list-disc space-y-1 pl-5 text-sm opacity-80">
              {details.slice(0, 6).map((detail, index) => (
                <li key={`${detail}-${index}`}>{detail}</li>
              ))}
            </ul>
          ) : null}
        </section>
        <MadeWithBadge show={showAttribution} />
      </div>
    );
  }

  if (!renderTree || total === 0) {
    return (
      <div className="flex h-screen items-center justify-center bg-ds-inverse-surface text-ds-inverse-text">
        <p className="text-sm opacity-60">No slides to display.</p>
      </div>
    );
  }

  const currentSlideTree = renderTree.slides[currentIndex];

  if (!currentSlideTree) {
    return (
      <div className="flex h-screen items-center justify-center bg-ds-inverse-surface text-ds-inverse-text">
        <p className="text-sm opacity-60">No slides to display.</p>
      </div>
    );
  }

  return (
    <div
      role="region"
      aria-label={`Presentation: ${title}`}
      aria-live="polite"
      aria-atomic="true"
      className="relative flex h-screen w-full select-none flex-col overflow-hidden bg-ds-inverse-surface"
      onTouchStart={swipeHandlers.onTouchStart}
      onTouchEnd={swipeHandlers.onTouchEnd}
    >
      {/* Top HUD (suppressed in embed mode) */}
      {!embed && (
        <div
          aria-label="Presentation controls"
          className={`tiq-safe-present-top pointer-events-none absolute inset-x-0 top-0 z-raised flex items-center justify-between gap-4 pb-3 transition-opacity duration-300 motion-reduce:transition-none ${hudVisible ? "opacity-100" : "opacity-0"}`}
        >
          <div className="pointer-events-auto flex items-center gap-3">
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
                className="h-full rounded-full bg-white/60 transition-all duration-300 motion-reduce:transition-none"
                style={{ width: `${progress.percentage}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Slide canvas */}
      <div
        ref={slideAreaRef}
        className="relative min-h-0 flex-1 overflow-hidden"
      >
        <div className="flex h-full w-full items-center justify-center">
          <div
            className="overflow-hidden"
            style={{
              width: fittedSlideSize.width,
              height: fittedSlideSize.height,
            }}
          >
            <SlideCanvasVNext
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
          className="group absolute bottom-0 left-0 top-0 w-1/2 cursor-pointer bg-transparent focus-visible:outline-none disabled:cursor-default"
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
          className="group absolute bottom-0 right-0 top-0 w-1/2 cursor-pointer bg-transparent focus-visible:outline-none disabled:cursor-default"
        >
          <span
            className={`absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-ds-inverse-control p-1.5 text-ds-inverse-muted opacity-0 transition-opacity motion-reduce:transition-none group-hover:opacity-100 group-focus-visible:opacity-100 ${currentIndex === total - 1 ? "hidden" : ""}`}
            aria-hidden="true"
          >
            <ChevronRight size={20} />
          </span>
        </button>
      </div>

      {/* Bottom nav bar */}
      <div
        className={`tiq-safe-present-bottom pointer-events-none absolute left-1/2 z-raised flex -translate-x-1/2 items-center gap-3 transition-opacity duration-300 motion-reduce:transition-none ${!embed && !hudVisible ? "opacity-0" : "opacity-100"}`}
      >
        <div className="pointer-events-auto flex items-center gap-2 rounded-xl bg-ds-inverse-surface-muted px-3 py-2 backdrop-blur-sm">
          <button
            type="button"
            {...clickZones.previousZone}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-ds-inverse-muted transition-colors hover:bg-ds-inverse-state-hover hover:text-ds-inverse-text disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-inverse-focus"
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <span className="text-xs font-medium tabular-nums text-ds-inverse-subtle">
            {progress.label}
          </span>
          <button
            type="button"
            {...clickZones.nextZone}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-ds-inverse-muted transition-colors hover:bg-ds-inverse-state-hover hover:text-ds-inverse-text disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-inverse-focus"
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <MadeWithBadge show={showAttribution} />
    </div>
  );
}
