---
type: "design"
status: "current"
last_updated: "2026-07-31"
description: "This document describes comment threads and their document/slide anchors."
---

# Comments And Anchors

This document describes comment threads and their document/slide anchors.

## Source Files

| Area                          | Source                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Comment actions               | [`src/app/app/documents/[id]/comments-actions.ts`](../../src/app/app/documents/%5Bid%5D/comments-actions.ts)             |
| Comment action results        | [`src/lib/comments/action-result.ts`](../../src/lib/comments/action-result.ts)                                           |
| Comment service               | [`src/lib/comments/service.ts`](../../src/lib/comments/service.ts)                                                       |
| Comment errors                | [`src/lib/comments/errors.ts`](../../src/lib/comments/errors.ts)                                                         |
| Prisma projection             | [`src/lib/comments/records.ts`](../../src/lib/comments/records.ts)                                                       |
| Comment permissions           | [`src/lib/comments/policy.ts`](../../src/lib/comments/policy.ts)                                                         |
| Anchor helpers                | [`src/lib/comments/anchors.ts`](../../src/lib/comments/anchors.ts)                                                       |
| Lifecycle helpers             | [`src/lib/comments/lifecycle.ts`](../../src/lib/comments/lifecycle.ts)                                                   |
| Anchor persistence            | [`src/lib/comments/persistence.ts`](../../src/lib/comments/persistence.ts)                                               |
| Unread helpers                | [`src/lib/comments/read-state.ts`](../../src/lib/comments/read-state.ts)                                                 |
| Inline comments UI            | [`src/app/app/documents/[id]/inline-comments-layer.tsx`](../../src/app/app/documents/%5Bid%5D/inline-comments-layer.tsx) |
| Inline comment geometry       | [`src/app/app/documents/[id]/inline-comment-dom.ts`](../../src/app/app/documents/%5Bid%5D/inline-comment-dom.ts)         |
| Slide anchor presentation API | [`src/lib/comments/slide-comment-anchors.ts`](../../src/lib/comments/slide-comment-anchors.ts)                           |

## Comment Thread Model

Comments are one-level threads:

- root comment owns anchor and resolved state;
- replies point at the root comment and inherit its anchor;
- list actions return roots with their replies sorted oldest-to-newest.

Creating or listing comments requires document `view` capability.

Editing and deleting a comment requires authorship. Any viewer may resolve a
top-level thread, but replies cannot carry lifecycle state. Mutations return
refreshed server truth. ID-based mutations also take the active document ID,
authorize that document, and only query comments within it.

Reply validation, root reopening, and insertion share one retryable serializable
transaction. A new reply always reopens its root thread. Resolving or reopening
targets only the root; deleting a reply does not change the root's current
resolved state, while deleting a root cascades to its replies.

Validation and lifecycle failures use `CommentError` codes. Server actions
return a discriminated `CommentActionResult`: known comment failures preserve
their safe code/message, while a missing ID, an ID from another document or
workspace, and a target in an inaccessible document all return the same
`comment_unavailable` result. Internal structured logs retain only an
identifier-free availability classification. Read/create document permission
failures map to `access_denied`, and unknown persistence failures are logged
before a generic `unexpected` result is returned. Framework redirect control
flow is re-thrown rather than adapted.

## Anchor Types

Top-level comments may be anchored in three forms.

| Anchor                       | Fields                                                                | Meaning                                                                                                                         |
| ---------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Text anchor                  | `anchorType="text"`, `anchorText`                                     | Anchors to a document text selection.                                                                                           |
| Visual document block anchor | `anchorType="visual"`, optional `anchorText`, optional `anchorNodeId` | Anchors to a visual block; `anchorNodeId` is the durable visual/block id.                                                       |
| Table document block anchor  | `anchorType="table"`, optional `anchorText`, optional `anchorNodeId`  | Anchors to a table block; `anchorNodeId` is the durable table block id (`bid`) when present, never a transient Lexical NodeKey. |
| Slide anchor                 | `slideId`, optional `elementId`, optional `{x,y}` geometry            | Anchors to a deck slide or slide element.                                                                                       |

Slide anchors are mutually exclusive with document block anchor fields. If
`slideId` is present, document block anchor fields are ignored.

Persisted table anchors use the same document-block columns as visual anchors:
`anchorType` must be the current literal `"table"`, optional `anchorText`
stores the selected table label/snippet, and `anchorNodeId` stores the durable
table block id when the caller can resolve one. The persisted-contract validator
accepts `"table"` as a current anchor type, rejects unknown anchor types, rejects
records that combine table/document-block fields with slide anchors, and keeps a
missing `anchorNodeId` as `null` rather than inventing an id. If the table block
is deleted later, the stored durable id remains the historical anchor target for
orphan/restore UI instead of being rewritten to a runtime node key.

## Slide Anchor Geometry

Slide geometry is a point in percent units relative to the slide canvas:

```ts
type AnchorPoint = { x: number; y: number };
```

Validation requires both coordinates to be finite and within `0..100`.
`elementId` is accepted only when `slideId` is present.

## Slide Lifecycle Behavior

Slide lifecycle helpers and persistence keep anchors coherent when
slides/elements change:

- deleting a slide floats its anchors to deck level;
- deleting an element floats its anchors to slide level while preserving pin
  geometry;
- duplicating a slide does not copy comments to the new slide;
- restore/version flows can surface orphaned anchors for the UI.

The lifecycle policy is pure. Deck persistence calls the comments persistence
adapter inside the same retryable serializable transaction as the successful
revision-token CAS, so a deck write cannot report success while required anchor
repairs fail. Slide-comment creation uses the same transaction policy for its
saved-deck validation and insert, preventing a concurrent deck save from
committing an orphaned anchor.

## Filters And UI

`listComments` supports:

- `slideId` filter;
- `anchorScope: "all" | "text" | "slide"`.

The document editor uses inline comment surfaces for text/visual anchors. Each
root renders its replies directly beneath it. Selecting a root's accessible
Reply control sends its ID as `parentId`; a successful response keeps the anchor
card open and renders refreshed server truth, while typed or transport failures
retain the draft for retry.

The rendered inline card exposes the complete thread lifecycle. Every viewer
can reply, resolve, and reopen a root; only authors see edit and guarded delete
controls for their own roots or replies. Root deletion explicitly warns that
replies will also be removed. Mutation failures preserve editable drafts and
surface an alert, and successful actions replace local state with the refreshed
server result. Resolved-only anchors remain reachable from the paragraph gutter
and report resolved counts separately from open counts. Marker geometry is
recomputed when collaborative editor updates arrive, and durable block IDs keep
threads attached when their paragraph text changes.

The deterministic owner/viewer browser lifecycle creates and edits a root,
edits and reloads the anchored paragraph without losing the thread, creates and
edits a reply, verifies author-only controls, resolves and reopens across reload,
cancels and confirms reply/root deletion, and proves final durability after
reload.

Slide-aware comment behavior is exposed through the comment service filters,
anchor helpers, lifecycle helpers, and the presentation slide-anchor facade so
slide-specific callers do not duplicate anchor logic.

Unread counts include both roots and replies created after `lastReadAt`, excluding
the viewer's own comments. Replies inherit their root's text/slide scope, so a
reply on a slide thread contributes to the slide count even though the reply row
does not duplicate anchor fields.

## Invariants

1. Comment list/create requires document view capability.
2. Edit/delete requires comment authorship.
3. Replies do not define their own anchors.
4. Slide anchors use percent geometry.
5. Slide duplication does not copy comments.
6. Only top-level comments carry resolved state.
7. Lifecycle policy is pure; the comments persistence adapter owns anchor writes.
8. Deck CAS and required anchor repair commit or roll back together.
9. Slide-anchor validation and comment insertion share a serializable transaction
   with bounded retries for PostgreSQL serialization failures and SQLite lock
   conflicts.
10. Reply root validation, reopening, and insertion commit or roll back together.
11. New replies reopen their root and inherit its unread anchor scope.
12. Comment-ID mutations are document-scoped and conceal missing, cross-document,
    and inaccessible targets behind one external outcome.

## Primary Tests

- [`src/lib/comments/anchors.test.ts`](../../src/lib/comments/anchors.test.ts)
- [`src/lib/comments/service.test.ts`](../../src/lib/comments/service.test.ts)
- [`src/app/app/documents/[id]/comment-anchor-validation.test.ts`](../../src/app/app/documents/%5Bid%5D/comment-anchor-validation.test.ts)
- [`src/app/app/documents/[id]/comment-permissions.test.ts`](../../src/app/app/documents/%5Bid%5D/comment-permissions.test.ts)
- [`src/app/app/documents/[id]/slide-comment-lifecycle.test.ts`](../../src/app/app/documents/%5Bid%5D/slide-comment-lifecycle.test.ts)
- [`src/app/app/documents/[id]/slide-comment-permissions-lifecycle.test.ts`](../../src/app/app/documents/%5Bid%5D/slide-comment-permissions-lifecycle.test.ts)
- [`src/app/app/documents/[id]/slide-comment-unread.test.ts`](../../src/app/app/documents/%5Bid%5D/slide-comment-unread.test.ts)
- [`e2e/ui-matrix/document-comments-lifecycle-ui.spec.ts`](../../e2e/ui-matrix/document-comments-lifecycle-ui.spec.ts)
