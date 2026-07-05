# End-to-end tests (Playwright)

These Playwright specs cover critical product flows (issue #107). They live
**only** in `e2e/` so the unit gate (`npm test`) maps them to subsystem buckets
but never executes them. The deterministic profile subset runs as a required
dedicated CI job; the broader optional E2E suite remains local/opt-in.

## What's covered

| Spec                                | Coverage                                                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `public-pages.spec.ts`              | Home / login / signup render (smoke)                                                                            |
| `auth-redirect.spec.ts`             | Protected `/app*` → `/login?callbackUrl=...` (preserves path)                                                   |
| `oauth-disabled.spec.ts`            | Google CTA hidden when the provider is unconfigured                                                             |
| `workspace.spec.ts`                 | Create / import, empty state, viewer restriction (auth-gated)                                                   |
| `share-fallback.spec.ts`            | Unknown share/present/embed links → not-found fallback                                                          |
| `billing-brand.spec.ts`             | Billing unlimited-credit UI + Brand Studio font persistence                                                     |
| `slides-smoke.spec.ts`              | Slides edit/save/present/export smoke (auth-gated, skips cleanly without creds)                                 |
| `slides-layout-screenshots.spec.ts` | Deterministic presentation layout snapshots (desktop/tablet/mobile + rail/notes/panel states)                   |
| `screenshot-regression.spec.ts`     | Slide screenshot regression with deterministic fixtures (opt-in via env var)                                    |
| `import-roundtrip.spec.ts`          | Markdown + DOCX import → editor render → reload persistence; unsupported-type error (profile-gated, #519/#1734) |
| `present-export.spec.ts`            | Authenticated + public present render; real PDF export download (profile-gated, #520)                           |
| `slide-asset-upload.spec.ts`        | Inspector image upload + protected slide-asset access control (profile-gated, #521)                             |
| `e2e/ui-matrix/catalog.spec.ts`     | 500-case subsystem UI matrix catalog validation (included in the deterministic profile)                         |
| `e2e/ui-matrix/*-ui.spec.ts`        | Representative presentation/public/auth/editor/workspace checks (explicit opt-in, not default profile)          |

The source-backed UI matrix inventory lives in `e2e/ui-matrix/README.md` and
`e2e/ui-matrix/inventory.ts`. `npm run ui-matrix:check` fails when a Playwright
spec is missing from the inventory or when the generated README section drifts.

## Prerequisites

1. Install the Chromium browser binary (one-time):

   ```bash
   npx playwright install chromium
   ```

2. Start the app (in a separate terminal). The unlimited-credit UI is gated by
   `BILLING_UNLIMITED_CREDITS`, and Google OAuth visibility by
   `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`:

   ```bash
   export DB_PROVIDER=sqlite
   export DATABASE_URL="file:./prisma/dev.db"
   export AUTH_SECRET=dev-secret
   npm run db:generate
   npm run db:push      # or db:reset to force-reset and seed
   npm run dev
   ```

## Run

```bash
npm run test:e2e
```

By default the specs target `http://localhost:4000`. Override with
`E2E_BASE_URL` (or `BASE_URL`). To have Playwright start the dev server for you,
set `E2E_WEB_SERVER=1`:

```bash
E2E_WEB_SERVER=1 npm run test:e2e
```

## Environment variables

Public-page, auth-redirect, OAuth-disabled, and share-fallback specs run with no
extra configuration. Authenticated flows skip cleanly unless you provide seeded
credentials:

| Variable                        | Used by                            | Purpose                                                                           |
| ------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------- |
| `E2E_BASE_URL` / `BASE_URL`     | all                                | App base URL (default `http://localhost:4000`)                                    |
| `E2E_WEB_SERVER`                | config                             | `1` to let Playwright run the app                                                 |
| `E2E_WEB_SERVER_COMMAND`        | config                             | Server command when `E2E_WEB_SERVER=1` (defaults to `npm run dev`)                |
| `E2E_WEB_SERVER_TIMEOUT_MS`     | config                             | Server readiness timeout override (defaults to 240000)                            |
| `E2E_REUSE_EXISTING_SERVER`     | config                             | Override Playwright server reuse (`1`/`true` or `0`/`false`)                      |
| `E2E_PROFILE_SERVER`            | self-contained profile             | `production` (default) builds first and starts `npm run start`; `dev` skips build |
| `E2E_INSTALL_BROWSER_DEPS`      | self-contained profile             | `1` to install Playwright OS dependencies with Chromium                           |
| `E2E_USER_EMAIL/PASSWORD`       | workspace, billing, brand, slides  | A seeded owner/editor login                                                       |
| `E2E_VIEWER_EMAIL/PASSWORD`     | workspace                          | A seeded viewer-only login                                                        |
| `E2E_VIEWER_DOC_URL`            | workspace                          | A document URL the viewer can open read-only                                      |
| `E2E_BRAND_FONT_URL`            | brand                              | Path to a `.woff2`/`.ttf` font to upload                                          |
| `BILLING_UNLIMITED_CREDITS`     | billing                            | Match the server's unlimited-credit gate                                          |
| `GOOGLE_CLIENT_ID/SECRET`       | oauth-disabled                     | Match the server's Google provider configuration                                  |
| `E2E_SLIDES_DOC_URL`            | slides-smoke                       | Full URL to a seeded document with a Slides presentation                          |
| `E2E_SLIDES_LAYOUT_SCREENSHOTS` | slides-layout-screenshots          | Set to `1` to run layout screenshots outside the deterministic profile            |
| `E2E_SLIDES_EDITOR_PATH`        | slides-layout-screenshots          | Override the seeded editor document path used by layout screenshots               |
| `E2E_SCREENSHOT_REGRESSION`     | screenshot-regression              | Set to `1` to enable screenshot comparison tests                                  |
| `E2E_REGRESSION_SHARE_ID`       | screenshot-regression              | A share id for the public present/embed regression slides                         |
| `E2E_PROFILE`                   | profile specs + layout screenshots | Set to `1` to run deterministic profile specs (including layout screenshots)      |

## Deterministic E2E profile (Epic #517)

The fast unit gate is intentionally credential-less, so the authenticated specs
above skip without env credentials. The **deterministic E2E profile** removes
that ambiguity for the critical-flow specs (`document-editor-profile.spec.ts`,
`import-roundtrip.spec.ts`, `present-export.spec.ts`,
`slide-asset-upload.spec.ts`, `slides-layout-screenshots.spec.ts`): a fixed
seed produces known users and a known document, and the specs run for real
against it.

### What the profile seeds

`npm run db:seed:e2e` (`prisma/seed-e2e.ts`) is **idempotent** and creates:

- a fixed **owner** user and a fixed **viewer** user (passwords hashed with the
  same bcrypt path the app uses);
- a workspace granting the viewer read-only access;
- one **shared** document with intro text + an embedded visual, a persisted
  `deckJson` in `schemaVersion: 7` (`Deck`) whose first slide carries known
  text and an `ImageNode` backed by a slide `Asset` (bytes written under
  `storage/slide-assets/…`), and an enabled
  public present/embed share policy;
- a second **private** (never-shared) document + asset used to assert
  protected-asset denial.

All identifiers and payload builders live in `src/test/builders/e2e-profile.ts`
(the single source of truth shared by the seed and the specs through
`e2e/helpers/profile.ts`), and the seed emits the resolved values to
`e2e/.e2e-fixture.json`. The **seeded document URL and share id are
deterministic**:

- Document editor: `/app/documents/e2efixturedocument0000001`
- Layout screenshot editor: `/app/documents/e2efixturelayoutdoc000001`
- Public present: `/present/e2e-fixture-deck-e2efixtureshare01`
- Public document embed: `/embed/e2e-fixture-deck-e2efixtureshare01`
- Public presentation embed: `/present/e2e-fixture-deck-e2efixtureshare01/embed`

### Enabling the profile

```bash
export DB_PROVIDER=sqlite DATABASE_URL="file:./prisma/dev.db" AUTH_SECRET=ci-placeholder
npm run db:push        # or db:reset
npm run db:seed:e2e    # seed the deterministic fixture
npm run dev &          # start the app
npm run test:e2e:profile   # runs Playwright with E2E_PROFILE=1
```

For fresh checkouts and CI, use the self-contained wrapper instead:

```bash
npm run test:e2e:profile:self-contained
```

It generates the Prisma client, pushes the SQLite schema, seeds the deterministic
fixture, builds the app, installs Chromium, starts the prebuilt production server
through Playwright, and runs only the deterministic profile specs. CI uses the
same required hard gate in `.github/workflows/e2e-deterministic.yml`; profile
failures fail the workflow. If `E2E_BASE_URL` includes an explicit port, the
wrapper passes the same `PORT` to the app server unless `PORT` is already set.
Set `E2E_PROFILE_SERVER=dev` only for local debugging when you intentionally
want to skip the production build.

Under the profile (`E2E_PROFILE=1`, set by `test:e2e:profile`) the
profile-dependent specs **do not skip** — they run for real. Without
`E2E_PROFILE=1` they **skip cleanly** via `e2eProfileEnabled()`, so the
credential-less fast gate and CI stay green.

The deterministic profile is bounded for CI: it runs without config-level
retries, has an 18-minute Playwright global timeout inside a 40-minute workflow
job (including install/build/setup), and includes only the lightweight UI matrix
catalog check by default. Run `e2e/ui-matrix/*-ui.spec.ts` explicitly when
validating the representative browser UI matrix.

### DOCX fixture policy

`import-roundtrip.spec.ts` covers Markdown and DOCX imports fully through the UI,
plus the unsupported-type path through the route. DOCX coverage uses
`e2e/helpers/docx-fixture.ts` to generate a minimal deterministic OOXML package
from stable XML parts at test time, avoiding opaque binary fixture churn while
still exercising upload/form wiring, `POST /api/import`, editor rendering, and
save/reload behavior.

## Slides smoke (`slides-smoke.spec.ts`)

The Slides smoke spec covers the core edit → save → present → export flow. It
degrades cleanly at every step:

- Without `E2E_USER_EMAIL`/`E2E_USER_PASSWORD`: all authenticated tests skip.
- Without `E2E_SLIDES_DOC_URL`: persistence and present tests skip.
- The unauthenticated redirect and 404 share tests always run.

To run only the slides smoke:

```bash
E2E_USER_EMAIL=owner@example.com \
E2E_USER_PASSWORD=secret \
E2E_SLIDES_DOC_URL=http://localhost:3000/app/documents/YOUR_DOC_ID \
npx playwright test slides-smoke.spec.ts
```

## Screenshot regression (`screenshot-regression.spec.ts`)

Screenshot regression tests are **opt-in** via `E2E_SCREENSHOT_REGRESSION=1`.
They use a deterministic deck fixture (no server required for fixture-integrity
tests) and compare rendered slides against stored baselines.

### Snapshot policy

Screenshot baselines are opt-in release artifacts, not part of the fast unit
gate. Update them only when rendered slide-stage output intentionally changes;
reviewers should compare the rendered diff with the corresponding schema/source
change. Snapshot specs must use shared builders for deck fixtures and stable
readiness helpers instead of raw sleeps.

### Generate baselines

```bash
E2E_SCREENSHOT_REGRESSION=1 npx playwright test screenshot-regression.spec.ts --update-snapshots
```

### Run comparison

```bash
E2E_SCREENSHOT_REGRESSION=1 npx playwright test screenshot-regression.spec.ts
```

### Tolerances

Screenshot comparisons use a 2% max-diff pixel ratio and a 0.2 per-pixel
threshold to absorb minor sub-pixel rendering differences across OS/GPU. These
values are defined in the spec and can be tightened once a stable baseline is
established.

## Layout screenshots (`slides-layout-screenshots.spec.ts`)

This suite snapshots the presentation slide-editor shell (desktop/tablet/mobile) for
base, rail-hidden, notes-expanded, and panel-open states using the
deterministic profile fixture.

- Under `E2E_PROFILE=1`, the suite is part of the deterministic profile run and
  fails loudly if fixtures are unavailable.
- Outside the profile, set `E2E_SLIDES_LAYOUT_SCREENSHOTS=1` for explicit
  screenshot runs.

### Generate baselines

```bash
E2E_PROFILE=1 npx playwright test slides-layout-screenshots.spec.ts --update-snapshots
```

### Run comparison

```bash
E2E_PROFILE=1 npx playwright test slides-layout-screenshots.spec.ts
```
