---
type: "architecture"
status: "current"
last_updated: "2026-07-04"
description: "Slide editor autosave, durable latest-snapshot queue, optimistic save conflicts, and deck command execution boundaries."
---

# Autosave And Deck Commands

This document covers the slide editor's persistence and mutation layer: full
deck autosave, durable queued snapshots, revision-token conflicts, and command
execution. The visual editor's Lexical write path lives in
[../editor/lexical-runtime.md](../editor/lexical-runtime.md); the persisted Deck
contract lives in [../data-model/deck.md](../data-model/deck.md).

## Source Files

| Area                  | Source                                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Open/save hook        | [`src/components/editor/use-slide-editor-open.ts`](../../src/components/editor/use-slide-editor-open.ts)                   |
| Save status helpers   | [`src/lib/presentation/save-status.ts`](../../src/lib/presentation/save-status.ts)                                         |
| Debounce scheduler    | [`src/lib/presentation/slide-autosave-scheduler.ts`](../../src/lib/presentation/slide-autosave-scheduler.ts)               |
| Durable queue         | [`src/lib/presentation/resilient-autosave-queue.ts`](../../src/lib/presentation/resilient-autosave-queue.ts)               |
| Deck actions          | [`src/app/app/documents/[id]/deck-actions.ts`](../../src/app/app/documents/%5Bid%5D/deck-actions.ts)                       |
| Persistence service   | [`src/lib/document/persistence/deck.ts`](../../src/lib/document/persistence/deck.ts)                                       |
| CAS writer            | [`src/lib/document/deck-cas-writer.ts`](../../src/lib/document/deck-cas-writer.ts)                                         |
| Presentation commands | [`src/lib/presentation/editor-commands.ts`](../../src/lib/presentation/editor-commands.ts)                                 |
| Command contracts     | [`src/lib/document/deck-kernel/slide-command-contracts.ts`](../../src/lib/document/deck-kernel/slide-command-contracts.ts) |
| Command executor      | [`src/lib/document/deck-kernel/slide-commands.ts`](../../src/lib/document/deck-kernel/slide-commands.ts)                   |

## Autosave Flow

Most slide editor mutations produce a new `Deck` reference. The editor compares
that reference with the last seen deck and schedules an autosave only after the
initial load has passed. Rapid edits are collapsed by
`createSlideAutosaveScheduler` into one due deck after `SLIDE_SAVE_DEBOUNCE_MS`.

Manual Save calls `flush`, which runs any pending deck immediately and clears
the timer. This prevents a stale debounced autosave from firing after a manual
save has already persisted the latest deck.

Before a network save, the editor serializes the deck and compares it with the
last successfully persisted serialization. If the bytes are identical, the
network write is suppressed; this avoids multi-MB no-op writes after edits that
undo back to the saved state.

## Durable Latest-Snapshot Queue

`createResilientLatestSnapshotQueue` stores only the latest unsaved deck
snapshot. Enqueueing a newer snapshot replaces the previous queued value, writes
it to injected local storage, records byte size and sequence, and moves the
status to `queued` or `offline`.

Flush behavior is single-flight: concurrent flush requests share the same
promise. On success, the queue removes local storage, calls `onSaved`, updates
the revision token, and returns to `idle`. On offline or retryable failure it
keeps the snapshot, increments `attemptCount`, records an error class, and
schedules retry with bounded backoff. Fatal failures remain failed and do not
retry. Conflict failures pause retry until the user resolves the conflict.

Recovery loads the queued snapshot from storage on editor mount or explicit
recovery paths. The queue does not merge multiple historical edits; it protects
the newest unsynced deck value.

## Save Status

User-facing save state is derived from editor flags and queue state:

| Queue/editor state      | User status                         |
| ----------------------- | ----------------------------------- |
| `conflict`              | Save conflict, resolve to continue. |
| `offline`               | Offline, changes saved locally.     |
| `retrying`              | Retrying save.                      |
| `failed`                | Could not save, retry is available. |
| `saving`                | Saving.                             |
| `queued`                | Saved locally, syncing soon.        |
| dirty without queue hit | Unsaved changes.                    |
| idle                    | All changes saved.                  |

Conflict, offline, retrying, and failed states take precedence over routine
dirty/saving flags so the bottom dock keeps the right recovery affordance
visible.

## Server Save Boundary

`saveDeckJson` is the active presentation write path. It requires edit access,
then delegates to `persistDeck`, which validates current Deck JSON, writes with
optimistic revision-token compare-and-swap, snapshots a document version after
a confirmed write, and reconciles slide comment anchors that now point at
deleted slides or deleted nodes.

`fetchDeckJson` returns the freshest saved deck and revision token for editor
startup or conflict recovery. `saveDeckPatch` accepts `DeckPatch[]` records for
compatibility, but patch replay is disabled for the presentation runtime and
returns `{ ok: "fallback" }`; callers should save the full deck snapshot.

## Command Execution

Presentation command helpers are pure Deck-to-Deck mutations. They identify
slides and nodes by stable ids, never write resolved render styles back into
nodes, and return a new deck instead of mutating the input.

The deck-kernel command executor wraps lower-level mutations in a serializable
command contract. `executeCommand` dispatches by command family: slide,
element, presentation-theme, background, and source-ref. Successful results can
include affected ids, a history key, and schema-versioned `DeckPatch` metadata.
`coalesceCommands` can merge adjacent gesture-driven commands that share type,
target, and `coalesceKey` so undo/redo and analytics see one logical edit.

Some commands mint fresh ids, so those specific results are not replay-identical
across executions. Validation failures return explicit errors and preserve the
original deck reference.

## Invariants

1. Active presentation persistence saves full Deck snapshots through
   `saveDeckJson`.
2. Revision-token CAS is the conflict authority; presence is advisory only.
3. A manual save flushes and clears pending debounced autosave work.
4. The durable queue stores the latest unsynced snapshot, not an edit log.
5. Patch replay is disabled for the presentation runtime and falls back to full
   deck save.
6. Command executors are pure and do not touch React, DOM, Prisma, or browser
   APIs.

## Primary Tests

- [`src/lib/presentation/save-status.test.ts`](../../src/lib/presentation/save-status.test.ts)
- [`src/lib/presentation/slide-autosave-scheduler.test.ts`](../../src/lib/presentation/slide-autosave-scheduler.test.ts)
- [`src/lib/presentation/resilient-autosave-queue.test.ts`](../../src/lib/presentation/resilient-autosave-queue.test.ts)
- [`src/lib/document/deck-cas-writer.test.ts`](../../src/lib/document/deck-cas-writer.test.ts)
- [`src/lib/document/deck-model.test.ts`](../../src/lib/document/deck-model.test.ts)
- [`src/lib/presentation/editor-commands.slide-deck.test.ts`](../../src/lib/presentation/editor-commands.slide-deck.test.ts)
