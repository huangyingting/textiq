"use client";

/**
 * React context that carries the active locale and a setter through the
 * client-component tree.
 *
 * `LocaleProvider` is rendered once in the root layout (inside `<Providers>`).
 * It seeds the context from the `initialLocale` prop (which the RSC layout reads
 * from the cookie) so there is no hydration mismatch.
 *
 * `useLocale()` returns the active locale.
 * `useTranslation()` returns a bound `t()` for the active locale.
 */

import {
  createContext,
  useContext,
  useOptimistic,
  type ReactNode,
} from "react";

import {
  createTranslator,
  DEFAULT_LOCALE,
  type Locale,
  type Translator,
} from "./index";

type LocaleContextValue = {
  locale: Locale;
  setLocaleOptimistic: (next: Locale) => void;
};

const LocaleContext = createContext<LocaleContextValue>({
  locale: DEFAULT_LOCALE,
  setLocaleOptimistic: () => {},
});

export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  // useOptimistic mirrors the cookie-driven server locale but updates instantly
  // when the user picks a new language — before the full router refresh.
  const [locale, setLocaleOptimistic] = useOptimistic(initialLocale);

  return (
    <LocaleContext.Provider value={{ locale, setLocaleOptimistic }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale(): Locale {
  return useContext(LocaleContext).locale;
}

export function useSetLocaleOptimistic(): (next: Locale) => void {
  return useContext(LocaleContext).setLocaleOptimistic;
}

/**
 * Returns a typed `t()` translator bound to the currently active locale.
 */
export function useTranslation(): Translator {
  const { locale } = useContext(LocaleContext);
  return createTranslator(locale);
}
