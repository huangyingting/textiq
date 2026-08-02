export type UiMatrixRunMode = "required-ci" | "advisory-ci" | "opt-in-local";

export type UiMatrixTestInventoryEntry = {
  test: string;
  surface: string;
  viewport: string;
  auth: string;
  profile: string;
  ciTier: "required" | "advisory" | "opt-in";
  status: "automated";
};

export type UiMatrixExpectedTestEntry = {
  test: string;
  profiles: readonly ("deterministic-profile" | "required-profile")[];
};

export type UiMatrixSpecInventoryEntry = {
  spec: `e2e/${string}.spec.ts`;
  owners: string[];
  coverage: string;
  runMode: UiMatrixRunMode;
  prerequisites: string[];
  roles: string[];
  devices: string[];
  ciStatus: string;
  sourceRefs: string[];
  tests?: readonly UiMatrixTestInventoryEntry[];
  expectedTestCount?: number;
  expectedTests?: readonly UiMatrixExpectedTestEntry[];
};

export type UiMatrixManualGap = {
  id: string;
  owner: string;
  gap: string;
  status: "manual" | "blocked" | "catalog";
  sourceRefs: string[];
};

export const UI_MATRIX_SPEC_INVENTORY = [
  {
    spec: "e2e/auth/authenticated-nested-routes.spec.ts",
    owners: ["auth", "editor", "presentation", "billing"],
    coverage:
      "Seeded owner reaches dashboard-linked document, billing, and slide routes after login.",
    runMode: "advisory-ci",
    prerequisites: ["E2E_PROFILE=1", "npm run db:seed:e2e"],
    roles: ["seeded owner"],
    devices: ["Desktop Chrome"],
    ciStatus: "advisory deterministic E2E workflow",
    sourceRefs: ["e2e/README.md", ".github/workflows/e2e-deterministic.yml"],
    expectedTestCount: 3,
    expectedTests: [
      {
        test: "dashboard-linked document, billing, and slide routes render after login",
        profiles: ["deterministic-profile", "required-profile"],
      },
      {
        test: "real HTTPS login keeps the Auth.js session cookie secure and isolates the proxy key",
        profiles: ["deterministic-profile", "required-profile"],
      },
      {
        test: "running secure profile isolates the private-key descriptor from runner, app, Playwright, and Chromium",
        profiles: ["deterministic-profile", "required-profile"],
      },
    ],
    tests: [
      {
        test: "dashboard-linked document, billing, and slide routes render after login @required-profile",
        surface: "authenticated document, billing, and presentation routes",
        viewport: "Desktop Chrome",
        auth: "seeded owner in two isolated sessions",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "required",
        status: "automated",
      },
      {
        test: "real HTTPS login keeps the Auth.js session cookie secure and isolates the proxy key @required-profile",
        surface: "secure Auth.js session cookie and proxy-key isolation",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic HTTPS profile (E2E_PROFILE=1)",
        ciTier: "required",
        status: "automated",
      },
      {
        test: "running secure profile isolates the private-key descriptor from runner, app, Playwright, and Chromium @required-profile",
        surface: "production-profile private-key descriptor isolation",
        viewport: "runner, app, Playwright, and Chromium process boundaries",
        auth: "secure profile runtime",
        profile: "normal deterministic HTTPS profile (E2E_PROFILE=1)",
        ciTier: "required",
        status: "automated",
      },
    ],
  },
  {
    spec: "e2e/collaboration/runtime-health.spec.ts",
    owners: ["collaboration", "operations", "security"],
    coverage:
      "The self-contained release profile declares its single-instance topology and exposes recovery-flush readiness without leaking the internal secret.",
    runMode: "required-ci",
    prerequisites: ["E2E_PROFILE=1"],
    roles: ["public health probe"],
    devices: ["Desktop Chrome request context"],
    ciStatus: "required deterministic E2E workflow",
    sourceRefs: [
      "e2e/README.md",
      "docs/collaboration/README.md",
      "docs/operations/collaboration-deployment.md",
      ".github/workflows/e2e-deterministic.yml",
    ],
    expectedTestCount: 1,
    expectedTests: [
      {
        test: "profile declares single-instance mode and enables recovery flushes",
        profiles: ["deterministic-profile", "required-profile"],
      },
    ],
    tests: [
      {
        test: "profile declares single-instance mode and enables recovery flushes @required-profile",
        surface: "collaboration deployment health and recovery readiness",
        viewport: "Desktop Chrome request context",
        auth: "public health probe",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "required",
        status: "automated",
      },
    ],
  },
  {
    spec: "e2e/editor/block-id-preservation.spec.ts",
    owners: ["editor", "presentation"],
    coverage:
      "Persisted block ids survive edit/reload, source insertion retains the originating bid, and duplication remaps block ids plus deck source refs.",
    runMode: "advisory-ci",
    prerequisites: ["E2E_PROFILE=1", "npm run db:seed:e2e"],
    roles: ["seeded owner"],
    devices: ["Desktop Chrome"],
    ciStatus: "advisory deterministic E2E workflow",
    sourceRefs: ["e2e/README.md", "docs/editor/document-editor.md"],
    expectedTestCount: 3,
    expectedTests: [
      {
        test: "block bids survive edit, autosave, and reload",
        profiles: ["deterministic-profile"],
      },
      {
        test: "inserted document source persists the originating block bid",
        profiles: ["deterministic-profile"],
      },
      {
        test: "duplicate document gets independent block ids and remapped source refs",
        profiles: ["deterministic-profile"],
      },
    ],
    tests: [
      {
        test: "block bids survive edit, autosave, and reload",
        surface: "document block identity through edit, autosave, and reload",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "inserted document source persists the originating block bid",
        surface: "document-to-slide source insertion and block identity",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "duplicate document gets independent block ids and remapped source refs",
        surface: "document duplication and source-reference remapping",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
    ],
  },
  {
    spec: "e2e/editor/document-editor-profile.spec.ts",
    owners: ["editor", "documents"],
    coverage:
      "Seeded document editor body hydration, title, toolbar, and save status.",
    runMode: "advisory-ci",
    prerequisites: ["E2E_PROFILE=1", "npm run db:seed:e2e"],
    roles: ["seeded owner"],
    devices: ["Desktop Chrome"],
    ciStatus: "advisory deterministic E2E workflow",
    sourceRefs: ["e2e/README.md", "docs/editor/document-editor.md"],
  },
  {
    spec: "e2e/editor/document-table-autosave.spec.ts",
    owners: ["editor", "documents", "collaboration"],
    coverage:
      "Sustained document and table edits remain durable after the UI reports saved and the document reloads.",
    runMode: "advisory-ci",
    prerequisites: ["E2E_PROFILE=1", "npm run db:seed:e2e"],
    roles: ["seeded owner"],
    devices: ["Desktop Chrome"],
    ciStatus: "advisory deterministic E2E workflow",
    sourceRefs: ["e2e/README.md", "docs/editor/document-editor.md"],
    expectedTestCount: 1,
    expectedTests: [
      {
        test: "sustained document and table edits persist after saved state and reload",
        profiles: ["deterministic-profile"],
      },
    ],
    tests: [
      {
        test: "sustained document and table edits persist after saved state and reload",
        surface: "document and table autosave durability",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
    ],
  },
  {
    spec: "e2e/documents/template-creation.spec.ts",
    owners: ["documents", "editor", "workspace", "security", "accessibility"],
    coverage:
      "Dashboard template-picker focus, scroll lock, Escape/backdrop restoration, mobile containment, transport failure/retry, duplicate suppression, redirect and reload persistence; workspace owner/editor creation plus viewer action gating.",
    runMode: "required-ci",
    prerequisites: ["E2E_PROFILE=1", "npm run db:seed:e2e"],
    roles: ["seeded owner", "seeded editor", "seeded viewer"],
    devices: ["Desktop Chrome", "390x844 mobile"],
    ciStatus: "required normal deterministic E2E workflow",
    sourceRefs: [
      "e2e/README.md",
      "docs/documents/README.md",
      "docs/security/workspaces.md",
      "playwright.config.ts",
      ".github/workflows/e2e-deterministic.yml",
    ],
    expectedTestCount: 4,
    expectedTests: [
      {
        test: "dashboard picker contains failures, retries once, suppresses duplicate creation, and persists the selected template",
        profiles: ["deterministic-profile", "required-profile"],
      },
      {
        test: "workspace owner creates a template document that survives reload",
        profiles: ["deterministic-profile", "required-profile"],
      },
      {
        test: "workspace editor creates a template document that survives reload",
        profiles: ["deterministic-profile", "required-profile"],
      },
      {
        test: "workspace viewer cannot reach create or import actions",
        profiles: ["deterministic-profile", "required-profile"],
      },
    ],
    tests: [
      {
        test: "dashboard picker contains failures, retries once, suppresses duplicate creation, and persists the selected template @required-profile",
        surface:
          "dashboard template picker failure/retry → document editor → reload",
        viewport: "Desktop + 390x844 mobile",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "required",
        status: "automated",
      },
      {
        test: "workspace owner creates a template document that survives reload @required-profile",
        surface: "workspace template picker → document editor → reload",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "required",
        status: "automated",
      },
      {
        test: "workspace editor creates a template document that survives reload @required-profile",
        surface: "workspace template picker → document editor → reload",
        viewport: "Desktop Chrome",
        auth: "seeded editor",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "required",
        status: "automated",
      },
      {
        test: "workspace viewer cannot reach create or import actions @required-profile",
        surface: "workspace document action permissions",
        viewport: "Desktop Chrome",
        auth: "seeded viewer",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "required",
        status: "automated",
      },
    ],
  },
  {
    spec: "e2e/import/import-roundtrip.spec.ts",
    owners: ["import", "editor"],
    coverage:
      "Dashboard Markdown preflight/malformed/transport recovery and DOCX imports, workspace UI import, duplicate suppression, editor replacement modal/accessibility/persistence, role enforcement, and graceful unsupported-upload failure.",
    runMode: "required-ci",
    prerequisites: ["E2E_PROFILE=1", "npm run db:seed:e2e"],
    roles: ["seeded owner", "seeded editor", "seeded viewer"],
    devices: ["Desktop Chrome", "Mobile Chrome viewport"],
    ciStatus: "required normal deterministic E2E workflow",
    sourceRefs: [
      "e2e/README.md",
      "docs/import/README.md",
      "playwright.config.ts",
      ".github/workflows/e2e-deterministic.yml",
    ],
    expectedTestCount: 6,
    expectedTests: [
      {
        test: "imports Markdown, renders blocks, and persists content across reload",
        profiles: ["deterministic-profile", "required-profile"],
      },
      {
        test: "imports DOCX, renders blocks, and persists content across reload",
        profiles: ["deterministic-profile", "required-profile"],
      },
      {
        test: "workspace import by owner persists across reload",
        profiles: ["deterministic-profile", "required-profile"],
      },
      {
        test: "workspace import by editor persists across reload",
        profiles: ["deterministic-profile", "required-profile"],
      },
      {
        test: "workspace import by viewer is forbidden and creates zero documents",
        profiles: ["deterministic-profile", "required-profile"],
      },
      {
        test: "rejects an unsupported file type with a graceful error",
        profiles: ["deterministic-profile"],
      },
    ],
    tests: [
      {
        test: "imports Markdown, renders blocks, and persists content across reload @required-profile",
        surface:
          "dashboard import failure/retry → document editor replacement modal → autosave/reload",
        viewport: "Desktop + mobile Chrome viewport",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "required",
        status: "automated",
      },
      {
        test: "imports DOCX, renders blocks, and persists content across reload @required-profile",
        surface: "dashboard import → document editor render/reload",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "required",
        status: "automated",
      },
      {
        test: "workspace import by owner persists across reload @required-profile",
        surface: "workspace import UI → document editor render/reload",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "required",
        status: "automated",
      },
    ],
  },
  {
    spec: "e2e/presentation/focus-and-mobile-controls-regression.spec.ts",
    owners: ["presentation", "accessibility"],
    coverage:
      "Shortcut and editor focus restoration, required-profile forced-colors focus and mobile/tablet inspector stacking, plus mobile Edit/Add slide geometry, hit testing, and pointer activation.",
    runMode: "advisory-ci",
    prerequisites: ["E2E_PROFILE=1", "npm run db:seed:e2e"],
    roles: ["seeded owner"],
    devices: ["Desktop Chrome", "390x844 mobile", "412x915 mobile"],
    ciStatus: "advisory deterministic E2E workflow",
    sourceRefs: ["e2e/README.md", "docs/presentation/slide-editor.md"],
  },
  {
    spec: "e2e/presentation/present-export.spec.ts",
    owners: ["presentation", "public-render"],
    coverage:
      "Authenticated/public present render, mobile safe areas, embed mode, real document PDF export, selected-width infographic PNG/PDF files, paid workspace-editor document-deck PPTX export, and contained browser raster failure with successful retry.",
    runMode: "advisory-ci",
    prerequisites: ["E2E_PROFILE=1", "npm run db:seed:e2e"],
    roles: [
      "seeded owner",
      "seeded Pro editor",
      "seeded viewer",
      "anonymous public",
    ],
    devices: ["Desktop Chrome", "mobile viewport"],
    ciStatus: "advisory deterministic E2E workflow",
    sourceRefs: ["e2e/README.md", "docs/presentation/rendering-and-export.md"],
  },
  {
    spec: "e2e/presentation/overlap-selection-regression.spec.ts",
    owners: ["presentation", "accessibility"],
    coverage:
      "Deterministic browser regression for selecting, editing, deleting, undoing, grouping, locking, reordering, and locating fully covered stage nodes.",
    runMode: "advisory-ci",
    prerequisites: ["E2E_PROFILE=1", "npm run db:seed:e2e"],
    roles: ["seeded owner"],
    devices: ["Desktop Chrome"],
    ciStatus: "advisory deterministic E2E workflow",
    sourceRefs: ["e2e/README.md", "docs/presentation/slide-editor.md"],
    expectedTestCount: 1,
    expectedTests: [
      {
        test: "reorders, persists, cycles, groups, filters locked layers, edits, deletes, and matches Layers",
        profiles: ["deterministic-profile"],
      },
    ],
    tests: [
      {
        test: "reorders, persists, cycles, groups, filters locked layers, edits, deletes, and matches Layers",
        surface:
          "overlapping stage-node selection, layers, grouping, and persistence",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
    ],
  },
  {
    spec: "e2e/presentation/pointer-interactions.spec.ts",
    owners: ["presentation", "accessibility"],
    coverage:
      "Real Chromium pointer drag coverage for filmstrip reorder, node resize/rotation with undo, connector endpoint snapping, and image crop handles, bounds, history, and autosave/reload persistence.",
    runMode: "advisory-ci",
    prerequisites: ["E2E_PROFILE=1", "npm run db:seed:e2e"],
    roles: ["seeded owner"],
    devices: ["Desktop Chrome"],
    ciStatus: "advisory deterministic E2E workflow",
    sourceRefs: ["e2e/README.md", "docs/presentation/slide-editor.md"],
    expectedTestCount: 4,
    expectedTests: [
      {
        test: "filmstrip pointer drag reorders slides and persists without a post-drag click rollback",
        profiles: ["deterministic-profile"],
      },
      {
        test: "resize and rotation handles update geometry, undo, and persist committed pointer changes",
        profiles: ["deterministic-profile"],
      },
      {
        test: "connector endpoint pointer drag snaps to a node and persists the binding",
        profiles: ["deterministic-profile"],
      },
      {
        test: "image crop handles, inspector values, history, reset, and reload stay in sync",
        profiles: ["deterministic-profile"],
      },
    ],
    tests: [
      {
        test: "filmstrip pointer drag reorders slides and persists without a post-drag click rollback",
        surface: "filmstrip pointer reorder and persistence",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "resize and rotation handles update geometry, undo, and persist committed pointer changes",
        surface: "stage resize and rotation pointer controls with history",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "connector endpoint pointer drag snaps to a node and persists the binding",
        surface: "connector endpoint drag, snap, and binding persistence",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "image crop handles, inspector values, history, reset, and reload stay in sync",
        surface: "image crop pointer controls, inspector, history, and reload",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
    ],
  },
  {
    spec: "e2e/presentation/presentation-controls.spec.ts",
    owners: ["presentation", "accessibility"],
    coverage:
      "Real Chromium multi-select Arrange, precision guides, themes, source review, deck-diagnostics navigation/repair, and speaker-note lifecycles with isolated mutation fixtures.",
    runMode: "advisory-ci",
    prerequisites: ["E2E_PROFILE=1", "npm run db:seed:e2e"],
    roles: ["seeded owner"],
    devices: ["Desktop Chrome"],
    ciStatus: "advisory deterministic E2E workflow",
    sourceRefs: ["e2e/README.md", "docs/presentation/slide-editor.md"],
    expectedTestCount: 13,
    expectedTests: [
      {
        test: "multi-select Arrange distributes three named nodes with undo, redo, and persistence",
        profiles: ["deterministic-profile"],
      },
      {
        test: "precision guide preferences persist locally and custom guide visibility controls snapping",
        profiles: ["deterministic-profile"],
      },
      {
        test: "built-in theme selection preserves geometry and survives undo, redo, and reload",
        profiles: ["deterministic-profile"],
      },
      {
        test: "slide ratio preserves percent geometry through undo, redo, reload, and public rendering",
        profiles: ["deterministic-profile"],
      },
      {
        test: "slide master preserves deck defaults and slide overrides through history, reload, and public rendering",
        profiles: ["deterministic-profile"],
      },
      {
        test: "document source review refreshes stale content through history, reload, and public rendering",
        profiles: ["deterministic-profile"],
      },
      {
        test: "source review navigation, dismiss, unlink, and relink actions preserve reversible state",
        profiles: ["deterministic-profile"],
      },
      {
        test: "speaker notes preserve slide scope through history, reload, and presenter mode",
        profiles: ["deterministic-profile"],
      },
      {
        test: "deck diagnostics review traps focus, navigates, repairs, and persists an empty state",
        profiles: ["deterministic-profile"],
      },
      {
        test: "custom theme authoring saves, re-enters the picker, applies, and persists",
        profiles: ["deterministic-profile"],
      },
      {
        test: "latest same-id catalog snapshot applies over the active exact version and survives reload",
        profiles: ["deterministic-profile"],
      },
      {
        test: "theme customization and custom guides restore their stable triggers across close paths",
        profiles: ["deterministic-profile"],
      },
      {
        test: "creates, persists, nests, reorders, and recursively ungroups UI-authored groups",
        profiles: ["deterministic-profile"],
      },
    ],
    tests: [
      {
        test: "multi-select Arrange distributes three named nodes with undo, redo, and persistence",
        surface:
          "multi-selection Arrange distribution with history and persistence",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "precision guide preferences persist locally and custom guide visibility controls snapping",
        surface: "precision-guide preferences, visibility, and snapping",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "built-in theme selection preserves geometry and survives undo, redo, and reload",
        surface: "built-in theme selection, geometry, history, and persistence",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "slide ratio preserves percent geometry through undo, redo, reload, and public rendering",
        surface: "slide-ratio geometry, history, reload, and public parity",
        viewport: "Desktop Chrome",
        auth: "seeded owner and anonymous public",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "slide master preserves deck defaults and slide overrides through history, reload, and public rendering",
        surface: "slide-master defaults, overrides, history, and public parity",
        viewport: "Desktop Chrome",
        auth: "seeded owner and anonymous public",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "document source review refreshes stale content through history, reload, and public rendering",
        surface: "stale document-source refresh, history, and public parity",
        viewport: "Desktop Chrome",
        auth: "seeded owner and anonymous public",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "source review navigation, dismiss, unlink, and relink actions preserve reversible state",
        surface:
          "source-review navigation, dismiss, unlink, and relink lifecycle",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "speaker notes preserve slide scope through history, reload, and presenter mode",
        surface:
          "speaker-note slide scope, history, reload, and presenter mode",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "deck diagnostics review traps focus, navigates, repairs, and persists an empty state",
        surface:
          "deck-diagnostics focus trap, navigation, repair, and persistence",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "custom theme authoring saves, re-enters the picker, applies, and persists",
        surface:
          "custom-theme authoring, picker re-entry, application, and persistence",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "latest same-id catalog snapshot applies over the active exact version and survives reload",
        surface: "same-ID theme catalog update and reload persistence",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "theme customization and custom guides restore their stable triggers across close paths",
        surface: "theme and guide dialog close paths with focus restoration",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "creates, persists, nests, reorders, and recursively ungroups UI-authored groups",
        surface:
          "nested group creation, persistence, reorder, and recursive ungroup",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
    ],
  },
  {
    spec: "e2e/public-render/share-fallback.spec.ts",
    owners: ["public-render", "security"],
    coverage:
      "Unknown, malformed, and slug-prefixed share/present/embed routes return safe 404s.",
    runMode: "advisory-ci",
    prerequisites: ["E2E_PROFILE=1", "npm run db:seed:e2e"],
    roles: ["anonymous"],
    devices: ["Desktop Chrome", "request API"],
    ciStatus: "advisory deterministic E2E workflow",
    sourceRefs: ["e2e/README.md", "docs/public-render/README.md"],
    expectedTestCount: 8,
    expectedTests: [
      {
        test: "unknown and malformed public routes return 404 without leaking fixture content",
        profiles: ["deterministic-profile"],
      },
      {
        test: "unknown /share link renders the not-found fallback",
        profiles: ["deterministic-profile"],
      },
      {
        test: "unknown /present link renders the not-found fallback",
        profiles: ["deterministic-profile"],
      },
      {
        test: "unknown /embed link renders the not-found fallback",
        profiles: ["deterministic-profile"],
      },
      {
        test: "unknown /present/<share>/embed renders the not-found fallback",
        profiles: ["deterministic-profile"],
      },
      {
        test: "slug-prefixed unknown share ID resolves to the safe 404 fallback without leaking content",
        profiles: ["deterministic-profile"],
      },
      {
        test: "malformed share ID resolves to the safe 404 fallback without leaking content",
        profiles: ["deterministic-profile"],
      },
      {
        test: "fallback 404 page does not render document editor or presentation regions",
        profiles: ["deterministic-profile"],
      },
    ],
    tests: [
      {
        test: "unknown and malformed public routes return 404 without leaking fixture content",
        surface: "public share, present, and embed HTTP fallbacks",
        viewport: "Playwright request context",
        auth: "anonymous request",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "unknown /share link renders the not-found fallback",
        surface: "unknown public share browser fallback",
        viewport: "Desktop Chrome",
        auth: "anonymous public",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "unknown /present link renders the not-found fallback",
        surface: "unknown public presentation browser fallback",
        viewport: "Desktop Chrome",
        auth: "anonymous public",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "unknown /embed link renders the not-found fallback",
        surface: "unknown public embed browser fallback",
        viewport: "Desktop Chrome",
        auth: "anonymous public",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "unknown /present/<share>/embed renders the not-found fallback",
        surface: "unknown nested presentation embed browser fallback",
        viewport: "Desktop Chrome",
        auth: "anonymous public",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "slug-prefixed unknown share ID resolves to the safe 404 fallback without leaking content",
        surface: "slug-prefixed unknown public route privacy fallback",
        viewport: "Desktop Chrome",
        auth: "anonymous public",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "malformed share ID resolves to the safe 404 fallback without leaking content",
        surface: "malformed public share route privacy fallback",
        viewport: "Desktop Chrome",
        auth: "anonymous public",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "fallback 404 page does not render document editor or presentation regions",
        surface: "public fallback suppression of private editor regions",
        viewport: "Desktop Chrome",
        auth: "anonymous public",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
    ],
  },
  {
    spec: "e2e/presentation/slide-asset-upload.spec.ts",
    owners: ["presentation", "security"],
    coverage:
      "Protected slide asset authorization and image upload persistence against seeded documents.",
    runMode: "advisory-ci",
    prerequisites: ["E2E_PROFILE=1", "npm run db:seed:e2e"],
    roles: ["seeded owner", "seeded viewer", "anonymous public"],
    devices: ["Desktop Chrome", "request API"],
    ciStatus: "advisory deterministic E2E workflow",
    sourceRefs: ["e2e/README.md", "docs/presentation/assets.md"],
    expectedTestCount: 3,
    expectedTests: [
      {
        test: "owner fetches protected bytes; anonymous denied for private, allowed for shared",
        profiles: ["deterministic-profile", "required-profile"],
      },
      {
        test: "an unrelated authenticated user is denied the private asset",
        profiles: ["deterministic-profile"],
      },
      {
        test: "uploads via the inspector and the reloaded slide resolves the protected asset",
        profiles: ["deterministic-profile", "required-profile"],
      },
    ],
    tests: [
      {
        test: "owner fetches protected bytes; anonymous denied for private, allowed for shared @required-profile",
        surface: "owner and public slide-asset authorization",
        viewport: "Playwright request context",
        auth: "seeded owner and anonymous public",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "required",
        status: "automated",
      },
      {
        test: "an unrelated authenticated user is denied the private asset",
        surface: "cross-account private slide-asset denial",
        viewport: "Playwright request context",
        auth: "unrelated authenticated user",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "uploads via the inspector and the reloaded slide resolves the protected asset @required-profile",
        surface: "slide-inspector image upload and protected-asset reload",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "required",
        status: "automated",
      },
    ],
  },
  {
    spec: "e2e/presentation/slide-delete-persistence.spec.ts",
    owners: ["presentation", "collaboration"],
    coverage:
      "Canonical and generated first-save decks persist slide deletion through autosave, revision-token rotation, and reload.",
    runMode: "advisory-ci",
    prerequisites: ["E2E_PROFILE=1", "npm run db:seed:e2e"],
    roles: ["seeded owner"],
    devices: ["Desktop Chrome"],
    ciStatus: "advisory deterministic E2E workflow",
    sourceRefs: ["e2e/README.md", "docs/presentation/slide-editor.md"],
    expectedTestCount: 2,
    expectedTests: [
      {
        test: "canonical seeded deck delete autosaves and survives a direct slides-route reload",
        profiles: ["deterministic-profile"],
      },
      {
        test: "generated first-save deck delete rotates its null token and survives reload",
        profiles: ["deterministic-profile"],
      },
    ],
    tests: [
      {
        test: "canonical seeded deck delete autosaves and survives a direct slides-route reload",
        surface: "canonical deck slide deletion, autosave, and reload",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "generated first-save deck delete rotates its null token and survives reload",
        surface: "first-save deck deletion, token rotation, and reload",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
    ],
  },
  {
    spec: "e2e/presentation/slides-layout-screenshots.spec.ts",
    owners: ["presentation", "visual"],
    coverage:
      "Slide editor shell screenshots across desktop, tablet, mobile, rail, notes, and panel states; required-profile selection asserts fitted title text, unobstructed center hit-testing, non-desktop toolbar separation, and the routed Text inspector.",
    runMode: "advisory-ci",
    prerequisites: [
      "E2E_PROFILE=1 or E2E_SLIDES_LAYOUT_SCREENSHOTS=1",
      "npm run db:seed:e2e or E2E_SLIDES_EDITOR_PATH",
    ],
    roles: ["seeded owner"],
    devices: ["desktop", "tablet", "mobile"],
    ciStatus: "advisory deterministic E2E workflow",
    sourceRefs: ["e2e/README.md", "docs/presentation/slide-editor.md"],
  },
  {
    spec: "e2e/presentation/slides-smoke.spec.ts",
    owners: ["presentation"],
    coverage:
      "The deterministic profile covers slide navigation, edit/present/export reachability, inline rich-text selection formatting with link apply/remove and font-size focus ownership, list conversion/indentation, table-cell keyboard editing plus row/column/header commands, history/reload persistence, resize/duplicate, add-slide, visual-insert mutations, workspace landmarks/create controls, and accessible slide-toolbar controls; optional external fixtures can run the same non-mutating smoke outside the profile.",
    runMode: "advisory-ci",
    prerequisites: [
      "E2E_PROFILE=1 for complete deterministic coverage",
      "optional E2E_USER_EMAIL/PASSWORD and E2E_SLIDES_DOC_URL outside the profile",
    ],
    roles: [
      "seeded owner",
      "optional external owner",
      "anonymous fallback routes",
    ],
    devices: ["Desktop Chrome"],
    ciStatus: "advisory deterministic E2E workflow",
    sourceRefs: ["e2e/README.md", "docs/presentation/slide-editor.md"],
  },
  {
    spec: "e2e/presentation/slides-conflict-recovery.spec.ts",
    owners: ["presentation", "collaboration"],
    coverage:
      "Real two-context Chromium deck conflicts with duplicate-activated Keep my version and Use server version recovery, including independent geometry edits, history reset, and reload persistence.",
    runMode: "advisory-ci",
    prerequisites: ["E2E_PROFILE=1", "npm run db:seed:e2e"],
    roles: ["seeded owner in two isolated sessions"],
    devices: ["Desktop Chrome"],
    ciStatus: "advisory deterministic E2E workflow",
    sourceRefs: ["e2e/README.md", "docs/presentation/slide-editor.md"],
  },
  {
    spec: "e2e/presentation/touch-controls.spec.ts",
    owners: ["presentation", "accessibility"],
    coverage:
      "Chromium mobile touch taps select a named text node and navigate, switch, and close the Text inspector without claiming unsupported pinch or drag gestures.",
    runMode: "advisory-ci",
    prerequisites: ["E2E_PROFILE=1", "npm run db:seed:e2e"],
    roles: ["seeded owner"],
    devices: ["Chromium touch 390x844"],
    ciStatus: "advisory deterministic E2E workflow",
    sourceRefs: ["e2e/README.md", "docs/presentation/slide-editor.md"],
    expectedTestCount: 1,
    expectedTests: [
      {
        test: "Chromium touch taps select text and navigate the mobile text inspector",
        profiles: ["deterministic-profile"],
      },
    ],
    tests: [
      {
        test: "Chromium touch taps select text and navigate the mobile text inspector",
        surface: "touch selection and mobile text-inspector navigation",
        viewport: "Chromium touch 390x844",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
    ],
  },
  {
    spec: "e2e/ui-matrix/account-lifecycle-ui.spec.ts",
    owners: ["auth", "security", "settings"],
    coverage:
      "Deterministic signup with automatic sign-in, first-run content, onboarding dismissal transport-failure recovery and duplicate suppression, persistence, and complete account deletion; password-recovery and email-verification failure states; plus authenticated settings, profile persistence, scoped export, password failure and successful rotation/re-login, and non-destructive deletion safeguards.",
    runMode: "advisory-ci",
    prerequisites: ["E2E_PROFILE=1", "npm run db:seed:e2e"],
    roles: [
      "anonymous",
      "new signup account",
      "seeded owner",
      "isolated account-mutation user",
    ],
    devices: ["Desktop Chrome"],
    ciStatus: "advisory deterministic E2E workflow",
    sourceRefs: ["e2e/ui-matrix/README.md", "docs/auth/README.md"],
    expectedTestCount: 5,
    expectedTests: [
      {
        test: "recovery and verification pages expose safe public failure states",
        profiles: ["deterministic-profile"],
      },
      {
        test: "seeded owner can inspect settings and download a scoped data export",
        profiles: ["deterministic-profile"],
      },
      {
        test: "new account signs up, recovers onboarding dismissal, persists it, and deletes cleanly",
        profiles: ["deterministic-profile"],
      },
      {
        test: "isolated account persists profile edits and rotates credentials with explicit re-login",
        profiles: ["deterministic-profile"],
      },
      {
        test: "password failures preserve the session and deletion stays confirmation-gated",
        profiles: ["deterministic-profile"],
      },
    ],
    tests: [
      {
        test: "recovery and verification pages expose safe public failure states",
        surface: "password recovery and email verification failure states",
        viewport: "Desktop Chrome",
        auth: "anonymous",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "seeded owner can inspect settings and download a scoped data export",
        surface: "account settings and scoped data export",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "new account signs up, recovers onboarding dismissal, persists it, and deletes cleanly",
        surface:
          "signup, onboarding recovery, persistence, and account deletion",
        viewport: "Desktop Chrome",
        auth: "new signup account",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "isolated account persists profile edits and rotates credentials with explicit re-login",
        surface: "profile persistence and password rotation",
        viewport: "Desktop Chrome",
        auth: "isolated account-mutation user",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "password failures preserve the session and deletion stays confirmation-gated",
        surface: "password failure containment and account-deletion safeguards",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
    ],
  },
  {
    spec: "e2e/ui-matrix/app-shell-ui.spec.ts",
    owners: ["system", "accessibility", "auth"],
    coverage:
      "Deterministic app-shell theme selection and persistence across every mode, accessible user/shortcut menu closure and focus restoration, text-input shortcut suppression, and nested mobile drawer/theme/help behavior without duplicate overlays or horizontal overflow.",
    runMode: "advisory-ci",
    prerequisites: ["E2E_PROFILE=1", "npm run db:seed:e2e"],
    roles: ["seeded owner"],
    devices: ["Desktop Chrome", "390x844 mobile"],
    ciStatus: "advisory deterministic E2E workflow",
    sourceRefs: [
      "e2e/ui-matrix/README.md",
      "docs/system/design-system.md",
      "docs/commands/actions-and-shortcuts.md",
    ],
    expectedTestCount: 3,
    expectedTests: [
      {
        test: "desktop themes update every persistence channel and survive reload",
        profiles: ["deterministic-profile"],
      },
      {
        test: "desktop user and shortcut menus close accessibly and ignore typing",
        profiles: ["deterministic-profile"],
      },
      {
        test: "mobile drawer composes theme and shortcut overlays without duplicates or overflow",
        profiles: ["deterministic-profile"],
      },
    ],
    tests: [
      {
        test: "desktop themes update every persistence channel and survive reload",
        surface: "app-shell theme selection and persistence",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "desktop user and shortcut menus close accessibly and ignore typing",
        surface: "user-menu and keyboard-shortcut focus lifecycle",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "mobile drawer composes theme and shortcut overlays without duplicates or overflow",
        surface:
          "mobile navigation drawer with nested theme and shortcut overlays",
        viewport: "390x844 mobile",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
    ],
  },
  {
    spec: "e2e/ui-matrix/auth-public-ui.spec.ts",
    owners: ["auth", "public-render", "system"],
    coverage:
      "Deterministic public auth controls, OAuth CTA state, protected deep-link redirects, generic invalid-credential feedback, and successful callback-preserving retry.",
    runMode: "advisory-ci",
    prerequisites: [
      "E2E_PROFILE=1",
      "npm run db:seed:e2e",
      "optional GOOGLE_CLIENT_ID/SECRET",
    ],
    roles: ["anonymous", "seeded owner"],
    devices: ["Desktop Chrome"],
    ciStatus: "advisory deterministic E2E workflow",
    sourceRefs: [
      "e2e/ui-matrix/README.md",
      "docs/security/access-and-sharing.md",
    ],
    expectedTestCount: 4,
    expectedTests: [
      {
        test: "public home, login, and signup expose primary unauthenticated controls",
        profiles: ["deterministic-profile"],
      },
      {
        test: "root and deep protected routes redirect with callbackUrl intact",
        profiles: ["deterministic-profile"],
      },
      {
        test: "Google OAuth CTA matches provider configuration on login and signup",
        profiles: ["deterministic-profile"],
      },
      {
        test: "invalid credentials stay generic and a successful retry preserves the deep callback",
        profiles: ["deterministic-profile"],
      },
    ],
    tests: [
      {
        test: "public home, login, and signup expose primary unauthenticated controls",
        surface: "public home, login, and signup primary controls",
        viewport: "Desktop Chrome",
        auth: "anonymous",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "root and deep protected routes redirect with callbackUrl intact",
        surface: "root and deep protected-route callback redirects",
        viewport: "Desktop Chrome",
        auth: "anonymous",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "Google OAuth CTA matches provider configuration on login and signup",
        surface: "login and signup OAuth provider affordances",
        viewport: "Desktop Chrome",
        auth: "anonymous",
        profile:
          "normal deterministic profile with optional Google provider configuration",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "invalid credentials stay generic and a successful retry preserves the deep callback",
        surface: "credential failure and callback-preserving recovery",
        viewport: "Desktop Chrome",
        auth: "anonymous to seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
    ],
  },
  {
    spec: "e2e/ui-matrix/catalog.spec.ts",
    owners: ["operations", "presentation", "ui"],
    coverage:
      "Source catalog shape, counts, uniqueness, and automation reference checks for 500 UI cases.",
    runMode: "advisory-ci",
    prerequisites: ["none beyond Playwright test runner"],
    roles: ["not browser-flow-specific"],
    devices: ["Playwright runner only"],
    ciStatus: "advisory deterministic E2E workflow",
    sourceRefs: ["e2e/ui-matrix/cases.ts", "e2e/ui-matrix/README.md"],
  },
  {
    spec: "e2e/ui-matrix/dashboard-document-lifecycle-ui.spec.ts",
    owners: ["documents"],
    coverage:
      "Deterministic dashboard search and favorite transport-failure containment, retry and duplicate suppression; search/favorite persistence, duplicate and rename durability, immediate delete/undo recovery, trash restore, and cancellable permanent deletion with fixture cleanup.",
    runMode: "advisory-ci",
    prerequisites: ["E2E_PROFILE=1", "npm run db:seed:e2e"],
    roles: ["seeded owner"],
    devices: ["Desktop Chrome"],
    ciStatus: "advisory deterministic E2E workflow",
    sourceRefs: ["e2e/ui-matrix/README.md", "docs/documents/README.md"],
    expectedTestCount: 1,
    expectedTests: [
      {
        test: "search and favorite failure recovery, duplicate, rename, undo, trash restore, and permanent delete persist",
        profiles: ["deterministic-profile"],
      },
    ],
    tests: [
      {
        test: "search and favorite failure recovery, duplicate, rename, undo, trash restore, and permanent delete persist",
        surface: "dashboard and trash document lifecycle",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
    ],
  },
  {
    spec: "e2e/ui-matrix/document-comments-lifecycle-ui.spec.ts",
    owners: ["documents", "editor", "security"],
    coverage:
      "Deterministic owner/viewer comment create transport-failure recovery with duplicate suppression, edit, anchored-paragraph mutation, reply, author-only action visibility, resolve/reopen, guarded deletion, and reload persistence lifecycle.",
    runMode: "advisory-ci",
    prerequisites: ["E2E_PROFILE=1", "npm run db:seed:e2e"],
    roles: ["seeded owner", "seeded viewer"],
    devices: ["Desktop Chrome"],
    ciStatus: "advisory deterministic E2E workflow",
    sourceRefs: [
      "e2e/ui-matrix/README.md",
      "docs/editor/comments-and-anchors.md",
    ],
    expectedTestCount: 1,
    expectedTests: [
      {
        test: "owner and viewer recover comment failure and complete the persisted lifecycle",
        profiles: ["deterministic-profile"],
      },
    ],
    tests: [
      {
        test: "owner and viewer recover comment failure and complete the persisted lifecycle",
        surface:
          "anchored comment creation, reply, resolution, and deletion lifecycle",
        viewport: "Desktop Chrome",
        auth: "seeded owner and seeded viewer",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
    ],
  },
  {
    spec: "e2e/ui-matrix/document-sharing-lifecycle-ui.spec.ts",
    owners: ["documents", "public-render", "security"],
    coverage:
      "Deterministic owner share transport-failure recovery with duplicate suppression, enablement, viewport-reachable policy controls, clipboard payloads, opener-isolated social intents, metadata and mode persistence, passcode failure/unlock, link rotation, revocation, and public-route enforcement.",
    runMode: "advisory-ci",
    prerequisites: ["E2E_PROFILE=1", "npm run db:seed:e2e"],
    roles: ["seeded owner", "anonymous public"],
    devices: ["Desktop Chrome"],
    ciStatus: "advisory deterministic E2E workflow",
    sourceRefs: [
      "e2e/ui-matrix/README.md",
      "docs/security/access-and-sharing.md",
    ],
    expectedTestCount: 1,
    expectedTests: [
      {
        test: "owner configures, protects, rotates, and disables a public share",
        profiles: ["deterministic-profile"],
      },
    ],
    tests: [
      {
        test: "owner configures, protects, rotates, and disables a public share",
        surface:
          "private-to-public sharing, protection, rotation, and revocation",
        viewport: "Desktop Chrome",
        auth: "seeded owner and anonymous public",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
    ],
  },
  {
    spec: "e2e/ui-matrix/document-metadata-history-ui.spec.ts",
    owners: ["documents", "editor", "security"],
    coverage:
      "Deterministic tag and version-restore transport-failure recovery with duplicate suppression, tag create/remove/reuse persistence, cancellable restore, pre-restore checkpoint recovery, metadata retention, and reload durability.",
    runMode: "advisory-ci",
    prerequisites: ["E2E_PROFILE=1", "npm run db:seed:e2e"],
    roles: ["seeded owner"],
    devices: ["Desktop Chrome"],
    ciStatus: "advisory deterministic E2E workflow",
    sourceRefs: [
      "e2e/ui-matrix/README.md",
      "docs/documents/README.md",
      "docs/editor/document-editor.md",
    ],
    expectedTestCount: 1,
    expectedTests: [
      {
        test: "tag and restore failures recover once before persistence and reversible reload",
        profiles: ["deterministic-profile"],
      },
    ],
    tests: [
      {
        test: "tag and restore failures recover once before persistence and reversible reload",
        surface: "document tags and reversible version restoration",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
    ],
  },
  {
    spec: "e2e/ui-matrix/document-editor-ui.spec.ts",
    owners: ["editor", "documents"],
    coverage:
      "Deterministic document body editability, keyboard formatting and slash insertion, visual-control focus restoration, table mutation confirmation, slide-entry navigation, viewer read-only affordance removal, and required-profile mobile editing-sheet nested-overlay hit testing.",
    runMode: "required-ci",
    prerequisites: ["E2E_PROFILE=1", "npm run db:seed:e2e"],
    roles: ["seeded owner", "seeded viewer"],
    devices: ["Desktop Chrome", "390x844 mobile"],
    ciStatus:
      "required mobile overlay case plus advisory deterministic E2E coverage",
    sourceRefs: [
      "e2e/ui-matrix/README.md",
      "docs/editor/document-editor.md",
      ".github/workflows/e2e-deterministic.yml",
    ],
    expectedTestCount: 8,
    expectedTests: [
      {
        test: "owner document editor renders the body surface and slide entry point",
        profiles: ["deterministic-profile"],
      },
      {
        test: "selected text exposes a keyboard-operable formatting toolbar and restores editor focus",
        profiles: ["deterministic-profile"],
      },
      {
        test: "slash insert filtering supports keyboard navigation and Escape dismissal",
        profiles: ["deterministic-profile"],
      },
      {
        test: "visual editing transfers keyboard focus into its tools and restores the preview on Escape",
        profiles: ["deterministic-profile"],
      },
      {
        test: "table controls mutate structure and require confirmation before deletion",
        profiles: ["deterministic-profile"],
      },
      {
        test: "open slide editor link reaches the canonical presentation route",
        profiles: ["deterministic-profile"],
      },
      {
        test: "viewer sees a read-only document with edit-only controls removed",
        profiles: ["deterministic-profile"],
      },
      {
        test: "selected text uses the mobile editing sheet, keeps its color picker above the sheet, and restores its trigger on Escape",
        profiles: ["deterministic-profile", "required-profile"],
      },
    ],
    tests: [
      {
        test: "owner document editor renders the body surface and slide entry point",
        surface: "document body and slide-entry controls",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "selected text exposes a keyboard-operable formatting toolbar and restores editor focus",
        surface: "selection formatting toolbar keyboard lifecycle",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "slash insert filtering supports keyboard navigation and Escape dismissal",
        surface: "slash insert filtering and dismissal",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "visual editing transfers keyboard focus into its tools and restores the preview on Escape",
        surface: "visual controls focus lifecycle",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "table controls mutate structure and require confirmation before deletion",
        surface: "table structure mutation and deletion confirmation",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "open slide editor link reaches the canonical presentation route",
        surface: "document-to-presentation navigation",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "viewer sees a read-only document with edit-only controls removed",
        surface: "viewer read-only document authorization",
        viewport: "Desktop Chrome",
        auth: "seeded viewer",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "selected text uses the mobile editing sheet, keeps its color picker above the sheet, and restores its trigger on Escape @required-profile",
        surface: "mobile editing sheet nested color-picker lifecycle",
        viewport: "390x844 mobile",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "required",
        status: "automated",
      },
    ],
  },
  {
    spec: "e2e/ui-matrix/presentation-ui.spec.ts",
    owners: ["presentation", "public-render"],
    coverage:
      "Deterministic slide-editor shell and deck actions, command-palette execution, filmstrip controls, history-isolated zoom geometry, and public-present first-slide navigation.",
    runMode: "advisory-ci",
    prerequisites: ["E2E_PROFILE=1", "npm run db:seed:e2e"],
    roles: ["seeded owner", "anonymous public"],
    devices: ["Desktop Chrome"],
    ciStatus: "advisory deterministic E2E workflow",
    sourceRefs: [
      "e2e/ui-matrix/README.md",
      "docs/presentation/slide-editor.md",
    ],
    expectedTestCount: 5,
    expectedTests: [
      {
        test: "canonical slide editor route renders shell, stage, and deck actions",
        profiles: ["deterministic-profile"],
      },
      {
        test: "command palette filters and runs insert and panel commands",
        profiles: ["deterministic-profile"],
      },
      {
        test: "filmstrip exposes both seeded slides and their controls",
        profiles: ["deterministic-profile"],
      },
      {
        test: "bottom dock zoom controls change canvas geometry without entering deck history",
        profiles: ["deterministic-profile"],
      },
      {
        test: "public present route exposes first-slide content and navigation controls",
        profiles: ["deterministic-profile"],
      },
    ],
    tests: [
      {
        test: "canonical slide editor route renders shell, stage, and deck actions",
        surface: "slide-editor shell, stage, and deck actions",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "command palette filters and runs insert and panel commands",
        surface: "command-palette filtering and execution",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "filmstrip exposes both seeded slides and their controls",
        surface: "seeded slide filmstrip controls",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "bottom dock zoom controls change canvas geometry without entering deck history",
        surface: "bottom-dock zoom geometry and history isolation",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "public present route exposes first-slide content and navigation controls",
        surface: "public-present first-slide content and navigation",
        viewport: "Desktop Chrome",
        auth: "anonymous public",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
    ],
  },
  {
    spec: "e2e/ui-matrix/public-render-ui.spec.ts",
    owners: ["public-render", "security"],
    coverage:
      "Deterministic public present/embed/share rendering, read-only affordances, accessible visual-lightbox focus/scroll/mobile behavior, safe fallbacks, and positive/negative share-bound asset access.",
    runMode: "advisory-ci",
    prerequisites: ["E2E_PROFILE=1", "npm run db:seed:e2e"],
    roles: ["anonymous public", "request API"],
    devices: ["Desktop Chrome", "390x844 mobile"],
    ciStatus: "advisory deterministic E2E workflow",
    sourceRefs: ["e2e/ui-matrix/README.md", "docs/public-render/README.md"],
    expectedTestCount: 7,
    expectedTests: [
      {
        test: "valid public present route renders seeded slide content",
        profiles: ["deterministic-profile"],
      },
      {
        test: "public present keyboard listeners release after client-side navigation",
        profiles: ["deterministic-profile"],
      },
      {
        test: "presentation embed route suppresses top HUD chrome and renders the first slide",
        profiles: ["deterministic-profile"],
      },
      {
        test: "unknown share and present routes return safe 404s without fixture leaks",
        profiles: ["deterministic-profile"],
      },
      {
        test: "share-bound slide assets require an active present or embed binding",
        profiles: ["deterministic-profile"],
      },
      {
        test: "valid public share route renders a read-only document surface",
        profiles: ["deterministic-profile"],
      },
      {
        test: "public share visuals expose an accessible lightbox lifecycle",
        profiles: ["deterministic-profile"],
      },
    ],
    tests: [
      {
        test: "valid public present route renders seeded slide content",
        surface: "public-present seeded slide rendering",
        viewport: "Desktop Chrome",
        auth: "anonymous public",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "public present keyboard listeners release after client-side navigation",
        surface: "public-present keyboard-listener cleanup",
        viewport: "Desktop Chrome",
        auth: "anonymous public",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "presentation embed route suppresses top HUD chrome and renders the first slide",
        surface: "chrome-free presentation embed rendering",
        viewport: "Desktop Chrome",
        auth: "anonymous public",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "unknown share and present routes return safe 404s without fixture leaks",
        surface: "safe public-route fallbacks and fixture privacy",
        viewport: "Playwright request context",
        auth: "anonymous request",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "share-bound slide assets require an active present or embed binding",
        surface: "share-bound slide-asset authorization",
        viewport: "Playwright request context",
        auth: "anonymous request",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "valid public share route renders a read-only document surface",
        surface: "read-only public document rendering",
        viewport: "Desktop Chrome",
        auth: "anonymous public",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "public share visuals expose an accessible lightbox lifecycle",
        surface: "public visual lightbox focus, scroll, and overflow lifecycle",
        viewport: "Desktop Chrome + 390x844 mobile",
        auth: "anonymous public",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
    ],
  },
  {
    spec: "e2e/ui-matrix/workspace-lifecycle-ui.spec.ts",
    owners: ["workspace", "security"],
    coverage:
      "Deterministic owner/editor/viewer workspace creation, validation, rename, invite create/revoke transport-failure recovery with duplicate suppression, clipboard feedback, revocation confirmation, invite acceptance, member-removal confirmation, ownership transfer, leave, and deletion lifecycle.",
    runMode: "advisory-ci",
    prerequisites: ["E2E_PROFILE=1", "npm run db:seed:e2e"],
    roles: ["seeded owner", "seeded editor", "seeded viewer"],
    devices: ["Desktop Chrome"],
    ciStatus: "advisory deterministic E2E workflow",
    sourceRefs: ["e2e/ui-matrix/README.md", "docs/security/workspaces.md"],
    expectedTestCount: 1,
    expectedTests: [
      {
        test: "owner, editor, and viewer recover invite failures and complete the workspace lifecycle",
        profiles: ["deterministic-profile"],
      },
    ],
    tests: [
      {
        test: "owner, editor, and viewer recover invite failures and complete the workspace lifecycle",
        surface:
          "workspace creation, invites, role changes, membership, and deletion",
        viewport: "Desktop Chrome",
        auth: "seeded owner, seeded editor, and seeded viewer",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
    ],
  },
  {
    spec: "e2e/ui-matrix/workspace-billing-brand-ui.spec.ts",
    owners: ["workspace", "billing", "brand"],
    coverage:
      "Deterministic dashboard checks; isolated billing transport-failure recovery with duplicate suppression, upgrade, scheduled cancellation, further plan change, downgrade, reload persistence, live feedback, and mobile overflow coverage; plus free-plan Brand Studio gating and a Pro upload-lock, create-failure recovery with duplicate suppression, font-upload/reload/edit/delete lifecycle.",
    runMode: "advisory-ci",
    prerequisites: [
      "E2E_PROFILE=1",
      "npm run db:seed:e2e",
      "optional BILLING_UNLIMITED_CREDITS",
    ],
    roles: [
      "seeded owner",
      "isolated billing lifecycle user",
      "seeded Pro editor",
    ],
    devices: ["Desktop Chrome", "390x844 mobile"],
    ciStatus: "advisory deterministic E2E workflow",
    sourceRefs: [
      "e2e/ui-matrix/README.md",
      "docs/product/billing.md",
      "docs/product/brand-studio.md",
    ],
    expectedTestCount: 5,
    expectedTests: [
      {
        test: "dashboard search and favorite controls are available for the seeded owner",
        profiles: ["deterministic-profile"],
      },
      {
        test: "billing credits panel reflects the sqlite E2E environment gate",
        profiles: ["deterministic-profile"],
      },
      {
        test: "billing upgrades, cancellation, downgrade, persistence, and mobile layout work end to end",
        profiles: ["deterministic-profile"],
      },
      {
        test: "free owner sees the Brand Studio upgrade gate",
        profiles: ["deterministic-profile"],
      },
      {
        test: "Pro editor creates, uploads, reloads, edits, and deletes a brand",
        profiles: ["deterministic-profile"],
      },
    ],
    tests: [
      {
        test: "dashboard search and favorite controls are available for the seeded owner",
        surface: "dashboard document search and favorites",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "billing credits panel reflects the sqlite E2E environment gate",
        surface: "billing credit usage and unlimited-credit gate",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile:
          "normal deterministic profile with optional BILLING_UNLIMITED_CREDITS",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "billing upgrades, cancellation, downgrade, persistence, and mobile layout work end to end",
        surface: "billing failure recovery and complete plan lifecycle",
        viewport: "Desktop Chrome + 390x844 mobile",
        auth: "isolated billing lifecycle user",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "free owner sees the Brand Studio upgrade gate",
        surface: "free-plan Brand Studio entitlement gate",
        viewport: "Desktop Chrome",
        auth: "seeded owner",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
      {
        test: "Pro editor creates, uploads, reloads, edits, and deletes a brand",
        surface: "Pro Brand Studio upload and CRUD lifecycle",
        viewport: "390x844 mobile",
        auth: "seeded Pro editor",
        profile: "normal deterministic profile (E2E_PROFILE=1)",
        ciTier: "advisory",
        status: "automated",
      },
    ],
  },
] as const satisfies readonly UiMatrixSpecInventoryEntry[];

export const UI_MATRIX_MANUAL_GAPS = [
  {
    id: "FULL-500-BROWSER-MATRIX",
    owner: "ui matrix",
    gap: "The generated 500-case planning catalog is only partially tied to case-level automation. Existing runnable browser specs remain evidence for their inventoried flows, but a catalog case is promoted only after it names an exact contracted test with deterministic fixtures and stable selectors.",
    status: "catalog",
    sourceRefs: ["e2e/ui-matrix/cases.ts", "e2e/ui-matrix/README.md"],
  },
] as const satisfies readonly UiMatrixManualGap[];
