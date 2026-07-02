---
type: "plan"
status: "active — deletion blocked by residual imports"
last_updated: "2026-07-02"
description: "Remaining P0 plan for retiring the legacy v6 presentation surface. Shared-kernel extraction, the vNext import boundary, and the product fallback decision are complete; deletion remains blocked by residual legacy imports outside the legacy tree."
---

# Legacy Retirement Plan

## Priority And Goal

**Priority:** P0.

Retire the orphaned v6 presentation surface once product confirms no supported
fallback editor, presenter, public viewer, export, or deck route is required.

Shared-kernel extraction is complete enough that `presentation-vnext` production
code has zero imports from legacy presentation paths. This plan now tracks only
the remaining deletion blockers.

## Current Blockers

| Blocker                 | Current status                                                                                                                                  | Required outcome                                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product fallback policy | Resolved 2026-07-02. Full removal (Option 1): no implicit v6 fallback route is retained as a named supported mode.                              | Use the fallback decision to classify residual imports before deleting `src/components/presentation/**` or v6-specific `src/lib/presentation/**`. |
| Residual imports        | 40 app/library import lines across 30 files still import legacy presentation paths outside the legacy tree; `src/test` adds 3 support files.    | Move current behavior to document, command, visual, comment, or vNext-owned APIs, or delete it with the legacy fallback.                          |
| Entry/export ownership  | Document open/export, visual fallback, command/action contracts, comments anchors, and AI/deck generation still use legacy contracts in places. | Give each residual area an owner and remove implicit fallback helpers after the product decision.                                                 |
| Final surface deletion  | The legacy component/lib tree remains product-gated.                                                                                            | Delete v6-only files in reviewable batches only after residual imports are gone or explicitly owned by a supported mode.                          |

## Import Boundary

Current checks on 2026-07-02:

- `src/components/presentation-vnext/**` and `src/lib/presentation-vnext/**`
  have zero production imports from `@/lib/presentation/**` or
  `@/components/presentation/**`.
- Legacy-internal imports inside `src/components/presentation/**` and
  `src/lib/presentation/**` remain canonical to the blocked v6 surface and are
  not counted as external residuals.
- `src/test` helper imports are not product blockers by themselves, but they
  should be migrated or deleted with the production area they support.

## Remaining Decisions

1. **Resolved 2026-07-02:** Full removal (Option 1). Product does not support
   any v6 fallback editor, presenter, public viewer, export, or deck route.
2. For each residual import, choose one outcome: move to a current owned API or
   delete with the v6 surface.
3. Keep the vNext import boundary as a hard review gate.
4. Do not add v6-to-v7 compatibility layers while resolving residuals.

## Fallback Policy Decision (2026-07-02)

Chosen option: **Full removal (Option 1)**. The legacy v6 presentation surface
will be deleted after residual imports are migrated to owned APIs or removed
with the fallback surface.

Affected routes and entry points:

- Editor: not retained as a supported v6 mode.
- Presenter: not retained as a supported v6 mode.
- Public viewer: not retained as a supported v6 mode.
- Export: not retained as a supported v6 mode.
- Deck route: not retained as a supported v6 mode.

Residual-area policy for #1609:

- Document open/export behavior: migrate to document-owned or export-owned APIs.
- Visual fallback behavior: migrate to visual-owned or vNext-owned APIs.
- Command/action contracts: migrate to command-owned APIs.
- Comment anchors: migrate to comment-owned APIs.
- AI and deck generation: migrate to document-generation or vNext-owned APIs.
- Legacy-only entry, route, presenter, viewer, and export fallback helpers:
  delete with the v6 fallback surface.
- `src/test` helpers: migrate with the production area they support, or delete
  with the fallback-only production code.

This resolves the top P0 blocker and unblocks the legacy-retirement epic #1615.

## Deletion Gates

| Gate                                                                                                        | Status                            |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Product confirms no implicit v6 fallback route is supported.                                                | Resolved — full removal confirmed |
| Import search finds no production imports from legacy modules outside an explicitly retained legacy mode.   | Deferred                          |
| vNext opens, edits, presents, publicly renders, and exports DeckV7 without v6 deck or element type imports. | Deferred                          |
| Presentation docs and README entries no longer refer to the deleted surface as current behavior.            | Deferred                          |
| Focused presentation, public-render, visual/export, and document-generation tests pass for migrated slices. | Deferred                          |

## Verification

Suggested import search before each phase:

```bash
rg -n "from ['\"]@/(lib|components)/presentation(/|['\"])" src --glob "*.{ts,tsx}" --glob "!**/*.test.*"
```

Smallest practical checks by slice:

```bash
npx prettier --write <touched files>
npx eslint <touched lintable files>
npm run test:presentation
npm run test:public-render
npm run test:visual
npm run test:documents
npm run typecheck
```

Run only the subsystem checks relevant to the moved imports first. Use
`npm run typecheck` for shared-kernel moves because import boundaries and public
types are the main risk.
