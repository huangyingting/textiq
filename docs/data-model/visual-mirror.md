---
type: "contract"
status: "accepted"
last_updated: "2026-07-10"
description: "Date: 2026-06-23 Issue: #449 — Document the contentJson-to-Visual mirror contract Authors: Tank (Backend Dev)"
---

# Visual Mirror Contract

**Date:** 2026-06-23  
**Issue:** [#449 — Document the contentJson-to-Visual mirror contract](https://github.com/huangyingting/Napkin-Clone/issues/449)  
**Authors:** Tank (Backend Dev)

---

## Context

The `Visual` table holds a database projection of every embedded visual block in
a document's `contentJson`. Dashboard thumbnails read this projection, and
schema audit and repair paths use it to detect or reconcile drift. Public
share/embed/present rendering and deck derivation instead collect embedded
visuals directly from `contentJson`. To keep projection consumers consistent,
the table must be rebuilt every time `contentJson` changes.

This document specifies the exact mapping (the "mirror contract") so that every
feature reading or writing `Visual` rows can reason from the same mental model,
and so repair tooling can verify and restore consistency.

---

## Source of Truth

`Document.contentJson` (a serialized [Lexical](https://lexical.dev/) editor
state) is the authoritative source of all visual content. Every `Visual` row is
a _derived projection_: it can always be rebuilt from `contentJson` alone by
replaying the mirror pipeline.

---

## VisualNode in contentJson

A Lexical node of type `"visual"` has the following shape inside `contentJson`:

```jsonc
{
  "type": "visual",
  "visualId": "<durable-block-id>", // stable string identifier; maps to anchorBlockId
  "visual": {
    "type": "FLOWCHART", // VisualKind (uppercase)
    "title": "Optional label", // string | null
    // ... payload fields validated by visualSchema
  },
}
```

Key rules:

- `visualId` is the **durable block identity** for the visual. It must be a
  non-empty string to be mirrored.
- `visual` contains the structured visual payload (validated with
  `safeParseVisual`). If validation fails the node is **skipped** (not
  persisted/updated), but its row is left intact and not pruned.
- Document order (depth-first traversal of the Lexical node tree) determines
  `orderIndex`.

---

## Visual Row Fields

| Field           | Type               | Meaning                                                                |
| --------------- | ------------------ | ---------------------------------------------------------------------- |
| `id`            | `string` (CUID)    | Stable database-assigned identifier                                    |
| `documentId`    | `string`           | Parent document                                                        |
| `anchorBlockId` | `string`           | Matches `visualId` from the Lexical node                               |
| `orderIndex`    | `number`           | Document-order position (0-based depth-first traversal)                |
| `type`          | `string`           | Prisma enum value mapped from `VisualKind` via `VISUAL_KIND_TO_PRISMA` |
| `data`          | `JSON`             | Full validated visual payload                                          |
| `title`         | `string \| null`   | Denormalised from `visual.title` for quick display                     |
| `revisions`     | `VisualRevision[]` | History snapshots; written before each payload update                  |

A **unique constraint** on `(documentId, anchorBlockId)` prevents duplicates.

---

## Mirror Semantics

The mirror pipeline is a pure diff (`diffVisualMirror`) followed by DB writes
inside a single transaction.

### 1. Collect live nodes

`collectVisualNodes(parsedState)` does a depth-first walk of `contentJson` and
returns all nodes of `type = "visual"` in document order. Duplicate `visualId`
values are skipped on the second occurrence (the first wins).

### 2. Build live sets

For each collected node:

- If `visualId` is empty/null → increment `invalid` counter, skip.
- Always add the normalized `anchorBlockId` to `liveAnchors`.
- Run `safeParseVisual(node.visual)`:
  - If **invalid** → increment `skipped` counter; the anchor is in `liveAnchors`
    but produces no `LiveVisualNode`. The existing DB row (if any) is preserved.
  - If **valid** → push a `LiveVisualNode` with `anchorBlockId`, `orderIndex`,
    `type`, `title`, `data`, `dataKey` (normalized JSON for equality checks).

### 3. Diff (`diffVisualMirror`)

Inputs: `existingRows` (from DB), `liveNodes`, `liveAnchors`.

| Condition                                                                    | Outcome                                                                  |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `liveNode` has no existing row                                               | **create**                                                               |
| `liveNode` matches existing row (same `dataKey` and `orderIndex`)            | **no-op**                                                                |
| `liveNode` payload differs (`dataKey` changed or existing `dataKey` is null) | **update** (`payloadChanged = true`); snapshot to `VisualRevision` first |
| `liveNode` order differs only (`dataKey` same)                               | **update** (`payloadChanged = false`); no snapshot                       |
| Existing row's anchor is not in `liveAnchors`                                | **delete**                                                               |
| Existing row has `anchorBlockId = null`                                      | **delete**                                                               |

### 4. Execute

Inside a single `$transaction`:

1. **Creates**: `tx.visual.upsert` on `(documentId, anchorBlockId)` so a racing
   concurrent transaction that beat us to the create is updated in place.
2. **Updates**: snapshot previous payload with `snapshotVisualRevision` if
   `payloadChanged`; then update the row.
3. **Deletes**: `tx.visual.deleteMany` for the collected delete set.

The transaction boundary ensures that two concurrent saves cannot both miss-and-
create a row (the upsert handles the race), and the unique constraint is the hard
correctness guarantee.

### 5. Outcome

The mirror returns a `VisualMirrorOutcome`:

```typescript
type VisualMirrorOutcome = {
  created: number; // rows inserted
  updated: number; // rows updated (payload or order)
  deleted: number; // rows pruned (orphaned anchors)
  skipped: number; // nodes whose payload failed safeParseVisual
  invalid: number; // nodes with missing/empty visualId
};
```

This is logged via `logInfo("visual.mirror", "mirror complete", outcome)` on
every save so production logs carry structured counts for debugging.

---

## Ordering

`orderIndex` reflects strict document order (the depth-first traversal index at
the time of the save). Two visuals with the same `orderIndex` cannot exist for
the same document because each traversal position is unique. Consumers that
read multiple `Visual` rows sort them by ascending `orderIndex`.

---

## Invariants

1. **One row per anchor per document**: the unique constraint on
   `(documentId, anchorBlockId)` is the schema-level guarantee.
2. **Rows track content**: after any successful `mirrorVisualNodes` or
   `rebuildVisualMirror` call, valid visual nodes have matching
   `(documentId, anchorBlockId)` rows. Invalid live anchors may preserve an
   existing row until their payload is valid again.
3. **Anchors are required**: the mirror never creates rows without an
   `anchorBlockId`; existing null-anchor rows are deleted.
4. **Invalid payloads don't update rows**: a node that fails `safeParseVisual`
   leaves the existing row untouched; it does not delete or corrupt it.
5. **Idempotence**: running `rebuildVisualMirror` twice on the same `contentJson`
   without any intermediate edit produces an empty diff (no create/update/delete).
6. **Deck refs stay consistent**: after `restoreDocumentVersion`, Visual rows and
   deck `visualId` references are reconciled so no slide references a missing
   visual. The `sanitizeRestoredDeck` + post-restore deck reconciliation passes
   enforce this.

---

## Failure Modes

| Failure                          | Behaviour                                                                |
| -------------------------------- | ------------------------------------------------------------------------ |
| `contentJson` is null/missing    | Mirror is skipped (no-op)                                                |
| `safeParseVisual` rejects a node | Node is counted as `skipped`; save continues                             |
| `visualId` is null or whitespace | Node is counted as `invalid`; save continues                             |
| DB transaction fails (transient) | Error propagates; save surfaces an error to the caller                   |
| Concurrent saves                 | Upsert semantics prevent double-create; last write wins on order/payload |

---

## Repair / Rebuild

`rebuildVisualMirror(documentId)` is an idempotent server action that re-derives
all `Visual` rows from the current `contentJson`. It is equivalent to what
`saveDocumentLexical` does for the mirror portion. Use it to repair drift caused
by:

- A bug that left the mirror stale
- Manual DB edits
- A partial failure during a previous save
- Version restore followed by external Visual row changes

---

## Related

- `src/lib/visual/mirror-diff.ts` — pure diff logic
- `src/app/app/documents/[id]/actions.ts` — `mirrorVisualNodes`, `saveDocumentLexical`, `restoreDocumentVersion`, `rebuildVisualMirror`
- `prisma/schema.prisma` — `Visual`, `VisualRevision` models
