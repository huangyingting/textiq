/** Surface-owned message catalogs for the TextIQ UI. */

export const SUPPORTED_LOCALES = ["en", "es"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

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
};

export type LanguageSwitcherMessages = {
  "languageSwitcher.label": string;
  "languageSwitcher.selectLanguage": string;
};

export type Messages = AppShellMessages &
  DashboardMessages &
  TemplatePickerMessages &
  LanguageSwitcherMessages;

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
  },
  es: {
    "templatePicker.title": "Crear nuevo documento",
    "templatePicker.subtitle": "Elige una plantilla o empieza en blanco.",
    "templatePicker.cancel": "Cancelar",
    "templatePicker.creating": "Creando…",
    "templatePicker.close": "Cerrar",
  },
};

const languageSwitcherMessages: Record<Locale, LanguageSwitcherMessages> = {
  en: {
    "languageSwitcher.label": "Language",
    "languageSwitcher.selectLanguage": "Select language",
  },
  es: {
    "languageSwitcher.label": "Idioma",
    "languageSwitcher.selectLanguage": "Seleccionar idioma",
  },
};

export const catalogBySurface = {
  appShell: appShellMessages,
  dashboard: dashboardMessages,
  templatePicker: templatePickerMessages,
  languageSwitcher: languageSwitcherMessages,
};

export type I18nCatalogSurface = keyof typeof catalogBySurface;

/* node:coverage disable */
/* Catalog surface keys are asserted by i18n coverage tests; tsx maps Object.keys typing as uncovered. */
export const I18N_CATALOG_SURFACES = Object.keys(
  catalogBySurface,
) as I18nCatalogSurface[];
/* node:coverage enable */

function mergeMessages(locale: Locale): Messages {
  return {
    ...catalogBySurface.appShell[locale],
    ...catalogBySurface.dashboard[locale],
    ...catalogBySurface.templatePicker[locale],
    ...catalogBySurface.languageSwitcher[locale],
  };
}

export const catalog: Record<Locale, Messages> = {
  en: mergeMessages("en"),
  es: mergeMessages("es"),
};
