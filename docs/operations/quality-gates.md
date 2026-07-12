---
type: "reference"
status: "current"
last_updated: "2026-07-11"
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
   `barrel` (nothing but import/re-export statements — no local logic), or
   `runtime` (has behavior that should be unit-tested).
4. Assigns every eligible file exactly one testing mode: `unit-loaded`,
   `type-only`, `barrel`, `mapped-e2e`, `approved-exception`, or `gap` (an
   unresolved, actionable blind spot). E2E-mapped and approved-exception
   files are never counted as unit-covered.

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
- `scripts/check-import-graph.test.mjs`
- `scripts/check-client-boundary.test.mjs`
- `scripts/check-action-ports.test.mjs`
- `scripts/check-design-system.test.mjs`
- `scripts/check-next-build-constraints.test.mjs`
- `scripts/check-e2e-governance.test.mjs`
- `scripts/perf-budgets.test.mjs`
