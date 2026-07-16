"use server";

import { cookies } from "next/headers";

import { actionError, actionOk, type ActionResult } from "@/lib/action-result";
import { isSupportedLocale } from "@/lib/i18n";
import { LOCALE_COOKIE, LOCALE_COOKIE_OPTIONS } from "@/lib/i18n/preferences";

const INVALID_LOCALE_ERROR = "Invalid language selection.";
const LOCALE_PERSISTENCE_ERROR =
  "Unable to save your language preference. Please try again.";

/**
 * Server action that persists the user's locale preference in a cookie so the
 * RSC layout can read it on the next render (via `getLocale()` in `server.ts`).
 */
export async function setLocaleCookie(locale: unknown): Promise<ActionResult> {
  if (!isSupportedLocale(locale)) {
    return actionError(INVALID_LOCALE_ERROR);
  }

  try {
    const cookieStore = await cookies();
    cookieStore.set(LOCALE_COOKIE, locale, LOCALE_COOKIE_OPTIONS);
  } catch {
    return actionError(LOCALE_PERSISTENCE_ERROR);
  }

  return actionOk();
}
