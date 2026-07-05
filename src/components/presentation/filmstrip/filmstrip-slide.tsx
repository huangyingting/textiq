"use client";

/**
 * FilmstripSlide — a single slide cell in the bottom filmstrip.
 *
 * Shows a scaled slide thumbnail, a slide number label, and an
 * action overlay (move ↑/↓, duplicate, delete) on the active slide.
 */

import { type JSX, type Ref } from "react";
import { Copy, Trash2 } from "lucide-react";

import type { ResolvedSlideRenderTree } from "@/lib/presentation/render-tree";
import type { CanvasSpec } from "@/lib/presentation/types";
import type { Visual } from "@/lib/visual/schema";
import { SlideCanvas } from "../slide-canvas";
import { cx, FOCUS_RING } from "@/components/ui/tokens";

const THUMBNAIL_HEIGHT_PX = 72;
const VIRTUAL_THUMBNAIL_HEIGHT_PX = 540;

function canvasAspectRatio(canvas: CanvasSpec): number {
  const width = canvas.width > 0 ? canvas.width : 16;
  const height = canvas.height > 0 ? canvas.height : 9;
  return width / height;
}

function thumbnailMetrics(canvas: CanvasSpec) {
  const aspectRatio = canvasAspectRatio(canvas);
  const thumbnailWidthPx = Math.max(
    48,
    Math.min(128, THUMBNAIL_HEIGHT_PX * aspectRatio),
  );
  const virtualWidthPx = VIRTUAL_THUMBNAIL_HEIGHT_PX * aspectRatio;
  return {
    aspectRatio: `${canvas.width > 0 ? canvas.width : 16} / ${canvas.height > 0 ? canvas.height : 9}`,
    thumbnailWidthPx,
    virtualWidthPx,
    virtualHeightPx: VIRTUAL_THUMBNAIL_HEIGHT_PX,
    scale: thumbnailWidthPx / virtualWidthPx,
  };
}

export function FilmstripThumbnailCanvas({
  slide,
  canvas,
  assetResolver,
  visualResolver,
}: {
  slide: ResolvedSlideRenderTree;
  canvas: CanvasSpec;
  assetResolver?: (id: string) => string | undefined;
  visualResolver?: (id: string) => Visual | undefined;
}) {
  const metrics = thumbnailMetrics(canvas);
  return (
    <div
      data-filmstrip-thumbnail-canvas="true"
      className="absolute left-0 top-0"
      style={{
        width: metrics.virtualWidthPx,
        height: metrics.virtualHeightPx,
        transform: `scale(${metrics.scale})`,
        transformOrigin: "top left",
      }}
    >
      <SlideCanvas
        slide={slide}
        canvas={canvas}
        assetResolver={assetResolver}
        visualResolver={visualResolver}
        preview
      />
    </div>
  );
}

export interface FilmstripSlideProps {
  slideTree: ResolvedSlideRenderTree;
  canvas: CanvasSpec;
  index: number;
  isActive: boolean;
  slideId: string;
  totalSlides: number;
  isDragging?: boolean;
  isInteractive?: boolean;
  assetResolver?: (id: string) => string | undefined;
  visualResolver?: (id: string) => Visual | undefined;
  slideButtonRef?: Ref<HTMLButtonElement>;
  onSelect: (index: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onPointerDown: (
    event: React.PointerEvent<HTMLLIElement>,
    slideId: string,
    index: number,
  ) => void;
}

export function FilmstripSlide({
  slideTree,
  canvas,
  index,
  isActive,
  slideId,
  totalSlides,
  isDragging = false,
  isInteractive = true,
  assetResolver,
  visualResolver,
  slideButtonRef,
  onSelect,
  onDuplicate,
  onDelete,
  onPointerDown,
}: FilmstripSlideProps): JSX.Element {
  const metrics = thumbnailMetrics(canvas);

  return (
    <li
      data-slide-index={index}
      onPointerDown={(e) => onPointerDown(e, slideId, index)}
      className={cx(
        "group relative grid h-[72px] shrink-0 cursor-pointer select-none place-items-center transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none",
        isDragging && "scale-[0.98] opacity-40 motion-reduce:scale-100",
      )}
      style={{ width: metrics.thumbnailWidthPx }}
    >
      <div
        data-thumbnail-frame="true"
        className="relative h-full w-full"
        style={{
          aspectRatio: metrics.aspectRatio,
        }}
      >
        {/* Thumbnail */}
        <button
          ref={slideButtonRef}
          type="button"
          aria-label={`Go to slide ${index + 1}`}
          aria-current={isActive ? "true" : undefined}
          aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Delete Backspace"
          disabled={!isInteractive}
          tabIndex={isInteractive ? 0 : -1}
          onClick={() => onSelect(index)}
          className={cx(
            "block h-full w-full rounded-ds-sm text-left transition-transform duration-150 ease-out motion-reduce:transition-none",
            isDragging ? "cursor-grabbing" : "cursor-grab",
            FOCUS_RING,
          )}
        >
          <span
            className={cx(
              "tiq-filmstrip-thumbnail-frame pointer-events-none relative block h-full w-full overflow-hidden rounded-ds-sm ring-offset-1 ring-offset-ds-surface-base transition-[box-shadow] duration-150 ease-out motion-reduce:transition-none",
              isActive
                ? "ring-2 ring-ds-accent ring-inset"
                : "group-hover:ring-1 group-hover:ring-ds-border-subtle group-hover:ring-inset",
            )}
          >
            <FilmstripThumbnailCanvas
              slide={slideTree}
              canvas={canvas}
              assetResolver={assetResolver}
              visualResolver={visualResolver}
            />
            <span className="absolute bottom-1 left-1/2 flex h-5 min-w-5 -translate-x-1/2 items-center justify-center rounded-full bg-ds-accent px-1.5 text-[11px] font-bold tabular-nums text-ds-text-on-accent shadow-sm">
              {index + 1}
            </span>
          </span>
        </button>

        {/* Action overlay — shown on hover or keyboard focus */}
        <div
          className="tiq-coarse-actions absolute right-1 top-1 flex items-center gap-0.5 opacity-0 transition-opacity motion-reduce:transition-none focus-within:opacity-100 group-hover:opacity-100"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            aria-label={`Duplicate slide ${index + 1}`}
            disabled={!isInteractive}
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate();
            }}
            className={cx(
              "tiq-touch-target flex h-6 w-6 items-center justify-center rounded-full border border-ds-border-subtle bg-ds-surface-glass text-ds-text-muted shadow-sm backdrop-blur-sm transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary disabled:pointer-events-none disabled:opacity-40",
              FOCUS_RING,
            )}
          >
            <Copy size={13} aria-hidden />
          </button>
          <button
            type="button"
            aria-label={`Delete slide ${index + 1}`}
            disabled={!isInteractive || totalSlides <= 1}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className={cx(
              "tiq-touch-target flex h-6 w-6 items-center justify-center rounded-full border border-ds-border-subtle bg-ds-surface-glass text-ds-text-muted shadow-sm backdrop-blur-sm transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary disabled:pointer-events-none disabled:opacity-40",
              FOCUS_RING,
            )}
          >
            <Trash2 size={13} aria-hidden />
          </button>
        </div>
      </div>
    </li>
  );
}
