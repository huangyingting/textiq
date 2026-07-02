/**
 * Bridge between presentation theme defaults and visual-content theme application.
 *
 * Deck tokens can suggest which visual style theme to apply to embedded Visual
 * payloads, but the visual theme/display-style catalogs remain separate data
 * models owned by `src/lib/visual`.
 */

import type { VisualDefaultsToken } from "@/lib/visual/presentation-theme";
import { STYLE_THEMES } from "@/lib/visual/themes";

export type VisualThemeStyleOrigin = "element" | "deck" | "visual";

export interface VisualThemeBridgeResult {
  styleThemeId?: string;
  transparentBackground: boolean;
  origin: VisualThemeStyleOrigin;
}

export function isVisualStyleThemeId(themeId: string): boolean {
  return STYLE_THEMES.some((theme) => theme.id === themeId);
}

export function resolveVisualThemeBridge(
  elementStyleThemeId: string | undefined,
  visualDefaults: VisualDefaultsToken | undefined,
): VisualThemeBridgeResult {
  if (elementStyleThemeId) {
    return {
      styleThemeId: elementStyleThemeId,
      transparentBackground: visualDefaults?.transparentBackground ?? false,
      origin: "element",
    };
  }
  if (visualDefaults?.styleThemeId) {
    return {
      styleThemeId: visualDefaults.styleThemeId,
      transparentBackground: visualDefaults.transparentBackground ?? false,
      origin: "deck",
    };
  }
  return {
    transparentBackground: visualDefaults?.transparentBackground ?? false,
    origin: "visual",
  };
}
