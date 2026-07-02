---
type: "reference"
status: "current"
last_updated: "2026-07-01"
description: "This guide defines current naming vocabulary only. It does not change persisted database columns or JSON payload shapes."
---

# Domain Identity And Payload Naming

This guide defines current naming vocabulary only. It does not change persisted
database columns or JSON payload shapes.

## Domain Identity Taxonomy

Durable ids are safe to persist. Transient keys are process/editor-state handles
and must not cross persistence boundaries.

| Name                     | Meaning                                                        | Persisted? |
| ------------------------ | -------------------------------------------------------------- | ---------- |
| `DocumentId`             | `Document.id` database id.                                     | Yes        |
| `DocumentBlockId`        | Durable document block `bid` / `blockId` inside `contentJson`. | Yes        |
| `LexicalNodeKey`         | Live Lexical `NodeKey`.                                        | No         |
| `VisualId`               | Durable visual id (`Visual.id` / visual node `visualId`).      | Yes        |
| `SlideId`                | Durable slide id in `Document.deckJson`.                       | Yes        |
| `SlideNodeId`            | Durable slide child node id in `SlideNode.children[]`.         | Yes        |
| `AssetId`                | Durable uploaded `Asset` row id.                               | Yes        |
| `WorkspaceId` / `UserId` | Durable workspace/user database ids.                           | Yes        |

Type-only branded aliases live in `src/lib/domain-identity.ts`. They are
zero-runtime-cost and are intended for new adapter boundaries where confusing a
durable id with a transient key would be risky. Do not churn stable payload
interfaces just to adopt them.

## Source Refs And Anchors

`SourceRef.blockId` is a durable document source id:

- `blockKind: "text"` means `blockId` is a document block `bid` / `blockId`.
- `blockKind: "visual"` means `blockId` is the durable `visualId`.
- `blockKind: "table"` means `blockId` is a document table block `bid` /
  `blockId`.
- `blockKind` is required; callers must not infer it.

Comment anchors keep their historical `anchorNodeId` DB column, but current code
treats that value as a durable document block/visual id. It is not a live Lexical
`NodeKey`. Use the explicit adapters in `src/lib/presentation/source-links.ts`
and `src/lib/comments/anchors.ts`.

## AssetReference vs ResolvedAssetUrl

`AssetReference` means persisted asset identity (for example
`ImageElement.assetId`, `Slide.backgroundAssetId`, `BrandStyle.logoAssetId`, or
`BrandStyle.fontAssetId`).

`ResolvedAssetUrl` means a derived display URL (for example `ImageElement.src`,
`Slide.backgroundImage`, `BrandStyle.logoAssetUrl`, `BrandStyle.fontAssetUrl`, or
a logo `MasterElement.content.src`). URLs come from upload responses,
serialization, or storage adapters and should be re-resolvable from asset ids on
server/export paths.

Do not reintroduce legacy persisted brand URL fields. Brand rows persist asset
ids; `logoAssetUrl` and `fontAssetUrl` are read-time derived fields.

## Payload Suffix Playbook

Use suffixes for shape boundaries:

- `Row`: reduced database select shape (`BrandRow`, `ExistingVisualRow`).
- `Projection`: derived projection of an authoritative source.
- `ViewModel`: UI-ready aggregate composed for rendering.
- `Input`: untrusted or caller-provided input to validate before persistence.
- `Result`: operation outcome returned to callers.
- `ParseResult` / `ValidationResult`: validation-specific result aliases.

Result-shape conventions:

- Use `ok: true | false` with `data` / `error` for public action results
  (`ActionResult<T>`).
- Use `success: true | false` for parser/schema validation results when that is
  the existing API (`safeParseDeck` and similar validators).
- Use `valid: boolean` only for predicate-like validation summaries.
- Use `payload` for raw request/body content before validation; use `data` for
  validated or returned domain data.

Public API response shapes remain stable; new modules should follow this
playbook rather than renaming existing wire formats.
