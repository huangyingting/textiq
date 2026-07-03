---
type: "reference"
status: "current"
last_updated: "2026-07-04"
description: "Coding, naming, formatting, import, error, logging, and testing conventions observed in TextIQ."
---

# Coding Conventions

## 1) Naming Rules

| Item               | Rule                                                                                                                       | Example                                                                                   | Evidence                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Files              | Lowercase kebab-case with domain suffixes; tests use `.test.ts` and E2E specs use `.spec.ts`.                              | `use-slide-editor-shell-controller.tsx`, `check-import-graph.mjs`, `slides-smoke.spec.ts` | `src/components/presentation/use-slide-editor-shell-controller.tsx`, `scripts/check-import-graph.mjs`, `e2e/README.md` |
| Functions/methods  | camelCase verbs/nouns for functions and helpers.                                                                           | `loadDocumentEditorViewModel`, `resolveDeckRenderTree`, `actionError`                     | `src/lib/document-editor/loader.ts`, `src/lib/presentation/render-resolver.ts`, `src/lib/action-result.ts`             |
| Types/interfaces   | PascalCase type/interface names.                                                                                           | `ActionResult`, `AzureConfig`, `SlideFormatConfig`                                        | `src/lib/action-result.ts`, `src/lib/ai/azure.ts`, `src/lib/document/deck-kernel/slide-format.ts`                      |
| Constants/env vars | Constants use SCREAMING*SNAKE_CASE; env vars use SCREAMING_SNAKE_CASE and `NEXT_PUBLIC*\*` only for client-inlined values. | `API_ERROR_CODES`, `DEFAULT_AZURE_API_VERSION`, `NEXT_PUBLIC_APP_URL`                     | `src/lib/api/errors.ts`, `src/lib/ai/azure.ts`, `.env.example`, `src/lib/client-config.ts`                             |

## 2) Formatting And Linting

- Formatter: Prettier with semicolons, double quotes, trailing commas, print width 80, tab width 2.
- Linter: ESLint flat config with Next core web vitals, Next TypeScript rules, Prettier compatibility, `_`-prefixed unused-var exceptions, and `no-explicit-any` disabled.
- `npm run lint` runs design-system guardrails, action-port guard, Next build constraints, client boundary, import graph, E2E governance, perf budgets, and ESLint. Prettier is a separate formatting gate through `npm run format` / `npm run format:check`, and docs Markdown formatting is checked by `npm run docs:check`.
- Run commands: `npm run lint`, `npm run format`, `npm run format:check`.

## 3) Import And Module Conventions

- Alias convention: `@/*` maps to `./src/*` in `tsconfig.json`; source imports commonly use `@/lib/...` and `@/components/...` for cross-subsystem references.
- Public client config convention: `src/lib/client-config.ts` keeps literal `process.env.NEXT_PUBLIC_*` reads so Next.js can statically inline public values.
- Server-only convention: server-only loaders import `server-only` when they must not cross into client bundles.
- Barrel/export policy: `scripts/check-import-graph.mjs` locks allowed export-star barrels at zero and fails on new export-star barrels, cycles, or internal-facade import bypasses.
- Generated code boundary: `src/generated/**` is ignored by ESLint; `.prettierignore` excludes `src/generated`, `.next`, `node_modules`, lockfiles, and orchestration directories.

## 4) Error And Logging Conventions

- Server actions use `ActionResult<T>` (`{ ok: true, data }` or `{ ok: false, error }`) when callers need production-visible user errors.
- API routes use shared helpers that return `{ error, code }` JSON bodies and stable `API_ERROR_CODES`.
- Privacy-preserving denials remain route-owned; helpers do not force 403 where a 404 is required to conceal resource existence.
- Structured logs are JSON records with `level`, `scope`, `timestamp`, message/error fields, and redacted context. Sensitive keys, raw content keys, and unsafe strings are redacted by `log-redaction-core.cjs`.
- Log scopes use lowercase dot-separated names such as `api.import`, `deck.patch`, and `asset.slide.purge`.

## 5) Testing Conventions

- Unit tests live alongside source under `src/**/*.test.ts`; script tests live under `scripts/**/*.test.mjs`; browser specs live under `e2e/*.spec.ts`.
- Test file names are governed by `scripts/test-subsystem.mjs`: lowercase segments separated by `-` or `.`, ending in `.test.*` or `.spec.*`.
- Focused subsystem tests run through `npm run test:subsystem -- <subsystem>`; direct focused unit-file runs use `node --import tsx --test <file>` when avoiding the `test:unit` glob.
- Shared builders live under `src/test/`, for example `src/test/builders/presentation-deck.ts`.
- Coverage expectation: `scripts/check-line-coverage.mjs` currently defaults to 95% source line coverage and 99% script line coverage, with env overrides. Inline comments mark both floors as temporary reductions from the intended 97% source and 100% script targets.

## 6) Evidence

- `.prettierrc.json`
- `.prettierignore`
- `eslint.config.mjs`
- `tsconfig.json`
- `package.json`
- `scripts/check-import-graph.mjs`
- `scripts/test-subsystem.mjs`
- `scripts/check-line-coverage.mjs`
- `src/lib/action-result.ts`
- `src/lib/api/errors.ts`
- `src/lib/log.ts`
- `src/lib/log-redaction-core.cjs`
- `src/lib/client-config.ts`
- `src/test/builders/presentation-deck.ts`
