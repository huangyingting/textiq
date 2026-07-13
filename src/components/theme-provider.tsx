"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
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
// than being re-derived from `localStorage` on every read. Storage is only a
// best-effort persistence/cross-tab sync target: a throwing/unavailable
// store must never be able to overrule a mode already chosen in memory.
type ThemeStoreState = { mode: AppThemeMode };
const themeStores = new WeakMap<typeof window, ThemeStoreState>();

function readStoredThemeMode(): AppThemeMode {
  try {
    return normalizeAppThemeMode(
      window.localStorage.getItem(APP_THEME_STORAGE_KEY),
    );
  } catch {
    return DEFAULT_APP_THEME_MODE;
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

function themeStore(): ThemeStoreState {
  let store = themeStores.get(window);
  if (!store) {
    store = { mode: readStoredThemeMode() };
    themeStores.set(window, store);
  }
  return store;
}

function currentThemeMode(): AppThemeMode {
  return themeStore().mode;
}

function currentResolvedThemeMode(): ResolvedAppThemeMode {
  return resolveAppThemeMode(currentThemeMode(), systemPrefersDark());
}

function subscribeThemeMode(onStoreChange: () => void) {
  const applyCurrentAndNotify = () => {
    applyThemeMode(currentThemeMode());
    onStoreChange();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== APP_THEME_STORAGE_KEY) return;
    // Another tab persisted successfully, so storage is the source of
    // truth for this cross-tab sync (unlike our own change event below).
    themeStore().mode = readStoredThemeMode();
    applyCurrentAndNotify();
  };
  const onSystemThemeChange = () => {
    if (currentThemeMode() === "system") applyCurrentAndNotify();
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

function serverThemeModeSnapshot(): AppThemeMode {
  return DEFAULT_APP_THEME_MODE;
}

function serverResolvedThemeModeSnapshot(): ResolvedAppThemeMode {
  return "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const mode = useSyncExternalStore(
    subscribeThemeMode,
    currentThemeMode,
    serverThemeModeSnapshot,
  );
  const resolvedMode = useSyncExternalStore(
    subscribeThemeMode,
    currentResolvedThemeMode,
    serverResolvedThemeModeSnapshot,
  );

  const setMode = useCallback((nextMode: AppThemeMode) => {
    // The chosen mode is authoritative in memory first, so a broken/blocked
    // store can never revert it: persistence below is best-effort only, and
    // the change-event notification (via `subscribeThemeMode`) re-reads this
    // same in-memory store rather than storage.
    themeStore().mode = nextMode;
    writeStoredThemeMode(nextMode);
    applyThemeMode(nextMode);
    window.dispatchEvent(new Event(THEME_MODE_CHANGE_EVENT));
  }, []);

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
