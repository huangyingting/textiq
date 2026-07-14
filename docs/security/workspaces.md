---
type: "contract"
status: "current"
last_updated: "2026-07-14"
description: "This document describes canonical workspace role/capability policy, ownership, membership, invite links, and how workspace roles feed document permissions."
---

# Workspaces And Membership

This document describes workspace ownership, membership, invite links, and the
canonical workspace role/capability policy used by both server authorization
and workspace UI helpers.

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

## Role Model

Workspace role handling is strict and split into two layers:

1. **Persisted membership role** (`WorkspaceMember.role`): exactly `EDITOR` or
   `VIEWER`.
2. **Effective workspace role**: `owner`, `editor`, or `viewer`.
   - `owner` is derived only from `Workspace.ownerId`.
   - `editor`/`viewer` come from validated membership roles.

Persisted `OWNER` membership rows and malformed role strings are explicit
data-integrity failures. They are never normalized to viewer and never treated
as owner.

The Prisma schema keeps role columns as `String` for SQLite/Postgres parity in
this repository; enforcement is done by strict runtime parsing plus schema
audit (`npm run audit:schema -- --ci`) rather than destructive coercion.

## Workspace Capabilities

Workspace server actions use `requireWorkspaceCapability`, and workspace UI
helpers use the same pure map from `src/lib/workspace/capabilities.ts`.

| Capability | Required role       |
| ---------- | ------------------- |
| `view`     | owner/editor/viewer |
| `mutate`   | owner/editor        |
| `manage`   | owner               |

Owner-only operations include invite creation/revocation, member removal,
workspace rename, and workspace deletion.

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
explicitly; they are never coerced to viewer for acceptance.

The membership replay classifier is provider-neutral but narrow by design:
`P2002` maps to `already-member` only when the unique target resolves to the
workspace-member composite (`workspaceId` + `userId`) or canonical constraint
name (`WorkspaceMember_workspaceId_userId_key`). Other `P2002` errors rethrow.
Current test evidence is real SQLite/Prisma only (success path, cap-exhausted
second accept, downstream rollback, and composite-unique classification). We do
not claim Postgres concurrency execution in this suite.

## Member Removal And Workspace Deletion

Removing a member does not transfer their authored documents to the workspace
owner. Documents authored by the removed member inside the workspace are moved
back to that user's personal space (`workspaceId = null`).

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
9. Persisted workspace role drift (`OWNER`/malformed values) is blocked by
   runtime strict parsing and detected by the schema-audit gate
   (`npm run audit:schema -- --ci`).

## Primary Tests

- [`src/lib/workspace/service.test.ts`](../../src/lib/workspace/service.test.ts)
- [`src/lib/workspace/capabilities.test.ts`](../../src/lib/workspace/capabilities.test.ts)
- [`src/lib/workspace/invite-service.test.ts`](../../src/lib/workspace/invite-service.test.ts)
- [`src/lib/auth/workspace-capabilities.test.ts`](../../src/lib/auth/workspace-capabilities.test.ts)
- [`src/lib/auth/document-permissions.test.ts`](../../src/lib/auth/document-permissions.test.ts)
- [`e2e/workspace/workspace.spec.ts`](../../e2e/workspace/workspace.spec.ts)
