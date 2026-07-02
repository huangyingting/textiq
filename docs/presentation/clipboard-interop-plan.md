---
type: "plan"
status: "active — P2 spike, awaiting leaf-issue scheduling"
last_updated: "2026-07-02"
description: "Plan v7 clipboard interoperability across OS paste/copy, cross-tab portable node payloads, and graceful copy-out fallbacks."
---

# v7 Clipboard Interoperability Plan

## Priority And Goal

**Priority:** P2.

Define the v7 clipboard contract before implementation so editor copy, cut, and
paste can interoperate with the OS clipboard, other TextIQ documents/tabs, and
external apps without introducing any v6 clipboard bridge.

## Current Behavior

- `SlideEditorVNext` copies selected nodes into a React in-memory
  `SlideChildNode[]` buffer only: `handleCopyNodes` resolves selected ids to
  nodes and calls `setClipboardNodes(copied)`
  (`src/components/presentation-vnext/slide-editor-vnext.tsx:1759-1765`).
- Paste reads only that same internal buffer: `handlePasteNodes` returns when
  `clipboardNodes.length === 0`, then calls `pasteNodes(deck, activeSlide.id,
clipboardNodes)` (`src/components/presentation-vnext/slide-editor-vnext.tsx:1767-1775`).
- Keyboard shortcuts only classify Cmd/Ctrl+C/X/V; they do not read or write the
  OS clipboard (`src/components/presentation-vnext/clipboard-shortcuts.ts:1-14`).
- The stage context menu exposes `onPaste` and disables paste from `canPaste`, so
  paste availability is gated by editor state rather than OS clipboard contents
  (`src/components/presentation-vnext/stage-context-menu.tsx:56,206`).
- There are no `navigator.clipboard`, `ClipboardEvent`, or `clipboardData`
  usages under `src/components/presentation-vnext/**` as of this spike.

## Portable Serialized Node Payload

Use the async Clipboard API with a TextIQ-owned MIME type:

```text
application/x-textiq-nodes+json
```

The payload is a UTF-8 JSON document, not raw `SlideChildNode[]`, so it can be
versioned and validated independently of transient editor state:

```json
{
  "kind": "textiq.nodes",
  "version": 1,
  "schema": "deck-v7",
  "createdAt": "2026-07-02T07:50:26.000Z",
  "source": {
    "app": "TextIQ",
    "documentId": "optional-document-id",
    "deckId": "optional-deck-id",
    "slideId": "optional-slide-id"
  },
  "selection": {
    "bounds": { "x": 12, "y": 16, "w": 42, "h": 12 },
    "anchor": "selection-center"
  },
  "nodes": [],
  "assets": {
    "images": {},
    "visuals": {},
    "files": {}
  }
}
```

Implementation follow-up should add a serializer/parser near v7 presentation
commands or a dedicated `clipboard-payload` module. The parser should require
`kind === "textiq.nodes"`, accept only known `version` values, validate nodes
against current DeckV7 schema, reject unknown future major versions, and remap
ids/assets on insert. Version 1 should include selected `SlideChildNode` trees
and only the asset records reachable from those nodes. Cross-document paste then
reads `application/x-textiq-nodes+json` from `navigator.clipboard.read()`,
validates it, imports reachable assets when needed, and hands normalized nodes to
existing `pasteNodes`, which already reidentifies node ids on insertion
(`src/lib/presentation-vnext/editor-commands.ts:982-999`).

Copy should still update the existing in-memory buffer as an immediate fallback,
but the OS clipboard payload is the cross-document/tab source of truth. Paste
preference order should be: TextIQ MIME payload, image blobs, sanitized HTML,
plain text, then current in-memory buffer if clipboard read is unavailable.

## Paste Image From OS

When a clipboard item contains `image/png`, `image/jpeg`, `image/webp`, or other
accepted slide image MIME types, convert the blob to a `File` with a deterministic
name such as `clipboard-image-<timestamp>.png`. Reuse the existing v7 image upload
path rather than creating a clipboard-specific storage path:

1. `slide-editor-route-client.tsx` wraps files in `FormData` and calls the
   `uploadSlideAsset(documentId, formData)` server action
   (`src/app/app/documents/[id]/slides/slide-editor-route-client.tsx:478-498`).
2. `uploadSlideAsset` validates auth, MIME, bytes, magic bytes, dimensions,
   checksum, deduplication, storage, and DB metadata
   (`src/app/app/documents/[id]/slide-asset-actions.ts:44-112`).
3. `SlideEditorVNext` receives that action as `onUploadImage`
   (`src/app/app/documents/[id]/slides/slide-editor-route-client.tsx:692`) and
   funnels uploads through `deckWithUploadedImageAsset`
   (`src/components/presentation-vnext/slide-editor-vnext.tsx:1547-1565`).
4. `deckWithUploadedImageAsset` records the image in `deck.assets.images` with
   upload origin metadata (`src/lib/presentation-vnext/node-asset-factories.ts:212-260`).
5. Insert a `defaultImageNode` patched with the returned `assetId` and `alt`,
   matching the current insert-image path
   (`src/components/presentation-vnext/slide-editor-vnext.tsx:1578-1590`).

The image paste follow-up should surface the same validation/upload errors as
manual image replacement and keep focus on the inserted image node.

## Paste HTML And Plain Text

HTML paste should sanitize before insertion. Use a strict allow-list sanitizer
approach, preferably DOMPurify configured for clipboard paste with only textual
inline tags and safe links, then convert the sanitized fragment into DeckV7 text
paragraphs. Plain text should be normalized for line endings, size-limited, and
split into paragraphs. Both paths should insert v7 text nodes using the same
layout/z-index conventions as `defaultTextNode`/`textNodeAtPoint`, preserving
focus and selection on the inserted node.

## Copy-Out To Other Apps

Copying TextIQ nodes should write multiple clipboard representations in one
`ClipboardItem` where supported:

- `application/x-textiq-nodes+json` for TextIQ-to-TextIQ fidelity.
- `image/png` rendered from the selected-node bounds so external apps receive a
  visual representation.
- `text/plain` summary text for text-only destinations and accessibility.
- Optionally `text/html` with safe inline markup for text selections.

If PNG rendering fails or the browser denies binary clipboard writes, still write
the portable payload and plain-text fallback when permitted. External paste then
degrades gracefully from rendered image to text instead of exposing JSON.

## Permissions, Focus, And UX Edge Cases

- Clipboard reads/writes require a secure context, recent user activation, and
  focused editor surface. Shortcut and context-menu handlers should run from the
  user gesture and report actionable errors when the browser blocks access.
- Permission prompts vary by browser. Treat denied or unavailable async clipboard
  access as recoverable and fall back to the in-memory buffer for same-instance
  paste.
- `ClipboardEvent.clipboardData` should be considered only for the synchronous
  paste event fallback when async `navigator.clipboard.read()` is unavailable;
  it should not become the primary path.
- Cross-origin tabs and embedded contexts may block clipboard access via browser
  policy. Show a non-modal toolbar/status message and keep the editor usable.
- Large payloads should have explicit byte and node-count limits. If the portable
  payload is too large, write PNG/plain-text fallback and explain that TextIQ
  fidelity was skipped.
- Asset-heavy payloads should include only reachable asset metadata and should
  re-upload or rebind assets through the slide asset pipeline on cross-document
  paste rather than trusting source-document URLs blindly.
- Paste should not trigger while a text field, inspector input, table cell, or
  modal owns focus unless that owner intentionally delegates the paste to the
  stage.

## Proposed Leaf Issues

1. **Add v7 clipboard payload serializer/parser.** Define
   `application/x-textiq-nodes+json` version 1, schema validation, reachable asset
   collection, id remapping, size limits, and focused tests.
2. **Write TextIQ payloads on copy/cut.** Integrate async Clipboard API writes
   with the existing shortcut and context-menu copy/cut paths while retaining the
   in-memory buffer fallback.
3. **Read TextIQ payloads on paste.** Prefer portable payloads over the
   in-memory buffer, validate version/schema, import reachable assets, and insert
   via existing v7 commands.
4. **Paste OS images into v7 slides.** Read image blobs from clipboard items,
   upload them through `uploadSlideAsset`, add deck image assets via
   `deckWithUploadedImageAsset`, and insert image nodes.
5. **Paste sanitized HTML/plain text as text nodes.** Add sanitizer and text-node
   conversion coverage for multiline text, basic inline formatting decisions,
   oversized input, and unsafe HTML.
6. **Add copy-out PNG and fallback formats.** Render selected-node bounds to PNG
   and write PNG plus TextIQ payload plus text fallback, with browser capability
   handling.
7. **Add clipboard UX states.** Cover permission-denied, unsupported browser,
   unfocused stage, large payload, upload failure, and status messaging.

## Verification And Out Of Scope

Implementation follow-ups should run `npm run test:presentation` plus focused
serializer/parser tests and slide asset upload tests around the clipboard image
path. This spike does not implement runtime code, create GitHub issues, or define
any v6 clipboard path, compatibility layer, or legacy payload conversion.
