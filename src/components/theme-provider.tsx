"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  APP_THEME_COOKIE_KEY,
  APP_THEME_STORAGE_KEY,
  DEFAULT_APP_THEME_MODE,
  nextAppThemeMode,
  normalizeAppThemeMode,
  resolveAppThemeMode,
  type AppThemeMode,
  type ResolvedAppThemeMode,
} from "@/lib/app-shell/theme";

type ThemeModeContextValue = {
  mode: AppThemeMode;
  resolvedMode: ResolvedAppThemeMode;
  setMode: (mode: AppThemeMode) => void;
  cycleMode: () => void;
};

const ThemeModeContext = createContext<ThemeModeContextValue | null>(null);
const THEME_MODE_CHANGE_EVENT = "textiq-theme-mode-change";

function systemPrefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

function applyThemeMode(mode: AppThemeMode): ResolvedAppThemeMode {
  const resolvedMode = resolveAppThemeMode(mode, systemPrefersDark());
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.style.colorScheme = resolvedMode;
  return resolvedMode;
}

// The selected mode is kept authoritative in memory (per `window`, so
// separate windows/test fixtures never leak state into one another) rather
// than being re-derived from persistence on every read. localStorage remains
// the cross-tab channel; a same-site cookie lets the server render the chosen
// mode before hydration. Either persistence target may be unavailable without
// overruling a mode already chosen in memory.
type ThemeStoreState = { mode: AppThemeMode };
const themeStores = new WeakMap<typeof window, ThemeStoreState>();

function readStoredThemeMode(fallback: AppThemeMode): AppThemeMode {
  try {
    const stored = window.localStorage.getItem(APP_THEME_STORAGE_KEY);
    return stored === null ? fallback : normalizeAppThemeMode(stored);
  } catch {
    return fallback;
  }
}

function writeStoredThemeMode(mode: AppThemeMode): void {
  try {
    window.localStorage.setItem(APP_THEME_STORAGE_KEY, mode);
  } catch {
    // Ignore blocked/unavailable storage; the in-memory mode stays
    // authoritative and the DOM has already been updated by the caller.
  }
}

function writeThemeCookie(mode: AppThemeMode): void {
  try {
    const secure = window.location?.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${APP_THEME_COOKIE_KEY}=${mode}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  } catch {
    // Cookie persistence is best-effort. The in-memory mode, DOM state, and
    // localStorage cross-tab channel remain usable in restricted contexts.
  }
}

function themeStore(fallback = DEFAULT_APP_THEME_MODE): ThemeStoreState {
  let store = themeStores.get(window);
  if (!store) {
    store = { mode: readStoredThemeMode(fallback) };
    themeStores.set(window, store);
  }
  return store;
}

function currentThemeMode(fallback = DEFAULT_APP_THEME_MODE): AppThemeMode {
  return themeStore(fallback).mode;
}

function currentResolvedThemeMode(
  fallback = DEFAULT_APP_THEME_MODE,
): ResolvedAppThemeMode {
  return resolveAppThemeMode(currentThemeMode(fallback), systemPrefersDark());
}

function subscribeThemeMode(
  onStoreChange: () => void,
  fallback = DEFAULT_APP_THEME_MODE,
) {
  const applyCurrentAndNotify = () => {
    applyThemeMode(currentThemeMode(fallback));
    onStoreChange();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== APP_THEME_STORAGE_KEY) return;
    // Another tab persisted successfully, so storage is the source of
    // truth for this cross-tab sync (unlike our own change event below).
    themeStore(fallback).mode = readStoredThemeMode(fallback);
    writeThemeCookie(themeStore(fallback).mode);
    applyCurrentAndNotify();
  };
  const onSystemThemeChange = () => {
    if (currentThemeMode(fallback) === "system") applyCurrentAndNotify();
  };
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");

  window.addEventListener(THEME_MODE_CHANGE_EVENT, applyCurrentAndNotify);
  window.addEventListener("storage", onStorage);
  media?.addEventListener("change", onSystemThemeChange);

  return () => {
    window.removeEventListener(THEME_MODE_CHANGE_EVENT, applyCurrentAndNotify);
    window.removeEventListener("storage", onStorage);
    media?.removeEventListener("change", onSystemThemeChange);
  };
}

export function ThemeProvider({
  children,
  initialMode = DEFAULT_APP_THEME_MODE,
}: {
  children: ReactNode;
  initialMode?: AppThemeMode;
}) {
  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      subscribeThemeMode(onStoreChange, initialMode),
    [initialMode],
  );
  const getModeSnapshot = useCallback(
    () => currentThemeMode(initialMode),
    [initialMode],
  );
  const getResolvedModeSnapshot = useCallback(
    () => currentResolvedThemeMode(initialMode),
    [initialMode],
  );
  const getServerModeSnapshot = useCallback(() => initialMode, [initialMode]);
  const getServerResolvedModeSnapshot = useCallback(
    () => resolveAppThemeMode(initialMode, false),
    [initialMode],
  );
  const mode = useSyncExternalStore(
    subscribe,
    getModeSnapshot,
    getServerModeSnapshot,
  );
  const resolvedMode = useSyncExternalStore(
    subscribe,
    getResolvedModeSnapshot,
    getServerResolvedModeSnapshot,
  );

  useEffect(() => {
    applyThemeMode(mode);
    writeThemeCookie(mode);
  }, [mode]);

  const setMode = useCallback(
    (nextMode: AppThemeMode) => {
      // The chosen mode is authoritative in memory first, so a broken/blocked
      // store can never revert it: persistence below is best-effort only, and
      // the change-event notification (via `subscribeThemeMode`) re-reads this
      // same in-memory store rather than storage.
      themeStore(initialMode).mode = nextMode;
      writeStoredThemeMode(nextMode);
      writeThemeCookie(nextMode);
      applyThemeMode(nextMode);
      window.dispatchEvent(new Event(THEME_MODE_CHANGE_EVENT));
    },
    [initialMode],
  );

  const cycleMode = useCallback(() => {
    setMode(nextAppThemeMode(mode));
  }, [mode, setMode]);

  const value = useMemo(
    () => ({ mode, resolvedMode, setMode, cycleMode }),
    [mode, resolvedMode, setMode, cycleMode],
  );

  return (
    <ThemeModeContext.Provider value={value}>
      {children}
    </ThemeModeContext.Provider>
  );
}

export function useThemeMode(): ThemeModeContextValue {
  const context = useContext(ThemeModeContext);
  if (!context) {
    throw new Error("useThemeMode must be used within ThemeProvider.");
  }
  return context;
}
