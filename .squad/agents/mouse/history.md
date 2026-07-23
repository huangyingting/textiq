# Mouse History

## 2026-07-03T05:57:20.402+00:00 — Initial context

- User: Switch.
- Project: TextIQ.
- Test stack: Node built-in test runner, `tsx`, script tests, subsystem coverage map, line coverage, Playwright, and deterministic E2E profile.
- Local/test DB defaults to SQLite with `DB_PROVIDER=sqlite` and `DATABASE_URL=file:./prisma/dev.db`; `AUTH_SECRET=ci-placeholder` is used for validation flows.
- Focused validation should follow touched subsystems before broader gates.


## 2026-07-03T13:00:53.894+00:00 — UI QA browser sweep

Mouse completed Playwright/browser QA for the UI sweep and filed authenticated UI blocker issues #1715, #1716, and #1717. Follow-up public UI gap sweep and lead issue triage were launched.


## 2026-07-03T13:00:53.894+00:00 — Public UI gap sweep

Mouse completed public/anonymous coverage for desktop/mobile home, login, signup, auth redirects, unknown public fallbacks, valid public present, valid share, and document embed. Mouse filed issue #1718 for unknown public share/present/embed fallbacks returning HTTP 200. Remaining blockers are #1715, #1716, and #1717.

## 2026-07-03T19:47:08.443+00:00 — UI fix merge batch

Switch's UI issue implementation batch was merged into `main`: #1719/#1716, #1720/#1717, #1723/#1718, #1724/#1721, and #1722/#1715. CI and reviewer gate passed for all PRs. Local branch deletion warnings were due to existing issue worktrees; remote PRs are merged.


## 2026-07-03 — UI Matrix PR, Bug Reports, and Merge

Mouse delivered PR #1728 for the UI 500-case matrix batch, adding the e2e/ui-matrix README, 500-case catalog, subsystem specs, e2e README updates, and Playwright config updates. Mouse ran tests, filed bugs #1725, #1726, and #1727, resolved subsystem governance feedback, fixed a deterministic E2E hang by bounding `E2E_PROFILE` UI matrix selection and adding a timeout, then merged PR #1728 into `main` at `c9d8b471` after final approval and passing CI.


## 2026-07-04T12:00:39.461+00:00 — UI matrix filed issues resolved

The UI issues Mouse filed from the 500-case matrix were resolved and merged: #1727 in PR #1729, #1726 in PR #1730, and #1725 in PR #1731. PR #1729 merged first; PRs #1730 and #1731 were conflict-resolved against current `main`, re-reviewed, passed CI, and merged.


## 2026-07-04T20:55:51.252+00:00 — Code/doc review issue suggestions

Mouse reviewed testing and QA improvement opportunities and opened GitHub issues #1732, #1734, #1736, and #1737. No repository files were modified by this review batch.

## 2026-07-04T21:24Z — Issue #1736 started
- Created worktree `/home/azadmin/TextIQ-worktrees/issue-1736` on branch `squad/1736-ui-matrix-inventory` from `origin/main`.
- Scope: source-backed Playwright UI matrix inventory and drift check; avoid overlap with #1732/#1735 gate work.

## 2026-07-04T22:54Z — Issue #1736 implementation ready
- Added `e2e/ui-matrix/inventory.ts` plus `scripts/check-ui-matrix-inventory.mjs`/tests; inventory now covers every `e2e/**/*.spec.ts` and generated README drift.
- Wired `ui-matrix:check` into `docs:check` and `e2e-governance:check`; catalog spec now asserts automated case specs are inventoried.
- Validation passed: docs check, e2e governance, UI matrix check, script test, eslint, focused TS check, operations/presentation subsystem checks, and Playwright catalog. Full `npm run typecheck` produced no output after 10 minutes and was stopped.

- 2026-07-04T22:57:31Z: Revised PR #1752 as independent QA owner. Changed `.github/workflows/production-install-smoke.yml` setup-node config from `node-version: 22` to `node-version-file: .nvmrc`; formatted/checked workflow, ran production-install smoke script tests, committed `95e2c6b753ab2285d72e9acf65d4a2f0ca14ce14`, and pushed `squad/1733-node22-runtime-policy`.

## 2026-07-04T23:59Z — Issue #1736 PR opened and green
- Opened PR #1760: https://github.com/huangyingting/textiq/pull/1760 (`Fixes #1736`).
- CI is green: Quality gate, deterministic Playwright profile, and production install smoke all passed; PR merge state is CLEAN.

- 2026-07-04T23:59:30Z — Resolved PR #1753 merge conflict against origin/main in worktree `/home/azadmin/TextIQ-worktrees/issue-1739`, preserved SECURITY.md/Dependabot/dependency policy, ran docs/config checks, and pushed `squad/1739-security-policy-dependabot` at `50725e1604d23614bad5253124befab7a83561bb` without merging.

- 2026-07-05: Implemented #1732/#1735 on branch `squad/1732-1735-e2e-required-gate`; promoted deterministic E2E to a hard required workflow, added self-contained prebuilt-server profile support and `@required-profile` grep slice, updated docs/spec readiness, opened PR https://github.com/huangyingting/textiq/pull/1767. CI green: Quality gate, deterministic E2E, production install smoke.

## 2026-07-19T00:24:30+0000 — Presentation hardening verification and coverage

Mouse verified PR #2016's merged presentation/document-to-deck hardening with focused unit specs passing, identified global gate failures, and a second Mouse pass added check-ui-matrix-inventory, e2e-origin, and function-floor coverage tests for PR #2018. Residual scripts/** coverage debt was classified as coverage-strategy work and tracked in #2019, not as a blocker for #2008–#2015 closure.

## 2026-07-19T02:15:00+00:00 — SCRIPT c8 gate QA coverage

Issue #2019 added real SCRIPT-stage behavioral gap tests alongside the c8 union coverage migration: e2e-profile IPv6/port validation, e2e-web-server redirect ambiguity, e2e-credential-gate listener mismatch/socket hangup, and check-ui-matrix-inventory README drift/ENOENT. Mouse should treat future SCRIPT coverage measurements as c8-based union results, not Node subprocess coverage views.

## 2026-07-22T22:12:25+00:00 — Full repository test surface run and playwright.config.ts fix

Mouse ran the complete test surface and found one test infrastructure/configuration bug in `playwright.config.ts`.

**Root cause (test infrastructure/configuration problem):** Playwright resolves `.ts` before `.mts`. `playwright.config.mts` (added in PR #2016) contained all profile-specific configuration (`globalSetup`, `workers: 1`, Chromium `--host-resolver-rules` launchOptions, extended 17-spec `deterministicProfileSpecs`). `playwright.config.ts` predates it and was separately updated by PR #2036 to add `build: { external: ["scripts/**/*.mjs"] }`. With both files present, `.ts` always wins, so `.mts`'s profile features were silently ignored. This caused: (a) global setup (`e2e-global-setup.mjs`) never ran before tests, so credential gate assertion and route precompilation were skipped; (b) 2 workers used instead of 1, exposing connection ownership race.

**Fix:** Updated `playwright.config.ts` to merge all features from `playwright.config.mts` while preserving the `build: { external: ["scripts/**/*.mjs"] }` transpiler fix. `playwright.config.mts` left untouched (scripts reference it by name). Fix validated: prettier ✓, eslint ✓, typecheck ✓, check-ui-matrix-inventory ✓, test:scripts ✓.

**All non-E2E gates:** unit tests ✓, script tests (672 tests, 0 failures) ✓, npm test (combined-coverage + coverage-map) ✓, lint ✓, typecheck + typecheck:unused ✓, docs:check ✓, format:check ✓, production-install:smoke ✓, db:schema:check ✓.

**Remaining E2E failure (environment-only blocker):** After the fix, the profile correctly runs global setup and uses 1 worker. Tests 1–3 (auth spec) pass. Test 4 (document-editor-profile.spec.ts) fails with `E2E_APP_CONNECTION_MISMATCH` → "Unable to prove accepted E2E connection ownership", cascading to all subsequent tests. Root cause: the Next.js dev server spawns a persistent child build worker process (`.next/dev/build/<hash>.js`). If this worker restarts during the kernel-to-userspace-accept window of a new proxy→app connection, the ownership check sees a dead process in the tree (inspection error) AND the connection inode not yet in any fd (not yet accepted) — both conditions for the "Unable to prove" error. This is environment-specific: CI has no existing server on port 4000 and faster compilation. Observed: dev server on this machine has persistent child PID (confirmed via `/proc/<pid>/task/<pid>/children`). CI passes the profile consistently (per history). Recommended owner: Dozer (environment) or Tank (E2E security system) to assess if the worker restart detection needs tolerance for the backlog-to-accept window.


## 2026-07-23T11:36:33+00:00 — Session completion: full-test repair green, reviewer approvals finalized

Mouse completed independent review of Trinity's autosave durability artifact (remove route revalidation, one-time controller initialization) and Dozer's E2E infrastructure artifact (four defects: global timeout, signal handling, conflict assertion ordering, tsconfig cleanup). Full deterministic profile: 96/96 passed, 5 governed skips, 0 failures, exit 0, 20m32s. All CI gates green.
