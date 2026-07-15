export const LOCALE_DEFINITIONS = [
  {
    locale: "en",
    displayName: "English",
    intlLocale: "en-US",
  },
  {
    locale: "es",
    displayName: "Español",
    intlLocale: "es",
  },
] as const;

export type Locale = (typeof LOCALE_DEFINITIONS)[number]["locale"];
export type LocaleDefinition = (typeof LOCALE_DEFINITIONS)[number];

export const SUPPORTED_LOCALES: readonly Locale[] = LOCALE_DEFINITIONS.map(
  ({ locale }) => locale,
);

export const DEFAULT_LOCALE: Locale = "en";

export function getLocaleDefinition(locale: Locale): LocaleDefinition {
  const definition = LOCALE_DEFINITIONS.find(
    (candidate) => candidate.locale === locale,
  );
  if (!definition) {
    throw new Error(`Missing locale definition for "${locale}"`);
  }
  return definition;
}
