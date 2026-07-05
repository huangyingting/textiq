---
type: "runbook"
status: "active gate"
last_updated: "2026-07-02"
description: "Release gate and readiness checklist for system stabilization, validation evidence, local release checks, known release caveats, rollback criteria, and foundation release readiness."
---

# Release Gate and Readiness Checklist

**Epic:** #455 — System stabilization and release readiness for document visuals  
**Issue:** #456

Review before every foundation release wave.

---

## Overview

This document defines the concrete release-readiness gate for the TextIQ
document-visuals and Slides foundation. Every item below must pass (or be
explicitly deferred with a written justification) before expanding into the
next feature wave.

The gate is intentionally small: it must be runnable by any team member in
under 30 minutes.

---

## Part 1 — Automated quality gate

The primary gate is a single CI command that runs on every push to `main` and
on every pull request (see `.github/workflows/ci.yml`):

The individual scripts and ownership rules are documented in
[quality-gates.md](quality-gates.md); this runbook records the release-blocking
sequence.

```bash
export DB_PROVIDER=sqlite DATABASE_URL="file:./prisma/dev.db" AUTH_SECRET=ci-placeholder
npm run db:schema:check
npm run db:generate
npm test && npm run typecheck && npm run typecheck:unused && npm run lint && npm run docs:check && npm run format:check && npm run build
```

| Step                | Tool / command             | Failure means                                                                                                       |
| ------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| SQLite schema drift | `npm run db:schema:check`  | The generated SQLite schema is stale                                                                                |
| Prisma client       | `npm run db:generate`      | Generated Prisma client cannot be refreshed                                                                         |
| Unit + pure tests   | `npm test`                 | A pure helper, schema, or domain model is broken                                                                    |
| TypeScript          | `npm run typecheck`        | Type errors or unused symbols in src/ or scripts                                                                    |
| Unused guard        | `npm run typecheck:unused` | Focused unused-symbol gate regressed                                                                                |
| Lint                | `npm run lint`             | Client dependency boundary, import-graph, design-system, action-port, performance-budget, or ESLint rule violations |
| Docs verification   | `npm run docs:check`       | Runtime config, route inventory, docs links/indexes, or docs formatting drifted                                     |
| Formatting          | `npm run format:check`     | Prettier formatting drift                                                                                           |
| Build               | `npm run build`            | Next.js production build or static-analysis constraints regressed                                                   |

**All nine steps must be green. A single failure is a release blocker.**

The CI job is defined in `.github/workflows/ci.yml` (`quality-gate` job,
Node 22, SQLite). CI runs the SQLite schema drift check before refreshing the
generated Prisma client, so stale `prisma/schema.sqlite.prisma` changes fail
before typechecking. A separate
`.github/workflows/production-install-smoke.yml` job runs `npm ci --omit=dev`,
`npm run db:generate`, and `npm run production-install:smoke` so runtime
dependencies cannot accidentally live only in `devDependencies`.

Runtime environment variables used by this gate and by deployed services are
inventoried in [runtime-config.md](./runtime-config.md).

### Product telemetry and release observability (Epic #1046 / N16)

Product telemetry is privacy-safe by construction and separate from security
audit events. The taxonomy and no-op-by-default emitter live in
`src/lib/telemetry/product.ts`; release aggregate helpers live in
`src/lib/telemetry/release-report.ts`.

Before a release, review aggregate telemetry only:

- funnel health: onboarding activation/dismissal, import/export success/failure,
  AI visual candidate/apply, and AI deck candidate/apply/save counts;
- error rates: stable reason codes such as `validation`, `quota`, `rate_limit`,
  `timeout`, `server`, `entitlement`, and `empty_blob`;
- performance regressions: duration buckets only, not raw timing traces;
- gate status: the automated quality gate results in this document.

Do not inspect or export raw event payloads for release sign-off. Events carry
ids/enums/counts/buckets only and must never include email, names, document text,
prompt/source text, raw filenames, or uploaded content.

### Focused documentation gate (Epic #1004 / N8)

`npm run docs:check` is the release-gate shortcut for source-driven docs drift.
It runs:

1. `node --import tsx --test src/app/api/api-route-security-matrix.test.ts` —
   reuses the API route matrix schema/inventory guard.
2. `scripts/check-docs-source-inventory.mjs` — compares source environment reads
   with [runtime-config.md](./runtime-config.md) and API route files with the
   [security matrix](../security/api-route-security-matrix.md). Unknown env reads
   or routes fail with the source locations / route names to document.
3. `scripts/check-docs-links.mjs` — validates local docs markdown links, confirms
   all docs are reachable from [docs/README.md](../README.md), and requires a
   `README.md` index in each docs directory.
4. `prettier --check "docs/**/*.md"` — keeps documentation formatting reviewable.

### Persisted-schema audit (Epic #493)

The automated gate above validates code. A second, data-facing gate validates
the **persisted payloads** the runtime trusts — `Document.deckJson`, embedded
`Document.contentJson` visuals, `Visual.data`, and active Deck source metadata
(`slides[].source`, `slides[].children[].source`).
Run it against a target database (staging or a production replica) before a
release wave:

```bash
npm run audit:schema -- --ci
```

The CLI (`src/scripts/audit-persisted-schema.ts`, core in
`src/lib/schema-audit/audit.ts`) exits non-zero when any row fails its schema
validator (`safeParseDeck` for `Document.deckJson` and
`DocumentVersion.deckJson`) and reports only safe identifiers (document id / row
id / schema area / failure reason) — never document content. A clean run is a
precondition for release; drift is remediated with the
[repair playbook](./schema-repair-runbook.md).

### Test coverage scope

`npm test` runs:

- `scripts/check-line-coverage.mjs` to run the source and script unit tests
  under Node's built-in line coverage gate. The default minimums are the current
  loaded-source baseline floors: `95%` for `src/**/*.ts[x]` and `99%` for
  `scripts/**/*.mjs`. The source floor is temporary during presentation backlog closure;
  restore/increase it after issues are addressed, with a final hardening target
  to try for `100%`. Raise both with `LINE_COVERAGE_MIN=100`, or override one
  gate with `SOURCE_LINE_COVERAGE_MIN` / `SCRIPT_LINE_COVERAGE_MIN`.
- `scripts/test-subsystem.mjs --check` to ensure every source, script, and E2E
  test file is assigned to at least one subsystem bucket and that subsystem test
  file names / test case names stay reviewable.

For focused local work, run the owning subsystem instead of the whole unit gate:

```bash
npm run test:subsystem -- editor
npm run test:subsystem -- presentation --with-e2e
npm run test:subsystem -- --list
```

The shortcut scripts (`test:auth`, `test:collab`, `test:documents`,
`test:editor`, `test:import`, `test:presentation`, `test:public-render`,
`test:security`, `test:visual`, and `test:operations`) call the same router.
E2E specs remain opt-in for focused runs; add `--with-e2e` when the changed
subsystem needs its mapped Playwright coverage.

The following subsystems have dedicated test files that must stay green:

| Subsystem                            | Test file(s)                                                                                                                                                                            |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Block identity (#430)                | `src/lib/lexical/block-id.test.ts`                                                                                                                                                      |
| Visual mirror diff (#448)            | `src/lib/visual/mirror-diff.test.ts`, `mirror-repair.test.ts`                                                                                                                           |
| Command envelope (#436)              | `src/lib/commands/`, `src/lib/presentation/editor-commands*.test.ts`                                                                                                                    |
| Deck save / conflict (#376)          | `src/lib/document/deck-cas-writer.test.ts`, `src/lib/presentation/slide-editor-collaboration-state.test.ts`                                                                             |
| Export preflight (#416)              | `src/lib/visual/export-preflight.test.ts`                                                                                                                                               |
| Authorization                        | `src/lib/auth/document-permissions.test.ts`, `authz-regression.test.ts`                                                                                                                 |
| API surface governance (#495)        | `src/app/api/api-route-security-matrix.test.ts`, `src/lib/api/errors.test.ts`, `src/lib/diagnostics/api-abuse.test.ts`, `src/app/api/slide-assets/[documentId]/[...path]/route.test.ts` |
| Structured diagnostics (#460)        | `src/lib/diagnostics/error-codes.test.ts`                                                                                                                                               |
| Performance budgets (#461)           | `scripts/perf-budgets.test.mjs`, `scripts/slide-editor-size-budget.test.mjs`                                                                                                            |
| Autosave / conflict hardening (#459) | `src/lib/presentation/slide-editor-collaboration-state.test.ts`, `src/lib/document/deck-cas-writer.test.ts`                                                                             |
| A11y helpers (#462)                  | `src/lib/a11y/a11y-helpers.test.ts`                                                                                                                                                     |

---

### Critical-flow E2E profile (Epic #517)

The unit gate above is intentionally credential-less and never starts a server.
A second, required **deterministic E2E profile** drives the critical product
flows end to end through a real browser. It is **not** part of `npm test` or the
required fast gate — it runs in a dedicated CI job against a seeded database and
prebuilt Playwright-started app.

```bash
# 1. Seed the deterministic fixture (owner + viewer users, one shared document
#    with text + visual + deckJson + public share policy + a slide image asset,
#    plus a private document/asset for access-control checks).
export DB_PROVIDER=sqlite DATABASE_URL="file:./prisma/dev.db" AUTH_SECRET=ci-placeholder
npm run db:reset        # or db:push
npm run db:seed:e2e     # writes e2e/.e2e-fixture.json + storage/slide-assets/…

# 2. Start the app, then run the profile suite (sets E2E_PROFILE=1).
npm run dev &
npm run test:e2e:profile
```

For fresh checkouts or CI parity, prefer the self-contained profile runner:

```bash
npm run test:e2e:profile:self-contained
```

Key properties:

- The seeded **document URL** (`/app/documents/<documentId>`) and **share id**
  (`<slug>-<shareId>`) are **deterministic** — the seed and the specs share one
  source of truth in `e2e/helpers/profile.ts`.
- Under the profile (`E2E_PROFILE=1`), authenticated specs **do not skip**; they
  run for real. Without it, every profile-dependent spec **skips cleanly** so the
  credential-less fast gate and CI stay green.
- `.github/workflows/e2e-deterministic.yml` is a hard PR/push gate: it runs the
  self-contained profile wrapper and fails the workflow on any profile failure.
- Seeded owner/viewer emails and passwords are fixed test credentials (see
  `e2e/helpers/profile.ts` / the emitted `e2e/.e2e-fixture.json`).

| Spec (Epic #517)                    | Covers                                                                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `import-roundtrip.spec.ts`          | #519 Markdown import → editor render → edit/save → reload persistence; unsupported-type error                           |
| `present-export.spec.ts`            | #520 authenticated + public present render seeded text; real PDF download (nonzero bytes)                               |
| `slide-asset-upload.spec.ts`        | #521 inspector image upload → reload resolves protected asset; private-asset 403 vs shared 200                          |
| `slides-layout-screenshots.spec.ts` | #1449 deterministic presentation layout screenshots (desktop/tablet/mobile + rail-hidden + notes-expanded + panel-open) |

See [`e2e/README.md`](../../e2e/README.md) for the full environment-variable
reference and per-spec run instructions.

---

## Part 2 — Critical flow checklist

For each flow below, check the indicated owner: **A** = automated test,
**M** = manual smoke, **I** = documented invariant, **D** = deferred risk.

### Document flows

| #   | Flow                              | Owner           | Notes                                                                                                                     |
| --- | --------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| D-1 | Document edit and Lexical save    | **A**           | `saveDocumentLexical` path; block-id stamping tested                                                                      |
| D-2 | Inline visual edit and save       | **A**           | `mirrorVisualNodes` + diff tested                                                                                         |
| D-3 | Document duplicate                | **A**           | `regenerateBlockIds` tested; share-id regeneration tested                                                                 |
| D-4 | Document version restore          | **A**           | Snapshot policy tested in `save-conflict.test.ts`                                                                         |
| D-5 | Document import (markdown, .docx) | **M** + **E2E** | Pure import helpers tested; Markdown round-trip in `e2e/import-roundtrip.spec.ts` (#519); DOCX UI round-trip still manual |
| D-6 | Document search                   | **A**           | `search.test.ts`                                                                                                          |
| D-7 | Document delete / trash / restore | **A**           | `trash.test.ts`                                                                                                           |

### Slide / deck flows

| #   | Flow                                | Owner           | Notes                                                                                                                                                                       |
| --- | ----------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-1 | Slide edit and autosave (deck JSON) | **A**           | Deck CAS + autosave path covered by `deck-cas-writer.test.ts` and `use-slide-editor-open.test.ts`                                                                           |
| S-2 | Deck patch save (`saveDeckPatch`)   | **D**           | Current `patchDeck` implementation is fallback-only (`{ ok: "fallback" }`); fallback behavior covered by `persistence-service.test.ts` and `patch-autosave.test.ts` (#1336) |
| S-3 | Stale revision conflict recovery    | **A**           | Deck stale-token handling + conflict state covered by `deck-cas-writer.test.ts`, `use-slide-editor-open.test.ts`, and `slide-editor-collaboration-state.test.ts`            |
| S-4 | Oversized deck rejection            | **A**           | `perf-budgets.test.ts`, `autosave-hardening.test.ts`                                                                                                                        |
| S-5 | Present mode (read-only render)     | **M** + **E2E** | SlideCanvas rendering; authenticated + public present asserted in `e2e/present-export.spec.ts` (#520)                                                                       |
| S-6 | Deck PPTX / PDF export              | **A** + **E2E** | `export-preflight.test.ts`; real PDF download asserted in `e2e/present-export.spec.ts` (#520)                                                                               |
| S-7 | Export preflight (fatal / warning)  | **A**           | `export-preflight.test.ts`                                                                                                                                                  |
| S-8 | Slide editor responsive layout      | **A** + **E2E** | Deterministic presentation layout screenshots in `e2e/slides-layout-screenshots.spec.ts` (#1449)                                                                            |

### Visual projection flows

| #   | Flow                                          | Owner | Notes                                                 |
| --- | --------------------------------------------- | ----- | ----------------------------------------------------- |
| V-1 | Visual mirror sync on save                    | **A** | `mirror-diff.test.ts`, `mirror-repair.test.ts`        |
| V-2 | Visual mirror rebuild action                  | **A** | `mirror-repair.test.ts`; `autosave-hardening.test.ts` |
| V-3 | Invalid visual payload skipped (no data loss) | **A** | `mirror-diff.test.ts`, `autosave-hardening.test.ts`   |
| V-4 | Visual registry validation                    | **A** | `registry.test.ts`, `schema.test.ts`                  |
| V-5 | Source-link staleness detection               | **A** | `source-link-staleness.test.ts`                       |

### Authorization flows

| #   | Flow                                   | Owner | Notes                                                      |
| --- | -------------------------------------- | ----- | ---------------------------------------------------------- |
| A-1 | Owner / editor / viewer capabilities   | **A** | `document-permissions.test.ts`, `authz-regression.test.ts` |
| A-2 | Stranger / cross-workspace denial      | **A** | `authz-regression.test.ts`                                 |
| A-3 | Share / embed / present access control | **A** | `share-access.test.ts`, `authz-regression.test.ts`         |
| A-4 | Revoked / expired share link denial    | **A** | `authz-regression.test.ts`                                 |
| A-5 | Deck save / patch denial for viewer    | **A** | `authz-regression.test.ts`                                 |
| A-6 | Visual rebuild denial for viewer       | **A** | `authz-regression.test.ts`                                 |

### Asset flows

| #    | Flow                             | Owner           | Notes                                                                                                                                  |
| ---- | -------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| AS-1 | Image upload and protected asset | **M** + **E2E** | UI smoke; budget check in `perf-budgets.test.ts`; inspector upload + protected-asset access in `e2e/slide-asset-upload.spec.ts` (#521) |
| AS-2 | Missing asset preflight warning  | **A**           | `export-preflight.test.ts`                                                                                                             |
| AS-3 | Oversized image rejection        | **A**           | `perf-budgets.test.ts` (INLINE_IMAGE_HARD_BYTES)                                                                                       |

### Accessibility flows

| #    | Flow                                                    | Owner | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---- | ------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1 | VisualRenderer role=img + aria-label                    | **A** | `a11y-helpers.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                              |
| AC-2 | Decorative canvas elements aria-hidden                  | **A** | `a11y-helpers.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                              |
| AC-3 | Icon-only toolbar controls labelled                     | **A** | `a11y-helpers.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                              |
| AC-4 | Modal dialog semantics                                  | **A** | `a11y-helpers.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                              |
| AC-5 | Canvas keyboard resize / traversal / announcements      | **D** | presentation keyboard behavior exists in `slide-editor.tsx`, but release-gate automation is not yet tied to broad direct `SlideEditor` keyboard interaction tests. Current evidence is helper/render-level (`selection-traversal.test.ts`, `slide-canvas-render.test.ts`, `canvas-a11y.test.ts`) plus focused rotation smoke (`slide-editor-toolbar-command-surface.failures.test.ts`). Track deferred keyboard free-draw connector scope in #1574. |
| AC-6 | Content-first deck outline and per-node slide semantics | **A** | `slide-canvas-render.test.ts` verifies the screen-reader deck outline, active slide/current-node semantics, per-node narration labels, image labels, and missing-content fallbacks from the presentation outline adapter. This is reading/orientation evidence; it does not replace AC-5 editing-interaction evidence.                                                                                                                              |
| AC-7 | Stage reduced-motion and focus-visible conformance      | **A** | `slide-canvas-render.test.ts` verifies reduced-motion guards and design-system `FOCUS_RING` focus-visible styling for outline entries, focusable stage nodes, locked/grouped nodes, and editable table cells. Manual high-contrast review should confirm the DS focus token remains visible against the active theme before release sign-off.                                                                                                       |

---

## Part 3 — Blocking vs warning criteria

### Release blockers (must be green)

1. `npm run db:schema:check`, `npm run db:generate`, `npm test`,
   `npm run typecheck`, `npm run typecheck:unused`, `npm run lint`,
   `npm run docs:check`, `npm run format:check`, and `npm run build` — all green.
2. Every critical flow marked **A** above has its corresponding test passing.
3. Authorization denials (A-1 through A-6) all passing.
4. Content-first accessibility checks (AC-6 and AC-7) have passing automated
   evidence and any required high-contrast manual review recorded.
5. No structured diagnostic emitting `severity: "fatal"` in the automated test
   run.

### Release warnings (document and track, not necessarily block)

- A flow marked **M** (manual smoke) failed: document the failure and its risk level;
  the responsible engineer signs off that it is safe to proceed.
- A known canvas keyboard limitation (**D**) is present: confirm it is recorded in
  `a11y-helpers.test.ts`, in [Slide canvas keyboard accessibility](../system/slide-canvas-keyboard-accessibility.md),
  and the deferred-risk list. The presentation editor (`slide-editor.tsx`) ships
  keyboard resize/traversal/announcement behavior, but the release gate does not
  yet have direct `SlideEditor` keyboard interaction tests for those flows.
  Keep **AC-5** as deferred until that coverage lands; track connector free-draw
  follow-up in #1574.
- Slide patch-save flow (**S-2 / D**) remains deferred while `patchDeck` is
  fallback-only (`{ ok: "fallback" }`): keep #1336 open and do not sign off this
  path as automated patch persistence until Deck patch replay is implemented.
- Performance budgets report `warned: true` (not `exceeded`) for any metric: log the
  finding and plan remediation within the next sprint.

---

## Part 4 — Sign-off procedure

Before each foundation release wave:

1. Run
   `npm run db:schema:check && npm run db:generate && npm test && npm run typecheck && npm run typecheck:unused && npm run lint && npm run docs:check && npm run format:check && npm run build`
   locally. All nine must exit 0.
2. Verify CI is green on the merge commit (`.github/workflows/ci.yml` → `quality-gate` job).
3. Walk the checklist in Part 2 and confirm every **M** flow manually.
4. Record any warnings (Part 3) in the release PR description with a brief risk note.
5. Obtain sign-off from at least one other engineer on the PR before merging.

---

## Part 5 — Cross-references

| Related issue | Area                                                                                                                                                                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #430          | Block-anchor identity — `block-id.ts`, `block-id-runtime.ts`                                                                                                                                                                                                              |
| #448          | Visual projection repair — `mirror-diff.ts`, `mirror-repair.ts`                                                                                                                                                                                                           |
| #436          | Command envelope — `commands/`, `presentation/editor-commands.ts`                                                                                                                                                                                                         |
| #379 / #380   | Export pipeline — `export-preflight.ts`, `deck-export.ts`                                                                                                                                                                                                                 |
| #376          | Conflict recovery — `deck-revision-token.ts`                                                                                                                                                                                                                              |
| #460          | Structured diagnostics — `src/lib/diagnostics/error-codes.ts`                                                                                                                                                                                                             |
| #461          | Performance budgets — `scripts/perf-budgets.mjs`, `scripts/check-next-build-constraints.mjs`                                                                                                                                                                              |
| #495          | API surface governance — `docs/security/api-route-security-matrix.md`, `src/lib/api/errors.ts`, `src/lib/diagnostics/api-abuse.ts`                                                                                                                                        |
| #493          | Persisted-schema gates — `src/lib/schema-audit/audit.ts`, `docs/operations/schema-repair-runbook.md`                                                                                                                                                                      |
| #517          | Release-gate E2E profile — `prisma/seed-e2e.ts`, `e2e/helpers/profile.ts`, `e2e/{import-roundtrip,present-export,slide-asset-upload,slides-layout-screenshots}.spec.ts`, [slide canvas keyboard accessibility decision](../system/slide-canvas-keyboard-accessibility.md) |
| #1449         | Deterministic presentation layout screenshot gate — `e2e/slides-layout-screenshots.spec.ts`, `playwright.config.ts`, [E2E README](../../e2e/README.md)                                                                                                                    |
| #1390         | Deck release-gate slide blocker ownership reconciliation — this runbook's S-1/S-2/S-3 rows                                                                                                                                                                                |
| #1004         | Documentation, ADR, and source-driven verification — [runtime config](runtime-config.md), [API route matrix](../security/api-route-security-matrix.md), [ADR index](../system/architecture-decisions.md), `npm run docs:check`                                            |
