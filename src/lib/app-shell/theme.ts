export const APP_THEME_STORAGE_KEY = "textiq.app-theme";
export const APP_THEME_COOKIE_KEY = "textiq.app-theme";

export const APP_THEME_MODES = [
  "system",
  "light",
  "dark",
  "ocean",
  "mint",
  "rose",
  "amber",
] as const;

export type AppThemeMode = (typeof APP_THEME_MODES)[number];
export type ResolvedAppThemeMode = "light" | "dark";

export const DEFAULT_APP_THEME_MODE: AppThemeMode = "system";

export function isAppThemeMode(value: unknown): value is AppThemeMode {
  return (
    typeof value === "string" &&
    (APP_THEME_MODES as readonly string[]).includes(value)
  );
}

export function normalizeAppThemeMode(value: unknown): AppThemeMode {
  return isAppThemeMode(value) ? value : DEFAULT_APP_THEME_MODE;
}

export function resolveAppThemeMode(
  mode: AppThemeMode,
  systemPrefersDark: boolean,
): ResolvedAppThemeMode {
  if (mode === "dark") return "dark";
  if (mode !== "system") return "light";
  return systemPrefersDark ? "dark" : "light";
}

export function nextAppThemeMode(mode: AppThemeMode): AppThemeMode {
  const index = APP_THEME_MODES.indexOf(mode);
  return APP_THEME_MODES[(index + 1) % APP_THEME_MODES.length];
}
