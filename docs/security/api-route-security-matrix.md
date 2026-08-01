---
type: "reference"
status: "current"
last_updated: "2026-08-01"
description: "API route security matrix covering route access policy, authentication requirements, response semantics, public surface governance, and security test enforcement."
---

# API Route Security Matrix

**Epic:** #495 — API Security and Public Surface Governance
**Issue:** #509

Enforced by `src/app/api/api-route-security-matrix.test.ts`.
Last content update: 2026-08-01 — public application liveness and readiness contracts.

---

## Purpose

This matrix is the single, authoritative inventory of every HTTP route under
`src/app/api/**/route.ts`: how it is gated, what it returns when it denies a
request, and who owns it. Adding a route to the filesystem WITHOUT adding a row
here fails the guard test, so a new public surface can never ship unclassified.

The guard test (`src/app/api/api-route-security-matrix.test.ts`):

- globs `src/app/api/**/route.ts` and normalizes each to a route key,
- parses the **Route** column of the table below, and
- validates the full route contract schema: classification enum, auth/session,
  rate-limit declaration, gate, denial status/body, response exception, and
  owner, and
- fails if any filesystem route is missing a row, if the table lists a route that
  no longer exists, or if a row leaves one of those contracts ambiguous.

Routes that intentionally carry no app-level gate (framework/auth handlers or
minimal operational probes) are tracked in the test's
`NO_APP_GATE_ALLOWLIST` so the "public by design" decision is explicit and
reviewable.

## Classifications

| Classification          | Meaning                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| `public+rate-limited`   | No session required; abuse-controlled by rate limit / quota.       |
| `authenticated-session` | Requires a valid Auth.js session (`getCurrentUser`).               |
| `document-capability`   | Requires a role-derived capability on a specific document.         |
| `share-policy`          | Gated by the public share/embed/present link policy.               |
| `entitlement-gated`     | Requires a session AND a plan entitlement.                         |
| `webhook-signature`     | Verified by a provider webhook signature (Stripe).                 |
| `internal-secret`       | Verified by an internal shared secret header (service-to-service). |
| `framework-auth`        | The Auth.js handler itself; public by design (no app-level gate).  |
| `operational-health`    | Minimal public process/dependency probe for deployment automation. |

## Shared denial helpers

Access-policy routes map domain decisions through
`src/lib/access-policy/adapters.ts`, which preserves the status selected by the
policy before delegating JSON denials to `src/lib/api/errors.ts`
(`unauthorized()`, `forbidden()`, `notFound()`, `featureDisabled()`,
`validationError()`, `tooManyRequests()`). The slide-asset route is the
deliberate exception: it serves images and uses the plain-text adapter for
privacy-preserving bodies (see Notes).

---

## Matrix

| Route                                 | Classification          | Auth/session          | Rate limit                      | Capability / share / entitlement / signature gate                                                                                                                | Denial status / body                                                                                                                                                                                                                | Response exception          | Owner               | Notes                                                                                                                                                                                                                                                                                                        |
| ------------------------------------- | ----------------------- | --------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `account/export`                      | `authenticated-session` | Required              | Per authenticated user          | Reads scoped to session `user.id`                                                                                                                                | 401 `{error:"Unauthorized.",code:"UNAUTHORIZED"}`; 429 rate limit (+`Retry-After`, only when `AUTH_SECRET` is set); 500 on failure                                                                                                  | None                        | Platform/Privacy    | "Download my data"; never accepts a client-supplied id. Abuse budget `account.export.user` applies when `AUTH_SECRET` is set.                                                                                                                                                                                |
| `auth/[...nextauth]`                  | `framework-auth`        | Handled by Auth.js    | No                              | Auth.js handler (sign-in/out, callbacks)                                                                                                                         | Delegated to Auth.js                                                                                                                                                                                                                | Framework delegated         | Platform/Auth       | Public by design — in `NO_APP_GATE_ALLOWLIST`. No app-level gate is added on purpose.                                                                                                                                                                                                                        |
| `billing/webhook`                     | `webhook-signature`     | None                  | No                              | Stripe signature (`stripe-signature` header)                                                                                                                     | 200 `{message:"ok"}` when Stripe disabled (intentional); 400 `{error:"Missing stripe-signature header",code:"VALIDATION_ERROR"}`; 500 `{error:"...",code:"SERVER_ERROR"}` handler error                                             | Provider contract           | Billing             | 200-when-disabled is intentional so the app runs without Stripe creds. Do NOT normalize this away.                                                                                                                                                                                                           |
| `brand`                               | `authenticated-session` | Required              | No                              | Lists brands for session `user.id`                                                                                                                               | 401 `{error:"Unauthorized.",code:"UNAUTHORIZED"}`                                                                                                                                                                                   | None                        | Brand               | List endpoint for the visual-context popover.                                                                                                                                                                                                                                                                |
| `brand-assets/[ownerId]/[...path]`    | `share-policy`          | Optional              | Per client IP                   | Session `user.id` must equal the `ownerId` partition OR `shareId` + `shareMode` must allow a shared presentation whose active theme package references the asset | 429 plain `Too many requests` (+`Retry-After`, only when `AUTH_SECRET` is set); 404 plain `Not found` for missing, anonymous, non-owner, or share-denied requests; 200 bytes                                                        | Binary/plain-text           | Brand               | Serves protected brand logo/font bytes (Epic #496). Owner-scoped outside shared presentations; every denial is a privacy 404 so callers cannot enumerate private asset keys. Abuse budget `public.asset.ip` applies when `AUTH_SECRET` is set.                                                               |
| `brand/font`                          | `entitlement-gated`     | Required              | No                              | `resolveBrandEntitlements().canFontUpload`                                                                                                                       | 401 unauthorized; 403 `{error:<upgrade msg>,code:"FORBIDDEN"}`; 400 bad form; 413 too large; 415 wrong type                                                                                                                         | None                        | Brand/Billing       | 403 carries a product upgrade message (intentional). Stores font bytes as a protected `Asset` (#496).                                                                                                                                                                                                        |
| `brand/logo`                          | `entitlement-gated`     | Required              | No                              | `resolveBrandEntitlements().canBrand`                                                                                                                            | 401 unauthorized; 403 `{error:<upgrade msg>,code:"FORBIDDEN"}`; 400 bad form; 413 too large; 415 wrong type                                                                                                                         | None                        | Brand/Billing       | 403 carries a product upgrade message (intentional). Stores logo bytes as a protected `Asset` (#496).                                                                                                                                                                                                        |
| `collab/authorize`                    | `document-capability`   | Required              | Per authenticated user          | `getDocumentCapabilities` + `decideRoomAccess` + access adapter                                                                                                  | 401 unauthorized; 429 rate limit (+`Retry-After`, only when `AUTH_SECRET` is set); 403 forbidden (missing room or no view access — never leaks existence); 200 `{ok,role,readOnly}`                                                 | None                        | Collab              | Called by the WebSocket upgrade handler. 403 deliberately covers missing/deleted docs.                                                                                                                                                                                                                       |
| `collab/flush`                        | `internal-secret`       | None (service-to-svc) | Per document id                 | Constant-time `x-collab-internal-secret` compare                                                                                                                 | 503 disabled (no secret set); 401 invalid secret; 413 body too large; 400 malformed; 429 rate limit (+`Retry-After`); 404 missing document; 500 persist failure (`{error:"Failed to persist snapshot."}`); 200 `{ok:true}`          | None                        | Collab              | Internal recovery-snapshot endpoint (#497). Disabled (503) when `COLLAB_INTERNAL_SECRET` is unset.                                                                                                                                                                                                           |
| `generate`                            | `public+rate-limited`   | Optional              | Per-user + anon IP + anon trial | Credit metering for authenticated users                                                                                                                          | 400/413 validation; 429 rate/quota (+`Retry-After`); 402 insufficient credits; 503 Azure misconfig; 504 timeout; 502                                                                                                                | Shared `{error, code}` body | AI                  | Public by design. Authenticated callers must send `Idempotency-Key` for metering replay safety. Abuse denials emit `api-abuse` diagnostics (#512).                                                                                                                                                           |
| `generate-deck`                       | `public+rate-limited`   | Optional              | Per-user + anon IP + anon trial | Feature flag `AI_DECK_GEN_ENABLED`; credits                                                                                                                      | 404 when flag OFF (intentional); 400/413; 429 (+`Retry-After`); 402; 503; 504; 502                                                                                                                                                  | Shared `{error, code}` body | AI                  | 404-when-disabled hides the route by design. Do NOT normalize this away. Authenticated callers must send `Idempotency-Key` for metering replay safety. Emits `api-abuse` diagnostics (#512).                                                                                                                 |
| `health/live`                         | `operational-health`    | None                  | No                              | Minimal process liveness only                                                                                                                                    | 200 `{status:"ok"}` while request handling works                                                                                                                                                                                    | None                        | Platform/Operations | Public by design and in `NO_APP_GATE_ALLOWLIST`; `no-store` response exposes no secrets, versions, environment names, or dependency details.                                                                                                                                                                 |
| `health/ready`                        | `operational-health`    | None                  | No                              | Required auth/session/email configuration plus bounded, cached database/schema probe                                                                             | 503 `{status:"not_ready"}`; 200 `{status:"ready"}`                                                                                                                                                                                  | None                        | Platform/Operations | Public by design and in `NO_APP_GATE_ALLOWLIST`; production requires auth email delivery and a canonical HTTPS origin. The `no-store`, 2-second response bound, single-flight database work, 5-second success cache, and 1-second failure cache prevent probe amplification without leaking failure details. |
| `import`                              | `authenticated-session` | Required              | Per client IP                   | Session required before multipart parsing; parser timeout bounds each parse                                                                                      | 401 `{ok:false,error:{code:"unauthorized",status:401,...}}`; 429 rate limit (+`Retry-After`); 400 bad form / read; 413/415 invalid file; 422 empty / parse-timeout / parse-failed                                                   | None                        | AI/Import           | Heavy parsers run server-side only after authentication. Emits `api-abuse` diagnostics (#512).                                                                                                                                                                                                               |
| `share-passcode/unlock`               | `share-policy`          | None                  | Per client IP + share id        | Validates the submitted passcode against `Document.sharePasscodeHash`, then sets a signed, share-id-bound unlock cookie                                          | 303 redirect back to the public route with `?passcode=invalid`; 303 `?passcode=limited` when attempt budget is exhausted; no document content in response                                                                           | None                        | Presentation        | Passcode attempts are throttled through `public.share-passcode.ip`; unlock cookies are invalidated by share regeneration or passcode changes.                                                                                                                                                                |
| `slide-assets/[documentId]/[...path]` | `share-policy`          | Optional              | No                              | `decideSlideAssetAccess` (document capability OR share-bound public access via `shareId` + `shareMode`) + plain-text adapter                                     | 429 `{error:"...",code:"RATE_LIMITED"}` (+`Retry-After`); 404 plain `Not found` (missing asset/doc — privacy); 403 plain `Forbidden` (exists but unauthorized); 404 `{error:"Not found.",code:"NOT_FOUND"}` storage miss; 200 bytes | Binary/plain-text           | Presentation        | Access-control denials are plain-text (image route, privacy-preserving). Rate-limit and storage-miss errors use canonical JSON. Privacy 404 must NEVER become a 403. Decision tested in `asset-access.test.ts`.                                                                                              |
| `user/entitlements`                   | `authenticated-session` | Required              | No                              | Derives plan/credit state for session `user.id`                                                                                                                  | 401 `{error:"Unauthorized.",code:"UNAUTHORIZED"}`                                                                                                                                                                                   | None                        | Billing             | Body normalized in #511 (was `"Unauthorized"` without a trailing period).                                                                                                                                                                                                                                    |

---

## Intentional behaviors (do NOT "normalize" these)

- **`billing/webhook` returns 200 when Stripe is disabled** so the app builds
  and runs without Stripe credentials.
- **`generate-deck` returns 404 when `AI_DECK_GEN_ENABLED` is OFF** to keep the
  route invisible until an operator opts in.
- **`slide-assets` returns a privacy 404** (plain text) for missing assets /
  documents, and a plain-text 403 only when an asset provably exists but the
  caller is unauthorized. A privacy 404 must never be downgraded to a 403,
  which would confirm the asset exists.
- **`auth/[...nextauth]`** is public by design and carries no app-level gate.
- **`health/live` and `health/ready`** are public by design so deployment
  infrastructure can probe them without a user session. Their bodies remain
  minimal and non-cacheable; they never reveal configuration, database errors,
  dependency details, environment names, or versions.

## Related

- Access adapters: `src/lib/access-policy/adapters.ts` (#813).
- Error helper: `src/lib/api/errors.ts` (#511).
- Abuse diagnostics: `src/lib/diagnostics/api-abuse.ts` (#512).
- Trusted proxy client-IP policy:
  [../operations/runtime-config.md](../operations/runtime-config.md#trusted-proxy-client-ip-extraction)
  (#1745).
- Access policy: [access-and-sharing.md](access-and-sharing.md).
- Release gate: [../operations/release-gate.md](../operations/release-gate.md).
