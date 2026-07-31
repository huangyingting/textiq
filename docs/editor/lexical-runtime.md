---
type: "architecture"
status: "current"
last_updated: "2026-07-31"
description: "Lexical runtime implementation contract for durable block ids, visual nodes, core plugin registration, editor actions, and visual editing write paths."
---

# Lexical Runtime Contract

This document covers the implementation layer under the document editor: durable
block ids, `VisualNode` serialization, core plugin registration, and the server
actions that persist Lexical content. Product-level editor behavior lives in
[document-editor.md](document-editor.md); visual persistence projection lives in
[../data-model/visual-mirror.md](../data-model/visual-mirror.md).

## Source Files

| Area                    | Source                                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Durable block ids       | [`src/lib/lexical/block-id.ts`](../../src/lib/lexical/block-id.ts)                                                         |
| Live block-id runtime   | [`src/lib/lexical/block-id-runtime.ts`](../../src/lib/lexical/block-id-runtime.ts)                                         |
| Visual Lexical node     | [`src/lib/lexical/visual-node.tsx`](../../src/lib/lexical/visual-node.tsx)                                                 |
| Core plugin list        | [`src/lib/lexical/editor-plugins.tsx`](../../src/lib/lexical/editor-plugins.tsx)                                           |
| Shared Lexical commands | [`src/lib/lexical/commands.ts`](../../src/lib/lexical/commands.ts)                                                         |
| Inline visual card      | [`src/app/app/documents/[id]/visual-card.tsx`](../../src/app/app/documents/%5Bid%5D/visual-card.tsx)                       |
| Visual popover          | [`src/app/app/documents/[id]/visual-context-popover.tsx`](../../src/app/app/documents/%5Bid%5D/visual-context-popover.tsx) |
| Lexical save action     | [`src/app/app/documents/[id]/lexical-actions.ts`](../../src/app/app/documents/%5Bid%5D/lexical-actions.ts)                 |

## Durable Block Ids

Durable block ids are stored as `bid` on serialized block-level Lexical nodes.
They are distinct from Lexical `NodeKey` values: `NodeKey` is live and
transient, while `bid` is stable across save/reload and text edits inside the
same block.

`stampBlockIds` walks raw `contentJson` and adds missing `bid` values without
rewriting existing ones. `regenerateBlockIds` assigns fresh `bid` values to
every block node and returns an old-to-new map; document duplication uses that
map to remap anchors and in-document references into the copied document's
identity space.

The live editor runtime installs prototype support once per runtime through
`ensureLexicalBlockIdSupport`. `registerBlockIdTransforms` then stamps newly
created paragraphs, headings, quotes, list items, horizontal rules, and tables
before they are serialized or synchronized. The `DurableBlockIdPlugin` runs a
discrete repair update tagged with `BLOCK_ID_REPAIR_TAG` on editor mount, so
old content can be upgraded in place without changing node types.

## Core Plugin Registration

`createCoreEditorPlugins` is the plugin inventory for the main document editor.
The plugin order is intentional:

1. Rich-text surface and Lexical collaboration are registered first so the
   editor has a contenteditable root and Yjs provider.
2. Durable block ids, editable gating, and local fallback seeding repair runtime
   state around collaboration readiness.
3. Document stats, list/link/table/horizontal-rule plugins add feature behavior.
4. `OnChangePlugin` is the autosave trigger and ignores selection/history-merge
   changes.

Collaboration is the only plugin that talks to Yjs. Feature tools and visual
editing still mutate through Lexical commands or `editor.update()`; they do not
write Yjs documents directly.

## VisualNode Contract

`VisualNode` is a Lexical `DecoratorNode` that makes a visual a first-class
block in `contentJson`. Its serialized shape stores:

```ts
type SerializedVisualNode = {
  type: "visual";
  visual: Visual;
  visualId: string;
};
```

`visual` is the canonical visual payload. `visualId` is the stable id used to
correlate the node with derived `Visual` database rows and to target inline
editing. The node renders through `VisualNodeRendererProvider`; if no renderer
is installed, it degrades to a small "Visual unavailable" placeholder instead
of crashing the editor.

HTML copy/paste round-trips through `exportDOM` and `importDOM`. Export embeds
`data-lexical-visual-id` and a JSON `data-lexical-visual` payload. Import
re-parses the payload with `safeParseVisual`; invalid or absent payloads skip
the conversion. A pasted visual receives a fresh `visualId`, so it cannot
collide with the source node's mirrored row.

## Visual Editing Write Path

The inline visual UI uses two layers:

- `VisualContextPopover` owns controls: theme, colors, typography, kind switch,
  source sync, export, effects, variations, and brand application.
- `VisualCard` owns the Lexical write. It applies pure visual transforms or
  typed visual commands, then calls `node.setVisual(next)` inside
  `editor.update()`.

Pure transforms in `src/lib/visual/transforms.ts` are framework-free and never
mutate their input. Typed visual commands route through `applyVisualCommand`,
which validates the command envelope, returns affected ids and side effects, and
leaves the final `node.setVisual` call in the Lexical owner. On command failure,
the visual is left unchanged.

Visual editing UI visibility is local React state in `VisualCard`, not a
persisted Lexical selection. This is deliberate: collaborative Yjs updates do
not preserve decorator `NodeSelection` state reliably, so card-open state is a
client UI concern only.

When an editable card is closed, its PNG download, copy-image, and native-share
shortcuts use one synchronous browser-operation boundary. Duplicate or
competing activation cannot start a second rasterization; the strip reports
busy state and disables all three actions until settlement. Failures stay
visible with an explicit dismiss/retry path, while native-share cancellation is
a normal outcome. The strip is hover/focus revealed for fine pointers and uses
the shared coarse-pointer visibility and touch-target contracts on touch input.

## Server Action Boundary

`saveDocumentLexical` is the server write boundary for serialized editor state.
It requires the current user, checks the size limit, parses JSON, stamps missing
block ids, requires document `edit` capability, then delegates the atomic write
and visual mirror rebuild to `atomicSaveDocumentLexical`.

`rebuildVisualMirror` is an idempotent repair action. It requires edit access,
loads current `contentJson`, rebuilds derived `Visual` rows from that state, and
does not snapshot or modify `contentJson`.

## Invariants

1. `contentJson` is the source of truth for document body and inline visuals.
2. Persisted anchors use durable ids such as `bid` and `visualId`; Lexical
   `NodeKey` values are never stored.
3. Visual edits write through `node.setVisual` inside `editor.update()`.
4. Yjs is driven by Lexical collaboration, never by contextual tool code.
5. Invalid pasted visual payloads are ignored instead of repaired into the
   document.
6. Visual mirror rebuilds are derived projections, not independent content
   state.

## Primary Tests

- [`src/lib/lexical/block-id.test.ts`](../../src/lib/lexical/block-id.test.ts)
- [`src/lib/lexical/visual-node.test.ts`](../../src/lib/lexical/visual-node.test.ts)
- [`src/lib/lexical/visual-nodes.test.ts`](../../src/lib/lexical/visual-nodes.test.ts)
- [`src/lib/lexical/insert-visual.test.ts`](../../src/lib/lexical/insert-visual.test.ts)
- [`src/app/app/documents/[id]/visual-card.test.tsx`](../../src/app/app/documents/%5Bid%5D/visual-card.test.tsx)
- [`src/lib/lexical/visual-edit-roundtrip.test.ts`](../../src/lib/lexical/visual-edit-roundtrip.test.ts)
