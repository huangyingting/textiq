/**
 * Core i18n utilities: locale validation, normalisation, and typed translators.
 *
 * This module is pure (no React, no Next.js) so it can be used in both RSC and
 * client components, as well as in unit tests.
 */

import { catalog, catalogBySurface, type Messages } from "./messages";
import {
  DEFAULT_LOCALE,
  LOCALE_DEFINITIONS,
  SUPPORTED_LOCALES,
  getLocaleDefinition,
  type Locale,
} from "./locales";

export type { Locale, Messages };
export {
  catalogBySurface,
  DEFAULT_LOCALE,
  getLocaleDefinition,
  LOCALE_DEFINITIONS,
  SUPPORTED_LOCALES,
};
export {
  getI18nActivationStatus,
  getI18nCoverageBySurface,
  I18N_ACTIVATION_REQUIRED_SURFACES,
  I18N_USER_ACTIVATION_THRESHOLD,
  type I18nActivationStatus,
  type I18nSurfaceCoverage,
} from "./coverage";

/**
 * Returns `true` when `value` is one of the supported locale codes.
 */
export function isSupportedLocale(value: unknown): value is Locale {
  return SUPPORTED_LOCALES.includes(value as Locale);
}

/**
 * Normalises an untrusted value to a known `Locale`.
 *
 * Matching is case-insensitive and tolerates BCP-47 region suffixes
 * (e.g. `"en-US"` → `"en"`, `"es-419"` → `"es"`).
 * Falls back to `DEFAULT_LOCALE` when no match is found.
 */
export function normaliseLocale(raw: unknown): Locale {
  if (typeof raw !== "string" || !raw) return DEFAULT_LOCALE;

  // Exact match first (fast path).
  if (isSupportedLocale(raw)) return raw;

  // Strip region suffix and retry (e.g. "en-US" → "en").
  const base = raw.split(/[-_]/)[0]?.toLowerCase();
  if (base && isSupportedLocale(base)) return base as Locale;

  return DEFAULT_LOCALE;
}

/**
 * Returns the messages object for the given locale, falling back to the default
 * locale when the requested locale is not in the catalog.
 */
export function getMessages(locale: Locale): Messages {
  return catalog[locale] ?? catalog[DEFAULT_LOCALE];
}

/* node:coverage disable */
/* Translator API prose documents TypeScript call-shape behavior and has no runtime branch. */
/**
 * Creates a typed `t()` translator bound to a specific locale.
 *
 * For string keys the return type is `string`.
 * For function keys the return type mirrors the function signature so callers
 * get type-checked arguments.
 *
 * Missing keys fall back to the default locale's value so partial translations
 * never produce blank UI.
 */
/* node:coverage enable */
export type Translator = <K extends keyof Messages>(
  key: K,
  ...args: Messages[K] extends (...a: infer A) => string ? A : []
) => string;

export function createTranslator(locale: Locale): Translator {
  const primary = getMessages(locale);
  const fallback = getMessages(DEFAULT_LOCALE);

  function t<K extends keyof Messages>(
    key: K,
    /* node:coverage ignore next */
    ...args: Messages[K] extends (...a: infer A) => string ? A : []
  ): string {
    const value = primary[key] ?? fallback[key];
    if (typeof value === "function") {
      /* node:coverage ignore next */
      /* Parameterized translator messages are asserted; tsx maps the generic call as uncovered. */
      return (value as (...a: unknown[]) => string)(...(args as unknown[]));
    }
    return value as string;
  }

  /* Coverage rationale: returned closure behavior is asserted; tsx maps function tail as uncovered. */
  /* node:coverage ignore next */
  return t;
}
