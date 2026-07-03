---
type: "reference"
status: "current"
last_updated: "2026-07-03"
description: "Technology stack, runtime, dependencies, commands, and configuration evidence for the TextIQ repository."
---

# Technology Stack

## 1) Runtime Summary

| Area                | Value                                                                                                                                    | Evidence                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Primary language    | TypeScript and TSX. The scan counted 1,116 TypeScript files and 195 TypeScript/React files.                                              | `tsconfig.json`, `docs/codebase/.codebase-scan.txt`                                   |
| Runtime + version   | Node.js. CI uses Node 22; no `.nvmrc` or `package.json.engines` pin was found, so the local required version is `[TODO]`.                | `.github/workflows/ci.yml`, `.github/workflows/e2e-deterministic.yml`, `package.json` |
| Package manager     | npm with `package-lock.json` lockfile.                                                                                                   | `package.json`, `package-lock.json`                                                   |
| Module/build system | Next.js App Router with a custom Node server; TypeScript uses `moduleResolution: "bundler"`, `module: "esnext"`, and `jsx: "react-jsx"`. | `server.mjs`, `package.json`, `tsconfig.json`, `next.config.ts`                       |

## 2) Production Frameworks And Dependencies

| Dependency                       | Version          | Role in system                                                                | Evidence                                                      |
| -------------------------------- | ---------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `next`                           | `16.2.9`         | App Router framework and production build target.                             | `package.json`, `src/app/layout.tsx`                          |
| `react` / `react-dom`            | `19.2.4`         | UI runtime.                                                                   | `package.json`, `src/app/layout.tsx`                          |
| `@prisma/client`                 | `^7.8.0`         | Generated database client.                                                    | `package.json`, `src/lib/prisma.ts`, `prisma/schema.prisma`   |
| `@prisma/adapter-better-sqlite3` | `^7.8.0`         | SQLite adapter for local/dev/test database access.                            | `package.json`, `src/lib/prisma.ts`, `src/lib/db-provider.ts` |
| `@prisma/adapter-pg`             | `^7.8.0`         | PostgreSQL adapter for production-style database access.                      | `package.json`, `src/lib/prisma.ts`, `src/lib/db-provider.ts` |
| `prisma`                         | `^7.8.0`         | Prisma CLI/runtime dependency for production install generation.              | `package.json`, `prisma.config.ts`                            |
| `better-sqlite3`                 | `^12.11.1`       | SQLite driver used by the Prisma SQLite adapter.                              | `package.json`, `src/lib/prisma.ts`                           |
| `pg`                             | `^8.21.0`        | PostgreSQL driver used by the Prisma PG adapter.                              | `package.json`, `src/lib/prisma.ts`                           |
| `next-auth`                      | `^5.0.0-beta.31` | Auth.js authentication runtime.                                               | `package.json`, `src/auth.ts`, `src/auth.config.ts`           |
| `bcryptjs`                       | `^3.0.3`         | Password hashing for credentials auth.                                        | `package.json`, `docs/auth/README.md`                         |
| `@lexical/*` packages            | `^0.45.0`        | Lexical editor, rich text, tables, history, links, selection, and Yjs bridge. | `package.json`, `docs/editor/README.md`                       |
| `lexical`                        | `^0.45.0`        | Core Lexical editor dependency.                                               | `package.json`, `docs/editor/README.md`                       |
| `yjs`                            | `^13.6.31`       | Shared document CRDT for collaboration.                                       | `package.json`, `server.mjs`, `docs/collaboration/README.md`  |
| `y-websocket`                    | `^3.0.0`         | Browser/server websocket provider for Yjs rooms.                              | `package.json`, `docs/collaboration/README.md`                |
| `y-protocols`                    | `^1.0.7`         | Yjs protocol helpers.                                                         | `package.json`, `scripts/collab-core.mjs`                     |
| `lib0`                           | `^0.2.117`       | Yjs ecosystem utility dependency.                                             | `package.json`                                                |
| `ws`                             | `^8.21.0`        | Node websocket server for collaboration.                                      | `package.json`, `server.mjs`, `scripts/collab-server.mjs`     |
| `dotenv`                         | `^17.4.2`        | Loads environment variables for the custom server and Prisma config.          | `package.json`, `server.mjs`, `prisma.config.ts`              |
| `mammoth`                        | `^1.12.0`        | DOCX import parsing.                                                          | `package.json`, `docs/import/README.md`                       |
| `pdf-parse`                      | `^2.4.5`         | PDF import parsing; externalized from the Next bundle.                        | `package.json`, `next.config.ts`, `docs/import/README.md`     |
| `jszip`                          | `^3.10.1`        | Office archive/PPTX parsing and export support.                               | `package.json`, `docs/import/README.md`                       |
| `pptxgenjs`                      | `^4.0.1`         | PPTX export assembly.                                                         | `package.json`, `docs/presentation/rendering-and-export.md`   |
| `jspdf`                          | `^4.2.1`         | PDF export support.                                                           | `package.json`, `scripts/perf-budgets.mjs`                    |
| `framer-motion`                  | `^12.40.0`       | Motion/generation status UI components.                                       | `package.json`, `src/components/motion/`                      |
| `lucide-react`                   | `^1.20.0`        | Icon components.                                                              | `package.json`, `src/components/visual/icon-registry.ts`      |
| `nanoid`                         | `^5.1.11`        | ID generation where nanoid is imported.                                       | `package.json`                                                |
| `server-only`                    | `^0.0.1`         | Server-only import boundary marker.                                           | `package.json`, `src/lib/document-editor/loader.ts`           |

## 3) Development Toolchain

| Tool                        | Purpose                                                                                                                 | Evidence                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| TypeScript                  | Strict type checking with `tsc --noEmit`; additional unused-symbol gate via `typecheck:unused`.                         | `package.json`, `tsconfig.json`                                                      |
| ESLint                      | Next.js core web vitals + TypeScript linting after repo-specific lint guards.                                           | `package.json`, `eslint.config.mjs`                                                  |
| Prettier                    | Repository formatting with 80-column print width, semicolons, double quotes, trailing commas.                           | `.prettierrc.json`, `.prettierignore`, `package.json`                                |
| Node built-in test runner   | Unit/script test execution and line coverage.                                                                           | `package.json`, `scripts/check-line-coverage.mjs`                                    |
| `tsx`                       | Runs TypeScript tests and scripts under Node.                                                                           | `package.json`, `scripts/check-line-coverage.mjs`                                    |
| Playwright                  | Browser E2E tests.                                                                                                      | `package.json`, `playwright.config.ts`, `e2e/README.md`                              |
| Tailwind CSS PostCSS plugin | Styling pipeline.                                                                                                       | `package.json`, `postcss.config.mjs`, `src/app/globals.css`                          |
| Governance scripts          | Design-system, action-port, import-graph, client-boundary, E2E governance, Next constraints, perf budgets, docs checks. | `package.json`, `docs/operations/quality-gates.md`, `scripts/check-import-graph.mjs` |

## 4) Key Commands

```bash
npm install
npm run dev
npm run build
npm test
npm run test:subsystem -- presentation
npm run test:e2e
npm run lint
npm run typecheck
npm run docs:check
npm run db:generate
npm run db:push
```

## 5) Environment And Config

- Config sources: `.env.example`, `src/lib/env.ts`, `src/lib/client-config.ts`, `src/lib/db-provider.ts`, `prisma.config.ts`, `playwright.config.ts`, `server.mjs`, `docs/operations/runtime-config.md`.
- Required env vars: `AUTH_SECRET` is required for auth/session and several signed/rate-limited paths. `DATABASE_URL` is required when `DB_PROVIDER=postgres`; SQLite defaults to `file:./prisma/dev.db`. Azure generation requires `AZURE_OPENAI_ENDPOINT` and `AZURE_OPENAI_API_KEY` when used. Google OAuth requires `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` together. Stripe billing requires Stripe env vars when real Stripe billing is enabled.
- Deployment/runtime constraints: the app can run with the inline `/collab` Yjs websocket via `server.mjs`; standalone collaboration uses `npm run collab`. No Dockerfile, Compose file, `.nvmrc`, `SECURITY.md`, or Dependabot config was found by file search; exact local Node version policy is `[TODO]`.

## 6) Evidence

- `README.md`
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `eslint.config.mjs`
- `.prettierrc.json`
- `.env.example`
- `next.config.ts`
- `postcss.config.mjs`
- `server.mjs`
- `src/lib/env.ts`
- `src/lib/client-config.ts`
- `src/lib/prisma.ts`
- `prisma.config.ts`
- `.github/workflows/ci.yml`
- `playwright.config.ts`
- `docs/codebase/.codebase-scan.txt`
