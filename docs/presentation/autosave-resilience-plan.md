---
type: "plan"
status: "active — implementation pending"
last_updated: "2026-07-02"
description: "Remaining P2 work for measuring presentation autosave cost and implementing offline-resilient latest-snapshot saves or patch persistence if measurements require it."
---

# Autosave Resilience Plan

## Priority And Goal

**Priority:** P2.

Reduce large-deck autosave cost and data-loss risk while preserving current
Deck save correctness and revision-token conflict handling.

## Remaining Work

| Slice                           | Work                                                                                                                                                                          | Exit criteria                                                                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Snapshot measurement            | Measure presentation full-snapshot payload size, serialization time, save latency, failure classes, and editor responsiveness on representative decks.                        | Results cover 5/25/75/150/300-slide fixtures under reliable, throttled, flaky, and offline-then-online profiles.                 |
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

## Measurement Results (2026-07-02)

Deterministic payload measurement uses
`measureDeckSnapshotPayload` against representative Deck fixtures assembled
from the existing presentation test builders. The utility serializes the full Deck JSON
snapshot with `JSON.stringify` and records UTF-8 byte length.

| Slides | Serialized Deck JSON bytes | KiB    |
| ------ | -------------------------- | ------ |
| 1      | 868                        | 0.85   |
| 5      | 3,328                      | 3.25   |
| 10     | 6,321                      | 6.17   |
| 25     | 15,300                     | 14.94  |
| 50     | 30,265                     | 29.56  |
| 75     | 45,230                     | 44.17  |
| 150    | 90,125                     | 88.01  |
| 300    | 179,915                    | 175.70 |

Large-deck acceptance thresholds for keeping resilient full-snapshot autosave:

- **Deck JSON size:** the 300-slide representative deck remains under 1 MiB
  serialized JSON.
- **Save latency:** browser or CI profile runs should record p95 end-to-end save
  latency under 2 seconds on a reliable profile and under 5 seconds on throttled,
  flaky, or offline-then-online recovery profiles.
- **Editor responsiveness:** autosave should not drop the active stage below
  55 FPS on a reliable profile or below 45 FPS during throttled/flaky recovery;
  autosave should not introduce long tasks over 100 ms.

This CLI-only slice measured deterministic payload size. Browser-dependent save
latency and stage-FPS runs should use the same 5/25/75/150/300-slide fixtures
under reliable, throttled, flaky, and offline-then-online profiles and compare
against the thresholds above.

## DeckPatch Decision

The measured 300-slide full snapshot is 179,915 bytes (175.70 KiB), well below
the 1 MiB large-deck payload threshold. Combined with the shipped resilient
latest-snapshot autosave queue/recovery/UX, real `DeckPatch[]` persistence is
not required now.

Keep presentation autosave on full-deck `saveDeckJson` snapshots and leave
`saveDeckPatch` fallback-only. Revisit DeckPatch persistence only if a
representative deck exceeds any recorded threshold: over 1 MiB serialized JSON,
p95 save latency over 2 seconds reliable or 5 seconds throttled/flaky/recovery,
or stage responsiveness below the FPS/long-task limits above.

## Verification

Implementation follow-ups should run focused editor/autosave tests,
`npm run typecheck`, and the smallest relevant presentation checks for touched
files.
