"use client";

/**
 * React hook that resolves a `Deck` into a `ResolvedDeckRenderTree`.
 *
 * Wraps `resolveDeckRenderTree` in a `useMemo` so the resolved tree is only
 * recomputed when the deck or package identity changes.
 *
 * Rules:
 * - Returns `null` when `deck` is null or undefined.
 * - Falls back to `NEUTRAL_THEME_PACKAGE` when no package is supplied.
 * - The caller owns the resolved tree reference; the hook never mutates it.
 */

import { useMemo } from "react";

import type { Deck } from "@/lib/presentation/schema";
import type { ThemePackageV1 } from "@/lib/presentation/theme-package-schema";
import type { ResolvedDeckRenderTree } from "@/lib/presentation/render-tree";
import { resolveDeckRenderTree } from "@/lib/presentation/render-resolver";
import { NEUTRAL_THEME_PACKAGE } from "@/lib/presentation/neutral-theme-package";

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseDeckRenderTreeOptions {
  /**
   * Pixel width used for `framePx` calculations.
   * Defaults to 960 (matching the render-resolver default).
   */
  canvasWidthPx?: number;
  /**
   * Pixel height used for `framePx` calculations.
   * Defaults to 540.
   */
  canvasHeightPx?: number;
}

/**
 * Resolves a `Deck` into a `ResolvedDeckRenderTree`.
 *
 * @param deck       - The presentation deck to resolve, or null/undefined.
 * @param pkg        - Theme package to use. Defaults to the neutral package.
 * @param options    - Canvas pixel dimensions for frame resolution.
 * @returns The resolved render tree, or `null` when `deck` is absent.
 */
export function useDeckRenderTree(
  deck: Deck | null | undefined,
  pkg?: ThemePackageV1 | null,
  options?: UseDeckRenderTreeOptions,
): ResolvedDeckRenderTree | null {
  const resolvedPkg = pkg ?? NEUTRAL_THEME_PACKAGE;
  const cw = options?.canvasWidthPx;
  const ch = options?.canvasHeightPx;

  return useMemo(() => {
    if (!deck) return null;
    return resolveDeckRenderTree(deck, resolvedPkg, {
      canvasWidthPx: cw,
      canvasHeightPx: ch,
    });
  }, [deck, resolvedPkg, cw, ch]);
}
