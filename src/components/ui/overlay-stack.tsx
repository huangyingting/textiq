"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { DURATION, EASE } from "@/components/motion/tokens";
import { useReducedMotion } from "@/components/motion/use-reduced-motion";

import { getTabbableElements, nextFocusIndex } from "@/lib/a11y/tabbable";
import { cx, ELEVATION, RADIUS, SURFACE_BASE } from "./tokens";

type OverlayEntry = {
  id: string;
  onEscape?: () => void;
};

type OverlayStackContextValue = {
  register(entry: OverlayEntry): () => void;
  topId: string | null;
};

const OverlayStackContext = createContext<OverlayStackContextValue | null>(
  null,
);

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<OverlayEntry[]>([]);
  const topId = stack.at(-1)?.id ?? null;

  const register = useCallback((entry: OverlayEntry) => {
    setStack((current) => [
      ...current.filter((item) => item.id !== entry.id),
      entry,
    ]);
    return () => {
      setStack((current) => current.filter((item) => item.id !== entry.id));
    };
  }, []);

  useEffect(() => {
    if (stack.length === 0) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [stack.length]);

  const value = useMemo<OverlayStackContextValue>(
    () => ({ register, topId }),
    [register, topId],
  );

  return (
    <OverlayStackContext.Provider value={value}>
      {children}
    </OverlayStackContext.Provider>
  );
}

function useOverlayStack(open: boolean, onEscape?: () => void) {
  const explicitId = useId();
  const fallbackId = useRef(`overlay-${explicitId}`);
  const context = useContext(OverlayStackContext);
  const register = context?.register;
  const topId = context?.topId ?? null;
  const onEscapeRef = useRef(onEscape);

  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!open || !register) {
      return;
    }
    return register({ id: fallbackId.current });
  }, [open, register]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if (topId !== null && topId !== fallbackId.current) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onEscapeRef.current?.();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, topId]);
}

function useFocusTrap(open: boolean) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    if (panel) {
      const focusable = getTabbableElements(panel);
      (focusable[0] ?? panel).focus();
    }
    return () => {
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    };
  }, [open]);

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") {
      return;
    }
    const panel = panelRef.current;
    if (!panel) {
      return;
    }
    const focusable = getTabbableElements(panel);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const currentIdx = focusable.indexOf(document.activeElement as HTMLElement);
    const nextIdx = nextFocusIndex(
      focusable.length,
      currentIdx,
      event.shiftKey,
    );
    event.preventDefault();
    focusable[nextIdx]?.focus();
  }, []);

  return { panelRef, onKeyDown };
}

export type OverlaySurfaceProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-busy"?: boolean;
};

export function ModalSurface({
  open,
  onClose,
  children,
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": labelledBy,
  "aria-busy": busy,
}: OverlaySurfaceProps) {
  const reduceMotion = useReducedMotion();
  const { panelRef, onKeyDown } = useFocusTrap(open);
  useOverlayStack(open, onClose);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div
          data-floating-panel="true"
          className="fixed inset-0 z-modal flex items-center justify-center p-4"
        >
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-ds-backdrop"
            onClick={onClose}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            aria-labelledby={labelledBy}
            aria-busy={busy}
            tabIndex={-1}
            initial={
              reduceMotion ? { opacity: 1 } : { opacity: 0, scale: 0.98 }
            }
            animate={{ opacity: 1, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
            transition={{ duration: DURATION.modal, ease: EASE.out }}
            onKeyDown={onKeyDown}
            className={cx(
              "relative z-raised w-full max-w-lg border p-6 outline-none",
              SURFACE_BASE,
              RADIUS.lg,
              ELEVATION.popover,
              className,
            )}
          >
            {children}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

export function DrawerSurface({
  open,
  onClose,
  children,
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": labelledBy,
}: OverlaySurfaceProps) {
  const { panelRef, onKeyDown } = useFocusTrap(open);
  useOverlayStack(open, onClose);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="drawer-backdrop"
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DURATION.backdrop }}
            onClick={onClose}
            className="fixed inset-0 z-overlay bg-ds-backdrop md:hidden"
          />
          <motion.div
            key="drawer-panel"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            aria-labelledby={labelledBy}
            tabIndex={-1}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: DURATION.drawer, ease: EASE.out }}
            onKeyDown={onKeyDown}
            className={cx(
              "tiq-full-viewport fixed right-0 top-0 z-panel flex h-full w-72 max-w-[85vw] flex-col overflow-y-auto border-l border-ds-border-strong bg-ds-surface-base shadow-ds-popover outline-none md:hidden",
              className,
            )}
          >
            {children}
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

export function BottomSheetSurface({
  open,
  onClose,
  children,
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": labelledBy,
}: OverlaySurfaceProps) {
  const reduceMotion = useReducedMotion();
  const { panelRef, onKeyDown } = useFocusTrap(open);
  useOverlayStack(open, onClose);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="bottom-sheet-backdrop"
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DURATION.backdrop }}
            onClick={onClose}
            className="fixed inset-0 z-overlay bg-ds-backdrop"
          />
          <motion.div
            key="bottom-sheet-panel"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            aria-labelledby={labelledBy}
            tabIndex={-1}
            initial={reduceMotion ? { opacity: 1, y: 0 } : { y: "100%" }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0, y: 0 } : { y: "100%" }}
            transition={{ duration: DURATION.sheet, ease: EASE.out }}
            onKeyDown={onKeyDown}
            className={cx(
              "tiq-mobile-sheet fixed bottom-0 left-0 right-0 z-panel flex flex-col overflow-hidden rounded-t-ds-xl border-t border-ds-border-subtle bg-ds-surface-base shadow-ds-popover outline-none",
              className,
            )}
          >
            {children}
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
