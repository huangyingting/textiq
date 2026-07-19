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
