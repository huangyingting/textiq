"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { usePopMotion } from "@/components/motion/reveal";

import { cx, MENU_CHROME, UI_LAYER, type UILayer } from "./tokens";

// Gap (px) between the trigger's edge and the panel.
const PANEL_GAP = 8;
const VIEWPORT_INSET = 8;

type FocusRef = { readonly current: HTMLElement | null };

export type PopoverProps = {
  /** Controls panel visibility. The caller owns the open/close state. */
  open: boolean;
  /** Called when the popover requests close (Escape or outside-click). */
  onClose: () => void;
  /**
   * The trigger element rendered adjacent to the panel.  Both the trigger and
   * the panel are wrapped in a `relative` container so click-outside detection
   * can treat them as a single unit without relying on `stopPropagation`.
   */
  trigger: ReactNode;
  /** Panel content. */
  children: ReactNode;
  /** Extra classes applied to the panel (e.g. sizing, custom placement). */
  className?: string;
  /**
   * Vertical placement relative to the trigger. `"bottom"` (default) opens
   * below the trigger; `"top"` opens above it (useful for triggers pinned to
   * the bottom of the viewport, e.g. the slide bottom dock).
   */
  placement?: "bottom" | "top";
  /** Horizontal alignment relative to the anchor. Defaults to end-aligned. */
  align?: "start" | "center" | "end";
  /** Element used for panel placement. Defaults to the trigger wrapper. */
  anchor?: "trigger" | "toolbar";
  /** Render the panel in `document.body` so overflow ancestors cannot clip it. */
  portal?: boolean;
  /** Semantic z-index layer for the floating panel. */
  layer?: UILayer;
  /** ARIA role for the panel. Defaults to `"dialog"`. */
  role?: string;
  /** Element to focus when the panel opens. */
  initialFocusRef?: FocusRef;
  /** Element to focus after the panel closes. Defaults to the previously focused element. */
  restoreFocusRef?: FocusRef;
  /** Restores focus to the opener (or restoreFocusRef) after an interactive popover closes. */
  restoreFocusOnClose?: boolean;
  "aria-label"?: string;
};

/**
 * An accessible anchored-popover primitive.
 *
 * - Wraps both the trigger and panel in a `position: relative` container so
 *   click-outside detection uses ref containment (no `stopPropagation`).
 * - The panel is **`position: fixed`**, positioned from the trigger's bounding
 *   box. Fixed positioning lets the panel escape any `overflow` ancestor (e.g.
 *   a horizontally-scrollable toolbar) that would otherwise clip it —
 *   `overflow-x: auto` forces `overflow-y` to compute as `auto`, which used to
 *   clip dropdowns rendered below the row. Use `portal` when an ancestor's
 *   filter/backdrop-filter/transform creates a fixed-position containing block
 *   anyway; the panel is then rendered in `document.body` and click-away checks
 *   both the trigger wrapper and the portaled panel.
 * - Repositions on scroll / resize so it stays pinned to the trigger.
 * - Closes on Escape key and pointer-down outside the container.
 * - Reduced-motion-aware enter / exit animation via {@link usePopMotion}.
 * - Default placement: bottom-end (right edge aligned to the trigger's right
 *   edge, just below it). `align="start"` left-aligns wide menus opened from
 *   the left side of dense toolbars. The computed x-coordinate is clamped to
 *   the viewport so fixed-width menus do not get cut off-screen.
 */
export function Popover({
  open,
  onClose,
  trigger,
  children,
  className,
  placement = "bottom",
  align = "end",
  anchor = "trigger",
  portal = false,
  layer = "dropdown",
  role = "dialog",
  initialFocusRef,
  restoreFocusRef,
  restoreFocusOnClose = false,
  "aria-label": ariaLabel,
}: PopoverProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(open);
  const popMotion = usePopMotion();
  // Fixed-viewport coordinates: anchor the panel near the trigger, then clamp
  // the measured panel box inside the viewport.
  const [coords, setCoords] = useState<{
    top?: number;
    bottom?: number;
    left: number;
  }>({
    top: -1000,
    left: -1000,
  });

  const reposition = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const anchorEl =
      anchor === "toolbar"
        ? ((el.closest(
            '[data-stage-floating-toolbar="true"]',
          ) as HTMLElement | null) ?? el)
        : el;
    const rect = anchorEl.getBoundingClientRect();
    const panelWidth = panelRef.current?.offsetWidth ?? 0;
    const measuredWidth = panelWidth || rect.width;
    const startLeft = rect.left;
    const endLeft = rect.right - measuredWidth;
    const viewportRight = window.innerWidth - VIEWPORT_INSET;
    let preferredLeft =
      align === "center"
        ? rect.left + rect.width / 2 - measuredWidth / 2
        : align === "end"
          ? endLeft
          : startLeft;
    if (
      align === "start" &&
      startLeft + measuredWidth > viewportRight &&
      endLeft >= VIEWPORT_INSET
    ) {
      preferredLeft = endLeft;
    } else if (
      align === "end" &&
      endLeft < VIEWPORT_INSET &&
      startLeft + measuredWidth <= viewportRight
    ) {
      preferredLeft = startLeft;
    }
    const maxLeft = Math.max(
      VIEWPORT_INSET,
      window.innerWidth - measuredWidth - VIEWPORT_INSET,
    );
    const left = Math.min(Math.max(preferredLeft, VIEWPORT_INSET), maxLeft);
    const nextCoords =
      placement === "top"
        ? {
            bottom: Math.max(0, window.innerHeight - rect.top + PANEL_GAP),
            left,
          }
        : { top: rect.bottom + PANEL_GAP, left };
    setCoords((prev) =>
      prev.top === nextCoords.top &&
      prev.bottom === nextCoords.bottom &&
      prev.left === nextCoords.left
        ? prev
        : nextCoords,
    );
  }, [align, anchor, placement]);

  // Measure the trigger on open and keep the panel pinned while the user
  // scrolls or resizes.
  useLayoutEffect(() => {
    if (!open) return;
    let animationFrame = 0;
    const trackPosition = () => {
      reposition();
      animationFrame = window.requestAnimationFrame(trackPosition);
    };
    reposition();
    animationFrame = window.requestAnimationFrame(trackPosition);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    window.visualViewport?.addEventListener("resize", reposition);
    window.visualViewport?.addEventListener("scroll", reposition);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      window.visualViewport?.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("scroll", reposition);
    };
  }, [open, reposition]);

  useEffect(() => {
    if (open) {
      previouslyFocusedElementRef.current =
        typeof document !== "undefined"
          ? (document.activeElement as HTMLElement | null)
          : null;
      initialFocusRef?.current?.focus({ preventScroll: true });
      wasOpenRef.current = true;
      return;
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    if (restoreFocusOnClose) {
      const restoreTarget =
        restoreFocusRef?.current ?? previouslyFocusedElementRef.current;
      restoreTarget?.focus({ preventScroll: true });
    }
    previouslyFocusedElementRef.current = null;
  }, [initialFocusRef, open, restoreFocusOnClose, restoreFocusRef]);

  // Escape closes the popover.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // Pointer-down outside the container closes the popover. Capture phase keeps
  // toolbar popovers aligned with SelectMenu: a canvas pointer handler may
  // prevent the later mouse event, but it cannot suppress this close-away path.
  useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const insideTrigger = containerRef.current?.contains(target) ?? false;
      const insidePanel = panelRef.current?.contains(target) ?? false;
      if (!insideTrigger && !insidePanel) {
        onClose();
      }
    };
    document.addEventListener("pointerdown", onDocPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onDocPointerDown, true);
  }, [open, onClose]);

  const panel = (
    <AnimatePresence>
      {open ? (
        <motion.div
          ref={panelRef}
          data-floating-panel="true"
          role={role}
          aria-label={ariaLabel}
          initial={popMotion.initial}
          animate={popMotion.animate}
          exit={popMotion.exit}
          transition={popMotion.transition}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerMove={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onMouseMove={(event) => event.stopPropagation()}
          style={{
            top: coords.top,
            bottom: coords.bottom,
            left: coords.left,
          }}
          className={cx(
            "fixed max-w-[calc(100vw-1rem)]",
            UI_LAYER[layer],
            // Default sizing only when the caller doesn't supply its own.
            // `cx` concatenates without Tailwind-merge, so a hardcoded
            // default width/padding would otherwise override the caller's.
            className ? undefined : "w-80 p-4",
            MENU_CHROME,
            className,
          )}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );

  return (
    <div ref={containerRef} className="relative">
      {trigger}
      {portal && typeof document !== "undefined"
        ? createPortal(panel, document.body)
        : panel}
    </div>
  );
}
