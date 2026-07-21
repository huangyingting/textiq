---
type: "contract"
status: "accepted"
last_updated: "2026-07-21"
description: "Date: 2026-06-23 Issue: #438 / Epic #436 — Cross-surface command envelope for document visuals and deck artifacts Authors: Switch (Frontend Dev)"
---

# Command Envelope Spec

**Date:** 2026-06-23  
**Issue:** #438 / Epic #436 — Cross-surface command envelope for document visuals and deck artifacts  
**Authors:** Switch (Frontend Dev)

---

## Purpose

Define one serializable envelope for command traffic across document-adjacent
surfaces without mixing transport metadata into each domain executor.

The envelope standardizes:

- actor + timestamp metadata,
- stable target addressing,
- schema versioning,
- coalescing hints,
- surface-specific payload routing.

---

## Envelope

```ts
interface CommandEnvelope<P = unknown> {
  id: string; // UUID v4
  schemaVersion: number; // CURRENT_COMMAND_SCHEMA_VERSION = 1
  type: string;
  timestamp: string; // ISO-8601
  actor: { id: string; sessionId?: string };
  target: {
    surface:
      "document" | "visual" | "deck" | "asset" | "comment" | "source-ref";
    documentId?: string;
    visualId?: string;
    slideId?: string;
    elementId?: string;
    assetId?: string;
    commentId?: string;
    sourceRefId?: string;
    expectedRevision?: string;
    expectedSourceHash?: string;
  };
  payload: P;
  coalesceKey?: string;
  source?: "user" | "ai" | "sync" | "replay";
}
```

### Invariants

- `id` is always UUID v4.
- `schemaVersion` is a positive integer.
- `timestamp` is a valid ISO-8601 timestamp.
- `target.surface` determines the minimum stable identifiers required.
- `coalesceKey` is advisory metadata for undo/history grouping, not execution.
- payloads are JSON-safe and versioned through the envelope schema version:
  plain objects/arrays/primitives only, with no functions, symbols, bigint,
  undefined values, or cycles.

---

## Current schema version

```ts
export const CURRENT_COMMAND_SCHEMA_VERSION = 1;
```

Version `1` covers:

- visual command routing,
- deck-command wrapping via `CommandEnvelope<SlideCommand>`,
- cross-surface patch metadata,
- pure server-safe envelope validation.

---

## Target addressing rules

| Surface      | Required target id(s) | Notes                                               |
| ------------ | --------------------- | --------------------------------------------------- |
| `document`   | `documentId`          | Document-scoped mutations                           |
| `visual`     | `visualId`            | `documentId` is optional but recommended when known |
| `deck`       | `documentId`          | Deck remains stored on the `Document` row           |
| `asset`      | `assetId`             | Asset storage / DB writes remain server-only        |
| `comment`    | `commentId`           | Comment commands are future work                    |
| `source-ref` | `sourceRefId`         | Reserved for future source-link command routing     |

`expectedRevision` carries optimistic-lock expectations for persisted deck or
visual saves. `expectedSourceHash` is reserved for source-linked workflows.

---

## Payload families

### Visual payloads

`type === payload.op` and `type` is one of the supported `visual.*` ops.

Current supported ops:

- `visual.apply_theme`
- `visual.set_style`
- `visual.apply_display_style`
- `visual.set_kind`
- `visual.set_canvas_style`
- `visual.set_aspect_ratio`
- `visual.set_auto_layout`
- `visual.set_node_style`
- `visual.reset_node_style`
- `visual.set_node_ext_style`
- `visual.reset_node_ext_style`
- `visual.set_node_icon`
- `visual.clear_node_icon`
- `visual.set_node_label`
- `visual.set_edge_label`
- `visual.set_edge_style`
- `visual.flip_edge`
- `visual.toggle_edge_directed`
- `visual.toggle_edge_style`
- `visual.set_all_edges_style`
- `visual.set_effect`
- `visual.clear_effect`
- `visual.merge_content`
- `visual.add_node`
- `visual.delete_node`
- `visual.add_edge`
- `visual.delete_edge`
- `visual.reconnect_edge`
- `visual.duplicate_node`
- `visual.relayout_graph`

### Deck payloads

Deck command envelopes validate addressing and optimistic-lock metadata. The
Deck mutation semantics remain owned by the presentation editor command
layer:

```ts
type DeckCommandEnvelope<P = unknown> = CommandEnvelope<P>;
```

`acceptDeckCommandEnvelope` validates `target.surface === "deck"` and the
submitted `documentId`. Command execution remains outside the envelope parser;
Deck mutations are implemented in `src/lib/presentation/editor-commands.ts`.
The envelope `type` for deck commands must exactly equal the wrapped
`payload.type`; mismatched deck envelope and payload command types are rejected.

---

## Result shape

Cross-surface metadata is normalized as:

```ts
interface CrossSurfaceCommandResult<Patch = unknown, SideEffect = never> {
  ok: boolean;
  error?: string;
  affectedIds: {
    documentIds: string[];
    visualIds: string[];
    slideIds: string[];
    elementIds: string[];
    assetIds: string[];
    commentIds: string[];
    sourceRefIds: string[];
    nodeIds: string[];
    edgeIds: string[];
  };
  coalesceKey?: string;
  patches: Patch[];
  sideEffects: SideEffect[];
}
```

This is intentionally a superset of the existing deck `CommandResult`
metadata. Deck results are adapted; visual results produce the same shape
natively.

---

## Side effects

Side effects are explicit metadata, not inline imperative work.

Current visual side effects:

- `visual_mirror_rebuild`
- `source_staleness_recompute`
- `render_invalidation`

This keeps executors pure while still telling persistence / projection layers
what must happen after a successful command.

---

## Validation contract

`validateCommandEnvelope()` is pure and checks:

- envelope structure,
- actor / target metadata,
- required ids for the addressed surface,
- visual payload structure and supported literal values,
- deck payload shape (`payload.type` string present).

For `visual.add_edge`, structural validation now rejects malformed edge
envelopes at the boundary: `target.surface` must be `visual`, `target.visualId`
must be a non-empty string, `type` must match `payload.op`, `payload.edge` must
be an object, and `payload.edge.from` / `payload.edge.to` must be non-empty
strings. Optional edge fields are still validated before execution:
`payload.edge.id` must be a non-empty string when provided, `label` must be a
string, `directed` must be boolean, `style` must be a supported edge style, and
`arrowStyle` / `lineStyle` / `lineWidth` must match the edge-style contract.
Unknown fields under `payload.edge` are rejected. Graph-aware checks such as
whether the source/target node ids exist remain executor concerns because the
pure envelope validator does not load the visual graph.

Server validation layers add context-aware checks such as:

- actor authorization against a document,
- target existence,
- optimistic revision conflicts,
- future schema rejection (`schemaVersion > CURRENT_COMMAND_SCHEMA_VERSION`).

For visual commands, `validateVisualCommand()` layers those checks onto the
envelope result: a missing or wrong visual target is rejected before execution,
`target.documentId` / `target.visualId` must match the request context when
present, and `target.expectedRevision` must match the current revision or the
command is rejected with `stale_revision`.

For the deck-command write path these checks are implemented by
`acceptDeckCommandEnvelope()` (in `command-envelope.ts`), which layers
schema-version, target-surface (`deck`), and target-document checks on top of
`validateCommandEnvelope()` and returns a stable `EnvelopeRejectionCode`
(`malformed` | `unsupported_schema_version` | `wrong_target` | `wrong_document`).
The `saveDeckCommand` server action calls it before executing the command and
persisting under the revision-token CAS (`target.expectedRevision`). Stale
revisions stay an optimistic-lock (CAS) concern in the persistence layer, not a
structural validation error.

---

## Coalescing rules

The envelope does not force one global merge strategy. Instead:

- deck history keeps using `coalesceCommands()` from `slide-commands.ts`;
- visual history uses `coalesceVisualCommands()` with matching `coalesceKey` +
  target semantics;
- mixed command streams coalesce contiguous runs per surface.

This preserves existing deck behavior while extending the same concept to
visual edits.

---

## Interaction With Slide Commands

The command envelope is deliberately additive:

- `SlideCommand` remains unchanged;
- `DeckPatch` remains unchanged;
- `CommandResult` remains unchanged;
- adapters map deck results into the cross-surface metadata shape when a caller
  wants one mixed command stream.

That is the key non-forking rule of Epic #436.
