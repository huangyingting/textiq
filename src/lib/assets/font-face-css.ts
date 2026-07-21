/**
 * Generic `@font-face` CSS generation helper.
 *
 * `buildFontFaceCss` is free of DOM/browser dependencies so it can be called
 * in Node tests, during SSR, and in React useEffect alike.
 */

function escapeCssSingleQuotedString(value: string): string {
  return value.replace(/[\\'<>\0-\x1f\x7f]/g, (char) => {
    if (char === "\\" || char === "'") return `\\${char}`;
    return `\\${char.charCodeAt(0).toString(16).toUpperCase()} `;
  });
}

/**
 * Builds a `@font-face` CSS rule that binds the CSS font-family name to a
 * durable font asset URL. Returns an empty string when either argument is
 * absent or empty.
 *
 * @param fontFamily  - CSS font-family value, e.g. `'MyFont', sans-serif`
 * @param fontAssetUrl - Protected font asset URL
 */
export function buildFontFaceCss(
  fontFamily: string | null | undefined,
  fontAssetUrl: string | null | undefined,
): string {
  if (!fontFamily || !fontAssetUrl) return "";
  // Extract the bare family name from a CSS font-family stack.
  // e.g. "'MyFont', sans-serif" → "MyFont"
  const bare = fontFamily
    .split(",")[0]
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .trim();
  if (!bare) return "";
  const escapedBare = escapeCssSingleQuotedString(bare);
  const escapedUrl = escapeCssSingleQuotedString(fontAssetUrl);
  return `@font-face { font-family: '${escapedBare}'; src: url('${escapedUrl}'); font-display: swap; }`;
}
