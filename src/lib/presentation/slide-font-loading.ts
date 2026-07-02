"use client";

import { useEffect, useState } from "react";

import { SLIDE_FONTS } from "@/lib/presentation/slide-fonts";

/**
 * Font-readiness helpers for slide surfaces.
 *
 * The renderer must not finalize fit/shrink layout (or rasterize an export)
 * using a fallback font and then swap to the real self-hosted font, because
 * that changes line breaks, shrink scale, and overflow. These helpers let
 * callers wait until the bundled slide fonts are actually loaded.
 *
 * All functions are browser-safe: in a non-DOM environment (SSR, Node tests)
 * `loadSlideFonts` resolves immediately and `useSlideFontsReady` reports ready.
 */

/** Build the CSS shorthand `document.fonts.load` expects, e.g. `700 16px "Inter"`. */
function fontLoadSpec(
  family: string,
  weight: number,
  style: "normal" | "italic",
): string {
  const stylePrefix = style === "italic" ? "italic " : "";
  return `${stylePrefix}${weight} 16px "${family}"`;
}

/**
 * Load the bundled slide fonts (optionally a subset by id) and resolve once the
 * browser reports them ready. Never rejects — font load failures degrade to the
 * CSS fallback rather than blocking the caller.
 */
export async function loadSlideFonts(
  fontIds?: readonly string[],
): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  const fonts = fontIds
    ? SLIDE_FONTS.filter((f) => fontIds.includes(f.id))
    : SLIDE_FONTS;
  const loads: Promise<unknown>[] = [];
  for (const font of fonts) {
    for (const asset of font.assets) {
      /* node:coverage disable */
      /* Browser font load success/failure is covered by slide-font-loading.test.ts; tsx maps try rows as residual. */
      try {
        loads.push(
          document.fonts.load(
            fontLoadSpec(font.cssFamily, asset.weight, asset.style),
          ),
        );
      } catch {
        // Ignore malformed specs; the CSS fallback still applies.
      }
      /* node:coverage enable */
    }
  }
  await Promise.allSettled(loads);
  try {
    await document.fonts.ready;
  } catch {
    // Ignore — readiness is best effort.
  }
}

/* node:coverage disable -- React hook requires a renderer; loadSlideFonts covers browser font loading. */
/* node:coverage ignore next 20 -- React font-readiness hook requires a renderer; loadSlideFonts covers browser font loading. */
// React hook: `true` once bundled slide fonts are loaded. It returns `true`
// synchronously in non-DOM environments so server rendering is never gated.
export function useSlideFontsReady(fontIds?: readonly string[]): boolean {
  const [ready, setReady] = useState<boolean>(
    () => typeof document === "undefined" || !("fonts" in document),
  );

  useEffect(() => {
    if (typeof document === "undefined" || !("fonts" in document)) {
      // Initial state is already `true` in non-DOM environments.
      return;
    }
    let cancelled = false;
    void loadSlideFonts(fontIds).then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [fontIds]);

  return ready;
}
/* node:coverage enable */
