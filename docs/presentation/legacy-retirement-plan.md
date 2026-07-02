---
type: "plan"
status: "completed"
last_updated: "2026-07-02"
description: "Completed P0 work that removed dynamic legacy presentation references and deleted the legacy v6 presentation surface after the full-removal product decision."
---

# Legacy Retirement Plan

## Priority And Goal

**Priority:** P0.

The legacy v6 presentation surface has been deleted. Product fallback policy is
resolved: no implicit v6 editor, presenter, public viewer, export, or deck route
remains a supported mode.

## Completed Work

| Slice                       | Work                                                                                                                                                              | Exit criteria                                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| External dynamic references | Removed non-test dynamic v6 export imports from outside the legacy tree.                                                                                          | The legacy-reference search finds no non-test references outside current owned modules.                               |
| Legacy component tree       | Deleted `src/components/presentation/**`; current UI lives under `src/components/presentation-vnext/**` and shared component modules.                             | No product route or editor entry point imports the legacy component surface.                                          |
| Legacy library tree         | Deleted `src/lib/presentation/**`; current shared helpers were rehomed under document, command, visual, content, comments, presentation-shared, and vNext owners. | Legacy deck, command, export, theme, presenter, public-viewer, and fallback contracts are gone or explicitly rehomed. |
| Test/support cleanup        | Removed legacy-only tests, fixtures, builders, docs, and README references in the same deletion slice.                                                            | Focused presentation, public-render, visual/export, and document-generation checks pass without v6 helpers.           |

## Current Counts

- Static production imports from legacy presentation paths outside the legacy
  tree: 0.
- Broad non-test references outside the legacy tree: 0.
- Legacy files still present: 0 under `src/components/presentation/**` and 0
  under `src/lib/presentation/**`.

## Constraints

- Keep the vNext production import boundary at zero legacy presentation imports.
- Do not add v6-to-v7 compatibility layers.
- Keep current, data-agnostic behavior under explicit non-legacy owners; do not
  recreate fallback-only behavior.

## Verification

```bash
rg "@/(lib|components)/presentation" src --glob "*.{ts,tsx}" --glob "!**/*.test.*"
npx prettier --write <touched files>
npx eslint <touched lintable files>
npm run test:presentation
npm run test:public-render
npm run test:visual
npm run test:documents
npm run typecheck
```
