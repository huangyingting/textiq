const SLIDE_EDITOR_RETURN_FOCUS_KEY_PREFIX =
  "textiq:slide-editor-return-focus:";

function returnFocusKey(documentId: string): string {
  return `${SLIDE_EDITOR_RETURN_FOCUS_KEY_PREFIX}${documentId}`;
}

export function requestSlideEditorReturnFocus(documentId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(returnFocusKey(documentId), "true");
  } catch {
    // Focus restoration is best-effort when storage is unavailable.
  }
}

export function hasSlideEditorReturnFocus(documentId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(returnFocusKey(documentId)) === "true";
  } catch {
    return false;
  }
}

export function consumeSlideEditorReturnFocus(documentId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const key = returnFocusKey(documentId);
    const requested = window.sessionStorage.getItem(key) === "true";
    window.sessionStorage.removeItem(key);
    return requested;
  } catch {
    return false;
  }
}
