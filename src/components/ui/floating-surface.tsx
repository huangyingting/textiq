"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { usePopMotion } from "@/components/motion/reveal";

import {
  cx,
  ELEVATION,
  RADIUS,
  SURFACE_BASE,
  UI_LAYER,
  type Elevation,
  type Radius,
  type UILayer,
} from "./tokens";

// Minimum inset (px) kept between a clamped surface and the viewport edges.
const VIEWPORT_INSET = 8;
// Coordinates at/below this are treated as an intentional off-screen sentinel
// (surfaces park here for a frame before their own layout effect measures), so
// the viewport clamp leaves them alone rather than yanking them into view.
const OFFSCREEN_SENTINEL = -900;

const subscribeToMountedSnapshot = () => () => undefined;
const getMountedSnapshot = () => true;
const getServerMountedSnapshot = () => false;

export type FloatingSurfaceProps = {
  open: boolean;
  /** Called on Escape or click-away (when those behaviours are enabled). */
  onClose?: () => void;
  /** Fixed-viewport coordinates for the top-left of the surface. */
  position: { top: number; left: number };
  children: ReactNode;
  elevation?: Elevation;
  radius?: Radius;
  /** ARIA role for the surface. Defaults to `dialog`. */
  role?: string;
  "aria-label"?: string;
  /** Layer for the portal surface. Defaults to `dropdown`. */
  layer?: UILayer;
  /** Close when Escape is pressed. Defaults to `true`. */
  closeOnEscape?: boolean;
  /** Close on pointer-down outside the surface. Defaults to `true`. */
  closeOnClickAway?: boolean;
  /** Optional external trigger/anchor that should not count as click-away. */
  clickAwayIgnoreRef?: RefObject<HTMLElement | null>;
  /**
   * Prevent default on pointer-down so the editor text selection survives a
   * click on the surface (used by selection-anchored toolbars).
   */
  keepSelection?: boolean;
  /**
   * Clamp the surface within the viewport (minus {@link VIEWPORT_INSET}) after
   * it renders, as a safety net so menus/popovers never overflow on narrow
   * widths even when the caller's anchor math doesn't account for the surface's
   * own size. Defaults to `true`. Off-screen sentinel coordinates are exempt.
   */
  clampToViewport?: boolean;
  className?: string;
  style?: CSSProperties;
};

/**
 * The shared floating container: a portal to `document.body`, fixed
 * positioning, reduced-motion-aware pop motion (via {@link usePopMotion}),
 * Escape-to-close, and pointer-down click-away — the logic that the editor's
 * floating surfaces (the floating text toolbar, the `+`/`/` insert menu, the
 * per-block spark, and `visual-card.tsx`) would otherwise each duplicate.
 * Click-away uses ref containment, never `stopPropagation`.
 */
export function FloatingSurface({
  open,
  onClose,
  position,
  children,
  elevation = "overlay",
  radius = "lg",
  role = "dialog",
  "aria-label": ariaLabel,
  layer = "dropdown",
  closeOnEscape = true,
  closeOnClickAway = true,
  clickAwayIgnoreRef,
  keepSelection = false,
  clampToViewport = true,
  className,
  style,
}: FloatingSurfaceProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const popMotion = usePopMotion();
  const mounted = useSyncExternalStore(
    subscribeToMountedSnapshot,
    getMountedSnapshot,
    getServerMountedSnapshot,
  );
  const [clamped, setClamped] = useState(position);
  const { top: posTop, left: posLeft } = position;

  // Re-clamp the requested position against the surface's measured size so it
  // stays on-screen on narrow viewports. `offsetWidth/Height` ignore the pop
  // motion's scale transform, so the measurement reflects the final box.
  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const el = ref.current;
    if (
      !clampToViewport ||
      el === null ||
      (posLeft <= OFFSCREEN_SENTINEL && posTop <= OFFSCREEN_SENTINEL)
    ) {
      setClamped((prev) =>
        prev.top === posTop && prev.left === posLeft
          ? prev
          : { top: posTop, left: posLeft },
      );
      return;
    }
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const maxLeft = Math.max(
      VIEWPORT_INSET,
      window.innerWidth - width - VIEWPORT_INSET,
    );
    const maxTop = Math.max(
      VIEWPORT_INSET,
      window.innerHeight - height - VIEWPORT_INSET,
    );
    const left = Math.min(Math.max(posLeft, VIEWPORT_INSET), maxLeft);
    const top = Math.min(Math.max(posTop, VIEWPORT_INSET), maxTop);
    setClamped((prev) =>
      prev.top === top && prev.left === left ? prev : { top, left },
    );
  }, [open, clampToViewport, posTop, posLeft]);

  useEffect(() => {
    if (!open || !closeOnClickAway) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const insideSurface = ref.current?.contains(target) ?? false;
      const insideIgnored =
        clickAwayIgnoreRef?.current?.contains(target) ?? false;
      if (!insideSurface && !insideIgnored) {
        onClose?.();
      }
    };
    const capture = clickAwayIgnoreRef !== undefined;
    document.addEventListener("mousedown", onPointerDown, capture);
    return () =>
      document.removeEventListener("mousedown", onPointerDown, capture);
  }, [open, closeOnClickAway, clickAwayIgnoreRef, onClose]);

  useEffect(() => {
    if (!open || !closeOnEscape) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose?.();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, closeOnEscape, onClose]);

  if (!mounted) {
    return null;
  }

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          ref={ref}
          data-floating-panel="true"
          role={role}
          aria-label={ariaLabel}
          onMouseDown={
            keepSelection ? (event) => event.preventDefault() : undefined
          }
          onPointerMove={(event) => event.stopPropagation()}
          onMouseMove={(event) => event.stopPropagation()}
          initial={popMotion.initial}
          animate={popMotion.animate}
          exit={popMotion.exit}
          transition={popMotion.transition}
          style={{ top: clamped.top, left: clamped.left, ...style }}
          className={cx(
            "fixed border",
            UI_LAYER[layer],
            SURFACE_BASE,
            RADIUS[radius],
            ELEVATION[elevation],
            className,
          )}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
