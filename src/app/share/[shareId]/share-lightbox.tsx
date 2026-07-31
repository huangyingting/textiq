"use client";

import { motion } from "framer-motion";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { usePopMotion } from "@/components/motion/reveal";

/**
 * Click-to-zoom lightbox for the read-only share view (US-031).
 *
 * It wraps the rendered document content and, via event delegation, turns every
 * rendered visual (`<svg role="img">`, the output of {@link VisualRenderer})
 * into a zoomable, keyboard-focusable trigger. Clicking (or pressing
 * Enter/Space on) a visual opens a full-screen overlay showing an enlarged clone
 * of that exact SVG — no re-render, no HTML injection.
 *
 * The overlay closes on backdrop click, an explicit close button, and Escape. It
 * traps focus while open and restores focus to the trigger on close. Dismissal
 * uses the ref-containment pattern (never `stopPropagation`), and motion
 * collapses to a no-op when the user prefers reduced motion.
 *
 * This component is used only on `/share/[shareId]`, never on `/embed`.
 */
export function ShareLightbox({ children }: { children: ReactNode }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const cloneHostRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const [active, setActive] = useState<{
    svg: SVGSVGElement;
    label: string;
  } | null>(null);

  const popMotion = usePopMotion();

  // Enhance each rendered visual into a zoomable, keyboard-focusable trigger.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }
    const svgs = wrapper.querySelectorAll<SVGSVGElement>(
      'svg[role="img"], svg[data-zoomable="true"]',
    );
    svgs.forEach((svg) => {
      const label =
        svg.dataset.zoomLabel ?? svg.getAttribute("aria-label") ?? "Visual";
      svg.dataset.zoomLabel = label;
      svg.dataset.zoomable = "true";
      svg.setAttribute("role", "button");
      svg.setAttribute("tabindex", "0");
      svg.setAttribute("aria-label", `${label} — enlarge visual`);
      svg.setAttribute("aria-haspopup", "dialog");
      svg.setAttribute("aria-expanded", "false");
      svg.style.cursor = "zoom-in";
    });
  }, [children]);

  const openFor = useCallback((svg: SVGSVGElement) => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const label = svg.dataset.zoomLabel ?? "Visual";
    setActive({ svg, label });
  }, []);

  const close = useCallback(() => {
    setActive(null);
  }, []);

  const findZoomable = useCallback((target: EventTarget | null) => {
    if (!(target instanceof Element)) {
      return null;
    }
    return target.closest<SVGSVGElement>('svg[data-zoomable="true"]');
  }, []);

  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const svg = findZoomable(event.target);
      if (svg) {
        openFor(svg);
      }
    },
    [findZoomable, openFor],
  );

  const handleTriggerKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      const svg = findZoomable(event.target);
      if (svg) {
        event.preventDefault();
        openFor(svg);
      }
    },
    [findZoomable, openFor],
  );

  // Clone the clicked SVG into the overlay (avoids a re-render and any HTML
  // injection surface), lock background scroll, manage focus.
  useEffect(() => {
    if (!active) {
      return;
    }
    active.svg.setAttribute("aria-expanded", "true");
    const host = cloneHostRef.current;
    if (host) {
      const clone = active.svg.cloneNode(true) as SVGSVGElement;
      clone.removeAttribute("tabindex");
      clone.removeAttribute("data-zoomable");
      clone.removeAttribute("data-zoom-label");
      clone.removeAttribute("aria-haspopup");
      clone.removeAttribute("aria-expanded");
      clone.setAttribute("role", "img");
      clone.setAttribute("aria-label", active.label);
      clone.style.cursor = "";
      clone.style.width = "100%";
      clone.style.height = "100%";
      host.replaceChildren(clone);
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    closeButtonRef.current?.focus();

    return () => {
      active.svg.setAttribute("aria-expanded", "false");
      document.body.style.overflow = previousOverflow;
      if (host) {
        host.replaceChildren();
      }
      const toRestore = restoreFocusRef.current;
      restoreFocusRef.current = null;
      if (toRestore && typeof toRestore.focus === "function") {
        toRestore.focus();
      }
    };
  }, [active]);

  // Backdrop dismissal via ref-containment (never stopPropagation): a click that
  // does not land inside the dialog panel closes the overlay.
  const handleBackdropMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(event.target as Node)
      ) {
        close();
      }
    },
    [close],
  );

  // Escape closes; Tab cycles focus within the panel (focus trap).
  const handleOverlayKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const panel = panelRef.current;
      if (!panel) {
        return;
      }
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute("disabled"));
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const activeEl = document.activeElement;
      if (!panel.contains(activeEl)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && activeEl === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeEl === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [close],
  );

  return (
    <div
      ref={wrapperRef}
      onClick={handleClick}
      onKeyDown={handleTriggerKeyDown}
    >
      {children}
      {active
        ? createPortal(
            <motion.div
              key="share-lightbox"
              className="fixed inset-0 z-modal flex items-center justify-center overflow-hidden bg-ds-backdrop-strong p-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={popMotion.transition}
              onMouseDown={handleBackdropMouseDown}
              onKeyDown={handleOverlayKeyDown}
            >
              <motion.div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-label={`${active.label} — enlarged`}
                className="relative flex h-[85vh] w-[min(92vw,1100px)] items-center justify-center rounded-lg bg-ds-surface-overlay p-4 shadow-ds-popover"
                initial={popMotion.initial}
                animate={popMotion.animate}
                transition={popMotion.transition}
              >
                <button
                  ref={closeButtonRef}
                  type="button"
                  onClick={close}
                  aria-label="Close enlarged visual"
                  className="absolute right-2 top-2 z-raised inline-flex h-9 w-9 items-center justify-center rounded-full border border-ds-border-subtle bg-ds-surface-raised text-ds-text-secondary shadow-sm transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus-ring"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
                <div
                  ref={cloneHostRef}
                  aria-hidden="true"
                  className="flex h-full w-full items-center justify-center"
                />
              </motion.div>
            </motion.div>,
            document.body,
          )
        : null}
    </div>
  );
}
