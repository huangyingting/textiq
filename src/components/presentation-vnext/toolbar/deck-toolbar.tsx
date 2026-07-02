"use client";

import { type ReactNode } from "react";

import { Tooltip } from "@/components/ui/tooltip";
import { cx, FOCUS_RING } from "@/components/ui/tokens";

export function DeckToolbar({ children }: { children: ReactNode }) {
  return (
    <header
      role="toolbar"
      aria-label="Deck tools"
      data-slide-editor-chrome="true"
      className="flex shrink-0 items-center justify-between gap-3 border-b border-ds-border-subtle bg-ds-surface-chrome px-3 py-2 backdrop-blur"
    >
      {children}
    </header>
  );
}

export function DeckToolbarRow({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto overflow-y-hidden overscroll-x-contain whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {children}
    </div>
  );
}

export function DeckToolbarGroup({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cx("flex shrink-0 items-center gap-1.5", className)}
    >
      {children}
    </div>
  );
}

export function DeckToolbarDivider() {
  return (
    <div
      aria-hidden="true"
      className="mx-1 hidden h-5 w-px shrink-0 bg-ds-border-subtle sm:block"
    />
  );
}

export function DeckToolbarButton({
  label,
  tooltip = label,
  active,
  disabled = false,
  onClick,
  children,
  className,
  hasPopup,
  expanded,
  controls,
}: {
  label: string;
  tooltip?: ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
  hasPopup?: "menu" | "dialog";
  expanded?: boolean;
  controls?: string;
}) {
  return (
    <Tooltip label={tooltip} side="bottom">
      <button
        type="button"
        aria-label={label}
        aria-pressed={active === undefined ? undefined : active}
        aria-haspopup={hasPopup}
        aria-expanded={hasPopup ? expanded : undefined}
        aria-controls={controls}
        disabled={disabled}
        onClick={onClick}
        className={cx(
          "flex h-8 shrink-0 items-center gap-1.5 rounded-ds-sm border px-2.5 text-xs font-medium transition-colors disabled:opacity-40",
          active === true
            ? "border-ds-accent-border bg-ds-accent-surface text-ds-accent-text"
            : "border-ds-border-subtle bg-ds-surface text-ds-text-primary hover:bg-ds-state-hover",
          FOCUS_RING,
          className,
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export function DeckToolbarIconButton({
  label,
  tooltip = label,
  active,
  disabled = false,
  onClick,
  children,
  className,
  hasPopup,
  expanded,
  controls,
}: {
  label: string;
  tooltip?: ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
  hasPopup?: "menu" | "dialog";
  expanded?: boolean;
  controls?: string;
}) {
  return (
    <Tooltip label={tooltip} side="bottom">
      <button
        type="button"
        aria-label={label}
        aria-pressed={active === undefined ? undefined : active}
        aria-haspopup={hasPopup}
        aria-expanded={hasPopup ? expanded : undefined}
        aria-controls={controls}
        disabled={disabled}
        onClick={onClick}
        className={cx(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-ds-md border text-ds-text-muted transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary disabled:opacity-40",
          active === true
            ? "border-ds-accent-border bg-ds-accent-surface text-ds-accent-text"
            : "border-ds-border-subtle bg-ds-surface",
          FOCUS_RING,
          className,
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}
