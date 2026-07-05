---
type: "architecture"
status: "current"
last_updated: "2026-07-04"
description: "The public-render subsystem resolves share/embed/present/OG/asset requests into read-only models. It bridges security policy, public metadata privacy, presentation rendering, visual dependencies, and paid-plan attribution."
---

# Public Render Surfaces

The public-render subsystem resolves share/embed/present/OG/asset requests into
read-only models. It bridges security policy, public metadata privacy,
presentation rendering, visual dependencies, and paid-plan attribution.

## Source Anchors

| Area                      | Source                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Resolver entry point      | [`src/lib/public-render/resolver.ts`](../../src/lib/public-render/resolver.ts)                                                       |
| Pure resolver core        | [`src/lib/public-render/resolver-core.ts`](../../src/lib/public-render/resolver-core.ts)                                             |
| Prisma projection selects | [`src/lib/public-render/resolver-selects.ts`](../../src/lib/public-render/resolver-selects.ts)                                       |
| Presentation model        | [`src/lib/public-render/presentation.ts`](../../src/lib/public-render/presentation.ts)                                               |
| Public metadata           | [`src/lib/public-render/metadata.ts`](../../src/lib/public-render/metadata.ts)                                                       |
| Attribution               | [`src/lib/public-render/attribution.ts`](../../src/lib/public-render/attribution.ts)                                                 |
| Share page                | [`src/app/share/[shareId]/page.tsx`](../../src/app/share/%5BshareId%5D/page.tsx)                                                     |
| Embed page                | [`src/app/embed/[shareId]/page.tsx`](../../src/app/embed/%5BshareId%5D/page.tsx)                                                     |
| Public present page       | [`src/app/present/[shareId]/page.tsx`](../../src/app/present/%5BshareId%5D/page.tsx)                                                 |
| Present embed route input | [`src/lib/public-render/present-embed-route.ts`](../../src/lib/public-render/present-embed-route.ts)                                 |
| Protected slide assets    | [`src/app/api/slide-assets/[documentId]/[...path]/route.ts`](../../src/app/api/slide-assets/%5BdocumentId%5D/%5B...path%5D/route.ts) |

## Modes And Projections

The resolver separates user-facing mode from data projection:

| Mode      | Projection     | Purpose                                                      |
| --------- | -------------- | ------------------------------------------------------------ |
| `view`    | `document`     | Public read-only document page.                              |
| `embed`   | `document`     | Public embeddable document view (`/embed/[shareId]`).        |
| `embed`   | `presentation` | Embeddable public presentation (`/present/[shareId]/embed`). |
| `present` | `presentation` | Public deck presentation (`/present/[shareId]`).             |
| `og`      | `metadata`     | Open Graph and social metadata.                              |
| `asset`   | `assetAccess`  | Protected public asset serving decision.                     |

The pure resolver validates that asset mode only uses the asset-access
projection. Non-asset public modes resolve by share id. Asset access resolves by
document id because asset URLs are scoped to a document.
The present embed route intentionally uses `mode: "embed"` with
`projection: "presentation"` so embedded presentations follow embed-share policy
rather than present-share policy.

## Access Policy

Share, embed, present, and asset requests use the shared access-decision
taxonomy from [../security/access-and-sharing.md](../security/access-and-sharing.md).
Missing shares return concealed 404 decisions. Disabled or expired shares return
the denial semantics selected by the share-access policy.

Browser-rendered denied share, embed, and present pages must show the shared
not-found fallback (`404` / `Page not found`) while keeping the response status
at 404 and omitting private document content.

Protected public slide assets are served only when the request includes the
share link binding that exposed the deck (`shareId` + `shareMode`) and that
binding still passes public share policy checks. Deleted or missing documents
deny with 404; existing documents without valid bound access deny with 403.

## Presentation Model

Public presentation rendering builds presentation blocks from `contentJson` and
collects visual dependencies from visual blocks. If `deckJson` parses, it is the
starting deck; otherwise the public model derives a deck from document blocks.
Invalid deck diagnostics stay on the server-side public model for observability;
anonymous present/embed viewers receive the derived read-only deck when content
is usable, and see recovery/no-slides states only when no fallback can be built.
The deck is reconciled against available visuals so public rendering never
references missing visual ids silently.

Public viewers then render through the same presentation primitives documented
in [../presentation/rendering-and-export.md](../presentation/rendering-and-export.md).

## Metadata And Attribution

Public metadata is privacy-preserving by default. Unless the owner opts into a
more specific metadata mode, share and present pages use generic title and
description values and mark robots as non-indexable. Discoverability controls
both `index` and `follow`.

Attribution is derived from the owner name and plan. Paid-plan attribution rules
live in billing; public render consumes only the resulting `showAttribution`
decision.

## Invariants

1. Public render never mutates document, deck, or visual state.
2. Mode/projection mismatches fail before producing a public model.
3. Public asset access requires active share-bound present/embed access.
4. Missing shares are concealed as not found with visible generic fallback text.
5. Public metadata defaults to generic, non-discoverable output.
6. Public presentation output reconciles deck refs with available visuals.

## Primary Tests

- [`src/lib/public-render/resolver.test.ts`](../../src/lib/public-render/resolver.test.ts)
- [`src/lib/public-render/resolver-core.test.ts`](../../src/lib/public-render/resolver-core.test.ts)
- [`src/lib/public-render/presentation.test.ts`](../../src/lib/public-render/presentation.test.ts)
- [`src/lib/public-render/metadata.test.ts`](../../src/lib/public-render/metadata.test.ts)
- [`e2e/public-render/public-pages.spec.ts`](../../e2e/public-render/public-pages.spec.ts)
