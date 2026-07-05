# Tank History

## 2026-07-03T05:57:20.402+00:00 — Initial context

- User: Switch.
- Project: TextIQ.
- Backend stack: Prisma 7, SQLite local/test default, PostgreSQL production-style option, Next/Auth.js, server actions, App Router route handlers, and Node scripts.
- Current architecture treats `Document.contentJson`, `Document.deckJson`, `DocumentVersion`, `Visual`, access policy, sharing metadata, and collaboration recovery snapshot as important persisted surfaces.
- Contract changes require code, schema, fixtures, tests, docs, and generated artifacts to move together.

## 2026-07-03T20:20:00Z — Issue #1717 slide asset route fix
- Created isolated worktree `/home/azadmin/TextIQ-worktrees/issue-1717` on branch `squad/1717-slide-assets` from `origin/main`.
- Fixed protected slide asset access by loading asset + owning document together, allowing owner/view capability independent of public share proof, and requiring explicit share-bound proof for anonymous public asset bytes.
- Added focused unit/E2E coverage for owner, share-bound public, unbound anonymous, and private/invalid denial.
- Verified: prettier/eslint modified files, route/asset/public-render unit tests, `npm run typecheck`, `npm run test:subsystem -- presentation`, `npm run test:subsystem -- security`, focused sqlite Playwright asset access test, manual curl probes.
- Opened PR #1720: https://github.com/huangyingting/textiq/pull/1720 (checks passed, mergeable).

## 2026-07-03T19:47:08.443+00:00 — UI fix merge batch

Switch's UI issue implementation batch was merged into `main`: #1719/#1716, #1720/#1717, #1723/#1718, #1724/#1721, and #1722/#1715. CI and reviewer gate passed for all PRs. Local branch deletion warnings were due to existing issue worktrees; remote PRs are merged.


## 2026-07-04T20:55:51.252+00:00 — Code/doc review issue suggestions

Tank reviewed backend, persistence, and operational improvement opportunities and opened GitHub issues #1744, #1745, #1746, and #1747. No repository files were modified by this review batch.

- 2026-07-04T21:24Z: Started #1747 share passcode work in `/home/azadmin/TextIQ-worktrees/issue-1747` on `squad/1747-share-passcode`.

## 2026-07-04 — Issue #1739 security policy/dependency automation

Implemented repository SECURITY.md, Dependabot configuration, and dependency update policy docs in worktree `/home/azadmin/TextIQ-worktrees/issue-1739` on branch `squad/1739-security-policy-dependabot`. Opened PR https://github.com/huangyingting/textiq/pull/1753 (`Fixes #1739`); local docs/config validation and all PR checks passed.


## 2026-07-04 — Issue #1745 trusted proxy IP hardening
- Implemented explicit trusted proxy CIDR + remote-address-header policy for client IP extraction in `src/lib/rate-limit.ts`.
- Safe default now ignores spoofable `x-forwarded-for`/`x-real-ip` unless request peer is trusted; missing IPs use the existing `unknown` abuse-budget bucket.
- Added diagnostics that avoid raw IP logging, updated abuse-budget tests/docs, and verified with targeted tests/typecheck before PR.

- Opened PR #1755 (`squad/1745-trusted-forwarded-for`) and confirmed GitHub checks are green: Quality gate, deterministic Playwright profile, and production install smoke all passed; PR is mergeable/clean.

- 2026-07-04T22:50Z: Implemented #1747 passcode-protected share links, asset gating, owner UI, docs, and tests. Verification passing: db:schema:check, typecheck, docs:check, security/public-render subsystems, targeted unit tests.

- 2026-07-04T23:58Z: PR #1761 opened for #1747 and all GitHub checks are passing (quality gate, Playwright deterministic profile, production install smoke). Branch `squad/1747-share-passcode` pushed at `5edd1ee9`.
