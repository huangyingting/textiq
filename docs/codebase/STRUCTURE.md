---
type: "reference"
status: "current"
last_updated: "2026-07-04"
description: "Repository layout, entry points, module boundaries, and organization rules for TextIQ."
---

# Codebase Structure

## 1) Top-Level Map

| Path                       | Purpose                                                                                                                         | Evidence                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `src/app/`                 | Next.js App Router pages, API routes, server actions, global layout, and global styles.                                         | `README.md`, `src/app/layout.tsx`, `src/app/api/import/route.ts`                  |
| `src/components/`          | React UI components, including presentation/editor/visual components and shared UI primitives.                                  | `README.md`, `docs/system/design-system.md`, `src/components/ui/`                 |
| `src/lib/`                 | Domain logic, schemas, persistence helpers, auth, billing, AI, imports, presentation, public rendering, diagnostics, and tests. | `README.md`, `docs/system/documentation-map.md`, `src/lib/`                       |
| `scripts/`                 | Node scripts for collaboration runtime, quality gates, local CI, schema generation, browser QA, and governance checks.          | `README.md`, `package.json`, `scripts/ci-local.mjs`, `scripts/test-subsystem.mjs` |
| `prisma/`                  | Canonical Prisma schema, generated SQLite schema, seed scripts, and Prisma client generation inputs.                            | `README.md`, `prisma/schema.prisma`, `prisma.config.ts`                           |
| `e2e/`                     | Playwright E2E tests and deterministic profile fixtures/helpers.                                                                | `README.md`, `e2e/README.md`, `playwright.config.ts`                              |
| `docs/`                    | Current architecture, contracts, runbooks, plans, and codebase onboarding docs.                                                 | `README.md`, `docs/README.md`                                                     |
| `prototypes/slide-themes/` | Theme-package prototype source, generators, generated previews, and static preview HTML.                                        | `prototypes/slide-themes/README.md`, `package.json`                               |
| `public/`                  | Public static assets, including slide fonts.                                                                                    | `docs/codebase/.codebase-scan.txt`, `src/app/slide-fonts.css`                     |
| `.github/workflows/`       | CI and deterministic E2E GitHub Actions workflows.                                                                              | `.github/workflows/ci.yml`, `.github/workflows/e2e-deterministic.yml`             |
| `.agents/` and `.copilot/` | Agent/skill customization and automation instructions, not app runtime code.                                                    | `.prettierignore`, `.agents/skills/acquire-codebase-knowledge/SKILL.md`           |
| `.squad/`                  | Squad orchestration tooling ignored by ESLint/Prettier and not part of app code.                                                | `.prettierignore`, `eslint.config.mjs`                                            |

## 2) Entry Points

- Main runtime entry: `server.mjs`, selected by `npm run dev` and `npm start` in `package.json`. It prepares Next.js and optionally mounts the inline Yjs `/collab` websocket.
- Next app entry: `src/app/layout.tsx` wires global CSS, slide fonts, theme initialization, locale provider, overlay provider, and site header.
- Auth route/proxy entries: `src/auth.ts`, `src/auth.config.ts`, `src/proxy.ts`, and `src/app/api/auth/[...nextauth]/route.ts`.
- API route examples: `src/app/api/generate/route.ts`, `src/app/api/generate-deck/route.ts`, `src/app/api/import/route.ts`, `src/app/api/slide-assets/[documentId]/[...path]/route.ts`.
- Secondary worker/server entry: `scripts/collab-server.mjs`, selected by `npm run collab`.
- Quality/maintenance entry points: `scripts/ci-local.mjs`, `scripts/test-subsystem.mjs`, `scripts/check-line-coverage.mjs`, `scripts/gen-sqlite-schema.mjs`, `src/scripts/audit-persisted-schema.ts`.

## 3) Module Boundaries

| Boundary                                           | What belongs here                                                                                                            | What must not be here                                                                        |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/app/`                                         | Route composition, pages, route handlers, server action wiring, Next metadata/layout surfaces.                               | Shared domain rules that should be tested outside React/Next route code.                     |
| `src/components/ui/`                               | Shared app chrome primitives and reusable UI class-token composition.                                                        | Feature-specific business rules or raw ad hoc design tokens.                                 |
| `src/components/presentation/`                     | Presentation editor UI, modular stage interaction owners, inspector panels, toolbar, filmstrip, and present-mode components. | Persisted Deck validation or database writes; those live under `src/lib/` and route actions. |
| `src/lib/presentation/`                            | Current Deck schema/runtime, render/export, theme packages, editor commands, diagnostics, autosave, clipboard, PPTX specs.   | Legacy/superseded deck compatibility readers at runtime.                                     |
| `src/lib/document/` and `src/lib/document-editor/` | Document persistence, dashboard/document management, editor view models, deck CAS persistence.                               | Presentation UI components.                                                                  |
| `src/lib/visual/`                                  | Visual schemas, registry, renderer/export metadata, transforms, prompt constraints.                                          | React component rendering except through explicit component modules.                         |
| `src/lib/collab/` plus `scripts/collab-*.mjs`      | Collaboration room policy, websocket URL resolution, Yjs server/runtime scripts.                                             | Document authorization rules outside shared access helpers.                                  |
| `src/lib/import/` and `src/app/api/import/`        | Server-side parsing, validation, normalization, upload handling.                                                             | Client-bundle parser dependencies.                                                           |
| `src/lib/env.ts` and `src/lib/client-config.ts`    | Server and public-client environment accessors.                                                                              | Scattered computed `process.env.NEXT_PUBLIC_*` client reads.                                 |
| `scripts/`                                         | Repo governance, quality gates, operational scripts.                                                                         | Product runtime code imported by browser bundles unless explicitly safe.                     |

## 4) Naming And Organization Rules

- File naming pattern: source/test files are mostly lowercase kebab-case with suffixes such as `.test.ts`, `.spec.ts`, and domain qualifiers (`use-slide-editor-shell-controller.tsx`, `check-import-graph.mjs`). React components export PascalCase symbols from kebab-case files.
- Directory organization pattern: domain/subsystem-based rather than a strict controller/service/repository stack. `docs/system/documentation-map.md` maps each code subsystem to source anchors and owning docs.
- Import aliasing: `@/*` maps to `./src/*` in `tsconfig.json`. Server-only modules use `import "server-only"` where applicable.
- Generated/artifact boundaries: `.next/`, `node_modules/`, `src/generated/`, `.tmp/test-fixtures/`, and `.squad/` are excluded from lint/format scopes where configured; `src/generated/` is generated Prisma client code.
- Monorepo status: scan reported no monorepo signals; the root `package.json` has no `workspaces` field.

## 5) Evidence

- `README.md`
- `docs/system/documentation-map.md`
- `package.json`
- `server.mjs`
- `src/app/layout.tsx`
- `src/app/app/documents/[id]/page.tsx`
- `src/app/app/documents/[id]/slides/page.tsx`
- `src/app/app/documents/[id]/actions.ts`
- `src/lib/document-editor/loader.ts`
- `src/lib/presentation/open-deck.ts`
- `src/lib/presentation/render-resolver.ts`
- `src/components/presentation/use-stage-interaction-controller.ts`
- `src/components/presentation/stage-pointer-interactions.ts`
- `src/components/presentation/stage-keyboard-interactions.ts`
- `src/components/presentation/stage-targeting.ts`
- `src/components/presentation/inspector/inspector-shell.tsx`
- `scripts/test-subsystem.mjs`
- `eslint.config.mjs`
- `.prettierignore`
- `docs/codebase/.codebase-scan.txt`
