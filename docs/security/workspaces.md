---
type: "contract"
status: "current"
last_updated: "2026-07-31"
description: "This document describes canonical workspace role/capability policy, ownership, membership, invite links, and how workspace roles feed document permissions."
---

# Workspaces And Membership

This document describes workspace ownership, membership, invite links, and the
canonical workspace role/capability policy shared by server authorization,
workspace UI helpers, and join/detail integrity-safe states.

## Source Files

| Area                              | Source                                                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Workspace list/create actions     | [`src/app/app/workspaces/actions.ts`](../../src/app/app/workspaces/actions.ts)                                         |
| Workspace detail actions          | [`src/app/app/workspaces/[id]/actions.ts`](../../src/app/app/workspaces/%5Bid%5D/actions.ts)                           |
| Workspace role helpers            | [`src/lib/workspace/roles.ts`](../../src/lib/workspace/roles.ts)                                                       |
| Workspace service helpers         | [`src/lib/workspace/service.ts`](../../src/lib/workspace/service.ts)                                                   |
| Ownership transfer types          | [`src/lib/workspace/ownership-transfer-types.ts`](../../src/lib/workspace/ownership-transfer-types.ts)                 |
| Workspace membership capabilities | [`src/lib/workspace/capabilities.ts`](../../src/lib/workspace/capabilities.ts)                                         |
| Invite link service               | [`src/lib/workspace/invite-service.ts`](../../src/lib/workspace/invite-service.ts)                                     |
| Invite link types                 | [`src/lib/workspace/invite-types.ts`](../../src/lib/workspace/invite-types.ts)                                         |
| Workspace document types          | [`src/lib/workspace/document-types.ts`](../../src/lib/workspace/document-types.ts)                                     |
| Workspace capability helpers      | [`src/lib/auth/workspace-capabilities.ts`](../../src/lib/auth/workspace-capabilities.ts)                               |
| Document permissions              | [`src/lib/auth/document-permissions.ts`](../../src/lib/auth/document-permissions.ts)                                   |
| Invite UI                         | [`src/app/app/workspaces/[id]/invite-link-manager.tsx`](../../src/app/app/workspaces/%5Bid%5D/invite-link-manager.tsx) |
| Members UI                        | [`src/app/app/workspaces/[id]/members-list.tsx`](../../src/app/app/workspaces/%5Bid%5D/members-list.tsx)               |
| Workspace document UI             | [`src/app/app/workspaces/[id]/workspace-documents.tsx`](../../src/app/app/workspaces/%5Bid%5D/workspace-documents.tsx) |
| Shared template picker            | [`src/components/template-picker-dialog.tsx`](../../src/components/template-picker-dialog.tsx)                         |

## Role Model

Workspace role handling is strict and split into two layers:

1. **Persisted membership role** (`WorkspaceMember.role`): exactly `EDITOR` or
   `VIEWER`.
2. **Effective workspace role**: `owner`, `editor`, or `viewer`.
   - `owner` is derived only from `Workspace.ownerId`.
   - `editor`/`viewer` come from the canonical
     `persistedMemberRoleToEffectiveRole` converter.

Persisted `OWNER` membership rows and malformed role strings are explicit
data-integrity failures. They are never normalized to viewer and never treated
as owner.

The Prisma schema keeps role columns as `String` for SQLite/Postgres parity in
this repository; enforcement is done by strict runtime parsing plus schema
audit (`npm run audit:schema -- --ci`) rather than destructive coercion.

## Workspace Capabilities

Workspace server actions use `requireWorkspaceCapability`, and workspace UI
helpers use the same pure policy from `src/lib/workspace/capabilities.ts`
(`capabilitiesForWorkspaceAccessRole` + `workspaceRoleCan`).

| Capability | Required role       |
| ---------- | ------------------- |
| `view`     | owner/editor/viewer |
| `mutate`   | owner/editor        |
| `manage`   | owner               |

Owner-only operations include invite creation/revocation, member removal,
workspace rename, and workspace deletion.

Workspace document creation and import require `mutate`: owners and editors see
the actions, while viewers see neither. Template creation uses the shared
dashboard/workspace picker, which suppresses same-event duplicate creates,
keeps pending actions and dismissal locked, contains ordinary failures in an
inline retry/dismiss alert, and preserves Next redirect control flow. The
picker invalidates late UI work after unmount. Workspace document state is
owned by `workspaceId`, so switching workspaces resets loading, creation, and
import state; an old workspace's late list or create result cannot populate or
lock the new workspace surface. The server-side
`createWorkspaceDocumentForUser` capability check remains authoritative even
when the client action is hidden.

Member removal, ownership transfer, rename, delete, and leave actions also use
one synchronous mutation boundary per surface. Their client state is owned by
the workspace ID: switching workspaces resets open confirmations, drafts,
errors, and pending state. A completion from the old workspace cannot close a
new dialog, show recovery there, or invoke its success reload callback. Next
redirect/not-found control flow still propagates to the framework.

The workspace detail action module remains the adapter layer: it resolves the
session, performs the capability check, and revalidates or redirects. Invite
creation, revocation, and acceptance live in
`src/lib/workspace/invite-service.ts`. Member removal plus document handoff,
rename normalization, and delete orchestration live in
`src/lib/workspace/service.ts`.

## Invite Links

Invite links are created with:

- target role (`EDITOR` or `VIEWER`);
- optional expiry in days;
- optional maximum use count;
- server-generated token.

Create and revoke actions share one synchronous mutation boundary, so repeated
or competing activation cannot issue multiple durable writes. Invite manager
state is owned by `workspaceId`: switching workspaces resets links, dialogs,
copy feedback, and pending state from the new server props. Late create, revoke,
or clipboard results from an unmounted workspace cannot update the replacement
surface or keep its controls locked.

The invite manager serializes create and revoke mutations behind a synchronous
in-flight guard, so repeated activation cannot create duplicate links or issue
duplicate revocations. Controls expose pending state and remain locked until the
active mutation settles. Ordinary action failures are redacted into generic
retry/dismiss feedback, while Next redirect/not-found control flow remains
authoritative. Revocation requires a focus-restoring confirmation dialog; a
failed revoke remains in the dialog for retry and pending confirmation cannot
be dismissed.

Invite URLs have an explicit copy control while retaining click-to-select/copy
on the read-only field. Clipboard success is announced through a polite status;
clipboard rejection stays inline with generic retry/dismiss recovery instead of
escaping as an unhandled promise. Maximum-use input is validated locally as a
positive integer before the server action, and the service remains the
authoritative validator.

Expiry and max-use values are validated server-side. Links can be revoked.
Expiry windows and max-use caps are normalized by service helpers so creation and
tests use the same bounds.

Invite acceptance is transactional and uses the persisted invite row as the only
grant source (`workspaceId`, role, revocation, expiry, and usage cap). The join
page may render preview state from a read, but the mutation re-reads and
re-evaluates policy before writing.

In one transaction, acceptance checks owner/membership, consumes capacity with a
CAS update, creates membership, and appends the invite-use audit row. Any deny
path (revoked/expired/exhausted/invalid-role/owner/member) exits without member
creation or invite-use audit writes. Invalid persisted invite roles are denied
explicitly; they are never coerced to viewer for acceptance. If a user already
has a malformed membership row (including persisted `OWNER`), join preview
renders a stable integrity-invalid state and does not attempt acceptance.

The membership replay classifier is provider-neutral but narrow by design:
`P2002` maps to `already-member` only when the unique target resolves to the
workspace-member composite (`workspaceId` + `userId`) or canonical constraint
name (`WorkspaceMember_workspaceId_userId_key`). Other `P2002` errors rethrow.
Current test evidence is real SQLite/Prisma only (success path, cap-exhausted
second accept, downstream rollback, and composite-unique classification). We do
not claim Postgres concurrency execution in this suite.

The deterministic browser lifecycle exercises the rendered invite controls with
accessible role/link labels, forces create/revoke transport failures, verifies
retry duplicate suppression and copy feedback, verifies revoked-link denial
before accepting active viewer and editor invites, and confirms the persisted
use count after a limited invite is consumed.

## Member Removal And Workspace Deletion

Removing a member does not transfer their authored documents to the workspace
owner. Documents authored by the removed member inside the workspace are moved
back to that user's personal space (`workspaceId = null`).

Workspace mutation controls use a synchronous in-flight guard so rename,
remove, transfer, leave, and delete activations cannot issue duplicate durable
mutations before React commits pending state. Member removal, ownership
transfer, leave, and delete require focus-restoring confirmation dialogs. While
a destructive mutation is pending, its dialog cannot be cancelled or dismissed.
Ordinary failures stay in context with generic redacted retry/dismiss feedback;
Next redirect/not-found control flow is rethrown to the framework.

Deleting a workspace also preserves documents by moving every attached document
back to its author's personal space before deleting the workspace.

Ownership transfer is transactional. The mutation re-reads `Workspace.ownerId`
and the target membership row inside one transaction, claims the owner swap
through a CAS update (`where: { id, ownerId: actorUserId }`), removes only the
winning target membership row, and demotes the prior owner to `EDITOR`. If the
actor is stale or the target membership disappears, the transaction aborts and
rolls back all transfer-side writes.

## Relationship To Document Permissions

Document capability resolution considers both document ownership and workspace
membership:

- document owner is always document `owner`;
- workspace owner is document `owner` for documents in that workspace;
- `EDITOR` member maps to document `editor`;
- `VIEWER` member maps to document `viewer`.

See [access-and-sharing.md](access-and-sharing.md) for document capability
semantics.

## Invariants

1. Workspace management actions require `manage` capability.
2. Invite roles are validated server-side, and acceptance denies invalid
   persisted invite roles explicitly.
3. Removing a member preserves their authored documents.
4. Deleting a workspace does not delete documents.
5. Workspace membership feeds document permission derivation.
6. Invite acceptance mutation never trusts join-page preview grant facts.
7. Invite denials perform no membership/audit writes.
8. Ownership transfer uses transactional owner CAS; stale-owner conflicts do not
   partially apply membership writes.
9. Leaving a workspace is `ownerId`/membership-existence gated and role-value
   independent. Non-owner malformed/`OWNER` membership rows can still leave for
   cleanup; leaving removes only membership and preserves document ownership.
10. Persisted workspace role drift (`OWNER`/malformed values) is blocked by
    runtime strict parsing and detected by the schema-audit gate
    (`npm run audit:schema -- --ci`).
11. Join/detail surfaces never coerce invalid role rows; they render explicit
    integrity-invalid states with no view/mutate/manage grant.
12. Remediation of malformed role rows follows
    [workspace-role-remediation-plan.md](workspace-role-remediation-plan.md)
    with explicit operator choice and no destructive default mapping.
13. Client mutation guards and disabled state improve interaction durability;
    server actions remain authoritative for authorization and persistence.

## Primary Tests

- [`src/lib/workspace/service.test.ts`](../../src/lib/workspace/service.test.ts)
- [`src/lib/workspace/capabilities.test.ts`](../../src/lib/workspace/capabilities.test.ts)
- [`src/lib/workspace/invite-service.test.ts`](../../src/lib/workspace/invite-service.test.ts)
- [`src/lib/auth/workspace-capabilities.test.ts`](../../src/lib/auth/workspace-capabilities.test.ts)
- [`src/lib/auth/document-permissions.test.ts`](../../src/lib/auth/document-permissions.test.ts)
- [`e2e/import/import-roundtrip.spec.ts`](../../e2e/import/import-roundtrip.spec.ts)
- [`e2e/documents/template-creation.spec.ts`](../../e2e/documents/template-creation.spec.ts)
- [`e2e/ui-matrix/document-editor-ui.spec.ts`](../../e2e/ui-matrix/document-editor-ui.spec.ts)
- [`e2e/ui-matrix/workspace-lifecycle-ui.spec.ts`](../../e2e/ui-matrix/workspace-lifecycle-ui.spec.ts)
- [`e2e/ui-matrix/workspace-billing-brand-ui.spec.ts`](../../e2e/ui-matrix/workspace-billing-brand-ui.spec.ts)
