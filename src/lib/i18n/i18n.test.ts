import assert from "node:assert/strict";
import test from "node:test";

import {
  catalogBySurface,
  createTranslator,
  DEFAULT_LOCALE,
  getI18nActivationStatus,
  getI18nCoverageBySurface,
  getLocaleDefinition,
  getMessages,
  I18N_ACTIVATION_REQUIRED_SURFACES,
  I18N_USER_ACTIVATION_THRESHOLD,
  isSupportedLocale,
  LOCALE_DEFINITIONS,
  normaliseLocale,
  SUPPORTED_LOCALES,
} from "@/lib/i18n";
import { isLanguageSwitcherEnabled } from "@/lib/i18n/config";

// ── isSupportedLocale ────────────────────────────────────────────────────────

test("isSupportedLocale accepts every listed locale", () => {
  for (const locale of SUPPORTED_LOCALES) {
    assert.ok(
      isSupportedLocale(locale),
      `expected "${locale}" to be supported`,
    );
  }
});

test("isSupportedLocale rejects unknown values", () => {
  for (const bad of ["de", "fr", "zh", "", null, undefined, 42, {}]) {
    assert.equal(
      isSupportedLocale(bad),
      false,
      `expected "${String(bad)}" to be unsupported`,
    );
  }
});

test("locale definitions are the canonical ordered supported-locale registry", () => {
  assert.deepEqual(
    LOCALE_DEFINITIONS.map(({ locale }) => locale),
    SUPPORTED_LOCALES,
  );
  assert.deepEqual(getLocaleDefinition("en"), {
    locale: "en",
    displayName: "English",
    intlLocale: "en-US",
  });
  assert.deepEqual(getLocaleDefinition("es"), {
    locale: "es",
    displayName: "Español",
    intlLocale: "es",
  });
});

// ── normaliseLocale ──────────────────────────────────────────────────────────

test("normaliseLocale returns the locale as-is when it is a valid exact match", () => {
  assert.equal(normaliseLocale("en"), "en");
  assert.equal(normaliseLocale("es"), "es");
});

test("normaliseLocale strips BCP-47 region subtags", () => {
  assert.equal(normaliseLocale("en-US"), "en");
  assert.equal(normaliseLocale("en-GB"), "en");
  assert.equal(normaliseLocale("es-419"), "es");
  assert.equal(normaliseLocale("es_MX"), "es");
});

test("normaliseLocale falls back to DEFAULT_LOCALE for unrecognised input", () => {
  assert.equal(normaliseLocale("de"), DEFAULT_LOCALE);
  assert.equal(normaliseLocale("fr-FR"), DEFAULT_LOCALE);
  assert.equal(normaliseLocale(""), DEFAULT_LOCALE);
  assert.equal(normaliseLocale(null), DEFAULT_LOCALE);
  assert.equal(normaliseLocale(undefined), DEFAULT_LOCALE);
  assert.equal(normaliseLocale(42), DEFAULT_LOCALE);
  assert.equal(normaliseLocale({ locale: "es" }), DEFAULT_LOCALE);
});

// ── getMessages ──────────────────────────────────────────────────────────────

test("getMessages returns a messages object for each supported locale", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const messages = getMessages(locale);
    assert.ok(
      typeof messages === "object" && messages !== null,
      `expected messages object for "${locale}"`,
    );
  }
});

test("getMessages objects expose all required keys", () => {
  const requiredKeys = [
    "header.brand",
    "header.nav.documents",
    "header.nav.login",
    "header.nav.signup",
    "dashboard.title",
    "dashboard.subtitle",
    "dashboard.action.newDocument",
    "languageSwitcher.label",
    "languageSwitcher.selectLanguage",
  ] as const;

  for (const locale of SUPPORTED_LOCALES) {
    const messages = getMessages(locale);
    for (const key of requiredKeys) {
      assert.ok(key in messages, `locale "${locale}" is missing key "${key}"`);
    }
  }
});

test("catalog is split into surface-owned sections", () => {
  assert.deepEqual(Object.keys(catalogBySurface), [
    "appShell",
    "dashboard",
    "templatePicker",
    "languageSwitcher",
  ]);
  assert.equal(
    catalogBySurface.dashboard.en["dashboard.title"],
    "Your documents",
  );
  assert.equal(
    catalogBySurface.appShell.es["header.nav.documents"],
    "Documentos",
  );
});

test("merged locale catalogs contain every surface-owned message exactly once", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const expected = Object.assign(
      {},
      ...Object.values(catalogBySurface).map((surface) => surface[locale]),
    );
    const surfaceKeyCount = Object.values(catalogBySurface).reduce(
      (count, surface) => count + Object.keys(surface[locale]).length,
      0,
    );
    assert.equal(Object.keys(expected).length, surfaceKeyCount);
    assert.deepEqual(getMessages(locale), expected);
  }
});

// ── createTranslator / t() ───────────────────────────────────────────────────

test("t() returns a string for a plain string key", () => {
  const t = createTranslator("en");
  const result = t("header.brand");
  assert.equal(typeof result, "string");
  assert.ok(result.length > 0);
});

test("t() returns the locale-specific string for a known locale", () => {
  const en = createTranslator("en");
  const es = createTranslator("es");

  // nav.documents should be different across the two locales
  assert.notEqual(en("header.nav.documents"), es("header.nav.documents"));
});

test("t() handles function-type messages with interpolation", () => {
  const en = createTranslator("en");
  const result = en("dashboard.subtitle", "user@example.com");
  assert.ok(
    result.includes("user@example.com"),
    `expected email in result, got: ${result}`,
  );
});

test("t() localised function-type messages include the argument", () => {
  const es = createTranslator("es");
  const result = es("dashboard.subtitle", "usuario@ejemplo.com");
  assert.ok(
    result.includes("usuario@ejemplo.com"),
    `expected email in localised result, got: ${result}`,
  );
});

test("t() for DEFAULT_LOCALE returns English strings", () => {
  const t = createTranslator(DEFAULT_LOCALE);
  assert.equal(t("header.nav.login"), "Log in");
  assert.equal(t("dashboard.action.newDocument"), "New document");
});

test("t() returns a non-empty string for every key in every locale", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const t = createTranslator(locale);
    const enMessages = getMessages("en");
    for (const key of Object.keys(enMessages) as (keyof typeof enMessages)[]) {
      const enValue = enMessages[key];
      // Call with a dummy email arg for function-type keys
      const result =
        typeof enValue === "function"
          ? t(key as "dashboard.subtitle", "test@example.com")
          : t(key as "header.brand");
      assert.ok(
        typeof result === "string" && result.length > 0,
        `locale "${locale}" key "${key}" produced empty result`,
      );
    }
  }
});

// ── i18n coverage / activation ────────────────────────────────────────────────

test("getI18nCoverageBySurface distinguishes catalog translation from source migration", () => {
  const coverage = getI18nCoverageBySurface("es");
  const dashboard = coverage.find((row) => row.surface === "dashboard");

  assert.ok(dashboard);
  assert.equal(dashboard.catalogued, true);
  assert.equal(dashboard.translatedMessages, dashboard.totalMessages);
  assert.equal(dashboard.catalogComplete, true);
  assert.equal(dashboard.implementationComplete, false);
  assert.equal(dashboard.complete, false);
});

test("getI18nActivationStatus keeps user activation blocked until required surfaces are translated", () => {
  const status = getI18nActivationStatus();

  assert.equal(status.threshold, I18N_USER_ACTIVATION_THRESHOLD);
  assert.equal(status.userActivationReady, false);
  assert.deepEqual(status.requiredSurfaces, I18N_ACTIVATION_REQUIRED_SURFACES);
  assert.ok(
    status.blockingSurfaces.some(
      (surface) =>
        surface.surface === "documentEditor" && surface.catalogued === false,
    ),
  );
  assert.ok(
    status.blockingSurfaces.some(
      (surface) =>
        surface.surface === "dashboard" &&
        surface.catalogued === true &&
        surface.implementationComplete === false,
    ),
  );
});

// ── isLanguageSwitcherEnabled ─────────────────────────────────────────────────

test("isLanguageSwitcherEnabled returns false when env var is absent", () => {
  assert.equal(isLanguageSwitcherEnabled({}), false);
});

test('isLanguageSwitcherEnabled remains false when env var is "true" but activation threshold is not met', () => {
  assert.equal(
    isLanguageSwitcherEnabled({ I18N_SWITCHER_ENABLED: "true" }),
    false,
  );
});

test('isLanguageSwitcherEnabled returns true only when env var is "true" and activation is ready', () => {
  const readyStatus = {
    ...getI18nActivationStatus(),
    userActivationReady: true,
    blockingSurfaces: [],
  };

  assert.equal(
    isLanguageSwitcherEnabled({ I18N_SWITCHER_ENABLED: "true" }, readyStatus),
    true,
  );
});

test("isLanguageSwitcherEnabled returns false for truthy non-exact values", () => {
  for (const val of ["1", "yes", "TRUE", "True", "on"]) {
    assert.equal(
      isLanguageSwitcherEnabled({ I18N_SWITCHER_ENABLED: val }),
      false,
      `expected false for I18N_SWITCHER_ENABLED="${val}"`,
    );
  }
});
