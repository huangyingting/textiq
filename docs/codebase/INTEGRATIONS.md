---
type: "reference"
status: "current"
last_updated: "2026-07-04"
description: "External systems, data stores, credentials, reliability behavior, and observability surfaces used by TextIQ."
---

# External Integrations

## 1) Integration Inventory

| System                                | Type                                         | Purpose                                                                                                                     | Auth model                                                                                        | Criticality                  | Evidence                                                                                                                     |
| ------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Prisma database via SQLite/PostgreSQL | DB                                           | Persists users, documents, decks, visuals, comments, workspaces, billing/subscription state, rate limits, assets, versions. | `DATABASE_URL`; provider selected by `DB_PROVIDER`; Prisma adapters for SQLite/Postgres.          | High                         | `prisma/schema.prisma`, `src/lib/prisma.ts`, `src/lib/db-provider.ts`                                                        |
| Auth.js / NextAuth                    | Auth                                         | Credentials, session JWTs, optional Google OAuth, route protection.                                                         | `AUTH_SECRET`; Google OAuth client id/secret when enabled.                                        | High                         | `src/auth.ts`, `src/auth.config.ts`, `src/proxy.ts`, `.env.example`                                                          |
| Google OAuth                          | External OAuth API                           | Optional Google sign-in provider.                                                                                           | `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`; provider only registered when both are configured. | Medium                       | `src/auth.ts`, `src/lib/env.ts`, `.env.example`                                                                              |
| Azure OpenAI Chat Completions         | External API                                 | Visual and deck generation.                                                                                                 | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, deployment, API version.                         | High for AI features         | `src/lib/ai/azure.ts`, `src/app/api/generate/route.ts`, `src/app/api/generate-deck/route.ts`                                 |
| Stripe billing                        | External payment/webhook API                 | Plan changes, subscription lifecycle, webhooks when Stripe is configured.                                                   | Stripe secret key, price ids, webhook secret.                                                     | Medium/High for paid billing | `src/lib/billing/provider.ts`, `src/app/api/billing/webhook/route.ts`, `src/lib/env.ts`, `docs/operations/runtime-config.md` |
| Yjs websocket collaboration           | Realtime transport                           | Live document collaboration, title sync, presence, read-only viewer rooms.                                                  | App authorization route/cookies; optional internal collab secret for recovery flush.              | High for collaboration       | `server.mjs`, `scripts/collab-server.mjs`, `src/lib/collab/room-access.ts`, `docs/collaboration/README.md`                   |
| Public import parsers                 | Server libraries                             | Parse Markdown, HTML, DOCX, PPTX, PDF uploads into normalized Markdown-compatible text.                                     | Public route rate-limited by hashed IP; `AUTH_SECRET` required for hashing.                       | Medium                       | `src/app/api/import/route.ts`, `docs/import/README.md`, `package.json`                                                       |
| Slide asset storage                   | Local filesystem adapter via protected route | Stores slide assets outside public static serving and serves them through access-controlled API route.                      | Document capability or share-bound public asset params.                                           | High for asset privacy       | `src/lib/slides/asset-storage.ts`, `src/app/api/slide-assets/[documentId]/[...path]/route.ts`                                |
| GitHub Actions                        | CI/CD                                        | Runs quality gate and deterministic E2E profile.                                                                            | GitHub-hosted runner; repo workflow permissions [TODO].                                           | Medium                       | `.github/workflows/ci.yml`, `.github/workflows/e2e-deterministic.yml`                                                        |

## 2) Data Stores

| Store                     | Role                                                                   | Access layer                                                   | Key risk                                                                                                                   | Evidence                                                            |
| ------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| SQLite database           | Zero-setup local/dev/test persistence.                                 | Prisma Better SQLite adapter.                                  | Local file state can drift; schema drift gate must run.                                                                    | `src/lib/prisma.ts`, `prisma.config.ts`, `.github/workflows/ci.yml` |
| PostgreSQL database       | Production-style persistence when `DB_PROVIDER=postgres`.              | Prisma PG adapter.                                             | Missing `DATABASE_URL` throws when provider is Postgres.                                                                   | `src/lib/prisma.ts`, `src/lib/db-provider.ts`                       |
| Local slide asset storage | Stores uploaded slide assets under non-public `storage/slide-assets/`. | `LocalAssetStorageAdapter` through `getDefaultStorageAdapter`. | Local filesystem adapter is process/local-disk scoped; future cloud deployments must override adapter before first upload. | `src/lib/slides/asset-storage.ts`                                   |
| Yjs room memory           | Low-latency collaborative document state.                              | `server.mjs`, `scripts/collab-core.mjs`.                       | In-memory room state is not the durable source; database remains canonical and recovery snapshot is best-effort.           | `server.mjs`, `docs/collaboration/README.md`                        |
| Rate limit rows           | Persistent fixed-window abuse budgets.                                 | Prisma-backed `RateLimitHit` store.                            | Requires `AUTH_SECRET` for HMAC subject hashing in public routes.                                                          | `src/lib/rate-limit.ts`, `src/lib/abuse-budget.ts`                  |

Database provider selection is centralized in `src/lib/db-provider.ts`: only `DB_PROVIDER=postgres` selects PostgreSQL, and all other values select SQLite. `resolveUrl()` keeps the zero-setup SQLite fallback at `file:./prisma/dev.db`; Postgres callers must provide `DATABASE_URL`. Provider-specific case-insensitive search is isolated in `caseInsensitiveContains`, which adds Prisma `mode: "insensitive"` only for Postgres and relies on SQLite's default ASCII-insensitive `LIKE` behavior otherwise.

## 3) Secrets And Credentials Handling

- Credential sources: environment variables documented in `.env.example`, `src/lib/env.ts`, and `docs/operations/runtime-config.md`.
- Server env access is centralized in `src/lib/env.ts`; public client env values are read literally in `src/lib/client-config.ts` for Next.js static inlining.
- Logs redact keys containing secret/password/token/cookie/credential/private-key indicators plus raw content-like keys.
- Hardcoding checks: no Dockerfile, `.nvmrc`, `SECURITY.md`, or Dependabot config was found; no committed secret store was identified by the scan.
- Rotation/lifecycle notes: `[TODO]` no formal secret rotation policy file was found in the repo.

## 4) Reliability And Failure Behavior

- Retry/backoff behavior: resilient deck autosave has queue/retry behavior in presentation runtime docs; external API retry behavior for Azure/Stripe is `[TODO]` unless implemented inside specific providers not read here.
- Timeout policy: Azure generation route uses an abort deadline through `createGenerationRouteHandler`; import parsing uses `processImportUpload` with parser timeout; collaboration authorization has timeout envs in runtime config.
- Circuit-breaker/fallback behavior: billing fails closed in production when Stripe is required but unavailable, and falls back to mock only in non-production; collaboration degrades the editor to local-only when the socket is unavailable; collaboration eviction flush is best-effort recovery and does not replace the database source of truth; public import and asset routes fail closed on missing secrets or denied access.
- Rate limiting: abuse budgets cover auth, account export, public share/assets, collab, import, and AI generation namespaces.

## 5) Observability For Integrations

- Structured logging uses JSON records with redaction via `src/lib/log.ts` and `src/lib/log-redaction-core.cjs`.
- Import route emits product telemetry for start/success/failure with file type, size bucket, duration bucket, status, and stable failure reason.
- API abuse diagnostics log route denials for public expensive endpoints.
- Collaboration health endpoints expose safe room and flush observability, including flush failure counters and recent safe failure ids.
- Missing visibility gaps: `[TODO]` no OpenTelemetry/APM/Prometheus config was found, and the scan reported no performance testing configs.

## 6) Evidence

- `.env.example`
- `docs/operations/runtime-config.md`
- `src/lib/env.ts`
- `src/lib/client-config.ts`
- `src/lib/prisma.ts`
- `src/lib/db-provider.ts`
- `prisma/schema.prisma`
- `src/auth.ts`
- `src/auth.config.ts`
- `src/lib/ai/azure.ts`
- `src/app/api/generate/route.ts`
- `src/app/api/generate-deck/route.ts`
- `src/app/api/import/route.ts`
- `src/lib/billing/provider.ts`
- `src/app/api/billing/webhook/route.ts`
- `server.mjs`
- `src/lib/collab/room-access.ts`
- `src/lib/slides/asset-storage.ts`
- `src/app/api/slide-assets/[documentId]/[...path]/route.ts`
- `src/lib/rate-limit.ts`
- `src/lib/abuse-budget.ts`
- `docs/codebase/.codebase-scan.txt`
