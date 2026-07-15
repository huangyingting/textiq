"use server";

import { cookies } from "next/headers";

import { normaliseLocale } from "@/lib/i18n";
import { LOCALE_COOKIE, LOCALE_COOKIE_OPTIONS } from "@/lib/i18n/preferences";

/**
 * Server action that persists the user's locale preference in a cookie so the
 * RSC layout can read it on the next render (via `getLocale()` in `server.ts`).
 */
export async function setLocaleCookie(locale: unknown): Promise<void> {
  const normalised = normaliseLocale(locale);
  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, normalised, LOCALE_COOKIE_OPTIONS);
}
