/**
 * Render tree resolver for the presentation system.
 *
 * `resolveDeckRenderTree` converts a `Deck` + loaded `ThemePackageV1` into a
 * `ResolvedDeckRenderTree` that all rendering and export surfaces consume.
 *
 * Rules:
 * - Hidden nodes are excluded.
 * - User nodes are ordered by ascending zIndex with stable tree-order ties.
 * - Theme decorations are injected into `ResolvedSlideRenderTree.decorations`.
 * - Decorations disabled in `DeckThemeBinding.overrides.disabledDecorations`
 *   are omitted.
 * - Decoration visibility is filtered by `SlideProps.decoration` and chrome
 *   by `SlideProps.chrome`.
 * - All token refs are resolved before returning.
 * - Unresolved assets, style refs, and token refs produce diagnostics.
 */

import type { Deck } from "./schema";
import type { ThemePackageV1 } from "./theme-package-schema";
import type {
  ResolvedDeckRenderTree,
  ResolvedSlideRenderTree,
} from "./render-tree";
import { resolveTheme } from "./style-resolver";
import { DiagnosticCollector } from "./diagnostics";
import { resolveSlideRenderTreePass } from "./render-resolver/slide-pass";

export type ResolveDeckOptions = {
  /** Pixel width of the canvas for `framePx` calculation. Defaults to 960. */
  canvasWidthPx?: number;
  /** Pixel height of the canvas for `framePx` calculation. Defaults to 540. */
  canvasHeightPx?: number;
};

/**
 * Resolves a presentation deck into a `ResolvedDeckRenderTree`.
 *
 * All token refs are resolved. Hidden nodes are excluded.
 * Diagnostics for missing assets, unknown style refs, or missing layouts are
 * returned alongside the resolved tree.
 */
export function resolveDeckRenderTree(
  deck: Deck,
  pkg: ThemePackageV1,
  options?: ResolveDeckOptions,
): ResolvedDeckRenderTree {
  const dc = new DiagnosticCollector();
  const cw = options?.canvasWidthPx ?? 960;
  const ch = options?.canvasHeightPx ?? 540;

  const theme = resolveTheme(pkg, deck.theme);

  const slides: ResolvedSlideRenderTree[] = [];
  for (const [index, slide] of deck.slides.entries()) {
    slides.push(
      resolveSlideRenderTreePass(
        slide,
        deck,
        pkg,
        dc,
        index,
        deck.slides.length,
        cw,
        ch,
      ),
    );
  }

  return {
    canvas: deck.canvas,
    theme,
    slides,
    diagnostics: dc.diagnostics,
  };
}
