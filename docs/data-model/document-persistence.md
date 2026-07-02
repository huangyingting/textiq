---
type: "architecture"
status: "current"
last_updated: "2026-07-01"
description: "This document describes the service boundary that persists editable document state, rebuilds visual projections, writes decks, snapshots versions, restores versions, and reconciles document-to-deck dependencies. CRUD/listing behavior lives in ../documents/README.md; JSON schema contracts live in deck.md and visual-mirror.md."
---

# Document Persistence Service

This document describes the service boundary that persists editable document
state, rebuilds visual projections, writes decks, snapshots versions, restores
versions, and reconciles document-to-deck dependencies. CRUD/listing behavior
lives in [../documents/README.md](../documents/README.md); JSON schema contracts
live in [deck.md](deck.md) and [visual-mirror.md](visual-mirror.md).

## Source Anchors

| Area                         | Source                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| Persistence orchestration    | [`src/lib/document/persistence-service.ts`](../../src/lib/document/persistence-service.ts) |
| Deck compare-and-swap writer | [`src/lib/document/deck-cas-writer.ts`](../../src/lib/document/deck-cas-writer.ts)         |
| Persistence result types     | [`src/lib/document/persistence-types.ts`](../../src/lib/document/persistence-types.ts)     |
| Deck dependency model        | [`src/lib/document/source-ref-model.ts`](../../src/lib/document/source-ref-model.ts)       |
| Visual mirror diff           | [`src/lib/visual/mirror-diff.ts`](../../src/lib/visual/mirror-diff.ts)                     |
| Lexical visual extraction    | [`src/lib/lexical/visual-nodes.ts`](../../src/lib/lexical/visual-nodes.ts)                 |
| Document version policy      | [`src/lib/document-versions.ts`](../../src/lib/document-versions.ts)                       |
| Persisted schema telemetry   | [`src/lib/diagnostics/schema-telemetry.ts`](../../src/lib/diagnostics/schema-telemetry.ts) |

## Service Boundary

Server actions own session, permission, and argument validation. The persistence
service owns transaction boundaries and cross-projection consistency. This keeps
the write orchestration testable without React, route handlers, or browser
fixtures.

Structured logs from this layer include ids, counts, status, and stable reasons
only. Document text, prompts, cookies, and raw payloads are not logged.

## Lexical Save And Visual Mirror

`atomicSaveDocumentLexical(documentId, parsedState, userId)` writes the current
Lexical `contentJson`, derives plain text into `Document.content`, and rebuilds
the `Visual` table in one Prisma transaction.

```text
parsed Lexical state
  -> lexicalStateToPlainText(...).slice(DOCUMENT_CONTENT_MAX_LENGTH)
  -> snapshotDocumentVersion(...)
  -> transaction:
       update Document.contentJson + content
       mirrorVisualNodesInTx(...)
  -> safe structured mirror summary log
```

If the mirror rebuild fails, the `contentJson` write rolls back with it. Readers
therefore never observe committed document content with stale or missing visual
projection rows.

`mirrorVisualNodesInTx` collects visual nodes, normalizes anchor block ids,
validates embedded visual payloads, diffs against existing `Visual` rows, and
applies create/update/delete operations. Payload-changing updates snapshot the
previous visual row into `VisualRevision`, then prune each visual's revision
history to the most recent entries.

## Deck Writes And Revision Tokens

Deck writes go through `writeDeckWithCas`:

1. Parse with `safeParseDeck`.
2. Reject oversized serialized deck JSON.
3. Generate a new revision token.
4. Update `Document.deckJson` only when the caller's expected token matches.
5. Snapshot document state on successful writes.

`persistDeck` writes a full deck. `patchDeck` is currently a compatibility
shim: it checks document existence and returns `{ ok: "fallback" }` without
replaying `DeckPatch[]`. `persistDeckCommand` is currently disabled for presentation-only
slide editing.

Conflict results return the latest server revision token so clients can recover
without overwriting concurrent edits.

## Version Snapshots And Restore

Document version snapshots are best-effort. They are throttled by the version
policy, skipped when content/deck are unchanged, and pruned to the configured
maximum. Snapshot failure never breaks the caller's save.

`restoreVersion` is the high-risk restore path:

1. Verify the version belongs to the requested document.
2. Force a pre-restore snapshot labelled `Before restore`.
3. Sanitize restored `deckJson` against restored content.
4. Write restored `contentJson`, plain content, and deck.
5. Rebuild the visual mirror in the same transaction.
6. Reconcile the deck again against actual DB visual rows.
7. Revalidate public share, embed, and present cache paths.

Invalid restored deck JSON is reported through schema telemetry and preserved as
the raw restored value; runtime readers still only support current payload
contracts.

## Deck Dependency Reconciliation

`source-ref-model.ts` is the canonical deck-to-document dependency model. It
enumerates:

- visual element references (`VisualElement.visualId`);
- source-linked slide elements (`SourceRef`).

Dependency health uses the shared anchor-resolver vocabulary: `found`, `stale`,
`missing`, and `invalid`. Reconciliation strips orphaned/invalid visual
references so decks do not silently render blank visual elements. Stale source
links are surfaced but kept, allowing authors to relink or unlink intentionally.

## Sharing Writes And Cache Revalidation

The same service owns share setting writes because public URLs and cache
revalidation depend on document persistence state. Share link generation uses a
random share id plus slug candidate with bounded retry on unique collisions.
After restore, public share, embed, and present paths are revalidated. Cache
revalidation errors are swallowed so restore success is not blocked by cache
invalidation.

## Invariants

1. `contentJson` writes and visual mirror rebuilds are atomic.
2. `Document.content` is a bounded plain-text projection of `contentJson`.
3. Deck writes must parse as the current deck schema and fit the deck JSON
   budget before persistence.
4. Deck saves are guarded by revision-token compare-and-swap.
5. Version snapshots are best-effort and never fail the user write path.
6. Restore sanitizes deck visual references against restored content and then
   reconciles against actual DB visual rows.
7. Schema failures are reported with safe identifiers only.

## Primary Tests

- [`src/lib/document/persistence-service.test.ts`](../../src/lib/document/persistence-service.test.ts)
- [`src/lib/document/deck-cas-writer.test.ts`](../../src/lib/document/deck-cas-writer.test.ts)
- [`src/lib/document/source-ref-model.test.ts`](../../src/lib/document/source-ref-model.test.ts)
- [`src/lib/visual/mirror-diff.test.ts`](../../src/lib/visual/mirror-diff.test.ts)
- [`src/lib/document-versions.test.ts`](../../src/lib/document-versions.test.ts)
