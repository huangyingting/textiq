/** Surface-owned message catalogs for the TextIQ UI. */

import { SUPPORTED_LOCALES, type Locale } from "./locales";

export type AppShellMessages = {
  "header.brand": string;
  "header.nav.documents": string;
  "header.nav.workspaces": string;
  "header.nav.brands": string;
  "header.nav.login": string;
  "header.nav.signup": string;
};

export type DashboardMessages = {
  "dashboard.title": string;
  "dashboard.subtitle": (email: string) => string;
  "dashboard.action.newDocument": string;
  "dashboard.action.import": string;
  "dashboard.action.importing": string;
};

export type TemplatePickerMessages = {
  "templatePicker.title": string;
  "templatePicker.subtitle": string;
  "templatePicker.cancel": string;
  "templatePicker.creating": string;
  "templatePicker.close": string;
  "templatePicker.creationError": string;
  "templatePicker.tryAgain": string;
  "templatePicker.dismissError": string;
};

export type LanguageSwitcherMessages = {
  "languageSwitcher.label": string;
  "languageSwitcher.selectLanguage": string;
  "languageSwitcher.persistenceError": string;
};

const appShellMessages: Record<Locale, AppShellMessages> = {
  en: {
    "header.brand": "TextIQ",
    "header.nav.documents": "Documents",
    "header.nav.workspaces": "Workspaces",
    "header.nav.brands": "Brands",
    "header.nav.login": "Log in",
    "header.nav.signup": "Sign up",
  },
  es: {
    "header.brand": "TextIQ",
    "header.nav.documents": "Documentos",
    "header.nav.workspaces": "Espacios de trabajo",
    "header.nav.brands": "Marcas",
    "header.nav.login": "Iniciar sesión",
    "header.nav.signup": "Registrarse",
  },
};

const dashboardMessages: Record<Locale, DashboardMessages> = {
  en: {
    "dashboard.title": "Your documents",
    "dashboard.subtitle": (email) => `Signed in as ${email}`,
    "dashboard.action.newDocument": "New document",
    "dashboard.action.import": "Import",
    "dashboard.action.importing": "Importing…",
  },
  es: {
    "dashboard.title": "Tus documentos",
    "dashboard.subtitle": (email) => `Sesión iniciada como ${email}`,
    "dashboard.action.newDocument": "Nuevo documento",
    "dashboard.action.import": "Importar",
    "dashboard.action.importing": "Importando…",
  },
};

const templatePickerMessages: Record<Locale, TemplatePickerMessages> = {
  en: {
    "templatePicker.title": "Start a new document",
    "templatePicker.subtitle": "Pick a template or start blank.",
    "templatePicker.cancel": "Cancel",
    "templatePicker.creating": "Creating…",
    "templatePicker.close": "Close",
    "templatePicker.creationError":
      "Could not create the document. Please try again.",
    "templatePicker.tryAgain": "Try again",
    "templatePicker.dismissError": "Dismiss error",
  },
  es: {
    "templatePicker.title": "Crear nuevo documento",
    "templatePicker.subtitle": "Elige una plantilla o empieza en blanco.",
    "templatePicker.cancel": "Cancelar",
    "templatePicker.creating": "Creando…",
    "templatePicker.close": "Cerrar",
    "templatePicker.creationError":
      "No se pudo crear el documento. Inténtalo de nuevo.",
    "templatePicker.tryAgain": "Intentar de nuevo",
    "templatePicker.dismissError": "Descartar error",
  },
};

const languageSwitcherMessages: Record<Locale, LanguageSwitcherMessages> = {
  en: {
    "languageSwitcher.label": "Language",
    "languageSwitcher.selectLanguage": "Select language",
    "languageSwitcher.persistenceError":
      "Unable to save your language preference. Please try again.",
  },
  es: {
    "languageSwitcher.label": "Idioma",
    "languageSwitcher.selectLanguage": "Seleccionar idioma",
    "languageSwitcher.persistenceError":
      "No se pudo guardar tu preferencia de idioma. Inténtalo de nuevo.",
  },
};

export const catalogBySurface = {
  appShell: appShellMessages,
  dashboard: dashboardMessages,
  templatePicker: templatePickerMessages,
  languageSwitcher: languageSwitcherMessages,
};

export type I18nCatalogSurface = keyof typeof catalogBySurface;

type SurfaceMessages = (typeof catalogBySurface)[I18nCatalogSurface][Locale];
type UnionToIntersection<T> = (
  T extends unknown ? (value: T) => void : never
) extends (value: infer Intersection) => void
  ? Intersection
  : never;

export type Messages = UnionToIntersection<SurfaceMessages>;

/* node:coverage disable */
/* Catalog surface keys are asserted by i18n coverage tests; tsx maps Object.keys typing as uncovered. */
export const I18N_CATALOG_SURFACES = Object.keys(
  catalogBySurface,
) as I18nCatalogSurface[];
/* node:coverage enable */

function mergeMessages(locale: Locale): Messages {
  return Object.assign(
    {},
    ...I18N_CATALOG_SURFACES.map(
      (surface) => catalogBySurface[surface][locale],
    ),
  ) as Messages;
}

export const catalog = Object.fromEntries(
  SUPPORTED_LOCALES.map((locale) => [locale, mergeMessages(locale)]),
) as Record<Locale, Messages>;
