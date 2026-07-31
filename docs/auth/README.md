---
type: "architecture"
status: "current"
last_updated: "2026-07-31"
description: "This subsystem covers sign-in, account creation, provider linking, account settings, self-serve recovery, email verification, export, and deletion. Route authorization and document/workspace capabilities live in ../security/; this document covers how a user becomes and remains an authenticated account."
---

# Authentication And Account Lifecycle

This subsystem covers sign-in, account creation, provider linking, account
settings, self-serve recovery, email verification, export, and deletion. Route
authorization and document/workspace capabilities live in
[../security/](../security/README.md); this document covers how a user becomes
and remains an authenticated account.

## Source Anchors

| Area                        | Source                                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Edge-safe route gate        | [`src/auth.config.ts`](../../src/auth.config.ts), [`src/proxy.ts`](../../src/proxy.ts)                                                             |
| Node Auth.js runtime        | [`src/auth.ts`](../../src/auth.ts), [`src/app/api/auth/[...nextauth]/route.ts`](../../src/app/api/auth/%5B...nextauth%5D/route.ts)                 |
| Credentials auth            | [`src/lib/auth/credentials-service.ts`](../../src/lib/auth/credentials-service.ts)                                                                 |
| OAuth local account linking | [`src/lib/auth/oauth-user-service.ts`](../../src/lib/auth/oauth-user-service.ts)                                                                   |
| Password reset              | [`src/lib/auth/password-reset-service.ts`](../../src/lib/auth/password-reset-service.ts)                                                           |
| Email verification          | [`src/lib/auth/email-verification-service.ts`](../../src/lib/auth/email-verification-service.ts)                                                   |
| Single-use token primitive  | [`src/lib/auth/single-use-token.ts`](../../src/lib/auth/single-use-token.ts)                                                                       |
| Account settings model      | [`src/lib/settings/view-model.ts`](../../src/lib/settings/view-model.ts)                                                                           |
| Account export/deletion     | [`src/lib/account/export.ts`](../../src/lib/account/export.ts), [`src/lib/account/deletion-service.ts`](../../src/lib/account/deletion-service.ts) |

## Runtime Split

Authentication has two runtime layers:

1. `src/auth.config.ts` is Edge-safe. It owns the JWT session strategy, the
   sign-in page path, and route access decisions used by the proxy. It must not
   import Prisma, bcrypt, Node crypto, or provider implementations that cannot
   run on the Edge runtime.
2. `src/auth.ts` is Node-runtime Auth.js configuration. It adds the Credentials
   provider, optional Google provider, Prisma-backed callbacks, password
   hashing, and local user linking.

The session callback stores the database user id on `session.user.id` and the
user's credential-rotation stamp on `session.user.sessionInvalidatedAt`. Route
authorization uses only the presence of an authenticated user at the proxy
layer; document/workspace authorization is resolved later by the security
helpers.

## Account Creation And Sign-In

Credentials registration normalizes and validates email/password input, rejects
duplicate emails, stores a bcrypt password hash, creates the user, and seeds the
sample onboarding document. Credentials sign-in returns a minimal user record
only when the submitted password matches the stored hash.

Google sign-in is enabled only when both Google client env vars are present.
OAuth sign-ins must include an email. The JWT callback links the OAuth profile
to a local user by normalized email, updating name/image on existing accounts or
creating a new local account and seeding onboarding content for first-time
users.

## Recovery And Verification Tokens

Password reset and email verification share the same token model:

- raw tokens are generated with 256 bits of entropy and sent only in email;
- only a SHA-256 hash is stored in the database;
- tokens are valid only while `usedAt` is null and `now < expiresAt`;
- consuming a token is transactional and stamps `usedAt`;
- successful consumption invalidates the user's other outstanding tokens of the
  same kind.

Password reset deliberately returns the same success message whether or not an
email exists. Email verification requests keep previously delivered, unconsumed
verification tokens active when issuing a new link, so concurrent verification
emails remain valid until they are consumed or expire. Each token is still
single-use: consuming one verification token marks it used, verifies the email,
and invalidates that user's other outstanding verification tokens.

## JWT Session Revocation

Auth.js uses JWT sessions, so the Edge proxy can verify only the signed cookie
and route policy without importing Prisma. Durable revocation is enforced in the
Node runtime: credentials sign-in and OAuth linking copy `User.sessionInvalidatedAt`
into the JWT/session, while `getCurrentUser` and `requireUser` compare that
issued stamp with the current database value. Missing users or stale stamps are
treated as invalid sessions; page/server-action gates redirect stale sessions to
`/signout`, and API helpers receive `null` from `getCurrentUser`.

Credential rotations bump the stamp for password changes and successful
password resets. Account deletion stamps the user after confirmation and before
erasure/sign-out, so other active JWTs stop passing Node-runtime validation even
before the user row is removed.

## Settings, Export, And Deletion

The settings account view model exposes profile defaults, email verification
state, password state, connected account labels, and stable links to account
export, billing, and documents.

Account deletion requires confirmation by email or the `DELETE` keyword. Before
erasure, the deletion service attempts immediate subscription cancellation when
the billing state requires it. Erasure then removes personal data and verifies
that no personal-data findings remain. Operational DSAR steps live in
[../operations/privacy-dsar-runbook.md](../operations/privacy-dsar-runbook.md).

## Invariants

1. Edge auth config stays free of Node-only dependencies.
2. The database user id is the session identity used by app code.
3. OAuth accounts are linked by normalized email, not by a separate provider row.
4. Raw reset and verification tokens are never persisted.
5. Password-reset requests do not disclose whether an email is registered.
6. Credential rotation invalidates JWT sessions issued before the current
   `User.sessionInvalidatedAt` stamp.
7. Account deletion verifies erasure before returning success.

## Primary Tests

- [`src/auth.config.test.ts`](../../src/auth.config.test.ts)
- [`src/lib/auth/credentials-service.test.ts`](../../src/lib/auth/credentials-service.test.ts)
- [`src/lib/auth/oauth-user-service.test.ts`](../../src/lib/auth/oauth-user-service.test.ts)
- [`src/lib/auth/password-reset-service.test.ts`](../../src/lib/auth/password-reset-service.test.ts)
- [`src/lib/auth/session-security.test.ts`](../../src/lib/auth/session-security.test.ts)
- [`src/lib/auth/email-verification-service.test.ts`](../../src/lib/auth/email-verification-service.test.ts)
- [`src/lib/auth/single-use-token.test.ts`](../../src/lib/auth/single-use-token.test.ts)
- [`src/lib/settings/view-model.test.ts`](../../src/lib/settings/view-model.test.ts)
- [`src/lib/account/export.test.ts`](../../src/lib/account/export.test.ts)
- [`src/lib/account/deletion-service.test.ts`](../../src/lib/account/deletion-service.test.ts)
- [`e2e/ui-matrix/account-lifecycle-ui.spec.ts`](../../e2e/ui-matrix/account-lifecycle-ui.spec.ts)
