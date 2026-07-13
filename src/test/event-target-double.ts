/**
 * Minimal trackable event-target double for exercising `addEventListener` /
 * `removeEventListener` registration + cleanup without a real DOM.
 *
 * Several components register a listener on the real global `document` or
 * `window` inside a `useEffect` and remove it in that effect's cleanup (e.g.
 * `UserMenu`'s and `SocialShareMenu`'s "click outside to close" `document`
 * listener, `MobileViewportSync`'s `window`/`visualViewport` resize listeners).
 * `@/test/portal-dom`'s fake `document.addEventListener` is a deliberate
 * no-op (Escape/focus-trap mechanics are covered at the `DrawerSurface`/
 * `ModalSurface` level, not here), so it can't be used to fire synthetic
 * events for these components. This helper — modeled on the ad hoc listener
 * registry originally written for `theme-provider.test.tsx` — provides a real
 * `Map<type, Set<handler>>`-backed registry so tests can both dispatch events
 * and assert exact listener counts (e.g. "no leaked listener after unmount").
 *
 * Compose with `@/test/browser-globals`'s `createBrowserGlobalInstaller` to
 * install the resulting object as `globalThis.document` / `globalThis.window`
 * for the duration of a test.
 */

export interface TrackedEventTarget {
  addEventListener(type: string, handler: (event: never) => void): void;
  removeEventListener(type: string, handler: (event: never) => void): void;
  /** Invokes every handler currently registered for `event.type`. */
  dispatchEvent(event: { type: string } & Record<string, unknown>): boolean;
  /** Number of handlers currently registered for `type`. */
  listenerCount(type: string): number;
}

export function createTrackedEventTarget(): TrackedEventTarget {
  const listeners = new Map<string, Set<(event: never) => void>>();

  function addEventListener(type: string, handler: (event: never) => void) {
    const set = listeners.get(type) ?? new Set();
    set.add(handler);
    listeners.set(type, set);
  }

  function removeEventListener(type: string, handler: (event: never) => void) {
    listeners.get(type)?.delete(handler);
  }

  function dispatchEvent(event: { type: string } & Record<string, unknown>) {
    for (const handler of Array.from(listeners.get(event.type) ?? [])) {
      handler(event as never);
    }
    return true;
  }

  function listenerCount(type: string) {
    return listeners.get(type)?.size ?? 0;
  }

  return {
    addEventListener,
    removeEventListener,
    dispatchEvent,
    listenerCount,
  };
}
