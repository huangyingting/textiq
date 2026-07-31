# UI matrix inventory

Type: test-strategy
Status: current
Last updated: 2026-07-18

This directory contains the source-backed Playwright UI matrix inventory, a generated 500-case catalog, and representative browser specs. The catalog is broader than the runnable browser subset so release planning can track manual, blocked, and future automated cases without turning E2E into a slow/flaky 500-browser-test suite.

## Sources reviewed

- `docs/import/README.md`
- `e2e/README.md` and existing `e2e/*.spec.ts` helpers
- `docs/system/design-system.md`
- `docs/editor/document-editor.md`
- `docs/editor/comments-and-anchors.md`
- `docs/presentation/README.md`
- `docs/presentation/slide-editor.md`
- `docs/presentation/slide-stage-interactions.md`
- `docs/presentation/rendering-and-export.md`
- `docs/presentation/assets.md`
- `docs/security/access-and-sharing.md`
- `docs/public-render/README.md`
- `docs/product/brand-studio.md`
- `docs/product/billing.md`

<!-- ui-matrix-inventory:start -->

## Source-backed catalog distribution

The 500-case catalog is generated from `e2e/ui-matrix/cases.ts`; this README section is rendered and checked by `scripts/check-ui-matrix-inventory.mjs`.

| Subsystem                  | Total | Automated | Manual | Blocked | Catalog |
| -------------------------- | ----- | --------- | ------ | ------- | ------- |
| auth-public                | 40    | 10        | 10     | 2       | 18      |
| document-editor            | 45    | 10        | 15     | 4       | 16      |
| presentation-editor        | 180   | 32        | 48     | 10      | 90      |
| presentation-render-export | 120   | 22        | 35     | 8       | 55      |
| public-render-share        | 60    | 14        | 16     | 4       | 26      |
| workspace-billing-brand    | 55    | 10        | 15     | 5       | 25      |
| Total                      | 500   | 98        | 139    | 33      | 230     |

`automated` means covered by a representative runnable spec in this directory or the deterministic profile. `manual` means human exploratory or release-gate validation is still expected. `blocked` means product hooks, deterministic fixture coverage, or stable selectors are missing. `catalog` means planned coverage that is not currently a release gate.

## Playwright spec inventory

The repository currently has 29 Playwright specs under `e2e/`. Every `e2e/**/*.spec.ts` file must appear here, and stale rows fail the inventory check.

| Run mode     | Specs |
| ------------ | ----- |
| advisory-ci  | 17    |
| opt-in-local | 11    |
| required-ci  | 1     |

| Spec                                                            | Owners                              | Run mode     | Prerequisites / gates                                                                               | Roles                                          | Devices / viewports                            | CI status                                  |
| --------------------------------------------------------------- | ----------------------------------- | ------------ | --------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- | ------------------------------------------ |
| `e2e/auth/auth-redirect.spec.ts`                                | auth, security                      | opt-in-local | `running app`                                                                                       | anonymous                                      | Desktop Chrome                                 | opt-in local/unrestricted Playwright suite |
| `e2e/auth/authenticated-nested-routes.spec.ts`                  | auth, editor, presentation, billing | advisory-ci  | `E2E_PROFILE=1`, `npm run db:seed:e2e`                                                              | seeded owner                                   | Desktop Chrome                                 | advisory deterministic E2E workflow        |
| `e2e/product/billing-brand.spec.ts`                             | billing, brand, product             | opt-in-local | `E2E_USER_EMAIL/PASSWORD`, `optional E2E_BRAND_FONT_URL`, `optional BILLING_UNLIMITED_CREDITS`      | owner                                          | Desktop Chrome                                 | opt-in local/staging only                  |
| `e2e/editor/block-id-preservation.spec.ts`                      | editor, presentation                | advisory-ci  | `E2E_PROFILE=1`, `npm run db:seed:e2e`                                                              | seeded owner                                   | Desktop Chrome                                 | advisory deterministic E2E workflow        |
| `e2e/editor/document-editor-profile.spec.ts`                    | editor, documents                   | advisory-ci  | `E2E_PROFILE=1`, `npm run db:seed:e2e`                                                              | seeded owner                                   | Desktop Chrome                                 | advisory deterministic E2E workflow        |
| `e2e/editor/document-table-autosave.spec.ts`                    | editor, documents, collaboration    | advisory-ci  | `E2E_PROFILE=1`, `npm run db:seed:e2e`                                                              | seeded owner                                   | Desktop Chrome                                 | advisory deterministic E2E workflow        |
| `e2e/import/import-roundtrip.spec.ts`                           | import, editor                      | required-ci  | `E2E_PROFILE=1`, `npm run db:seed:e2e`                                                              | seeded owner, seeded editor, seeded viewer     | Desktop Chrome                                 | required normal deterministic E2E workflow |
| `e2e/auth/oauth-disabled.spec.ts`                               | auth, security                      | opt-in-local | `running app`, `optional GOOGLE_CLIENT_ID/SECRET`                                                   | anonymous                                      | Desktop Chrome                                 | opt-in local/unrestricted Playwright suite |
| `e2e/presentation/focus-and-mobile-controls-regression.spec.ts` | presentation, accessibility         | advisory-ci  | `E2E_PROFILE=1`, `npm run db:seed:e2e`                                                              | seeded owner                                   | Desktop Chrome, 390x844 mobile, 412x915 mobile | advisory deterministic E2E workflow        |
| `e2e/presentation/present-export.spec.ts`                       | presentation, public-render         | advisory-ci  | `E2E_PROFILE=1`, `npm run db:seed:e2e`                                                              | seeded owner, seeded viewer, anonymous public  | Desktop Chrome, mobile viewport                | advisory deterministic E2E workflow        |
| `e2e/presentation/overlap-selection-regression.spec.ts`         | presentation, accessibility         | advisory-ci  | `E2E_PROFILE=1`, `npm run db:seed:e2e`                                                              | seeded owner                                   | Desktop Chrome                                 | advisory deterministic E2E workflow        |
| `e2e/presentation/pointer-interactions.spec.ts`                 | presentation, accessibility         | advisory-ci  | `E2E_PROFILE=1`, `npm run db:seed:e2e`                                                              | seeded owner                                   | Desktop Chrome                                 | advisory deterministic E2E workflow        |
| `e2e/presentation/presentation-controls.spec.ts`                | presentation, accessibility         | advisory-ci  | `E2E_PROFILE=1`, `npm run db:seed:e2e`                                                              | seeded owner                                   | Desktop Chrome                                 | advisory deterministic E2E workflow        |
| `e2e/public-render/public-pages.spec.ts`                        | system, public-render               | opt-in-local | `running app`                                                                                       | anonymous                                      | Desktop Chrome                                 | opt-in local/unrestricted Playwright suite |
| `e2e/visual/screenshot-regression.spec.ts`                      | presentation, visual, operations    | opt-in-local | `E2E_SCREENSHOT_REGRESSION=1`, `running app`, `snapshot baselines`                                  | anonymous, fixture routes                      | Desktop Chrome, fixed slide viewport           | opt-in local visual comparison             |
| `e2e/public-render/share-fallback.spec.ts`                      | public-render, security             | opt-in-local | `running app`                                                                                       | anonymous                                      | Desktop Chrome, request API                    | opt-in local/unrestricted Playwright suite |
| `e2e/presentation/slide-asset-upload.spec.ts`                   | presentation, security              | advisory-ci  | `E2E_PROFILE=1`, `npm run db:seed:e2e`                                                              | seeded owner, seeded viewer, anonymous public  | Desktop Chrome, request API                    | advisory deterministic E2E workflow        |
| `e2e/presentation/slide-delete-persistence.spec.ts`             | presentation, collaboration         | advisory-ci  | `E2E_PROFILE=1`, `npm run db:seed:e2e`                                                              | seeded owner                                   | Desktop Chrome                                 | advisory deterministic E2E workflow        |
| `e2e/presentation/slides-layout-screenshots.spec.ts`            | presentation, visual                | advisory-ci  | `E2E_PROFILE=1 or E2E_SLIDES_LAYOUT_SCREENSHOTS=1`, `npm run db:seed:e2e or E2E_SLIDES_EDITOR_PATH` | seeded owner                                   | desktop, tablet, mobile                        | advisory deterministic E2E workflow        |
| `e2e/presentation/slides-smoke.spec.ts`                         | presentation                        | advisory-ci  | `E2E_PROFILE=1 for mutating coverage`, `optional E2E_USER_EMAIL/PASSWORD and E2E_SLIDES_DOC_URL`    | seeded owner, owner, anonymous fallback routes | Desktop Chrome                                 | advisory deterministic E2E workflow        |
| `e2e/presentation/slides-conflict-recovery.spec.ts`             | presentation, collaboration         | advisory-ci  | `E2E_PROFILE=1`, `npm run db:seed:e2e`                                                              | seeded owner in two isolated sessions          | Desktop Chrome                                 | advisory deterministic E2E workflow        |
| `e2e/presentation/touch-controls.spec.ts`                       | presentation, accessibility         | advisory-ci  | `E2E_PROFILE=1`, `npm run db:seed:e2e`                                                              | seeded owner                                   | Chromium touch 390x844                         | advisory deterministic E2E workflow        |
| `e2e/ui-matrix/auth-public-ui.spec.ts`                          | auth, public-render, system         | opt-in-local | `running app`, `optional GOOGLE_CLIENT_ID/SECRET`                                                   | anonymous                                      | Desktop Chrome                                 | explicit UI matrix browser run only        |
| `e2e/ui-matrix/catalog.spec.ts`                                 | operations, presentation, ui        | advisory-ci  | `none beyond Playwright test runner`                                                                | not browser-flow-specific                      | Playwright runner only                         | advisory deterministic E2E workflow        |
| `e2e/ui-matrix/document-editor-ui.spec.ts`                      | editor, documents                   | opt-in-local | `E2E_PROFILE=1`, `npm run db:seed:e2e`                                                              | seeded owner, seeded viewer                    | Desktop Chrome                                 | explicit UI matrix browser run only        |
| `e2e/ui-matrix/presentation-ui.spec.ts`                         | presentation, public-render         | advisory-ci  | `E2E_PROFILE=1`, `npm run db:seed:e2e`                                                              | seeded owner, anonymous public                 | Desktop Chrome                                 | advisory deterministic E2E workflow        |
| `e2e/ui-matrix/public-render-ui.spec.ts`                        | public-render, security             | opt-in-local | `E2E_PROFILE=1`, `npm run db:seed:e2e`                                                              | anonymous public, request API                  | Desktop Chrome                                 | explicit UI matrix browser run only        |
| `e2e/ui-matrix/workspace-billing-brand-ui.spec.ts`              | workspace, billing, brand           | opt-in-local | `E2E_PROFILE=1`, `npm run db:seed:e2e`, `optional BILLING_UNLIMITED_CREDITS`                        | seeded owner                                   | Desktop Chrome                                 | explicit UI matrix browser run only        |
| `e2e/workspace/workspace.spec.ts`                               | workspace, documents                | opt-in-local | `E2E_USER_EMAIL/PASSWORD`, `optional E2E_VIEWER_*`, `optional E2E_VIEWER_DOC_URL`                   | owner, viewer                                  | Desktop Chrome                                 | opt-in local/staging only                  |

## Mapped deterministic tests

These test-level rows record exact Playwright identity and execution metadata for deterministic coverage that must not drift back to manual or advisory classification.

| Spec                                  | Test                                                                                 | Surface                                          | Viewport       | Auth         | Profile                                      | CI tier  | Status    |
| ------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------ | -------------- | ------------ | -------------------------------------------- | -------- | --------- |
| `e2e/import/import-roundtrip.spec.ts` | `imports DOCX, renders blocks, and persists content across reload @required-profile` | dashboard import → document editor render/reload | Desktop Chrome | seeded owner | normal deterministic profile (E2E_PROFILE=1) | required | automated |

## Authoritative test registration contracts

Mapped specs with an exact contract must contain only the proven Playwright registrations below. Dynamic or otherwise unresolved registrations fail the scanner instead of being ignored.

| Spec                                  | Test identity                                                          | Profiles                                    |
| ------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------- |
| `e2e/import/import-roundtrip.spec.ts` | `imports Markdown, renders blocks, and persists content across reload` | `deterministic-profile`, `required-profile` |
| `e2e/import/import-roundtrip.spec.ts` | `imports DOCX, renders blocks, and persists content across reload`     | `deterministic-profile`, `required-profile` |
| `e2e/import/import-roundtrip.spec.ts` | `workspace import by owner persists across reload`                     | `deterministic-profile`, `required-profile` |
| `e2e/import/import-roundtrip.spec.ts` | `workspace import by editor persists across reload`                    | `deterministic-profile`, `required-profile` |
| `e2e/import/import-roundtrip.spec.ts` | `workspace import by viewer is forbidden and creates zero documents`   | `deterministic-profile`, `required-profile` |
| `e2e/import/import-roundtrip.spec.ts` | `rejects an unsupported file type with a graceful error`               | `deterministic-profile`                     |

## Known manual, blocked, and catalog gaps

| ID                      | Owner     | Status  | Gap                                                                                                                                                                  | Sources                                             |
| ----------------------- | --------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| FULL-500-BROWSER-MATRIX | ui matrix | catalog | The 500-case catalog is intentionally not expanded into 500 browser tests; representative automated slices are promoted only when fixtures and selectors are stable. | `e2e/ui-matrix/cases.ts`, `e2e/ui-matrix/README.md` |

## Drift guard

Run `npm run ui-matrix:check` after adding, renaming, or removing any `e2e/**/*.spec.ts` file. Use `npm run ui-matrix:write` to refresh this generated README section after changing `e2e/ui-matrix/inventory.ts` or `e2e/ui-matrix/cases.ts`.
<!-- ui-matrix-inventory:end -->

## Execution

The normal deterministic profile selects the configured profile spec set, including the DOCX round-trip in `e2e/import/import-roundtrip.spec.ts`. Its describe-level skip applies only outside `E2E_PROFILE=1`, so DOCX is not an intentional skip in the normal profile. Required CI narrows that set with `E2E_PROFILE_GREP=@required-profile`; the DOCX test carries that annotation and gates the workflow. Run the remaining representative browser matrix explicitly when validating UI surfaces:

The import spec contract is exactly six proven registrations: one DOCX case, four other required-profile cases, and one deterministic-profile-only unsupported-file case. The scanner rejects missing, renamed, duplicate, extra, or reclassified tests. Static Playwright namespace destructuring declarations and assignments preserve registration provenance, including computed string-literal methods such as `test["only"]`; computed unknown methods, ambiguous/rest/default/nested destructuring, dynamic imports, binding or property mutations, reassigned or unknown aliases, wrapper registrations with unresolved titles, and other nonliteral titles produce `unsupported-test-registration`. Mutation invalidation is sticky, while scope-proven local functions and namespace-shaped objects remain outside the Playwright inventory.

```bash
DB_PROVIDER=sqlite DATABASE_URL="file:./prisma/dev.db" AUTH_SECRET=browser-qa-placeholder-secret E2E_PROFILE=1 BILLING_UNLIMITED_CREDITS=1 npm run test:e2e:profile -- e2e/ui-matrix/*.spec.ts
```

Do not run the full 500 catalog as individual browser scenarios. Promote cases from `manual`, `blocked`, or `catalog` to `automated` only when deterministic fixtures, stable roles/labels, and readiness signals exist.
