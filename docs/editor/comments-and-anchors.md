---
type: "design"
status: "current"
last_updated: "2026-07-10"
description: "This document describes comment threads and their document/slide anchors."
---

# Comments And Anchors

This document describes comment threads and their document/slide anchors.

## Source Files

| Area                          | Source                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Comment actions               | [`src/app/app/documents/[id]/comments-actions.ts`](../../src/app/app/documents/%5Bid%5D/comments-actions.ts)             |
| Comment service               | [`src/lib/comments/service.ts`](../../src/lib/comments/service.ts)                                                       |
| Comment permissions           | [`src/lib/comments/policy.ts`](../../src/lib/comments/policy.ts)                                                         |
| Anchor helpers                | [`src/lib/comments/anchors.ts`](../../src/lib/comments/anchors.ts)                                                       |
| Lifecycle helpers             | [`src/lib/comments/lifecycle.ts`](../../src/lib/comments/lifecycle.ts)                                                   |
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

Editing and deleting a comment requires authorship. Resolving threads is handled
through the comment action layer and returns refreshed server truth.

## Anchor Types

Top-level comments may be anchored in three forms.

| Anchor                             | Fields                                                                             | Meaning                                                                          |
| ---------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Text anchor                        | `anchorType="text"`, `anchorText`                                                  | Anchors to a document text selection.                                            |
| Visual/table document block anchor | `anchorType="visual"` or `"table"`, optional `anchorText`, optional `anchorNodeId` | Anchors to a visual or table block node; `anchorNodeId` is the durable block id. |
| Slide anchor                       | `slideId`, optional `elementId`, optional `{x,y}` geometry                         | Anchors to a deck slide or slide element.                                        |

Slide anchors are mutually exclusive with document block anchor fields. If
`slideId` is present, document block anchor fields are ignored.

## Slide Anchor Geometry

Slide geometry is a point in percent units relative to the slide canvas:

```ts
type AnchorPoint = { x: number; y: number };
```

Validation requires both coordinates to be finite and within `0..100`.
`elementId` is accepted only when `slideId` is present.

## Slide Lifecycle Behavior

Slide lifecycle helpers keep anchors coherent when slides/elements change:

- deleting a slide can orphan anchors that pointed to it;
- deleting an element can orphan element-level anchors while preserving the
  slide-level relationship;
- duplicating a slide does not copy comments to the new slide;
- restore/version flows can surface orphaned anchors for the UI.

The lifecycle layer is pure and does not write the database directly.

## Filters And UI

`listComments` supports:

- `slideId` filter;
- `anchorScope: "all" | "text" | "slide"`.

The document editor uses inline comment surfaces for text/visual anchors.
Slide-aware comment behavior is exposed through the comment service filters,
anchor helpers, lifecycle helpers, and the presentation slide-anchor facade so
slide-specific callers do not duplicate anchor logic.

Unread helpers compute per-comment/thread read state for slide comment surfaces.

## Invariants

1. Comment list/create requires document view capability.
2. Edit/delete requires comment authorship.
3. Replies do not define their own anchors.
4. Slide anchors use percent geometry.
5. Slide duplication does not copy comments.
6. Lifecycle helpers are pure; server actions own persistence.

## Primary Tests

- [`src/lib/comments/anchors.test.ts`](../../src/lib/comments/anchors.test.ts)
- [`src/lib/comments/service.test.ts`](../../src/lib/comments/service.test.ts)
- [`src/app/app/documents/[id]/comment-anchor-validation.test.ts`](../../src/app/app/documents/%5Bid%5D/comment-anchor-validation.test.ts)
- [`src/app/app/documents/[id]/comment-permissions.test.ts`](../../src/app/app/documents/%5Bid%5D/comment-permissions.test.ts)
- [`src/app/app/documents/[id]/slide-comment-lifecycle.test.ts`](../../src/app/app/documents/%5Bid%5D/slide-comment-lifecycle.test.ts)
- [`src/app/app/documents/[id]/slide-comment-permissions-lifecycle.test.ts`](../../src/app/app/documents/%5Bid%5D/slide-comment-permissions-lifecycle.test.ts)
- [`src/app/app/documents/[id]/slide-comment-unread.test.ts`](../../src/app/app/documents/%5Bid%5D/slide-comment-unread.test.ts)
