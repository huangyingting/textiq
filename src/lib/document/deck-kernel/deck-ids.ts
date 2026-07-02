/** SSR-safe deck and element id helpers. */

/**
 * Generates a unique id for a new slide element.
 *
 * **Stateless and SSR-safe by design.** It holds no module-level mutable
 * counter, so concurrent server renders, HMR reloads, and multiple decks in one
 * process can never collide or interfere — every call derives its uniqueness
 * purely from `crypto.randomUUID()` (when available in both Node and the
 * browser) or, as a fallback for non-secure browser contexts, a timestamp plus
 * a random suffix. The `el-` prefix keeps ids visually identifiable and stable
 * in shape.
 *
 * Ids only need to be unique within a deck and stable once assigned — they are
 * persisted into `deckJson` (never recomputed on every render), so dropping the
 * old monotonic counter does not affect any code that relies on element
 * identity across renders.
 */
export function makeElementId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) {
    return `el-${uuid}`;
  }
  return `el-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Generates a stable unique id for a new slide (analogous to
 * {@link makeElementId} for elements). The `sl-` prefix keeps slide ids
 * visually distinct from element ids. Ids are only required to be unique
 * within a deck and stable once assigned — they are persisted into `deckJson`.
 */
export function makeSlideId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) {
    return `sl-${uuid}`;
  }
  return `sl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
