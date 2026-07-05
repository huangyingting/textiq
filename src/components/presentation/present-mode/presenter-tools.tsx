"use client";

/**
 * Presenter tools for presentation present mode.
 *
 * Owns the data-agnostic HUD, keyboard-help, and timer chrome shared by the
 * presentation presenter shell. Provides a presentation-specific `SlideOverviewPanelPresentation`
 * that accepts `ResolvedDeckRenderTree`.
 */

import { type JSX, type ReactNode } from "react";
import { FileText, Grid3x3, Maximize2, Minimize2, X } from "lucide-react";

import { FOCUS_RING } from "@/components/ui/tokens";
import type { SlideChildNode, SlideNode } from "@/lib/presentation/schema";
import type { ResolvedDeckRenderTree } from "@/lib/presentation/render-tree";
import type { Visual } from "@/lib/visual/schema";
import {
  PRESENT_MODE_SHORTCUTS,
  formatPresentElapsedTime,
} from "@/lib/presentation/present-shell";

import { SlideCanvas } from "@/components/presentation/slide-canvas";

// ---------------------------------------------------------------------------
// Data-agnostic presenter HUD components
// ---------------------------------------------------------------------------

function ShortcutKeys({ keys }: { keys: string[] }): JSX.Element {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {keys.map((key, index) => (
        <kbd
          key={`${key}-${index}`}
          className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-ds-inverse-border-subtle bg-ds-inverse-control px-1.5 text-xs font-medium text-ds-inverse-text"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}

export function KeyboardHelpOverlay({
  onClose,
}: {
  onClose: () => void;
}): JSX.Element {
  return (
    <div
      className="absolute inset-0 z-header flex items-center justify-center bg-ds-backdrop-strong p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="present-mode-shortcuts-title"
        className="w-full max-w-3xl rounded-2xl border border-ds-inverse-border-subtle bg-ds-inverse-surface p-6 text-ds-inverse-text shadow-ds-overlay backdrop-blur-sm"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id="present-mode-shortcuts-title"
              className="text-lg font-semibold"
            >
              Keyboard shortcuts
            </h2>
            <p className="mt-1 text-sm text-ds-inverse-muted">
              Presenter tools stay in-app only and never appear in the public
              viewer.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close keyboard shortcuts"
            onClick={onClose}
            className={`flex h-8 w-8 items-center justify-center rounded-full text-ds-inverse-muted transition-colors hover:bg-ds-inverse-control-hover hover:text-ds-inverse-text ${FOCUS_RING}`}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {PRESENT_MODE_SHORTCUTS.map((shortcut) => (
            <li
              key={shortcut.description}
              className="flex items-center justify-between gap-4 rounded-xl border border-ds-inverse-border-subtle bg-ds-inverse-control px-4 py-3"
            >
              <span className="text-sm text-ds-inverse-text">
                {shortcut.description}
              </span>
              <ShortcutKeys keys={shortcut.keys} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function PresenterTimer({
  elapsedSeconds,
}: {
  elapsedSeconds: number;
}): JSX.Element {
  const formatted = formatPresentElapsedTime(elapsedSeconds);
  return (
    <span
      aria-label={`Elapsed time ${formatted}`}
      className="rounded-md border border-ds-inverse-border-subtle bg-ds-inverse-surface-muted px-2 py-1 text-xs font-medium tabular-nums text-ds-inverse-text backdrop-blur-sm"
    >
      <span className="mr-1 text-ds-inverse-muted">Timer</span>
      {formatted}
    </span>
  );
}

export function HudButton({
  label,
  onClick,
  children,
  active,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${FOCUS_RING} ${
        active
          ? "border-ds-inverse-text bg-ds-inverse-control-hover text-ds-inverse-text"
          : "border-ds-inverse-border-subtle bg-ds-inverse-control text-ds-inverse-muted hover:bg-ds-inverse-control-hover hover:text-ds-inverse-text"
      }`}
    >
      {children}
    </button>
  );
}

export function PresenterToolIcon({
  kind,
  isFullscreen,
  laserActive,
}: {
  kind: "notes" | "overview" | "timer" | "laser" | "fullscreen" | "exit";
  isFullscreen?: boolean;
  laserActive?: boolean;
}): JSX.Element {
  switch (kind) {
    case "notes":
      return <FileText size={14} aria-hidden="true" />;
    case "overview":
      return <Grid3x3 size={14} aria-hidden="true" />;
    case "timer":
      return <span className="text-[11px] font-semibold leading-none">T</span>;
    case "laser":
      return (
        <span
          aria-hidden="true"
          className={`block h-2.5 w-2.5 rounded-full ${
            laserActive
              ? "bg-ds-danger shadow-[var(--ds-shadow-laser-indicator)]"
              : "border border-current"
          }`}
        />
      );
    case "fullscreen":
      return isFullscreen ? (
        <Minimize2 size={14} aria-hidden="true" />
      ) : (
        <Maximize2 size={14} aria-hidden="true" />
      );
    case "exit":
      return <X size={14} aria-hidden="true" />;
  }
}

function firstNonEmptyLine(value: string | undefined): string | null {
  if (!value) return null;
  const line = value
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  return line ?? null;
}

function extractNodeLabel(node: SlideChildNode): string | null {
  if (node.type === "text") {
    return (
      node.content.paragraphs
        .map((paragraph) => paragraph.text.trim())
        .find((paragraph) => paragraph.length > 0) ?? null
    );
  }
  if (node.type === "group") {
    for (const child of node.children) {
      const label = extractNodeLabel(child);
      if (label) return label;
    }
  }
  return null;
}

function resolveSlideLabel(
  slide: SlideNode | undefined,
  index: number,
  fallback: string,
): string {
  const named = firstNonEmptyLine(slide?.name);
  if (named) return named;

  if (slide) {
    for (const node of slide.children) {
      if (node.role !== "title") continue;
      const title = extractNodeLabel(node);
      if (title) return title;
    }
    for (const node of slide.children) {
      const label = extractNodeLabel(node);
      if (label) return label;
    }
  }

  const notes = firstNonEmptyLine(slide?.notes);
  if (notes) return notes;

  return `${fallback} ${index + 1}`;
}

// ---------------------------------------------------------------------------
// Slide overview panel — presentation version
// ---------------------------------------------------------------------------

export interface SlideOverviewPanelPresentationProps {
  slides: SlideNode[];
  renderTree: ResolvedDeckRenderTree;
  currentIndex: number;
  assetResolver?: (id: string) => string | undefined;
  visualResolver?: (id: string) => Visual | undefined;
  onJump: (index: number) => void;
  onClose: () => void;
}

export interface PresenterPanelPresentationProps {
  currentSlide: SlideNode;
  currentIndex: number;
  total: number;
  nextSlide?: SlideNode;
  nextSlideTree?: ResolvedDeckRenderTree["slides"][number];
  canvas: ResolvedDeckRenderTree["canvas"];
  assetResolver?: (id: string) => string | undefined;
  visualResolver?: (id: string) => Visual | undefined;
}

export function PresenterPanelPresentation({
  currentSlide,
  currentIndex,
  total,
  nextSlide,
  nextSlideTree,
  canvas,
  assetResolver,
  visualResolver,
}: PresenterPanelPresentationProps): JSX.Element {
  const previewAspectRatio =
    canvas.width > 0 && canvas.height > 0
      ? canvas.width / canvas.height
      : 16 / 9;
  const currentSlideLabel = resolveSlideLabel(
    currentSlide,
    currentIndex,
    "Slide",
  );

  return (
    <div className="flex h-full min-h-0 gap-4 overflow-hidden bg-ds-stage px-6 py-4">
      <div className="flex min-w-0 flex-[1.4] flex-col">
        <p className="text-xs font-semibold uppercase tracking-widest text-ds-stage-muted">
          Current slide notes
        </p>
        <div className="mt-2 flex min-h-0 flex-1 flex-col rounded-lg border border-ds-stage-border bg-ds-stage-panel-muted p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-ds-stage-muted">
            Slide {currentIndex + 1} of {total}
          </p>
          <h2 className="mt-2 text-lg font-semibold text-ds-stage-text">
            {currentSlideLabel}
          </h2>
          <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
            {currentSlide.notes ? (
              <p className="whitespace-pre-wrap text-base leading-7 text-ds-stage-text">
                {currentSlide.notes}
              </p>
            ) : (
              <p className="text-sm italic text-ds-stage-muted">
                No speaker notes for this slide.
              </p>
            )}
          </div>
        </div>
      </div>

      {nextSlide && nextSlideTree ? (
        <div className="flex w-64 flex-shrink-0 flex-col">
          <p className="text-xs font-semibold uppercase tracking-widest text-ds-stage-muted">
            Up next
          </p>
          <div
            className="mt-2 min-h-0 flex-1 overflow-hidden rounded-lg border border-ds-stage-border"
            style={{ aspectRatio: previewAspectRatio }}
          >
            <div className="h-full w-full overflow-hidden">
              <SlideCanvas
                slide={nextSlideTree}
                canvas={canvas}
                assetResolver={assetResolver}
                visualResolver={visualResolver}
                preview
              />
            </div>
          </div>
          <p className="mt-2 truncate text-sm text-ds-stage-muted">
            {resolveSlideLabel(nextSlide, currentIndex + 1, "Slide")}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function SlideOverviewPanelPresentation({
  slides,
  renderTree,
  currentIndex,
  assetResolver,
  visualResolver,
  onJump,
  onClose,
}: SlideOverviewPanelPresentationProps): JSX.Element {
  const canvasAspectRatio =
    renderTree.canvas.width > 0 && renderTree.canvas.height > 0
      ? renderTree.canvas.width / renderTree.canvas.height
      : 16 / 9;

  return (
    <div
      className="absolute inset-0 z-header flex items-center justify-center bg-ds-backdrop-strong p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="present-mode-overview-title"
        className="flex max-h-[85vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-ds-inverse-border-subtle bg-ds-inverse-surface p-6 text-ds-inverse-text shadow-ds-overlay backdrop-blur-sm"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id="present-mode-overview-title"
              className="text-lg font-semibold"
            >
              Slide overview
            </h2>
            <p className="mt-1 text-sm text-ds-inverse-muted">
              Click any slide to jump there.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close slide overview"
            onClick={onClose}
            className={`flex h-8 w-8 items-center justify-center rounded-full text-ds-inverse-muted transition-colors hover:bg-ds-inverse-control-hover hover:text-ds-inverse-text ${FOCUS_RING}`}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="mt-6 overflow-y-auto pr-1">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {renderTree.slides.map((slideTree, index) => {
              const isCurrent = index === currentIndex;
              const slideLabel = resolveSlideLabel(
                slides[index],
                index,
                "Untitled slide",
              );
              return (
                <button
                  key={slideTree.id}
                  type="button"
                  aria-current={isCurrent ? "true" : undefined}
                  aria-label={`Jump to slide ${index + 1}, ${slideLabel}`}
                  onClick={() => onJump(index)}
                  className={`flex flex-col gap-3 rounded-xl border p-3 text-left transition-colors hover:border-ds-inverse-text ${FOCUS_RING} ${
                    isCurrent
                      ? "border-ds-inverse-text bg-ds-inverse-control"
                      : "border-ds-inverse-border-subtle bg-ds-inverse-control"
                  }`}
                >
                  <div
                    className="overflow-hidden rounded-lg border border-ds-inverse-border-subtle bg-ds-inverse-surface"
                    style={{ aspectRatio: canvasAspectRatio }}
                  >
                    <SlideCanvas
                      slide={slideTree}
                      canvas={renderTree.canvas}
                      assetResolver={assetResolver}
                      visualResolver={visualResolver}
                      preview
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-semibold uppercase tracking-widest text-ds-inverse-muted">
                        Slide {index + 1}
                      </span>
                      {isCurrent ? (
                        <span className="text-xs font-medium text-ds-inverse-text">
                          Current
                        </span>
                      ) : null}
                    </div>
                    <p className="truncate text-sm font-medium text-ds-inverse-text">
                      {slideLabel}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
