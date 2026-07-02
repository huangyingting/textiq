---
type: "plan"
status: "active — deletion blocked by product decision"
last_updated: "2026-07-02"
description: "Remaining P0 plan for retiring the legacy v6 presentation surface. Shared-kernel extraction and the vNext import boundary are complete; deletion remains blocked by product fallback policy and residual legacy imports outside the legacy tree."
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

| Blocker                 | Current status                                                                                                                                  | Required outcome                                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Product fallback policy | Blocked. No recorded product decision confirms whether an implicit v6 fallback route should be removed or retained as a named supported mode.   | Record the fallback answer before deleting `src/components/presentation/**` or v6-specific `src/lib/presentation/**`.    |
| Residual imports        | 40 app/library import lines across 30 files still import legacy presentation paths outside the legacy tree; `src/test` adds 3 support files.    | Move current behavior to document, command, visual, comment, or vNext-owned APIs, or delete it with the legacy fallback. |
| Entry/export ownership  | Document open/export, visual fallback, command/action contracts, comments anchors, and AI/deck generation still use legacy contracts in places. | Give each residual area an owner and remove implicit fallback helpers after the product decision.                        |
| Final surface deletion  | The legacy component/lib tree remains product-gated.                                                                                            | Delete v6-only files in reviewable batches only after residual imports are gone or explicitly owned by a supported mode. |

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

1. Record whether product supports any v6 fallback editor, presenter, public
   viewer, export, or deck route. The recommended answer remains retirement.
2. For each residual import, choose one outcome: move to a current owned API,
   keep under a named supported legacy mode, or delete with the v6 surface.
3. Keep the vNext import boundary as a hard review gate.
4. Do not add v6-to-v7 compatibility layers while resolving residuals.

## Deletion Gates

| Gate                                                                                                        | Status                              |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Product confirms no implicit v6 fallback route is supported.                                                | Blocked — product decision required |
| Import search finds no production imports from legacy modules outside an explicitly retained legacy mode.   | Deferred                            |
| vNext opens, edits, presents, publicly renders, and exports DeckV7 without v6 deck or element type imports. | Deferred                            |
| Presentation docs and README entries no longer refer to the deleted surface as current behavior.            | Deferred                            |
| Focused presentation, public-render, visual/export, and document-generation tests pass for migrated slices. | Deferred                            |

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
