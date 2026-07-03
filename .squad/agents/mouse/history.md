# Mouse History

## 2026-07-03T05:57:20.402+00:00 — Initial context

- User: Switch.
- Project: TextIQ.
- Test stack: Node built-in test runner, `tsx`, script tests, subsystem coverage map, line coverage, Playwright, and deterministic E2E profile.
- Local/test DB defaults to SQLite with `DB_PROVIDER=sqlite` and `DATABASE_URL=file:./prisma/dev.db`; `AUTH_SECRET=ci-placeholder` is used for validation flows.
- Focused validation should follow touched subsystems before broader gates.
