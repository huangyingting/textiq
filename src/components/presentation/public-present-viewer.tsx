"use client";

/**
 * presentation public present viewer — renders a `Deck` on the
 * `/present/[shareId]` route through `resolveDeckRenderTree` +
 * `SlideCanvas` without any v6 materialisation.
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

import type { PresentationDiagnostic } from "@/lib/presentation/diagnostics";
import type { Deck } from "@/lib/presentation/schema";
import type { ThemePackageV1 } from "@/lib/presentation/theme-package-schema";
import { NEUTRAL_THEME_PACKAGE } from "@/lib/presentation/neutral-theme-package";
import { resolveDeckAssetSource } from "@/lib/presentation/deck-asset-source";
import { buildThemePackageFontFaceCss } from "@/lib/presentation/theme-package-fonts";
import { presentCanvasAspectRatio } from "@/lib/presentation/present-shell";
import type { Visual } from "@/lib/visual/schema";
import {
  PRESENTATION_NAVIGATION_SHORTCUT_IDS,
  usePresentKeyboardNavigation,
  usePresentNavigationShellPresentation,
  usePublicPresentSlideHash,
  type PresentShortcutAction,
} from "@/components/presentation/present-shell";
import { MadeWithBadge } from "@/components/made-with-badge";
import { useDeckRenderTree } from "./use-deck-render-tree";
import { SlideCanvas } from "./slide-canvas";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

const PUBLIC_PRESENT_NAVIGATION_SCRIPT = `(() => {
  const script = document.currentScript;
  const root = script?.closest("[data-public-present-viewer]");
  if (!root || root.__textiqPresentEnhanced) return;
  root.__textiqPresentEnhanced = true;

  const total = Math.max(
    0,
    Number(root.getAttribute("data-present-total")) ||
      root.querySelectorAll("[data-present-slide]").length,
  );
  const clamp = (index) =>
    total <= 0 ? 0 : Math.min(Math.max(Math.floor(index), 0), total - 1);
  const indexFromHash = () => {
    const parsed = Number.parseInt(window.location.hash.replace(/^#/, ""), 10);
    return Number.isFinite(parsed) && parsed > 0 ? clamp(parsed - 1) : 0;
  };
  const currentIndex = () =>
    clamp(Number(root.getAttribute("data-present-current") || "1") - 1);
  const isEditableTarget = (target) => {
    const element = target instanceof HTMLElement ? target : null;
    if (!element) return false;
    const tag = element.tagName;
    return (
      element.isContentEditable ||
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT"
    );
  };
  const setSlide = (index, writeHash) => {
    const next = clamp(index);
    root.setAttribute("data-present-current", String(next + 1));
    root.querySelectorAll("[data-present-slide]").forEach((slide) => {
      const active = Number(slide.getAttribute("data-present-slide")) === next + 1;
      slide.hidden = !active;
      slide.setAttribute("aria-hidden", active ? "false" : "true");
    });
    root.querySelectorAll("[data-present-label]").forEach((label) => {
      label.textContent = String(next + 1) + " / " + String(total);
    });
    root.querySelectorAll("[data-present-progress]").forEach((progress) => {
      progress.setAttribute("aria-valuenow", String(next + 1));
    });
    const percentage = total > 1 ? (next / (total - 1)) * 100 : 100;
    root.querySelectorAll("[data-present-progress-fill]").forEach((fill) => {
      fill.style.width = String(percentage) + "%";
    });
    root.querySelectorAll('[data-present-nav="previous"]').forEach((button) => {
      button.disabled = next === 0;
    });
    root.querySelectorAll('[data-present-nav="next"]').forEach((button) => {
      button.disabled = next === total - 1;
    });
    if (writeHash) {
      const hash = "#" + String(next + 1);
      if (window.location.hash !== hash) {
        window.history.replaceState(null, "", hash);
      }
    }
  };

  root.addEventListener("click", (event) => {
    const trigger = event.target?.closest?.("[data-present-nav]");
    if (!trigger || !root.contains(trigger) || trigger.disabled) return;
    event.preventDefault();
    const direction = trigger.getAttribute("data-present-nav");
    setSlide(currentIndex() + (direction === "next" ? 1 : -1), true);
  });
  window.addEventListener("hashchange", () => setSlide(indexFromHash(), false));
  window.addEventListener("keydown", (event) => {
    if (isEditableTarget(event.target)) return;
    if (["ArrowRight", "PageDown", " "].includes(event.key)) {
      event.preventDefault();
      setSlide(currentIndex() + 1, true);
    } else if (["ArrowLeft", "PageUp"].includes(event.key)) {
      event.preventDefault();
      setSlide(currentIndex() - 1, true);
    } else if (event.key === "Home") {
      event.preventDefault();
      setSlide(0, true);
    } else if (event.key === "End") {
      event.preventDefault();
      setSlide(total - 1, true);
    }
  });
  const syncInitialHash = () =>
    window.setTimeout(() => setSlide(indexFromHash(), false), 250);
  if (document.readyState === "complete") {
    syncInitialHash();
  } else {
    window.addEventListener("load", syncInitialHash, { once: true });
  }
})();`;

export interface PublicPresentViewerProps {
  deck: Deck;
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

export function PublicPresentViewer({
  deck,
  themePackage,
  visuals,
  title,
  embed = false,
  showAttribution = false,
  recovery,
}: PublicPresentViewerProps): JSX.Element {
  const pkg = themePackage ?? NEUTRAL_THEME_PACKAGE;
  const renderTree = useDeckRenderTree(deck, pkg);
  const fontFaceCss = buildThemePackageFontFaceCss(pkg);

  const total = renderTree?.slides.length ?? 0;
  const canvas = renderTree?.canvas;

  const {
    currentIndex,
    goNext,
    goPrev,
    goToSlide,
    goFirst,
    goLast,
    progress,
    slideAreaRef,
    fittedSlideSize,
    swipeHandlers,
    clickZones,
    hudVisible,
  } = usePresentNavigationShellPresentation<HTMLDivElement>({
    total,
    initialIndex: 0,
    aspectRatio: presentCanvasAspectRatio(canvas),
    autoHideHud: !embed,
  });

  usePublicPresentSlideHash({ currentIndex, total, goToSlide });

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
    return resolveDeckAssetSource(deck, assetId, pkg);
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

  return (
    <div
      data-public-present-viewer
      data-present-total={total}
      data-present-current={currentIndex + 1}
      role="region"
      aria-label={`Presentation: ${title}`}
      aria-live="polite"
      aria-atomic="true"
      className="relative flex h-screen w-full select-none flex-col overflow-hidden bg-ds-inverse-surface"
      onTouchStart={swipeHandlers.onTouchStart}
      onTouchEnd={swipeHandlers.onTouchEnd}
    >
      {fontFaceCss ? (
        <style
          data-theme-package-fonts={`${pkg.id}-${pkg.version ?? "unversioned"}`}
          dangerouslySetInnerHTML={{ __html: fontFaceCss }}
        />
      ) : null}
      {/* Top HUD (suppressed in embed mode) */}
      {!embed && (
        <div
          aria-label="Presentation controls"
          className={`tiq-safe-present-top pointer-events-none absolute inset-x-0 top-0 z-raised flex items-center justify-between gap-4 pb-3 transition-opacity duration-300 motion-reduce:transition-none ${hudVisible ? "opacity-100" : "opacity-0"}`}
        >
          <div className="pointer-events-auto flex items-center gap-3">
            <span
              aria-label={`Slide ${progress.label}`}
              data-present-label
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
              data-present-progress
              className="h-1 w-28 overflow-hidden rounded-full bg-ds-inverse-border-subtle"
            >
              <div
                data-present-progress-fill
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
          <div className="relative h-full w-full">
            {renderTree.slides.map((slideTree, index) => (
              <div
                key={slideTree.id}
                data-present-slide={index + 1}
                aria-hidden={index === currentIndex ? "false" : "true"}
                hidden={index !== currentIndex}
                className="absolute inset-0 flex items-center justify-center"
              >
                <div
                  className="overflow-hidden"
                  style={{
                    width: fittedSlideSize.width,
                    height: fittedSlideSize.height,
                  }}
                >
                  <SlideCanvas
                    slide={slideTree}
                    canvas={canvas}
                    assetResolver={resolveDeckAsset}
                    visualResolver={resolveVisual}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <button
          type="button"
          {...clickZones.previousZone}
          data-present-nav="previous"
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
          data-present-nav="next"
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
            data-present-nav="previous"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-ds-inverse-muted transition-colors hover:bg-ds-inverse-state-hover hover:text-ds-inverse-text disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-inverse-focus"
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <span
            data-present-label
            className="text-xs font-medium tabular-nums text-ds-inverse-subtle"
          >
            {progress.label}
          </span>
          <button
            type="button"
            {...clickZones.nextZone}
            data-present-nav="next"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-ds-inverse-muted transition-colors hover:bg-ds-inverse-state-hover hover:text-ds-inverse-text disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-inverse-focus"
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <MadeWithBadge show={showAttribution} />
      <script
        dangerouslySetInnerHTML={{ __html: PUBLIC_PRESENT_NAVIGATION_SCRIPT }}
      />
    </div>
  );
}
