"use client";

import { CreditCard, LogOut, Settings } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { FOCUS_RING, MENU_CHROME, cx } from "@/components/ui";
import {
  getMenuCommandItems,
  getNextMenuCommandIndex,
  isMenuCommandNavigationKey,
} from "@/lib/a11y/menu-command-semantics";

export const USER_MENU_ITEM_CLASS = cx(
  "flex w-full items-center gap-2 rounded-ds-sm px-2 py-1.5 text-left text-sm font-medium transition-colors",
  "text-ds-text-secondary hover:bg-ds-state-hover hover:text-ds-text-primary",
  FOCUS_RING,
);

export function UserMenuItemIcon({
  type,
}: {
  type: "settings" | "billing" | "sign-out";
}) {
  const Icon =
    type === "settings" ? Settings : type === "billing" ? CreditCard : LogOut;

  return <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />;
}

/**
 * The header user menu: a dropdown showing the current user's name + email with
 * a link to account settings and a sign-out control (passed as `children` so the
 * sign-out server action stays in a server component).
 *
 * Uses the ref-containment click-outside pattern (per AGENTS.md): the toggle and
 * dropdown are both wrapped in `menuRef`, and a document listener closes the menu
 * only for clicks outside that container — no `stopPropagation`, which is
 * unreliable under the App Router's delegated events.
 */
export function UserMenu({
  name,
  email,
  children,
}: {
  name: string | null;
  email: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const triggerId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const menuPopupRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const initialFocusRef = useRef<"first" | "last">("first");

  const trimmedName = name?.trim() ?? "";
  const displayName = trimmedName || email;

  useEffect(() => {
    if (!open) {
      return;
    }
    const items = getMenuCommandItems(menuPopupRef.current);
    const initialItem =
      initialFocusRef.current === "last" ? items.at(-1) : items[0];
    initialItem?.focus();

    const onDocClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [open]);

  return (
    <div
      ref={menuRef}
      className="relative"
      onKeyDown={(event) => {
        if (!open) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          triggerRef.current?.focus();
          return;
        }
        if (event.key === "Tab") {
          setOpen(false);
          return;
        }
        if (!isMenuCommandNavigationKey(event.key)) return;

        const items = getMenuCommandItems(menuPopupRef.current);
        if (items.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        const currentIndex = items.indexOf(
          document.activeElement as HTMLElement,
        );
        const nextIndex = getNextMenuCommandIndex(
          event.key,
          currentIndex,
          items.length,
        );
        items[nextIndex]?.focus();
      }}
    >
      <button
        id={triggerId}
        ref={triggerRef}
        type="button"
        aria-label="User menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          event.stopPropagation();
          initialFocusRef.current = event.key === "ArrowUp" ? "last" : "first";
          if (open) {
            const items = getMenuCommandItems(menuPopupRef.current);
            const item =
              initialFocusRef.current === "last" ? items.at(-1) : items[0];
            item?.focus();
          } else {
            setOpen(true);
          }
        }}
        onClick={() => {
          if (open) {
            setOpen(false);
          } else {
            initialFocusRef.current = "first";
            setOpen(true);
          }
        }}
        className="flex h-9 max-w-[12rem] items-center gap-2 rounded-full border border-ds-border-strong p-1 text-sm font-medium text-ds-text-secondary transition hover:bg-ds-surface-sunken hover:text-ds-text-primary sm:pr-3"
      >
        <span
          aria-hidden="true"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ds-accent text-xs font-semibold text-ds-text-on-accent"
        >
          {displayName.charAt(0).toUpperCase() || "?"}
        </span>
        <span className="hidden truncate sm:inline">{displayName}</span>
      </button>

      {open ? (
        <div
          ref={menuPopupRef}
          role="menu"
          aria-labelledby={triggerId}
          onClick={(event) => {
            const target = event.target as HTMLElement;
            if (target.closest?.('[role="menuitem"]')) setOpen(false);
          }}
          className={cx(
            "absolute right-0 top-full z-dropdown mt-2 w-44 p-1",
            MENU_CHROME,
          )}
        >
          <Link
            href="/app/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className={USER_MENU_ITEM_CLASS}
          >
            <UserMenuItemIcon type="settings" />
            Settings
          </Link>
          {children}
        </div>
      ) : null}
    </div>
  );
}
