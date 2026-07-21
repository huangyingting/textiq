---
type: "runbook"
status: "current"
last_updated: "2026-07-21"
description: "src/lib/privacy/personal-data-inventory.ts is the authoritative personal-data inventory. Its drift test compares every Prisma model field in prisma/schema.prisma to an explicit classification."
---

# Privacy DSAR Runbook

`src/lib/privacy/personal-data-inventory.ts` is the authoritative personal-data
inventory. Its drift test compares every Prisma model field in
`prisma/schema.prisma` to an explicit classification.

## Account export

`GET /api/account/export` returns export version 4. The JSON `manifest` lists
every export section required by the inventory:

- user profile
- documents, share policy, visuals, and versions
- owned workspaces and memberships
- authored comments and comment read state
- tags, brands, brand-kit drafts, and theme-package snapshots
- asset display metadata only, including owner-partitioned brand-staging assets
- active subscription
- invite-link uses without invite tokens
- usage ledger entries

Raw asset bytes are not embedded in the JSON export. The export includes
sanitized display metadata so a recipient can identify protected assets,
including active unlinked brand uploads staged under their owner partition,
without copying blobs into the DSAR artifact.

## Account erasure

Account deletion removes FK-owned rows and explicitly purges non-FK identifiers:
`InviteLinkUse.userId`, `UsageLedgerEntry.userId`, and `RateLimitHit.subject`.
Owned asset storage keys are deleted before database rows are removed. After the
delete, erasure verification counts every inventoried user identifier and fails
closed if any residual personal data remains.

For an operator dry run after deletion, use:

```bash
npm run account:erasure:dry-run -- <userId>
```

The command prints count-only JSON, exits `0` when no inventoried personal data
remains, and exits `2` when residual rows or asset references are found.

## Public share metadata

Public links default to `noindex,nofollow` and generic social metadata. Owners
can opt into search indexing and choose whether unfurls show only a generic
preview, the document title, or the title plus excerpt.
