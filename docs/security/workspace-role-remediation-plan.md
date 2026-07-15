---
type: "plan"
status: "active"
last_updated: "2026-07-14"
description: "Operator runbook for remediating malformed workspace role rows without automatic coercion."
---

# Workspace Role Remediation Plan

## Scope

This runbook covers persisted role-integrity violations detected in:

- `WorkspaceMember.role`
- `InviteLink.role`
- `InviteLinkUse.role`

No automatic role coercion is allowed. In particular, never map malformed values
to `VIEWER` by default.

## Detection (Dry-Run First)

1. Run schema audit in dry-run mode:

   ```bash
   npm run audit:schema -- --json
   ```

2. Filter violations where:
   - `area` is one of the three workspace-role areas, and
   - `roleCode` is present (`owner-membership-row` or
     `invalid-workspace-member-role`).

3. Produce a remediation batch report grouped by workspace id and row id before
   any writes.

## Remediation Rules

### 1) Redundant OWNER Membership Rows

If `WorkspaceMember.role = OWNER` and `Workspace.ownerId` matches that row's
`userId`, delete the redundant membership row (owner is modeled by
`Workspace.ownerId`, not membership role).

### 2) Ambiguous Non-Owner Malformed Membership Rows

For non-owner rows with `OWNER` or malformed values:

- require explicit operator choice per row:
  - set to `EDITOR`,
  - set to `VIEWER`, or
  - delete membership row.
- record the chosen action and rationale.
- do not apply a global default.

### 3) Live Invite Rows (`InviteLink.role`)

For active invite links with invalid roles:

- either reclassify explicitly to `EDITOR`/`VIEWER`, or
- revoke the link.

Operator must choose per link; no default reclassification.

### 4) Historical Invite Usage (`InviteLinkUse.role`)

Treat as audit history:

- preserve row identity and timing;
- record corrected role classification in remediation logs/reporting;
- do not backfill with implicit defaults.

## Apply Logging Requirements

For each mutated row, log:

- table + row id
- workspace id (when available)
- prior role value
- resulting action/value
- operator identity
- timestamp
- reason / ticket reference

## Verification

After apply:

1. Re-run:

   ```bash
   npm run audit:schema -- --ci
   ```

2. Confirm zero role violations in the three workspace-role areas.
3. Spot-check:
   - workspace owners still resolve from `ownerId`;
   - non-owner invalid memberships can leave safely;
   - join/detail pages render integrity-invalid states (no implicit access grant).

## Rollback Guidance

If remediation introduces regression risk:

- pause further writes;
- replay from logged row-level changes;
- restore only rows affected in the current batch.
