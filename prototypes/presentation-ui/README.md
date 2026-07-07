# TextIQ — Presentation UI Design Explorations

Type: Design exploration
Status: Draft for review
Last updated: 2026-07-07

Static HTML/CSS design mockups exploring modern, compact, better-looking layouts for the
**shared UI components of the presentation editor**. Nothing here is wired into the app —
these are design options to compare and choose from.

## How to view

Open **[`index.html`](./index.html)** in a browser for the full gallery, or open any individual
mockup file directly. No build step and no network access are required — every file is
self-contained and links the shared token stylesheet.

Each component folder also has its own `index.html` that previews its six directions
side-by-side (iframe cards).

## What was designed

Shared components were identified from the real presentation code, then each was explored as
**6 distinct directions**. Delivered in two rounds — **12 components, 72 solutions total**.

### Round 1 — Editor chrome (the always-visible frame)

| # | Component | Folder | Redesigns |
|---|-----------|--------|-----------|
| 1 | Top Deck Toolbar | [`top-toolbar/`](./top-toolbar/index.html) | `src/components/presentation/toolbar/deck-toolbar.tsx` + `slide-editor.tsx` |
| 2 | Context / Popover Toolbar | [`context-toolbar/`](./context-toolbar/index.html) | `src/components/presentation/toolbar/floating-toolbar.tsx` |
| 3 | Right Inspector Panel | [`inspector-panel/`](./inspector-panel/index.html) | `src/components/presentation/inspector/inspector-shell.tsx` |
| 4 | Slide Filmstrip | [`slide-filmstrip/`](./slide-filmstrip/index.html) | `src/components/presentation/filmstrip/filmstrip.tsx` |
| 5 | Status Bar / Footer | [`status-bar-footer/`](./status-bar-footer/index.html) | `src/components/presentation/slide-editor-footer.tsx` |
| 6 | Shared Control Primitives | [`control-primitives/`](./control-primitives/index.html) | `src/components/ui/*.tsx` |

### Round 2 — Overlays, menus & pickers (the on-demand surfaces)

| # | Component | Folder | Redesigns |
|---|-----------|--------|-----------|
| 7 | Present-Mode Toolbar | [`present-mode-toolbar/`](./present-mode-toolbar/index.html) | `src/components/presentation/present-mode/presenter-tools.tsx` |
| 8 | Modal Dialog | [`modal-dialog/`](./modal-dialog/index.html) | `src/components/ui/dialog.tsx` |
| 9 | Command Palette | [`command-palette/`](./command-palette/index.html) | `src/components/presentation/slide-command-palette.tsx` |
| 10 | Dropdown / Context Menu | [`dropdown-menu/`](./dropdown-menu/index.html) | `src/components/ui/select-menu.tsx` |
| 11 | Color Picker | [`color-picker/`](./color-picker/index.html) | `src/components/ui/color-picker.tsx` |
| 12 | Template Picker | [`template-picker/`](./template-picker/index.html) | `src/components/presentation/add-slide-template-picker.tsx` |

### Directions per component

- **Top toolbar** — unified glass bar · grouped segment rail · floating capsule · compact icon-dense · editorial contrast · two-tier context bar
- **Context toolbar** — rounded pill overlay · segmented cluster · ultra-compact mono · tactile raised keys · adaptive two-row · contextual accent
- **Inspector panel** — flat sectioned scroll · collapsible accordion · card-grouped · dense two-column · segmented header tabs · inline label rows
- **Slide filmstrip** — classic thumb rail · compact numbered chips · elevated carousel · outline minimal · grouped sections · hover action overlay
- **Status bar / footer** — minimal statusline · pill zoom control · segmented clusters · icon-forward compact · accent save-state · two-zone balanced
- **Control primitives** — flat outline · soft raised · pill capsule · recessed segment · glass translucent · high-contrast mono

Round 2:

- **Present-mode toolbar** — floating bottom bar · corner cluster · glass HUD · presenter console · edge-docked rail · minimal progress
- **Modal dialog** — centered classic · compact alert · hero illustrated · toolbar-footer checklist · side drawer · bottom sheet
- **Command palette** — spotlight centered · compact list · grouped categories · two-pane preview · minimal flat · keyboard-forward
- **Dropdown / context menu** — compact list · icon-leading · sectioned labels · rich description · context-menu dense · elevated rounded
- **Color picker** — swatch grid classic · spectrum + swatches · compact row · theme-aware sections · large preview inputs · minimal dots
- **Template picker** — category grid · sidebar categories · tabbed groups · large preview list · compact tiles · filmstrip rows

## Design system

Every mockup links [`design-tokens.css`](./design-tokens.css), a **verbatim extraction of the
product's `--ds-*` chrome tokens** from `src/app/globals.css` (surfaces, text, borders, accent,
status, radii, elevation, spacing, motion). All chrome styling uses `var(--ds-*)` so the options
stay on-brand and directly comparable to the real product. Icons are hand-written, lucide-style
inline SVG (no icon fonts or CDNs).

## Constraints honoured

- Self-contained, offline-openable; no build, no external CDN, no JS framework.
- Compact vertical rhythm (control height ~28–32px, 12–13px icons, 11–12px labels).
- Parity-first: each redesign preserves the real controls, groups, and states of its source component.
- Accessible: semantic elements, `aria-*` labels, visible accent focus rings.

## Review status

Both rounds were reviewed by the same trio; all must-fix items are resolved.

- **QA (Mouse):** ✓ Ready — all 12 folders pass well-formedness, token-link, no-external-deps,
  spec-header, gallery-integrity, and accessibility checks. No true duplicates. (Round 2: template-picker
  spec-headers were added to restore heading parity.)
- **RAI (Rai):** 🟢 Green — no secrets, PII, harmful content, or unsafe scripts; all references local.
  Destructive-dialog copy is honest and clearly labelled.
- **Design & architecture (Morpheus):** ✅ Ready — genuinely distinct directions, strong parity, good
  token discipline. **17 minor off-token color nits total (9 in round 1, 8 in round 2) were found and
  resolved.** See **[`REVIEW.md`](./REVIEW.md)** for per-component verdicts and the recommended direction to ship.

### Recommended direction per component

| Component | Recommended | Why |
|-----------|-------------|-----|
| Top toolbar | `top-toolbar/05-editorial-contrast.html` | Identity zone + accent-filled primary CTAs |
| Context toolbar | `context-toolbar/04-tactile-raised-keys.html` | Tactile toggle affordance for formatting |
| Inspector panel | `inspector-panel/05-segmented-header-tabs.html` | Mirrors the real InspectorShell tab routing |
| Slide filmstrip | `slide-filmstrip/01-classic-thumb-rail.html` | Best preview fidelity + clear active state |
| Status bar / footer | `status-bar-footer/05-accent-save-state.html` | Semantic save chip + presence avatars |
| Control primitives | `control-primitives/04-recessed-segment.html` | Uses `--ds-segment-track/thumb`; unifies the set |
| Present-mode toolbar | `present-mode-toolbar/04-presenter-console.html` | Keynote dual-view; deepest `--ds-stage-*` usage |
| Modal dialog | `modal-dialog/04-toolbar-footer-checklist.html` | Preflight checklist maps to the export workflow |
| Command palette | `command-palette/04-two-pane-preview.html` | Context preview pane aids command discovery |
| Dropdown / context menu | `dropdown-menu/03-sectioned-labels.html` | Section grouping mirrors real toolbar menus |
| Color picker | `color-picker/04-theme-aware-sections.html` | Brand-kit groupings align with the product |
| Template picker | `template-picker/04-large-preview-list.html` | Master/detail maximises insert confidence |

## Folder layout

```
presentation-ui/
├── index.html              ← top-level gallery (start here)
├── README.md               ← this file
├── REVIEW.md               ← design review + recommendations
├── design-tokens.css       ← shared --ds-* tokens (one source of truth)
├── top-toolbar/            ← Round 1 · 6 solutions + index.html
├── context-toolbar/        ← Round 1 · 6 solutions + index.html
├── inspector-panel/        ← Round 1 · 6 solutions + index.html
├── slide-filmstrip/        ← Round 1 · 6 solutions + index.html
├── status-bar-footer/      ← Round 1 · 6 solutions + index.html
├── control-primitives/     ← Round 1 · 6 solutions + index.html
├── present-mode-toolbar/   ← Round 2 · 6 solutions + index.html
├── modal-dialog/           ← Round 2 · 6 solutions + index.html
├── command-palette/        ← Round 2 · 6 solutions + index.html
├── dropdown-menu/          ← Round 2 · 6 solutions + index.html
├── color-picker/           ← Round 2 · 6 solutions + index.html
└── template-picker/        ← Round 2 · 6 solutions + index.html
```
