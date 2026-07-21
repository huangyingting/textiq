---
type: "architecture"
status: "current"
last_updated: "2026-07-04"
description: "Purpose: Current system design map"
---

# TextIQ — Current Architecture State

**Purpose:** Current system design map

> This document is the high-level map. Topic-level contracts live in flat
> subsystem directories under `docs/`. The current schema is authoritative.

---

## 1. System Subsystems at a Glance

| Subsystem           | Source of Truth                           | Derived Projections                                                                             |
| ------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Document text       | `Document.contentJson`                    | `Document.content` (plain-text), `Visual` rows                                                  |
| Slides/deck         | `Document.deckJson`                       | —                                                                                               |
| Version history     | `DocumentVersion`                         | —                                                                                               |
| Collaboration state | In-memory Y.Doc (collab server)           | Client autosave writes `contentJson`; dirty room eviction writes best-effort recovery snapshots |
| Permissions         | `WorkspaceMembership`, `Document.ownerId` | `requireDocumentCapability` capability cache                                                    |
| Sharing             | `Document.isShared`, `shareId`, `slug`    | Public URLs `/share/…`, `/embed/…`, `/present/…`                                                |
| Command envelope    | `CommandEnvelope` + pure executors        | Produces in-memory deck mutations; persisted as full `deckJson` via `saveDeckJson`              |

---

## 2. Lexical/Yjs Editor

**Source files:**  
`src/app/app/documents/[id]/lexical-editor.tsx`  
`src/lib/collab/use-lexical-collaboration.ts`  
`src/lib/content/import-persistence.ts`

### 2.1 Editor state

- `LexicalComposer` initializes from `Document.contentJson` passed as a page prop.
- Block ids (`bid`) are stamped on every paragraph/heading node by `$ensureBlockIdsInDocument`. These ids are durable (survive copy/paste and collab merges) and are the anchor contract for source links, comments, and the visual mirror.
- The editor is in collaborative mode when the Yjs websocket connects. In degraded/offline mode it falls back to local-only editing.

### 2.2 Autosave and CRDT skipping

`shouldAutosaveUpdate` (see `src/lib/content/import-persistence.ts`) decides whether an editor change triggers a DB save:

| Tag                   | Autosave? | Reason                                           |
| --------------------- | --------- | ------------------------------------------------ |
| `COLLABORATION_TAG`   | ❌        | Remote CRDT merge — originator saves             |
| `HISTORIC_TAG`        | ❌        | Undo/redo replay                                 |
| `RESTORE_TAG`         | ❌        | Version restore — server action already wrote DB |
| `BLOCK_ID_REPAIR_TAG` | ❌        | Additive identity repair only                    |
| `IMPORT_TAG`          | ✅        | User-initiated content replacement               |
| _(no tag)_            | ✅        | Normal local edit                                |

### 2.3 Durability window and the collab server (#469)

The failure window where a synced edit may not reach the DB:

> Client A edits → Yjs sync to server room → Client A crashes before the
> debounced autosave fires → room is evicted → DB holds pre-edit state.

**Mitigation (implemented in `scripts/collab-core.mjs`):**

- `hasPendingUpdates(doc, lastSavedStateVector)` — pure helper comparing the
  current Yjs state vector against the last durably-saved vector. Returns `true`
  when unsaved operations exist in memory.
- `setRoomSavedStateVector(roomName, stateVector)` / `markRoomSaved(roomName, doc)`
  — called after a confirmed durable write to record the vector at which the room
  was last saved. `getRoomSavedStateVector(roomName)` reads it back.
  **Saved-vector lifecycle:** the vector tracks the last _confirmed durable_ write
  (a successful `contentJson` autosave). Eviction does **not** advance it — the
  eviction flush is best-effort recovery, not the source of truth — so `evictRoom`
  clears the entry instead. A save with no active room is a no-op (the room
  reseeds from the DB on reconnect). In **inline** mode the vector can be advanced
  after a confirmed save; the **standalone** process runs separately and relies on
  DB reseed on reconnect rather than cross-process vector advancement.
- `onBeforeEvict(roomName, update)` callback — fires with the full Yjs update
  bytes before a room is torn down when unsaved changes are detected. Wired at
  `createCollabWss` time in **both** entry points (`server.mjs`,
  `scripts/collab-server.mjs`) via `createEvictionFlusher` from
  `scripts/collab-flush.mjs`, which POSTs the update (base64) to the internal
  `/api/collab/flush` endpoint. That endpoint persists a **best-effort recovery
  snapshot** (`Document.collabRecoverySnapshot` / `collabRecoverySavedAt`) — it is
  NOT the canonical store and is never read on the normal load path; `contentJson`
  (client autosave) remains the source of truth. When `COLLAB_INTERNAL_SECRET` is
  unset the flusher is a no-op (one warning) and the endpoint returns `503`.
- Degraded/offline path: the `CollaborationPlugin` is seeded from `contentJson`
  via `DEGRADED_TIMEOUT_MS` fallback; the degraded flag in
  `useLexicalCollaboration` ensures the editor is not gated on a sync event
  that never arrives.

**Full distributed durability is out of scope.** The window is reduced;
zero-loss delivery is not guaranteed. The eviction snapshot is **best-effort
recovery only** — `contentJson` (client autosave) is canonical. The scaling /
durability path is recorded in
[Realtime collaboration scaling and durability](realtime-collaboration-scaling.md).

---

## 3. Visual Projection (Mirror Pipeline)

**Source files:**  
`src/lib/document/persistence-service.ts` (`mirrorVisualNodesInTx`)  
`src/lib/visual/mirror-diff.ts`  
`src/lib/visual/schema.ts`

### 3.1 Contract

`Document.contentJson` is the source of truth. `Visual` rows are a **derived
projection** used by share pages, embed renders, deck builders, and thumbnails.
No consumer reads `contentJson` directly at render time — they read `Visual` rows.

### 3.2 Atomic save (#470)

`atomicSaveDocumentLexical` in `persistence-service.ts` wraps the `contentJson`
write and the full mirror rebuild in a **single Prisma `$transaction`**:

```
$transaction(async tx => {
  document.updateMany(...)   // writes contentJson + content
  mirrorVisualNodesInTx(tx, documentId, parsedState)  // upserts/deletes Visual rows
})
```

A mirror failure rolls back the `contentJson` write, so DB readers can never
observe `contentJson` that is newer than the `Visual` projection.

### 3.3 Repair path

`rebuildVisualMirror` (server action) / `rebuildMirror` (service) reruns the
mirror pipeline from the current `contentJson` without touching other fields.
Running it twice on identical content is a no-op (idempotent diff).

### 3.4 Belt-and-suspenders reconciliation

After a version restore, `reconcileDeckAfterMirror` re-reads the actual DB
`Visual` rows and strips any `deckJson` references that weren't created by the
mirror. This guards against partial-mirror edge cases.

---

## 4. Slides/Deck Persistence

**Source files:**
`src/lib/document/persistence-service.ts` (`persistDeck`)
`src/app/app/documents/[id]/actions.ts` (`saveDeckJson`)
`src/lib/document/deck-cas-writer.ts`
`src/lib/presentation/schema.ts`
`src/lib/presentation/validation.ts`
`src/lib/presentation/editor-commands.ts`

### 4.1 Storage

`Document.deckJson` holds the entire deck as a single JSON column, separate
from `contentJson`. Deck edits never modify `contentJson` and vice versa.
`Document.deckRevisionToken` is a random token used for optimistic CAS locking.
Persisted decks must be valid Deck JSON (`schemaVersion: 7`). Each slide is a
`SlideNode` with authored content in `children`; renderers and exporters consume
the resolved Deck render tree.

### 4.2 Write paths

| Action                     | Token check  | Outcome                                   |
| -------------------------- | ------------ | ----------------------------------------- |
| `saveDeckJson` (full save) | Required CAS | `{ ok: true, revisionToken }` or conflict |

The full-deck write path uses revision-token compare-and-swap. Missing or stale
tokens are conflicts; successful writes mint a new token. Patch replay is not a
supported persistence path.

See [data-model/deck.md](../data-model/deck.md) for the full Deck schema and
sync contract.

### 4.3 Version snapshots

`snapshotDocumentVersion` captures both `contentJson` and `deckJson` into
`DocumentVersion` after a confirmed write, throttled by `SNAPSHOT_MIN_INTERVAL_MS`.
The maximum snapshot count per document is `MAX_DOCUMENT_VERSIONS`.

---

## 5. Document Persistence Service (#474)

**Source file:**  
`src/lib/document/persistence-service.ts`

Server actions in `actions.ts` are thin wrappers that own:

1. Authentication (`requireUser`)
2. Permission checks (`requireDocumentCapability`)
3. Argument validation (JSON parse, size limits)
4. Cache revalidation (`revalidatePath`)

All persistence orchestration lives in the service:

| Service function            | What it owns                                        |
| --------------------------- | --------------------------------------------------- |
| `atomicSaveDocumentLexical` | Lexical contentJson write + mirror in one tx        |
| `mirrorVisualNodesInTx`     | Mirror pipeline accepting a caller tx               |
| `rebuildMirror`             | Standalone mirror repair                            |
| `persistDeck`               | Full deck CAS write + version snapshot              |
| `restoreVersion`            | Pre-restore checkpoint + atomic restore + reconcile |
| `sanitizeRestoredDeck`      | Orphan-strip restored deckJson before write         |
| `reconcileDeckAfterMirror`  | Post-mirror deck reconcile against actual DB rows   |
| `revalidateSharePaths`      | Invalidate share/embed/present cache                |

---

## 6. Document-to-Deck Source Reference Model (#475)

**Source file:**  
`src/lib/document/source-ref-model.ts`

Slides can reference document content in two ways:

| Dependency kind | Where                                             | Identified by                               |
| --------------- | ------------------------------------------------- | ------------------------------------------- |
| `visual`        | Free-form `SlideElement.kind === "visual"`        | `element.visualId` → `Visual.anchorBlockId` |
| `source_ref`    | `SlideElement.sourceRef` (text, visual, or table) | `sourceRef.blockId` + `contentHash`         |

`enumerateDeckDependencies(deck)` returns both dependency kinds in a typed union.
`checkDependencyHealth(deck, freshBlocks)` classifies each as found/stale/missing/invalid.
`reconcileDeckVisuals(deck, knownVisualIds)` delegates to `stripOrphanedVisuals`.
`collectDeckVisualIds(deck)` returns the full set of visual ids the deck needs.

All helpers are pure and side-effect-free.

---

## 7. Collaboration Server

**Source files:**  
`scripts/collab-core.mjs`  
`scripts/collab-server.mjs`  
`server.mjs`  
`src/app/api/collab/authorize/route.ts`

### 7.1 Room lifecycle

```
Connection arrives → cancelEviction(room) → setupConnection
Connection closes  → closeConn → if (conns.size === 0) scheduleEviction(room, TTL, onBeforeEvict)
TTL expires        → hasPendingUpdates? → onBeforeEvict(roomName, update) → evictRoom
```

- **`ROOM_IDLE_TTL_MS`** (default 60 s): how long an empty room stays in memory.
- One `WSSharedDoc extends Y.Doc` per room.
- `docs: Map<string, WSSharedDoc>` — the in-memory room registry.
- `savedStateVectors: Map<string, Uint8Array>` — tracks what has been durably saved per room.

### 7.2 Authorization and eviction flush

`createCollabWss(roomFromUrl, { authorize, onBeforeEvict })` requires an
authorization callback and accepts an optional eviction-flush callback:

- `authorize(req, room)` → `{ ok, status, readOnly? }` — called before WebSocket handshake.
- `onBeforeEvict(roomName, update)` → `Promise<void>` — called with Yjs bytes when
  a **dirty** room is evicted. Both entry points build this via
  `createEvictionFlusher` (`scripts/collab-flush.mjs`), which POSTs the update
  (base64) to `/api/collab/flush` with the `x-collab-internal-secret` header. The
  endpoint stores a **best-effort recovery snapshot** on the `Document`
  (`collabRecoverySnapshot` / `collabRecoverySavedAt`); it never becomes the
  source of truth and is never read on the normal load path. Errors are recorded
  in an in-memory observability ring (`recentFlushFailures()` / `flushStats()`).
  Public health endpoints surface aggregate counts (`recentFlushFailureCount` /
  `flushFailures`) without room or document ids and never advance the saved-state
  vector. When `COLLAB_INTERNAL_SECRET` is unset the flusher is a no-op and the
  endpoint returns `503`.

Read-only connections (viewers) receive sync-step-1 replies but cannot send updates (sync-step-2 / update messages are dropped).

### 7.3 Ping/pong keep-alive

A 30 s ping interval per connection; if pong is not received the connection is closed.

---

## 8. Permissions

**Source files:**  
`src/lib/auth/document-permissions.ts`  
`src/app/api/collab/authorize/route.ts`

Three document capability levels, checked via `requireDocumentCapability(userId, documentId, capability)`:

| Capability | Grants       | Who                                                      |
| ---------- | ------------ | -------------------------------------------------------- |
| `"view"`   | Read access  | Owner, workspace members, public share (for shared docs) |
| `"edit"`   | Save edits   | Owner, workspace editors                                 |
| `"manage"` | Share/delete | Owner only                                               |

The collab authorize route maps to `"view"` (read-only) or `"edit"` to set the `readOnly` flag on the WebSocket connection.

Read-list scopes such as `documentAccessOr(userId)` are read-only filters for
listing/searching visible documents. Mutations do not rely on list scopes; they
use document or workspace capability checks and map denials through the shared
access-decision taxonomy/adapters.

---

## 9. Sharing and Export

**Source files:**  
`src/app/app/documents/[id]/actions.ts` (share actions)  
`src/app/share/[shareId]/page.tsx`  
`src/app/embed/[shareId]/page.tsx`  
`src/app/present/[shareId]/page.tsx`

### 9.1 Share link

- `toggleDocumentSharing` generates a `shareId` (12-char URL-safe random) and a decorative `slug` (title-derived + 4-char suffix).
- `regenerateShareLink` rotates both so the old URL stops resolving immediately.
- `updateSharePolicy` sets `shareExpiresAt`, `shareEmbedEnabled`, `sharePresentEnabled`.

### 9.2 Public routes

All three routes (`/share/…`, `/embed/…`, `/present/…`) read `Visual` rows for
thumbnail/visual rendering — they do NOT read `contentJson` directly.

### 9.3 Cache revalidation

`revalidateSharePaths(documentId)` (implemented in
`src/lib/document/persistence/sharing.ts` and re-exported by
`persistence-service.ts`) is called after version restore so cached public pages
reflect the restored content.

---

## 10. Command Infrastructure

**Source files:**  
`src/lib/commands/command-envelope.ts`  
`src/lib/commands/visual-command-adapter.ts`  
`src/lib/commands/visual-commands.ts`  
`src/lib/presentation/editor-commands.ts`

There is **no runtime command bus** and no `command-bus.ts` module. Commands are
serializable `CommandEnvelope` records executed by **pure executors** behind thin
adapters:

- **Deck/slide commands** are immutable Deck transforms in
  `src/lib/presentation/editor-commands.ts`. The presentation slide editor owns
  UI state, history, and autosave handoff, then persists validated Deck JSON
  through the deck CAS writer.
- **Visual commands** are defined as `VisualCommandPayload` ops in
  `src/lib/commands/visual-commands.ts`. UI surfaces call `applyVisualCommand()`
  in `src/lib/commands/visual-command-adapter.ts`, which builds a validated
  `CommandEnvelope`, runs the pure `executeVisualCommand()`, and returns the new
  `Visual` for the caller to write back via `node.setVisual()`.
- `validateCommandEnvelope()` is the shared, server-safe structural validator for
  both surfaces; `adaptSlideCommandResult` / `adaptVisualCommandResult` normalize
  results into the cross-surface `CrossSurfaceCommandResult` shape.

**Where to add a new command:**

- deck/slide intent → add a `SlideCommand` variant + executor case in
  `slide-commands.ts` (emit `DeckPatch[]`);
- visual intent → add a `VisualCommandPayload` op in `visual-commands.ts` and
  route the UI edit through `applyVisualCommand()`.

Do **not** introduce a runtime dispatcher/bus — the architecture is intentionally
"pure executor + serializable patch + adapter", not event sourcing. There is no
durable command log yet.

---

## 11. Sources of Truth vs. Derived Projections

| Data                | Source of Truth                        | Derived / Projection                                                                                                                  |
| ------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Document body       | `Document.contentJson`                 | `Document.content` (plain-text)                                                                                                       |
| Embedded visuals    | `Document.contentJson` (visual nodes)  | `Visual` rows (mirror projection)                                                                                                     |
| Visual history      | `VisualRevision` rows                  | —                                                                                                                                     |
| Deck/slides         | `Document.deckJson`                    | —                                                                                                                                     |
| Document history    | `DocumentVersion` rows                 | —                                                                                                                                     |
| Collaboration state | In-memory Y.Doc                        | `contentJson` via client autosave (canonical); `collabRecoverySnapshot` is a best-effort eviction recovery aid, not a source of truth |
| Block identity      | `bid` fields in Lexical nodes          | `anchorBlockId` in `Visual` rows                                                                                                      |
| Share state         | `Document.isShared`, `shareId`, `slug` | Public URLs                                                                                                                           |

---

## 12. Write Paths

### Supported (current)

- **Lexical autosave** → `saveDocumentLexical` → `atomicSaveDocumentLexical` (contentJson + mirror in one tx)
- **Deck full save** → `saveDeckJson` → `persistDeck` (CAS token)
- **Version restore** → `restoreDocumentVersion` → `restoreVersion` (checkpoint + atomic restore)
- **Mirror rebuild** → `rebuildVisualMirror` → `rebuildMirror` (repair, idempotent)
- **Collab flush on evict** → `onBeforeEvict` (`createEvictionFlusher`) → `POST /api/collab/flush` → best-effort recovery snapshot on `Document.collabRecoverySnapshot` (NOT canonical; `contentJson` remains the source of truth)

---

## Architecture Documents

| Document                                                                               | Status   | Notes                                                    |
| -------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------- |
| [../ai/generation.md](../ai/generation.md)                                             | Current  | AI generation request flow and validation contracts      |
| [../auth/README.md](../auth/README.md)                                                 | Current  | Authentication and account lifecycle                     |
| [../collaboration/README.md](../collaboration/README.md)                               | Current  | Collaboration room model and runtime readiness           |
| [../data-model/deck.md](../data-model/deck.md)                                         | Current  | Deck schema, source refs, rendering, and persistence     |
| [../data-model/database-persistence.md](../data-model/database-persistence.md)         | Current  | Prisma provider resolution and relational model          |
| [../data-model/document-persistence.md](../data-model/document-persistence.md)         | Current  | Document save transactions and version restore           |
| [../data-model/visual-mirror.md](../data-model/visual-mirror.md)                       | Current  | Visual projection contract                               |
| [../documents/README.md](../documents/README.md)                                       | Current  | Document creation, listing, search, tags, and trash      |
| [../editor/comments-and-anchors.md](../editor/comments-and-anchors.md)                 | Current  | Comment threads and document/slide anchors               |
| [../editor/document-editor.md](../editor/document-editor.md)                           | Current  | Editor surfaces, visual lifecycle, and deck autosave UX  |
| [../presentation/theme-packages.md](../presentation/theme-packages.md)                 | Current  | Theme packages, semantic templates, styles, and chrome   |
| [../import/README.md](../import/README.md)                                             | Current  | Document import validation, parsing, and abuse controls  |
| [../localization/README.md](../localization/README.md)                                 | Current  | Localization catalogs, locale resolution, and activation |
| [../presentation/assets.md](../presentation/assets.md)                                 | Current  | Slide asset upload, serving, references, and cleanup     |
| [../presentation/slide-editor.md](../presentation/slide-editor.md)                     | Current  | Slide editor runtime and interaction boundaries          |
| [../presentation/rendering-and-export.md](../presentation/rendering-and-export.md)     | Current  | Shared rendering, present mode, and export pipeline      |
| [../product/billing.md](../product/billing.md)                                         | Current  | Plan entitlements, providers, and AI credits             |
| [../product/brand-studio.md](../product/brand-studio.md)                               | Current  | Saved brand styles and brand asset lifecycle             |
| [../public-render/README.md](../public-render/README.md)                               | Current  | Public render resolver, metadata, and asset access       |
| [../security/access-and-sharing.md](../security/access-and-sharing.md)                 | Current  | Document permissions, public links, and asset access     |
| [../security/workspaces.md](../security/workspaces.md)                                 | Current  | Workspace roles, invites, and membership behavior        |
| [../visual/README.md](../visual/README.md)                                             | Current  | Visual schema, registry, rendering, and export support   |
| [../commands/command-envelope.md](../commands/command-envelope.md)                     | Current  | Cross-surface command envelope                           |
| [../commands/mutation-routing-inventory.md](../commands/mutation-routing-inventory.md) | Current  | Mutation inventory and routing decisions                 |
| [documentation-map.md](documentation-map.md)                                           | Current  | Code subsystem to documentation coverage map             |
| [architecture-decisions.md](architecture-decisions.md)                                 | Current  | ADR index, supersession status, and source-drift rule    |
| [realtime-collaboration-scaling.md](realtime-collaboration-scaling.md)                 | Accepted | ADR: realtime collaboration scaling and durability       |
| [slide-canvas-keyboard-accessibility.md](slide-canvas-keyboard-accessibility.md)       | Accepted | ADR: canvas keyboard accessibility decisions             |
| [../operations/collaboration-deployment.md](../operations/collaboration-deployment.md) | Current  | Collaboration deployment and scaling                     |
| [../operations/release-gate.md](../operations/release-gate.md)                         | Current  | Release readiness checklist                              |
| [../operations/resource-limits.md](../operations/resource-limits.md)                   | Current  | Resource limit inventory and budget helpers              |
