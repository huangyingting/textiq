---
id: 129af5d7-fb18-4995-b91f-e98243872f3b
class: LOCAL
loadGuidance: [ON-DEMAND]
title: "Retrospective: E2E Deterministic Profile Investigation (2026-07-22)"
author: "Morpheus"
createdAt: 2026-07-23T01:48:16.486Z
metadata: {}
---

## Retrospective Summary: E2E Deterministic Profile Failures

**Ceremony Date:** 2026-07-22
**Lead:** Morpheus (Architect)
**Participants:** Mouse (Test Batch Report)

### 1. WHAT HAPPENED (Facts)

**Pre-E2E Gates:** All passed (unit, 672 script tests, npm test coverage, lint, typecheck, docs, format, production-install smoke, DB schema)

**E2E Deterministic Profile Result:** 3 pass, 9 fail, 6 did not run

**Root Discovery:** Playwright loads `playwright.config.ts` before `playwright.config.mts`. When both exist, `.ts` wins, silently shadowing profile settings in `.mts` (globalSetup, workers: 1, Chromium launchOptions, 17-spec deterministicProfileSpecs list).

**Impact:**
- globalSetup never ran (credential gate + route precompilation skipped)
- 2 workers instead of 1 (exposed connection ownership race)

---

### 2. ROOT CAUSE ANALYSIS

**Primary (Configuration Bug):** Playwright config resolution order + dual-file architecture from PR #2016 (added .mts with profile features) + PR #2036 (added build externalization to .ts) created silent shadowing.

**Secondary (Environment-Specific):** After config fix, tests 1–3 pass; test 4 (document-editor-profile.spec.ts) fails with E2E_APP_CONNECTION_MISMATCH: "Unable to prove accepted E2E connection ownership."

Next.js dev server spawns child build worker; if worker restarts during proxy→app connection accept window, ownership proof fails (sees dead process + inode not yet accepted). This only occurs on local dev with persistent child PID; CI passes because port 4000 is clean and compilation is faster.

---

### 3. WHAT SHOULD CHANGE

**Action 1 (COMPLETED):** Mouse merged profile settings into `playwright.config.ts` while preserving `build: { external: ["scripts/**/*.mjs"] }`. Validated with prettier, eslint, typecheck, check-ui-matrix-inventory, test:scripts.

**Action 2 (DEFERRED):** Dozer or Tank to assess dev server restart tolerance during connection accept window. Decision needed on timeout/retry behavior or documented deferral.

---

### 4. DECISIONS RECORDED

1. **Playwright Config Consolidation** (ID: 63d9a874): Single source of truth in `.ts` eliminates shadowing. `.mts` retained for references but not loaded.
2. **E2E Connection Ownership Deferral** (ID: 391e633d): Investigate at Dozer (environment) or Tank (security contract) level.

---

### 5. ACTION ITEMS

| Item | Owner | Status | Criterion |
|:-----|:------|:-------|:----------|
| Config consolidation validation | Morpheus | Ready | Full suite + CI pass |
| Connection ownership investigation | Dozer/Tank | Blocked | Fix or documented deferral |
| Profile documentation (optional) | TBD | Pending | Reflect .ts consolidation |

---

### ACCEPTANCE TEST FOR NEXT ITERATION

✓ All pre-E2E gates pass
✓ Deterministic E2E: 17/17 specs pass (or explicit issue + deferral decision)
✓ CI: All workflows green
✓ Files: playwright.config.ts (Mouse's fix applied)
