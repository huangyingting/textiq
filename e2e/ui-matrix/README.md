# UI matrix inventory

Type: test-strategy
Status: current
Last updated: 2026-07-04

This directory contains the source-backed Playwright UI matrix inventory, a generated 500-case catalog, and representative browser specs. The catalog is broader than the runnable browser subset so release planning can track manual, blocked, and future automated cases without turning E2E into a slow/flaky 500-browser-test suite.

## Sources reviewed

- `docs/codebase/TESTING.md`
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

The repository currently has 21 Playwright specs under `e2e/`. Every `e2e/**/*.spec.ts` file must appear here, and stale rows fail the inventory check.

| Run mode     | Specs |
| ------------ | ----- |
| advisory-ci  | 7     |
| opt-in-local | 14    |

| Spec                                               | Owners                              | Run mode     | Prerequisites / gates                                                                               | Roles                                         | Devices / viewports                  | CI status                           |
| -------------------------------------------------- | ----------------------------------- | ------------ | --------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------ | ----------------------------------- |
| `e2e/auth-redirect.spec.ts`                        | auth, security                      | opt-in-local | `running app`                                                                                       | anonymous                                     | Desktop Chrome                       | opt-in local/full Playwright suite  |
| `e2e/authenticated-nested-routes.spec.ts`          | auth, editor, presentation, billing | advisory-ci  | `E2E_PROFILE=1`, `npm run db:seed:e2e`                                                              | seeded owner                                  | Desktop Chrome                       | advisory deterministic E2E workflow |
| `e2e/billing-brand.spec.ts`                        | billing, brand, product             | opt-in-local | `E2E_USER_EMAIL/PASSWORD`, `optional E2E_BRAND_FONT_URL`, `optional BILLING_UNLIMITED_CREDITS`      | owner                                         | Desktop Chrome                       | opt-in local/staging only           |
| `e2e/block-id-preservation.spec.ts`                | editor, presentation                | opt-in-local | `E2E_USER_EMAIL/PASSWORD`, `E2E_BLOCK_ID_DOC_URL`                                                   | owner                                         | Desktop Chrome                       | manual fixture-backed local run     |
| `e2e/document-editor-profile.spec.ts`              | editor, documents                   | advisory-ci  | `E2E_PROFILE=1`, `npm run db:seed:e2e`                                                              | seeded owner                                  | Desktop Chrome                       | advisory deterministic E2E workflow |
| `e2e/import-roundtrip.spec.ts`                     | import, editor                      | advisory-ci  | `E2E_PROFILE=1`, `npm run db:seed:e2e`                                                              | seeded owner, anonymous request API           | Desktop Chrome                       | advisory deterministic E2E workflow |
| `e2e/oauth-disabled.spec.ts`                       | auth, security                      | opt-in-local | `running app`, `optional GOOGLE_CLIENT_ID/SECRET`                                                   | anonymous                                     | Desktop Chrome                       | opt-in local/full Playwright suite  |
| `e2e/present-export.spec.ts`                       | presentation, public-render         | advisory-ci  | `E2E_PROFILE=1`, `npm run db:seed:e2e`                                                              | seeded owner, seeded viewer, anonymous public | Desktop Chrome, mobile viewport      | advisory deterministic E2E workflow |
| `e2e/public-pages.spec.ts`                         | system, public-render               | opt-in-local | `running app`                                                                                       | anonymous                                     | Desktop Chrome                       | opt-in local/full Playwright suite  |
| `e2e/screenshot-regression.spec.ts`                | presentation, visual, operations    | opt-in-local | `E2E_SCREENSHOT_REGRESSION=1`, `running app`, `snapshot baselines`                                  | anonymous, fixture routes                     | Desktop Chrome, fixed slide viewport | opt-in local visual comparison      |
| `e2e/share-fallback.spec.ts`                       | public-render, security             | opt-in-local | `running app`                                                                                       | anonymous                                     | Desktop Chrome, request API          | opt-in local/full Playwright suite  |
| `e2e/slide-asset-upload.spec.ts`                   | presentation, security              | advisory-ci  | `E2E_PROFILE=1`, `npm run db:seed:e2e`                                                              | seeded owner, seeded viewer, anonymous public | Desktop Chrome, request API          | advisory deterministic E2E workflow |
| `e2e/slides-layout-screenshots.spec.ts`            | presentation, visual                | advisory-ci  | `E2E_PROFILE=1 or E2E_SLIDES_LAYOUT_SCREENSHOTS=1`, `npm run db:seed:e2e or E2E_SLIDES_EDITOR_PATH` | seeded owner                                  | desktop, tablet, mobile              | advisory deterministic E2E workflow |
| `e2e/slides-smoke.spec.ts`                         | presentation                        | opt-in-local | `E2E_USER_EMAIL/PASSWORD`, `E2E_SLIDES_DOC_URL`                                                     | owner, anonymous fallback routes              | Desktop Chrome                       | opt-in local/staging only           |
| `e2e/ui-matrix/auth-public-ui.spec.ts`             | auth, public-render, system         | opt-in-local | `running app`, `optional GOOGLE_CLIENT_ID/SECRET`                                                   | anonymous                                     | Desktop Chrome                       | explicit UI matrix browser run only |
| `e2e/ui-matrix/catalog.spec.ts`                    | operations, presentation, ui        | advisory-ci  | `none beyond Playwright test runner`                                                                | not browser-flow-specific                     | Playwright runner only               | advisory deterministic E2E workflow |
| `e2e/ui-matrix/document-editor-ui.spec.ts`         | editor, documents                   | opt-in-local | `E2E_PROFILE=1`, `npm run db:seed:e2e`                                                              | seeded owner, seeded viewer                   | Desktop Chrome                       | explicit UI matrix browser run only |
| `e2e/ui-matrix/presentation-ui.spec.ts`            | presentation, public-render         | opt-in-local | `E2E_PROFILE=1`, `npm run db:seed:e2e`                                                              | seeded owner, anonymous public                | Desktop Chrome                       | explicit UI matrix browser run only |
| `e2e/ui-matrix/public-render-ui.spec.ts`           | public-render, security             | opt-in-local | `E2E_PROFILE=1`, `npm run db:seed:e2e`                                                              | anonymous public, request API                 | Desktop Chrome                       | explicit UI matrix browser run only |
| `e2e/ui-matrix/workspace-billing-brand-ui.spec.ts` | workspace, billing, brand           | opt-in-local | `E2E_PROFILE=1`, `npm run db:seed:e2e`, `optional BILLING_UNLIMITED_CREDITS`                        | seeded owner                                  | Desktop Chrome                       | explicit UI matrix browser run only |
| `e2e/workspace.spec.ts`                            | workspace, documents                | opt-in-local | `E2E_USER_EMAIL/PASSWORD`, `optional E2E_VIEWER_*`, `optional E2E_VIEWER_DOC_URL`                   | owner, viewer                                 | Desktop Chrome                       | opt-in local/staging only           |

## Known manual, blocked, and catalog gaps

| ID                       | Owner               | Status  | Gap                                                                                                                                                                  | Sources                                                               |
| ------------------------ | ------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| DOCX-UI-ROUNDTRIP        | import              | manual  | DOCX import is parser-tested but remains a manual UI round-trip because binary fixtures are not maintained in-repo.                                                  | `e2e/README.md`, `docs/codebase/TESTING.md`                           |
| BLOCK-ID-DEEP-ASSERTIONS | editor/presentation | blocked | Block-id preservation spec currently exercises fixture reachability; persisted bid/sourceRef assertions need stable diagnostics hooks.                               | `e2e/block-id-preservation.spec.ts`, `docs/editor/document-editor.md` |
| FULL-500-BROWSER-MATRIX  | ui matrix           | catalog | The 500-case catalog is intentionally not expanded into 500 browser tests; representative automated slices are promoted only when fixtures and selectors are stable. | `e2e/ui-matrix/cases.ts`, `e2e/ui-matrix/README.md`                   |

## Drift guard

Run `npm run ui-matrix:check` after adding, renaming, or removing any `e2e/**/*.spec.ts` file. Use `npm run ui-matrix:write` to refresh this generated README section after changing `e2e/ui-matrix/inventory.ts` or `e2e/ui-matrix/cases.ts`.

<!-- ui-matrix-inventory:end -->

## Execution

The default deterministic profile validates only `catalog.spec.ts` so the advisory CI profile stays bounded while still guarding the 500-case catalog. Run the browser matrix explicitly when validating representative UI surfaces:

```bash
DB_PROVIDER=sqlite DATABASE_URL="file:./prisma/dev.db" AUTH_SECRET=browser-qa-placeholder-secret npm run db:push
DB_PROVIDER=sqlite DATABASE_URL="file:./prisma/dev.db" AUTH_SECRET=browser-qa-placeholder-secret npm run db:seed:e2e
DB_PROVIDER=sqlite DATABASE_URL="file:./prisma/dev.db" AUTH_SECRET=browser-qa-placeholder-secret PORT=4000 E2E_BASE_URL=http://127.0.0.1:4000 E2E_PROFILE=1 E2E_WEB_SERVER=1 BILLING_UNLIMITED_CREDITS=1 npx playwright test e2e/ui-matrix/*.spec.ts
```

Do not run the full 500 catalog as individual browser scenarios. Promote cases from `manual`, `blocked`, or `catalog` to `automated` only when deterministic fixtures, stable roles/labels, and readiness signals exist.
