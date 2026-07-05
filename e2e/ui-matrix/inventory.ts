export type UiMatrixRunMode = "advisory-ci" | "opt-in-local";

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
    spec: "e2e/auth-redirect.spec.ts",
    owners: ["auth", "security"],
    coverage:
      "Unauthenticated /app and deep /app redirects preserve callbackUrl.",
    runMode: "opt-in-local",
    prerequisites: ["running app"],
    roles: ["anonymous"],
    devices: ["Desktop Chrome"],
    ciStatus: "opt-in local/full Playwright suite",
    sourceRefs: ["e2e/README.md", "docs/security/access-and-sharing.md"],
  },
  {
    spec: "e2e/authenticated-nested-routes.spec.ts",
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
    spec: "e2e/billing-brand.spec.ts",
    owners: ["billing", "brand", "product"],
    coverage:
      "Billing unlimited-credit display and Brand Studio font upload persistence.",
    runMode: "opt-in-local",
    prerequisites: [
      "E2E_USER_EMAIL/PASSWORD",
      "optional E2E_BRAND_FONT_URL",
      "optional BILLING_UNLIMITED_CREDITS",
    ],
    roles: ["owner"],
    devices: ["Desktop Chrome"],
    ciStatus: "opt-in local/staging only",
    sourceRefs: [
      "e2e/README.md",
      "docs/product/billing.md",
      "docs/product/brand-studio.md",
    ],
  },
  {
    spec: "e2e/block-id-preservation.spec.ts",
    owners: ["editor", "presentation"],
    coverage:
      "Block id preservation catalog hooks for save/reload, visual insertion, and duplication.",
    runMode: "opt-in-local",
    prerequisites: ["E2E_USER_EMAIL/PASSWORD", "E2E_BLOCK_ID_DOC_URL"],
    roles: ["owner"],
    devices: ["Desktop Chrome"],
    ciStatus: "manual fixture-backed local run",
    sourceRefs: ["e2e/README.md", "docs/editor/document-editor.md"],
  },
  {
    spec: "e2e/document-editor-profile.spec.ts",
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
    spec: "e2e/import-roundtrip.spec.ts",
    owners: ["import", "editor"],
    coverage:
      "Markdown import creates an editable document and unsupported uploads fail gracefully.",
    runMode: "advisory-ci",
    prerequisites: ["E2E_PROFILE=1", "npm run db:seed:e2e"],
    roles: ["seeded owner", "anonymous request API"],
    devices: ["Desktop Chrome"],
    ciStatus: "advisory deterministic E2E workflow",
    sourceRefs: ["e2e/README.md", "docs/codebase/TESTING.md"],
  },
  {
    spec: "e2e/oauth-disabled.spec.ts",
    owners: ["auth", "security"],
    coverage:
      "Login/signup Google CTA matches provider configuration while credentials remain usable.",
    runMode: "opt-in-local",
    prerequisites: ["running app", "optional GOOGLE_CLIENT_ID/SECRET"],
    roles: ["anonymous"],
    devices: ["Desktop Chrome"],
    ciStatus: "opt-in local/full Playwright suite",
    sourceRefs: ["e2e/README.md", "docs/security/access-and-sharing.md"],
  },
  {
    spec: "e2e/present-export.spec.ts",
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
    spec: "e2e/public-pages.spec.ts",
    owners: ["system", "public-render"],
    coverage:
      "Marketing home, login, and signup primary unauthenticated surfaces render.",
    runMode: "opt-in-local",
    prerequisites: ["running app"],
    roles: ["anonymous"],
    devices: ["Desktop Chrome"],
    ciStatus: "opt-in local/full Playwright suite",
    sourceRefs: ["e2e/README.md"],
  },
  {
    spec: "e2e/screenshot-regression.spec.ts",
    owners: ["presentation", "visual", "operations"],
    coverage:
      "Opt-in visual snapshots for editor stage, in-app present, and public present fixtures.",
    runMode: "opt-in-local",
    prerequisites: [
      "E2E_SCREENSHOT_REGRESSION=1",
      "running app",
      "snapshot baselines",
    ],
    roles: ["anonymous", "fixture routes"],
    devices: ["Desktop Chrome", "fixed slide viewport"],
    ciStatus: "opt-in local visual comparison",
    sourceRefs: ["e2e/README.md", "docs/presentation/rendering-and-export.md"],
  },
  {
    spec: "e2e/share-fallback.spec.ts",
    owners: ["public-render", "security"],
    coverage:
      "Unknown, malformed, and slug-prefixed share/present/embed routes return safe 404s.",
    runMode: "opt-in-local",
    prerequisites: ["running app"],
    roles: ["anonymous"],
    devices: ["Desktop Chrome", "request API"],
    ciStatus: "opt-in local/full Playwright suite",
    sourceRefs: ["e2e/README.md", "docs/public-render/README.md"],
  },
  {
    spec: "e2e/slide-asset-upload.spec.ts",
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
    spec: "e2e/slides-layout-screenshots.spec.ts",
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
    spec: "e2e/slides-smoke.spec.ts",
    owners: ["presentation"],
    coverage:
      "Credential-gated slide edit, save, present, and export smoke against a provided document.",
    runMode: "opt-in-local",
    prerequisites: ["E2E_USER_EMAIL/PASSWORD", "E2E_SLIDES_DOC_URL"],
    roles: ["owner", "anonymous fallback routes"],
    devices: ["Desktop Chrome"],
    ciStatus: "opt-in local/staging only",
    sourceRefs: ["e2e/README.md", "docs/presentation/slide-editor.md"],
  },
  {
    spec: "e2e/ui-matrix/auth-public-ui.spec.ts",
    owners: ["auth", "public-render", "system"],
    coverage:
      "Representative UI matrix checks for public auth pages, OAuth CTA state, and protected redirects.",
    runMode: "opt-in-local",
    prerequisites: ["running app", "optional GOOGLE_CLIENT_ID/SECRET"],
    roles: ["anonymous"],
    devices: ["Desktop Chrome"],
    ciStatus: "explicit UI matrix browser run only",
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
      "Representative UI matrix checks for document body, slide-entry link, and viewer read path.",
    runMode: "opt-in-local",
    prerequisites: ["E2E_PROFILE=1", "npm run db:seed:e2e"],
    roles: ["seeded owner", "seeded viewer"],
    devices: ["Desktop Chrome"],
    ciStatus: "explicit UI matrix browser run only",
    sourceRefs: ["e2e/ui-matrix/README.md", "docs/editor/document-editor.md"],
  },
  {
    spec: "e2e/ui-matrix/presentation-ui.spec.ts",
    owners: ["presentation", "public-render"],
    coverage:
      "Representative UI matrix checks for slide editor shell, filmstrip, dock, and public present route.",
    runMode: "opt-in-local",
    prerequisites: ["E2E_PROFILE=1", "npm run db:seed:e2e"],
    roles: ["seeded owner", "anonymous public"],
    devices: ["Desktop Chrome"],
    ciStatus: "explicit UI matrix browser run only",
    sourceRefs: [
      "e2e/ui-matrix/README.md",
      "docs/presentation/slide-editor.md",
    ],
  },
  {
    spec: "e2e/ui-matrix/public-render-ui.spec.ts",
    owners: ["public-render", "security"],
    coverage:
      "Representative UI matrix checks for public present/embed/share and share-bound asset access.",
    runMode: "opt-in-local",
    prerequisites: ["E2E_PROFILE=1", "npm run db:seed:e2e"],
    roles: ["anonymous public", "request API"],
    devices: ["Desktop Chrome"],
    ciStatus: "explicit UI matrix browser run only",
    sourceRefs: ["e2e/ui-matrix/README.md", "docs/public-render/README.md"],
  },
  {
    spec: "e2e/ui-matrix/workspace-billing-brand-ui.spec.ts",
    owners: ["workspace", "billing", "brand"],
    coverage:
      "Representative UI matrix checks for dashboard search, billing credits, and Brand Studio gate.",
    runMode: "opt-in-local",
    prerequisites: [
      "E2E_PROFILE=1",
      "npm run db:seed:e2e",
      "optional BILLING_UNLIMITED_CREDITS",
    ],
    roles: ["seeded owner"],
    devices: ["Desktop Chrome"],
    ciStatus: "explicit UI matrix browser run only",
    sourceRefs: [
      "e2e/ui-matrix/README.md",
      "docs/product/billing.md",
      "docs/product/brand-studio.md",
    ],
  },
  {
    spec: "e2e/workspace.spec.ts",
    owners: ["workspace", "documents"],
    coverage:
      "Credential-gated dashboard create/import, empty state, and read-only viewer restrictions.",
    runMode: "opt-in-local",
    prerequisites: [
      "E2E_USER_EMAIL/PASSWORD",
      "optional E2E_VIEWER_*",
      "optional E2E_VIEWER_DOC_URL",
    ],
    roles: ["owner", "viewer"],
    devices: ["Desktop Chrome"],
    ciStatus: "opt-in local/staging only",
    sourceRefs: ["e2e/README.md", "docs/security/access-and-sharing.md"],
  },
] as const satisfies readonly UiMatrixSpecInventoryEntry[];

export const UI_MATRIX_MANUAL_GAPS = [
  {
    id: "DOCX-UI-ROUNDTRIP",
    owner: "import",
    gap: "DOCX import is parser-tested but remains a manual UI round-trip because binary fixtures are not maintained in-repo.",
    status: "manual",
    sourceRefs: ["e2e/README.md", "docs/codebase/TESTING.md"],
  },
  {
    id: "BLOCK-ID-DEEP-ASSERTIONS",
    owner: "editor/presentation",
    gap: "Block-id preservation spec currently exercises fixture reachability; persisted bid/sourceRef assertions need stable diagnostics hooks.",
    status: "blocked",
    sourceRefs: [
      "e2e/block-id-preservation.spec.ts",
      "docs/editor/document-editor.md",
    ],
  },
  {
    id: "FULL-500-BROWSER-MATRIX",
    owner: "ui matrix",
    gap: "The 500-case catalog is intentionally not expanded into 500 browser tests; representative automated slices are promoted only when fixtures and selectors are stable.",
    status: "catalog",
    sourceRefs: ["e2e/ui-matrix/cases.ts", "e2e/ui-matrix/README.md"],
  },
] as const satisfies readonly UiMatrixManualGap[];
