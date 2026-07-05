---
type: "reference"
status: "current"
last_updated: "2026-07-04"
description: "Classifies non-API app routes and proxy exclusions, documents access-surface ownership, route classification, and page-route manifest governance."
---

# Page Route Access Surface

**Epic:** #983 — HTTP Route, Access Surface, and Next Build Constraint Governance  
**Issues:** #986, #987

Enforced by `src/lib/auth/page-route-access-manifest.test.ts`.

This manifest classifies non-API app routes and proxy exclusions. The typed
source of truth is `src/lib/auth/page-route-access-manifest.ts`; the proxy matcher
in `src/proxy.ts` stays a literal because Next.js requires build-time static
analysis.

| Surface                                             | Classification          | Proxy    | Owner         | Notes                                                                       |
| --------------------------------------------------- | ----------------------- | -------- | ------------- | --------------------------------------------------------------------------- |
| `/`, `/visuals`                                     | `public`                | matched  | Growth        | Public marketing/example pages.                                             |
| `/login`, `/signup`                                 | `auth-page`             | matched  | Platform/Auth | Signed-in users redirect to `/app`.                                         |
| `/forgot-password`                                  | `auth-page`             | matched  | Platform/Auth | Public password-reset request form.                                         |
| `/reset-password`                                   | `auth-page`             | matched  | Platform/Auth | Token-gated password reset form.                                            |
| `/verify-email/*`                                   | `auth-page`             | matched  | Platform/Auth | Token-gated email verification route.                                       |
| `/signout`                                          | `auth-page`             | matched  | Platform/Auth | Route handler signs out and redirects.                                      |
| `/share/*`, `/embed/*`                              | `share-policy`          | matched  | Presentation  | Public render resolver enforces policy, including optional passcode unlock. |
| `/present/*`                                        | `share-policy`          | matched  | Presentation  | Present/embed viewers use share policy, including optional passcode unlock. |
| `/app/*`                                            | `authenticated-session` | matched  | Product       | App shell, documents, workspaces, settings.                                 |
| `/api/*`                                            | `api-excluded`          | excluded | Platform      | Governed by the API route matrix.                                           |
| `/_next/static/*`, `/_next/image/*`, `/favicon.ico` | `public-asset`          | excluded | Platform      | Next/browser public assets.                                                 |

## Related

- API route matrix: [api-route-security-matrix.md](api-route-security-matrix.md).
- Proxy policy: `src/lib/auth/route-protection-policy.ts`.
