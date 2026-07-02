---
type: "contract"
status: "current"
last_updated: "2026-07-02"
description: "This document defines the current Document.deckJson contract. Persisted decks must be Deck JSON. Runtime open, save, render, and export paths reject superseded payload shapes instead of repairing or upgrading them."
---

# Deck Persisted Contract

This document defines the current `Document.deckJson` contract. Persisted decks
must be Deck JSON. Runtime open, save, render, and export paths reject
superseded payload shapes instead of repairing or upgrading them.

## Source Anchors

- `src/lib/presentation/schema.ts` — Deck TypeScript contract.
- `src/lib/presentation/validation.ts` — `safeParseDeck` schema gate.
- `src/lib/presentation/open-deck.ts` — editor/public open boundary.
- `src/lib/document/deck-cas-writer.ts` — validated compare-and-swap writes.
- `src/lib/presentation/editor-commands.ts` — immutable deck mutations.
- `src/lib/presentation/render-resolver.ts` — resolved render tree.
- `src/lib/presentation/export-spec.ts` — DOM-free export operations.

## Contract Boundary

`Document.deckJson` stores a complete `Deck` object. It is independent of
`Document.contentJson`; document edits and deck edits persist through separate
write paths. Document content can seed or refresh deck content, but a saved deck
is its own authored artifact.

The only accepted persisted deck version is `schemaVersion: 7`.

```ts
type Deck = {
  schemaVersion: 7;
  id?: DeckId;
  title?: string;
  canvas: CanvasSpec;
  theme: DeckThemeBinding;
  chrome?: DeckChromeConfig;
  assets: DeckAssetRegistry;
  slides: SlideNode[];
  metadata?: DeckMetadata;
};
```

Unknown top-level keys are rejected. Fields from earlier deck shapes such as
`elements`, `masters`, `customTemplates`, `design`, and `defaultMasterId` are
not valid Deck fields.

## Schema Gate

`safeParseDeck` validates unknown input without mutating it. It returns typed
data only when the full structure is valid.

The gate enforces these deck-level rules:

- `schemaVersion` must be `7`.
- `canvas` must be an object with `format`, positive `width` and `height`, and
  `unit: "percent"`.
- `canvas.format` must be `"16:9"`, `"4:3"`, `"square"`, or `"custom"`.
- `theme.packageId` must be a non-empty string.
- `assets.images` must be an object; other registries are optional.
- `slides` must be a non-empty array.
- Deck, slide, and node ids must be valid non-empty ASCII ids with max length 128.
- Slide and child-node ids share one deck-wide uniqueness set.

Repair is not performed by validation. Import, paste, AI-plan, and authoring
boundaries must normalize external or partial input before it reaches
`safeParseDeck`.

## Open Boundary

`openDeckFromJson` is the single open boundary for editor, present-mode, public
render, and AI-apply handoff. It accepts valid Deck payloads directly and
returns `ok: false` for malformed, missing, unknown, or superseded schema
versions.

`decideDeckOpen` distinguishes three editor-start cases:

| Mode       | Input condition                                    | Runtime behavior                                     |
| ---------- | -------------------------------------------------- | ---------------------------------------------------- |
| `blank`    | `null` or `undefined` deck candidate               | Start from an explicit blank deck.                   |
| `open`     | Valid Deck payload                                 | Use the validated deck directly.                     |
| `recovery` | Non-empty payload that fails open or Deck validate | Surface recovery diagnostics; do not silently blank. |

At the document-editor entry point, the `blank` decision is only the persisted
deck open result. If the current document has usable Lexical content, the Slides
button supplies a deterministic `deriveDeckFromDocumentContent` fallback so
the first editor session opens with document-derived slides and semantic slide
templates. Empty documents still use the explicit blank deck.

There is no runtime migration shim for older deck payloads.

## Canvas

Deck uses percent-coordinate canvas geometry. `CanvasSpec` carries the slide
format and dimensions, and render/export code converts frames to pixels or
inches at the boundary that needs those units.

```ts
type CanvasSpec = {
  format: "16:9" | "4:3" | "square" | "custom";
  width: number;
  height: number;
  unit: "percent";
  safeArea?: InsetsPct;
};
```

## Theme And Chrome

`DeckThemeBinding` selects the runtime theme package and optional overrides.
Theme packages provide tokens, style refs, semantic templates, and decorations.

```ts
type DeckThemeBinding = {
  packageId: ThemePackageId;
  packageVersion?: ThemeVersion;
  brandKitId?: string;
  overrides?: ThemeOverridePatch;
};
```

Deck-level chrome is stored in `Deck.chrome` or in
`DeckThemeBinding.overrides.chrome`. Supported chrome slots are:

- `logo`
- `footer`
- `pageNumber`
- `watermark`
- `border`
- `safeArea`

Slides can opt into chrome behavior through `SlideProps.chrome` and can override
individual deck chrome slots through `SlideProps.deckChrome` using modes
`inherit`, `disabled`, `detached`, or `override`.

## Asset Registry

`DeckAssetRegistry` keeps deck-local asset references. Images are required;
fonts, visuals, and files are optional.

```ts
type DeckAssetRegistry = {
  images: Record<AssetId, ImageAsset>;
  fonts?: Record<AssetId, FontAsset>;
  visuals?: Record<AssetId, VisualAssetRef>;
  files?: Record<AssetId, FileAsset>;
};
```

Image nodes reference `assets.images`. Visual nodes may reference a visual
registry entry or carry a direct `visualId`. Export resolution may resolve visual
registry entries through backing image/file assets, but unresolved references
produce diagnostics rather than being silently rewritten in persisted JSON.
Asset `src` values are validated as safe URLs: `http:`, `https:`, and `data:`
schemes are accepted, while protocol-relative and control-character URLs are
rejected.

## Slide Model

Each slide is itself a node with `type: "slide"`. Slide content lives in
`children`, not in `elements`.

```ts
type SlideNode = BaseNode & {
  type: "slide";
  template: SlideTemplateBinding;
  controls?: SlideControls;
  props?: SlideProps;
  children: SlideChildNode[];
  notes?: string;
};
```

Slide validation rejects keys outside the Deck slide schema. In particular,
`slides[].elements` is rejected.

Slide template bindings identify semantic intent and optional layout id. Normal
render/export consumes materialized slide children; it does not synthesize
content from older flat slide fields at render time.

## Child Node Model

Supported child node types are:

- `text`
- `image`
- `shape`
- `connector`
- `table`
- `visual`
- `group`

All child nodes may carry stable identity, semantic role, layout, style binding,
local style, hidden/locked state, accessibility metadata, and source metadata.
Renderable nodes require a valid `layout` before they can resolve into the
render tree.

Key content rules:

- Text nodes store `content.paragraphs[]`; each run must provide string `text`,
  optional boolean formatting flags, optional `localStyle` scalar fields
  (`color`, `fontSizePt`, `fontFamily`), and optional `link` values limited to
  `http:`, `https:`, `mailto:`, or `tel:`. Run text must concatenate exactly to
  paragraph text.
- Paragraph `list` markers require `kind: "bullet" | "number"`; optional
  `indent` must be an integer `>= 0`, and optional `numberStyle` must be one of
  `decimal`, `lower-alpha`, `upper-alpha`, or `lower-roman`.
- Image nodes require a non-empty `content.assetId`.
- Shape nodes require a supported `content.shape`; `shape: "path"` requires a
  non-empty `path` string.
- Connector nodes require object `from` and `to` endpoints of kind `point` or
  `node`.
- Table nodes accept 1-8 columns and 1-20 rows; every row must have exactly one
  cell per column.
- Visual nodes must provide `assetId` or `visualId`.
- Group nodes require a supported `component`, a non-empty `children` array, and
  nesting depth no greater than 4.
- `localStyle`, slide style, chrome style, and theme override style patches only
  accept known style fields; unknown keys are rejected at validation time.

Default materialization uses type-based layer bands for `layout.zIndex` so
unarranged objects render predictably: shapes sit in the lowest content band,
image/visual/table nodes sit above shapes, connectors sit above content objects,
and text sits in the highest default band. Template-local `zIndex` values are
preserved inside each band, while user arrange actions may still explicitly
change z-order later.

## Source Metadata

Slides and child nodes may carry `source` metadata that links deck content back
to document blocks or visual assets.

```ts
type NodeSourceMetadata = {
  documentId?: string;
  blockId?: string;
  blockKind?: "text" | "visual" | "table" | "image";
  contentHash?: string;
  blockRevision?: string;
  linkedAt?: string;
  display?: SourceDisplayMetadata;
  refresh?: SourceRefreshMetadata;
  unlinked?: boolean;
  extra?: Record<string, JsonValue>;
};
```

`refresh.state` is one of `fresh`, `stale`, `orphan`, `unlinked`, or `unknown`.
Source-link classification and refresh logic live in
`src/lib/presentation/source-links.ts`; validation only checks the shape.

## Mutations

Deck editor commands are immutable. Each command receives a `Deck` and
returns a new `Deck`; resolved styles are not written back into nodes.

Command families include:

- slide insert, duplicate, delete, move, and template apply;
- slide controls, attributes, local style, source metadata, and chrome updates;
- node insert, paste, content, layout, attributes, source metadata, style
  binding, local style, grouping, z-order, and deletion;
- asset metadata updates.

Command output must still pass the Deck schema gate before persistence.

## Persistence And Revision Tokens

Deck writes go through server actions and `writeDeckWithCas`.

The CAS writer:

1. validates the submitted value with `safeParseDeck`;
2. serializes the parsed Deck payload;
3. rejects payloads over the deck JSON byte limit;
4. writes with `deckRevisionToken` compare-and-swap when a client token is
   supplied;
5. mints a fresh revision token on success.

Validation failures return `ok: false` and report schema telemetry. CAS misses
return `ok: "conflict"` with the server revision token. No save path accepts an
older deck shape as a compatibility fallback.

## Render And Export

`resolveDeckRenderTree` converts `Deck` plus a loaded theme package into the
resolved render tree consumed by React renderers, public viewers, and export
spec builders.

The resolver:

- excludes hidden nodes;
- orders user nodes by ascending `zIndex` with stable tree-order ties;
- injects theme decorations separately from user nodes;
- filters decoration and chrome by slide props;
- resolves style tokens before returning;
- emits diagnostics for unresolved assets, style refs, token refs, and unsafe
  export fallbacks.

`buildExportSpec` converts the resolved tree into DOM-free operations:
background, text, shape, image, connector, visual, and tableShape. Browser/PPTX
adapters perform file-generation side effects after this pure spec step.

## Invariants

1. `Document.deckJson` must be valid Deck JSON.
2. Runtime open/save paths reject superseded deck payload shapes.
3. Deck repair happens before validation, not inside validation.
4. Slide content lives in `SlideNode.children`.
5. Render/export paths consume resolved render trees, not persisted local style
   fragments directly.
6. Commands are immutable and write authored deck state only.
7. Source metadata is structured, optional, and never inferred from missing
   fields.
8. Deck persistence is guarded by revision-token CAS.

## Primary Tests

- `src/lib/presentation/validation.test.ts`
- `src/lib/presentation/open-deck.test.ts`
- `src/lib/presentation/editor-commands*.test.ts`
- `src/lib/presentation/render-resolver.test.ts`
- `src/lib/presentation/export-spec.test.ts`
- `src/lib/presentation/pptx-export-adapter.test.ts`
- `src/lib/document/deck-cas-writer.test.ts`
