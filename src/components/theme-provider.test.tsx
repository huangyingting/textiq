/**
 * Direct contracts for `ThemeProvider` / `useThemeMode` (#1946).
 *
 * `resolveAppThemeMode`, `normalizeAppThemeMode`, and `nextAppThemeMode` (the
 * pure mode-resolution helpers this module delegates to) are already
 * exhaustively pinned by `app-shell/theme.test.ts`. This file instead covers
 * the React/DOM bridge `theme-provider.tsx` adds on top: the SSR
 * `getServerSnapshot` fallback (no `window`/`document` touched at all), the
 * client-side `useSyncExternalStore` subscription driving `localStorage`
 * persistence (including the narrow try/catch fallback when storage throws
 * on read and/or write, and that the chosen mode stays authoritative in
 * memory — never reverted — while persistence is unavailable, recovering
 * automatically once storage works again), `setMode`/`cycleMode` applying the
 * resolved theme to `document.documentElement` and firing the
 * cross-instance `textiq-theme-mode-change` custom event, a cross-tab
 * `storage` event re-syncing the mode from the persisted value, a system
 * `prefers-color-scheme` change only re-resolving when the current mode is
 * `"system"`, the guarded `useThemeMode` outside any provider, and that the
 * subscription's three listeners (`textiq-theme-mode-change`, `storage`,
 * media `change`) are fully unregistered on unmount.
 *
 * The SSR case is exercised with `react-dom/server`'s `renderToStaticMarkup`
 * (no window/document fake needed at all, per `slide-editor-save-status.test.tsx`'s
 * convention). The client case is mounted directly with `react-test-renderer`
 * (not the shared harness, which never commits its tree — see
 * `right-surface-context.test.tsx`), against a small fake `window`/`document`
 * with real listener registries so `dispatchEvent`/cross-tab/system-change
 * notifications actually propagate.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";

import { APP_THEME_STORAGE_KEY } from "@/lib/app-shell/theme";

import { ThemeProvider, useThemeMode } from "./theme-provider";

const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const [message] = args;
  if (
    typeof message === "string" &&
    (message.startsWith("react-test-renderer is deprecated") ||
      // Expected noise from exercising both `react-test-renderer` and
      // `react-dom/server` against the same module-level `ThemeModeContext`
      // in one process (SSR test vs. client-mount tests) — cosmetic only,
      // does not affect any assertion in this file.
      message.startsWith(
        "Detected multiple renderers concurrently rendering the same context provider",
      ))
  ) {
    return;
  }
  originalConsoleError(...args);
};
after(() => {
  console.error = originalConsoleError;
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Snapshot = ReturnType<typeof useThemeMode>;

function Consumer({ onRender }: { onRender: (snapshot: Snapshot) => void }) {
  const snapshot = useThemeMode();
  onRender(snapshot);
  return null;
}

// ---------------------------------------------------------------------------
// Fake window/document — client-side mount
// ---------------------------------------------------------------------------

function createFakeWindow() {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const mediaListeners = new Set<(event: { matches: boolean }) => void>();
  const store = new Map<string, string>();
  let getItemThrows = false;
  let setItemThrows = false;
  let systemPrefersDark = false;

  function on(type: string, handler: (event: unknown) => void) {
    const set = listeners.get(type) ?? new Set();
    set.add(handler);
    listeners.set(type, set);
  }
  function off(type: string, handler: (event: unknown) => void) {
    listeners.get(type)?.delete(handler);
  }
  function fire(type: string, event: unknown) {
    for (const handler of Array.from(listeners.get(type) ?? [])) {
      handler(event);
    }
  }

  const documentElement = {
    dataset: {} as Record<string, string>,
    style: {} as Record<string, string>,
  };

  const fakeWindow = {
    addEventListener: on,
    removeEventListener: off,
    dispatchEvent(event: { type: string }) {
      fire(event.type, event);
      return true;
    },
    localStorage: {
      getItem(key: string) {
        if (getItemThrows) throw new Error("storage blocked");
        return store.has(key) ? (store.get(key) as string) : null;
      },
      setItem(key: string, value: string) {
        if (setItemThrows) throw new Error("storage blocked");
        store.set(key, value);
      },
    },
    matchMedia(_query: string) {
      return {
        get matches() {
          return systemPrefersDark;
        },
        addEventListener(type: string, handler: (event: unknown) => void) {
          if (type === "change")
            mediaListeners.add(
              handler as (event: { matches: boolean }) => void,
            );
        },
        removeEventListener(type: string, handler: (event: unknown) => void) {
          if (type === "change")
            mediaListeners.delete(
              handler as (event: { matches: boolean }) => void,
            );
        },
      };
    },
  };

  const fakeDocument = { documentElement };

  return {
    window: fakeWindow,
    document: fakeDocument,
    listenerCount(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
    mediaListenerCount() {
      return mediaListeners.size;
    },
    setStorageThrows(value: boolean) {
      getItemThrows = value;
      setItemThrows = value;
    },
    setGetItemThrows(value: boolean) {
      getItemThrows = value;
    },
    setSetItemThrows(value: boolean) {
      setItemThrows = value;
    },
    getStoredMode() {
      return store.get(APP_THEME_STORAGE_KEY);
    },
    setStoredMode(mode: string) {
      store.set(APP_THEME_STORAGE_KEY, mode);
    },
    /** Simulates another tab writing localStorage and firing a `storage` event. */
    fireCrossTabStorageChange(mode: string) {
      store.set(APP_THEME_STORAGE_KEY, mode);
      fire("storage", { key: APP_THEME_STORAGE_KEY });
    },
    /** Simulates the OS/browser flipping `prefers-color-scheme`. */
    fireSystemThemeChange(prefersDark: boolean) {
      systemPrefersDark = prefersDark;
      for (const handler of Array.from(mediaListeners)) {
        handler({ matches: prefersDark });
      }
    },
  };
}

function withFakeDom<T>(
  run: (fake: ReturnType<typeof createFakeWindow>) => T,
): T {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  const fake = createFakeWindow();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: fake.window,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    writable: true,
    value: fake.document,
  });
  try {
    return run(fake);
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, "window", previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
    if (previousDocument) {
      Object.defineProperty(globalThis, "document", previousDocument);
    } else {
      Reflect.deleteProperty(globalThis, "document");
    }
  }
}

function mountProvider(): {
  latest(): Snapshot;
  unmount(): void;
} {
  let latest: Snapshot | undefined;
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <ThemeProvider>
        <Consumer onRender={(snapshot) => (latest = snapshot)} />
      </ThemeProvider>,
    );
  });
  return {
    latest: () => {
      assert.ok(latest, "expected the consumer to have rendered");
      return latest as Snapshot;
    },
    unmount: () => act(() => renderer.unmount()),
  };
}

// ---------------------------------------------------------------------------
// SSR — getServerSnapshot fallback (no window/document touched at all)
// ---------------------------------------------------------------------------

test("ThemeProvider renders the default 'system'/'light' snapshot during SSR without touching window or document", () => {
  assert.equal(typeof globalThis.window, "undefined");
  assert.equal(typeof globalThis.document, "undefined");

  let snapshot: Snapshot | undefined;
  const markup = renderToStaticMarkup(
    <ThemeProvider>
      <Consumer onRender={(value) => (snapshot = value)} />
    </ThemeProvider>,
  );

  assert.equal(markup, "");
  assert.ok(snapshot);
  assert.equal(snapshot!.mode, "system");
  assert.equal(snapshot!.resolvedMode, "light");
  assert.equal(typeof snapshot!.setMode, "function");
  assert.equal(typeof snapshot!.cycleMode, "function");
});

// ---------------------------------------------------------------------------
// useThemeMode guard
// ---------------------------------------------------------------------------

test("useThemeMode throws when used outside a ThemeProvider", () => {
  assert.throws(() => {
    act(() => {
      create(<Consumer onRender={() => {}} />);
    });
  }, /useThemeMode must be used within ThemeProvider/);
});

// ---------------------------------------------------------------------------
// Client mount — initial snapshot from localStorage
// ---------------------------------------------------------------------------

test("reads the persisted mode from localStorage on mount and resolves it against the system preference", () =>
  withFakeDom((fake) => {
    fake.setStoredMode("dark");
    const { latest, unmount } = mountProvider();

    assert.equal(latest().mode, "dark");
    assert.equal(latest().resolvedMode, "dark");
    unmount();
  }));

test("defaults to 'system' when localStorage has no stored mode, resolved against prefers-color-scheme", () =>
  withFakeDom((fake) => {
    fake.fireSystemThemeChange(true); // sets systemPrefersDark before mount
    const { latest, unmount } = mountProvider();

    assert.equal(latest().mode, "system");
    assert.equal(latest().resolvedMode, "dark");
    unmount();
  }));

test("falls back to the default mode when localStorage holds an invalid value", () =>
  withFakeDom((fake) => {
    fake.setStoredMode("not-a-real-mode");
    const { latest, unmount } = mountProvider();

    assert.equal(latest().mode, "system");
    unmount();
  }));

// ---------------------------------------------------------------------------
// setMode — persistence + DOM application + cross-instance notification
// ---------------------------------------------------------------------------

test("setMode persists to localStorage, applies the theme to documentElement, and updates the snapshot", () =>
  withFakeDom((fake) => {
    const { latest, unmount } = mountProvider();

    act(() => {
      latest().setMode("dark");
    });

    assert.equal(fake.getStoredMode(), "dark");
    assert.equal(latest().mode, "dark");
    assert.equal(latest().resolvedMode, "dark");
    assert.equal(fake.document.documentElement.dataset.theme, "dark");
    assert.equal(fake.document.documentElement.style.colorScheme, "dark");
    unmount();
  }));

test("setMode never throws when localStorage.setItem throws, and keeps the newly selected mode authoritative in memory and in the DOM (no reversion)", () =>
  withFakeDom((fake) => {
    fake.setSetItemThrows(true);
    const { latest, unmount } = mountProvider();

    assert.doesNotThrow(() => {
      act(() => {
        latest().setMode("dark");
      });
    });

    // setMode's in-memory store is set before the (failing) persistence
    // attempt, so its own THEME_MODE_CHANGE_EVENT notification re-reads that
    // same in-memory value instead of re-reading the still-throwing storage.
    // The selection must therefore remain "dark", not revert to the default.
    assert.equal(latest().mode, "dark");
    assert.equal(latest().resolvedMode, "dark");
    assert.equal(fake.document.documentElement.dataset.theme, "dark");
    assert.equal(fake.document.documentElement.style.colorScheme, "dark");
    assert.equal(fake.getStoredMode(), undefined);
    unmount();
  }));

test("falls back to the default mode when localStorage.getItem throws on mount, but setMode still selects and keeps a new mode", () =>
  withFakeDom((fake) => {
    fake.setGetItemThrows(true);
    const { latest, unmount } = mountProvider();

    assert.equal(latest().mode, "system");

    act(() => {
      latest().setMode("dark");
    });

    assert.equal(latest().mode, "dark");
    assert.equal(fake.document.documentElement.dataset.theme, "dark");
    unmount();
  }));

test("cycleMode keeps advancing from the in-memory mode across repeated calls while localStorage is fully broken", () =>
  withFakeDom((fake) => {
    fake.setStorageThrows(true);
    const { latest, unmount } = mountProvider();
    assert.equal(latest().mode, "system");

    act(() => {
      latest().cycleMode();
    });
    assert.equal(latest().mode, "light");

    act(() => {
      latest().cycleMode();
    });
    assert.equal(latest().mode, "dark");
    unmount();
  }));

test("setMode persists again once localStorage recovers after a prior failure", () =>
  withFakeDom((fake) => {
    fake.setStorageThrows(true);
    const { latest, unmount } = mountProvider();

    act(() => {
      latest().setMode("dark");
    });
    assert.equal(latest().mode, "dark");
    assert.equal(fake.getStoredMode(), undefined);

    fake.setStorageThrows(false);
    act(() => {
      latest().setMode("ocean");
    });

    assert.equal(latest().mode, "ocean");
    assert.equal(fake.getStoredMode(), "ocean");
    assert.equal(fake.document.documentElement.dataset.theme, "ocean");
    unmount();
  }));

test("a cross-tab storage event still re-syncs the mode from the persisted value after a recovered-storage selection", () =>
  withFakeDom((fake) => {
    fake.setStorageThrows(true);
    const { latest, unmount } = mountProvider();

    act(() => {
      latest().setMode("dark");
    });
    assert.equal(latest().mode, "dark");

    fake.setStorageThrows(false);
    act(() => {
      latest().setMode("light");
    });
    assert.equal(fake.getStoredMode(), "light");

    act(() => {
      fake.fireCrossTabStorageChange("mint");
    });

    assert.equal(latest().mode, "mint");
    assert.equal(fake.document.documentElement.dataset.theme, "mint");
    unmount();
  }));

test("cycleMode advances to the next mode in APP_THEME_MODES order", () =>
  withFakeDom((fake) => {
    fake.setStoredMode("system");
    const { latest, unmount } = mountProvider();
    assert.equal(latest().mode, "system");

    act(() => {
      latest().cycleMode();
    });
    assert.equal(latest().mode, "light");

    act(() => {
      latest().cycleMode();
    });
    assert.equal(latest().mode, "dark");
    unmount();
  }));

// ---------------------------------------------------------------------------
// Cross-tab storage sync
// ---------------------------------------------------------------------------

test("a cross-tab storage event for the theme key re-syncs the mode", () =>
  withFakeDom((fake) => {
    fake.setStoredMode("light");
    const { latest, unmount } = mountProvider();
    assert.equal(latest().mode, "light");

    act(() => {
      fake.fireCrossTabStorageChange("dark");
    });

    assert.equal(latest().mode, "dark");
    assert.equal(fake.document.documentElement.dataset.theme, "dark");
    unmount();
  }));

test("a storage event for an unrelated key is ignored", () =>
  withFakeDom((fake) => {
    fake.setStoredMode("light");
    const { latest, unmount } = mountProvider();

    act(() => {
      fake.window.dispatchEvent({
        type: "storage",
      } as unknown as { type: string });
    });

    assert.equal(latest().mode, "light");
    unmount();
  }));

// ---------------------------------------------------------------------------
// System prefers-color-scheme change — only applies when mode is "system"
// ---------------------------------------------------------------------------

test("a system theme change re-resolves resolvedMode only while mode is 'system'", () =>
  withFakeDom((fake) => {
    fake.setStoredMode("system");
    const { latest, unmount } = mountProvider();
    assert.equal(latest().resolvedMode, "light");

    act(() => {
      fake.fireSystemThemeChange(true);
    });

    assert.equal(latest().resolvedMode, "dark");
    unmount();
  }));

test("a system theme change is ignored while mode is explicitly 'dark' (not 'system')", () =>
  withFakeDom((fake) => {
    fake.setStoredMode("dark");
    const { latest, unmount } = mountProvider();
    assert.equal(latest().resolvedMode, "dark");

    act(() => {
      fake.fireSystemThemeChange(true);
    });
    // resolvedMode was already "dark"; more importantly the explicit mode
    // must not have been overwritten by the system-preference notification.
    assert.equal(latest().mode, "dark");
    assert.equal(latest().resolvedMode, "dark");
    unmount();
  }));

// ---------------------------------------------------------------------------
// Subscription lifecycle
// ---------------------------------------------------------------------------

test("subscribes to the theme-change event, storage, and media-query change listeners on mount", () =>
  withFakeDom((fake) => {
    const { unmount } = mountProvider();

    assert.ok(fake.listenerCount("textiq-theme-mode-change") >= 1);
    assert.ok(fake.listenerCount("storage") >= 1);
    assert.ok(fake.mediaListenerCount() >= 1);
    unmount();
  }));

test("removes every listener it registered on unmount", () =>
  withFakeDom((fake) => {
    const { unmount } = mountProvider();
    unmount();

    assert.equal(fake.listenerCount("textiq-theme-mode-change"), 0);
    assert.equal(fake.listenerCount("storage"), 0);
    assert.equal(fake.mediaListenerCount(), 0);
  }));
