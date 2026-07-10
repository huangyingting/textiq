/**
 * Brand-specific DOM injection for `@font-face` rules (font durable-asset
 * rehydration). CSS generation is delegated to the shared
 * `@/lib/assets/font-face-css` module.
 */

import { buildFontFaceCss } from "@/lib/assets/font-face-css";

/**
 * Injects a `@font-face` rule into the document `<head>` for a custom-font
 * brand if one is not already present.  No-ops in non-browser environments.
 *
 * Used for rehydration: call this whenever a saved brand with a custom font
 * is rendered or applied, not just right after upload.
 *
 * @param brandId     - Unique brand id used to key the injected style element
 * @param fontFamily  - CSS font-family from the brand (can be null)
 * @param fontAssetUrl - Protected font asset URL derived from the brand asset id
 */
/* @preserve node:coverage ignore next -- Inject behavior is exercised; tsx maps the exported signature line as uncovered. */
export function injectBrandFontFace(
  brandId: string,
  fontFamily: string | null | undefined,
  fontAssetUrl: string | null | undefined,
): void {
  if (typeof document === "undefined") return;
  const css = buildFontFaceCss(fontFamily, fontAssetUrl);
  if (!css) return;
  const id = `brand-font-${brandId}`;
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
}
