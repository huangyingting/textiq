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
