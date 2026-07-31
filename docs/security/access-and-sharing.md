---
type: "contract"
status: "current"
last_updated: "2026-07-31"
description: "This document defines document-level access control and public share behavior. It covers authenticated app permissions, public share/embed/present routes, and collaboration upgrade authorization."
---

# Access Control And Public Sharing

This document defines document-level access control and public share behavior.
It covers authenticated app permissions, public share/embed/present routes, and
collaboration upgrade authorization.

## Source Files

| Area                   | Source                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| Access taxonomy        | [`src/lib/access-policy/taxonomy.ts`](../../src/lib/access-policy/taxonomy.ts)                         |
| Access adapters        | [`src/lib/access-policy/adapters.ts`](../../src/lib/access-policy/adapters.ts)                         |
| Document capabilities  | [`src/lib/auth/document-permissions.ts`](../../src/lib/auth/document-permissions.ts)                   |
| Workspace role policy  | [`src/lib/workspace/roles.ts`](../../src/lib/workspace/roles.ts)                                       |
| Share access policy    | [`src/lib/share-access.ts`](../../src/lib/share-access.ts)                                             |
| Share route            | [`src/app/share/[shareId]/page.tsx`](../../src/app/share/%5BshareId%5D/page.tsx)                       |
| Embed route            | [`src/app/embed/[shareId]/page.tsx`](../../src/app/embed/%5BshareId%5D/page.tsx)                       |
| Present route          | [`src/app/present/[shareId]/page.tsx`](../../src/app/present/%5BshareId%5D/page.tsx)                   |
| Present embed route    | [`src/app/present/[shareId]/embed/page.tsx`](../../src/app/present/%5BshareId%5D/embed/page.tsx)       |
| Passcode unlock route  | [`src/app/api/share-passcode/unlock/route.ts`](../../src/app/api/share-passcode/unlock/route.ts)       |
| Collab authorize route | [`src/app/api/collab/authorize/route.ts`](../../src/app/api/collab/authorize/route.ts)                 |
| Share actions          | [`src/app/app/documents/[id]/actions.ts`](../../src/app/app/documents/%5Bid%5D/actions.ts)             |
| Share dialog           | [`src/app/app/documents/[id]/share-button.tsx`](../../src/app/app/documents/%5Bid%5D/share-button.tsx) |
| Social intents         | [`src/lib/share/social-intents.ts`](../../src/lib/share/social-intents.ts)                             |

## Authenticated Document Roles

`deriveDocumentRole` resolves a user's effective role for one document from:

1. document ownership;
2. workspace ownership;
3. workspace membership role.

| Role     | Source                             | Capabilities       |
| -------- | ---------------------------------- | ------------------ |
| `owner`  | Document owner or workspace owner. | view, edit, manage |
| `editor` | `EDITOR` workspace member.         | view, edit         |
| `viewer` | `VIEWER` workspace member.         | view               |
| `none`   | No relationship.                   | none               |

Persisted `OWNER`/malformed membership roles are explicit data-integrity
failures; they are never coerced into a least-privilege role.

Workspace role conversion (`EDITOR`/`VIEWER` → `editor`/`viewer`) and workspace
capability checks come from one canonical policy reused by server authorization
and workspace UI surfaces.

Capabilities are intentionally coarse:

- `view`: read the document, comment, duplicate, join read-only collab;
- `edit`: mutate title/body/deck/tags/favorite and upload slide assets;
- `manage`: share settings, delete, restore, invite/member administration.

Server actions call `requireDocumentCapability(userId, documentId,
capability)`. A user with no view access receives a not-found style error so the
action does not reveal private document existence.

Document, workspace, share, invite, slide-asset, and collab helpers map their
domain-specific outcomes to the shared access taxonomy:

- subject: anonymous or authenticated user;
- resource: document, workspace, share, invite, slide asset, or collab room;
- capability/mode: view, edit, manage, mutate, embed, present, accept, serve,
  or connect;
- denial reason: unauthenticated, privacy not-found or deleted resource,
  insufficient capability, share not enabled or revoked, expired link, mode
  disabled, passcode required, invite revoked or exhausted, invalid role, asset
  not found, or forbidden.

Adapters convert that shared decision into server-action errors, API responses,
`notFound()`, and safe diagnostics. The adapters preserve the status selected by
the domain policy; they must not turn a privacy not-found into a forbidden
response that would reveal resource existence.

## Public Share Access

Public routes do not use workspace membership. They evaluate a pure share policy
from `src/lib/share-access.ts`.

The route supplies a `toShareAccessInput()` projection:

- requested `shareId` from the URL segment;
- stored `Document.shareId` as `shareId`;
- `Document.isShared` as `isShared`;
- `Document.deletedAt` as `deletedAt`;
- `Document.shareExpiresAt` as `expiresAt`;
- `Document.shareEmbedEnabled` as `embedEnabled`;
- `Document.sharePresentEnabled` as `presentEnabled`;
- `Document.sharePasscodeHash` as `passcodeHash`;
- request unlock state as `passcodeUnlocked`;
- requested mode: `view`, `embed`, or `present`.

The request is denied when the document is not shared, the requested id no
longer matches, the document is deleted, the link is expired, or the requested
mode is disabled. If the link has a passcode hash and the request has not been
unlocked, valid public routes render a passcode challenge instead of document
content; invalid, expired, deleted, revoked, or mode-disabled links still use the
privacy-preserving 404 path.

| Route                      | Mode      | Output                                 |
| -------------------------- | --------- | -------------------------------------- |
| `/share/[shareId]`         | `view`    | Read-only Lexical document.            |
| `/embed/[shareId]`         | `embed`   | Embeddable read-only document surface. |
| `/present/[shareId]`       | `present` | Public presentation viewer.            |
| `/present/[shareId]/embed` | `embed`   | Embeddable public presentation viewer. |

`/present/[shareId]/embed` still renders the presentation projection, but access
is evaluated in embed mode (`shareEmbedEnabled`).

Denied page requests become `notFound()` and render generic visible fallback text
(`404` / `Page not found`) with a real 404 status. Private titles or content must
not leak through the fallback body or metadata; denied metadata remains
no-indexed.

The Open Graph image route uses the same share-access mapping. It preserves the
existing safe fallback card for denied/unknown links instead of rendering private
document content.

Passcode unlocks are stored as signed, HTTP-only cookies scoped by the current
`shareId` and `sharePasscodeHash`. Regenerating a share link changes the share id,
and changing/removing the passcode changes the hash state, so prior unlock cookies
stop authorizing both pages and share-bound slide assets.

The unlock POST endpoint reads bounded `FormData` fields: `shareId`, `mode`,
`returnTo`, and `passcode`. Malformed or oversize form submissions return
`400`/`413` before abuse-budget checks or document lookup. Once a normalized
`shareId` is present, the public share passcode abuse budget is checked before
the document row is loaded and the submitted `passcode` field is verified.

## Read-List Scoping

`documentAccessOr(userId)` is a read-only list/search scope: it selects documents
owned by the user or visible through workspace membership. It is not a write
authorization primitive. Write paths use `requireDocumentCapability` or
`requireWorkspaceCapability` so the role-derived capability check decides the
mutation.

## Share Link Lifecycle

Share actions live in the document server actions module.

| Action                  | Effect                                                                     |
| ----------------------- | -------------------------------------------------------------------------- |
| `toggleDocumentSharing` | Enables/disables sharing and creates a share id when needed.               |
| `regenerateShareLink`   | Rotates `shareId`; previous URLs stop resolving.                           |
| `updateSharePolicy`     | Updates expiry, embed/present enablement, metadata, and optional passcode. |

Public URLs may include a decorative slug, but the stable authorization key is
the `shareId` extracted from the segment.

The document share dialog keeps the complete policy reachable inside a
viewport-bounded scrolling panel. Only one policy mutation runs at a time so a
slower response cannot overwrite a newer local state, including repeated
activation before React commits its pending render. Passcode creation and
replacement require a non-empty value; clearing protection remains an explicit
separate action. Typed action failures and transport failures remain in the
dialog as accessible, dismissible alerts. Next.js redirect and not-found control
flow is rethrown instead of being converted into generic transport feedback.

Clipboard actions report pending work before announcing success, and failures
remain inline instead of claiming that content was copied. Social-platform
actions open only the public share URL in sized, opener-isolated popups using
`noopener,noreferrer`; they do not transmit document content directly.

The deterministic owner/public browser lifecycle starts from an isolated
private document, enables its link, persists metadata, discovery, expiry, and
mode policy, verifies public/embed/presentation clipboard payloads and isolated
social intents, verifies passcode failure and success, proves disabled public
modes return privacy-preserving 404s, rotates the URL, revokes the old URL,
disables sharing, and verifies the final state after reload.

## Collaboration Authorization

Collaboration websocket upgrades are authorized before the WebSocket handshake.
The authorize route maps document capability to collab behavior:

| Capability | Collab connection               |
| ---------- | ------------------------------- |
| none       | upgrade refused                 |
| `view`     | accepted read-only              |
| `edit`     | accepted with update permission |

The collab server also enforces read-only behavior by dropping update messages
from viewer connections.

## Invariants

1. All authenticated document actions resolve capabilities through the shared
   permission helper.
2. Public routes use the shared pure share policy.
3. Share metadata must not leak private document content when access is denied.
4. Regenerating a share link invalidates old URLs immediately.
5. Passcode-protected public links and slide assets require a valid unlock cookie.
6. Collaboration upgrades require authorization.
7. Read-list scopes are read-only; write paths use capability checks.
8. Invalid persisted workspace role rows render integrity-invalid join/detail
   states and never silently coerce to viewer.

## Primary Tests

- [`src/lib/auth/document-permissions.test.ts`](../../src/lib/auth/document-permissions.test.ts)
- [`src/lib/auth/authz-regression.test.ts`](../../src/lib/auth/authz-regression.test.ts)
- [`src/lib/auth/document-role-matrix.test.ts`](../../src/lib/auth/document-role-matrix.test.ts)
- [`src/lib/access-policy/adapters.test.ts`](../../src/lib/access-policy/adapters.test.ts)
- [`src/lib/share-access.test.ts`](../../src/lib/share-access.test.ts)
- [`src/lib/collab/room-access.test.ts`](../../src/lib/collab/room-access.test.ts)
- [`e2e/ui-matrix/document-editor-ui.spec.ts`](../../e2e/ui-matrix/document-editor-ui.spec.ts)
- [`e2e/ui-matrix/document-sharing-lifecycle-ui.spec.ts`](../../e2e/ui-matrix/document-sharing-lifecycle-ui.spec.ts)
- [`e2e/ui-matrix/public-render-ui.spec.ts`](../../e2e/ui-matrix/public-render-ui.spec.ts)
- [`e2e/public-render/share-fallback.spec.ts`](../../e2e/public-render/share-fallback.spec.ts)
