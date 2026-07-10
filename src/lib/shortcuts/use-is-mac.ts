"use client";

import { useMemo } from "react";

type NavigatorWithUACH = Navigator & {
  userAgentData?: { platform?: string };
};

/**
 * Pure platform detector used by both production code and tests.
 * Returns true when the platform string indicates macOS or an Apple mobile
 * device (iPhone, iPad, iPod).
 *
 * Priority order:
 * 1. `navigator.userAgentData.platform` (UACH)
 * 2. `navigator.platform` (legacy)
 * 3. `navigator.userAgent` (fallback)
 *
 * Returns false when `navigator` is undefined (SSR).
 */
export function detectIsMacPlatform(
  nav: typeof navigator | undefined,
): boolean {
  if (nav === undefined) {
    return false;
  }
  const platform =
    (nav as NavigatorWithUACH).userAgentData?.platform ??
    nav.platform ??
    nav.userAgent;
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/**
 * React hook — returns true on macOS/iOS, false on all other platforms and
 * during SSR. Memoised once per component mount; no effects or listeners.
 */
export function useIsMac(): boolean {
  return useMemo(
    () =>
      detectIsMacPlatform(
        typeof navigator === "undefined" ? undefined : navigator,
      ),
    [],
  );
}
