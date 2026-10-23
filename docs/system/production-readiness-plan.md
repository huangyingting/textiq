---
type: "plan"
status: "in-progress"
last_updated: "2026-10-23"
description: "Evidence-led application review and scoped refactoring batches, with explicit local and external production gates."
---

# Production Readiness Plan

## Success condition

The relational model and authored JSON agree on identity, ownership, lifecycle,
and source of truth. Core workflows persist after reload, report failures, and
recover without losing work. A green local run is not certification of external
providers or a deployed production database.

## Review findings

The high-level model is appropriate: users own documents, workspaces grant
access without changing document ownership, document content and presentations
are independently authored, and visual rows and search text are projections.
Workspace owners are represented separately from editor/viewer memberships.
Document versions retain recovery state; assets have document-scoped access and
delayed cleanup. Do not replace this model with a wholesale rewrite.

Concrete defects identified:

1. The sharing metadata interaction test still targeted a native select after
   the shared SelectMenu migration.
2. Identical slide-image reuploads reused retired asset identities without
   restoring bytes or clearing soft deletion.
3. Document duplication copied presentation references but not protected media,
   leaving the copy dependent on source-document access and retention.
4. The asset-retention scan omitted image and file registries, so registered
   media without a direct slide-node reference could be retired.
5. Parent floating surfaces treated portaled SelectMenu choices as outside
   clicks, breaking guide editing, slide-master controls, and sharing settings.
   Escape also dismissed parents or depended on effect-listener registration
   order when child surfaces opened later. Modal, drawer, sheet, and transient
   surfaces now share hierarchical dismissal ordering without making transient
   menus lock page scrolling.
6. Several browser assertions still expected native selects or used ambiguous
   partial accessible names after the shared dropdown migration.
7. A root-level invite-only specification claimed alignment that the current
   schema and registration/OAuth paths do not implement. It has been moved to
   the auth subsystem as an explicit proposal; workspace membership invitations
   must not be confused with account-admission invitations.
8. Mutating contextual-editor browser checks shared the canonical read fixture
   and interacted before collaboration readiness. They now use dedicated,
   worker-partitioned document rooms and the existing live-editor readiness
   check instead of relying on timing or undo-based cross-test cleanup.

The schema's unique `(documentId, anchorBlockId)` constraint already prevents
duplicate non-null visual anchors; hypothetical duplicate-row repair is not a
reason to add runtime complexity. Persisted role/status strings are deliberate
cross-provider storage choices; application validation remains necessary.

## Batches

| Batch | Scope                     | Status           | Exit condition                                                                                                                    |
| ----- | ------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Baseline and model review | Complete         | Schema generation parity, full typecheck, model/document tests, lint/governance baseline, isolated browser inventory              |
| 2     | Document media lifecycle  | Complete         | Reupload restores usable media; duplicated presentations own independent media; regression tests exercise rollback and references |
| 3     | UI and workflow repair    | Complete         | Existing production-build Playwright matrix runs; confirmed failures receive focused fixes and reruns                             |
| 4     | Release evidence          | Complete locally | Format, lint, typecheck, focused tests and relevant governance checks pass; completed evidence and external gates recorded        |

Each batch preserves existing layout and feature behavior. Add no superseded
payload adapters, speculative abstractions, or schema migrations without a
reproduced requirement.

## Validation loop

For each defect, reproduce with a focused test, repair the owning module, and
rerun the exact failing interaction. Before handoff, format modified files, lint
modified code, typecheck shared contracts, and run the nearest subsystem tests.
Use a separate SQLite database and profile-owned ports for browser execution;
never reseed a developer's live database.

## External release gates

- Exercise Postgres transaction and constraint behavior against the deployment's
  supported database, with a backup/restore and migration rehearsal.
- Confirm the intended account-admission policy before any invite-only rollout;
  current registration remains public. Verify real email delivery, Google OAuth
  redirects, Stripe webhook/payment lifecycle, and configured AI-provider calls.
- Validate deployment storage durability, retention scheduling, collaboration
  topology, observability, load, and recovery. Local filesystem media is not a
  shared multi-instance storage system.
- Run supported browsers/devices and visual comparisons in the release
  environment; Chromium structural checks do not prove all browser combinations.

## Execution evidence

Initial baseline: schema parity and full typecheck passed; 1,379 model/document
checks passed; full lint/governance passed. The full application unit baseline
had 8,067 passes and the one stale sharing-control test described above.
The maintained browser profile inventories 171 tests across 32 files.

The first browser run passed 163 and exposed eight failures; the second passed
167 and exposed four remaining assertion, readiness, and nested-dismissal
failures. Dynamic nested-dismissal defects were reproduced independently with
focused tests before fixing the shared overlay module. Full repository tests and
coverage gates also passed before this final overlay repair.

Final verification on 2026-10-23:

| Check                                                   | Result                                                                                                                      |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Prisma validation                                       | Postgres and SQLite schemas valid; generated SQLite schema matches its Postgres source                                      |
| `npm run lint`                                          | ESLint, architecture/import guards, E2E inventory, design-system and performance-budget checks passed                       |
| `npm run typecheck`                                     | Application and restricted document-persistence contracts passed, including after browser-profile configuration restoration |
| `npm test`                                              | 8,085 source tests and 708 script tests passed; enforced coverage, breadth, and test-map gates passed                       |
| `npm run test:e2e:profile -- --trace retain-on-failure` | All 171 Chromium tests across 32 files passed against the production build and isolated SQLite database; no retries         |
| `npm run docs:check`                                    | Source inventory, local links, index reachability, and formatting passed                                                    |

Browser coverage includes account lifecycle, document editing/import/export,
independent-media duplication, presentation editing and recovery, sharing and
passcodes, public render/embed, comments/history, workspaces/invitations,
billing-profile behavior, brands, and responsive controls.

One earlier full run reached a client error boundary when signing in after
account deletion. It did not recur in an isolated traced run or the final full
traced matrix. No speculative authentication change was made; retain this
observation on the release watchlist and capture a trace if it recurs.

These are local verification results, not production certification of external
providers, live Postgres transactions, load, or every supported browser.

## Next planned release batches

1. Run provider-parity and concurrency checks on an isolated Postgres deployment,
   including document-media rollback, billing/credit idempotency, and a
   migration/backup/restore rehearsal. Audit historical dangling asset references
   before designing any repair; this batch does not rewrite malformed old decks.
2. Exercise configured external email, OAuth, Stripe, and AI-provider lifecycles
   with dedicated test accounts. Settle account-admission policy separately;
   adopting the auth proposal is not a prerequisite for public registration.
   Repeat account deletion and rejected sign-in under realistic concurrency,
   retaining traces for the intermittent observation above.
3. Validate the deployment's durable media storage, retention workers,
   collaboration recovery, monitoring, and realistic load. Run the supported
   browser/device matrix and visual review before production sign-off.
