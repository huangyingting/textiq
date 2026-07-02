---
type: "plan"
status: "active — legacy surface deletion pending"
last_updated: "2026-07-02"
description: "Remaining P0 work to remove dynamic legacy presentation references and delete the legacy v6 presentation surface after the full-removal product decision."
---

# Legacy Retirement Plan

## Priority And Goal

**Priority:** P0.

Delete the legacy v6 presentation surface. Product fallback policy is resolved:
no implicit v6 editor, presenter, public viewer, export, or deck route remains a
supported mode.

## Remaining Work

| Slice                       | Work                                                                                                                                                                  | Exit criteria                                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| External dynamic references | Remove the remaining non-test references from outside the legacy tree, currently the dynamic v6 export imports in `src/components/editor/document-export-button.tsx`. | `rg "@/(lib                                                                                                           | components)/presentation"` finds no non-test references outside retained legacy-internal files. |
| Legacy component tree       | Delete or migrate `src/components/presentation/**` files that are not retained as shared non-legacy presentation APIs.                                                | No product route or editor entry point imports the legacy component surface.                                          |
| Legacy library tree         | Delete or migrate v6-specific `src/lib/presentation/**` modules after any still-current helpers move to owned APIs.                                                   | Legacy deck, command, export, theme, presenter, public-viewer, and fallback contracts are gone or explicitly rehomed. |
| Test/support cleanup        | Remove legacy-only tests, fixtures, builders, docs, and README references in the same deletion slices.                                                                | Focused presentation, public-render, visual/export, and document-generation checks pass without v6 helpers.           |

## Current Counts

- Static production imports from legacy presentation paths outside the legacy
  tree: 0.
- Broad non-test references outside the legacy tree: 2 references in 1 file.
- Legacy files still present: 69 under `src/components/presentation/**` and 206
  under `src/lib/presentation/**`.

## Constraints

- Keep the vNext production import boundary at zero legacy presentation imports.
- Do not add v6-to-v7 compatibility layers while deleting residuals.
- Move only current, data-agnostic behavior to explicit non-legacy owners;
  delete fallback-only behavior with the v6 surface.

## Verification

```bash
rg "@/(lib|components)/presentation" src --glob "*.{ts,tsx}" --glob "!**/*.test.*" --glob "!src/components/presentation/**" --glob "!src/lib/presentation/**"
npx prettier --write <touched files>
npx eslint <touched lintable files>
npm run test:presentation
npm run test:public-render
npm run test:visual
npm run test:documents
npm run typecheck
```
