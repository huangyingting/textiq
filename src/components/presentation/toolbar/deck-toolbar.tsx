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
      className="flex h-10 shrink-0 items-center justify-between gap-1 border-b border-ds-border-subtle bg-ds-surface-chrome px-2 py-1 backdrop-blur"
    >
      {children}
    </header>
  );
}

export function DeckToolbarRow({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-px overflow-x-auto overflow-y-hidden overscroll-x-contain whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
      className={cx("flex shrink-0 items-center gap-px", className)}
    >
      {children}
    </div>
  );
}

export function DeckToolbarDivider() {
  return (
    <div
      aria-hidden="true"
      className="mx-[3px] h-3.5 w-px shrink-0 bg-ds-border-subtle opacity-70"
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
          "flex h-[26px] shrink-0 items-center gap-1 rounded-ds-sm px-1.5 text-[11px] font-medium transition-colors disabled:opacity-40",
          active === true
            ? "bg-ds-accent-surface text-ds-accent-text"
            : "bg-transparent text-ds-text-secondary hover:bg-ds-state-hover hover:text-ds-text-primary",
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
          "flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-ds-sm text-ds-text-muted transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary disabled:opacity-40",
          active === true
            ? "bg-ds-accent-surface text-ds-accent-text"
            : "bg-transparent",
          FOCUS_RING,
          className,
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}
