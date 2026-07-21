/**
 * Pure URL builder functions for social platform share intents, plus
 * feature-detection helpers for Web Share and Clipboard APIs.
 *
 * These functions have no side effects and no DOM/browser dependency — safe to
 * import in Node test environments and server-side code.
 */

// ---------------------------------------------------------------------------
// Intent URL builders
// ---------------------------------------------------------------------------

/**
 * Returns an X (Twitter) compose-tweet intent URL pre-filled with `url` and
 * `text`. Both values are percent-encoded at construction time.
 */
export function buildTwitterIntent(url: string, text: string): string {
  return (
    "https://twitter.com/intent/tweet" +
    "?url=" +
    encodeURIComponent(url) +
    "&text=" +
    encodeURIComponent(text)
  );
}

/**
 * Returns a LinkedIn share URL for the given `url`.
 * Opens the LinkedIn share dialog via the "share-offsite" endpoint.
 */
export function buildLinkedInIntent(url: string): string {
  return (
    "https://www.linkedin.com/sharing/share-offsite/" +
    "?url=" +
    encodeURIComponent(url)
  );
}

/**
 * Returns a Facebook sharer URL for the given `url`.
 * Opens the Facebook sharer dialog.
 */
export function buildFacebookIntent(url: string): string {
  return (
    "https://www.facebook.com/sharer/sharer.php" +
    "?u=" +
    encodeURIComponent(url)
  );
}

// ---------------------------------------------------------------------------
// Capability-detection helpers
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the Web Share API is available in the current context.
 *
 * When a `File` is provided, the check includes `navigator.canShare({ files })`
 * so callers can confirm file-sharing support before constructing the payload.
 * Feature-detected at call time — safe in SSR (returns `false`) and does not
 * cache the result.
 */
export function canWebShare(file?: File): boolean {
  const currentNavigator = globalThis.navigator;
  if (
    typeof currentNavigator === "undefined" ||
    typeof currentNavigator.share !== "function"
  ) {
    return false;
  }
  /* node:coverage disable */
  if (file === undefined || typeof currentNavigator.canShare !== "function") {
    return true;
  }
  try {
    return currentNavigator.canShare({ files: [file] });
  } catch {
    return false;
  }
  /* node:coverage enable */
}

/**
 * Returns `true` when the Clipboard API supports writing image data.
 * Requires both `navigator.clipboard.write` and `ClipboardItem` to be
 * available (Chrome 76+, Safari 13.1+, Firefox 127+).
 * Feature-detected at call time — returns `false` in SSR / unsupported browsers.
 */
export function canCopyImageToClipboard(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard !== "undefined" &&
    navigator.clipboard !== null &&
    typeof navigator.clipboard.write === "function" &&
    typeof ClipboardItem !== "undefined"
  );
}
