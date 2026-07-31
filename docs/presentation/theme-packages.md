---
type: "contract"
status: "current"
last_updated: "2026-07-31"
description: "Theme packages are the presentation editor's bundled and custom visual-style units. A package owns theme tokens, named style refs, optional decorations, and package assets. Semantic templates are global presentation registry entries, not package-local templates."
---

# Presentation Theme Packages

Theme packages are the presentation editor's bundled and custom visual-style
units. A package owns theme tokens, named style refs, optional decorations, and
package assets. Semantic templates are global presentation registry entries,
not package-local templates.

Theme packages do not reintroduce v6 deck fields. Applying a package writes the
presentation theme binding on the deck:

- `Deck.theme.packageId`
- `Deck.theme.packageVersion`
- optional `Deck.theme.overrides`

Slides keep their `SlideNode.template.kind`, `children`, content, local style,
and source metadata. Switching a package changes visual resolution, not the
semantic slide tree.

## Package Catalog

The package catalog contains eight independent packages. `default` is not one
of those packages; it is an alias that resolves to `clarity` for older decks or
callers that still ask for the default package. The package ids remain stable
even when the visible style names are refreshed.

| Package     | Visible style         | Role                                                      |
| ----------- | --------------------- | --------------------------------------------------------- |
| `clarity`   | Swiss Minimal Grid    | Precise brand systems with light grids and blue emphasis. |
| `ocean`     | Iridescent Gradient   | Holographic pitch decks with glass panels and gradients.  |
| `aurora`    | Dark Aurora Corporate | Dark finance and strategy reports with luminous glass.    |
| `monolith`  | Brutalist Bold        | High-impact black, red, and lime creative decks.          |
| `editorial` | Editorial Serif Luxe  | Cream, cobalt, and gold editorial storytelling decks.     |
| `noir`      | Luxe Maroon Magazine  | Premium maroon and gold portfolio or brand decks.         |
| `terra`     | Vibrant Pop           | Playful yellow, red, and blue creative brief decks.       |
| `pulse`     | Tech Terminal Mono    | Neon terminal-style decks with mono typography and grids. |

The canonical semantic template catalog is defined globally by
`SEMANTIC_TEMPLATE_KINDS` in `src/lib/presentation/template-registry.ts`.
It includes opening, core, compare, proof, flow, decision, business, and closing
templates such as `cover`, `executive-summary`, `evidence`, `table`, `roadmap`,
`recommendation`, and `appendix`.

Several semantic kinds may reuse the same render family. For example,
`comparison` and `tradeoff` may share a two-column physical layout, while
`evidence` and `table` share table rendering. The semantic id is still the
runtime template id so AI plans and editor UI can reason in content terms.

All eight packages are derived from the validated prototype pipeline under
`prototypes/slide-themes`. The visual source is the native presentation
`ThemePackageV1` manifest in `prototypes/slide-themes/theme-packages.ts`.
The generator validates those packages, compiles every global semantic template
kind into schema-valid `Deck` preview decks, writes generated presentation package JSON,
and renders static previews through the shared presentation render tree. Run the full
pipeline with `npm run slide-themes:generate`; use `npm run slide-themes:build`
or `npm run slide-themes:html` when only one step is needed.

## Apply Behavior

Applying a package is deterministic:

- `theme.packageId` is set to the package id.
- `theme.packageVersion` is set to the package version when available.
- Existing slides keep their `template`, `children`, `content`, `source`, and
  `localStyle`.
- Deck-level `theme.overrides` are preserved unless the caller explicitly
  replaces or clears them.

Node-level `localStyle` patches are explicit user edits and are resolved above
package styles until the user clears them.

## Custom Brand Kits

Users can author custom brand kits without editing raw package JSON. The
authoring flow stores mutable `BrandKitDraftV1` drafts separately from immutable
compiled `ThemePackageV1` snapshots. Publishing compiles the draft through
`compileBrandKitDraft`, validates the resulting package with
`validateThemePackage`, and saves the compiled package id/version that decks
reference at render and export boundaries.

Custom packages resolve through the same package registry surface as bundled
packages. Editor, present, public render, and export callers receive validated
`ThemePackageV1` values; unresolved custom ids fall back neutrally with
diagnostics rather than teaching renderers brand-kit draft concepts.

Brand-kit drafts cover identity, palette roles, typography roles, image/font
assets, and decoration preferences. Publish validation maps diagnostics back to
authoring fields, blocks critical WCAG text-contrast failures, keeps non-text
contrast issues as warnings, and validates referenced style/font assets before
the package can be applied.

Saving a valid draft crosses a single synchronous operation boundary. While
persistence is pending, the authoring fields and Close action remain locked so
the saved snapshot cannot drift and duplicate activation cannot create a second
request. Rejected persistence calls surface an accessible, retryable error;
retry starts a fresh operation after the previous one settles. Results from an
invalidated operation or an unmounted authoring panel are ignored and cannot
publish stale state or invoke the saved callback.

Custom font assets reuse the durable brand-font pipeline. Runtime rendering
injects escaped `@font-face` CSS through `buildFontFaceCss`, while editable PPTX
export lowers custom typography tokens to PPTX `fontFace` names. Font injection
is keyed by package revision so repeated renders avoid duplicate stylesheet
rules.

## Template Identity

slide identity is semantic. A slide stores its template provenance as:

```ts
SlideNode.template.kind;
SlideNode.template.layoutId;
```

Template kinds are global values such as `cover`, `comparison`, `roadmap`, and
`closing`; they are not prefixed with the package id. Package ids identify visual
style packages only.

## Editor Surfaces

The theme picker presents packages as the primary theme choices. Selecting a
theme package updates the deck's presentation theme binding.

The Add slide picker uses the global semantic template registry and groups
templates by metadata group: Opening, Core, Compare, Proof, Flow, Decision,
Business, and Closing.

Template metadata is registry-owned. It includes labels, group, priority,
best-use guidance, slot acceptance, capacity, and layout variants for AI and UI
consumers. It is not duplicated inside theme packages.

## Master Boundary

has no slide masters in the active package path. Shared visual personality is
expressed as package styles and `ThemeDecorationRecipe` entries, then injected by
`resolveDeckRenderTree` according to slide chrome/decoration props.

Theme packages can express rich visual backgrounds without owning layout:
`FillStyle` supports solid, linear, radial, conic, repeating-linear, pattern,
and image fills. Pattern fills cover grids, dots, stripes, and scanlines.
Decoration recipes can target specific semantic template kinds or layout ids via
`appliesTo`, so package motifs can be expressive on covers and section dividers
without polluting every slide.
