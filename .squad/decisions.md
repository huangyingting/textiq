# Squad Decisions

## Active Decisions

- 2026-07-03: Initial Squad team is configured from existing TextIQ docs/codebase. The project routes architecture to Morpheus, frontend/editor work to Trinity, backend/persistence to Tank, AI/visual systems to Neo, collaboration/operations to Dozer, testing to Mouse, logging to Scribe, backlog monitoring to Ralph, and RAI review to Rai.

- 2026-07-19: The scripts/** SCRIPT_STAGE line-coverage floor is not an acceptance criterion for feature issues #2008–#2015 because their criteria enumerate typecheck, lint, format, and governance gates, not unit-coverage floors. It is repo-wide infrastructure debt introduced by PR #2016 and is tracked separately as #2019, so it must not block closing completed feature issues.
- 2026-07-19: The residual scripts/** line-coverage gap is dominated by a Node --experimental-test-coverage merge artifact: e2e-origin.mjs is imported by seven test subprocesses and the reporter surfaces one subprocess view around 54% rather than the 98.38% union measured in isolation. It reproduces at --test-concurrency=1, so it is not a race; --test-isolation=none unions coverage but crashes the suite. This is not fixable by adding tests and needs a coverage-strategy change such as c8 or NODE_V8_COVERAGE post-merge. No thresholds were lowered and no coverage-ignore pragmas were added.
- 2026-07-19: The e2e governance origin fix in .github/workflows/e2e-deterministic.yml from E2E_BASE_URL http://127.0.0.1:4000 to https://localhost:4000 is correct because the deterministic e2e profile runs over HTTPS with a pinned self-signed certificate. The http/127.0.0.1 value was stale and failed the tightened check-e2e-governance test.
- 2026-07-19: PR #2016 on branch 2013-harden-presentation-workflow was the reviewed PR required by epic #2013. PR #2018 was the capstone that turned the governance gate green and added coverage.


### 2026-07-17T08-57-43: Serialize route autosaves and seed deterministic repeat-index presentation fixtures
**By:** Dozer
**What:** Serialize route autosaves and seed deterministic repeat-index presentation fixtures
**References:** #2009, #2011, src/app/app/documents/[id]/slides/slide-editor-route-client.tsx, e2e/helpers/presentation-fixtures.ts, prisma/seed-e2e.ts, scripts/e2e-profile.mjs
**Why:** Presentation route autosaves must permit only one CAS write in flight. Each mutation replaces the queued latest deck; the active writer drains that latest snapshot before resolving, and completion state applies only when the request ID is still current. This prevents an earlier duplicate save from reporting success over a later delete/reorder snapshot while preserving explicit stale-token conflicts and token rotation.

Deterministic Playwright mutators must not share documents or Yjs rooms. The profile runner parses both --repeat-each=N forms, exports the requested slot count, seeds every slot before starting the server, and fixture lookup derives the slot from repeatEachIndex. Slot identities use an unbounded base-36 suffix and fail loudly if Playwright requests an unseeded index. Do not reseed while the profile server or collaboration rooms are live.

### 2026-07-14: Canonical deck contract boundary (B2)
**By:** Morpheus
**What:** `src/lib/presentation/schema.ts` is the canonical persisted `Deck` contract. `safeParseDeck` (`src/lib/presentation/validation.ts`) is the single validation entry for persisted/cross-subsystem deck JSON. Deck-kernel `Deck` type and `validateDeck` are legacy migration targets. No bridge or v6 compatibility path may be introduced. PR #1992.
**Why:** Two `Deck` types and two `safeParseDeck` functions currently exist under different modules. This decision establishes which is authoritative, makes the convergence target explicit, and constrains future refactor batches so they cannot introduce bridges or compatibility shims.

### 2026-07-19: Presentation overlap selection
**By:** Neo
**What:** Stage pointer selection resolves geometric hits in visual order: higher `zIndex` first, then later tree insertion for equal layers. Alt-click, Alt+], and the stage context-menu action cycle unlocked visible nodes under the explicit selection point while preserving normal click, hover, drag, and multi-select behavior.
**Why:** Overlap selection needs deterministic, accessible hit cycling without changing existing type-based insertion bands or equal-layer render semantics. The self-contained Chromium regression remains gated by `E2E_OVERLAP_REGRESSION=1`; shared Playwright/profile registration is coordinator/Dozer-owned.

### 2026-07-17: Deterministic authenticated profile owns an IPv4 loopback bind
**By:** Tank
**What:** The self-contained authenticated E2E profile hard-sets `HOST=127.0.0.1`, strips inherited hostname variables, and ignores server-command overrides while retaining `http://localhost:<port>` as the browser/auth origin.
**Why:** Cookie and redirect scope require the exact localhost origin, while the authenticated listener must never inherit a wildcard or externally reachable bind.

### 2026-07-17: Persist reconciled collaborative editor generations
**By:** Trinity
**What:** Document autosave observes history-merged typing, snapshots the live Lexical editor after reconciliation, periodically flushes sustained edit bursts, and only reports saved for the latest persisted generation.
**Why:** The previous OnChange filtering and StrictMode-disposed controller could leave a new document showing “All changes saved” without issuing any durable save; callback snapshots could also precede collaborative reconciliation.

### 2026-07-13: PR #1977 (#1961) rebased onto main past #1972, breadth ceiling ratcheted to 27
**By:** Trinity
**What:** Rebased approved PR #1977 (`squad/1961-document-interactions`, previously at `27ed9105`) onto `origin/main` at `52ef3f90` (post #1972/#1957's workspace/dashboard-page ratchet, which had independently lowered `DEFAULT_MAX_GAP_FILES` from 46 to 37). Resolved conflicts in `docs/operations/quality-gates.md` and `scripts/check-coverage-breadth.mjs` only (`scripts/test-subsystem.mjs` auto-merged cleanly, keeping both PRs' pattern additions). Re-measured coverage breadth directly against the rebased tree via `npm run test:coverage-breadth`: 848 eligible, 782 runtime-eligible, 749 unit-loaded, 6 mapped-e2e, 0 exceptions, **27** actionable gap files — matching the arithmetic exactly (739 #1957 baseline + 9 direct + 1 transitive from #1961). Set `DEFAULT_MAX_GAP_FILES = 27` (down from 37; never raised). Marked the prior branch-local 36-gap (pre-#1957) measurement historical/superseded in both files. All 9 approved test files, `module-stub.ts`, `render-text.ts`, and `portal-dom.ts`'s RAF re-entrancy fix are byte-identical to the approved head. New commit `0f4b093a`, force-pushed with `--force-with-lease`. All 5 CI checks (Quality gate, Ops script tests, Playwright deterministic, Production install smoke, Docs check) passed on the refreshed head. PR is `MERGEABLE`/`CLEAN` (verified against main at `2226dc2b`, which advanced further with #1976 after this rebase but does not require another rebase). Not merged — awaiting reviewer/coordinator action.
**Why:** Main advanced with #1972 while PR #1977 was pending, creating conflicts only in the shared coverage-breadth doc/script narrative (a known, expected pattern in this repo's ratchet history). The task required measuring (not assuming) the merged breadth and setting an exact ceiling that never exceeds the pre-rebase main baseline (37), while fully preserving all approved test content and prior ratchet history for other agents/reviewers to audit.

### 2026-07-19: SCRIPT-stage coverage gate uses c8 union reports
**By:** Scribe
**What:** Issue #2019 migrated only the `scripts/**` SCRIPT_STAGE coverage gate from Node `--experimental-test-coverage` reporting to `c8`/`NODE_V8_COVERAGE` union reporting in `scripts/check-line-coverage.mjs` and `scripts/check-combined-coverage.mjs`; SOURCE_STAGE coverage remains unchanged. SCRIPT floors were recalibrated to c8 statement-based accounting at 97% lines, 93% branches, and 97% functions, with measured results 97.93/93.05/97.07.
**Why:** Node's process-isolated coverage reporter did not union per-file coverage across subprocesses, so shared imports such as `scripts/e2e-origin.mjs` were reported from one under-covering subprocess view and the function floor was unreachable by adding tests. c8 merges V8 coverage dumps into the true union, preserving the gate without pragmas, skips, weakened assertions, or SOURCE-stage changes.

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
