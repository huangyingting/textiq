"use client";

import { createPortal } from "react-dom";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function EditorSidePanel({
  label,
  title,
  actions,
  children,
  busy = false,
}: {
  label: string;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  busy?: boolean;
}) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <aside
      role="dialog"
      aria-label={label}
      aria-busy={busy}
      className="fixed inset-y-0 right-0 z-panel flex w-full max-w-md flex-col border-l border-ds-border-subtle bg-ds-surface-overlay shadow-ds-popover"
    >
      <div className="flex items-center justify-between border-b border-ds-border-subtle px-4 py-3">
        <h2 className="text-sm font-semibold text-ds-text-primary">{title}</h2>
        {actions ? (
          <div className="flex items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {children}
    </aside>,
    document.body,
  );
}

export function EditorSidePanelHeaderButton({
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={[
        "rounded-md px-2 py-1 text-xs font-medium text-ds-text-muted transition hover:bg-ds-state-hover hover:text-ds-text-primary disabled:opacity-50",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {children}
    </button>
  );
}
