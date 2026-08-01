# TextIQ

TextIQ is a text-to-visuals and slide-authoring app. It combines a Lexical
document editor, editable visual blocks, AI-assisted visual/deck generation,
presentation editing, sharing, export, workspaces, brand kits, and real-time
collaboration.

Built with **Next.js App Router**, **React**, **TypeScript**, **Prisma**,
**Lexical**, **Yjs**, and **Tailwind CSS**.

## Quick Start

The default local database is SQLite, so no database service is required.

```bash
cp .env.example .env
npm install
npm run db:push
npm run db:seed
npm run dev
```

Open [http://localhost:4000](http://localhost:4000).

`DB_PROVIDER` defaults to `sqlite`, and `DATABASE_URL` defaults to
`file:./prisma/dev.db` when unset. Copying `.env.example` is still recommended
because authentication needs `AUTH_SECRET`; use `openssl rand -base64 32` for a
real secret outside quick local testing.

## Scripts

| Script                     | Description                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| `npm run dev`              | Start the Next app through `server.mjs` with inline collaboration enabled.                    |
| `npm run dev:doctor`       | Check local Node/env/Prisma/port/Playwright readiness with repair hints.                      |
| `npm run dev:setup`        | Create a local `.env`, generate Prisma, and apply the SQLite schema.                          |
| `npm run dev:worktree`     | Create `.env.worktree` and report worktree-local safety checks.                               |
| `npm run ci:local`         | Run the same SQLite quality stages as GitHub CI, including `build`.                           |
| `npm run security:audit`   | Audit production advisories and verify installed package provenance.                          |
| `npm run qa:browser`       | Seed deterministic browser QA data, start dev, and print fixture URLs.                        |
| `npm run build`            | Create a production build.                                                                    |
| `npm run start`            | Run the production server.                                                                    |
| `npm run collab`           | Run the standalone Yjs collaboration server.                                                  |
| `npm test`                 | Run line coverage and subsystem coverage-map checks.                                          |
| `npm run test:subsystem`   | Run tests mapped to one subsystem, for example `npm run test:subsystem -- editor`.            |
| `npm run test:e2e`         | Run Playwright E2E tests.                                                                     |
| `npm run typecheck`        | Type-check with `tsc --noEmit`.                                                               |
| `npm run lint`             | Run design-system, action-ports, Next/build, boundary, import, E2E, perf checks, then ESLint. |
| `npm run docs:check`       | Check docs source inventory, docs links, and docs formatting.                                 |
| `npm run format`           | Format the repository with Prettier.                                                          |
| `npm run format:check`     | Check Prettier formatting.                                                                    |
| `npm run db:generate`      | Regenerate the SQLite schema when selected, then generate the Prisma client.                  |
| `npm run db:schema:sqlite` | Regenerate `prisma/schema.sqlite.prisma` from the canonical schema.                           |
| `npm run db:schema:check`  | Check the generated SQLite schema for drift.                                                  |
| `npm run db:push`          | Regenerate the SQLite schema when selected, then apply it with `db push`.                     |
| `npm run db:seed`          | Seed demo data.                                                                               |
| `npm run db:reset`         | Regenerate Prisma, force-reset via `db push`, and seed.                                       |

## Database

The database provider is selected with `DB_PROVIDER`:

| Provider   | Use                                                                     |
| ---------- | ----------------------------------------------------------------------- |
| `sqlite`   | Default for local development and tests.                                |
| `postgres` | Production-style deployment. Requires a `postgresql://` `DATABASE_URL`. |

During development, schemas are applied directly with `prisma db push`; migration
history is not maintained. Development data can be reset when schemas change.
`prisma/schema.prisma` is the only hand-edited schema. For SQLite, the tooling
mechanically regenerates `prisma/schema.sqlite.prisma` from it by changing only
the datasource provider.

The Prisma client is generated into `src/generated/prisma`, which is ignored by
git. Run `npm run db:generate` after installing dependencies or changing Prisma
schema files, and before `npm run typecheck`; typechecking imports the generated
client. CI also runs `npm run db:schema:check` before generating the client so a
stale committed SQLite schema fails fast.

Examples:

```bash
npm run db:push

DB_PROVIDER=postgres \
DATABASE_URL="postgresql://user:pass@localhost:5432/textiq?schema=public" \
npm run db:push
```

## Collaboration

The app server hosts the Yjs websocket endpoint inline at `/collab` by default,
so the browser can use the same origin/port as the app. The editor degrades to
local-only editing if the socket is unavailable.

To run collaboration separately:

```bash
npm run collab
COLLAB_INLINE=0 npm run dev
```

Then set `NEXT_PUBLIC_COLLAB_WS_URL` for the browser client. Production
deployment and scaling constraints are documented in
[docs/operations/collaboration-deployment.md](docs/operations/collaboration-deployment.md).

## Documentation

The documentation entry point is [docs/README.md](docs/README.md). Docs are
grouped by subsystem under flat directories:

| Area                        | Start here                                                   |
| --------------------------- | ------------------------------------------------------------ |
| System overview             | [docs/system/README.md](docs/system/README.md)               |
| AI generation               | [docs/ai/README.md](docs/ai/README.md)                       |
| Authentication/account      | [docs/auth/README.md](docs/auth/README.md)                   |
| Collaboration runtime       | [docs/collaboration/README.md](docs/collaboration/README.md) |
| Data models                 | [docs/data-model/README.md](docs/data-model/README.md)       |
| Diagnostics                 | [docs/diagnostics/README.md](docs/diagnostics/README.md)     |
| Document management         | [docs/documents/README.md](docs/documents/README.md)         |
| Editor architecture         | [docs/editor/README.md](docs/editor/README.md)               |
| Import pipeline             | [docs/import/README.md](docs/import/README.md)               |
| Localization                | [docs/localization/README.md](docs/localization/README.md)   |
| Presentation runtime/export | [docs/presentation/README.md](docs/presentation/README.md)   |
| Product                     | [docs/product/README.md](docs/product/README.md)             |
| Public render surfaces      | [docs/public-render/README.md](docs/public-render/README.md) |
| Security and sharing        | [docs/security/README.md](docs/security/README.md)           |
| Visual system               | [docs/visual/README.md](docs/visual/README.md)               |
| Commands and mutations      | [docs/commands/README.md](docs/commands/README.md)           |
| Operations                  | [docs/operations/README.md](docs/operations/README.md)       |

Current schemas are authoritative during development. Do not add runtime
compatibility paths for superseded deck/visual/document payload shapes; update
fixtures, generators, and docs to the current shape instead.

## Project Structure

| Path              | Purpose                                                                           |
| ----------------- | --------------------------------------------------------------------------------- |
| `src/app/`        | App Router pages, routes, and server actions.                                     |
| `src/components/` | React UI components.                                                              |
| `src/lib/`        | Domain logic, schemas, persistence helpers, AI, auth, billing, export, and tests. |
| `scripts/`        | Collaboration server and supporting Node scripts.                                 |
| `prisma/`         | Prisma schemas and seed script.                                                   |
| `e2e/`            | Playwright E2E tests.                                                             |
| `docs/`           | Current architecture and operations documentation.                                |

## Quality Gate

Before merging behavior changes, run the local CI parity command or the same
stages directly:

```bash
npm run ci:local
```

The required fast gate is:

```bash
export DB_PROVIDER=sqlite DATABASE_URL="file:./prisma/dev.db" AUTH_SECRET=ci-placeholder
npm run db:schema:check
npm test
npm run typecheck
npm run typecheck:unused
npm run lint
npm run format:check
```

The required deterministic browser gate runs separately in CI and can be
reproduced locally with:

```bash
npm run test:e2e:profile:self-contained
```

For documentation-only changes, at minimum run:

```bash
npm run docs:check
npx prettier --check README.md AGENTS.md
```

See [docs/operations/release-gate.md](docs/operations/release-gate.md) for the
full release readiness checklist.
