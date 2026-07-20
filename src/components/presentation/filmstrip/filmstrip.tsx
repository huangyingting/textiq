"use client";

/**
 * Bottom filmstrip — horizontal slide navigation rail.
 *
 * Replaces the legacy left vertical slide rail. Shows slide thumbnails in a
 * horizontal scroll container with keyboard navigation (←/→), drag-to-reorder,
 * and per-slide actions (move, duplicate, delete).
 *
 * Collapsible via a toggle button; collapsed state persistence is managed by
 * the editor and scoped per document.
 */

import {
  Fragment,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
} from "react";
import { Plus } from "lucide-react";

import { MIN_DECK_SLIDES_MESSAGE } from "@/lib/presentation";
import type { ResolvedDeckRenderTree } from "@/lib/presentation/render-tree";
import type { Visual } from "@/lib/visual/schema";
import { cx, FOCUS_RING } from "@/components/ui/tokens";
import {
  createFocusGeometryRegistry,
  focusGeometryTargets,
} from "../focus-geometry-registry";
import { FilmstripSlide, FilmstripThumbnailCanvas } from "./filmstrip-slide";
import { useFilmstripDrag } from "./use-filmstrip-drag";

export interface FilmstripProps {
  renderTree: ResolvedDeckRenderTree;
  activeSlideIndex: number;
  collapsed: boolean;
  assetResolver?: (id: string) => string | undefined;
  visualResolver?: (id: string) => Visual | undefined;
  onSelectSlide: (index: number) => void;
  onInsertSlide: () => void;
  onDuplicateSlide: (slideId: string) => void;
  onDeleteSlide: (slideId: string) => void;
  onMoveSlide: (slideId: string, targetIndex: number) => void;
}

export function Filmstrip({
  renderTree,
  activeSlideIndex,
  collapsed,
  assetResolver,
  visualResolver,
  onSelectSlide,
  onInsertSlide,
  onDuplicateSlide,
  onDeleteSlide,
  onMoveSlide,
}: FilmstripProps): JSX.Element {
  const [statusMessage, setStatusMessage] = useState("");
  const pendingFocusSlideIndexRef = useRef<number | null>(null);
  const focusGeometryRegistry = useMemo(
    () => createFocusGeometryRegistry(),
    [],
  );
  const canvasWidth =
    renderTree.canvas.width > 0 ? renderTree.canvas.width : 16;
  const canvasHeight =
    renderTree.canvas.height > 0 ? renderTree.canvas.height : 9;
  const thumbnailAspectRatio = `${canvasWidth} / ${canvasHeight}`;

  const { dragState, containerRef, onCellPointerDown } = useFilmstripDrag({
    onMoveSlide,
    onSelectSlide,
  });

  useLayoutEffect(() => {
    const pendingFocusSlideIndex = pendingFocusSlideIndexRef.current;
    if (pendingFocusSlideIndex === null) return;
    if (renderTree.slides.length === 0) {
      pendingFocusSlideIndexRef.current = null;
      return;
    }
    const targetIndex = Math.min(
      Math.max(pendingFocusSlideIndex, 0),
      renderTree.slides.length - 1,
    );
    pendingFocusSlideIndexRef.current = targetIndex;
    if (
      focusGeometryRegistry.focus(
        focusGeometryTargets.filmstripSlideButton(targetIndex),
      )
    ) {
      pendingFocusSlideIndexRef.current = null;
    }
  });

  function requestSlideButtonFocus(index: number) {
    if (renderTree.slides.length === 0) return;
    pendingFocusSlideIndexRef.current = Math.min(
      Math.max(index, 0),
      renderTree.slides.length - 1,
    );
  }

  function handleKeyDown(event: KeyboardEvent<HTMLOListElement>) {
    const focusedCell =
      event.target instanceof HTMLElement
        ? event.target.closest<HTMLElement>("[data-slide-index]")
        : null;
    const focusedIndex = focusedCell?.dataset.slideIndex
      ? Number(focusedCell.dataset.slideIndex)
      : activeSlideIndex;
    const focusedSlide = renderTree.slides[focusedIndex];

    if (
      event.altKey &&
      (event.key === "ArrowLeft" || event.key === "ArrowRight")
    ) {
      if (!focusedSlide) return;
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      const nextIndex = focusedIndex + direction;
      if (nextIndex < 0 || nextIndex >= renderTree.slides.length) {
        return;
      }
      event.preventDefault();
      onMoveSlide(focusedSlide.id, nextIndex);
      setStatusMessage(`Moved slide ${focusedIndex + 1} to ${nextIndex + 1}.`);
      requestSlideButtonFocus(nextIndex);
      return;
    }

    if (event.key === "ArrowLeft" && focusedIndex > 0) {
      event.preventDefault();
      const nextIndex = focusedIndex - 1;
      onSelectSlide(nextIndex);
      requestSlideButtonFocus(nextIndex);
    } else if (
      event.key === "ArrowRight" &&
      focusedIndex < renderTree.slides.length - 1
    ) {
      event.preventDefault();
      const nextIndex = focusedIndex + 1;
      onSelectSlide(nextIndex);
      requestSlideButtonFocus(nextIndex);
    } else if (event.key === "Home") {
      event.preventDefault();
      onSelectSlide(0);
      requestSlideButtonFocus(0);
    } else if (event.key === "End") {
      event.preventDefault();
      const nextIndex = renderTree.slides.length - 1;
      onSelectSlide(nextIndex);
      requestSlideButtonFocus(nextIndex);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelectSlide(focusedIndex);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      if (!focusedSlide) return;
      event.preventDefault();
      if (renderTree.slides.length <= 1) {
        setStatusMessage(MIN_DECK_SLIDES_MESSAGE);
        return;
      }
      const nextIndex = Math.min(focusedIndex, renderTree.slides.length - 2);
      onDeleteSlide(focusedSlide.id);
      setStatusMessage(`Deleted slide ${focusedIndex + 1}.`);
      requestSlideButtonFocus(nextIndex);
    }
  }

  return (
    <div className="shrink-0 bg-transparent" aria-label="Slide filmstrip">
      <div aria-live="polite" className="sr-only">
        {statusMessage}
      </div>
      {dragState.dragPreview ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-dropdown rotate-1 opacity-95 transition-transform duration-150 ease-out motion-reduce:rotate-0 motion-reduce:transition-none"
          style={{
            left: dragState.dragPreview.x,
            top: dragState.dragPreview.y,
            width: dragState.dragPreview.width,
          }}
        >
          <div className="rounded-ds-sm shadow-ds-overlay">
            <div
              className="relative overflow-hidden rounded-ds-sm ring-2 ring-ds-accent ring-inset"
              style={{ aspectRatio: thumbnailAspectRatio, width: "100%" }}
            >
              <FilmstripThumbnailCanvas
                slide={renderTree.slides[dragState.dragPreview.index]!}
                canvas={renderTree.canvas}
                assetResolver={assetResolver}
                visualResolver={visualResolver}
              />
              <span className="absolute bottom-1.5 left-1/2 flex h-7 min-w-7 -translate-x-1/2 items-center justify-center rounded-full bg-ds-accent px-2 text-sm font-bold tabular-nums text-ds-text-on-accent shadow-sm">
                {dragState.dragPreview.index + 1}
              </span>
            </div>
          </div>
        </div>
      ) : null}
      <div
        aria-hidden={collapsed}
        className={cx(
          "overflow-hidden transition-[max-height,opacity,transform] duration-200 ease-out motion-reduce:transition-none",
          collapsed
            ? "max-h-0 translate-y-1 opacity-0"
            : "max-h-[84px] translate-y-0 opacity-100",
        )}
      >
        <div
          className={cx(
            "relative flex h-[84px] items-center gap-0 transition-opacity duration-150 motion-reduce:transition-none",
            collapsed && "pointer-events-none opacity-0",
          )}
        >
          {/* Thumbnails */}
          <ol
            ref={containerRef}
            aria-label="Slide thumbnails"
            className="flex min-w-0 flex-1 gap-2 overflow-x-auto px-3 py-1.5"
            onKeyDown={handleKeyDown}
            tabIndex={collapsed ? -1 : 0}
          >
            {renderTree.slides.map((slideTree, index) => {
              const slideId = slideTree.id;
              return (
                <Fragment key={slideId}>
                  {dragState.isDragging &&
                  dragState.dragTargetIndex === index ? (
                    <li
                      aria-hidden="true"
                      className="my-1 w-0.5 shrink-0 rounded-full bg-ds-accent-fill"
                    />
                  ) : null}
                  <FilmstripSlide
                    slideTree={slideTree}
                    canvas={renderTree.canvas}
                    index={index}
                    isActive={index === activeSlideIndex}
                    slideId={slideId}
                    totalSlides={renderTree.slides.length}
                    isDragging={dragState.dragSourceIndex === index}
                    isInteractive={!collapsed}
                    assetResolver={assetResolver}
                    visualResolver={visualResolver}
                    slideButtonRef={focusGeometryRegistry.createRef(
                      focusGeometryTargets.filmstripSlideButton(index),
                    )}
                    onSelect={onSelectSlide}
                    onDuplicate={() => onDuplicateSlide(slideId)}
                    onDelete={() => onDeleteSlide(slideId)}
                    onPointerDown={onCellPointerDown}
                  />
                </Fragment>
              );
            })}
            {dragState.isDragging &&
            dragState.dragTargetIndex === renderTree.slides.length ? (
              <li
                aria-hidden="true"
                className="my-1 w-0.5 shrink-0 rounded-full bg-ds-accent-fill"
              />
            ) : null}
          </ol>
          <button
            type="button"
            aria-label="Add slide"
            disabled={collapsed}
            tabIndex={collapsed ? -1 : 0}
            onClick={onInsertSlide}
            className={cx(
              "flex h-full min-h-[72px] w-14 shrink-0 items-center justify-center rounded-[var(--ds-radius-sm,6px)] border border-dashed border-ds-border-subtle text-ds-text-muted transition-colors hover:border-ds-border hover:text-ds-text-primary disabled:pointer-events-none",
              FOCUS_RING,
            )}
          >
            <Plus size={16} aria-hidden />
            <span className="sr-only sm:not-sr-only sm:ml-1 sm:text-xs">
              Add
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
