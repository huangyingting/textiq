---
type: "reference"
status: "current"
last_updated: "2026-07-04"
description: "Test framework, commands, layout, isolation strategy, coverage gates, and known testing gaps for TextIQ."
---

# Testing Patterns

## 1) Test Stack And Commands

- Primary test framework: Node.js built-in test runner for `src/**/*.test.ts` and `scripts/**/*.test.mjs`; Playwright `^1.61.0` for E2E.
- Assertion/mocking tools: Node `assert` in representative tests; dependency injection/fake stores/builders are used instead of a global mocking framework in the sampled tests.
- Commands:

```bash
npm test
node --import tsx --test src/components/presentation/use-source-review-controller.test.ts
node --test scripts/**/*.test.mjs
npm run test:subsystem -- presentation
npm run test:subsystem -- --list
npm run test:e2e
npm run test:e2e:profile
npm run test:line-coverage
npm run test:coverage-map
```

## 2) Test Layout

- Test file placement pattern: unit tests are colocated under `src/` as `*.test.ts` / `*.test.tsx`; script tests live under `scripts/*.test.mjs`; browser tests live under `e2e/*.spec.ts`.
- Naming convention: `scripts/test-subsystem.mjs` enforces lowercase names with `-` or `.` separators and `.test`/`.spec` suffixes.
- Setup/config files: `playwright.config.ts` owns E2E test directory/match/project/server behavior; `scripts/test-subsystem.mjs` owns subsystem bucket routing, test-file naming, bucket coverage, and weak-title governance; `scripts/check-line-coverage.mjs` builds Node coverage commands.
- Shared builders/helpers: `src/test/builders/`, `e2e/helpers/`, and domain-specific fixture builders such as `src/test/builders/presentation-deck.ts`.

## 3) Test Scope Matrix

| Scope                     | Covered?             | Typical target                                                                                                        | Notes                                                                                                                                                               |
| ------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit                      | Yes                  | `src/lib/**`, component controllers/helpers, schema validation, route logic helpers.                                  | Run with Node test + `tsx`; examples include `src/lib/presentation/open-deck.test.ts`.                                                                              |
| Script/governance         | Yes                  | `scripts/*.mjs` guardrails and CLI behavior.                                                                          | Run with Node test; mapped into coverage and subsystem checks.                                                                                                      |
| Integration               | Yes                  | API route parsers, persistence helpers, Prisma-adjacent logic through fakes or test DB paths.                         | Import/security/public-render docs list route/helper tests.                                                                                                         |
| E2E                       | Yes, opt-in/separate | Public pages, auth redirects, workspace flows, imports, present/export, slide asset upload, slide layout screenshots. | `e2e/README.md` says E2E specs are not part of the required fast unit gate.                                                                                         |
| Deterministic E2E profile | Yes, advisory in CI  | Seeded profile specs for document editor, import, present/export, asset upload, layout screenshots.                   | `.github/workflows/e2e-deterministic.yml` runs on PR/push but uses `continue-on-error: true`, so failures are visible in Actions logs without failing the workflow. |

## 4) Mocking And Isolation Strategy

- Main mocking approach: inject dependencies into pure helpers and service factories; use fake stores/builders and explicit adapters instead of global monkeypatching where current code permits.
- Database isolation: default local/CI gate uses SQLite with `DB_PROVIDER=sqlite` and `DATABASE_URL=file:./prisma/dev.db`.
- E2E isolation: deterministic profile seeds known users/documents/assets through `npm run db:seed:e2e` and `e2e/.e2e-fixture.json`.
- Common failure mode: `npm run test:unit -- <file>` still runs the script's `src/**/*.test.ts` glob; direct focused file validation should use `node --import tsx --test <file>`.
- Known active cleanup: `docs/presentation/test-strategy-plan.md` tracks remaining tests that still use `src/test/react-server-renderer.ts` harnesses.

## 5) Coverage And Quality Signals

- Coverage tool + threshold: Node built-in `--experimental-test-coverage`; default source line floor is 95%, script line floor is 99%, both overrideable by env vars. The script comments mark these as temporary reductions from 97% source and 100% script targets.
- Coverage exclusions: source coverage excludes `src/**/*.test.ts`, `src/**/*.test.tsx`, `src/generated/**`, `src/test/**`, and `src/lib/document/deck-kernel/**`; script coverage excludes `scripts/**/*.test.mjs`.
- Coverage-map gate: `npm test` runs line coverage and then `scripts/test-subsystem.mjs --check` to enforce subsystem assignment, bucket coverage, test filename shape, and weak-title checks.
- Current reported coverage: `[TODO]` this run did not execute `npm test`, so current numeric coverage output is not recorded here.
- Known gaps/flaky areas:
  - DOCX UI E2E round-trip is documented as a manual gap in `e2e/README.md`; parser coverage is unit-tested.
  - Deterministic E2E workflow is advisory/non-fatal until web-server cold-start readiness is hardened.
  - Presentation hook-harness retirement remains active in `docs/presentation/test-strategy-plan.md`.

## 6) Evidence

- `package.json`
- `playwright.config.ts`
- `e2e/README.md`
- `.github/workflows/ci.yml`
- `.github/workflows/e2e-deterministic.yml`
- `scripts/test-subsystem.mjs`
- `scripts/check-line-coverage.mjs`
- `scripts/ci-local.mjs`
- `src/test/builders/presentation-deck.ts`
- `src/lib/presentation/open-deck.test.ts`
- `docs/operations/quality-gates.md`
- `docs/presentation/test-strategy-plan.md`
