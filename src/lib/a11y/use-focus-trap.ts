"use client";

import { useEffect, useRef } from "react";

import { getTabbableElements } from "./tabbable";

/**
 * Traps keyboard focus inside `containerRef` while it is mounted.
 *
 * - On mount, moves focus to the first focusable descendant (or the container
 *   itself when nothing is focusable) so screen readers announce the region.
 * - Tab / Shift-Tab wrap within the container.
 * - On unmount, restores focus to the element that was focused before the
 *   trap was installed.
 *
 * DOM-only — no external dependencies.
 */
export function installFocusTrap(
  trap: HTMLElement,
  getPreviousFocus: () => Element | null,
): () => void {
  const previousFocus = getPreviousFocus();

  // Move focus into the container.
  (getTabbableElements(trap)[0] ?? trap).focus();

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key !== "Tab") return;
    const els = getTabbableElements(trap);
    if (els.length === 0) {
      event.preventDefault();
      return;
    }
    const first = els[0];
    const last = els[els.length - 1];
    if (event.shiftKey) {
      if (document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  trap.addEventListener("keydown", handleKeyDown);
  return () => {
    trap.removeEventListener("keydown", handleKeyDown);
    if (previousFocus instanceof HTMLElement) {
      previousFocus.focus();
    }
  };
}

export function useFocusTrap(
  containerRef: React.RefObject<HTMLElement | null>,
) {
  const previousFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    const trap = containerRef.current;
    if (!trap) return;

    return installFocusTrap(trap, () => {
      previousFocusRef.current = document.activeElement;
      return previousFocusRef.current;
    });
  }, [containerRef]);
}
