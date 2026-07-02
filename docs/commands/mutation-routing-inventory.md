---
type: "reference"
status: "accepted"
last_updated: "2026-07-01"
description: "Date: 2026-06-23 Issue: #437 / Epic #436 — Cross-surface command envelope for document visuals and deck artifacts Authors: Switch (Frontend Dev)"
---

# Mutation Audit: Document Visuals and Deck Artifacts

**Date:** 2026-06-23  
**Issue:** #437 / Epic #436 — Cross-surface command envelope for document visuals and deck artifacts  
**Authors:** Switch (Frontend Dev)

> **Note (Epic #494):** there is no runtime "command bus" module. The
> implemented architecture is a serializable `CommandEnvelope` plus **pure
> executors** (`executeCommand` for deck, `executeVisualCommand` for visual)
> behind thin adapters (`commitCommand`, `applyVisualCommand`). References to a
> "command bus" below describe the routing concept, not a dispatcher object.

---

## Goal

Inventory every mutation path that touches document visuals, deck artifacts, or
closely-coupled projections so Epic #436 can route **user intent** through one
shared command envelope without forking a second command system.

The command routing rule is:

- keep existing pure deck commands as the deck executor;
- add a pure visual command executor over `src/lib/visual/transforms.ts`;
- leave projection-only and server-only write paths outside the user-intent bus,
  but make them explicit side effects.

---

## Categories

| Category          | Meaning                                                                    |
| ----------------- | -------------------------------------------------------------------------- |
| `slide-command`   | Already routed through `executeCommand` / `commitCommand`                  |
| `direct-mutation` | Local editor mutation today; candidate to be wrapped by a command envelope |
| `server-action`   | Server-only persistence / capability-gated mutation                        |
| `projection`      | Derived write; never a user-intent command                                 |

---

## Machine-usable inventory

```json
[
  {
    "surface": "document.contentJson",
    "category": "direct-mutation",
    "currentEntryPoints": [
      "src/lib/lexical/insert-visual.ts::$insertBlankVisualAfter",
      "src/app/app/documents/[id]/visual-context-popover.tsx::onChange(node.setVisual via editor.update)",
      "src/app/app/documents/[id]/overall-adjustments-panel.tsx::editor.update",
      "src/app/app/documents/[id]/visual-editor.tsx::onChange"
    ],
    "persistence": "src/app/app/documents/[id]/actions.ts::saveDocumentLexical",
    "busDisposition": "route visual edits through command envelopes before editor.update persists contentJson"
  },
  {
    "surface": "document.visualNode.visual",
    "category": "command-routed",
    "currentEntryPoints": [
      "src/app/app/documents/[id]/visual-card.tsx::handleCommand+removeSelectedNode",
      "src/app/app/documents/[id]/visual-context-popover.tsx::runVisualEdit+onCommand",
      "src/app/app/documents/[id]/mobile-editing-sheet.tsx::handleCommand",
      "src/app/app/documents/[id]/visual-editor.tsx::onCommand(visual.delete_node)",
      "src/app/app/documents/[id]/overall-adjustments-panel.tsx"
    ],
    "persistence": "embedded in Lexical contentJson; mirrored later",
    "busDisposition": "primary new visual command surface — user-intent edits routed through applyVisualCommand (Epic #494, #507); write-back, block-structure, bulk-brand, composite-reset, and continuous-gesture paths remain direct (documented exemptions)"
  },
  {
    "surface": "document.visualMirrorRows",
    "category": "projection",
    "currentEntryPoints": [
      "src/app/app/documents/[id]/actions.ts::mirrorVisualNodes"
    ],
    "persistence": "Visual / VisualRevision rows",
    "busDisposition": "side effect only (visual_mirror_rebuild)"
  },
  {
    "surface": "document.deckJson",
    "category": "slide-command",
    "currentEntryPoints": [
      "src/lib/presentation/editor-commands.ts",
      "src/components/presentation/slide-editor.tsx"
    ],
    "persistence": [
      "src/app/app/documents/[id]/actions.ts::saveDeckJson",
      "src/app/app/documents/[id]/actions.ts::saveDeckPatch"
    ],
    "busDisposition": "wrap existing SlideCommand payloads in CommandEnvelope; do not replace executor"
  },
  {
    "surface": "slide.assets",
    "category": "server-action",
    "currentEntryPoints": [
      "src/app/app/documents/[id]/slide-asset-actions.ts::uploadSlideAsset"
    ],
    "persistence": "Asset rows + storage adapter",
    "busDisposition": "outside user-intent bus for now"
  },
  {
    "surface": "comments.anchors",
    "category": "server-action",
    "currentEntryPoints": [
      "src/app/app/documents/[id]/comments-actions.ts::{createComment,editComment,deleteComment,setCommentResolved}"
    ],
    "persistence": "Comment rows",
    "busDisposition": "future envelope surface; not part of visual/deck executor scope"
  },
  {
    "surface": "slide.element.source",
    "category": "slide-command",
    "currentEntryPoints": [
      "src/lib/presentation/source-links.ts",
      "src/components/presentation/source-review-panel.tsx",
      "src/components/presentation/slide-editor.tsx"
    ],
    "persistence": "saveDeckJson/saveDeckPatch through deckJson",
    "busDisposition": "wrapped as UPDATE_ELEMENT_SOURCE / REMOVE_SOURCE_ELEMENT commands"
  },
  {
    "surface": "document.versionRestore",
    "category": "server-action",
    "currentEntryPoints": [
      "src/app/app/documents/[id]/actions.ts::restoreDocumentVersion"
    ],
    "persistence": "Document + mirrored Visual rows",
    "busDisposition": "server orchestrated restore, not a user-intent command replay"
  }
]
```

---

## Detailed inventory

### 1. `contentJson` (document editor state)

Current behavior:

- deterministic visual insertion mutates Lexical state inside
  `src/lib/lexical/insert-visual.ts::$insertBlankVisualAfter`;
- visual chrome mutates the selected embedded visual through
  `onChange(transform(...))` → `node.setVisual()` → `editor.update()` in
  `src/app/app/documents/[id]/visual-context-popover.tsx` and
  `src/app/app/documents/[id]/visual-editor.tsx`;
- document-wide theme/brand actions mutate every `VisualNode` inside
  `src/app/app/documents/[id]/overall-adjustments-panel.tsx`.

Persistence remains centralized in
`src/app/app/documents/[id]/actions.ts::saveDocumentLexical`, which stamps block
ids, writes `contentJson`, derives plain text, and then rebuilds visual mirrors.

**Audit decision:** the command envelope should own **visual-intent mutations**
before they are applied into Lexical state, but `saveDocumentLexical` remains the
single persistence path.

### 2. `VisualNode.visual` (embedded visual payload)

This is the core new surface for Epic #436.

The visual payload is mutated via pure transforms from
`src/lib/visual/transforms.ts`, then written back to the selected Lexical node
through `node.setVisual()`. The executor `executeVisualCommand`
(`src/lib/commands/visual-commands.ts`) is a pure adapter over those same
transforms and validates the command envelope before producing a result.

**Audit decision:** route user-intent edits through `applyVisualCommand`
(`src/lib/commands/visual-command-adapter.ts`) so each edit is validated and
carries patch / side-effect metadata before `node.setVisual()`.

**Status (Epic #494, #507): routed.** User-intent visual edits now flow through
the command executor at these seams:

- `visual-card.tsx` — `handleCommand` (popover/editor command sink) and
  `removeSelectedNode` (`visual.delete_node`). Invalid command output is never
  persisted (the write-back is skipped on `result.ok === false`).
- `visual-context-popover.tsx` — node style (`visual.set_node_style`), node ext
  style (fill / border / width / text-align / font-family →
  `visual.set_node_ext_style`), whole-visual style and font weight
  (`visual.set_style`), node icon set/clear, and all-edges style (arrow / line /
  width) now route through a local `runVisualEdit` helper that prefers the
  `onCommand` sink and falls back to the direct transform only when no sink is
  wired. Theme, display style, effects, kind, canvas, aspect ratio, and
  auto-layout already routed via `onCommand`.
- `mobile-editing-sheet.tsx` — now wires an `onCommand` handler
  (`applyVisualCommand` → `node.setVisual`) into the shared popover, so the
  mobile surface gets the same command coverage.
- `visual-editor.tsx` — discrete node deletion (`visual.delete_node`), edge
  flip (`visual.flip_edge`), arrowhead toggle (`visual.toggle_edge_directed`),
  curve toggle (`visual.toggle_edge_style`), and inline node/edge label commits
  (`visual.set_node_label` / `visual.set_edge_label`) route through an optional
  `onCommand` sink, falling back to the direct transform only when no sink is
  wired.

**Exempt (direct mutation, documented in code):**

- Generic write-back seams (`updateVisual`) — they receive an already-computed
  `Visual`, not a typed intent; discrete intent is captured upstream.
- Block-structure edits (`duplicateVisual` → `node.insertAfter`) and document-wide
  bulk operations (`applyBrandToAll`) — no single-visual `visual.*` op exists.
- Brand presets (`applyBrandToThis`) and composite resets
  (`resetNodeStyle` + `resetNodeExtStyle` as one action) — no 1:1 op; themes are
  the command-backed equivalent.
- Continuous gesture edits in `visual-editor.tsx` (drag / resize / reposition
  and high-frequency inline label typing) — high-frequency transforms, not
  discrete commands. The discrete committed edits at these seams (edge
  flip / toggle and the final label commit) now route through `onCommand`.
- Projection/repair paths (`mirrorVisualNodes`) — not user intent (see §3).

### 3. Mirrored `Visual` rows

`src/app/app/documents/[id]/actions.ts::mirrorVisualNodes` projects embedded
visual blocks from `contentJson` into `Visual` and `VisualRevision` rows for
share/embed, thumbnails, and version history.

This is not user intent.

**Audit decision:** keep it out of the user-intent command path and model it as a
`visual_mirror_rebuild` side effect.

### 4. `deckJson`

Deck mutations already have the right separation:

- `src/lib/presentation/editor-commands.ts` owns pure Deck mutations;
- `src/components/presentation/slide-editor.tsx` owns editor state,
  history, and autosave handoff;
- `saveDeckJson` and `saveDeckPatch` are the persistence endpoints guarded by
  document capability checks and revision tokens.

**Audit decision:** the new envelope must wrap this layer, not fork it.
Deck command payloads remain domain-specific; the envelope owns addressing,
schema version, actor, coalescing, and revision metadata.

### 5. Slide assets

`src/app/app/documents/[id]/slide-asset-actions.ts::uploadSlideAsset` validates,
deduplicates, stores bytes, and creates `Asset` rows.

**Audit decision:** keep asset upload outside the user-intent bus. It is a
server write with storage side effects, not a pure transform.

### 6. Comments and anchors

`src/app/app/documents/[id]/comments-actions.ts` creates, edits, deletes, and
resolves comment threads while persisting anchor metadata (`slideId`,
`elementId`, geometry, or text/visual anchor fields).

**Audit decision:** comments are a future command surface, but not in scope
for the visual/deck executor introduced in Epic #436.

### 7. Source refs on slide elements

Source-link refresh, unlink, relink, and orphan dismissal route through Deck
source-link helpers and editor command handlers. The active surfaces are
`src/lib/presentation/source-links.ts`,
`src/components/presentation/source-review-panel.tsx`, and
`src/components/presentation/slide-editor.tsx`:

- refresh updates node source metadata and content where safe;
- unlink/relink updates node source metadata explicitly;
- dismiss hides source issues without deleting authored slide nodes.

The pure executor owns the source-ref semantics, emits `element.update` /
`element.remove` `DeckPatch` records, and preserves geometry/style/z-order plus
all other element fields. Stale/orphaned links remain user-visible and are never
auto-deleted.

**Audit decision:** done — source refs are deck/source-ref commands on top of the
existing deck executor.

### 8. Version restore

`src/app/app/documents/[id]/actions.ts::restoreDocumentVersion` restores
`contentJson` and `deckJson`, re-derives plain text, and rebuilds mirrored
visual rows.

**Audit decision:** keep restore as a privileged server orchestration path. It
replays stored state snapshots, not user-intent commands.

---

## Routing Summary

### Route through the new envelope now

- visual styling/layout/content commands over `VisualNode.visual` — user-intent
  edits routed through `applyVisualCommand` at the `visual-card.tsx`,
  `visual-context-popover.tsx`, `mobile-editing-sheet.tsx`, and
  `visual-editor.tsx` seams (Epic #494, #507)
- existing `SlideCommand` payloads for `deckJson`
- source-ref deck commands (refresh / unlink / relink / orphan removal) — Epic #494

### Explicit side effects, not commands

- visual mirror rebuilds
- source-staleness recomputation
- render invalidation after visual changes

### Out of scope for this epic

- asset uploads
- comment CRUD
- document version restore orchestration

---

## Key consequence

Epic #436 does **not** introduce a second deck mutation system. Instead it makes
visual edits look like deck edits already do: pure executor + serializable patch
metadata + server-side validation + explicit side effects.
