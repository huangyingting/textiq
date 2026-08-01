---
type: "runbook"
status: "current"
last_updated: "2026-08-01"
description: "These commands are additive developer tooling. They do not change app runtime behavior."
---

# Developer Bootstrap and Local QA

These commands are additive developer tooling. They do not change app runtime
behavior.

## Fresh checkout

```bash
npm run dev:setup
npm run dev:doctor
```

`dev:setup` creates an ignored `.env` with SQLite defaults and a generated
`AUTH_SECRET`, then runs the smallest database setup commands:
`npm run db:generate` and `npm run db:push`. `postinstall` runs the same
`db:generate` lifecycle so fresh installs produce the ignored Prisma client; if
the generated client is missing later, rerun `npm run db:generate`. Use
`npm run dev:setup -- --no-db` when dependencies or generated clients are
intentionally supplied by another worktree.

`dev:doctor` checks Node, local env, generated Prisma client, SQLite schema file,
the app port, and the Playwright Chromium browser. It redacts secret-like values
and prints the smallest repair command for failures.

## Worktrees

```bash
npm run dev:worktree
set -a; . ./.env.worktree; set +a; npm run dev
```

The helper creates an ignored `.env.worktree` with a worktree-specific SQLite
path such as `file:./prisma/dev.n17.db`, ensures local asset storage exists under
`storage/slide-assets`, and reports whether `node_modules`, `src/generated`,
`.next`, or `storage` are symlinks.

Supported pattern: sharing `node_modules` and `src/generated` is acceptable when
`.next` remains worktree-local. Unsupported pattern: sharing `.next` across
worktrees or reusing `.next` after switching dependency trees; remove `.next`
before rebuilding in that case.

## Local CI parity

```bash
npm run ci:local
```

This mirrors `.github/workflows/ci.yml` after dependency installation with the
documented SQLite env:

1. `npm run security:audit`
2. `npm run db:schema:check`
3. `npm run db:generate`
4. `npm test`
5. `npm run typecheck`
6. `npm run typecheck:unused`
7. `npm run lint`
8. `npm run docs:check`
9. `npm run format:check`
10. `npm run build`

Output is staged and the command exits with the first failing stage's exit code.

## Production install smoke

```bash
npm ci --omit=dev
npm run db:generate
npm run production-install:smoke
```

The production install contract is:

- `prisma` and `dotenv` are production dependencies because production
  `postinstall`/`db:generate` must be able to load `prisma.config.ts` and
  regenerate the ignored Prisma client after `npm ci --omit=dev`.
- `@prisma/client`, Prisma adapters, database drivers, Next, React, and Auth.js
  must resolve from production dependencies.
- Stripe is an optional external billing adapter. The app never statically
  imports `stripe`; production without Stripe env fails closed at billing
  provider selection, and production with `STRIPE_SECRET_KEY` set must install
  the `stripe` package in the deployment artifact.

`.github/workflows/production-install-smoke.yml` runs this gate on Node 22. The
smoke script also checks that `src/generated/prisma/client.ts` exists and points
missing generated-client failures at `npm run db:generate`.

## Browser QA

```bash
npm run qa:browser
```

The browser QA command applies the SQLite schema, seeds the deterministic E2E
profile, starts the dev server, waits for it to respond, and prints owner/viewer
test credentials plus editor, present, and embed URLs. It uses only fixed test
personas from the existing E2E profile; no production credentials are required.

Use `npm run qa:browser -- --seed-only` to seed and print URLs without starting
the server, or `npm run qa:browser -- --print-only` to print an existing
`e2e/.e2e-fixture.json`.
