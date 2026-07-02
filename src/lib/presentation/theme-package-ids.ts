/**
 * Built-in theme package identity catalog for presentation package resolution
 * and the prototype package generator.
 */

export const BUILT_IN_THEME_PACKAGE_IDS = [
  "clarity",
  "ocean",
  "aurora",
  "monolith",
  "editorial",
  "noir",
  "terra",
  "pulse",
] as const;

export type BuiltInThemePackageId = (typeof BUILT_IN_THEME_PACKAGE_IDS)[number];

export const DEFAULT_BUILT_IN_THEME_PACKAGE_ID: BuiltInThemePackageId =
  "clarity";
export const THEME_PACKAGE_IDS = BUILT_IN_THEME_PACKAGE_IDS;
export const DEFAULT_THEME_PACKAGE_ID = DEFAULT_BUILT_IN_THEME_PACKAGE_ID;
export type ThemePackageId = BuiltInThemePackageId;

export const BUILT_IN_THEME_PACKAGE_ALIASES: Readonly<
  Record<string, BuiltInThemePackageId>
> = {
  default: DEFAULT_BUILT_IN_THEME_PACKAGE_ID,
};

const BUILT_IN_THEME_PACKAGE_ID_SET = new Set<string>(
  BUILT_IN_THEME_PACKAGE_IDS,
);

export function isBuiltInThemePackageId(
  value: unknown,
): value is BuiltInThemePackageId {
  return typeof value === "string" && BUILT_IN_THEME_PACKAGE_ID_SET.has(value);
}
export const isThemePackageId = isBuiltInThemePackageId;

export function resolveBuiltInThemePackageId(
  packageId: string,
): BuiltInThemePackageId | undefined {
  if (isBuiltInThemePackageId(packageId)) return packageId;
  return BUILT_IN_THEME_PACKAGE_ALIASES[packageId];
}
export const resolveThemePackageId = resolveBuiltInThemePackageId;
