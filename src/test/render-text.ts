/**
 * Small shared utilities for `react-test-renderer`-based direct component
 * tests, factored out of the ad hoc copies previously duplicated across
 * `import-document-button.test.tsx`, `new-document-button.test.tsx`, and
 * `document-list-toolbar.test.tsx`.
 */
import type { ReactTestInstance } from "react-test-renderer";

/**
 * Flattens a `ReactTestInstance`'s rendered text content, depth-first.
 *
 * Deliberately reads `.children` (the renderer's resolved child instances),
 * not `.props.children` (the as-authored prop value) — the latter can
 * contain circular `_owner`/fiber references for elements with a component
 * ancestor, which breaks naive recursion or `JSON.stringify`-based
 * comparisons.
 */
export function textOf(instance: ReactTestInstance): string {
  return instance.children
    .map((child) => (typeof child === "string" ? child : textOf(child)))
    .join("");
}

/**
 * Resolves after the microtask/macrotask queue drains one tick via
 * `setImmediate`. `startTransition(async () => { ...; await someAction(); })`
 * bodies need at least one drain per `await` before their post-transition
 * state (e.g. re-enabled controls, updated optimistic state) is observable —
 * call this (usually twice, back to back) inside an `await act(async () =>
 * ...)` block after triggering the transition.
 */
export function waitForAsyncDrain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
