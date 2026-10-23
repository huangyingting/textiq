---
type: "architecture"
status: "current"
last_updated: "2026-10-23"
description: "This document describes database-provider resolution, Prisma client setup, and the high-level relational model. JSON payload contracts remain in deck.md and visual-mirror.md."
---

# Database Persistence

This document describes database-provider resolution, Prisma client setup, and
the high-level relational model. JSON payload contracts remain in
[deck.md](deck.md) and [visual-mirror.md](visual-mirror.md).

## Source Anchors

| Area                    | Source                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------ |
| Prisma schema           | [`prisma/schema.prisma`](../../prisma/schema.prisma)                                 |
| SQLite generated schema | [`prisma/schema.sqlite.prisma`](../../prisma/schema.sqlite.prisma)                   |
| Provider resolution     | [`src/lib/db-provider.ts`](../../src/lib/db-provider.ts)                             |
| Prisma client           | [`src/lib/prisma.ts`](../../src/lib/prisma.ts)                                       |
| Prisma tooling config   | [`prisma.config.ts`](../../prisma.config.ts)                                         |
| SQLite schema generator | [`scripts/gen-sqlite-schema.mjs`](../../scripts/gen-sqlite-schema.mjs)               |
| Persistence smoke       | [`scripts/production-install-smoke.mjs`](../../scripts/production-install-smoke.mjs) |

## Provider Resolution

The app supports Postgres and SQLite behind one Prisma client path.

| Setting                       | Effective provider | URL behavior                                                            |
| ----------------------------- | ------------------ | ----------------------------------------------------------------------- |
| `DB_PROVIDER=postgres`        | Postgres           | `DATABASE_URL` is required by callers that open the client.             |
| `DB_PROVIDER=sqlite` or unset | SQLite             | `DATABASE_URL` wins when set; otherwise `file:./prisma/dev.db` is used. |
| Any other explicit value      | Rejected           | Configuration fails instead of silently selecting a different database. |

`src/lib/db-provider.ts` is the app runtime source of truth. `prisma.config.ts`
duplicates the provider rule because Prisma CLI loads outside the app TS path
aliases. Keep those rules intentionally in sync.

## Prisma Client

`src/lib/prisma.ts` chooses the adapter at runtime:

- Postgres uses `@prisma/adapter-pg` with the resolved connection string.
- SQLite uses `@prisma/adapter-better-sqlite3` with the resolved local URL.
- Non-production stores the client on `globalThis` to avoid reconnect churn in
  development hot reload.

Generated client output lives under `src/generated/prisma`.

## Provider-Specific Query Helpers

`caseInsensitiveContains` centralizes provider differences for string search.
Postgres uses `mode: "insensitive"`; SQLite omits `mode` because SQLite `LIKE`
is already ASCII-case-insensitive by default. The necessary Prisma type cast is
kept in that helper rather than duplicated at call sites.

## Relational Groups

| Group               | Models                                                            |
| ------------------- | ----------------------------------------------------------------- |
| Identity            | `User`, `PasswordResetToken`, `EmailVerificationToken`            |
| Workspace access    | `Workspace`, `WorkspaceMember`, `InviteLink`, `InviteLinkUse`     |
| Document state      | `Document`, `DocumentVersion`, `Comment`, `CommentRead`, `Tag`    |
| Visual state        | `Visual`, `VisualRevision`                                        |
| Product and billing | `Brand`, `Subscription`, `StripeWebhookEvent`, `UsageLedgerEntry` |
| Assets and limits   | `Asset`, `RateLimitHit`                                           |

The Prisma schema stores current app state and operational ledgers. Rich editor
payloads are stored as current JSON shapes; runtime compatibility readers for
superseded payload shapes are not added.

## Delete And Retention Semantics

Most user-owned rows cascade from `User`. Workspace documents are set null when
their workspace is deleted. Asset, workspace, and brand relationships use
nullable scopes so cleanup can reclaim orphaned bytes without breaking version
restore safety.

Document deletion is soft-delete first (`deletedAt`) and permanent purge is
maintenance-driven. Account erasure has its own verification path documented in
[../auth/README.md](../auth/README.md) and the DSAR runbook.

## Invariants

1. `DB_PROVIDER=postgres` is the only selector for Postgres.
2. SQLite remains the zero-setup local default.
3. Prisma CLI provider logic stays in sync with app runtime provider logic.
4. Provider-specific query differences are hidden behind local helpers.
5. JSON columns store current payload contracts only.
6. Schema changes update code, fixtures, tests, and docs in the same shape.

## Primary Tests

- [`src/lib/db-provider.test.ts`](../../src/lib/db-provider.test.ts)
- [`src/lib/db/p2002-fallback.test.ts`](../../src/lib/db/p2002-fallback.test.ts)
- [`scripts/gen-sqlite-schema.test.mjs`](../../scripts/gen-sqlite-schema.test.mjs)
