---
type: "architecture"
status: "current"
last_updated: "2026-07-31"
description: "This subsystem covers document creation, duplication, dashboard listing, search, tags, favorites, trash, and dashboard-load maintenance. Editor content state is documented in ../editor/; persisted document and deck shapes are documented in ../data-model/."
---

# Document Management

This subsystem covers document creation, duplication, dashboard listing,
search, tags, favorites, trash, and dashboard-load maintenance. Editor content
state is documented in [../editor/](../editor/README.md); persisted document
and deck shapes are documented in [../data-model/](../data-model/README.md).

## Source Anchors

| Area                        | Source                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| Create from template/import | [`src/lib/document/create.ts`](../../src/lib/document/create.ts)                                 |
| Search-text projection      | [`src/lib/document/content-projection.ts`](../../src/lib/document/content-projection.ts)         |
| Document write port         | [`src/lib/document/document-write-port.ts`](../../src/lib/document/document-write-port.ts)       |
| Restricted Prisma surface   | [`src/lib/prisma-surface.ts`](../../src/lib/prisma-surface.ts)                                   |
| Duplicate document          | [`src/lib/document/duplicate.ts`](../../src/lib/document/duplicate.ts)                           |
| List and search documents   | [`src/lib/document/list.ts`](../../src/lib/document/list.ts)                                     |
| Query policy builder        | [`src/lib/document/query.ts`](../../src/lib/document/query.ts)                                   |
| Tags                        | [`src/lib/document/tags.ts`](../../src/lib/document/tags.ts)                                     |
| Favorites and title changes | [`src/lib/document/mutations.ts`](../../src/lib/document/mutations.ts)                           |
| Trash and maintenance       | [`src/lib/document/trash.ts`](../../src/lib/document/trash.ts)                                   |
| Dashboard view model        | [`src/lib/dashboard/view-model.ts`](../../src/lib/dashboard/view-model.ts)                       |
| Onboarding sample document  | [`src/lib/onboarding/seed-sample-document.ts`](../../src/lib/onboarding/seed-sample-document.ts) |

## Creation Paths

Template creation resolves a requested template id through the template catalog.
The blank template creates an empty personal document; non-blank templates seed
canonical Lexical content from the catalog.

Import creation receives normalized Markdown-compatible text from the
[import subsystem](../import/README.md), clamps title/content to configured
limits, converts content through `markdownToLexicalState`, and stores canonical
`contentJson` plus its derived plain-text search projection.

New credentials and OAuth users receive onboarding content through the sample
document seed path.

## Duplication

Duplication copies title, `contentJson`, visuals, and `deckJson` inside one
transaction. When `contentJson` exists, block ids are regenerated, the plain-text
search projection is rebuilt from the regenerated JSON, and a bid map is
produced. Visual anchors and deck `sourceRef` values that point back to the
source document are remapped to the new document id and regenerated block ids.

If deck parsing fails during duplication, the original deck JSON is preserved
rather than rewritten. Runtime schema repair is handled by the data-model and
operations repair paths.

## Listing And Search

Dashboard listing runs separate personal and workspace queries, caps each query
with `limit + 1`, merges the rows, sorts by `updatedAt` descending, and projects
dashboard cards with:

- permission flags from `documentCapabilities`;
- first visual thumbnail parsed through `safeParseVisual`;
- excerpt and reading-time metadata;
- workspace name when applicable;
- sorted tags.

Search normalizes the query and reuses the accessible-document query policy.
Text search matches title and the persisted `Document.content` plain-text
projection with provider-aware case-insensitive contains. Every canonical
`contentJson` create, save, duplicate, import, onboarding seed, and version
restore supplies one canonical snapshot to the document write port. The port
clones and seals that snapshot, derives both persisted fields immediately before
the Prisma mutation, and does not accept caller-supplied projection fields.
Outside the port, the public singleton and transaction callbacks expose
`Document` reads but no `create`, `update`, `upsert`, or delete members.

Deployments upgrading from a build that did not maintain the projection should
preview the repair first:

```bash
npm run db:backfill-document-content -- --dry-run
```

Dry-run is the default and performs zero writes. It reports bounded counts and
sample document ids only; titles and document content are never logged. Execute
with an explicit safety confirmation:

```bash
DOCUMENT_CONTENT_BACKFILL_CONFIRM=write-projections \
  npm run db:backfill-document-content -- --execute
```

`--batch-size=1..1000`, `--max-retries=0..10`, and `--sample-limit=0..100`
bound database and log volume. Invalid configuration, backfill failures, and
disconnect failures exit non-zero. Each write compares both the canonical JSON
snapshot and its `updatedAt` version; concurrent editor saves make stale writes
miss and trigger a bounded re-read rather than overwriting newer text.

## Query Policies

The query builder owns reusable scopes:

| Scope                 | Meaning                                                   |
| --------------------- | --------------------------------------------------------- |
| `dashboard-personal`  | User-owned personal documents only.                       |
| `dashboard-workspace` | Workspace documents visible through workspace membership. |
| `workspace`           | Documents in one workspace.                               |
| `accessible`          | Any document visible through document access policy.      |
| `custom-access`       | Caller-supplied access OR expression.                     |

Every list scope excludes soft-deleted documents. Filters for text query, tag,
and favorites are appended as `AND` clauses.

## Tags, Favorites, And Trash

Tags are owner-scoped. Names are normalized; slugs are deterministic and use a
bounded retry loop on unique-constraint collisions. Adding/removing a tag
returns the document's current sorted tag list.

Favorite toggles ignore soft-deleted documents. Trash is a soft delete that
sets `deletedAt`; restore clears `deletedAt`. Dashboard-load maintenance purges
documents older than the soft-delete retention window and also removes expired,
revoked, or exhausted invite links under the same lock policy.

## Invariants

1. Dashboard cards are projections, not independent state.
2. List/search queries use shared access-query helpers and exclude trash.
3. Duplicate documents get fresh block ids and remapped in-document refs.
4. Imported content is converted to current Lexical JSON before persistence.
5. Tag slugs are stable, owner-scoped, and collision-bounded.
6. Permanent purge is maintenance-driven; user delete is soft delete first.
7. Raw Prisma `Document` mutations are confined to the document write port by a
   restricted client/transaction type, raw-module import rules, compile-time
   negative fixtures, and a narrow escape-hatch AST guard.
8. `Document.content` is derived from canonical `contentJson` and is written
   atomically with every document-body transition.

## Primary Tests

- [`src/lib/document/create.test.ts`](../../src/lib/document/create.test.ts)
- [`src/lib/document/content-projection.test.ts`](../../src/lib/document/content-projection.test.ts)
- [`src/lib/document/content-projection-backfill.test.ts`](../../src/lib/document/content-projection-backfill.test.ts)
- [`src/lib/document/search-projection.integration.test.ts`](../../src/lib/document/search-projection.integration.test.ts)
- [`src/lib/document/document-write-port.test.ts`](../../src/lib/document/document-write-port.test.ts)
- [`scripts/prisma-boundary.test.mjs`](../../scripts/prisma-boundary.test.mjs)
- [`type-tests/document-prisma-boundary/contract.ts`](../../type-tests/document-prisma-boundary/contract.ts)
- [`src/lib/document/duplicate.test.ts`](../../src/lib/document/duplicate.test.ts)
- [`src/lib/document/list.test.ts`](../../src/lib/document/list.test.ts)
- [`src/lib/document/query.test.ts`](../../src/lib/document/query.test.ts)
- [`src/lib/document/tags.test.ts`](../../src/lib/document/tags.test.ts)
- [`src/lib/dashboard/view-model.test.ts`](../../src/lib/dashboard/view-model.test.ts)
- [`e2e/ui-matrix/dashboard-document-lifecycle-ui.spec.ts`](../../e2e/ui-matrix/dashboard-document-lifecycle-ui.spec.ts)
- [`src/lib/onboarding/checklist.test.ts`](../../src/lib/onboarding/checklist.test.ts)
