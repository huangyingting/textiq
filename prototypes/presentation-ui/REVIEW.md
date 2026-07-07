# TextIQ Presentation UI — Design Mockup Review

**Type:** Architecture & Design Review  
**Status:** Complete (Round 1) + Active (Round 2)  
**Last updated:** 2026-07-07T01:23:18+00:00  
**Reviewer:** Morpheus (Lead / Architect)  
**Scope:** 72 HTML mockups + 12 galleries across 12 component folders (6 Round 1 + 6 Round 2)

---

## Overall Verdict

**✅ Ready to share as design options with the user.**

All 36 mockups link `design-tokens.css` and use `var(--ds-*)` for chrome styling. Parity with the real source controls is strong across every component — no essential control group is dropped. The 6 directions per component are genuinely distinct (layout, density, grouping, metaphor) — not recolors. Off-token chrome colors are concentrated in two areas (`control-primitives` color-dot borders; `context-toolbar/06` badge text) and are easy fixes before shipping any of those files.

**9 must-fix instances across 7 files** — none block the recommended solutions except `04-recessed-segment.html` (1 line).

---

## Per-Component Sections

---

### 1. Top Toolbar · `presentation-ui/top-toolbar/`

**Source:** `src/components/presentation/toolbar/deck-toolbar.tsx` + `slide-editor.tsx` (L2362–2851)

| # | File | Direction | Tokens |
|---|------|-----------|--------|
| 01 | `01-unified-glass-bar.html` | Single translucent glass bar, hairline dividers | 35 |
| 02 | `02-grouped-segment-rail.html` | Groups in recessed sunken pill rails | 42 |
| 03 | `03-floating-capsule-toolbar.html` | Independent floating capsule cards | 37 |
| 04 | `04-compact-icon-dense.html` | 26 px icon-only, max density | 44 |
| 05 | `05-editorial-contrast.html` | Identity zone left, accent-filled CTAs right | 67 |
| 06 | `06-two-tier-context-bar.html` | Primary row (identity/publish) + secondary row (editor) | 76 |

**Verdict: ✅**

- **Parity:** All solutions cover Theme select, Brand Kit, Slide ratio, Deck chrome, Snap, Source menu, Undo, Redo, Present, Share, Export, Save status. ✅
- **Distinctness:** Layout, density, grouping, and visual metaphor are genuinely different across all six. ✅
- **Token discipline:** Zero hardcoded chrome hex in any top-toolbar file. ✅
- **Accessibility:** `aria-label` on controls, `role="toolbar"`, focus rings. ✅

**Recommended: `05-editorial-contrast.html`**  
Left identity zone (deck title + theme breadcrumb) plus accent-filled Present/Share gives clear publishing intent and visual hierarchy — directly additive without restructuring the single-row layout the source uses.

**Runner-up: `06-two-tier-context-bar.html`**  
Best separation of publish vs. editing concerns. Note: doubles chrome height vs. the source's single `DeckToolbarRow` — implement as optional expanded mode.

**Must-fix:** None.

---

### 2. Context Toolbar · `presentation-ui/context-toolbar/`

**Source:** `src/components/presentation/toolbar/floating-toolbar.tsx`

| # | File | Direction | Tokens |
|---|------|-----------|--------|
| 01 | `01-rounded-pill-overlay.html` | Pill container, `shadow-overlay` elevation | 66 |
| 02 | `02-segmented-cluster.html` | Recessed sunken trays, hover-raised buttons | 64 |
| 03 | `03-ultra-compact-mono.html` | 24 px targets, monoline icons, monospace labels | 59 |
| 04 | `04-tactile-raised-keys.html` | Sunken tray, per-key raised shadow + lift on hover | 79 |
| 05 | `05-adaptive-two-row.html` | Row 1 always visible, Row 2 collapsible drawer | 75 |
| 06 | `06-contextual-accent.html` | Accent fill on active toggles + context mode stripe | 83 |

**Verdict: ✅ (⚠️ minor token defect in 06 only)**

- **Parity:** All solutions include Bold, Italic, Underline, Strikethrough, Align, Color, Font size/role, Group/Ungroup, Insert, Link, List, Indent, Lock, Delete, Duplicate. ✅
- **Distinctness:** Physical metaphors and density vary meaningfully. ✅
- **Token discipline:** `06-contextual-accent.html` lines 162, 174, 175 — `color: #fff` hardcoded on chrome badge/button text. Should use `var(--ds-text-on-accent)` (= `#ffffff` in tokens). Minor, but a defect. ⚠️

**Recommended: `04-tactile-raised-keys.html`**  
Sunken-tray + raised-key press metaphor maps directly to toggle on/off states; translateY lift gives precise active feedback. Highest token coverage (79) in group; no off-token chrome.

**Runner-up: `01-rounded-pill-overlay.html`**  
Cleanest expression of the floating/overlay nature of the context toolbar; easy to layer over any canvas.

**Must-fix (06-contextual-accent.html):**
- L162: `.toolbar-shape .tbtn.active { color: #fff }` → `color: var(--ds-text-on-accent)`
- L174: `.context-badge-shape { color: #fff }` → `color: var(--ds-text-on-accent)`
- L175: `.context-badge-slide { color: #fff }` → `color: var(--ds-text-on-accent)`

---

### 3. Inspector Panel · `presentation-ui/inspector-panel/`

**Source:** `src/components/presentation/inspector/inspector-shell.tsx` + sub-panels (`deck-chrome-panel.tsx`, `node-geometry-panel.tsx`, `node-content-panel.tsx`, `layers-panel.tsx`, etc.)

| # | File | Direction | Tokens |
|---|------|-----------|--------|
| 01 | `01-flat-sectioned-scroll.html` | Flat form rows, hairline section separators | 92 |
| 02 | `02-collapsible-accordion.html` | Chevron-toggled accordion sections | 87 |
| 03 | `03-card-grouped.html` | Each section in raised `shadow-raised` card | 88 |
| 04 | `04-dense-two-column.html` | 4-col X/Y/W/H grid; 2-col template selects | 100 |
| 05 | `05-segmented-header-tabs.html` | Sticky segmented subnav (TMPL·GEO·FILL·TYPE·EFX·LYR) | 94 |
| 06 | `06-inline-label-rows.html` | Fixed 86 px label column, 24 px row height | 86 |

**Verdict: ✅ (⚠️ single chrome defect in 01)**

- **Parity:** All solutions cover Template, Geometry (X/Y/W/H/Rotation/Opacity), Fill, Stroke, Font, Text Align, Arrange (layer order/lock/group), Effects/Shadow, Layers. Source panel set: `arrange`, `adjust`, `effects`, `layers`, `notes`, `source`, `diagnostics`. Tab navigation visible in 01, 05; accordion replaces tabs in 02–04, 06 — acceptable redesign variation. ✅
- **Distinctness:** Layout paradigm (form rows / accordion / cards / dense 2-col / sticky tabs / label-col) differs structurally. ✅
- **Token discipline:** Color swatches with `background:#4f46e5`/`background:#172033` are content values — acceptable. `01-flat-sectioned-scroll.html:245` has `background: #fff` in a CSS rule that appears to style a swatch ring dot (chrome), should be `var(--ds-surface)` or `var(--ds-surface-raised)`. ⚠️

**Recommended: `05-segmented-header-tabs.html`**  
Sticky segmented subnav mirrors `InspectorShell`'s tab routing (`arrange`/`adjust`/`effects`/`layers`/`notes`/`source`) most faithfully. Uses `--ds-segment-track`/`--ds-segment-thumb` tokens correctly. Accessible and scannable at panel widths.

**Runner-up: `04-dense-two-column.html`**  
Highest token density (100); 4-col geometry row saves ~40 px of height in a space-constrained side panel. Excellent for power users.

**Must-fix (01-flat-sectioned-scroll.html):**
- L245: `background: #fff` on swatch-ring chrome element → `var(--ds-surface)` or `var(--ds-surface-raised)`.

---

### 4. Slide Filmstrip · `presentation-ui/slide-filmstrip/`

**Source:** `src/components/presentation/filmstrip/filmstrip.tsx` + `filmstrip-slide.tsx`

| # | File | Direction | Tokens |
|---|------|-----------|--------|
| 01 | `01-classic-thumb-rail.html` | 128 px thumbnail, accent ring + glow, glass micro-buttons | 75 |
| 02 | `02-compact-numbered-chips.html` | 96 px, bold number top-left, accent bottom-bar | 76 |
| 03 | `03-elevated-carousel.html` | Active card scale(1.12) + translateY lift; neighbors recede | 76 |
| 04 | `04-outline-minimal.html` | Hairline border, flush with canvas surface, flat buttons | 73 |
| 05 | `05-grouped-sections.html` | Section chips with vertical-writing labels (Intro/Body/Close) | 80 |
| 06 | `06-hover-action-overlay.html` | Minimal rest state; pill overlay bar floats on hover | 79 |

**Verdict: ✅**

- **Parity:** All solutions cover active selection, drag-to-reorder, duplicate, delete, add-slide, collapse toggle, keyboard navigation (←/→/Delete). ✅
- **Distinctness:** Thumbnail size, active state treatment, action visibility, and grouping model differ structurally. ✅
- **Token discipline:** `background:#fff` on `.thumb` inner areas across all files = slide canvas content (acceptable per brief). Zero off-token chrome. ✅
- **Accessibility:** `aria-label` per slide, keyboard navigation, collapse toggle. ✅

**Recommended: `01-classic-thumb-rail.html`**  
128 px preview gives best slide content legibility; accent ring + glow provides unmistakable active state; glass micro-buttons on hover balance discoverability with visual cleanliness at rest.

**Runner-up: `06-hover-action-overlay.html`**  
Most minimal resting state — pill overlay approach keeps the rail uncluttered; most modern feel. Best if screen real estate is tight.

**Must-fix:** None.

---

### 5. Status Bar Footer · `presentation-ui/status-bar-footer/`

**Source:** `src/components/presentation/slide-editor-footer.tsx`

| # | File | Direction | Tokens |
|---|------|-----------|--------|
| 01 | `01-minimal-statusline.html` | Text-only status line, hairline dividers | 65 |
| 02 | `02-pill-zoom-control.html` | 3-segment connected zoom pill (out·value·in) | 105 |
| 03 | `03-segmented-clusters.html` | Three cluster cards on sunken tray | 86 |
| 04 | `04-icon-forward-compact.html` | 26 px bar, icon-only, badge chips for counts | 88 |
| 05 | `05-accent-save-state.html` | Semantic accent chip for save state + presence avatars | 103 |
| 06 | `06-two-zone-balanced.html` | CSS grid 1fr/auto/1fr true left–right balance | 96 |

**Verdict: ✅**

- **Parity:** All include filmstrip toggle, notes toggle, zoom control, save status, slide name/count, presence peers, source/diagnostics counts. ✅  
  Note: `04-icon-forward-compact.html` omits a visible fit-to-screen button; fit is present in 02, 03, 05, 06. Minor gap in 04.
- **Distinctness:** Height, visual weight, save-state treatment, zoom ergonomics differ. ✅
- **Token discipline:** Zero hardcoded chrome hex across all six files. ✅

**Recommended: `05-accent-save-state.html`**  
Save chip uses `--ds-accent` (Saved) → `--ds-warning-surface/text` (Unsaved) → `--ds-danger-surface/text` (Error) — matches the source `SaveStatus` semantic exactly. Presence avatars match `remotePresencePeers` prop. 103 tokens.

**Runner-up: `02-pill-zoom-control.html`**  
3-segment zoom pill is the most ergonomic zoom UX; highest token count (105); clean left–right layout.

**Must-fix:** None.

---

### 6. Control Primitives · `presentation-ui/control-primitives/`

**Source:** `src/components/ui/{button,segmented-control,tabs,select-menu,popover,color-picker,switch,tooltip}.tsx`

| # | File | Direction | Tokens |
|---|------|-----------|--------|
| 01 | `01-flat-outline.html` | 1 px outline only, `shadow-flat`, accent active fill | 114 |
| 02 | `02-soft-raised.html` | `shadow-raised` throughout, accent glow active | 118 |
| 03 | `03-pill-capsule.html` | `radius-pill` everywhere, all controls capsule-shaped | 104 |
| 04 | `04-recessed-segment.html` | Sunken track + raised thumb; recessed inputs | 126 |
| 05 | `05-glass-translucent.html` | `surface-glass` + backdrop-filter across all surfaces | 73 |
| 06 | `06-high-contrast-mono.html` | 1.5 px text-color borders, invert on hover, accent-only accent | 111 |

**Verdict: ✅ (⚠️ color-dot border defect across 5 files)**

- **Parity:** All six cover Button (default/active/disabled), SegmentedControl, Tabs, Select, Popover, ColorPicker (swatches + dot indicator), Switch, Tooltip. ✅
- **Distinctness:** Radius, elevation model, color metaphor (flat / raised / pill / recessed / glass / mono) are orthogonal. ✅
- **Token discipline:** Color swatch backgrounds (`#4f46e5`, `#ef4444`, etc.) are content values — acceptable. **However**, the color-indicator dot's *border/ring* is chrome (it marks the selected swatch) and uses hardcoded accent values in all five files: ⚠️

| File | Line | Defect | Fix |
|------|------|--------|-----|
| `01-flat-outline.html` | 430 | `border-color:#4f46e5` | `var(--ds-accent-border)` |
| `02-soft-raised.html` | 447 | `border-color:#4f46e5` | `var(--ds-accent-border)` |
| `03-pill-capsule.html` | 397 | `border-color:#4f46e5` | `var(--ds-accent-border)` |
| `04-recessed-segment.html` | 423 | `border-color:#4f46e5` | `var(--ds-accent-border)` |
| `05-glass-translucent.html` | 417 | `border-color:rgba(79,70,229,.4)` | `var(--ds-accent-border)` |

**Recommended: `04-recessed-segment.html`**  
Highest token density (126). Recessed track + raised thumb directly maps to the source's `--ds-segment-track`/`--ds-segment-thumb` token pair — zero conceptual translation needed. Switch and segmented control feel most native to the existing system. Fix line 423 before shipping.

**Runner-up: `01-flat-outline.html`**  
Most accessible (WCAG-safe contrast in every state, no motion), zero elevation surprises, easiest to implement.

**Must-fix (04-recessed-segment.html — recommended):**
- L423: `border-color:#4f46e5` → `border-color: var(--ds-accent-border)`

**Must-fix (non-recommended files, fix if any are adopted):**
- `01-flat-outline.html:430`, `02-soft-raised.html:447`, `03-pill-capsule.html:397`, `05-glass-translucent.html:417` — same pattern.

---

## Cross-Cutting Notes

### Design language coherence

The six **recommended** solutions share a coherent visual language:

| Signal | Token | Used by |
|--------|-------|---------|
| Glass surfaces | `--ds-surface-chrome` / `--ds-surface-glass` | top-toolbar 05, context-toolbar 04, filmstrip 01 |
| Sunken recessed wells | `--ds-surface-sunken` + `--ds-segment-track` | context-toolbar 04, control-primitives 04, inspector 05 |
| Overlay elevation | `--ds-shadow-overlay` / `--ds-shadow-raised` | context-toolbar 04, inspector 05, filmstrip 01 |
| Accent as primary action | `--ds-accent` fill on CTA | top-toolbar 05, status-bar 05 |
| Semantic state chips | `--ds-accent`/`--ds-warning`/`--ds-danger-surface/text` | status-bar 05 |

### Control-primitives unification

**`04-recessed-segment`** is the strongest unifying vocabulary for the full set:
- Its sunken-tray + raised-thumb model appears in context-toolbar 04, inspector 05, and filmstrip 01's active ring treatment.
- It consumes `--ds-segment-track`/`--ds-segment-thumb` directly — the two tokens explicitly designed for this pattern in the source.
- Glass (05) is beautiful but adds backdrop-filter cost; flat-outline (01) is safe but lacks the tactile depth the other recommended components lean into.

### Accessibility baseline

All recommended files use semantic elements (`<button>`, `<header>`, `role="toolbar"`, `aria-label`, `aria-pressed`). Focus rings use `--ds-focus-ring` / `--ds-focus-offset`. ✅  
`03-ultra-compact-mono.html` (24 px targets) does not meet `--tiq-touch-target-min: 44px` for mobile — acceptable for a desktop-only context toolbar but flag if mobile support is in scope.

### Total must-fix count

**9 off-token chrome color instances across 7 files.**  
All are 1-line fixes (`border-color`/`color`/`background` swap to existing token). None affect the recommended `top-toolbar`, `context-toolbar`, `inspector-panel`, `slide-filmstrip`, or `status-bar-footer` picks. One affects the recommended `control-primitives/04-recessed-segment.html`.

---

## Resolution

**2026-07-07T00:35:23+00:00** — All **9 must-fix** off-token chrome-color instances were applied and independently verified (grep + HTML re-parse):

- `context-toolbar/06-contextual-accent.html` — 3× `color: #fff` → `var(--ds-text-on-accent)`.
- `inspector-panel/01-flat-sectioned-scroll.html` — switch-thumb `background: #fff` → `var(--ds-surface)`.
- `control-primitives/{01,02,03,04,05}` — color-dot selection ring `border-color` → `var(--ds-accent-border)` (swatch `background` content values preserved).

**Status: ✅ Ready — 0 outstanding defects.** All 36 mockups are now token-clean chrome.

---

## Round 2 Review

**Type:** Architecture & Design Review  
**Status:** Active  
**Last updated:** 2026-07-07T01:23:18+00:00  
**Reviewer:** Morpheus (Lead / Architect)  
**Scope:** 36 HTML mockups + 6 galleries across 6 new component folders

---

### Overall Verdict

**⚠️ Ready to share with 8 must-fix instances across 4 files.**

All 36 mockups link `design-tokens.css`, use no CDN/framework, and deliver 6 structurally distinct directions per component. The present-mode toolbar correctly uses the `--ds-inverse-*` and `--ds-stage-*` token families for dark-stage chrome — the key requirement for this round. Defects are narrow: 3 rgba text colors on a hero gradient band (modal), 4 rgb values on a single kbd chip inside an accent button (command palette), and 1 `#fff` border on a color-picker cursor. None affect the recommended solutions except `command-palette/04`.

---

### Per-Component Sections

---

### 7. Present-Mode Toolbar · `presentation-ui/present-mode-toolbar/`

| # | File | Direction |
|---|------|-----------|
| 01 | `01-floating-bottom-bar.html` | Centered pill HUD, 20 px above stage floor |
| 02 | `02-corner-cluster.html` | Three independent capsules in stage corners |
| 03 | `03-glass-hud.html` | Full-width glass band, slide-dot nav in centre |
| 04 | `04-presenter-console.html` | Keynote-style dual view — slide + console panel |
| 05 | `05-edge-docked-rail.html` | 48 px vertical rail, right edge, hover tooltips |
| 06 | `06-minimal-progress.html` | Near-invisible at rest, hover-reveal pill |

**Verdict: ✅ Ready to share**

All six HUD chrome elements correctly use `--ds-inverse-surface`, `--ds-inverse-control`, `--ds-inverse-text`, `--ds-inverse-muted`, `--ds-inverse-border-subtle`, `--ds-inverse-state-hover`, `--ds-inverse-focus` — no light-mode tokens used on the dark stage. Direction 04 goes deepest: its console pane uses `--ds-stage-panel`, `--ds-stage-border`, `--ds-stage-text`, and `--ds-stage-muted` — the most authentic dark-room surface layer in any of the six. Direction 06 uses CSS `:has()` for hover-reveal, a well-chosen progressive-disclosure technique. All six include nav prev/next, slide counter, timer, notes, overview, fullscreen, and exit — full parity with the present-mode control set.

**Recommended: `04-presenter-console.html`**  
Keynote-style dual view keeps all chrome off the slide surface; dedicated console for speaker notes, next-slide preview, progress, and timer is the most complete presenter experience. Deepest and most correct use of the `--ds-stage-*` token family.

**Runner-up: `01-floating-bottom-bar.html`**  
Minimal single-pill HUD — smallest cognitive footprint; easy to animate in/out as a shared layer across any slide.

**Pre-scan adjudication — ACCEPTABLE CONTENT (none must-fix):**  
All ~20 flagged hex values are inside `aria-hidden="true"` slide mock elements (`.slide-eyebrow`, `.slide-title`, `.slide-body`, `.slide-kicker`, `.slide-divider`, `.slide-rule`, `.stat-number`, `.stat-label`, `.slide-bullets`, `.slide-slide-num`). They are slide artwork that varies per direction (indigo for 01, purple for 02/03, blue-navy for 04, green for 05, near-black cinematic for 06). Not chrome. Do not tokenize.

**Must-fix:** None.

---

### 8. Modal Dialog · `presentation-ui/modal-dialog/`

| # | File | Direction |
|---|------|-----------|
| 01 | `01-centered-classic.html` | Standard centered dialog, subtle shadow |
| 02 | `02-compact-alert.html` | Icon-anchored compact alert, danger CTA |
| 03 | `03-hero-illustrated.html` | Gradient hero band + share/publish form |
| 04 | `04-toolbar-footer-checklist.html` | Preflight checklist footer before confirm |
| 05 | `05-side-drawer.html` | Right-edge drawer with export settings |
| 06 | `06-bottom-sheet.html` | Bottom-anchored sheet, swipe handle |

**Verdict: ⚠️ Ready with nits (3 chrome defects in 2 files)**

Dialog shell is consistent across all six: `--ds-backdrop` overlay, `--ds-surface-overlay` panel, `--ds-border-subtle` border, `--ds-shadow-popover` elevation, `--ds-radius-xl` corner. Directions span the right semantic use cases — alert/destructive-confirm (02), export-preflight (04), settings drawer (05), mobile-adapted bottom sheet (06). Direction 03's gradient hero band is visually strong and appropriate for high-value share/publish dialogs; two chrome text colors in the hero band are the defects. Direction 05 has one switch-thumb shadow defect.

**Recommended: `04-toolbar-footer-checklist.html`**  
Preflight checklist footer is the most purpose-built for TextIQ's export-confirm workflow — body area for export options, checklist items for pre-flight validation, primary/danger footer CTA pair. Fully token-clean.

**Runner-up: `02-compact-alert.html`**  
Cleanest destructive-confirm flow: icon + danger message + danger CTA with ghost cancel. Zero chrome violations.

**Must-fix:**

| File | Line | Current | → Token | Reason |
|------|------|---------|---------|--------|
| `modal-dialog/03-hero-illustrated.html` | 121 | `color: rgba(255,255,255,0.85)` | `color: var(--ds-inverse-text)` | `.hero-close` icon/text on gradient — chrome |
| `modal-dialog/03-hero-illustrated.html` | 128 | `color: rgba(255,255,255,0.78)` | `color: var(--ds-inverse-muted)` | `.hero-subtitle` on gradient — chrome |
| `modal-dialog/05-side-drawer.html` | 182 | `box-shadow: 0 1px 3px rgba(0,0,0,0.2)` | `box-shadow: var(--ds-shadow-raised)` | `.switch::after` thumb shadow — chrome elevation |

**Acceptable content:**  
`03-hero-illustrated.html` hero band `linear-gradient(135deg, var(--ds-accent) 0%, #7c3aed 60%, #a855f7 100%)` — the `#7c3aed` and `#a855f7` purple stops are decorative gradient content per brief. ✅

---

### 9. Command Palette · `presentation-ui/command-palette/`

| # | File | Direction |
|---|------|-----------|
| 01 | `01-spotlight-centered.html` | macOS-style spotlight, padded from top |
| 02 | `02-compact-list.html` | Compact single-column result list |
| 03 | `03-grouped-categories.html` | Results grouped by category with headers |
| 04 | `04-two-pane-preview.html` | Split list + context preview pane |
| 05 | `05-minimal-flat.html` | Ultra-minimal, colour category dots |
| 06 | `06-keyboard-forward.html` | Shortcut filter tabs + keyboard legend |

**Verdict: ⚠️ Ready with nits (4 chrome defects across 2 files)**

All six use `--ds-backdrop` + `--ds-surface-overlay` + `--ds-shadow-overlay` for the shell and `--ds-state-hover` for row hover — correct. Direction 04's two-pane split is the most useful for a tool palette (users can read what Export PDF does before running it). Direction 06's shortcut filter tabs make the keyboard-forward user persona feel at home. Category dot colors in direction 05 and macOS window dots in all six are content values.

**Recommended: `04-two-pane-preview.html`**  
Split list + context panel reduces run-command errors; the `--ds-accent-surface` preview pane is correctly tokenized; accent-colored Run button gives a clear primary action. Fix L302 kbd chip before shipping.

**Runner-up: `06-keyboard-forward.html`**  
Shortcut filter tabs + persistent keyboard legend make this the best choice for a power-user audience; entirely token-clean chrome.

**Must-fix:**

| File | Line | Current | → Token | Reason |
|------|------|---------|---------|--------|
| `command-palette/01-spotlight-centered.html` | 24 | `background: #e8edf4` | `background: var(--ds-surface-sunken)` | `.demo-frame` stage chrome |
| `command-palette/04-two-pane-preview.html` | 302 | `background:rgba(255,255,255,0.18)` (inline) | `background: var(--ds-inverse-state-hover)` | `.kbd` chip on accent button — chrome |
| `command-palette/04-two-pane-preview.html` | 302 | `border-color:rgba(255,255,255,0.2)` (inline) | `border-color: var(--ds-inverse-border-subtle)` | `.kbd` chip border on accent button — chrome |
| `command-palette/04-two-pane-preview.html` | 302 | `color:#fff` (inline) | `color: var(--ds-inverse-text)` | `.kbd` chip text on accent button — chrome |

**Acceptable content:**  
All 6 files: `.fake-dot.red/yellow/green` (`#ff5f57`, `#febc2e`, `#28c840`) — macOS window decoration; purely contextual scenery. ✅  
`05-minimal-flat.html` L116–120: category dot fills (`#22c55e`, `#f59e0b`, `#8b5cf6`, `#06b6d4`) — semantic content-category labels, not chrome. ✅

---

### 10. Dropdown Menu · `presentation-ui/dropdown-menu/`

| # | File | Direction |
|---|------|-----------|
| 01 | `01-compact-list.html` | Ghost trigger, compact 28 px rows |
| 02 | `02-icon-leading.html` | 16 px icon + label, status dots |
| 03 | `03-sectioned-labels.html` | Group headings + section separators |
| 04 | `04-rich-description.html` | Icon + label + one-line description |
| 05 | `05-context-menu-dense.html` | Dense right-click context menu, danger items |
| 06 | `06-elevated-rounded.html` | Rounded pill panel, `shadow-popover` elevation |

**Verdict: ✅ Ready to share**

Zero hardcoded chrome hex across all 7 files (6 solutions + gallery). All panels use `--ds-surface-raised`, `--ds-border-subtle`, `--ds-shadow-popover`; row hover uses `--ds-state-hover`; active/selected uses `--ds-state-selected` or `--ds-accent-surface`; danger items correctly use `--ds-danger-text`. Triggers are consistent: ghost for inspector rows (01), bordered for form fields (04). Direction 05 correctly handles the right-click context menu with `--ds-danger-text` on destructive items and thin separator lines.

**Recommended: `03-sectioned-labels.html`**  
Group headers with section separators mirror the real toolbar menus (Format, Insert, etc.) without adding per-item density. Clean `--ds-text-muted` group labels, `--ds-border-subtle` separators, token-clean throughout.

**Runner-up: `04-rich-description.html`**  
Best for settings or template selects where the option needs a one-liner explainer; full-width bordered trigger fits inspector panel width.

**Must-fix:** None.

---

### 11. Color Picker · `presentation-ui/color-picker/`

| # | File | Direction |
|---|------|-----------|
| 01 | `01-swatch-grid-classic.html` | Classic popover swatch grid + hex input |
| 02 | `02-spectrum-plus-swatches.html` | Hue/SV/alpha sliders + swatch preset row |
| 03 | `03-compact-row.html` | Single-row swatch trigger in inspector row |
| 04 | `04-theme-aware-sections.html` | Swatches grouped by Brand / Accent / Neutral |
| 05 | `05-large-preview-inputs.html` | Large color preview + hex/RGB/HSL inputs |
| 06 | `06-minimal-dots.html` | Dot-only palette, minimal footprint |

**Verdict: ⚠️ Ready with nits (1 defect in 02 only)**

Swatch fill colors are correctly identified as content throughout. Popover chrome (`.picker`, borders, shadows, input fields, selection rings) is fully tokenized in 01, 03, 04, 05, 06. Direction 02's spectrum picker is the most capable for arbitrary color work but has one chrome defect on the SV cursor border. The checkerboard transparency pattern appears in 03, 04, 05, 06 — industry-standard pattern, acceptable content. Direction 04's theme-aware grouping is the best fit for TextIQ's Brand Kit system.

**Recommended: `04-theme-aware-sections.html`**  
Brand / Accent / Neutral / Custom groupings align with TextIQ's color system; `.ct-chip` trigger with focus ring is fully tokenized; section headers use `--ds-text-muted`. Best long-term fit for the product.

**Runner-up: `01-swatch-grid-classic.html`**  
Simplest and most universal; popover shell is entirely token-clean; good starting point for any text-color or fill-color picker.

**Must-fix:**

| File | Line | Current | → Token | Reason |
|------|------|---------|---------|--------|
| `color-picker/02-spectrum-plus-swatches.html` | 121 | `border: 2px solid #fff` | `border: 2px solid var(--ds-inverse-text)` | `.sv-thumb` cursor ring on SV square — chrome |

**Acceptable content:**  
All swatch button fills (inline `style="background:#3b82f6"` etc.) across all files — swatch color content. ✅  
SV-square base color, hue-thumb, alpha-thumb, color-preview-big backgrounds (`#3b82f6`) — all display the currently-selected hue; content. ✅  
`02-spectrum-plus-swatches.html:122` compound `box-shadow: 0 0 0 1px rgba(0,0,0,.3), var(--ds-shadow-raised)` — `rgba(0,0,0,.3)` inner ring is a standard picker-cursor contrast device with no direct token equivalent; acceptable. ✅  
`03/04/05/06` checkerboard `repeating-conic-gradient(#e5e7eb 0% 25%, #fff 0% 50%)` — standard transparency indicator. ✅  
`index.html` L187–192 six `.card-number` hues — gallery decoration only (L187 `#4f46e5` == `--ds-accent`; others unmatched; all acceptable). ✅

---

### 12. Template Picker · `presentation-ui/template-picker/`

| # | File | Direction |
|---|------|-----------|
| 01 | `01-category-grid.html` | Full-library grid in a modal, scroll all groups |
| 02 | `02-sidebar-categories.html` | Side-panel attached to editor, no modal/dimming |
| 03 | `03-tabbed-groups.html` | Tabs across dialog top, one group visible at a time |
| 04 | `04-large-preview-list.html` | Master list + large 16:9 wireframe preview pane |
| 05 | `05-compact-tiles.html` | Dense 4-column tile grid, fast browse |
| 06 | `06-filmstrip-rows.html` | Horizontal filmstrip rows, one per category |

**Verdict: ✅ Ready to share**

Zero hardcoded chrome hex across all 7 files. All thumbnails are built entirely from tokens (`--ds-surface-sunken` fill, `--ds-border-subtle` stroke, `--ds-accent` accent lines) — no raster images, no content hex. Dialog shells use `--ds-backdrop`, `--ds-surface`, `--ds-shadow-overlay`, `--ds-radius-lg` consistently. Accent selection rings use `--ds-accent` + `--ds-accent-border`. Direction 02 is architecturally interesting — a side-panel that avoids the modal disruption entirely. Direction 04's master/detail gives the highest confidence before inserting.

**Recommended: `04-large-preview-list.html`**  
Master list + large wireframe preview maximises decision confidence; layout variant chips add a useful secondary selection; the 720 × 500 px dialog provides enough room for both panes without dominating the viewport.

**Runner-up: `02-sidebar-categories.html`**  
Attached panel approach is the least disruptive to editing flow; the dot-grid editor backdrop provides spatial context; no focus trap needed.

**Must-fix:** None.

---

### Combined Must-Fix Table (Round 2)

| File | Line | Current | → Token | Reason |
|------|------|---------|---------|--------|
| `modal-dialog/03-hero-illustrated.html` | 121 | `color: rgba(255,255,255,0.85)` | `color: var(--ds-inverse-text)` | `.hero-close` icon on gradient hero — chrome |
| `modal-dialog/03-hero-illustrated.html` | 128 | `color: rgba(255,255,255,0.78)` | `color: var(--ds-inverse-muted)` | `.hero-subtitle` on gradient hero — chrome |
| `modal-dialog/05-side-drawer.html` | 182 | `box-shadow: 0 1px 3px rgba(0,0,0,0.2)` | `box-shadow: var(--ds-shadow-raised)` | `.switch::after` thumb elevation — chrome |
| `command-palette/01-spotlight-centered.html` | 24 | `background: #e8edf4` | `background: var(--ds-surface-sunken)` | `.demo-frame` stage surface — chrome |
| `command-palette/04-two-pane-preview.html` | 302 | `background:rgba(255,255,255,0.18)` (inline) | `background: var(--ds-inverse-state-hover)` | `.kbd` chip on accent button — chrome |
| `command-palette/04-two-pane-preview.html` | 302 | `border-color:rgba(255,255,255,0.2)` (inline) | `border-color: var(--ds-inverse-border-subtle)` | `.kbd` chip border on accent button — chrome |
| `command-palette/04-two-pane-preview.html` | 302 | `color:#fff` (inline) | `color: var(--ds-inverse-text)` | `.kbd` chip text on accent button — chrome |
| `color-picker/02-spectrum-plus-swatches.html` | 121 | `border: 2px solid #fff` | `border: 2px solid var(--ds-inverse-text)` | `.sv-thumb` cursor ring — chrome |

**Total: 8 must-fix instances across 4 files.** None affect the recommended solutions for present-mode-toolbar, modal-dialog, dropdown-menu, template-picker, or color-picker. One affects the recommended `command-palette/04` (fix before shipping).

---

### Cross-Cutting Observations

#### Family cohesion with Round 1

Round 2 integrates cleanly with Round 1's visual language. The floating pill pattern (present-mode/01, command-palette/01) reuses the same `--ds-inverse-surface` + blur + `--ds-shadow-overlay` stack as the context-toolbar/01 from Round 1. Modal dialog tokens (`--ds-backdrop`, `--ds-surface-overlay`, `--ds-shadow-popover`) are the same as Round 1's control-primitives/04 popover. Template picker thumbnails use the same `--ds-surface-sunken` + `--ds-border-subtle` wireframe palette as the slide-filmstrip thumbnails from Round 1.

The six **recommended** solutions share a coherent token vocabulary:

| Signal | Token | Used by |
|--------|-------|---------|
| Dark stage chrome | `--ds-inverse-surface` + `--ds-inverse-control` | present-mode/04 HUD rail |
| Stage panel | `--ds-stage-panel` + `--ds-stage-border` | present-mode/04 console pane |
| Modal backdrop | `--ds-backdrop` + `--ds-surface-overlay` | modal/04, template/04, cmd-palette/04 |
| Popover shell | `--ds-surface-raised` + `--ds-shadow-popover` | dropdown/03, color-picker/04 |
| Selection accent | `--ds-accent` + `--ds-accent-border` ring | all six pickers/menus |

#### Dark-stage HUD contrast (present-mode)

`--ds-inverse-text` (#ffffff) on `--ds-inverse-surface` (#0a0a0a) → 21:1. ✅  
`--ds-inverse-muted` (rgba(255,255,255,0.7)) on `--ds-inverse-surface` → ≈12:1. ✅  
`--ds-stage-text` (#d4d4d8) on `--ds-stage-panel` (#18181b) → ≈12:1. ✅  
No accessibility issues with any dark-stage chrome values.

#### Touch target note

Present-mode HUD buttons are 30–36 px; dropdown items are 28 px — both below `--tiq-touch-target-min: 44px`. This is acceptable for the desktop-first editor context but flag if a mobile presenter mode or touch-optimised inspector is planned.

#### Recommended solution set (README feed)

| Component | Recommended file | Why |
|-----------|-----------------|-----|
| Present-mode toolbar | `04-presenter-console.html` | Deepest `--ds-stage-*` usage; no chrome on slide surface |
| Modal dialog | `04-toolbar-footer-checklist.html` | Preflight checklist footer maps to export workflow |
| Command palette | `04-two-pane-preview.html` | Context preview reduces run-command errors (fix L302 first) |
| Dropdown menu | `03-sectioned-labels.html` | Section grouping mirrors real toolbar menus; clean tokens |
| Color picker | `04-theme-aware-sections.html` | Brand Kit groupings align with TextIQ color system |
| Template picker | `04-large-preview-list.html` | Master/detail maximises confidence before insert |
