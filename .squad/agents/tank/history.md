# Tank History

## 2026-07-03T05:57:20.402+00:00 — Initial context

- User: Switch.
- Project: TextIQ.
- Backend stack: Prisma 7, SQLite local/test default, PostgreSQL production-style option, Next/Auth.js, server actions, App Router route handlers, and Node scripts.
- Current architecture treats `Document.contentJson`, `Document.deckJson`, `DocumentVersion`, `Visual`, access policy, sharing metadata, and collaboration recovery snapshot as important persisted surfaces.
- Contract changes require code, schema, fixtures, tests, docs, and generated artifacts to move together.
