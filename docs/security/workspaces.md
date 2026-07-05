---
type: "contract"
status: "current"
last_updated: "2026-06-25"
description: "This document describes workspace ownership, membership, invite links, and how workspace roles feed document permissions."
---

# Workspaces And Membership

This document describes workspace ownership, membership, invite links, and how
workspace roles feed document permissions.

## Source Files

| Area                          | Source                                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Workspace list/create actions | [`src/app/app/workspaces/actions.ts`](../../src/app/app/workspaces/actions.ts)                                         |
| Workspace detail actions      | [`src/app/app/workspaces/[id]/actions.ts`](../../src/app/app/workspaces/%5Bid%5D/actions.ts)                           |
| Workspace role helpers        | [`src/lib/workspace/roles.ts`](../../src/lib/workspace/roles.ts)                                                       |
| Workspace service helpers     | [`src/lib/workspace/service.ts`](../../src/lib/workspace/service.ts)                                                   |
| Workspace capability helpers  | [`src/lib/auth/workspace-capabilities.ts`](../../src/lib/auth/workspace-capabilities.ts)                               |
| Document permissions          | [`src/lib/auth/document-permissions.ts`](../../src/lib/auth/document-permissions.ts)                                   |
| Invite UI                     | [`src/app/app/workspaces/[id]/invite-link-manager.tsx`](../../src/app/app/workspaces/%5Bid%5D/invite-link-manager.tsx) |
| Members UI                    | [`src/app/app/workspaces/[id]/members-list.tsx`](../../src/app/app/workspaces/%5Bid%5D/members-list.tsx)               |

## Role Model

Workspace roles are normalized through `asWorkspaceRole`.

| Role     | Meaning                        |
| -------- | ------------------------------ |
| `OWNER`  | Workspace owner-level control. |
| `EDITOR` | Can edit workspace documents.  |
| `VIEWER` | Can view workspace documents.  |

Unknown role strings are coerced to the least-privilege viewer role when read.
Invite creation rejects non-invitable roles server-side.

## Workspace Capabilities

Workspace server actions use `requireWorkspaceCapability`.

| Capability | Required role       |
| ---------- | ------------------- |
| `view`     | owner/editor/viewer |
| `mutate`   | owner/editor        |
| `manage`   | owner               |

Owner-only operations include invite creation/revocation, member removal,
workspace rename, and workspace deletion.

The workspace detail action module remains the adapter layer: it resolves the
session, performs the capability check, and revalidates or redirects. Invite
creation/revocation, member removal plus document handoff, rename normalization,
and delete orchestration live in `src/lib/workspace/service.ts`.

## Invite Links

Invite links are created with:

- target role (`EDITOR` or `VIEWER`);
- optional expiry in days;
- optional maximum use count;
- server-generated token.

Expiry and max-use values are validated server-side. Links can be revoked.
Expiry windows and max-use caps are normalized by service helpers so creation and
tests use the same bounds.

## Member Removal And Workspace Deletion

Removing a member does not transfer their authored documents to the workspace
owner. Documents authored by the removed member inside the workspace are moved
back to that user's personal space (`workspaceId = null`).

Deleting a workspace also preserves documents by moving every attached document
back to its author's personal space before deleting the workspace.

## Relationship To Document Permissions

Document capability resolution considers both document ownership and workspace
membership:

- document owner is always document `owner`;
- workspace owner or `OWNER` member is document `owner` for documents in that
  workspace;
- `EDITOR` member maps to document `editor`;
- `VIEWER` member maps to document `viewer`.

See [access-and-sharing.md](access-and-sharing.md) for document capability
semantics.

## Invariants

1. Workspace management actions require `manage` capability.
2. Invite roles are validated server-side.
3. Removing a member preserves their authored documents.
4. Deleting a workspace does not delete documents.
5. Workspace membership feeds document permission derivation.

## Primary Tests

- [`src/lib/workspace/service.test.ts`](../../src/lib/workspace/service.test.ts)
- [`src/lib/auth/workspace-capabilities.test.ts`](../../src/lib/auth/workspace-capabilities.test.ts)
- [`src/lib/auth/document-permissions.test.ts`](../../src/lib/auth/document-permissions.test.ts)
- [`e2e/workspace/workspace.spec.ts`](../../e2e/workspace/workspace.spec.ts)
