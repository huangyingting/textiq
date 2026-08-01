---
type: "architecture"
status: "current"
last_updated: "2026-08-01"
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
| Password reset UI           | [`src/app/reset-password/reset-password-form.tsx`](../../src/app/reset-password/reset-password-form.tsx)                                           |
| Email verification          | [`src/lib/auth/email-verification-service.ts`](../../src/lib/auth/email-verification-service.ts)                                                   |
| Auth email delivery         | [`src/lib/auth/email.ts`](../../src/lib/auth/email.ts), [`src/lib/auth/auth-email-runtime.ts`](../../src/lib/auth/auth-email-runtime.ts)           |
| Single-use token primitive  | [`src/lib/auth/single-use-token.ts`](../../src/lib/auth/single-use-token.ts)                                                                       |
| Form operation ownership    | [`src/lib/actions/use-owned-form-action.ts`](../../src/lib/actions/use-owned-form-action.ts)                                                       |
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

The login and registration forms claim dispatch synchronously so repeated
same-event activation cannot queue duplicate authentication or account-creation
requests. While either operation is pending, all identity and credential fields
are locked. Ordinary failures release ownership for a corrected retry, and the
validated callback target owns the client action state: changing destinations
remounts the form and prevents feedback from the old request from surfacing.

The deterministic browser profile exercises this lifecycle end to end: it
creates a new account through the public form, verifies automatic sign-in and
first-run content, recovers a forced onboarding-dismissal transport failure,
persists the retry, deletes the account through settings, and confirms that the
deleted credentials no longer authenticate.
The seed removes that exact fixture email before each run so an interrupted
browser session cannot contaminate later runs.

Onboarding dismissal uses a synchronous in-flight guard so repeated header or
footer activation persists once. Ordinary failures remain in the checklist as
generic retry/dismiss feedback; successful dismissal removes the checklist
immediately and emits completion telemetry only after persistence. Next
redirect/not-found control flow is not converted into a local error. Unmounting
the dashboard invalidates an in-flight dismissal, so its late completion cannot
update detached UI or emit a misleading dismissal event.

Google sign-in is enabled only when both Google client env vars are present.
The OAuth form claims submission synchronously, disables its control, and
exposes busy state while the provider handoff is pending, so rapid repeated
activation cannot start competing redirects.
OAuth sign-ins must include an email. The JWT callback links the OAuth profile
to a local user by normalized email, updating name/image on existing accounts or
creating a new local account and seeding onboarding content for first-time
users. Callback targets pass through the same-origin callback validator. Next.js
redirect and not-found control flow is preserved through the structured
framework rethrow API; ordinary provider failures redirect to generic local
feedback without exposing provider details.

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

Authentication email delivery uses the shared `AuthEmailDeliveryPort` seam.
Development defaults to a console adapter that prints `DEV ONLY` links.
Production requires `AUTH_EMAIL_DELIVERY=resend`, a valid `AUTH_EMAIL_FROM`, a
`RESEND_API_KEY`, and a canonical HTTPS `NEXT_PUBLIC_APP_URL`; invalid or partial
configuration fails closed and makes application readiness return 503. The
Resend adapter sends minimal text and HTML bodies through the provider's HTTPS
endpoint, escapes action URLs in HTML, never reads provider error bodies, and
aborts delivery after ten seconds. Provider details, recipients, and raw-token
links are never returned through delivery errors or public health responses.

Reset-password submission is synchronously single-flight, so a repeated
same-event activation cannot queue a second consume that overwrites success
with an already-used error. Its client action state is owned by the raw reset
token: switching tokens remounts the form, unlocks the replacement request, and
prevents the old token's late result from changing it. Recovery email and
password fields remain locked while their requests are pending.

Form actions with side effects use a shared synchronous ownership boundary in
addition to rendered pending state. Password-reset requests preserve their
terminal anti-enumeration confirmation after one delivery. Email-verification
requests suppress accidental same-event duplicate delivery but release after
settlement for a deliberate resend. Profile saves likewise collapse same-event
duplicates while remaining available for later edits. Server validation, abuse
budgets, and token rules remain authoritative.

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
before the user row is removed. A successful settings password change also
signs out the current browser immediately and returns it to login with an
explicit confirmation; this avoids leaving stale authenticated chrome visible
after the current JWT has been revoked.

The settings password form locks all secret fields while rotation is pending
and synchronously suppresses repeated dispatch. Ordinary errors release the
boundary for a corrected retry; success clears the submitted secrets and stays
terminally owned through the expected sign-out navigation.

## Settings, Export, And Deletion

The settings account view model exposes profile defaults, email verification
state, password state, connected account labels, and stable links to account
export, billing, and documents. The profile display-name field remains locked
while a save is pending so the visible value continues to match the owned
request. Its browser constraint and server normalization use the same
browser-safe display-name limit. Settings password fields likewise expose the
shared password minimum, early input cap, and required-field constraints before
submission. Server validation rejects passwords beyond bcrypt's 72-byte UTF-8
boundary so distinct credentials cannot collapse through bcrypt truncation.

The deterministic account browser lifecycle uses an isolated resettable user to
prove display-name persistence in both the form and app shell, password
rotation, old-password rejection, explicit re-login, and restoration of the
original credential without contaminating the shared owner fixture.

Account deletion requires confirmation by email or the `DELETE` keyword. Before
erasure, the deletion service attempts immediate subscription cancellation when
the billing state requires it. Erasure then removes personal data and verifies
that no personal-data findings remain. Operational DSAR steps live in
[../operations/privacy-dsar-runbook.md](../operations/privacy-dsar-runbook.md).

The deletion confirmation claims form dispatch synchronously, so repeated
same-event submission cannot queue multiple destructive actions and a
same-turn Escape/backdrop request cannot hide the owned operation. While
pending, the trigger, confirmation field, Cancel, and Confirm controls are
locked and the modal exposes busy state. An ordinary failure stays in the same
dialog and releases the boundary for retry; a successful fallback result stays
terminally locked until the sign-out navigation unmounts the surface.

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
- [`src/app/login/login-form.test.tsx`](../../src/app/login/login-form.test.tsx)
- [`src/app/signup/signup-form.test.tsx`](../../src/app/signup/signup-form.test.tsx)
- [`src/app/reset-password/reset-password-form.test.tsx`](../../src/app/reset-password/reset-password-form.test.tsx)
- [`src/app/forgot-password/forgot-password-form.test.tsx`](../../src/app/forgot-password/forgot-password-form.test.tsx)
- [`src/app/app/settings/email-verification-form.test.tsx`](../../src/app/app/settings/email-verification-form.test.tsx)
- [`src/app/app/settings/profile-form.test.tsx`](../../src/app/app/settings/profile-form.test.tsx)
- [`src/app/app/settings/password-form.test.tsx`](../../src/app/app/settings/password-form.test.tsx)
- [`src/lib/auth/session-security.test.ts`](../../src/lib/auth/session-security.test.ts)
- [`src/lib/auth/email-verification-service.test.ts`](../../src/lib/auth/email-verification-service.test.ts)
- [`src/lib/auth/single-use-token.test.ts`](../../src/lib/auth/single-use-token.test.ts)
- [`src/lib/settings/view-model.test.ts`](../../src/lib/settings/view-model.test.ts)
- [`src/app/app/onboarding-checklist.test.tsx`](../../src/app/app/onboarding-checklist.test.tsx)
- [`src/lib/account/export.test.ts`](../../src/lib/account/export.test.ts)
- [`src/lib/account/deletion-service.test.ts`](../../src/lib/account/deletion-service.test.ts)
- [`src/app/app/settings/delete-account-form.test.tsx`](../../src/app/app/settings/delete-account-form.test.tsx)
- [`e2e/ui-matrix/account-lifecycle-ui.spec.ts`](../../e2e/ui-matrix/account-lifecycle-ui.spec.ts)
