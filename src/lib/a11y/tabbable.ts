/**
 * Canonical tabbable-element enumeration for keyboard focus traps.
 *
 * Practical contract:
 * - Include: enabled form controls (button, input, select, textarea),
 *   anchors/areas with href, contenteditable (not false), iframe/object/embed,
 *   and any element with an explicit non-negative tabindex.
 * - Exclude: disabled native controls, input[type=hidden], elements with
 *   tabindex="-1" (even if otherwise tabbable), and candidates/descendants
 *   marked [hidden], [aria-hidden="true"], or [inert].
 *
 * Does not cover: computed-style visibility, radio-group rules,
 * positive-tabindex reordering, or Shadow DOM traversal.
 */

/** Tags that are intrinsically tabbable when not disabled. */
const NATIVE_FORM_CONTROLS = new Set(["BUTTON", "INPUT", "SELECT", "TEXTAREA"]);

/** Tags that are tabbable unconditionally (no href/disabled gate). */
const ALWAYS_TABBABLE_TAGS = new Set(["IFRAME", "OBJECT", "EMBED"]);

/** Tags that require an `href` attribute to participate in tab order. */
const HREF_TAGS = new Set(["A", "AREA"]);

function hasHiddenSelfOrAncestor(el: Element): boolean {
  let node: Element | null = el;
  while (node) {
    if (
      node.hasAttribute("hidden") ||
      node.getAttribute("aria-hidden") === "true" ||
      node.hasAttribute("inert")
    ) {
      return true;
    }
    node = (node as unknown as { parentElement: Element | null }).parentElement;
  }
  return false;
}

function isTabbable(el: Element): boolean {
  const tag = el.tagName;

  // Explicit tabindex=-1 always removes from tab order, regardless of tag.
  if (el.getAttribute("tabindex") === "-1") {
    return false;
  }

  // Hidden candidate/ancestor check.
  if (hasHiddenSelfOrAncestor(el)) {
    return false;
  }

  // Native form controls — must not be disabled; input[type=hidden] excluded.
  if (NATIVE_FORM_CONTROLS.has(tag)) {
    if (el.hasAttribute("disabled")) return false;
    if (tag === "INPUT" && el.getAttribute("type") === "hidden") return false;
    return true;
  }

  // Anchor/area — requires href.
  if (HREF_TAGS.has(tag)) {
    return el.hasAttribute("href");
  }

  // Always-tabbable embedded content.
  if (ALWAYS_TABBABLE_TAGS.has(tag)) {
    return true;
  }

  // Contenteditable — "true" or "" (inherit) counts; "false" does not.
  if (el.hasAttribute("contenteditable")) {
    const val = el.getAttribute("contenteditable");
    return val !== "false";
  }

  // Explicit non-negative tabindex on any other element.
  if (el.hasAttribute("tabindex")) {
    const idx = Number(el.getAttribute("tabindex"));
    return idx >= 0;
  }

  return false;
}

/**
 * Returns all tabbable descendants of `container` in DOM order.
 *
 * Uses a broad querySelectorAll to collect candidates, then applies the
 * practical tabbable contract as a filter.
 */
export function getTabbableElements(container: {
  querySelectorAll(selector: string): ArrayLike<Element>;
}): HTMLElement[] {
  const CANDIDATE_SELECTOR =
    "a, area, button, input, select, textarea, iframe, object, embed, " +
    "[tabindex], [contenteditable]";
  const candidates = Array.from(container.querySelectorAll(CANDIDATE_SELECTOR));
  return candidates.filter(isTabbable) as HTMLElement[];
}

/**
 * Computes the next focus index inside a focus trap given the current index
 * and Tab direction. Wraps at both ends.
 *
 * @param count      Total tabbable elements in the trap.
 * @param currentIdx Index of the currently focused element (-1 if none).
 * @param shiftKey   `true` when Shift+Tab (backwards).
 * @returns          Next index to focus, or -1 when `count` is 0.
 */
export function nextFocusIndex(
  count: number,
  currentIdx: number,
  shiftKey: boolean,
): number {
  if (count === 0) return -1;
  if (shiftKey) {
    return currentIdx <= 0 ? count - 1 : currentIdx - 1;
  }
  return currentIdx >= count - 1 ? 0 : currentIdx + 1;
}
