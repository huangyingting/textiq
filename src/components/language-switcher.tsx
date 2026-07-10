"use client";

/**
 * Language switcher button rendered in the site header.
 *
 * On selection, it:
 *  1. Calls the `setLocaleCookie` server action to persist the new locale.
 *  2. Calls `setLocaleOptimistic` so the UI updates instantly (no flash).
 *  3. Calls `router.refresh()` to re-render the RSC tree with the new locale
 *     (updates `<html lang>` and all server-rendered translated strings).
 */

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { MENU_CHROME, MENU_ITEM, cx } from "@/components/ui";
import { SUPPORTED_LOCALES, type Locale } from "@/lib/i18n";
import { setLocaleCookie } from "@/lib/i18n/actions";
import {
  useLocale,
  useSetLocaleOptimistic,
  useTranslation,
} from "@/lib/i18n/locale-context";

const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  es: "Español",
};

export function LanguageSwitcher() {
  const router = useRouter();
  const locale = useLocale();
  const setLocaleOptimistic = useSetLocaleOptimistic();
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const menuRef = useRef<HTMLDivElement>(null);

  const switchTo = (next: Locale) => {
    if (next === locale) {
      setOpen(false);
      return;
    }
    setLocaleOptimistic(next);
    setOpen(false);
    startTransition(async () => {
      await setLocaleCookie(next);
      router.refresh();
    });
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${t("languageSwitcher.label")}: ${LOCALE_LABELS[locale]}`}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-medium text-ds-text-secondary transition hover:bg-ds-surface-sunken hover:text-ds-text-primary"
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
            onClick={() => setOpen(false)}
          />
          <ul
            role="listbox"
            aria-label={t("languageSwitcher.selectLanguage")}
            className={cx(
              "absolute right-0 z-dropdown mt-1 min-w-[9rem]",
              MENU_CHROME,
            )}
          >
            {SUPPORTED_LOCALES.map((loc) => (
              <li key={loc} role="option" aria-selected={loc === locale}>
                <button
                  type="button"
                  onClick={() => switchTo(loc)}
                  className={cx(
                    MENU_ITEM,
                    "gap-2 px-4",
                    loc === locale
                      ? "font-medium text-ds-accent hover:text-ds-accent"
                      : undefined,
                  )}
                >
                  {LOCALE_LABELS[loc]}
                  {loc === locale && (
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
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
