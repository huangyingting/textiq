---
type: "architecture"
status: "current"
last_updated: "2026-07-31"
description: "The localization subsystem owns typed UI message catalogs, locale resolution, and the gate that keeps the language switcher hidden until enough user-facing surfaces are translated."
---

# Localization And I18n Activation

The localization subsystem owns typed UI message catalogs, locale resolution,
and the gate that keeps the language switcher hidden until enough user-facing
surfaces are translated.

## Source Anchors

| Area                  | Source                                                                               |
| --------------------- | ------------------------------------------------------------------------------------ |
| Locale registry       | [`src/lib/i18n/locales.ts`](../../src/lib/i18n/locales.ts)                           |
| Message catalogs      | [`src/lib/i18n/messages.ts`](../../src/lib/i18n/messages.ts)                         |
| Translator API        | [`src/lib/i18n/index.ts`](../../src/lib/i18n/index.ts)                               |
| Activation coverage   | [`src/lib/i18n/coverage.ts`](../../src/lib/i18n/coverage.ts)                         |
| Runtime switcher gate | [`src/lib/i18n/config.ts`](../../src/lib/i18n/config.ts)                             |
| Cookie contract       | [`src/lib/i18n/preferences.ts`](../../src/lib/i18n/preferences.ts)                   |
| Server locale         | [`src/lib/i18n/server.ts`](../../src/lib/i18n/server.ts)                             |
| Client locale context | [`src/lib/i18n/locale-context.tsx`](../../src/lib/i18n/locale-context.tsx)           |
| Language switcher UI  | [`src/components/language-switcher.tsx`](../../src/components/language-switcher.tsx) |

## Catalog Model

Locales, display names, and Intl locale tags are declared once in
`LOCALE_DEFINITIONS`; `SUPPORTED_LOCALES` is derived from that registry. The
current supported set is `en` and `es`, with `en` as the default locale.
Messages are grouped by owning surface, currently:

- app shell and header;
- dashboard;
- template picker;
- language switcher.

Each surface owns its TypeScript message shape. The merged `Messages` contract
and per-locale `catalog` are derived from `catalogBySurface`, so a new surface is
registered once rather than copied into a second merge list. Tests also reject
message-key collisions between surfaces.

## Activation Gate

The language switcher is behind two gates:

1. `I18N_SWITCHER_ENABLED=true` must be present at runtime.
2. `getI18nActivationStatus().userActivationReady` must be true.

Activation requires both 100% translated catalog coverage and a completed
source-migration certification for every required non-default locale. Catalog
coverage alone is not treated as proof that a surface has no remaining
hard-coded user copy. App shell, dashboard, and template picker remain
implementation-incomplete; the named uncatalogued blockers are document editor
core, import/export flows, and auth/billing settings.

This means partial catalog infrastructure can ship without exposing incomplete
locale selection to users.

## Locale Resolution

Server components and route handlers read `textiq-locale` from cookies through
`getLocale()`. Invalid or missing values fall back to the default locale. Client
components use the locale context and translator helpers instead of reading the
cookie directly. The server action treats its input as untrusted and accepts only
an exact supported locale; invalid values are rejected before the cookie store
is accessed. It writes the shared, HTTP-only cookie policy only after validation.
If persistence fails or the action rejects, the language switcher restores the
last confirmed locale, keeps the server tree unchanged, and displays an
accessible, dismissible retryable error instead of reporting success. A locale
write has one synchronous in-flight boundary, so repeated activation cannot
submit duplicate cookie mutations. Framework redirect and not-found control
flow remains owned by Next.js rather than being converted into persistence
feedback.

## Adding A Surface

When localizing a new surface:

1. Add a surface-owned message type in `messages.ts`.
2. Add default and non-default locale entries for that surface.
3. Register it in `catalogBySurface`; merged message types and catalogs derive
   automatically.
4. If it is required for public activation, include it in the coverage gate or
   remove the corresponding uncatalogued blocker.
5. Use `createTranslator(locale)` at the view-model or server/component boundary
   instead of scattering raw catalog reads.

## Invariants

1. Default-locale messages define the required key set.
2. Non-default locales must have non-empty values for required keys and the
   owning source surface must be fully migrated before user activation.
3. The env flag alone never exposes the switcher.
4. Locale cookie reads stay server-side; client code uses context.
5. Catalog keys are surface-owned and stable.
6. Locale metadata and cookie policy each have one canonical contract.

## Primary Tests

- [`src/lib/i18n/i18n.test.ts`](../../src/lib/i18n/i18n.test.ts)
