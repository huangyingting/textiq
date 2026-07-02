---
type: "plan"
status: "active — implementation pending"
last_updated: "2026-07-02"
description: "Remaining P2 work for measuring v7 autosave cost and implementing offline-resilient latest-snapshot saves or patch persistence if measurements require it."
---

# V7 Autosave Resilience Plan

## Priority And Goal

**Priority:** P2.

Reduce large-deck autosave cost and data-loss risk while preserving current
DeckV7 save correctness and revision-token conflict handling.

## Remaining Work

| Slice                           | Work                                                                                                                                                                          | Exit criteria                                                                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Snapshot measurement            | Measure v7 full-snapshot payload size, serialization time, save latency, failure classes, and editor responsiveness on representative decks.                                  | Results cover 5/25/75/150/300-slide fixtures under reliable, throttled, flaky, and offline-then-online profiles.                 |
| Resilient latest-snapshot queue | Add a durable per-document queue that stores only the latest unsaved snapshot, coalesces edits, retries with backoff, and flushes on manual save.                             | Offline edits survive refresh/reconnect, retries do not block editing, and successful saves update the revision token safely.    |
| Connectivity recovery           | Retry queued saves on online, visibility regain, route focus, editor mount, and explicit user retry.                                                                          | Queued/offline/retrying/conflict states transition predictably without overwriting conflicts.                                    |
| Save-status UX                  | Replace the generic failure copy with Offline, Retrying, Persistent failure, Conflict, Retry now, and unload-warning states.                                                  | Users can tell whether changes are durable locally, syncing, failed, or blocked by conflict.                                     |
| Persistence tests               | Cover coalescing, durable queue restore, retry/backoff, offline-to-online recovery, manual flush, revision conflict pause, keep-mine, use-theirs, and failure classification. | Focused autosave tests prove the resilience behavior without requiring broad presentation E2E coverage.                          |
| Patch-persistence decision      | Use measurements to decide whether snapshots remain supported or whether validated `DeckPatch[]` replay is required.                                                          | If thresholds fail, a patch track defines idempotency, base revision checks, replay validation, compaction, and fallback safety. |

## Constraints

- Preserve `saveDeckJson` revision-token CAS semantics unless the patch track is
  explicitly opened.
- Keep `saveDeckPatch` fallback-only until measurement proves patch persistence
  is needed.
- Do not add CRDT/OT infrastructure, real-time collaboration, or v6
  compatibility paths as part of autosave resilience.

## Verification

Implementation follow-ups should run focused editor/autosave tests,
`npm run typecheck`, and the smallest relevant presentation checks for touched
files.
