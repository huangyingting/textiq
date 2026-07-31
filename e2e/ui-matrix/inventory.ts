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
  },
  {
    spec: "e2e/import/import-roundtrip.spec.ts",
    owners: ["import", "editor"],
    coverage:
      "Markdown and DOCX imports create editable documents that persist across reload; workspace roles are enforced and unsupported uploads fail gracefully.",
    runMode: "required-ci",
    prerequisites: ["E2E_PROFILE=1", "npm run db:seed:e2e"],
    roles: ["seeded owner", "seeded editor", "seeded viewer"],
    devices: ["Desktop Chrome"],
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
        test: "imports DOCX, renders blocks, and persists content across reload @required-profile",
        surface: "dashboard import → document editor render/reload",
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
      "Shortcut and editor focus restoration plus mobile Edit/Add slide geometry, hit testing, and pointer activation.",
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
      "Authenticated/public present render, mobile safe areas, embed mode, and real PDF export.",
    runMode: "advisory-ci",
    prerequisites: ["E2E_PROFILE=1", "npm run db:seed:e2e"],
    roles: ["seeded owner", "seeded viewer", "anonymous public"],
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
  },
  {
    spec: "e2e/presentation/pointer-interactions.spec.ts",
    owners: ["presentation", "accessibility"],
    coverage:
      "Real Chromium pointer drag coverage for filmstrip reorder, node resize/rotation with undo, and connector endpoint snapping with autosave/reload persistence.",
    runMode: "advisory-ci",
    prerequisites: ["E2E_PROFILE=1", "npm run db:seed:e2e"],
    roles: ["seeded owner"],
    devices: ["Desktop Chrome"],
    ciStatus: "advisory deterministic E2E workflow",
    sourceRefs: ["e2e/README.md", "docs/presentation/slide-editor.md"],
  },
  {
    spec: "e2e/presentation/presentation-controls.spec.ts",
    owners: ["presentation", "accessibility"],
    coverage:
      "Real Chromium multi-select Arrange, precision guide preferences/snapping, built-in themes, and custom theme authoring with isolated mutation fixtures.",
    runMode: "advisory-ci",
    prerequisites: ["E2E_PROFILE=1", "npm run db:seed:e2e"],
    roles: ["seeded owner"],
    devices: ["Desktop Chrome"],
    ciStatus: "advisory deterministic E2E workflow",
    sourceRefs: ["e2e/README.md", "docs/presentation/slide-editor.md"],
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
  },
  {
    spec: "e2e/presentation/slides-layout-screenshots.spec.ts",
    owners: ["presentation", "visual"],
    coverage:
      "Slide editor shell screenshots across desktop, tablet, mobile, rail, notes, and panel states.",
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
      "Slide edit, resize/duplicate, add-slide, and visual-insert mutations use independent deterministic documents and Yjs rooms; optional external fixtures cover non-mutating smoke.",
    runMode: "advisory-ci",
    prerequisites: [
      "E2E_PROFILE=1 for mutating coverage",
      "optional E2E_USER_EMAIL/PASSWORD and E2E_SLIDES_DOC_URL",
    ],
    roles: ["seeded owner", "owner", "anonymous fallback routes"],
    devices: ["Desktop Chrome"],
    ciStatus: "advisory deterministic E2E workflow",
    sourceRefs: ["e2e/README.md", "docs/presentation/slide-editor.md"],
  },
  {
    spec: "e2e/presentation/slides-conflict-recovery.spec.ts",
    owners: ["presentation", "collaboration"],
    coverage:
      "Real two-context Chromium deck conflicts for Keep my version and Use server version, including independent geometry edits, history reset, and reload persistence.",
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
    spec: "e2e/ui-matrix/document-editor-ui.spec.ts",
    owners: ["editor", "documents"],
    coverage:
      "Deterministic document body editability, slide-entry navigation, and viewer read-only affordance removal.",
    runMode: "advisory-ci",
    prerequisites: ["E2E_PROFILE=1", "npm run db:seed:e2e"],
    roles: ["seeded owner", "seeded viewer"],
    devices: ["Desktop Chrome"],
    ciStatus: "advisory deterministic E2E workflow",
    sourceRefs: ["e2e/ui-matrix/README.md", "docs/editor/document-editor.md"],
  },
  {
    spec: "e2e/ui-matrix/presentation-ui.spec.ts",
    owners: ["presentation", "public-render"],
    coverage:
      "Representative UI matrix checks for slide editor shell, filmstrip, dock, and public present route.",
    runMode: "advisory-ci",
    prerequisites: ["E2E_PROFILE=1", "npm run db:seed:e2e"],
    roles: ["seeded owner", "anonymous public"],
    devices: ["Desktop Chrome"],
    ciStatus: "advisory deterministic E2E workflow",
    sourceRefs: [
      "e2e/ui-matrix/README.md",
      "docs/presentation/slide-editor.md",
    ],
  },
  {
    spec: "e2e/ui-matrix/public-render-ui.spec.ts",
    owners: ["public-render", "security"],
    coverage:
      "Deterministic public present/embed/share rendering, read-only affordances, safe fallbacks, and positive/negative share-bound asset access.",
    runMode: "advisory-ci",
    prerequisites: ["E2E_PROFILE=1", "npm run db:seed:e2e"],
    roles: ["anonymous public", "request API"],
    devices: ["Desktop Chrome"],
    ciStatus: "advisory deterministic E2E workflow",
    sourceRefs: ["e2e/ui-matrix/README.md", "docs/public-render/README.md"],
  },
  {
    spec: "e2e/ui-matrix/workspace-billing-brand-ui.spec.ts",
    owners: ["workspace", "billing", "brand"],
    coverage:
      "Deterministic dashboard and billing checks plus free-plan Brand Studio gating and a Pro create/font-upload/reload/edit/delete lifecycle.",
    runMode: "advisory-ci",
    prerequisites: [
      "E2E_PROFILE=1",
      "npm run db:seed:e2e",
      "optional BILLING_UNLIMITED_CREDITS",
    ],
    roles: ["seeded owner", "seeded Pro editor"],
    devices: ["Desktop Chrome"],
    ciStatus: "advisory deterministic E2E workflow",
    sourceRefs: [
      "e2e/ui-matrix/README.md",
      "docs/product/billing.md",
      "docs/product/brand-studio.md",
    ],
  },
] as const satisfies readonly UiMatrixSpecInventoryEntry[];

export const UI_MATRIX_MANUAL_GAPS = [
  {
    id: "FULL-500-BROWSER-MATRIX",
    owner: "ui matrix",
    gap: "The 500-case catalog is intentionally not expanded into 500 browser tests; representative automated slices are promoted only when fixtures and selectors are stable.",
    status: "catalog",
    sourceRefs: ["e2e/ui-matrix/cases.ts", "e2e/ui-matrix/README.md"],
  },
] as const satisfies readonly UiMatrixManualGap[];
