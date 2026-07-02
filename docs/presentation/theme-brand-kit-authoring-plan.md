---
type: "plan"
status: "active — implementation pending"
last_updated: "2026-07-02"
description: "Remaining P2 work for authoring user/workspace brand kits as validated v7 theme packages."
---

# Theme Brand Kit Authoring Plan

## Priority And Goal

**Priority:** P2.

Let users author custom brand kits that compile to validated `ThemePackageV1`
snapshots consumed by the existing v7 render, present, public render, and export
paths.

## Remaining Work

| Slice                     | Work                                                                                                                                                                                                                            | Exit criteria                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Draft schema and compiler | Define a product-facing brand-kit draft schema for identity, palette roles, typography roles, assets, and decoration preferences. Compile drafts into `ThemePackageV1` snapshots and validate them with `validateThemePackage`. | Valid, warning, and invalid draft fixtures map diagnostics back to authoring fields.                              |
| Persistence and lookup    | Store user/workspace drafts separately from immutable compiled package snapshots and resolve custom package ids at deck-loading boundaries.                                                                                     | Editor, present, public render, and export receive validated custom packages or neutral fallback diagnostics.     |
| Authoring UI              | Build palette, typography, asset binding, decoration preference, preview, publish, and apply controls.                                                                                                                          | Users can create, preview, validate, publish, and apply a custom brand kit without editing package JSON.          |
| Custom font integration   | Reuse durable font assets and `buildFontFaceCss` so brand-kit typography tokens preview in the editor and lower to PPTX `fontFace`.                                                                                             | Custom font metadata rehydrates consistently for render and export with duplicate injection avoided per revision. |
| Contrast validation       | Validate WCAG text/non-text contrast, chart distinguishability, table cells, connector labels, and compiled style refs before publish.                                                                                          | Critical failures block publish/apply; warnings can stay on editable drafts with clear field diagnostics.         |
| Regression coverage       | Add focused render/export tests for custom package token resolution, decorations, font rehydration, and PPTX text faces.                                                                                                        | Custom packages are covered by presentation, visual, and typecheck gates for touched slices.                      |

## Constraints

- Do not add slide masters or v6 theme paths.
- `resolveDeckRenderTree` should continue receiving a validated package; it
  should not learn brand-kit authoring concepts.
- Decks should reference immutable compiled package id/version values so render
  stays deterministic when drafts change later.

## Verification

Implementation follow-ups should run focused brand-kit/compiler tests,
`npm run test:presentation`, `npm run test:visual`, and `npm run typecheck` as
the touched surface requires.
