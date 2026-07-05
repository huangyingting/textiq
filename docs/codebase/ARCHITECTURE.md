---
type: "architecture"
status: "current"
last_updated: "2026-07-04"
description: "Architecture style, request/data flows, module responsibilities, repeated patterns, and risks for TextIQ."
---

# Architecture

## 1) Architectural Style

- Primary style: subsystem/domain-based Next.js application with route handlers/pages at the edge of the app, pure domain modules under `src/lib/`, React UI components under `src/components/`, Prisma-backed persistence, and dedicated scripts for operational/governance tasks.
- Why this classification: `docs/system/documentation-map.md` maps source by product subsystem (`auth`, `collaboration`, `documents`, `presentation`, `visual`, `public-render`, etc.). The source tree mirrors this domain map under `src/lib/` and `src/components/` rather than a generic controller/service/repository layout.
- Primary constraints:
  - Current schemas are authoritative; runtime render/export paths reject superseded Deck payloads instead of converting them.
  - Server/client boundaries matter: server-only loaders import `server-only`, client config keeps literal `NEXT_PUBLIC_*` reads, and lint includes a client-boundary guard.
  - Public/heavy routes are bounded by validation, rate limits, and timeout/budget checks before expensive work.

## 2) System Flow

```text
Next route/page -> view-model/domain loader -> Prisma/domain helpers -> client editor/render surface -> server action/API persistence/export output
```

1. Authenticated document editing begins in `src/app/app/documents/[id]/page.tsx`, which calls `requireUser`, loads a view model through `loadDocumentEditorViewModel`, and renders `LexicalEditor`.
2. The document view-model loader queries accessible documents with Prisma, loads comments/tags/custom theme packages, and returns UI-ready data.
3. Slide editing begins in `src/app/app/documents/[id]/slides/page.tsx`, which reuses the document view-model boundary and only renders the slide editor when the caller can edit.
4. Full deck saves call `persistDeck`, validate current Deck JSON, write through CAS, snapshot document versions, and reconcile slide comment anchors.
5. Slide-stage editing keeps gesture state in presentation controllers and routes mutations through Deck command helpers; pointer targeting, keyboard connector flow, and inspector panels are split into focused modules under `src/components/presentation/`.
6. Render/export paths call `openDeckFromJson`/`resolveDeckRenderTree` to validate current schema and resolve theme/style/assets before React rendering or PPTX/export adapters consume the render tree.
7. Public share/embed/present requests call `resolvePublicRender`, which projects a read-only model from Prisma and share policy, then uses presentation/public-render helpers without mutating source state.

## 3) Layer/Module Responsibilities

| Layer or module                                | Owns                                                                                                        | Must not own                                                                     | Evidence                                                                       |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `server.mjs`                                   | Next custom server startup, inline collaboration websocket mounting, health endpoint, upgrade routing.      | Product business rules beyond collab runtime wiring.                             | `server.mjs`                                                                   |
| `src/app/`                                     | Pages, layouts, route handlers, metadata, and server action composition.                                    | Shared validation/persistence logic that belongs in testable `src/lib/` modules. | `src/app/layout.tsx`, `src/app/api/import/route.ts`                            |
| `src/auth.config.ts`                           | Edge-safe Auth.js route authorization config.                                                               | Prisma, bcrypt, or provider code that cannot run at the Edge.                    | `src/auth.config.ts`                                                           |
| `src/auth.ts`                                  | Node Auth.js providers and callbacks.                                                                       | Edge proxy configuration.                                                        | `src/auth.ts`                                                                  |
| `src/lib/prisma.ts` + `src/lib/db-provider.ts` | Provider selection, Prisma adapter construction, process-wide Prisma client.                                | Route-specific authorization/policy decisions.                                   | `src/lib/prisma.ts`, `src/lib/db-provider.ts`                                  |
| `src/lib/document-editor/`                     | Editor view-model loading and document editor data projection.                                              | React component rendering.                                                       | `src/lib/document-editor/loader.ts`                                            |
| `src/lib/document/`                            | Document persistence, deck CAS writes, document management, schema repair.                                  | Presentation stage UI interactions.                                              | `src/lib/document/persistence/deck.ts`                                         |
| `src/lib/presentation/`                        | Current Deck schema/runtime, open boundary, render resolver, editor commands, export specs, theme packages. | Superseded v6 runtime compatibility.                                             | `src/lib/presentation/open-deck.ts`, `src/lib/presentation/render-resolver.ts` |
| `src/lib/visual/`                              | Visual schema, registry, transforms, export capabilities.                                                   | Document persistence projection rows.                                            | `docs/visual/README.md`, `src/lib/visual/schema.ts`                            |
| `src/lib/public-render/`                       | Read-only share/embed/present/asset resolution.                                                             | Mutating document or deck state.                                                 | `src/lib/public-render/resolver.ts`                                            |
| `scripts/`                                     | Quality gates, collaboration standalone server, schema generation, local CI and operations.                 | Browser-bundle app code.                                                         | `package.json`, `scripts/ci-local.mjs`, `scripts/check-import-graph.mjs`       |

## 4) Reused Patterns

| Pattern                      | Where found                                                                                                                                                | Why it exists                                                                                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| View-model loaders           | `src/lib/document-editor/loader.ts`, `src/lib/public-render/resolver.ts`                                                                                   | Keep route/page components thin and pass UI-ready state into React surfaces.                                                                       |
| Discriminated action results | `src/lib/action-result.ts`                                                                                                                                 | Server actions can return user-visible errors without relying on thrown errors masked by Next.js.                                                  |
| Central env accessors        | `src/lib/env.ts`, `src/lib/client-config.ts`                                                                                                               | Keeps server env validation and client `NEXT_PUBLIC_*` static reads explicit.                                                                      |
| Prisma singleton             | `src/lib/prisma.ts`                                                                                                                                        | Reuses Prisma client in non-production and selects SQLite/Postgres adapters by provider.                                                           |
| Adapter/factory boundaries   | `src/lib/slides/asset-storage.ts`, `src/lib/billing/provider.ts`                                                                                           | Allows local/mock defaults and future/deployed adapters while keeping callers stable.                                                              |
| Validation/open boundary     | `src/lib/presentation/open-deck.ts`, `src/lib/presentation/validation.ts`                                                                                  | Rejects malformed or superseded Deck payloads before editor/render/export runtime.                                                                 |
| CAS persistence              | `src/lib/document/persistence/deck.ts`, `src/lib/document/deck-cas-writer.ts`                                                                              | Protects Deck saves with revision-token conflict behavior.                                                                                         |
| Modular stage controllers    | `src/components/presentation/use-stage-interaction-controller.ts`, `stage-pointer-interactions.ts`, `stage-keyboard-interactions.ts`, `stage-targeting.ts` | Keeps direct-manipulation state, hit targeting, keyboard connector behavior, and gesture drafts out of the monolithic editor shell where possible. |
| Governance ratchets          | `scripts/check-import-graph.mjs`, `scripts/client-boundary.mjs`, `scripts/perf-budgets.mjs`                                                                | Prevents import cycles/export-star barrels, server/client boundary leaks, and payload/static-import regressions.                                   |

## 5) Known Architectural Risks

- The presentation editor remains a large/high-churn area. Current `src/components/presentation/slide-editor.tsx` is 3,270 lines, and the scan reports it as the highest-churn file in the last 90 days. Some scan high-churn entries are deleted or relocated historical paths; current stage and inspector code is split across `stage-*`, `use-stage-*`, and `inspector/` modules.
- Browser E2E remains intentionally bounded: `.github/workflows/e2e-deterministic.yml` hard-gates the deterministic seeded profile through the no-build dev-server profile runner, while broader Playwright coverage stays opt-in.
- Node.js 22+ is the repository runtime policy: `package.json.engines.node` requires `>=22`, `.nvmrc` pins the local/CI major line to `22`, and CI reads that file when setting up Node.

## 6) Evidence

- `README.md`
- `docs/system/documentation-map.md`
- `server.mjs`
- `src/app/app/documents/[id]/page.tsx`
- `src/app/app/documents/[id]/slides/page.tsx`
- `src/lib/document-editor/loader.ts`
- `src/lib/document/persistence/deck.ts`
- `src/lib/presentation/open-deck.ts`
- `src/lib/presentation/render-resolver.ts`
- `src/lib/public-render/resolver.ts`
- `src/lib/prisma.ts`
- `src/lib/env.ts`
- `src/lib/action-result.ts`
- `scripts/check-import-graph.mjs`
- `.github/workflows/e2e-deterministic.yml`
- `docs/codebase/.codebase-scan.txt`
