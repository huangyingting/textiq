---
type: "reference"
status: "current"
last_updated: "2026-07-04"
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
| Line coverage gate     | `scripts/check-line-coverage.mjs`                                         |
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

1. `npm run test:line-coverage` — source and script tests under Node line
   coverage floors.
2. `npm run test:coverage-map` — subsystem assignment, bucket coverage, file
   naming, and test title checks.

Focused work should use the subsystem router:

```bash
npm run test:subsystem -- presentation
npm run test:subsystem -- editor
npm run test:subsystem -- --list
```

Mapped Playwright specs are opt-in for focused runs; add `--with-e2e` when the
changed behavior needs browser coverage.

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
- `scripts/check-line-coverage.test.mjs`
- `scripts/check-docs-source-inventory.test.mjs`
- `scripts/check-docs-links.test.mjs`
- `scripts/check-import-graph.test.mjs`
- `scripts/check-client-boundary.test.mjs`
- `scripts/check-action-ports.test.mjs`
- `scripts/check-design-system.test.mjs`
- `scripts/check-next-build-constraints.test.mjs`
- `scripts/check-e2e-governance.test.mjs`
- `scripts/perf-budgets.test.mjs`
