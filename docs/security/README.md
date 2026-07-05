---
type: "contract"
status: "current"
last_updated: "2026-07-04"
description: "Security docs cover authorization, public access, share-link behavior, and HTTP surface governance. They are the contract for routes and server actions that decide who may see or mutate a document."
---

# Security Docs

Security docs cover authorization, public access, share-link behavior, and HTTP
surface governance. They are the contract for routes and server actions that
decide who may see or mutate a document.

| Document                                                     | Type      | Scope                                                                                           |
| ------------------------------------------------------------ | --------- | ----------------------------------------------------------------------------------------------- |
| [access-and-sharing.md](access-and-sharing.md)               | Contract  | Document capabilities, workspace roles, public share/embed/present links, and route behavior.   |
| [workspaces.md](workspaces.md)                               | Contract  | Workspace roles, capabilities, invite links, member removal, and document handoff behavior.     |
| [api-route-security-matrix.md](api-route-security-matrix.md) | Reference | Authoritative classification of every `src/app/api/**/route.ts` route, enforced by guard tests. |
| [page-route-access-surface.md](page-route-access-surface.md) | Reference | Typed manifest for app/page surfaces, auth pages, share routes, and public proxy exclusions.    |
| [../../SECURITY.md](../../SECURITY.md)                       | Policy    | Repository-level vulnerability reporting, supported version scope, and response expectations.   |

## API Surface Governance

The HTTP attack surface is inventoried in the
[API route security matrix](api-route-security-matrix.md) (Epic #495), which
classifies every `src/app/api/**/route.ts` route, documents its denial
semantics, and is enforced by a guard test. Shared denial responses come from
`src/lib/access-policy/adapters.ts` and `src/lib/api/errors.ts`; abuse-control
diagnostics for the public expensive endpoints come from
`src/lib/diagnostics/api-abuse.ts`.

## Runtime Session Validation

The Edge proxy uses Auth.js JWT verification and route policy only. Server
components, actions, and API route helpers perform the durable database check:
stale JWTs whose credential-rotation stamp no longer matches the user row are
rejected, and page/action gates send them through `/signout` to clear cookies.

## Related

- Shared denial helper: `src/lib/api/errors.ts` (#511).
- Abuse-control diagnostics for public expensive endpoints:
  `src/lib/diagnostics/api-abuse.ts` (#512).
- [../auth/README.md](../auth/README.md) — sign-in, recovery, account settings,
  export, and deletion.
- [../data-model/visual-mirror.md](../data-model/visual-mirror.md) — projection
  public routes consume.
- [../public-render/README.md](../public-render/README.md) — public render
  resolver and metadata/asset access decisions.
- [../presentation/assets.md](../presentation/assets.md) — asset serving rules
  tied to shared documents.
- [../operations/release-gate.md](../operations/release-gate.md) — release
  readiness gate.
- [../operations/dependency-update-policy.md](../operations/dependency-update-policy.md) —
  Dependabot cadence and dependency review policy.
