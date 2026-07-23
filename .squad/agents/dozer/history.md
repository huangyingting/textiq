# Dozer History

## 2026-07-03T05:57:20.402+00:00 — Initial context

- User: Switch.
- Project: TextIQ.
- Ops stack includes `server.mjs`, `scripts/collab-server.mjs`, Yjs/Y-websocket, Prisma generation scripts, local CI, browser QA, docs checks, import-graph/client-boundary/perf budget gates, and Playwright.
- Docs flag collaboration scaling/deployment discipline, advisory deterministic E2E, absent local Node pin, and security/dependency automation as open operational concerns.

## 2026-07-04T21:23:02.152+00:00 — PR #1759 revision

- Took independent ownership because Tank authored the original PR.
- Updated retention runner asset selection to skip unscoped document-null rows and only purge explicitly brand-scoped assets via brand storage.
- Added focused regression coverage for hard-deleted slide orphan rows and intended brand cleanup.

## 2026-07-19T00:24:30+0000 — Presentation gate governance repair

Dozer fixed the deterministic E2E governance origin, excluded .tmp lint noise, and added script coverage tests that helped PR #2018 turn governance green. The work supported closing #2008–#2015 while leaving the remaining scripts/** line-coverage strategy debt to follow-up #2019.

## 2026-07-19T02:15:00+00:00 — SCRIPT coverage gate migrated to c8

Dozer resolved #2019 by migrating only the `scripts/**` SCRIPT_STAGE coverage gate to c8 union reporting while leaving SOURCE coverage unchanged. The gate now uses c8 statement accounting with floors 97% lines / 93% branches / 97% functions after Node process-isolated coverage proved unable to union shared subprocess imports. PR #2020 merged to `main` at `8719894f`.

## 2026-07-23T11:36:33+00:00 — E2E full-profile infrastructure repair (Cycle 1)

Four deterministic E2E full-profile infrastructure defects repaired:

1. **Hard-timeout truncation:** Added `resolveE2EProfileGlobalTimeout(env)` to
   `scripts/e2e-origin.mjs`. Returns 18 min for CI `@required-profile` slice, 60 min for
   full local profile (101+ tests), overridable via `E2E_GLOBAL_TIMEOUT_MS`. Imported by
   `playwright.config.ts` from `e2e-origin.mjs` only — `e2e-profile.mjs` cannot be
   CJS-transpiled by Playwright's esbuild config loader due to `import.meta` usage.
2. **Signal-kill / cleanup-always-runs tests:** Added 3 tests to
   `scripts/e2e-profile.coverage.test.mjs` (timeout-selection, signal-null → exit 1,
   cleanup-on-stop-throw). Production `null`-status handling was already correct.
3. **Conflict-recovery semantic race:** In `slides-conflict-recovery.spec.ts`,
   `waitForSlideAutosave({timeout: 45_000})` now precedes `expect(dialog).toBeHidden()`
   in `keepMineConflictTest`, and `expect.poll(readFrame).toEqual(serverFrame)` precedes
   `expect(dialog).toBeHidden()` in `useServerConflictTest`. Root cause: product code
   calls `setConflictState(null)` only after `saveDeckJson` resolves (up to 45 s); React 18
   batching means once autosave is confirmed the dialog is already dismissed in the same render.
4. **tsconfig cleanup guarantee:** Nested try/finally in `runE2EProfile` finally block ensures
   `cleanup` and `restoreConfig` always run even if `stopServer` throws.

Also documented `E2E_GLOBAL_TIMEOUT_MS` in `docs/operations/runtime-config.md` after
`check-docs-source-inventory.mjs` detected the gap.

All broad gates passed: `npm test` (677/677), `npm run lint`, `npm run typecheck:unused`,
`npm run docs:check`, `npm run db:schema:check`, `npm run production-install:smoke`,
`npm run e2e-governance:check`. Focused script tests: 7/7 e2e-origin, 7/7 e2e-profile,
7/7 e2e-origin-coverage, all via `npm run test:scripts` (677/677).

## 2026-07-23T17:45:51+00:00 — E2E full-profile infrastructure repair (Cycle 2): live acceptance evidence

Cycle 2 provided the missing live-browser acceptance evidence required by the Cycle 1 acceptance criterion.

**Focused stability runs (conflict-recovery × 3):**
- Command: `node scripts/e2e-profile.mjs --grep "conflict recovery" --repeat-each=3`
- Duration: 3m45s | Exit: 0
- Selected: 6 (2 tests × 3 repetitions) | Passed: 6 | Failed: 0 | Skipped: 0 | Did-not-run: 0
- "Keep my version" (×3): ✓ 44.0s, ✓ 26.2s, ✓ 34.9s
- "Use server version" (×3): ✓, ✓ 23.3s, ✓ 32.1s

**Complete deterministic profile (all 101 tests, no grep):**
- Command: `E2E_GLOBAL_TIMEOUT_MS=5400000 node scripts/e2e-profile.mjs` (90-min override per documented override path)
- Duration: 20m32s | Exit: 0
- Selected: 101 | Passed: 96 | Failed: 0 | Skipped: 5 (legitimately configured) | Did-not-run: 0
- 5 skips: `slides-smoke.spec.ts` optional credential-dependent tests (tagged `e2e-governance-allow test-skip`, require `E2E_USER_EMAIL`/`E2E_SLIDES_DOC_URL` which the deterministic profile does not inject)

**Failure propagation proof (bounded):**
- Command: `node --test scripts/e2e-profile.coverage.test.mjs`
- 7/7 passed: "signal-terminated Playwright step exits with code 1" + "profile live-server, listing, run, and cleanup failure paths" prove nonzero propagation

**Config restoration:** `tsconfig.json` byte-exact (MD5 `d51685df85334caead07ac3207e82d89`) after both runs; no e2e-profile entries remain in `include`; `git status` clean.

**Cleanup:** All run-specific `.next/e2e-profile/<runId>` dirs removed (including 3 leftover Cycle 1 dirs); 0 stale processes; no temp files.

No code changes made in Cycle 2.

## 2026-07-22T22:12:25+00:00 — E2E connection ownership: inspection-error retry fix

Root cause: `assertE2EConnectionOwnedByProcess` threw "Unable to prove accepted E2E connection
ownership" WITHOUT `error.code = "E2E_CONNECTION_NOT_READY"` when a dying Next.js hot-reload
worker (`/proc/<pid>/fd` ENOENT) left a connection inode temporarily unattributed during the
kernel accept backlog window. `waitForOwnedE2EConnection` only retries `E2E_CONNECTION_NOT_READY`
errors; without the code the error was treated as fatal, immediately latching
`E2E_APP_CONNECTION_MISMATCH` and cascading 9 downstream E2E failures.

Fix: added `error.code = "E2E_CONNECTION_NOT_READY"` to the inspection-error branch of
`assertE2EConnectionOwnedByProcess` (one-line change). The message, cause, and all security
checks are unchanged. Added a focused regression test block in
`scripts/e2e-listener-ownership.coverage.test.mjs` proving: transient inconclusive states retry;
verified ownership succeeds; foreign/mismatched owner still fails; retry is bounded.

Results: 18/18 deterministic E2E profile tests pass (was 3 pass / 9 fail / 6 did not run).
All 18/18 secure transport tests and 8/8 ops-coverage script tests continue to pass.
Files changed: `scripts/e2e-listener-ownership.mjs`, `scripts/e2e-listener-ownership.coverage.test.mjs`.


## 2026-07-23T11:36:33+00:00 — Final session orchestration: full deterministic profile + live acceptance evidence archived

Session completed with full 101-test deterministic profile passing (96 pass, 5 governed skips, 0 failures, exit 0, 20m32s runtime). All CI gates green: npm test, governance, lint, format, typecheck, coverage, docs, DB schema, production smoke, E2E gates. No commit created; decisions merged to decisions.md; orchestration logs and session log archived.
