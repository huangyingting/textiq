"use client";

/**
 * use-filmstrip-drag — pointer drag-to-reorder hook for the bottom filmstrip.
 *
 * On `pointerdown` on a filmstrip cell (identified by `data-slide-index`),
 * tracks pointer movement and computes the target index from DOM bounding
 * rects. Calls `onMoveSlide(slideId, targetIndex)` on `pointerup`.
 */

import { useRef, useState, type RefObject } from "react";

import { reorderTargetIndexForDraggedItem } from "@/lib/presentation/slide-reorder";

const DRAG_THRESHOLD_PX = 4;
const AUTO_SCROLL_ZONE_PX = 32;
const AUTO_SCROLL_STEP_PX = 14;

export interface UseFilmstripDragOptions {
  /** Called when a slide should be moved to a new index. */
  onMoveSlide: (slideId: string, targetIndex: number) => void;
  /** Called when a pointer gesture is a click/tap instead of a drag. */
  onSelectSlide: (slideIndex: number) => void;
}

export interface FilmstripDragState {
  isDragging: boolean;
  dragSourceIndex: number | null;
  dragTargetIndex: number | null;
  dragPreview: {
    index: number;
    x: number;
    y: number;
    width: number;
    offsetX: number;
    offsetY: number;
  } | null;
}

export interface UseFilmstripDragResult {
  dragState: FilmstripDragState;
  /** Attach to the filmstrip scroll container. */
  containerRef: RefObject<HTMLOListElement | null>;
  /** Call in the `onPointerDown` handler of each filmstrip cell. */
  onCellPointerDown: (
    event: React.PointerEvent<HTMLLIElement>,
    slideId: string,
    slideIndex: number,
  ) => void;
}

export function useFilmstripDrag({
  onMoveSlide,
  onSelectSlide,
}: UseFilmstripDragOptions): UseFilmstripDragResult {
  const containerRef = useRef<HTMLOListElement | null>(null);
  const dragStateRef = useRef<FilmstripDragState>({
    isDragging: false,
    dragSourceIndex: null,
    dragTargetIndex: null,
    dragPreview: null,
  });
  const [dragState, setDragState] = useState<FilmstripDragState>({
    isDragging: false,
    dragSourceIndex: null,
    dragTargetIndex: null,
    dragPreview: null,
  });

  function onCellPointerDown(
    event: React.PointerEvent<HTMLLIElement>,
    slideId: string,
    slideIndex: number,
  ) {
    // Only left-button drag
    if (event.button !== 0) return;
    const container = containerRef.current;
    if (!container) return;

    const startClientX = event.clientX;
    const startClientY = event.clientY;
    const thumbnailFrame = event.currentTarget.querySelector<HTMLElement>(
      '[data-thumbnail-frame="true"]',
    );
    const sourceRect =
      thumbnailFrame?.getBoundingClientRect() ??
      event.currentTarget.getBoundingClientRect();
    const offsetX = event.clientX - sourceRect.left;
    const offsetY = event.clientY - sourceRect.top;
    let moved = false;

    dragStateRef.current = {
      isDragging: false,
      dragSourceIndex: slideIndex,
      dragTargetIndex: null,
      dragPreview: null,
    };
    event.currentTarget.setPointerCapture(event.pointerId);

    const cells = () =>
      Array.from(
        container.querySelectorAll<HTMLLIElement>("[data-slide-index]"),
      );

    function getTargetIndex(clientX: number, clientY: number): number | null {
      const allCells = cells();
      const rects = allCells.map((cell) => cell.getBoundingClientRect());
      if (rects.length === 0) return null;
      const extents = rects.map((rect) => ({
        start: rect.left,
        end: rect.right,
      }));
      return reorderTargetIndexForDraggedItem({
        fromIndex: slideIndex,
        pointerMain: clientX,
        pointerCross: clientY,
        itemMainOffset: offsetX,
        itemMainSize: sourceRect.width,
        items: extents,
        crossStart: Math.min(...rects.map((rect) => rect.top)),
        crossEnd: Math.max(...rects.map((rect) => rect.bottom)),
      });
    }

    function maybeAutoScroll(clientX: number) {
      const currentContainer = containerRef.current;
      if (!currentContainer) return;
      const rect = currentContainer.getBoundingClientRect();
      if (clientX < rect.left + AUTO_SCROLL_ZONE_PX) {
        currentContainer.scrollLeft -= AUTO_SCROLL_STEP_PX;
      } else if (clientX > rect.right - AUTO_SCROLL_ZONE_PX) {
        currentContainer.scrollLeft += AUTO_SCROLL_STEP_PX;
      }
    }

    function handlePointerMove(moveEvent: PointerEvent) {
      const movement = Math.hypot(
        moveEvent.clientX - startClientX,
        moveEvent.clientY - startClientY,
      );
      if (!moved && movement < DRAG_THRESHOLD_PX) {
        return;
      }
      moved = true;
      moveEvent.preventDefault();
      const idx = getTargetIndex(moveEvent.clientX, moveEvent.clientY);
      maybeAutoScroll(moveEvent.clientX);
      dragStateRef.current.isDragging = true;
      dragStateRef.current.dragTargetIndex = idx;
      dragStateRef.current.dragPreview = dragStateRef.current.dragPreview
        ? {
            ...dragStateRef.current.dragPreview,
            x: moveEvent.clientX - offsetX,
            y: moveEvent.clientY - offsetY,
          }
        : {
            index: slideIndex,
            x: moveEvent.clientX - offsetX,
            y: moveEvent.clientY - offsetY,
            width: sourceRect.width,
            offsetX,
            offsetY,
          };
      setDragState({ ...dragStateRef.current });
      // Update visual indicator via CSS attribute on container
      container?.setAttribute("data-drag-target", String(idx));
    }

    function cleanupDrag() {
      dragStateRef.current = {
        isDragging: false,
        dragSourceIndex: null,
        dragTargetIndex: null,
        dragPreview: null,
      };
      setDragState({ ...dragStateRef.current });
      container?.removeAttribute("data-drag-target");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    }

    function handlePointerUp(upEvent: PointerEvent) {
      if (!moved) {
        onSelectSlide(slideIndex);
        cleanupDrag();
        return;
      }
      upEvent.preventDefault();
      const targetIndex = getTargetIndex(upEvent.clientX, upEvent.clientY);
      if (targetIndex !== null && targetIndex !== slideIndex) {
        onMoveSlide(slideId, targetIndex);
        onSelectSlide(Math.max(0, Math.min(targetIndex, cells().length - 1)));
      }
      cleanupDrag();
    }

    function handlePointerCancel() {
      cleanupDrag();
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
  }

  return {
    dragState,
    containerRef,
    onCellPointerDown,
  };
}
