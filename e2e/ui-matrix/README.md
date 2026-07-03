# UI matrix strategy

Type: test-strategy
Status: current
Last updated: 2026-07-03

This directory contains a 500-case UI test catalog plus representative Playwright smoke specs. The catalog is intentionally broader than the runnable browser subset so release planning can track manual, blocked, and future automated cases without turning E2E into a slow/flaky 500-browser-test suite.

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

## Catalog distribution

| Subsystem                         |   Total | Automated |  Manual | Blocked | Catalog |
| --------------------------------- | ------: | --------: | ------: | ------: | ------: |
| Presentation editor               |     180 |        32 |      48 |      10 |      90 |
| Presentation render/export        |     120 |        22 |      35 |       8 |      55 |
| Public render/share/embed/present |      60 |        14 |      16 |       4 |      26 |
| Auth/public pages                 |      40 |        10 |      10 |       2 |      18 |
| Document editor                   |      45 |        10 |      15 |       4 |      16 |
| Workspace/billing/brand           |      55 |        10 |      15 |       5 |      25 |
| **Total**                         | **500** |    **98** | **139** |  **33** | **230** |

`automated` means covered by a representative runnable spec in this directory or existing deterministic E2E profile. `manual` means human exploratory or release-gate validation is still expected. `blocked` means product hooks, deterministic fixture coverage, or stable selectors are missing. `catalog` means planned coverage that is not currently a release gate.

## Runnable subset

- `catalog.spec.ts` validates the 500-case catalog shape and counts without a browser-heavy flow.
- `auth-public-ui.spec.ts` covers public home/login/signup, OAuth CTA availability, and protected-route redirects.
- `presentation-ui.spec.ts` covers canonical slide-editor shell, stage, menus, export choices, public present deep links, and keyboard navigation.
- `public-render-ui.spec.ts` covers public present/embed/share, safe unknown-link fallback, and share-bound asset access.
- `document-editor-ui.spec.ts` covers the seeded document editor surface and document-to-slide-editor entry point.
- `workspace-billing-brand-ui.spec.ts` covers dashboard, billing credits, and Brand Studio entitlement-aware surfaces.

## Execution

The default deterministic profile validates only `catalog.spec.ts` so the CI
profile stays bounded while still guarding the 500-case catalog. Run the browser
matrix explicitly when validating representative UI surfaces:

```bash
DB_PROVIDER=sqlite DATABASE_URL="file:./prisma/dev.db" AUTH_SECRET=browser-qa-placeholder-secret npm run db:push
DB_PROVIDER=sqlite DATABASE_URL="file:./prisma/dev.db" AUTH_SECRET=browser-qa-placeholder-secret npm run db:seed:e2e
DB_PROVIDER=sqlite DATABASE_URL="file:./prisma/dev.db" AUTH_SECRET=browser-qa-placeholder-secret PORT=4000 E2E_BASE_URL=http://127.0.0.1:4000 E2E_PROFILE=1 E2E_WEB_SERVER=1 BILLING_UNLIMITED_CREDITS=1 npx playwright test e2e/ui-matrix/*.spec.ts
```

Do not run the full 500 catalog as individual browser scenarios. Promote cases from `manual`, `blocked`, or `catalog` to `automated` only when deterministic fixtures, stable roles/labels, and readiness signals exist.
