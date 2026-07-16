/**
 * Server-side locale utilities for the Next.js App Router.
 *
 * Reads the preferred locale from the `textiq-locale` cookie (set by the
 * language-switcher client component) and exposes a `getLocale()` helper for
 * RSC layouts and pages.
 *
 * This module must only be imported in server components / route handlers —
 * it uses `next/headers` which is not available in client bundles.
 */

import "server-only";

import { cookies } from "next/headers";

import { normaliseLocale, type Locale } from "./index";
import { LOCALE_COOKIE } from "./preferences";

/**
 * Returns the current locale for the incoming request.
 *
 * Priority: `textiq-locale` cookie → default locale.
 */
export async function getLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(LOCALE_COOKIE)?.value;
  return normaliseLocale(raw);
}
