# Morpheus History

## 2026-07-03T05:57:20.402+00:00 — Initial context

- User: Switch.
- Project: TextIQ.
- Stack: Next.js App Router, React, TypeScript, Prisma, Lexical, Yjs, Tailwind CSS, Node scripts, and Playwright.
- Core domains: document editor, presentation editor/render/export, AI generation, visual schemas, document/deck persistence, auth/security, collaboration, public sharing, import/export, operations, and testing.
- Source, tests, schemas, and current docs are authoritative. Docs are background when they conflict with code.
- Main risks from docs/codebase: high-churn presentation editor, deck/content persistence contracts, collaboration durability, public route/security posture, logs/PII, import/export dependency boundaries, and coverage governance.


## 2026-07-03T13:00:53.894+00:00 — UI QA triage context

UI QA surfaced authenticated UI blockers filed as GitHub issues #1715, #1716, and #1717. Public UI gap sweep and lead issue triage were launched for follow-up architectural/product routing.


## 2026-07-03T13:00:53.894+00:00 — Public route QA architecture context

Public UI QA added issue #1718 for unknown public share/present/embed fallbacks returning HTTP 200. Authenticated blockers #1715, #1716, and #1717 remain open for routing alongside the public-route fallback behavior.

## 2026-07-03T19:47:08.443+00:00 — UI fix merge batch

Switch's UI issue implementation batch was merged into `main`: #1719/#1716, #1720/#1717, #1723/#1718, #1724/#1721, and #1722/#1715. CI and reviewer gate passed for all PRs. Local branch deletion warnings were due to existing issue worktrees; remote PRs are merged.

## 2026-07-03T20:55Z — System-level UI test strategy
- Read current testing, E2E, design-system, editor, presentation, security, brand, billing, and public-render docs plus existing Playwright inventory (14 spec files, 89 tests).
- Produced a 500-case Playwright catalog strategy weighted toward presentation (260 cases) with layers, fixtures/environments, flake controls, issue-filing rules, immediate-vs-future prioritization, and regression guidance for fixed/closed #1715/#1716/#1717/#1718/#1721.


## 2026-07-03 — UI 500-Case Test Matrix Strategy

Morpheus produced the UI testing strategy for Switch's 500-case matrix request, allocating all 500 cases with 260 presentation-focused cases. The strategy fed Trinity's presentation catalog and Mouse's PR #1728 implementation, which merged to `main` at `c9d8b471` after review, CI, and deterministic E2E hang fixes.


## 2026-07-04T12:00:39.461+00:00 — UI matrix follow-up closure

The UI issues filed from the 500-case matrix were implemented and merged: #1727 via PR #1729, #1726 via PR #1730, and #1725 via PR #1731. PRs #1730 and #1731 required conflict resolution after #1729 reached `main`; all were re-reviewed, passed CI, and merged.


## 2026-07-04T20:55:51.252+00:00 — Code/doc review issue suggestions

Morpheus reviewed architecture/code-doc opportunities and opened or tracked GitHub issues #1733, #1735, #1737, #1739, and #1740. Duplicate issue #1738 was closed. No repository files were modified by this review batch.


## 2026-07-23T11:36:33+00:00 — Architectural decisions documented: Playwright config consolidation and connection ownership scope

Morpheus documented two architectural decisions finalized during session: (1) Playwright config consolidation — `.ts` is authoritative, `.mts` remains as reference (single source of truth prevents future shadowing); (2) E2E connection ownership investigation deferred to Dozer (environment) or Tank (security) due to environment-specific, transient worker-restart race during accept backlog window. Decisions merged to decisions.md.
