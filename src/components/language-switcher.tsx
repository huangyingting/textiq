"use client";

/**
 * Language switcher button rendered in the site header.
 *
 * On selection, it:
 *  1. Calls `setLocaleOptimistic` inside a transition so the UI updates instantly.
 *  2. Calls the `setLocaleCookie` server action to persist the new locale.
 *  3. Calls `router.refresh()` to re-render the RSC tree with the new locale
 *     (updates `<html lang>` and all server-rendered translated strings).
 */

import { unstable_rethrow, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { FOCUS_RING, MENU_CHROME, MENU_ITEM, cx } from "@/components/ui";
import type { ActionResult } from "@/lib/action-result";
import {
  LOCALE_DEFINITIONS,
  getLocaleDefinition,
  type Locale,
} from "@/lib/i18n";
import { setLocaleCookie } from "@/lib/i18n/actions";
import {
  useLocale,
  useSetLocaleOptimistic,
  useTranslation,
} from "@/lib/i18n/locale-context";

export async function resolveLocalePersistence(
  persist: () => Promise<ActionResult>,
  fallbackError: string,
): Promise<ActionResult> {
  try {
    return await persist();
  } catch (caughtError) {
    unstable_rethrow(caughtError);
    return { ok: false, error: fallbackError };
  }
}

export function LanguageSwitcher() {
  const router = useRouter();
  const locale = useLocale();
  const setLocaleOptimistic = useSetLocaleOptimistic();
  const t = useTranslation();
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(
      0,
      LOCALE_DEFINITIONS.findIndex(
        (definition) => definition.locale === locale,
      ),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [pendingLocale, setPendingLocale] = useState<Locale | null>(null);
  const [isPending, startTransition] = useTransition();
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const inFlightLocaleRef = useRef<Locale | null>(null);
  const busy = pendingLocale !== null || isPending;

  const closeMenu = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) {
      triggerRef.current?.focus();
    }
  };

  const openMenu = () => {
    if (inFlightLocaleRef.current) return;
    setActiveIndex(
      Math.max(
        0,
        LOCALE_DEFINITIONS.findIndex(
          (definition) => definition.locale === locale,
        ),
      ),
    );
    setError(null);
    setOpen(true);
  };

  useEffect(() => {
    if (open) {
      listboxRef.current?.focus();
    }
  }, [open]);

  const switchTo = (next: Locale) => {
    if (inFlightLocaleRef.current || next === locale) {
      closeMenu(true);
      return;
    }
    const confirmedLocale = locale;
    inFlightLocaleRef.current = next;
    setPendingLocale(next);
    closeMenu(true);
    setError(null);
    startTransition(async () => {
      try {
        setLocaleOptimistic(next);
        const result = await resolveLocalePersistence(
          () => setLocaleCookie(next),
          t("languageSwitcher.persistenceError"),
        );
        if (!result.ok) {
          setLocaleOptimistic(confirmedLocale);
          setError(result.error);
          return;
        }
        router.refresh();
      } finally {
        inFlightLocaleRef.current = null;
        setPendingLocale(null);
      }
    });
  };

  const moveActive = (delta: 1 | -1) => {
    setActiveIndex(
      (current) =>
        (current + delta + LOCALE_DEFINITIONS.length) %
        LOCALE_DEFINITIONS.length,
    );
  };

  return (
    <div
      ref={menuRef}
      className="relative"
      onBlur={(event) => {
        if (!menuRef.current?.contains(event.relatedTarget)) {
          closeMenu();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-busy={busy || undefined}
        aria-label={`${t("languageSwitcher.label")}: ${getLocaleDefinition(locale).displayName}`}
        disabled={busy}
        onClick={() => {
          if (open) {
            closeMenu();
          } else {
            openMenu();
          }
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          openMenu();
          if (event.key === "ArrowUp") {
            moveActive(-1);
          }
        }}
        className={cx(
          "flex h-9 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-medium text-ds-text-secondary transition hover:bg-ds-surface-sunken hover:text-ds-text-primary disabled:cursor-wait disabled:opacity-60",
          FOCUS_RING,
        )}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4 shrink-0"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
        <span>{locale.toUpperCase()}</span>
      </button>

      {open && (
        <>
          {/* Invisible backdrop to close on outside click */}
          <div
            className="fixed inset-0 z-dropdown"
            aria-hidden="true"
            onClick={() => closeMenu(true)}
          />
          <ul
            ref={listboxRef}
            id={listboxId}
            role="listbox"
            tabIndex={-1}
            aria-label={t("languageSwitcher.selectLanguage")}
            aria-activedescendant={`${listboxId}-${LOCALE_DEFINITIONS[activeIndex]?.locale ?? locale}`}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                closeMenu(true);
                return;
              }
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                moveActive(event.key === "ArrowDown" ? 1 : -1);
                return;
              }
              if (event.key === "Home" || event.key === "End") {
                event.preventDefault();
                setActiveIndex(
                  event.key === "Home" ? 0 : LOCALE_DEFINITIONS.length - 1,
                );
                return;
              }
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                const active = LOCALE_DEFINITIONS[activeIndex];
                if (active) switchTo(active.locale);
              }
            }}
            className={cx(
              "absolute right-0 z-dropdown mt-1 min-w-[9rem] outline-none",
              MENU_CHROME,
            )}
          >
            {LOCALE_DEFINITIONS.map(
              ({ locale: option, displayName }, index) => (
                <li
                  key={option}
                  id={`${listboxId}-${option}`}
                  role="option"
                  aria-selected={option === locale}
                  onPointerMove={() => setActiveIndex(index)}
                  onClick={() => switchTo(option)}
                  className={cx(
                    MENU_ITEM,
                    "cursor-pointer gap-2 px-4",
                    index === activeIndex ? "bg-ds-state-hover" : undefined,
                    option === locale
                      ? "font-medium text-ds-accent hover:text-ds-accent"
                      : undefined,
                  )}
                >
                  {displayName}
                  {option === locale && (
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="ml-auto h-3.5 w-3.5"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </li>
              ),
            )}
          </ul>
        </>
      )}

      {error ? (
        <div
          role="alert"
          className="absolute right-0 top-full z-dropdown mt-2 flex w-64 items-start gap-2 rounded-ds-md border border-ds-danger-border bg-ds-danger-surface px-3 py-2 text-xs text-ds-danger-text shadow-ds-overlay"
        >
          <span className="min-w-0 flex-1">{error}</span>
          <button
            type="button"
            aria-label={t("languageSwitcher.dismissError")}
            onClick={() => setError(null)}
            className={cx(
              "-mr-1 -mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-ds-sm hover:bg-ds-danger-border/30",
              FOCUS_RING,
            )}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="h-3.5 w-3.5"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      ) : null}
    </div>
  );
}
