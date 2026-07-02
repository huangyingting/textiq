---
type: "plan"
status: "active — P2 spike, awaiting leaf-issue scheduling"
last_updated: "2026-07-02"
description: "Plan to measure, choose, and design incremental and offline-resilient autosave for v7 slide decks."
---

# V7 autosave resilience plan

## Priority and goal

Priority: P2 spike.

Goal: reduce large-deck autosave cost and data-loss risk by measuring current full-snapshot behavior, deciding whether v7 should persist `DeckPatch[]` incrementally or keep full snapshots with stronger resilience, and defining implementation-ready follow-up issues.

## Current behavior and evidence

- Full-snapshot saves are the only v7 persistence path used by the editor. `persistDeckV7WithRecovery` calls `deckPort.saveDeckJson(documentId, updatedDeck, revisionTokenRef.current)` with the entire `DeckV7` payload (`src/components/editor/use-slide-editor-open.ts:132-153`). The single-write queue collapses overlapping requests, but each actual write still persists the latest full deck snapshot (`src/components/editor/use-slide-editor-open.ts:371-437`).
- Patch persistence is currently a compatibility fallback, not real incremental persistence. `saveDeckPatch` delegates to `patchDeck` (`src/app/app/documents/[id]/deck-actions.ts:129-152`), while `patchDeck` explicitly says patch replay is disabled for v7 and returns `{ ok: "fallback" }` after checking that the document exists (`src/lib/document/persistence/deck.ts:212-243`).
- The autosave scheduler only debounces and flushes/cancels pending work. It stores one pending deck, arms a timer, invokes `onDue`, and has no retry queue, backoff policy, offline persistence, or connectivity recovery hooks (`src/lib/presentation-shared/slide-autosave-scheduler.ts:39-113`).
- Failed saves surface a retry-oriented string to the editor. Rejected saves become `"Couldn't save your deck. Check your connection and retry."` (`src/components/editor/use-slide-editor-open.ts:87-91`, `src/components/editor/use-slide-editor-open.ts:183-188`), and conflicts use the existing optimistic revision-token compare-and-swap flow (`src/components/editor/use-slide-editor-open.ts:149-177`, `src/components/editor/use-slide-editor-open.ts:834-857`).

## Measurement plan

### What to measure

Instrument the v7 save path in a local/dev-only branch or behind telemetry-safe diagnostics to capture, per save attempt:

- `slideCount`, component count, asset reference count, and approximate rendered complexity bucket.
- Serialized deck JSON byte size using `new Blob([JSON.stringify(deck)]).size` in the browser and `Buffer.byteLength(JSON.stringify(deck), "utf8")` in server-side measurement utilities.
- Save lifecycle timings: debounce wait excluded, client serialization time, request upload time, server action/storage time if available, total round-trip time, and time to update save UI state.
- Failure/conflict classifications: network/offline, timeout, storage unavailable, validation, revision conflict.
- Stage responsiveness during autosave: frames per second, long tasks over 50 ms, and main-thread serialization blocks.

### Representative decks

Measure at least these deterministic fixtures, using both text-heavy and media-heavy variants where possible:

| Deck size  | Purpose                                                            |
| ---------- | ------------------------------------------------------------------ |
| 5 slides   | Baseline small decks and regression comparison.                    |
| 25 slides  | Common working deck.                                               |
| 75 slides  | Large but expected customer deck.                                  |
| 150 slides | Stress deck for repeated autosave payloads.                        |
| 300 slides | Upper-bound stress deck to decide whether snapshots remain viable. |

For each fixture, run 30 saves on a reliable connection and 30 saves under throttled/flaky profiles: 4G fast, 3G slow, 5% packet loss, offline-then-online, and concurrent-edit conflict.

### Proposed acceptance thresholds

Treat these as spike thresholds to validate or revise with data:

- Deck JSON size: P75 production deck should be ≤ 2 MB serialized JSON; P95 should be ≤ 5 MB; any representative 150-slide deck above 8 MB or 300-slide deck above 15 MB triggers incremental-patch work.
- Save latency: P50 total save round trip ≤ 750 ms, P95 ≤ 2.5 s for ≤ 75 slides on reliable broadband; P95 ≤ 5 s for 150 slides on reliable broadband; autosave retries may continue in the background but must not block editing.
- Stage FPS/responsiveness: maintain ≥ 55 FPS while editing during debounced autosave for 5-75 slide decks and ≥ 45 FPS for 150-slide decks; no save-triggered main-thread long task > 100 ms at P95.
- Resilience: after offline editing for 10 minutes with at least 50 edits, reconnect should persist the latest deck without data loss, preserve conflict detection, and show a clear pending/retrying state within 1 second of connectivity changes.

## Decision framework

### Option A: implement real `DeckPatch[]` persistence

Benefits:

- Lowest upload payload for small edits in large decks.
- Better foundation for future merge, audit, undo, and collaboration-adjacent workflows.
- Aligns the existing `saveDeckPatch` API with its intended contract instead of relying on fallback semantics.

Costs and risks:

- Requires a validated patch schema, ordered replay, idempotency keys, server-side patch application, and persistence tests for every supported edit operation.
- CAS/conflict semantics become more complex: patches must apply against a known base revision token, and failed replay must safely fall back or request reload without corrupting decks.
- Offline queues become patch-log queues, which are compact but require careful compaction, rebasing, and validation after schema migrations.

### Option B: keep snapshots and add resilience

Benefits:

- Preserves the current full-deck `saveDeckJson` contract and optimistic revision-token CAS behavior.
- Faster to ship: queue latest snapshot, retry with backoff, recover on connectivity changes, and keep conflict handling mostly unchanged.
- Simpler correctness model: the last valid snapshot wins only if its revision token still matches, and conflicts keep the existing resolution UI.

Costs and risks:

- Repeated payloads remain expensive for large decks.
- Offline queue storage may be heavy unless it stores only the latest snapshot per document and enforces size limits.
- Does not create a patch foundation for future collaboration or fine-grained audit trails.

### Recommendation

Ship resilient snapshots first unless measurement proves the proposed large-deck thresholds are exceeded for representative 75-150 slide decks. Specifically:

1. Implement offline-resilient latest-snapshot autosave as the near-term P2 reliability fix because it preserves the current CAS conflict flow and directly reduces data-loss risk.
2. Keep `saveDeckPatch` as fallback-only during this work, but add measurement to quantify how often full snapshots exceed payload, latency, or FPS thresholds.
3. Open a separate patch-persistence implementation track only if measured payload/latency crosses the thresholds, or if product requirements need per-operation audit/merge semantics.

This recommendation biases toward correctness and recoverability before incremental complexity.

## Resilience design

### Queue model

- Maintain one logical autosave queue per document and user session.
- Store the latest unsaved full snapshot plus metadata: document id, base revision token, local enqueue time, attempt count, last error class, and serialized byte size.
- Coalesce edits aggressively: if a newer deck arrives while a save is pending or retrying, replace the queued snapshot and keep only the latest deck for that document.
- Persist the queue in browser durable storage so tab refresh or transient offline periods do not drop edits. Enforce a per-document size cap and warn when the deck cannot be queued safely.

### Retry and backoff

- Retry transient failures with exponential backoff and jitter: 1 s, 2 s, 5 s, 10 s, 30 s, then every 60 s while dirty.
- Do not retry validation errors without a new edit or explicit user action.
- Do not overwrite conflicts. If the server returns the existing conflict result, pause the queue and show conflict resolution using the current local snapshot and server revision token.
- Allow manual Save to flush the queue immediately and reset the backoff window for the latest snapshot.

### Connectivity-aware recovery

- Listen to browser online/offline signals as hints, not as truth. When offline is detected, pause network attempts and show a queued/offline state.
- On online, visibility regain, route focus, and editor mount, probe by attempting the next queued save immediately.
- Keep editing enabled while queued. The save status should distinguish Saved, Saving, Queued offline, Retrying, Conflict, and Failed.

### Save-failure UX

- Replace the generic retry string with stateful messaging:
  - Offline: "Changes are saved locally and will sync when you're back online."
  - Retrying: "Couldn't sync changes. Retrying automatically…"
  - Persistent failure: "Couldn't sync changes. Your latest changes are still local. Try again."
  - Conflict: keep the current conflict copy and resolution flow.
- Provide an explicit Retry now action that flushes the latest queued snapshot.
- Warn before leaving only when there is a queued unsynced snapshot that is not durably stored or exceeds the queue size cap.

### Preserving revision-token CAS

- Every queued snapshot carries the revision token that was current when the first unsaved edit was based on the server state.
- Successful `saveDeckJson` updates `revisionTokenRef.current`, marks the matching or newer queued deck saved, and clears dirty state only if no newer local snapshot exists.
- Conflict responses pause retries and populate the existing conflict state with the local deck and server revision token.
- "Keep mine" continues to save the local deck with the server token selected by conflict resolution; "Use theirs" reloads the server deck and clears queued local snapshots only after user confirmation.

## Proposed leaf issues

1. Measure v7 full-snapshot autosave payload and latency. Add a dev-only measurement harness or telemetry-safe diagnostics, create deterministic deck fixtures for 5/25/75/150/300 slides, and publish the results against the thresholds in this plan.
2. Implement resilient latest-snapshot autosave queue. Add durable latest-snapshot queueing, coalescing, retry/backoff with jitter, connectivity recovery triggers, and manual-save flush behavior while preserving current `saveDeckJson` CAS semantics.
3. Update save status UX for queued/retrying/offline states. Add copy, UI states, retry action, and unload warning behavior for unsynced local saves.
4. Add persistence tests for resilient autosave. Cover coalescing, backoff, offline-to-online recovery, manual flush, revision conflict pause, keep-mine, use-theirs, and failure classification.
5. Decide patch persistence after measurement. If thresholds fail, design and implement validated `DeckPatch[]` replay with idempotency, base revision checks, compaction, and fallback safety; otherwise document that snapshots remain the supported v7 autosave persistence path.

## Verification and out of scope

- Verification for this spike is this plan doc and the proposed leaf issues above; no source implementation is included.
- Implementation follow-ups should use persistence tests plus `npm run typecheck`, with focused editor/autosave tests where touched.
- Out of scope: real-time multi-user collaboration, live cursor/presence, CRDT/OT infrastructure, and any compatibility bridge for superseded v6 presentation paths.
