---
type: "architecture"
status: "current"
last_updated: "2026-07-21"
description: "This subsystem covers the application-level collaboration contract: Yjs room identity, client readiness, degraded local-only mode, title sync, presence, and room authorization. Deployment and scaling procedures live in ../operations/collaboration-deployment.md."
---

# Collaboration Runtime

This subsystem covers the application-level collaboration contract: Yjs room
identity, client readiness, degraded local-only mode, title sync, presence, and
room authorization. Deployment and scaling procedures live in
[../operations/collaboration-deployment.md](../operations/collaboration-deployment.md).

## Source Anchors

| Area                         | Source                                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Lexical collaboration client | [`src/lib/collab/use-lexical-collaboration.ts`](../../src/lib/collab/use-lexical-collaboration.ts)                         |
| Plain text Y.Text binding    | [`src/lib/collab/use-collaboration.ts`](../../src/lib/collab/use-collaboration.ts)                                         |
| Room authorization decision  | [`src/lib/collab/room-access.ts`](../../src/lib/collab/room-access.ts)                                                     |
| Websocket URL resolution     | [`src/lib/collab/ws-url.ts`](../../src/lib/collab/ws-url.ts)                                                               |
| Collab authorize route       | [`src/app/api/collab/authorize/route.ts`](../../src/app/api/collab/authorize/route.ts)                                     |
| Eviction flush route         | [`src/app/api/collab/flush/route.ts`](../../src/app/api/collab/flush/route.ts)                                             |
| Standalone server            | [`scripts/collab-server.mjs`](../../scripts/collab-server.mjs), [`scripts/collab-core.mjs`](../../scripts/collab-core.mjs) |
| Flood controls and config    | [`scripts/collab-config.mjs`](../../scripts/collab-config.mjs), [`scripts/collab-core.mjs`](../../scripts/collab-core.mjs) |

## Room Model

Collaboration rooms are keyed by document id. Joining a room is equivalent to
opening the live Yjs document for that `Document`, so every upgrade is
authorized before the websocket handshake completes.

The database remains the durable source of truth:

- `Document.contentJson` is canonical for document body state.
- `Document.deckJson` is canonical for slides.
- Yjs room state is a low-latency collaboration transport and short-term
  history.
- `Document.collabRecoverySnapshot` is a best-effort recovery aid written on
  dirty room eviction, not a normal read-path source.

## Client Readiness And Degraded Mode

`useLexicalCollaboration` creates a `Y.Doc` and `y-websocket` provider for one
document room. The provider is constructed with `connect: false`; Lexical's
`CollaborationPlugin` owns connect/disconnect, while the hook observes status,
sync, awareness, and cleanup.

The editor is `ready` after either:

- the provider emits an initial sync; or
- the degraded fallback timer elapses.

In degraded mode, the editor runs local-only from the database value. This keeps
editing available when the collab server is down or unreachable. Autosave still
writes to the app database through normal server actions.

## Title And Presence

Lexical binds document body state through `@lexical/yjs`. The document title is
a separate `Y.Text` named `title`, bound by `useYText` so local and remote edits
can preserve caret position and classify transaction origins.

The title seed contract is intentionally self-healing: if the shared title is
empty and the database title is non-empty, the client seeds it into the room.
There is no permanent `titleSeeded` room latch, because an in-memory room can
outlive a transiently empty title and should be able to recover from the
database value.

Presence is stored in provider awareness. Peers are sorted with the local client
first, then by client id.

## Authorization

Room access maps document capabilities to websocket behavior:

| Capability result | Upgrade behavior                                                        |
| ----------------- | ----------------------------------------------------------------------- |
| no view access    | Refuse with 403 and conceal the document.                               |
| unauthenticated   | Refuse with 401 before room decision.                                   |
| view but not edit | Connect read-only; viewers receive updates/presence but mutations drop. |
| edit access       | Connect read-write.                                                     |

The shared access-decision taxonomy is used so collab denials align with API
and page denial semantics.

Long-lived websocket sessions are revalidated by the server when a reauthorize
callback is available. `scripts/collab-core.mjs` calls the same authorization
decision on an interval controlled by `COLLAB_ACCESS_REVALIDATE_MS` (default 60
seconds). If a user loses access, the document is deleted, or the authorization
check fails, the connection is closed. If the recheck still allows view but no
longer edit, the connection remains open but is downgraded to read-only for
subsequent sync updates.

## Flood Controls And Eviction

The collaboration server enforces per-upgrade, per-room, total-connection,
message-size, message-rate, and awareness-payload budgets. When a connection
exceeds message or awareness limits, the server logs `collab.core.flood` with a
safe reason and closes that connection. View-only connections still receive Yjs
sync and awareness updates, but sync-step-2 and update messages are ignored so
viewers cannot mutate the shared doc.

An empty room is not destroyed immediately. After the last connection closes,
the room is evicted after `ROOM_IDLE_TTL_MS` (60 seconds) unless a new
connection arrives first. When eviction finds pending updates newer than the
last confirmed durable save, it calls the optional eviction flusher with the
room name and a full Yjs update. That flush is best-effort recovery only: errors
are logged, eviction still completes, and the saved-state vector is cleared so
the database remains the durable source of truth.

`POST /api/collab/flush` accepts only object JSON payloads with a non-empty
`documentId` and a valid base64 `update`. Malformed JSON, missing bodies, and
non-object JSON values such as `null`, arrays, strings, or numbers are rejected
with HTTP 400 before the best-effort persistence path runs.

Flush observability is kept in memory as counters and a capped ring of recent
safe failure ids. Health surfaces can expose `flushAttempts`, `flushFailures`,
and recent failures without including document content.

## Websocket URL Resolution

The browser websocket base URL resolves in this order:

1. `NEXT_PUBLIC_COLLAB_WS_URL` explicit override.
2. Current page origin plus `/collab`, with `https` mapped to `wss`.
3. SSR/non-browser fallback `ws://localhost:${NEXT_PUBLIC_COLLAB_WS_PORT}/collab`.

Callers pass the document id as the room name; `y-websocket` appends it as the
path segment.

## Invariants

1. One collaboration room maps to one document id.
2. The app database remains the canonical persisted state.
3. Initial readiness is sync-or-degrade, never an indefinite blocked editor.
4. Viewers may connect read-only for live viewing but cannot mutate the room.
5. The title can reseed from the database when the shared title is empty.
6. Long-lived sessions are periodically reauthorized when server support is
   available.
7. Empty rooms evict after the idle TTL; eviction flush is best-effort recovery,
   not canonical persistence.
8. Provider and `Y.Doc` are destroyed on unmount.

## Primary Tests

- [`src/lib/collab/room-access.test.ts`](../../src/lib/collab/room-access.test.ts)
- [`src/lib/collab/deployment-config.test.ts`](../../src/lib/collab/deployment-config.test.ts)
- [`src/lib/lexical/use-collaboration-gate.test.ts`](../../src/lib/lexical/use-collaboration-gate.test.ts)
- [`scripts/collab-auth.test.mjs`](../../scripts/collab-auth.test.mjs)
- [`scripts/collab-runtime.test.mjs`](../../scripts/collab-runtime.test.mjs)
- [`scripts/collab-durability.test.mjs`](../../scripts/collab-durability.test.mjs)
- [`scripts/collab-flood-controls.test.mjs`](../../scripts/collab-flood-controls.test.mjs)
- [`scripts/collab-eviction.test.mjs`](../../scripts/collab-eviction.test.mjs)
- [`scripts/collab-flush.test.mjs`](../../scripts/collab-flush.test.mjs)
