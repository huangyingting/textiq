import {
  BUILT_IN_THEME_PACKAGE_IDS,
  DEFAULT_BUILT_IN_THEME_PACKAGE_ID,
  isBuiltInThemePackageId,
  resolveBuiltInThemePackageId,
  type BuiltInThemePackageId,
} from "@/lib/presentation-shared/theme-package-ids";

export const THEME_PACKAGE_IDS = BUILT_IN_THEME_PACKAGE_IDS;
export const DEFAULT_THEME_PACKAGE_ID = DEFAULT_BUILT_IN_THEME_PACKAGE_ID;
export type ThemePackageId = BuiltInThemePackageId;
export const isThemePackageId = isBuiltInThemePackageId;
export const resolveThemePackageId = resolveBuiltInThemePackageId;
