"use client";

import type { ReactNode, RefObject } from "react";

import { ModalSurface } from "./overlay-stack";

export type DialogProps = {
  /** Controls visibility. The caller owns the open/close state. */
  open: boolean;
  /** Called when the dialog requests close (Escape or backdrop click). */
  onClose: () => void;
  /**
   * `id` of the heading element that labels this dialog. Forwarded as
   * `aria-labelledby` on the dialog panel.
   */
  "aria-labelledby"?: string;
  /**
   * Reflects whether the dialog's content is busy (e.g. an in-flight async
   * action). Forwarded to the panel as `aria-busy`.
   */
  "aria-busy"?: boolean;
  children: ReactNode;
  /** Extra classes applied to the dialog panel (e.g. `max-w-sm`). */
  className?: string;
  /** Extra classes applied to the full-viewport positioning container. */
  containerClassName?: string;
  /** Explicit focus target used when an asynchronously opened dialog closes. */
  restoreFocusRef?: RefObject<HTMLElement | null>;
};

/**
 * Accessible modal dialog primitive backed by the shared overlay stack:
 * portal-to-body, focus trap/restore, body lock, Escape ordering, and DS z
 * layers.
 */
export function Dialog({
  open,
  onClose,
  "aria-labelledby": labelledBy,
  "aria-busy": busy,
  children,
  className,
  containerClassName,
  restoreFocusRef,
}: DialogProps) {
  return (
    <ModalSurface
      open={open}
      onClose={onClose}
      aria-labelledby={labelledBy}
      aria-busy={busy}
      className={className}
      containerClassName={containerClassName}
      restoreFocusRef={restoreFocusRef}
    >
      {children}
    </ModalSurface>
  );
}
