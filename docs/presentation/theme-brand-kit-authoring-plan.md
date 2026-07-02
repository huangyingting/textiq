---
type: "plan"
status: "active — P2 spike, awaiting leaf-issue scheduling"
last_updated: "2026-07-02"
description: "Plan for authoring user/workspace brand kits as validated v7 theme packages."
---

# Theme Brand Kit Authoring Plan

## Priority and goal

Priority: P2 spike for issue #1624.

Goal: define how users author custom theme/brand kits for v7 decks without adding
slide masters, v6 theme paths, or implementation code in this spike. The authoring
surface should produce a `ThemePackageV1`-compatible package so render, preview,
present, public render, and export keep using the existing v7 theme package path.

## Current behavior

- The runtime registry is fixed to built-in package JSON plus Neutral fallback:
  `theme-package-registry.ts` imports the eight generated package manifests at
  lines 1-8, maps only `BUILT_IN_THEME_PACKAGE_IDS` at lines 22-35, validates them
  into `THEME_PACKAGE_REGISTRY` at lines 41-53, and resolves deck package ids from
  that in-memory map at lines 77-91. There is no user/workspace package loader or
  authoring API in that registry.
- The add-slide picker is selection-only UI. It receives templates and callbacks,
  renders grouped template cards, and calls `onChoose({ kind, layoutId })` from
  layout buttons at `add-slide-template-picker.tsx:77-167`; it does not collect or
  mutate palette, typography, asset, or theme-package data.
- The v7 package contract is already the canonical render input:
  `ThemePackageV1` requires `schemaVersion`, `id`, `version`, `name`, `tokens`,
  and `styles`, with optional `decorations`, `chrome`, and `assets` in
  `theme-package-schema.ts:52-63`. The theme package doc says applying a package
  writes only `DeckV7.theme.packageId`, `DeckV7.theme.packageVersion`, and optional
  `DeckV7.theme.overrides` while slides keep semantic content and local style in
  `docs/presentation/theme-packages.md:15-24`.
- Token/style resolution already accepts package tokens plus deck overrides:
  `style-resolver.ts:1-8` documents package styles, deck overrides, and local style
  order; `style-resolver.ts:196-227` resolves token refs after merging package and
  deck theme tokens.
- Rendering and export already consume a loaded `ThemePackageV1`:
  `resolveDeckRenderTree` takes `DeckV7 + ThemePackageV1`, resolves theme tokens,
  injects decorations, and returns one resolved tree for render/export surfaces in
  `render-resolver.ts:1-17` and `render-resolver.ts:43-75`. The PPTX path is
  `DeckV7 + ThemePackageV1 → resolveDeckRenderTree → buildExportSpec →
buildVnextPptxSpec → applyVnextPptxSpec` in `pptx-vnext-apply.ts:11-17` and
  `pptx-vnext-apply.ts:124-138`.
- V7 explicitly has no slide masters in the active package path; shared visual
  personality is package styles and `ThemeDecorationRecipe` entries injected by
  `resolveDeckRenderTree` (`docs/presentation/theme-packages.md:104-115`).

## User-authored theme token model

Authoring should expose a smaller brand-kit model and compile it into a validated
`ThemePackageV1`, instead of asking users to edit package JSON directly.

### Brand-kit draft

A draft should be stored as editable product data:

- Identity: name, slug, owner scope (`user` or `workspace`), source preset id, and
  version/revision metadata.
- Palette roles:
  - `background.primary`, `background.muted`, `background.inverse`.
  - `surface.primary`, `surface.muted`, `surface.accent`, `surface.inverse`.
  - `text.primary`, `text.secondary`, `text.muted`, `text.inverse`, `text.accent`.
  - `accent.primary`, `accent.secondary`, `accent.tertiary`, `accent.onPrimary`.
  - `border.subtle`, `border.strong`, `chart.series.1-8`, and semantic states
    (`positive`, `warning`, `danger`, `info`).
- Typography roles:
  - `display`, `heading`, `body`, `caption`, `mono`, and `data` font-family stacks.
  - Per-role size scale, weight, line-height, letter spacing, and text transform.
  - Fallback family for missing custom assets.
- Optional brand assets: logo image asset id, mark image asset id, background image
  asset ids, and custom font asset ids.
- Decoration preferences: density, logo placement, motif visibility, and whether a
  preset decoration recipe is enabled or disabled.

### Compile target

The compiler should convert the draft into package fields:

- `tokens.colors.*` and `tokens.fonts.*` entries used by existing style refs.
- `styles[styleRef].default` and variants based on a selected source preset, with
  role tokens substituted instead of hard-coded colors/fonts.
- `assets.images` and `assets.fonts` for package-local logo/background/font assets.
- Optional `decorations` for brand marks, accent motifs, or background recipes.
- Optional `chrome` defaults for slide chrome/decoration behavior.

Every saved or published draft must be compiled and passed through
`validateThemePackage` before it can be selected. Invalid drafts should stay as
editable drafts with diagnostics mapped back to authoring fields.

## Custom font assets

Custom fonts should be shared with the font picker work in issue #1622. The brand
kit should persist font asset ids and expose them as package `assets.fonts`, while
compiled styles reference the chosen family via typography tokens. Browser preview
and editor render should rehydrate the stored asset URL before rendering the deck.

Existing escaping should be reused, not reimplemented: `buildFontFaceCss` extracts
the bare family name from a CSS font stack, escapes single quotes, backslashes, and
control characters, and returns a safe `@font-face` rule in
`src/lib/brand/font-face.ts:16-38`. The authoring follow-up only needs to ensure
brand-kit font metadata flows into that helper and that duplicate injection is
keyed per brand/package revision.

## Persistence and runtime mapping

- Persist custom themes per user and per workspace. Workspace kits are visible to
  members with edit permissions; user kits are private defaults unless explicitly
  copied or promoted.
- Store editable drafts separately from compiled `ThemePackageV1` snapshots. A
  deck should reference the compiled package id/version in `DeckV7.theme` so deck
  render is deterministic even if the draft later changes.
- Use ids such as `custom:user:<userId>:<slug>` or
  `custom:workspace:<workspaceId>:<slug>` and immutable versions/revisions for
  snapshots. Avoid colliding with built-in package ids.
- Extend package lookup at the deck-loading boundary so the editor/present/export
  caller supplies the custom `ThemePackageV1` to the existing render path. If a
  custom package is missing, keep the existing neutral fallback diagnostic behavior
  and surface a repair action to choose another package.
- `resolveDeckRenderTree` should not learn authoring concepts. It should continue
  receiving a validated package and resolving package tokens, deck overrides,
  local styles, assets, and decorations into the render tree.
- PPTX export should use the same compiled package passed into render. Resolved
  text styles already lower `text.fontFamily` to PPTX `fontFace` in
  `pptx-lowerers/shared.ts:151-164`, so package typography tokens must resolve to
  concrete font-family strings before export.

## Palette contrast and accessibility validation

Authoring must validate palette combinations before publish:

- Check WCAG contrast for text/background pairs used by core styles: primary,
  secondary, muted, inverse, accent-on-accent, chart labels, table cells, and
  connector labels.
- Validate non-text contrast for borders, chart series, focus/selection overlays,
  and decorative marks that carry meaning.
- Warn when chart series are distinguishable only by hue; require alternate
  patterns or sufficient luminance separation for generated visuals.
- Run contrast checks on the compiled `ThemePackageV1`, not only on raw draft
  fields, so inherited preset variants and decorations are included.
- Permit draft save with warnings, but block publish/apply for critical failures
  unless the user explicitly chooses a non-accessible internal draft state.

## Proposed leaf issues

1. Define brand-kit draft schema and compiler contract.
   - Add a product-facing draft schema for palette, typography, assets, and
     decorations.
   - Compile drafts into `ThemePackageV1` snapshots and validate with
     `validateThemePackage`.
   - Include fixtures for valid, warning, and invalid drafts.
2. Build custom theme persistence and package lookup.
   - Add user/workspace storage for drafts and immutable compiled snapshots.
   - Extend deck load/apply flows so custom package ids resolve to validated
     packages before render, present, public render, and export.
   - Preserve neutral fallback diagnostics for missing custom packages.
3. Implement brand-kit authoring UI.
   - Add palette role editor, typography role editor, asset bindings, preview, and
     publish/apply controls.
   - Keep add-slide/template selection separate from brand authoring.
4. Integrate custom fonts with font picker #1622.
   - Reuse durable font assets and `buildFontFaceCss` for editor preview and deck
     rehydration.
   - Verify font-family tokens resolve to PPTX `fontFace` values.
5. Add palette contrast and accessibility validation.
   - Validate role pairs and compiled style refs.
   - Surface blocking errors, warnings, and suggested fixes in the authoring UI.
6. Add visual/export regression coverage for custom packages.
   - Cover render tree token resolution, decorations, font rehydration, and PPTX
     export text faces with a minimal custom package fixture.

## Verification and out-of-scope

Spike verification for this issue is this plan doc plus the presentation index
entry. No implementation, data migration, or GitHub leaf issue creation is part of
this task.

Implementation follow-ups should use the smallest reliable checks for touched
areas: `npm run test:presentation`, `npm run test:visual`, and `npm run typecheck`.
Custom font follow-ups should include focused tests around `buildFontFaceCss` and
font picker rehydration. Export follow-ups should include focused PPTX tests that
assert resolved font families lower to `fontFace`.

Out of scope:

- Slide masters. V7 uses theme packages, decoration recipes, and semantic slide
  trees; it must not add a slide-master authoring model.
- V6 theme paths, aliases, conversion bridges, or compatibility layers.
- Editing source code in this spike.
