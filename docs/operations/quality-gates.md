---
type: "reference"
status: "current"
last_updated: "2026-07-31"
description: "This document is the inventory for local and CI quality gates. It explains what each command protects and where ownership lives. Release sign-off sequence lives in release-gate.md; local setup and troubleshooting live in developer-bootstrap.md."
---

# Quality Gates And Governance Scripts

This document is the inventory for local and CI quality gates. It explains what
each command protects and where ownership lives. Release sign-off sequence lives
in [release-gate.md](release-gate.md); local setup and troubleshooting live in
[developer-bootstrap.md](developer-bootstrap.md).

## Source Anchors

| Area                   | Source                                                                    |
| ---------------------- | ------------------------------------------------------------------------- |
| Package scripts        | `package.json`                                                            |
| Local CI orchestrator  | `scripts/ci-local.mjs`                                                    |
| Subsystem test router  | `scripts/test-subsystem.mjs`                                              |
| Combined coverage gate | `scripts/check-combined-coverage.mjs`                                     |
| Line coverage gate     | `scripts/check-line-coverage.mjs`                                         |
| Coverage breadth gate  | `scripts/check-coverage-breadth.mjs`, `scripts/coverage-breadth.mjs`      |
| Docs verification      | `scripts/check-docs-source-inventory.mjs`, `scripts/check-docs-links.mjs` |
| Import graph           | `scripts/check-import-graph.mjs`, `scripts/import-graph.mjs`              |
| Client boundary        | `scripts/check-client-boundary.mjs`, `scripts/client-boundary.mjs`        |
| Action ports           | `scripts/check-action-ports.mjs`, `src/lib/action-ports.ts`               |
| Design system          | `scripts/check-design-system.mjs`, `docs/system/design-system.md`         |
| Next build constraints | `scripts/check-next-build-constraints.mjs`                                |
| E2E governance         | `scripts/check-e2e-governance.mjs`                                        |
| Performance budgets    | `scripts/perf-budgets.mjs`, `scripts/slide-editor-size-budget.test.mjs`   |
| Prisma schema drift    | `scripts/gen-sqlite-schema.mjs`                                           |
| Production install     | `scripts/production-install-smoke.mjs`                                    |
| Retention runner       | `scripts/retention-runner.mjs`, `src/lib/maintenance/retention-runner.ts` |

## Primary Gate

The broad release gate combines schema, tests, typecheck, lint, docs, format,
and build checks:

```bash
npm run db:schema:check
npm run db:generate
npm test
npm run typecheck
npm run typecheck:unused
npm run lint
npm run docs:check
npm run format:check
npm run build
```

Use `npm run ci:local` when you want the repository's local CI orchestrator
instead of running individual commands manually.

## Test Gates

`npm test` is a pure test governance gate. It runs:

1. `npm run test:combined-coverage` (`scripts/check-combined-coverage.mjs`) —
   runs the source unit suite exactly once and derives both the source line
   coverage floors and the coverage _breadth_ non-regression check (see
   below) from that single run's structured coverage summary, then runs the
   script line coverage stage as a separate CLI child process.
2. `npm run test:coverage-map` — subsystem assignment, bucket coverage, file
   naming, and test title checks.

Standalone `npm run test:line-coverage` and `npm run test:coverage-breadth`
still exist and still each run the source unit suite independently through
their original code paths (`check-line-coverage.mjs`'s CLI spawn and
`check-coverage-breadth.mjs`'s `node:test` `run()` API, respectively) — they
are unaffected by the combined gate and remain the right commands for
debugging either concern in isolation. `npm test` no longer chains them
together because doing so ran the identical source suite twice, adding
several minutes of pure duplication with no additional signal (#1919).

Focused work should use the subsystem router:

```bash
npm run test:subsystem -- presentation
npm run test:subsystem -- editor
npm run test:subsystem -- --list
```

Mapped Playwright specs are opt-in for focused runs; add `--with-e2e` when the
changed behavior needs browser coverage.

## Coverage Breadth Gate

Node's `--experimental-test-coverage` (used by the line coverage gate) only
scores files that were actually imported by a test. A file that is eligible
for coverage but never imported is silently absent from the percentage —
`test:line-coverage` can report a high percentage while whole files have zero
test visibility.

`npm run test:coverage-breadth` (`scripts/check-coverage-breadth.mjs`,
`scripts/coverage-breadth.mjs`) closes that blind spot with a structured
inventory instead of scraping the coverage table:

1. Enumerates every file eligible under `BREADTH_COVERAGE_STAGE`'s
   include/exclude globs (`coverage-breadth.mjs`) — the same "Source unit line
   coverage" globs `check-line-coverage.mjs` uses, except deck-kernel is no
   longer excluded (#1925; see below), so it is eligible for breadth like any
   other source directory.
2. Runs the source unit test suite through the `node:test` `run()` API and
   reads the structured `test:coverage` event (`data.summary.files`) to learn
   which eligible files were actually loaded — not by parsing the printed
   table.
3. Classifies every eligible file with the TypeScript compiler API into
   `type-only` (interfaces/types/ambient `declare` — nothing to unit test),
   `barrel` (nothing but import/re-export statements, side-effect imports, or
   — as of #1950 — a `const` exported as a non-computed property-access alias
   rooted in an imported binding, e.g. `export const GET = handlers.GET;` —
   re-export glue either way, no local logic), `static-data` (as of #1950:
   types plus `const` exports built entirely from static primitive/template
   literals and recursively static arrays/objects — a pure data record with
   nothing to unit test), or `runtime` (has behavior that should be
   unit-tested).
4. Assigns every eligible file exactly one testing mode: `unit-loaded`,
   `type-only`, `barrel`, `static-data`, `mapped-e2e`, `approved-exception`,
   or `gap` (an unresolved, actionable blind spot). E2E-mapped,
   approved-exception, and static-data files are never counted as
   unit-covered.

Files opt into `mapped-e2e` or `approved-exception` with an inline marker
comment near the top of the file (mirrors the `e2e-governance-allow` marker
in `check-e2e-governance.mjs`), so the exception and its justification live
in the same file and the same diff:

```ts
// coverage-breadth: mapped-e2e ref=e2e/product/billing-brand.spec.ts
// coverage-breadth: approved-exception reason=manual QA runbook only
```

`mapped-e2e` is evidence, not an assertion: `ref=` must name a real,
repo-relative Playwright spec file that actually exercises the marked source
file, and #1932 made that a validated contract instead of an honor system.
`parseBreadthMarkers` in `coverage-breadth.mjs` reads each marker with the
TypeScript compiler's own comment-range API
(`ts.getLeadingCommentRanges` against the parsed source file's top-level
statements and its EOF token) — never a whole-text regex or string
search — so a `mapped-e2e`-shaped string literal or a marker buried inside a
function body is never mistaken for a real marker. A file may carry more
than one `mapped-e2e`/`approved-exception` marker; every declared ref on a
file must independently validate before that file is classified as
`mapped-e2e`.

Every `ref=` value goes through `validateBreadthMarkerRef`, which rejects
(with a distinct, named problem code):

- a missing or empty ref value,
- a backslash anywhere in the path (ambiguous on the Windows separator vs. a
  literal filename character),
- an absolute path (POSIX `/...` or a Windows drive letter like `C:\...`),
- any `..` traversal segment — checked _before_ normalization, so a ref like
  `foo/../e2e/product/x.spec.ts` is rejected even though it would textually
  resolve under `e2e/` if collapsed first,
- a normalized path that does not fall under the repository's `e2e/` root,
- an unsupported spec extension (only `.spec.ts` matches the real Playwright
  convention enforced by `playwright.config.ts`'s `testMatch` and
  `scripts/test-subsystem.mjs`'s spec pattern), and finally
- a dangling ref: `listExistingE2eSpecFiles` walks the real `e2e/` directory
  on disk (skipping `node_modules`, `test-results`, and other build
  artifacts) and the ref must match one of those real, tracked spec files —
  not a helper, fixture, or `README`.

`buildBreadthReport` collects every problem across every eligible file in one
pass — it does not stop at the first bad marker — then throws a single
`BreadthMarkerValidationError` whose message (via
`formatBreadthMarkerProblems`) lists one `file:line` diagnostic per problem,
e.g. `src/app/login/page.tsx:1 coverage-breadth: mapped-e2e
ref="e2e/auth/ghost.spec.ts" — referenced e2e spec file does not exist.` Both
`npm run test:coverage-breadth` and the combined `npm test` breadth stage
catch this error, print its message, and exit 1 — a dangling or malformed
`mapped-e2e` ref fails the gate loudly instead of silently falling back to
`gap`.

As of #1932, five login/signup runtime files carry verified `mapped-e2e`
markers because real, always-run Playwright specs concretely exercise them:
`src/app/login/page.tsx` (→ `e2e/auth/auth-redirect.spec.ts`, which asserts
the page's unique "Welcome back" heading) and
`src/app/login/login-form.tsx`, `src/app/signup/page.tsx`,
`src/app/signup/signup-form.tsx`, and
`src/components/google-sign-in-button.tsx` (→
`e2e/auth/oauth-disabled.spec.ts`, which drives both pages' email/password
inputs and the Google sign-in CTA's visibility toggle). Forgot-password,
reset-password, and account-settings files were deliberately left unmarked:
no real e2e spec demonstrably reaches them today, and marking a file
`mapped-e2e` on filename similarity alone is exactly the brittle inference
this gate now rejects. `scripts/test-subsystem.mjs`'s auth subsystem e2e
pattern was also corrected to drop `auth-forms`/`settings-account`, two spec
names it referenced that never existed on disk. Newly-verified files reduce
the _actual_ gap count one-for-one (measured 138 → 133 actionable gap on this
branch immediately before/after adding the five markers); #1932 does not
lower `DEFAULT_MAX_GAP_FILES` — the 148 ceiling from #1925 is preserved as-is
per this change's scope, so the gate still passes with slack rather than
re-ratcheting on an unrelated baseline.

The gate fails if the number of unresolved `gap` files exceeds
`DEFAULT_MAX_GAP_FILES` in `check-coverage-breadth.mjs` (a ratchet, matching
`check-import-graph.mjs`'s pattern) — regressions are blocked, improvements
always pass, and the baseline is never auto-lowered. Override the baseline
locally with `COVERAGE_BREADTH_MAX_GAP_FILES=<n>`; do not use the override to
mask a real regression in CI. As of #1896 the repository had 781 eligible
runtime source files, 22 type-only, 26 barrel (2 of which were unloaded), 590
loaded by the source unit suite, and 167 actionable gap files. #1925 widened
the shared structured source run's own instrumentation/eligibility globs
(`BREADTH_COVERAGE_STAGE`) to include `src/lib/document/deck-kernel/**`,
which had previously been excluded from both breadth and coverage entirely;
deck-kernel turned out to be well unit-tested already. As of #1925 the
repository has 848 eligible runtime source files, 24 type-only, 30 barrel, 794
runtime-eligible, 646 loaded by the source unit suite, and 148 actionable gap
files (`DEFAULT_MAX_GAP_FILES` was lowered from 167 to 148 to match, with zero
stale slack). #1933 closed six small editor shell control gaps
(`document-export-button`, `import-button`, `page-break-indicator`,
`present-button`, `side-panel`, `visual-svg-registry`, all under
`src/components/editor/`) with direct unit tests. **Branch-local** to #1933's
own feature branch (measured before merge, not against `main`), the
repository had 848 eligible runtime source files, 24 type-only, 30 barrel,
794 runtime-eligible, 664 loaded by the source unit suite, and 130 actionable
gap files (`DEFAULT_MAX_GAP_FILES` was lowered from 148 to 130 to match, with
zero stale slack at that time). That 664/130 pair is a historical,
branch-local measurement — it is preserved here for the record but is
superseded by the authoritative merged baseline below and must not be
re-derived or restored.

**Authoritative merged Wave 5 baseline (#1943).** The 130 ceiling went stale
almost immediately: several Wave 5 batch-2 PRs merged to `main` independently
of #1933's own branch and closed additional gaps that branch could not see
at measurement time. Re-measured directly against `main` at
`cd38a40df82ce9d90d89e1784d2b2d0841eab2ac` (which already includes #1925,
#1932, and #1933 among others), the combined gate reports 848 eligible
runtime source files, 24 type-only, 30 barrel, 794 runtime-eligible, **672**
loaded by the source unit suite, 5 mapped-e2e, 0 approved exceptions, and
**117** actionable gap files. `DEFAULT_MAX_GAP_FILES` was lowered from 130 to
117 to match, with zero stale slack. Filtered percentage coverage at this
measurement was 95.41% lines / 89.58% branches / 93.91% functions — comfortably
above the unchanged 95/89/93 floors in `check-line-coverage.mjs`; #1943 did
not touch those floors, add exceptions, add new markers, or run the source
suite a second time. This merged-tree measurement is the authoritative
baseline going forward; the branch-local #1933 numbers above remain in this
document only as historical context for how the ceiling evolved.

**Slide-asset route direct coverage (#1989), rebased onto `main` at
`d66939c312b4fb1b8a906e0600a5cc796ab83ff4` (post #1987, the merged #1964
shell/schema-audit ratchet described below).** Before this rebase, #1987 had
already measured 848 eligible runtime source files, 24 type-only, 31 barrel,
11 static-data, 782 runtime-eligible, 775 loaded by the source unit suite, 6
mapped-e2e, 0 approved exceptions, and 1 actionable gap file against that
tree: `src/app/api/slide-assets/[documentId]/[...path]/route.ts`. The route
handler had no direct behavior coverage: its previous test (`route.test.ts`)
only exercised the pure `decideSlideAssetAccess` helper the handler calls,
not the `GET` export itself (the file's header comment explained this as a
limitation of `node:test`'s `mock.module`, which is unrelated to the
`node:module` `registerHooks` module-customization API other route tests in
this repository already use to stub dependencies). #1989 rewrote the test to
invoke the real `GET` handler with `registerHooks` stubs at the auth
(`@/lib/session`), rate-limit (`@/lib/abuse-budget`), and passcode-cookie
(`@/lib/share-passcode-server`) boundaries, `prisma.asset.findFirst` patched
per-test via `Object.defineProperty`, and a real in-memory storage adapter
injected through `setDefaultStorageAdapter` — mirroring
`brand-assets/[ownerId]/[...path]/route.test.ts`. The rewritten suite covers
the abuse-budget gate (429/Retry-After, skip-when-no-secret, allowed
fall-through), storage-key reconstruction from the catch-all path segments,
privacy 404s (missing asset, document relation cleared, soft-deleted
document), authenticated capability access (owner, workspace editor/viewer,
unrelated user forbidden), anonymous public present/embed access (including
`shareMode` validation, mismatched/missing share-id proof, and the
passcode-gated branch), the 200 success path, and storage-adapter-failure
absorption into a 404. No production files changed; `decideSlideAssetAccess`'s
own exhaustive access-matrix coverage is unaffected and still lives in
`asset-access.test.ts`. This closed the sole remaining actionable gap file.
Re-measured directly against this tree: 848 eligible runtime source files
(unchanged), 24 type-only (unchanged), 31 barrel (unchanged), 11 static-data
(unchanged), 782 runtime-eligible (unchanged), **776** loaded by the source
unit suite (775 pre-#1989 + 1 from #1989), 6 mapped-e2e (unchanged), 0
approved exceptions, and **0** actionable gap files. `DEFAULT_MAX_GAP_FILES`
was lowered from 1 to **0** to match, with zero stale slack. This is the
authoritative baseline going forward; the #1964 entry below (and everything
further below it) remains in this document only as historical context for
how the ceiling evolved.

**Shell/schema-audit runtime direct coverage (#1964), rebased onto `main` at
`b9837692f5c74ba275bd78f1ea5365ab88eba93a` (post #1986, the merged #1963
visual popover/canvas/export-dialog ratchet described below).** Before this
rebase, #1986 had already measured 848 eligible runtime source files, 24
type-only, 31 barrel, 11 static-data, 782 runtime-eligible, 774 loaded by the
source unit suite, 6 mapped-e2e, 0 approved exceptions, and 2 actionable gap
files against that tree: `src/app/api/slide-assets/[documentId]/[...path]/
route.ts` and `src/scripts/audit-persisted-schema.ts`. Six shell/UI
components had no direct unit coverage — `sign-out-button.tsx`,
`theme-mode-button.tsx`, `user-menu.tsx`, `mobile-nav-menu.tsx`,
`header-gate.tsx`, and `mobile-viewport-sync.tsx` — plus
`share/social-share-menu.tsx`, which was already transitively loaded by
`share-button.test.tsx` (#1961) but had no dedicated test of its own, and the
`audit-persisted-schema.ts` CLI script, whose logic lived entirely behind an
untestable `import.meta.url` top-level-await main guard. #1964 added direct,
behavior-asserting unit tests for all seven components (signout form/action
pending-state, theme selection/current/system/accessibility, user/mobile-nav
menu open-close/click-outside/escape/navigation, route-based header gating,
`visualViewport` CSS updates/listener cleanup/fallback, and social
clipboard/native-share/platform-intent/success/error/unsupported flows), and
extracted a typed, dependency-injected `runAuditMain`/`AuditDb` seam out of
the audit script (mirroring `src/lib/maintenance/retention-runner.ts`'s
injectable `db` pattern) so `audit-persisted-schema.test.ts` can drive
pagination, query-sequencing, `--json`/`--ci`/`--strict` output, and
disconnect/error-propagation behavior with a fake in-memory `db` — no real
Prisma client or subprocess. Of these eight target files, seven were already
unit-loaded transitively before this change (their own direct tests deepen
genuine behavioral assertion coverage but do not move the gap count);
`audit-persisted-schema.ts` was the one genuine gap closure. Re-measured
directly against this tree: 848 eligible runtime source files (unchanged), 24
type-only (unchanged), 31 barrel (unchanged), 11 static-data (unchanged), 782
runtime-eligible (unchanged), **775** loaded by the source unit suite (774
pre-#1964 + 1 from #1964), 6 mapped-e2e (unchanged), 0 approved exceptions,
and **1** actionable gap file (`src/app/api/slide-assets/[documentId]/
[...path]/route.ts` — pre-existing, unrelated to this branch).
`DEFAULT_MAX_GAP_FILES` was lowered from 2 to 1 to match, with zero stale
slack. This is the authoritative baseline going forward; the #1963 entry
below (and everything further below it) remains in this document only as
historical context for how the ceiling evolved.

**Visual popover/canvas/export-dialog direct coverage (#1963), mechanically
rebased onto `main` at `67f9311a` (post #1978, which folds in #1958's nine
core-editor-interaction closures on top of #1957/#1961/#1959/#1960/#1962 and
their dependents).** Before this rebase, #1978 had already measured 848
eligible runtime source files, 24 type-only, 31 barrel, 11 static-data, 782
runtime-eligible, 769 loaded by the source unit suite, 6 mapped-e2e, 0
approved exceptions, and 7 actionable gap files against that tree:
`src/app/api/slide-assets/[documentId]/[...path]/route.ts`,
`src/app/app/documents/[id]/visual-context-popover-panels.tsx`,
`visual-context-popover.tsx`, `visual-editor.tsx`,
`src/components/visual/export-dialog.tsx`, `export-menu.tsx`, and
`src/scripts/audit-persisted-schema.ts`. #1963 added direct,
behavior-asserting unit tests for four of those seven previously-untested
large visual-editing components: `src/app/app/documents/[id]/
visual-context-popover.tsx`, `src/app/app/documents/[id]/
visual-context-popover-panels.tsx`, `src/app/app/documents/[id]/
visual-editor.tsx`, and `src/components/visual/export-dialog.tsx` (popover
open/close/panel-switching/brand/context-sync/AI-generation/error/
accessibility, panel controls/callbacks/disabled states, canvas selection/
drag/resize/edge-editing/undo/error-cleanup, and export format/background/
scale/preview/download/pending/failure behavior), reusing the
already-covered popover hooks, panel context, and export fixtures rather
than duplicating their logic — no production code required extraction to
make this directly testable. This closed the same four direct gaps plus one
legitimate transitive gap file, `src/components/visual/export-menu.tsx`,
whose rendering and entitlement-gated behavior is now genuinely exercised
(not stubbed) by the new `visual-context-popover.test.tsx` and
`visual-context-popover-panels.test.tsx` suites. `src/app/app/documents/[id]/
icon-picker.tsx` was already closed by #1978/#1958 before this rebase and is
unaffected by #1963. `src/components/visual/generated-candidates-panel.tsx`
was also directly tested in this change but was already transitively loaded
(not a gap) beforehand, so it does not add to the closure count. Re-measured
directly against this tree: 848 eligible runtime source files (unchanged),
24 type-only (unchanged), 31 barrel (unchanged), 11 static-data (unchanged),
782 runtime-eligible (unchanged — #1963 adds no new source files, only
tests within already-eligible files), 774 loaded by the source
unit suite (769 #1978 baseline + 5 from #1963), 6 mapped-e2e
(unchanged), 0 approved exceptions, and **2** actionable gap files
(`src/app/api/slide-assets/[documentId]/[...path]/route.ts` and
`src/scripts/audit-persisted-schema.ts` — both pre-existing, unrelated to
this branch). `DEFAULT_MAX_GAP_FILES` was lowered from 7 to **2**
to match, with zero stale slack. This was the authoritative baseline until
superseded by the #1964 measurement above; the historical entries below
(including the #1958/7-ceiling entry, now superseded by this entry, and this
branch's own pre-rebase 766/10 measurement against `a5f683f3`, which is no
longer accurate now that #1978 has independently closed the icon-picker.tsx
gap) remain only as historical context for how the ceiling evolved.

**Core-editor-interaction direct coverage (#1958), mechanically rebased onto
`main` at `a5ead8fc` (post #1984, which folds in #1957/#1961/#1959/#1960/
#1962 and their dependents).** Nine core document-editor files had no direct
unit coverage, represented only by mapped/skipped E2E evidence:
`src/app/app/documents/[id]/block-spark.tsx`, `floating-text-toolbar.tsx`,
`icon-picker.tsx`, `import-plugin.tsx`, `insert-menu.tsx`,
`lexical-editor.tsx`, `table-controls.tsx`, `visual-card.tsx`, and
`page.tsx`. #1958 added direct, behavior-asserting unit tests for all nine
via a new shared `src/test/lexical-component-harness.ts` harness
(command/plugin registration, selection/visibility gating, menu open/close/
actions, table row/column/cell operations, visual card selection/actions,
BlockSpark generation, and the server page's auth/document-scoping/
composition behavior); no production files changed. Measured directly
against the rebased tree before this branch's own commit lands (`main` at
`a5ead8fc` alone): 848 eligible runtime source files, 24 type-only, 31
barrel, 11 static-data, 782 runtime-eligible, 760 loaded by the source unit
suite, 6 mapped-e2e, 0 approved exceptions, and 16 actionable gap files —
nine of which are exactly the #1958 target files above (the 27 ceiling
inherited from #1961 already had slack: later `main` commits closed gaps of
their own without ratcheting the constant down, per this gate's
improvements-always-pass design). With #1958's nine target files now
genuinely unit-loaded, re-measured against the full rebased tree: 769 loaded
(760 + 9), 6 mapped-e2e (unchanged), 0 approved exceptions, leaving **7**
actionable gap files (`src/app/api/slide-assets/[documentId]/[...path]/
route.ts`, `src/app/app/documents/[id]/visual-context-popover-panels.tsx`,
`visual-context-popover.tsx`, `visual-editor.tsx`,
`src/components/visual/export-dialog.tsx`, `export-menu.tsx`, and
`src/scripts/audit-persisted-schema.ts` — all pre-existing, unrelated to this
branch). `DEFAULT_MAX_GAP_FILES` was lowered from 27 to **7** to match, with
zero stale slack. This was the authoritative baseline until superseded by
the #1963 rebase above; the historical entries below (including the #1961
27-ceiling entry) remain only as historical context for how the ceiling
evolved.

**Documents/dashboard management-UI direct coverage (#1961), rebased onto
`main` (post #1972, the merged #1957 workspace/dashboard-page ratchet).**
Nine document-management files had no unit coverage at all: `document-card.tsx`,
`document-grid.tsx`, `document-list.tsx`, `document-list-toolbar.tsx`,
`document-list-undo-toast.tsx`, `documents/[id]/share-button.tsx`,
`documents/[id]/tag-control.tsx`, `documents/[id]/version-history-panel.tsx`,
and `trash/trash-list.tsx`. #1961 added direct, behavior-asserting unit tests
for all nine (list search/filter/sort/view/URL/empty states, card
menu/rename/move/trash/optimistic behavior, undo-toast portal lifecycle,
share visibility/passcode/link/copy flows, tag autocomplete, version
restore, and trash restore/permanent-delete confirmation), stubbing every
already-covered server action/service they call via a new shared
`@/test/module-stub` helper rather than re-driving it. This closed the same
9 actionable gaps plus one legitimate transitive gap file,
`src/components/share/social-share-menu.tsx`, whose presence-gating and
intent-link rendering is now genuinely exercised (not stubbed) by the new
`share-button.test.tsx`'s toggled-on/disabled-prompt tests. This branch was
originally rebased onto `main` at `d9844dbf` (post #1956's brand/billing
product-surface ratchet: 782 runtime-eligible, 725 loaded), closing the same
10 gaps for 735 loaded / 41 actionable gap files at that time, then
mechanically rebased a second time onto `main` at `90a23fcc` (#1960/#1975,
which closed 5 public-render gaps of its own, raising unit-loaded to 730 and
lowering the gap ceiling to 46 with zero gap-count change of its own to the
nine #1961 target files), measuring 740 loaded / 36 gap at that time (see
the superseded entry below). `main` then independently gained #1972 (the
merged #1957 ratchet, closing nine workspace/dashboard-page gaps and raising
unit-loaded to 739 / lowering the ceiling to 37, with zero gap-count change
of its own to the #1961 target files). Rebased a third time onto that
`main`, and re-measured directly against this tree, the same nine
newly-tested target files plus the one transitive closure leave 848
eligible runtime source files (unchanged), 24 type-only (unchanged), 31
barrel (unchanged), 11 static-data (unchanged), 782 runtime-eligible
(unchanged), **749** loaded by the source unit suite (739 #1957 baseline +
10 from #1961), 6 mapped-e2e (unchanged), 0 approved exceptions, and **27**
actionable gap files. `DEFAULT_MAX_GAP_FILES` was lowered from 37 to 27 to
match, with zero stale slack. This was the authoritative baseline until
superseded by the #1958 rebase above; the historical entries below
(including this branch's own pre-third-rebase 735/41 and 740/36
measurements, and the #1957/#1960/#1956/#1950 numbers further below) remain
in this document only as historical context for how the ceiling evolved.

**#1957 rebased onto `main` (post #1975, the merged #1960 ratchet).** Before
merge, #1957 was rebased onto a `main` that had independently gained #1975
(the merged #1960 ratchet, closing public-render page/lightbox/fallback
gaps), raising the inherited ceiling to 46 without #1957's own gap closures.
#1957 added direct behavior coverage
for nine previously mapped-E2E-only workspace/dashboard files:
`src/app/app/page.tsx` (dashboard composition, auth/scoping),
`src/app/app/join/[token]/page.tsx` (invite accept/deny/redirect outcomes),
`src/app/app/workspaces/page.tsx` (owned/member workspace list, empty
state), `src/app/app/workspaces/[id]/page.tsx` (workspace detail
composition, owner/member gating), `src/app/app/workspaces/create-workspace-button.tsx`,
`src/app/app/workspaces/[id]/invite-link-manager.tsx`,
`src/app/app/workspaces/[id]/members-list.tsx`,
`src/app/app/workspaces/[id]/workspace-documents.tsx`, and
`src/app/app/workspaces/[id]/workspace-settings.tsx`. All nine Server/Client
Components are exercised by directly importing and asserting them — pages
are invoked as plain async functions and their unrendered React element
trees are asserted via structural traversal (never mounted through
`react-test-renderer`, since they compose real `"use client"` children with
their own hooks that already have dedicated coverage elsewhere); the
interactive components are mounted through `react-test-renderer` with their
deep alias dependencies (session, prisma, workspace/invite services, etc.)
stubbed via `node:module` `registerHooks`, matching the existing sibling
`actions.test.ts` convention. `scripts/test-subsystem.mjs`'s
`documents` subsystem pattern set was widened to match
`src/app/app/page.test.tsx`, and the `workspace` subsystem pattern set was
widened to match `src/app/app/join/`, so both new page tests classify
correctly instead of falling through unclassified. An earlier revision of
`src/app/app/page.test.tsx` also imported its `./document-list` sibling for
real (unstubbed), which transitively moved five sibling dashboard client
components from unloaded to loaded: `src/app/app/document-list.tsx`,
`src/app/app/document-grid.tsx`, `src/app/app/document-card.tsx`,
`src/app/app/document-list-toolbar.tsx`, and
`src/app/app/document-list-undo-toast.tsx` (the transitive closure of
`document-list.tsx`'s own relative imports). None of those five files have a
dedicated test, and since `DashboardPage`'s test never calls React's
reconciler, none of their component bodies actually ran — they were merely
imported, so most of their lines/branches/functions were instrumented but
never exercised. That dragged the repo-wide line-coverage floor from a
passing 95.14% down to a failing 94.73% in the Node 22 Quality Gate CI run
(the floor is 95% lines), even though every unit suite passed. The fix,
applied directly in `src/app/app/page.test.tsx`, stubs `./document-list` the
same way `./actions` is already stubbed elsewhere in the same file (a
relative specifier matched literally by the `resolve` hook — there was never
a technical restriction preventing this, only a prior choice to leave it
real), which removes all five files from the instrumented set again and
restores the floor to a passing 95.21% lines. The three sibling components
this dashboard test also imports for real — `import-document-button.tsx`,
`new-document-button.tsx`, and `onboarding-checklist.tsx` — keep being
loaded for real since they were already closed directly by #1956's own unit
tests and contribute no incremental loaded-file count here. This branch was
originally rebased onto `main` at `d9844dbf` (post #1956/#1971's merged
brand/billing ratchet: 782 runtime-eligible, 725 loaded), briefly counting 9
direct + 5 transitive gaps for 739 loaded / 37 actionable gap files at that
time (before the document-list stub fix). This commit was then mechanically
rebased a second time onto `main` at `90a23fcc` (#1960/#1975, which closed 6
public-render page/lightbox/fallback gaps, raising unit-loaded to 730 and
lowering the gap ceiling to 46, with zero gap-count change of its own to the
#1957 target files), briefly measuring 744 loaded / 32 gap with the five
transitive files still counted. After the document-list stub fix removed
those five files from the loaded set again, re-measuring directly against
this twice-rebased tree leaves 848 eligible runtime source files, 24
type-only, 31 barrel, 11 static-data, 782 runtime-eligible (all unchanged),
**739** loaded by the source unit suite (730 #1960 baseline + 9 from
#1957), 6 mapped-e2e (unchanged), 0 approved exceptions, leaving **37**
actionable gap files. `DEFAULT_MAX_GAP_FILES` was lowered from 46 to
**37** to match, with zero stale slack. The nine direct target files above
remain the durable, real improvement from #1957; the five transitive files'
brief 739/32-then-744/32 loaded-credit was never true behavioral coverage
and has been given back to fix the coverage-floor regression it caused.
This was the authoritative baseline until superseded by the #1961 third
rebase above; the measurements above and the #1960/#1956/#1950 numbers below
remain in this document only as historical context for how the ceiling
evolved.

**#1961 rebased onto `main` (post #1960, the merged public-render
page/lightbox/fallback ratchet, before #1972/#1957 landed).** Nine
document-management files had no unit coverage at all: `document-card.tsx`,
`document-grid.tsx`, `document-list.tsx`, `document-list-toolbar.tsx`,
`document-list-undo-toast.tsx`, `documents/[id]/share-button.tsx`,
`documents/[id]/tag-control.tsx`, `documents/[id]/version-history-panel.tsx`,
and `trash/trash-list.tsx`. #1961 added direct, behavior-asserting unit tests
for all nine (list search/filter/sort/view/URL/empty states, card
menu/rename/move/trash/optimistic behavior, undo-toast portal lifecycle,
share visibility/passcode/link/copy flows, tag autocomplete, version
restore, and trash restore/permanent-delete confirmation), stubbing every
already-covered server action/service they call via a new shared
`@/test/module-stub` helper rather than re-driving it. This closed the same
9 actionable gaps plus one legitimate transitive gap file,
`src/components/share/social-share-menu.tsx`, whose presence-gating and
intent-link rendering is now genuinely exercised (not stubbed) by the new
`share-button.test.tsx`'s toggled-on/disabled-prompt tests. This branch was
originally rebased onto `main` at `d9844dbf` (post #1956's brand/billing
product-surface ratchet: 782 runtime-eligible, 725 loaded), closing the
same 10 gaps for 735 loaded / 41 actionable gap files at that time. That
735/41 measurement is now historical: this commit was mechanically rebased
a second time onto `main` (#1960, which closed 5 public-render gaps of its
own, raising unit-loaded to 730 and lowering the gap ceiling to 46 with
zero gap-count change of its own to the nine #1961 target files).
Re-measured directly against this twice-rebased tree, the same nine
newly-tested target files plus the one transitive closure left 848
eligible runtime source files (unchanged), 24 type-only (unchanged), 31
barrel (unchanged), 11 static-data (unchanged), 782 runtime-eligible
(unchanged), **740** loaded by the source unit suite (730 #1960 baseline +
10 from #1961), 6 mapped-e2e (unchanged), 0 approved exceptions, and **36**
actionable gap files. `DEFAULT_MAX_GAP_FILES` was lowered from 46 to 36 to
match at the time. This was the authoritative baseline until superseded by
the #1961 third rebase above (`main` independently gained #1972/#1957 in
the interim, ratcheting the ceiling to 37 before this branch's own third
rebase closed it further to 27); the 735/41 pre-second-rebase measurement
and the #1960/#1956/#1950 numbers below remain in this document only as
historical context for how the ceiling evolved.

**Public-render page/lightbox/fallback direct coverage (#1960), rebased onto
`main` (post #1956, the merged brand/billing product-surface ratchet).**
Five files were previously exercised only by E2E `notFound()` paths, leaving
their success/composition behavior untested by the unit suite:
`src/app/embed/[shareId]/page.tsx`,
`src/app/present/[shareId]/embed/page.tsx`,
`src/app/present/[shareId]/page.tsx`, `src/app/share/[shareId]/page.tsx`,
and `src/app/share/[shareId]/share-lightbox.tsx`. #1960 added direct
module-hook/server-component tests for the four page modules (stubbing
`next/navigation`, `@/app/public-abuse`, `@/lib/public-render/resolver`, and
`@/lib/share-passcode-server` while importing every other real dependency —
`SharePasscodeGate`, `PublicPresentViewer`, `LexicalReadOnly`,
`MadeWithBadge`, `ShareLightbox` — transitively through the real page
module) covering `generateMetadata` wiring, the abuse-budget short-circuit,
resolver call-argument wiring, the passcode-required gate (mode/returnTo/
resolved-shareId/query-driven alert variants), `notFound()` for other deny
reasons and defensive projection mismatches, and the successful
embed-vs-full-present composition (HUD suppressed vs. visible, recovery
passthrough, attribution badge). `share-lightbox.tsx` needed a real DOM
(portal target, `querySelectorAll`, focus management) that
`react-test-renderer` cannot provide, so it was tested with `happy-dom`'s
`Window` (already a transitive dependency exercised directly by
`inline-text-dom-adapter.test.ts`) driven by `react-dom/client`'s
`createRoot` and React 19's built-in `act`, with `matchMedia` polyfilled to
force `framer-motion`'s reduced-motion branch for deterministic output —
covering open/close via click, keyboard (Enter/Space), Escape, and backdrop
mousedown, the Tab focus trap, focus restoration, body-scroll-lock
toggling, and multi-image label switching. A sixth file,
`src/components/not-found-fallback.tsx`, was already `unit-loaded`
transitively through `src/app/not-found.test.tsx`; #1960 added a direct
`not-found-fallback.test.tsx` importing it on its
own for completeness, but this does not change the loaded count. This
branch was originally rebased onto `main` at `969e6387` (post #1950's
static-data/import-alias-barrel classification: 782 runtime-eligible, 717
loaded), closing 5 actionable gaps (the sixth target file being already
loaded) for 722 loaded / 54 actionable gap files at that time. That 722/54
measurement is now historical: this commit was mechanically rebased a
second time onto `main` at `d9844dbf` (#1956/#1971, which closed 8
brand/billing/product-surface gaps, raising unit-loaded to 725 and lowering
the gap ceiling to 51 with zero gap-count change of its own to the six
#1960 target files). Re-measured directly against this twice-rebased tree,
the same five newly-tested target files leave 848 eligible runtime source
files (unchanged), 24 type-only (unchanged), 31 barrel (unchanged), 11
static-data (unchanged), 782 runtime-eligible (unchanged), **730** loaded by
the source unit suite (725 #1956 baseline + 5 from #1960), 6 mapped-e2e
(unchanged), 0 approved exceptions, and **46** actionable gap files.
`DEFAULT_MAX_GAP_FILES` was lowered from 51 to 46 to match, with zero stale
slack. This was the authoritative baseline until superseded by the #1957
rebase above; the 722/54 pre-second-rebase measurement above and the
#1956/#1950 numbers below remain in this document only as historical
context for how the ceiling evolved.

**#1956 rebased onto `main` (post #1969, the merged #1950 static-data/
import-alias-barrel classification).** #1956 was originally measured against
a pre-#1950 tree (736 loaded, 52 actionable gap, 794 runtime-eligible); after
this mandatory rebase onto `main` at `969e6387` (the merged #1950 ratchet,
which lowered runtime-eligible to 782 and folded 12 previously-runtime files
into `barrel`/`static-data`), that measurement is superseded and marked
historical below. #1956 itself still closes the same 8 actionable gaps with
direct, behavior-asserting unit tests, replacing the "too DOM/portal-coupled
for a fast unit harness" conclusion for `brand-studio-teaser.tsx`,
`brand-studio.tsx`, `brands/page.tsx`, `import-document-button.tsx`,
`new-document-button.tsx`, `onboarding-checklist.tsx`, and
`settings/billing/page.tsx` (the seven files this issue targeted), plus one
legitimate transitive gap, `src/app/app/brands/brand-studio-ports.ts`, whose
`BrandUploadPort` contract is now genuinely exercised (not stubbed) by the
new `brand-studio.test.tsx`'s logo/font upload tests. Re-measured directly
against the rebased tree: 848 eligible runtime source files (unchanged), 24
type-only (unchanged), 31 barrel (unchanged), 11 static-data (unchanged),
782 runtime-eligible (unchanged by #1956 — it adds no new source files, only
tests and extractions of existing logic into already-eligible files), 725
loaded by the source unit suite (717 #1950 baseline + 8 from #1956), 6
mapped-e2e (unchanged), 0 approved exceptions, and 51 actionable gap files.
`DEFAULT_MAX_GAP_FILES` was lowered from 59 to 51 to match, with zero stale
slack. #1956 added no
`mapped-e2e`/`approved-exception` markers and did not touch the
line/branch/function percentage floors. This was the authoritative baseline
until superseded by the #1957 rebase above; the pre-rebase 736/52
measurement above and the #1950/#1949 numbers below remain in this document
only as historical context for how the ceiling evolved.

**Static-data and import-alias-barrel classification (#1950), rebased onto
`main` (post #1970, the merged #1949 ratchet).** Before merge, #1950 was
rebased onto a `main` that had independently gained #1970 (the merged
#1949 ratchet, closing the loading-boundary and editor-glue exception
candidates), raising the inherited ceiling to 60 without #1950's own gap
closures. Two behavior-free shapes were previously misclassified as
`runtime` purely because they contain no local functions but also weren't
recognized as `type-only`/`barrel`: (1) route modules whose only runtime
exports are `const` aliases to a non-computed property access on an
imported binding (e.g. `src/app/api/auth/[...nextauth]/route.ts`'s
`export const GET = handlers.GET;`) are re-export glue and are now folded
into `barrel`; (2) modules containing only types plus `const` data built
entirely from static primitive/template literals and recursively static
arrays/objects (e.g. `src/lib/app-shell/chrome.ts`) have nothing to unit
test and are now classified into a new `static-data` category, counted as
excluded alongside `type-only`/`barrel` rather than as `runtime-eligible`.
Both checks are conservative by construction: namespace imports (`import *
as ns`), computed property access, optional chaining, calls, `await`,
`new`, mutable (`let`/`var`) declarations, spreads, computed keys,
getters/setters, tagged templates, and identifier-/binary-/conditional-
dependent values all fall through to `runtime`, matched by an exhaustive
set of lookalike fixtures in `coverage-breadth.test.mjs` that assert no
false suppression. Re-measured directly against the rebased branch: 848
eligible runtime source files (unchanged), 24 type-only (unchanged), **31**
barrel (+1, the nextauth route handler), **11** static-data (new bucket —
`src/lib/app-shell/chrome.ts`, `src/components/motion/tokens.ts`,
`src/lib/auth/form-state.ts`, `src/lib/presentation/schema.ts`'s type
definitions plus its single `DECK_SCHEMA_VERSION` constant,
`src/lib/icons/data.ts`,
`src/lib/visual/{display-styles,registry-prompt,themes}.ts`, and three
`src/lib/document/deck-kernel/` primitive-id files — all eleven
independently audited and confirmed to contain no functions, classes, or
value imports), **782** runtime-eligible (down from 794), **717** loaded by
the source unit suite (down from 728 — eleven of the twelve reclassified
files were previously unit-loaded), 6 mapped-e2e (unchanged), 0 approved
exceptions, and **59** actionable gap files (down from 60 — the twelfth
reclassified file, the nextauth route handler, was the prior gap file that
moved directly into `barrel`). `DEFAULT_MAX_GAP_FILES` was lowered from 60
to 59 to match, with zero stale slack. This was the authoritative baseline
until superseded by the #1957 measurement above; the historical entries
below remain only as context for how the ceiling evolved before #1950.

**#1949 rebased onto `main` (post #1966, the merged #1948 ratchet).** #1949
replaced the "rejected exception candidate" conclusion for nine files with
direct coverage: `src/lib/visual/export-settings.ts` and
`src/app/app/documents/[id]/insert-visual-plugin.tsx` gained real headless-
Lexical/React-render tests, and all seven route `loading.tsx` boundaries
(`app`, `documents/[id]`, `brands`, `settings`, `settings/billing`,
`workspaces`, `workspaces/[id]`) gained a single batch-render test asserting
distinct accessible labels/status/busy semantics and meaningful skeleton
structure. Re-measured directly against the rebased branch: 848 eligible
runtime source files, 24 type-only, 30 barrel, 794 runtime-eligible, **728**
loaded by the source unit suite (718 #1966 baseline + 9 target files +
`src/components/ui/skeleton.tsx`, the shared primitive closed transitively
by the loading-boundary batch test), 6 mapped-e2e (unchanged), 0 approved
exceptions, and **60** actionable gap files. `DEFAULT_MAX_GAP_FILES` was
lowered from 70 to 60 to match, with zero stale slack. This was the
authoritative baseline until superseded by the #1950 rebase above; the
`#1948 rebased onto main` numbers below remain in this document only as
historical context for how the ceiling evolved.

**#1948 rebased onto `main` (post #1954).** Before merge, #1948 was rebased
onto a `main` that had independently gained #1954 (the rebased #1947
ratchet, itself absorbing #1951 and #1952), raising the inherited ceiling to
94 without #1948's own gap closures. #1948 replaced the "untestable
exception" conclusion for ten framework/page files with direct coverage:
nine files (`src/app/layout.tsx`, `error.tsx`, `not-found.tsx`,
`signout/route.ts`, `forgot-password/page.tsx`, `reset-password/page.tsx`,
`visuals/page.tsx`, `src/components/site-header.tsx`,
`src/app/app/trash/page.tsx`) gained direct module-hook/server-component
render tests, and the tenth (`src/app/page.tsx`) gained a
`coverage-breadth: mapped-e2e` marker referencing the always-running
`e2e/public-render/public-pages.spec.ts` (which already asserts the landing
page's unique "Turn text into visuals" heading), rather than a new or
duplicated E2E flow. Re-measured directly against the rebased branch: 848
eligible runtime source files, 24 type-only, 30 barrel, 794 runtime-eligible,
**718** loaded by the source unit suite (695 #1954 baseline + 23 from #1948
— the nine direct targets plus real sibling components/dependencies
exercised transitively through them, e.g. `trash-list.tsx`,
`site-header-view.tsx`; fewer newly-loaded files than the original
branch-local 672 → 698 delta because several of those siblings were already
loaded transitively via #1947/#1951/#1952 by rebase time), **6** mapped-e2e
(up from 5), 0 approved exceptions, and **70** actionable gap files.
`DEFAULT_MAX_GAP_FILES` was lowered from 94 to 70 to match, with zero stale
slack. This was the authoritative baseline until superseded by the #1950
rebase above; the branch-local #1948 numbers below (90, measured before
#1948 was rebased onto #1954) are historical/superseded and remain only as
context for how the ceiling evolved.

**#1948 branch-local measurement (superseded above by the rebased
measurement).** The prior "untestable exception" conclusion for ten
framework/page files was revisited and replaced with direct coverage,
described above. Re-measured on top of the #1943 baseline (before
#1947/#1951/#1952/#1954 existed): 848 eligible runtime source files, 24
type-only, 30 barrel, 794 runtime-eligible, **698** loaded by the source unit
suite (up from 672), **6** mapped-e2e (up from 5), 0 approved exceptions, and
**90** actionable gap files. `DEFAULT_MAX_GAP_FILES` was lowered from 117 to
90 to match at the time, with zero stale slack. That number is historical
and no longer reflects `main`.

**#1947 rebased onto `main` (post #1951/#1952).** Before merge, #1947 was
rebased onto a `main` that had independently gained two more gap-closing PRs
invisible to the branch-local measurement above: #1951 (client runtime hooks,
+8 loaded) and #1952 (server loader contracts, +10 loaded), neither of which
lowered the inherited 117 ceiling. Re-measured directly against the rebased
branch: 848 eligible runtime source files, 24 type-only, 30 barrel, 794
runtime-eligible, **695** loaded by the source unit suite (672 Wave 5
baseline + 8 from #1951 + 10 from #1952 + 5 from #1947), 5 mapped-e2e, 0
approved exceptions, leaving **94** actionable gap files. `DEFAULT_MAX_GAP_FILES`
was lowered from 117 to 94 to match, with zero stale slack. This was the
authoritative baseline until superseded by the #1948 rebase above; the
branch-local #1947 numbers below remain in this document only as historical
context.

Widening breadth eligibility/instrumentation to include deck-kernel would also
widen `summary.totals` — the data the line/branch/function percentage floors
are checked against — to include deck-kernel, which was never the intent of
#1925 (only breadth _visibility_ should change, not the percentage floors).
`aggregateCoverageTotals` in `coverage-breadth.mjs` recomputes those totals
from `summary.files` instead, re-applying the original deck-kernel exclusion
(`PERCENTAGE_ONLY_EXCLUDE_GLOBS`) as a percentage-only filter, so
`test:line-coverage`'s and `test:combined-coverage`'s reported
line/branch/function percentages are unaffected by the breadth widening.

On the combined `npm test` path (`scripts/check-combined-coverage.mjs`, #1919)
this exact same computation — same eligibility scan, same classification,
same ratchet — runs against the loaded-file set from the single shared source
suite run instead of a dedicated second run; `npm run test:coverage-breadth`
still runs it standalone, independently, with its own dedicated run.

## Lint Chain

`npm run lint` runs domain checks before ESLint:

| Check                          | Protects                                                              |
| ------------------------------ | --------------------------------------------------------------------- |
| `design-system:check`          | Token, z-index, color, and shared UI guardrails.                      |
| `action-ports:check`           | Server/client action port inventory and ownership.                    |
| `next-build-constraints:check` | Next build/static-analysis constraints.                               |
| `client-boundary:check`        | Server-only imports do not cross into client bundles.                 |
| `import-graph:check`           | Import cycles, barrel drift, and forbidden internal facade imports.   |
| `e2e-governance:check`         | E2E file ownership and naming conventions.                            |
| `perf-budgets:check`           | Runtime payload, static import, and slide-editor composition budgets. |
| `eslint`                       | TypeScript/React lint rules after repository-specific checks pass.    |

Prettier is not part of `npm run lint`. Repository formatting is checked by the
separate `npm run format:check` gate, while Markdown formatting for docs is also
checked inside `npm run docs:check`.

## Docs Gate

`npm run docs:check` verifies:

1. API route security matrix contracts via `src/app/api/api-route-security-matrix.test.ts`.
2. Runtime config and API route inventory drift via `scripts/check-docs-source-inventory.mjs`.
3. Local docs links and docs index reachability via `scripts/check-docs-links.mjs`.
4. Markdown Prettier formatting for `docs/**/*.md`.

Docs are still source-backed: when source files, route files, env reads, or
schema gates change, update the owning subsystem docs in the same change.

## Schema And Build Gates

`db:schema:check` verifies the generated SQLite Prisma schema is current.
`db:generate` refreshes the Prisma client and generated SQLite schema when
needed. Production install smoke (`production-install:smoke`) verifies runtime
dependencies are available after `npm ci --omit=dev`.

`npm run build` remains the broad Next.js production build gate. The narrower
`next-build-constraints:check` catches known build hazards earlier in the lint
chain.

## Invariants

1. Fast focused checks should run before broad gates when a subsystem is known.
2. Broad gates must remain deterministic and credential-free unless explicitly
   documented as E2E or production-install smoke.
3. Governance scripts own repository conventions; product subsystem docs own
   runtime behavior.
4. New scripts that block lint, test, docs, build, or release must be listed in
   this document and covered by focused script tests.

## Primary Tests

- `scripts/ci-local.test.mjs`
- `scripts/test-subsystem.test.mjs`
- `scripts/check-combined-coverage.test.mjs`
- `scripts/check-line-coverage.test.mjs`
- `scripts/coverage-breadth.test.mjs`
- `scripts/check-coverage-breadth.test.mjs`
- `scripts/check-docs-source-inventory.test.mjs`
- `scripts/check-docs-links.test.mjs`
- `scripts/import-graph.test.mjs`
- `scripts/client-boundary.test.mjs`
- `scripts/check-action-ports.test.mjs`
- `scripts/check-design-system.test.mjs`
- `scripts/check-next-build-constraints.test.mjs`
- `scripts/check-e2e-governance.test.mjs`
- `scripts/perf-budgets.test.mjs`
