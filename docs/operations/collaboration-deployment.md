---
type: "runbook"
status: "current"
last_updated: "2026-08-02"
description: "Real-time collaborative editing (multiple cursors, presence, conflict-free merges) is powered by a self-hosted Yjs websocket sync server, scripts/collab-server.mjs. The browser editor connects to it through useLexicalCollaboration. The application-level room/readiness/access contract is documented in ../collaboration/README.md."
---

# Collaboration server — deployment & scaling

Real-time collaborative editing (multiple cursors, presence, conflict-free
merges) is powered by a self-hosted Yjs websocket sync server,
[`scripts/collab-server.mjs`](../../scripts/collab-server.mjs). The browser editor
connects to it through
[`useLexicalCollaboration`](../../src/lib/collab/use-lexical-collaboration.ts).
The application-level room/readiness/access contract is documented in
[../collaboration/README.md](../collaboration/README.md).

This document describes how to run that server in production, the **required
single-instance operational constraint**, what happens to live rooms on restart
or deploy, and the upgrade paths for when you need horizontal scale or durable
collab state.

The app degrades gracefully to local-only editing when the server is unreachable
(see [Graceful degradation](#graceful-degradation)).

## What the server does

- Implements the canonical y-websocket wire protocol (`messageSync` /
  `messageAwareness` / `messageQueryAwareness`) against the **same** `yjs` /
  `y-protocols` / `lib0` versions the browser client uses, so there is no
  protocol/version skew.
- Holds **one in-memory `Y.Doc` ("room") per document id**. Clients connect to
  `ws://host:port/<documentId>` — the path segment is the room name.
- Tracks presence (awareness) per room and relays it to the other clients.
- Exposes a plain-HTTP `GET /health` endpoint (see [Health endpoint](#health-endpoint))
  for liveness/readiness probes and operational visibility.
- Keeps a room in memory after its last client disconnects, so a reconnecting
  client re-syncs without a round-trip to the database.
- Handles `SIGINT` and `SIGTERM` through a shared graceful-shutdown path that
  drains dirty rooms before the HTTP and application layers close.

It is **runtime tooling, not part of the Next.js bundle** — it runs as its own
Node process alongside the web app.

## Required operational constraint: single instance

> **You MUST run exactly one instance of the collaboration server.** Running
> multiple instances without sticky routing will cause silent edit divergence and
> is actively blocked by the startup guard (see below).

The server stores every room's `Y.Doc` in a **process-local `Map`** that is
never shared with other processes. If you run more than one instance behind a
load balancer without sticky routing, two clients editing the same document but
routed to different instances each get a separate in-memory room — **they will
not see each other's edits or presence**, and Yjs cannot merge across the gap.
This is data-correctness corruption, not just a performance issue.

### Declaring single-instance mode

Set `COLLAB_SINGLE_INSTANCE=1` in your production environment to explicitly
declare that you are running a single instance. The server will log
`[mode: single-instance]` at startup and the `/health` endpoint will report
`"mode": "single-instance"` with no warnings.

```bash
COLLAB_SINGLE_INSTANCE=1 COLLAB_PORT=1234 npm run collab
```

Without this flag the server starts with an advisory warning reminding you to
set it. The server is still **healthy** in this case (a single unannounced
instance is fine), but the warning is logged on every start to prompt
intentional configuration.

### Multi-instance with sticky routing (stopgap only)

If you must run multiple instances for capacity, you MUST configure sticky
routing at your load balancer and set `COLLAB_STICKY_ROUTING=1`. The startup
guard uses these two variables together:

- `COLLAB_INSTANCE_COUNT=N` + no `COLLAB_STICKY_ROUTING=1` → **startup aborts**
  with a fatal error. This is the data-divergence case; the server refuses to
  start.
- `COLLAB_INSTANCE_COUNT=N` + `COLLAB_STICKY_ROUTING=1` → startup succeeds.
  The health endpoint reports `"mode": "unconfigured"` (not single-instance) but
  no warnings.

Sticky routing is a stopgap, not a recommendation. See [Scaling options](#scaling-and-persistence-options)
for a durable horizontal-scale path.

### Startup guard behaviour

The startup guard runs before the server accepts any connections. It is
implemented in [`scripts/collab-deployment-config.mjs`](../../scripts/collab-deployment-config.mjs)
(plain ESM adapter, used by both entry points) backed by the canonical shared
policy in
[`src/lib/collab/deployment-config-source.mjs`](../../src/lib/collab/deployment-config-source.mjs)
and exposed to TypeScript via
[`src/lib/collab/deployment-config.ts`](../../src/lib/collab/deployment-config.ts).

| Env configuration                                          | Startup result    | Health `mode`     | `healthy` |
| ---------------------------------------------------------- | ----------------- | ----------------- | --------- |
| `COLLAB_SINGLE_INSTANCE=1`                                 | ✅ starts cleanly | `single-instance` | `true`    |
| `COLLAB_INSTANCE_COUNT=N` (N>1), no sticky                 | ❌ fatal exit(1)  | —                 | `false`   |
| `COLLAB_INSTANCE_COUNT=N` (N>1), `COLLAB_STICKY_ROUTING=1` | ✅ starts cleanly | `unconfigured`    | `true`    |
| Nothing set (default)                                      | ⚠ advisory warn   | `unconfigured`    | `true`    |

## Running it in production

```bash
# From the repo root, with production env vars set:
COLLAB_SINGLE_INSTANCE=1 COLLAB_PORT=1234 npm run collab
# (equivalent to: node scripts/collab-server.mjs)
```

Recommended production setup:

1. **Set `COLLAB_SINGLE_INSTANCE=1`** to explicitly declare single-instance mode
   and suppress the advisory warning.
2. **Run it under a process manager** (systemd, pm2, or a container) so it
   restarts on crash. Use `GET /health` as the liveness/readiness check.
3. **Terminate TLS at a reverse proxy.** The server speaks plain `ws://`; put it
   behind nginx / Caddy / a cloud load balancer that upgrades the connection and
   serves `wss://`. Browsers on an HTTPS page **must** use a `wss://` URL.
4. **Point the app at it** with `NEXT_PUBLIC_COLLAB_WS_URL` (see the table below).
   Because it is a `NEXT_PUBLIC_*` variable, it is inlined into the client bundle
   **at build time** — set it before `npm run build`, not just at runtime.

### Environment reference

The complete runtime configuration inventory lives in
[runtime-config.md](./runtime-config.md). Collaboration-specific variables are
summarised here for convenience.

| Variable                     | Read by                 | Default                                                             | Description                                                                                                                              |
| ---------------------------- | ----------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `COLLAB_SINGLE_INSTANCE`     | collab server           | _(unset)_                                                           | Set to `1` or `true` to declare single-instance mode. Suppresses the startup advisory and sets `"mode": "single-instance"` in `/health`. |
| `COLLAB_INSTANCE_COUNT`      | collab server           | `1`                                                                 | Number of collab instances behind the load balancer. Set >1 only with `COLLAB_STICKY_ROUTING=1`; otherwise the server refuses to start.  |
| `COLLAB_STICKY_ROUTING`      | collab server           | _(unset)_                                                           | Set to `1` or `true` to declare that sticky routing is configured at the load balancer. Required when `COLLAB_INSTANCE_COUNT>1`.         |
| `COLLAB_PORT`                | standalone collab       | `1234`                                                              | TCP port the standalone websocket + `/health` HTTP server listens on.                                                                    |
| `COLLAB_HOST`                | standalone collab       | `0.0.0.0`                                                           | Bind address. Keep `0.0.0.0` behind a reverse proxy; narrow it if the proxy is on the same host.                                         |
| `NEXT_PUBLIC_COLLAB_WS_URL`  | browser editor (client) | page origin + `/collab` (SSR fallback `ws://localhost:4000/collab`) | WebSocket URL the editor connects to. Use `wss://collab.example.com` for a standalone production endpoint. Inlined at build time.        |
| `NEXT_PUBLIC_COLLAB_WS_PORT` | browser editor (client) | `4000`                                                              | Port used only for the SSR/non-browser fallback when `NEXT_PUBLIC_COLLAB_WS_URL` is unset.                                               |

`COLLAB_PORT` / `COLLAB_HOST` configure the server process;
`NEXT_PUBLIC_COLLAB_WS_URL` configures the client. In production they describe
the two ends of the **same** endpoint (the public `wss://` URL terminates at the
proxy, which forwards to `COLLAB_HOST:COLLAB_PORT`).

## Authorization

Every WebSocket upgrade is authorized before the handshake completes. The core
server (`createCollabWss`) requires an `authorize(req, room)` callback and will
not start without one.

Both entry points use the same rule:

- **Inline server (`server.mjs`)**: forwards cookies to
  `/api/collab/authorize` on the same HTTP server for `/collab/<documentId>`.
- **Standalone server (`scripts/collab-server.mjs`)**: forwards cookies to
  `COLLAB_AUTHORIZE_URL`, defaulting to `${AUTH_URL}/api/collab/authorize` or
  `http://127.0.0.1:4000/api/collab/authorize`.

The authorize route maps application permissions to collab access:

| Capability | WebSocket behavior                          |
| ---------- | ------------------------------------------- |
| no access  | upgrade refused with 401/403                |
| `view`     | connection accepted as read-only            |
| `edit`     | connection accepted with update permissions |

Read-only connections receive sync replies and awareness updates, but update
messages are dropped server-side.

## Health endpoint

Both the standalone server (`GET /health`) and the inline collab socket
(`GET /collab/health`) return a JSON health summary:

```json
{
  "ok": true,
  "rooms": 3,
  "connections": 7,
  "mode": "single-instance",
  "warnings": [],
  "healthy": true,
  "recoveryFlushConfigured": true,
  "flushFailures": 0,
  "recentFlushFailureCount": 0
}
```

| Field                     | Type       | Description                                                                                                       |
| ------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------- |
| `ok`                      | `boolean`  | `true` when the configuration is healthy. Use this for liveness/readiness checks.                                 |
| `rooms`                   | `number`   | In-memory rooms currently alive (documents with at least one connected client, or recently disconnected).         |
| `connections`             | `number`   | Total active WebSocket connections across all rooms.                                                              |
| `mode`                    | `string`   | `"single-instance"` (explicitly declared) or `"unconfigured"`.                                                    |
| `warnings`                | `string[]` | Advisory or error messages from the deployment-config check.                                                      |
| `healthy`                 | `boolean`  | Mirrors `ok`; `false` means the configuration is actively harmful.                                                |
| `recoveryFlushConfigured` | `boolean`  | `true` when a non-blank internal secret enables dirty-room recovery flushes. The secret itself is never returned. |
| `flushFailures`           | `number`   | Process-lifetime count of best-effort recovery-flush failures.                                                    |
| `recentFlushFailureCount` | `number`   | Number of sanitized failure entries currently retained in the bounded observability ring.                         |

## Restart and deploy behavior

### What happens to live rooms on restart/deploy

On a normal `SIGINT` or `SIGTERM` deploy, both the inline and standalone entry
points use this ordered shutdown sequence:

1. **Stop accepting collaboration upgrades.** New or in-flight upgrades receive
   HTTP 503 once shutdown begins.
2. **Close active WebSocket connections with code 1012 (`Service restart`).** The
   server waits up to five seconds for close handshakes, then terminates any
   remaining sockets.
3. **Drain every in-memory room.** Dirty rooms invoke the same recovery-snapshot
   flusher used by idle eviction. Flushes run in parallel and finish while the
   inline app's internal HTTP endpoint is still reachable; clean rooms do not
   issue a write.
4. **Destroy room state, then close HTTP and the Next application.** HTTP gets a
   separate five-second drain window before remaining connections are forced
   closed.

`SIGKILL`, process crashes, host loss, and power loss cannot run this sequence;
those failures still drop in-memory rooms immediately. In every restart mode:

1. **Clients reconnect and re-seed the room from the database.** The editor's
   autosave writes the document content to the app database through debounced
   server actions. On reconnect, the first client to join re-seeds the in-memory
   room from the DB snapshot; subsequent clients receive the full document through
   the normal Yjs sync step.
2. **Awareness (presence) is lost and rebuilt.** Live cursors and user-presence
   states are not persisted. They reappear as clients reconnect and re-announce
   their presence.

This process is transparent to users in most cases: the editor degrades to
local-only mode during the restart window and automatically recovers when the
server comes back.

### Debounce-window data-loss risk

The editor autosaves through a **debounced server action** (configurable, default
roughly 1–2 s). If the collab server restarts while edits are still in the
debounce window:

- Edits already flushed to the database are safe — they will be in the re-seeded
  room after reconnect.
- Edits in the **last debounce window** that have not yet been flushed to the
  database will be **absent from the normal collaborative state** after restart
  because the room re-seeds from the DB snapshot. A graceful shutdown with
  `COLLAB_INTERNAL_SECRET` configured preserves the dirty Yjs state as a
  best-effort recovery snapshot; crashes, forced termination, missing secrets,
  or flush failures may leave no snapshot.
- Each reconnecting client will re-seed the room from the DB, so the loss is the
  same for all clients — there is no silent divergence, just a short rollback
  to the last persisted state.

**Mitigation:** configure `COLLAB_INTERNAL_SECRET`, give the process at least a
20-second termination grace period, deploy during low-traffic windows, and keep
the autosave debounce as short as acceptable for your write throughput. The
CRDT ensures that after any rollback all clients converge on the same (slightly
older) canonical document state.

### Rolling deploys

A **rolling deploy** (two versions of the collab server running simultaneously)
is **not safe** without sticky routing. If the old and new instances have
different in-memory rooms, a client that reconnects to a different instance will
get an empty or stale room. Always use a **stop-old / start-new** (blue-green or
restart-in-place) deploy strategy for the collab server, or use sticky routing
so each document's clients always reach the same instance.

## Graceful degradation

The editor never blocks on the collaboration server:

- `useCollaboration` creates the `Y.Doc` eagerly and connects the websocket
  provider in an effect. If the provider has **not** reported an initial sync
  within `DEGRADED_TIMEOUT_MS` (**2.5 s**), the hook flips `ready` to `true`
  anyway via a `degraded` flag, so editing is enabled in **local-only** mode.
- The connection pill in the UI reflects the state (`Live` / `Connecting…` /
  `Offline`).
- When the server later becomes reachable, the provider reconnects and the
  client re-syncs; offline edits merge via the CRDT.
- **The database is the durable source of truth.** Text, title, and the selected
  visual autosave to the app database through debounced server actions
  independent of the collab server, so a server outage degrades collaboration to
  single-user editing without data loss.

This means a misconfigured or down collaboration server is a **soft failure**:
users keep editing; they just don't see each other in real time until it
recovers.

## Single-instance, in-memory limitation

The server stores every room's `Y.Doc` in a **process-local `Map`** (`const docs
= new Map()`). That state is never written to disk and never shared with other
processes. Two consequences follow:

1. **It does not scale horizontally as-is.** If you run more than one instance
   behind a load balancer without sticky routing, two clients editing the
   **same** document but connected to **different** instances each get a separate
   in-memory room and will **not** see each other's edits or presence. The
   startup guard prevents this misconfiguration by exiting with an error when
   `COLLAB_INSTANCE_COUNT>1` without `COLLAB_STICKY_ROUTING=1`.
2. **Room state is volatile.** A restart, crash, or deploy drops all in-memory
   rooms. This is largely masked by the app's database autosave (a fresh client
   re-seeds the room from the DB), but any edits still inside the last debounce
   window and all live presence are lost on restart.

For a single instance these limits are usually fine — a vertically-scaled node
plus the DB autosave safety net covers typical team usage. They only bite when
you need **multiple instances** (high availability or load) or **durable collab
state** across restarts.

## Scaling and persistence options

Listed from least to most involved. Pick based on whether you need horizontal
scale, durability, or both.

### Option A — Sticky routing (no new dependency)

Route every websocket connection for a given room to the **same** instance, using
the load balancer's consistent hashing on the document id in the URL path (or
sticky sessions). One instance owns a room, so the existing in-memory sync keeps
working across a fleet. Set both `COLLAB_INSTANCE_COUNT=N` and
`COLLAB_STICKY_ROUTING=1` so the startup guard accepts the configuration.

- **Pros:** zero code change and no new infrastructure; immediate way to run more
  than one instance for capacity.
- **Cons:** a single hot document still can't exceed one instance; if a node
  fails its rooms are dropped (clients reconnect and re-seed from the DB); load
  can be uneven if a few documents are very busy.

### Option B — Shared pub/sub backplane (Redis)

Keep the in-memory rooms but add a per-room Redis **pub/sub** channel. When an
instance applies a Yjs update it publishes the binary update to Redis; every
instance subscribed to that room applies and rebroadcasts it to its own clients
(awareness is fanned out the same way).

- **Pros:** clients on **any** instance converge, so no sticky routing is needed;
  Redis is the only new dependency.
- **Cons:** adds a small broadcast hop of latency and an operational dependency;
  state is **still volatile** unless combined with persistence — a cold instance
  with no clients holds no room until one connects and re-seeds from the DB.

### Option C — Yjs persistence adapter (durable, and shareable)

Replace or augment the in-memory `Map` with a Yjs **persistence provider** that
stores each room's update log durably and (depending on the adapter) fans it out
across instances:

- **[`y-redis`](https://github.com/yjs/y-redis)** — uses Redis for **both**
  persistence **and** pub/sub fan-out. This is essentially Option B **plus**
  durability in one maintained package, and is the most production-ready path for
  a horizontally-scaled deployment.
- **[`y-leveldb`](https://github.com/yjs/y-leveldb)** — file-backed persistence
  for a **single** durable node: rooms survive restarts, but it does **not** share
  state across instances. Good for one always-on node that must not lose collab
  state on deploy.
- **A custom Postgres adapter** — persist Yjs update binaries to the database we
  already run in production. Keeps the stack lean, at the cost of owning the
  store/merge/compaction logic yourself.

- **Pros:** room state survives restarts; with `y-redis` you also get horizontal
  scale; pairs naturally with the existing DB content store.
- **Cons:** more moving parts; you store CRDT update logs that grow and need
  periodic compaction/snapshotting; the adapter must match the server's
  `yjs`/`y-protocols` versions to avoid skew.

### Recommendation

- **Multi-instance / HA:** adopt **`y-redis`** (Option C). It delivers the pub/sub
  fan-out of Option B and durability together, with Redis as the only added
  dependency.
- **Single durable node:** **`y-leveldb`** (Option C) is the lightest upgrade.
- **Quick multi-instance stopgap:** **sticky routing** (Option A) needs no new
  dependency; remember to set `COLLAB_STICKY_ROUTING=1`.

In every option the **application database remains the canonical content store**
(via the editor's autosave). The Yjs layer is a low-latency, conflict-free
transport plus short-term history — not the system of record — so a collab-layer
failure never loses a saved document.

> **Decision record:** the formal trade-off analysis and the chosen path live in
> [Realtime collaboration scaling and durability](../system/realtime-collaboration-scaling.md).

## Eviction recovery snapshot (best-effort)

When a dirty room is evicted (all clients gone, idle TTL elapsed, unsaved changes
detected) or drained during graceful shutdown, the server flushes the room's Yjs
update to the internal
`/api/collab/flush` endpoint, which stores it on `Document.collabRecoverySnapshot`
/ `collabRecoverySavedAt`. This is a **best-effort recovery aid only** — it is not
the source of truth and is not read on the normal load path. Configure it with:

- `COLLAB_INTERNAL_SECRET` — shared secret sent as the `x-collab-internal-secret`
  header and compared in constant time by the endpoint. When **unset**, the
  flusher is a no-op (logs one warning) and the endpoint returns `503`, so dev
  without the secret still runs — it just skips the recovery snapshot.

Both health endpoints surface configuration and aggregate flush observability
only: `recoveryFlushConfigured`, `flushFailures` (total counter), and
`recentFlushFailureCount` (count of entries currently retained in the in-memory
failure ring). Public health responses never include the internal secret, room
ids, or document ids for individual failures.

Shutdown emits structured `collab.server.shutdown` start/finish records. A
finish record with `ok: false` means a runtime layer failed to close and sets a
non-zero process exit code. Individual recovery flush failures continue to use
the existing `collab.flush.result` diagnostics and remain best-effort.
A document may be deleted while its disconnected room is still waiting for
eviction. In that terminal case the endpoint returns `404`; the flusher records
an informational `document-not-found` skip and does not increment
`flushFailures`, because recovery must never recreate the deleted row.
