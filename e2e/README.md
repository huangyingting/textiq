# End-to-end tests (Playwright)

These Playwright specs cover critical product flows (issue #107). They live
**only** in `e2e/` so the unit gate (`npm test`) maps them to subsystem buckets
but never executes them. The deterministic profile runs as a dedicated CI job;
the same maintained specs can also run unrestricted against a developer-managed
app.

## What's covered

| Spec                                                    | Coverage                                                                                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `e2e/public-render/share-fallback.spec.ts`              | Unknown share/present/embed links → not-found fallback                                                                          |
| `e2e/presentation/slides-smoke.spec.ts`                 | Slides edit/save/present/export smoke (auth-gated, skips cleanly without creds)                                                 |
| `e2e/presentation/slides-layout-screenshots.spec.ts`    | Deterministic presentation layout snapshots (desktop/tablet/mobile + rail/notes/panel states)                                   |
| `e2e/documents/template-creation.spec.ts`               | Dashboard/workspace template failure/retry, duplicate suppression, modal accessibility, permissions, and reload persistence     |
| `e2e/import/import-roundtrip.spec.ts`                   | Markdown + DOCX import → editor render → reload persistence; unsupported-type error (profile-gated, #519/#1734)                 |
| `e2e/presentation/present-export.spec.ts`               | Present rendering; real PDF/PNG/PPTX downloads; browser raster-failure containment and successful retry                         |
| `e2e/presentation/slide-asset-upload.spec.ts`           | Inspector image upload + protected slide-asset access control (profile-gated, #521)                                             |
| `e2e/presentation/slides-conflict-recovery.spec.ts`     | Real two-session deck CAS conflicts covering keep-mine/use-server recovery and reload persistence                               |
| `e2e/presentation/overlap-selection-regression.spec.ts` | Deterministic overlapping-node selection, stacking, grouping, locking, editing, deletion, and Layers parity                     |
| `e2e/presentation/pointer-interactions.spec.ts`         | Real pointer drag coverage for filmstrip reorder, node transforms, connector snapping, and persistence                          |
| `e2e/presentation/presentation-controls.spec.ts`        | Multi-select Arrange, precision guides, built-in themes, and custom theme authoring                                             |
| `e2e/presentation/touch-controls.spec.ts`               | Chromium mobile touch taps for text selection and mobile inspector navigation                                                   |
| `e2e/ui-matrix/account-lifecycle-ui.spec.ts`            | Signup, onboarding failure recovery/deletion, profile persistence, export, password rotation, recovery failures, and safeguards |
| `e2e/ui-matrix/dashboard-document-lifecycle-ui.spec.ts` | Search/favorite failure recovery, persistence, duplicate/rename, delete/undo, trash restore, and permanent deletion             |
| `e2e/ui-matrix/catalog.spec.ts`                         | 500-case subsystem UI matrix catalog validation (included in the deterministic profile)                                         |
| `e2e/ui-matrix/document-comments-lifecycle-ui.spec.ts`  | Owner/viewer comment lifecycle, anchored-paragraph edits, permissions, resolve/reopen, guarded deletion, and reload persistence |
| `e2e/ui-matrix/document-sharing-lifecycle-ui.spec.ts`   | Share policy persistence, clipboard/social actions, passcode unlock, public mode gates, link rotation/revocation, and scrolling |
| `e2e/ui-matrix/document-metadata-history-ui.spec.ts`    | Tag create/remove/reuse persistence and reversible version-history restore across reloads                                       |
| `e2e/ui-matrix/public-render-ui.spec.ts`                | Public share/embed/present rendering, asset policy, safe 404s, read-only UI, and accessible visual-lightbox behavior            |
| `e2e/ui-matrix/workspace-lifecycle-ui.spec.ts`          | Owner/editor/viewer create, rename, invite, membership, ownership-transfer, leave, and delete lifecycle                         |
| `e2e/ui-matrix/*-ui.spec.ts`                            | Representative presentation/public/auth/account/editor/workspace checks; all maintained UI-matrix specs run deterministically   |

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

Use these exact list commands when recording suite provenance:

```bash
# unrestricted
E2E_PROFILE=0 E2E_PROFILE_GREP= npm run test:e2e -- --list

# deterministic
E2E_PROFILE=1 E2E_PROFILE_GREP= npm run test:e2e:profile -- --list

# required
E2E_PROFILE=1 E2E_PROFILE_GREP=@required-profile npm run test:e2e:profile -- --list
```

The deterministic and required list commands use the secured profile runner to
construct the canonical profile environment and Playwright config selection,
but listing does not mutate the database, install Chromium, or start servers.
Use `--list-steps` instead to print the full profile execution plan.

By default the specs target `http://127.0.0.1:4000`. Override with
`E2E_BASE_URL` (or `BASE_URL`). To have Playwright start the dev server for you,
set `E2E_WEB_SERVER=1`:

```bash
E2E_WEB_SERVER=1 npm run test:e2e
```

## Environment variables

The share-fallback spec can run against an unrestricted app without extra
configuration. The maintained browser suite also runs in the deterministic
profile, which supplies its own seeded credentials:

| Variable                        | Used by                            | Purpose                                                                                                      |
| ------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `E2E_BASE_URL` / `BASE_URL`     | all                                | Canonical app origin; profile default uses a random authenticated `r-<hash>.localhost` hostname on port 4000 |
| `E2E_WEB_SERVER`                | config                             | `1` to let Playwright run the app                                                                            |
| `E2E_WEB_SERVER_COMMAND`        | config                             | Server command when `E2E_WEB_SERVER=1` (defaults to `npm run dev`)                                           |
| `E2E_WEB_SERVER_TIMEOUT_MS`     | config                             | Server readiness timeout override (defaults to 240000)                                                       |
| `E2E_REUSE_EXISTING_SERVER`     | config                             | Override Playwright server reuse (`1`/`true` or `0`/`false`)                                                 |
| `E2E_PROFILE_SERVER`            | self-contained profile             | Labels the self-contained profile server mode (defaults to `dev`)                                            |
| `E2E_PROFILE_READINESS_URL`     | self-contained profile             | Separate credential-free lifecycle URL (default `http://localhost:4001/ready`)                               |
| `E2E_PROFILE_APP_URL`           | self-contained profile             | Internal IPv4 app listener (default `http://localhost:4002`)                                                 |
| `E2E_PROFILE_PRECOMPILE_ROUTES` | self-contained profile             | JSON route contracts compiled and body-validated before Playwright dispatches tests                          |
| `E2E_INSTALL_BROWSER_DEPS`      | self-contained profile             | `1` to install Playwright OS dependencies with Chromium                                                      |
| `E2E_PROFILE_GREP`              | deterministic profile              | Optional grep for a bounded required-profile slice such as `@required-profile`                               |
| `E2E_USER_EMAIL/PASSWORD`       | profile seed, slides               | Override the seeded owner login                                                                              |
| `E2E_VIEWER_EMAIL/PASSWORD`     | profile seed                       | Override the seeded viewer login                                                                             |
| `BILLING_UNLIMITED_CREDITS`     | billing                            | Match the server's unlimited-credit gate                                                                     |
| `GOOGLE_CLIENT_ID/SECRET`       | auth/public UI matrix              | Match the server's Google provider configuration                                                             |
| `E2E_SLIDES_DOC_URL`            | slides-smoke                       | Full URL to a seeded document with a Slides presentation                                                     |
| `E2E_SLIDES_LAYOUT_SCREENSHOTS` | slides-layout-screenshots          | Set to `1` to run layout screenshots outside the deterministic profile                                       |
| `E2E_SLIDES_EDITOR_PATH`        | slides-layout-screenshots          | Override the seeded editor document path used by layout screenshots                                          |
| `E2E_PROFILE`                   | profile specs + layout screenshots | Set to `1` to run deterministic profile specs (including layout screenshots)                                 |

## Deterministic E2E profile (Epic #517)

The fast unit gate is intentionally credential-less, so the authenticated specs
above skip without env credentials. The **deterministic E2E profile** removes
that ambiguity for the critical-flow specs
(`e2e/editor/document-editor-profile.spec.ts`,
`e2e/documents/template-creation.spec.ts`,
`e2e/import/import-roundtrip.spec.ts`,
`e2e/public-render/share-fallback.spec.ts`,
`e2e/presentation/focus-and-mobile-controls-regression.spec.ts`,
`e2e/presentation/overlap-selection-regression.spec.ts`,
`e2e/presentation/present-export.spec.ts`,
`e2e/presentation/pointer-interactions.spec.ts`,
`e2e/presentation/presentation-controls.spec.ts`,
`e2e/presentation/slide-asset-upload.spec.ts`,
`e2e/presentation/slide-delete-persistence.spec.ts`,
`e2e/presentation/slides-conflict-recovery.spec.ts`,
`e2e/presentation/slides-layout-screenshots.spec.ts`,
`e2e/presentation/slides-smoke.spec.ts`,
`e2e/presentation/touch-controls.spec.ts`,
`e2e/ui-matrix/account-lifecycle-ui.spec.ts`,
`e2e/ui-matrix/auth-public-ui.spec.ts`,
`e2e/ui-matrix/dashboard-document-lifecycle-ui.spec.ts`,
`e2e/ui-matrix/document-comments-lifecycle-ui.spec.ts`,
`e2e/ui-matrix/document-sharing-lifecycle-ui.spec.ts`,
`e2e/ui-matrix/document-metadata-history-ui.spec.ts`,
`e2e/ui-matrix/document-editor-ui.spec.ts`,
`e2e/ui-matrix/presentation-ui.spec.ts`,
`e2e/ui-matrix/public-render-ui.spec.ts`,
`e2e/ui-matrix/workspace-lifecycle-ui.spec.ts`,
and `e2e/ui-matrix/workspace-billing-brand-ui.spec.ts`): a fixed seed produces known
users and isolated documents, and the specs run for real against them.

### What the profile seeds

`npm run db:seed:e2e` (`prisma/seed-e2e.ts`) is **idempotent** and creates:

- fixed free-plan **owner** and **viewer** users plus a fixed Pro-plan
  **editor** user (passwords hashed with the same bcrypt path the app uses);
- an isolated account-mutation user whose display name, password hash, and
  session-revocation stamp reset before profile/password lifecycle coverage;
- an isolated billing-mutation user whose plan, credits, period, and
  subscription reset before upgrade/cancel/downgrade lifecycle coverage;
- exact-email cleanup for the signup lifecycle account so an interrupted
  signup/onboarding/deletion run is self-healing on the next seed;
- cleanup of default-titled template documents owned by the dedicated profile
  owner/editor so repeated creation specs do not contaminate list caps;
- a workspace granting the viewer read-only access;
- an empty, owner-partitioned Brand Studio state for the Pro editor so the
  deterministic browser workflow can create, upload a font, reload, edit,
  cancel deletion, delete, and verify protected-asset retirement;
- resettable dashboard documents for search/filter coverage and an isolated
  duplicate/rename/trash/restore/permanent-delete lifecycle;
- an isolated document with a known earlier `DocumentVersion` for tag
  persistence and reversible restore coverage;
- an isolated workspace document whose comments and read state reset before
  owner/viewer comment lifecycle coverage;
- an isolated private document whose complete share policy resets before
  owner/public link lifecycle coverage;
- stale disposable workspace-lifecycle records are removed before each seed so
  interrupted create/invite/transfer/delete browser runs cannot contaminate a
  later profile run;
- one **shared** document with intro text + an embedded visual, a persisted
  `deckJson` in `schemaVersion: 7` (`Deck`) whose first slide carries known
  text and an `ImageNode` backed by a slide `Asset` (bytes written under
  `storage/slide-assets/…`), and an enabled
  public present/embed share policy;
- a second **private** (never-shared) document + asset used to assert
  protected-asset denial.
- dedicated tokenized presentation documents/Yjs rooms for each mutating
  Arrange, precision-guide, theme-authoring, touch, pointer, smoke, and conflict
  workflow.

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

The self-contained runner owns schema setup, seeding, and server startup. Ensure
no process is listening on its configured `E2E_BASE_URL`, then run:

```bash
npm run test:e2e:profile
```

The runner probes the configured origin before `db:push` or `db:seed:e2e` and
fails closed when a server is live or liveness cannot be determined. This
prevents reseeding beneath active Yjs rooms. After seeding, Playwright reuses
only the server process created and authenticated by the runner.

The profile has three loopback endpoints: a canonical browser/auth origin using
the per-run authenticated `https://r-<32 lowercase hex>.localhost:<port>`
hostname, a credential-free HTTP readiness port, and an internal HTTP app
listener. The runner starts a dedicated secure server child that owns the
ephemeral HTTPS/WSS reverse proxy and starts the app as its child. Chromium
receives only that run's SPKI
pin (`--ignore-certificate-errors-spki-list=<pin>`); Node API helpers trust the
same self-signed certificate as a one-run CA and independently verify its SPKI.
`ignoreHTTPSErrors` is never enabled.

The runner generates the private key into an already-unlinked mode-`0600` file
descriptor and passes that descriptor only to the dedicated proxy process. The
proxy imports and closes it before spawning the app. The runner closes its copy
immediately, then starts Playwright without the descriptor or its environment
name; `/proc/<playwright-pid>/fd` and every Playwright descendant contain zero
references to the key, while the proxy is the sole importing process. No private
transport key or capability key is written to a named file, environment value,
argument, identity record, or log. The mode-`0600` public certificate and signed
public identity records live under `.next/e2e-profile/<run-id>/` until teardown.
`E2E_PROFILE_RUN_NONCE` remains public run correlation only and is not an
integrity, proof, or capability key.

TLS authenticates the exact connection before HTTP headers, bodies, cookies, or
WebSocket upgrades can cross the listener. A listener replaced with plaintext,
the wrong certificate, or a certificate from a prior run receives only a TLS
ClientHello and zero credential bytes. The secure proxy forwards both HTTPS and
WSS. Before writing upstream bytes it checks the owned app listener, connects,
attributes the exact accepted connection to the recorded app process through
Linux `/proc`, and rechecks the listener. A replacement app therefore receives
zero headers/body/cookies.

Every upstream `Location` header is singularly parsed against the exact internal
app origin. Relative and absolute app redirects are normalized and rewritten to
the pinned `https://localhost:<proxy-port>` origin. External, scheme-relative,
userinfo, backslash/encoded-host, non-HTTP, proxy-origin, or duplicate locations
latch the run and are never returned to browsers or upload/API callers.

Authenticated API helpers issue a capability and use it on the same pinned TLS
connection. The HMAC-signed payload binds run ID, uppercase method, exact
origin/Host/path/query, SHA-256 body hash, server-side TLS channel ID, issue and
expiry times, and a unique nonce. The proxy verifies it in constant time,
atomically consumes the nonce, and rejects replay or any method/path/body/origin/
channel mutation before forwarding. Browser navigation uses the authenticated
TLS channel directly and does not expose a reusable bearer token.

The first TLS, signed-record, capability, origin, or app-listener mismatch
latches the run in proxy memory and the signed mode-`0600` compromise record.
There is no identity refresh or latch restoration. Ordinary authenticated app
responses, including HTTP `500`, do not latch. `credentialGatedRequest` remains
the required authenticated API facade; `unauthenticatedRequest` remains the
fresh empty-storage facade for explicit public probes.

Each seed also removes documents and slide-asset directories left by earlier
deterministic runs in the fixed E2E workspace, while retaining only the
canonical, dashboard, layout, and currently planned worker/repeat fixtures.

The browser/auth URL is `https://localhost:<port>`, so Auth.js uses secure
cookies and redirects remain on the canonical TLS origin. Deterministic Chromium
launches with the exact resolver rule `MAP localhost 127.0.0.1`, while
the runner replaces ambient `NODE_OPTIONS` with
`--dns-result-order=ipv4first --no-network-family-autoselection` for
Playwright's Node-side helpers and Playwright polls the internal app readiness
through `127.0.0.1`. The
profile rejects non-Chromium projects rather than running without an equivalent
resolver guarantee. These rules prevent an ambient `::1` listener from
receiving profile cookies or falsely satisfying readiness.

Each response must finish streaming within the existing route timeout and the
8 MiB body bound before global setup releases the tests. Protected HTML must
contain its dashboard or document-editor marker and must not be a login, error,
or not-found page; the import response must match its exact JSON error signature.
The probes do not open Yjs websocket rooms or replace the seed-before-server
order.

Manual deterministic runs must use the wrapper because it owns the ephemeral
certificate, anonymous key descriptor, SPKI pin, secure proxy, and cleanup.
Direct `E2E_PROFILE=1 playwright test` invocation fails before tests when the
managed secure server is unavailable.

It generates the Prisma client, pushes the SQLite schema, seeds the deterministic
fixture, installs Chromium, starts the dedicated proxy/app process tree, and
then runs Playwright in existing-server mode. CI uses the same required hard gate in
`.github/workflows/e2e-deterministic.yml`; profile failures fail the workflow.
The wrapper normalizes `E2E_BASE_URL`, exports it to Playwright and the auth/app
runtime variables, hard-sets the server bind to `127.0.0.1`, pins reuse to the
runner-owned server, and uses an isolated Next output directory for each invocation. A
conflicting explicit `PORT` is rejected instead of starting browser and server
processes on different origins.

Under the profile (`E2E_PROFILE=1`, set by `test:e2e:profile`) the
profile-dependent specs **do not skip** — they run for real. Without
`E2E_PROFILE=1` they **skip cleanly** via `e2eProfileEnabled()`, so the
credential-less fast gate and CI stay green.

The deterministic profile is bounded for CI: it runs without config-level
retries, has an 18-minute Playwright global timeout inside a 40-minute workflow
job (including dependency install, database setup, browser provisioning, and the
no-build dev server), and the required CI job uses
`E2E_PROFILE_GREP=@required-profile` to run the stabilized critical-flow slice.
Run `npm run test:e2e:profile` without that grep for the broader deterministic
profile. The remaining opt-in UI-matrix specs can be supplied explicitly when
validating the representative browser UI matrix.

### DOCX fixture policy

`e2e/import/import-roundtrip.spec.ts` covers Markdown and DOCX dashboard imports
through the UI, the workspace-owner file-picker path, and the unsupported-type
route contract. The Markdown lifecycle also proves oversized-file preflight,
malformed-response and transport failure recovery, pending-state duplicate
suppression, and non-empty editor replacement across Escape/backdrop
cancellation, focus trapping/restoration, mobile containment, autosave, and
reload. DOCX coverage uses `e2e/helpers/docx-fixture.ts` to
generate a minimal deterministic OOXML package from stable XML parts at test
time, avoiding opaque binary fixture churn while still exercising upload/form
wiring, `POST /api/import`, editor rendering, and save/reload behavior.

### Template creation

`e2e/documents/template-creation.spec.ts` covers the real dashboard and
workspace template pickers. The dashboard case proves initial focus, Tab
wrapping, Escape/backdrop focus restoration, body scroll lock, mobile viewport
containment, a forced Server Action transport failure, inline retry, duplicate
activation suppression, redirect, and template-content persistence after
reload. Workspace cases prove durable owner/editor creation and that viewers
cannot reach create/import actions. All four cases carry `@required-profile`.

## Slides smoke (`e2e/presentation/slides-smoke.spec.ts`)

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
npx playwright test e2e/presentation/slides-smoke.spec.ts
```

## Layout screenshots (`e2e/presentation/slides-layout-screenshots.spec.ts`)

This is the canonical pixel-regression suite. It snapshots the presentation
slide-editor shell on desktop, tablet, and mobile for base, rail-hidden,
notes-expanded, and panel-open states using the deterministic profile fixture
and 12 committed Linux baselines.

- Under `E2E_PROFILE=1`, the suite is part of the deterministic profile run and
  fails loudly if fixtures are unavailable.
- Outside the profile, set `E2E_SLIDES_LAYOUT_SCREENSHOTS=1` for explicit
  screenshot runs.

Snapshot baselines are opt-in release artifacts, not part of the fast unit
gate. Update them only when rendered slide-stage output intentionally changes;
reviewers should compare the rendered diff with the corresponding schema/source
change. Snapshot specs must use stable seeded fixtures and readiness helpers
instead of raw sleeps.

### Generate baselines

```bash
E2E_PROFILE=1 npm run test:e2e:profile -- e2e/presentation/slides-layout-screenshots.spec.ts --update-snapshots
```

### Run comparison

```bash
E2E_PROFILE=1 npm run test:e2e:profile -- e2e/presentation/slides-layout-screenshots.spec.ts
```
