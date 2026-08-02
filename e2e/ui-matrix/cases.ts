export type UiCaseStatus = "automated" | "manual" | "blocked" | "catalog";
export type UiCasePriority = "P0" | "P1" | "P2";
export type UiSubsystem =
  | "presentation-editor"
  | "presentation-render-export"
  | "public-render-share"
  | "auth-public"
  | "document-editor"
  | "workspace-billing-brand";

export type UiTestCase = {
  id: string;
  subsystem: UiSubsystem;
  area: string;
  title: string;
  status: UiCaseStatus;
  priority: UiCasePriority;
  refs: string[];
  tags: string[];
  automation?: {
    spec: string;
    test: string;
  };
};

type SubsystemPlan = {
  prefix: string;
  subsystem: UiSubsystem;
  total: number;
  statusCounts: Record<UiCaseStatus, number>;
  refs: string[];
  areas: string[];
  subjects: string[];
  interactions: string[];
  variants: string[];
};

const STATUS_ORDER: UiCaseStatus[] = [
  "automated",
  "manual",
  "blocked",
  "catalog",
];

// These generated combinations are release-planning inventory, not execution
// evidence. Promote a case only by defining an exact automation test identity;
// the inventory checker rejects spec-only or otherwise uncontracted claims.
const PLANS: SubsystemPlan[] = [
  {
    prefix: "PRES-EDIT",
    subsystem: "presentation-editor",
    total: 180,
    statusCounts: { automated: 68, manual: 48, blocked: 10, catalog: 54 },
    refs: [
      "docs/presentation/slide-editor.md",
      "docs/presentation/slide-stage-interactions.md",
      "docs/system/design-system.md",
    ],
    areas: [
      "shell layout",
      "top toolbar",
      "canvas popover",
      "stage selection",
      "stage keyboard",
      "stage pointer",
      "inspector panels",
      "filmstrip",
      "bottom dock",
      "notes",
      "source review",
      "autosave status",
      "accessibility",
      "negative recovery",
      "responsive layout",
    ],
    subjects: [
      "current-object ownership",
      "deck-level commands",
      "slide-level commands",
      "single-node selection",
      "multi-selection bounds",
      "group frames",
      "connector endpoints",
      "text edit mode",
      "image replacement",
      "shape style edits",
      "table node editing",
      "source-linked nodes",
      "diagnostic surfacing",
      "save conflict messaging",
      "keyboard shortcuts",
    ],
    interactions: [
      "renders expected controls",
      "keeps focus visible",
      "announces state changes",
      "persists after reload",
      "prevents invalid action",
      "uses semantic roles",
      "responds to keyboard input",
      "maintains viewport-safe chrome",
      "keeps selection stable",
      "opens the correct panel",
    ],
    variants: [
      "desktop",
      "tablet",
      "mobile",
      "mouse",
      "keyboard",
      "touch-sized viewport",
      "read-only viewer",
      "offline retry",
      "dirty deck",
      "saved deck",
    ],
  },
  {
    prefix: "PRES-RENDER",
    subsystem: "presentation-render-export",
    total: 120,
    statusCounts: { automated: 19, manual: 35, blocked: 8, catalog: 58 },
    refs: [
      "docs/presentation/rendering-and-export.md",
      "docs/presentation/assets.md",
      "docs/public-render/README.md",
    ],
    areas: [
      "in-app present",
      "public present",
      "presentation embed",
      "export menu",
      "PDF export",
      "PPTX export",
      "font loading",
      "asset resolution",
      "diagnostic preflight",
      "deep links",
      "safe areas",
      "keyboard navigation",
    ],
    subjects: [
      "slide canvas parity",
      "first-slide render",
      "second-slide render",
      "progress meter",
      "speaker notes",
      "slide overview",
      "HUD controls",
      "share-bound assets",
      "missing asset diagnostics",
      "nonzero download",
      "CJK font fallback",
      "chrome-free embed",
    ],
    interactions: [
      "renders nonblank content",
      "advances and returns",
      "honors direct hash links",
      "suppresses unavailable chrome",
      "serves protected bytes",
      "blocks fatal export",
      "shows warnings before download",
      "keeps controls accessible",
    ],
    variants: [
      "authenticated owner",
      "authenticated viewer",
      "anonymous public",
      "mobile viewport",
      "desktop viewport",
      "embed mode",
      "present mode",
      "download flow",
    ],
  },
  {
    prefix: "PUBLIC",
    subsystem: "public-render-share",
    total: 60,
    statusCounts: { automated: 21, manual: 16, blocked: 3, catalog: 20 },
    refs: [
      "docs/public-render/README.md",
      "docs/security/access-and-sharing.md",
    ],
    areas: [
      "share route",
      "embed route",
      "present route",
      "present embed route",
      "unknown fallback",
      "malformed fallback",
      "metadata privacy",
      "asset binding",
      "attribution",
      "mode projection",
    ],
    subjects: [
      "valid share id",
      "slug-prefixed id",
      "unknown id",
      "malformed id",
      "expired link",
      "revoked link",
      "disabled embed",
      "disabled present",
      "deleted document",
      "share-bound asset",
    ],
    interactions: [
      "returns expected status",
      "does not leak fixture content",
      "renders read-only UI",
      "keeps robots private",
      "applies embed policy",
      "uses presentation projection",
    ],
    variants: [
      "anonymous",
      "authenticated owner",
      "authenticated viewer",
      "desktop",
      "mobile",
      "request API",
    ],
  },
  {
    prefix: "AUTH",
    subsystem: "auth-public",
    total: 40,
    statusCounts: { automated: 16, manual: 10, blocked: 2, catalog: 12 },
    refs: ["e2e/README.md", "docs/security/access-and-sharing.md"],
    areas: [
      "home page",
      "login page",
      "signup page",
      "auth redirect",
      "OAuth availability",
      "form validation",
      "callback URLs",
      "public navigation",
    ],
    subjects: [
      "hero CTA",
      "email field",
      "password field",
      "submit button",
      "Google CTA",
      "or divider",
      "protected app path",
      "deep app path",
    ],
    interactions: [
      "renders primary controls",
      "preserves callback URL",
      "hides unavailable provider",
      "keeps credentials usable",
      "announces invalid input",
    ],
    variants: [
      "anonymous",
      "OAuth disabled",
      "OAuth configured",
      "desktop",
      "mobile",
    ],
  },
  {
    prefix: "DOC-EDIT",
    subsystem: "document-editor",
    total: 45,
    statusCounts: { automated: 23, manual: 15, blocked: 4, catalog: 3 },
    refs: [
      "docs/editor/document-editor.md",
      "docs/editor/comments-and-anchors.md",
      "docs/system/design-system.md",
    ],
    areas: [
      "Lexical surface",
      "selection toolbar",
      "insert menu",
      "visual popover",
      "table toolbar",
      "mobile sheet",
      "comments",
      "slide editor entry",
      "document actions",
    ],
    subjects: [
      "document body",
      "text range selection",
      "collapsed caret",
      "visual block",
      "table cell",
      "comment anchor",
      "read-only viewer",
      "stable block bid",
      "insert menu search",
    ],
    interactions: [
      "renders deterministic fixture",
      "shows contextual surface",
      "keeps mutation through Lexical",
      "hides competing surfaces",
      "preserves focus",
      "rejects unauthorized edit",
    ],
    variants: ["owner", "viewer", "desktop", "mobile", "keyboard", "pointer"],
  },
  {
    prefix: "WORKSPACE",
    subsystem: "workspace-billing-brand",
    total: 55,
    statusCounts: { automated: 13, manual: 15, blocked: 5, catalog: 22 },
    refs: [
      "docs/product/billing.md",
      "docs/product/brand-studio.md",
      "docs/security/access-and-sharing.md",
    ],
    areas: [
      "dashboard",
      "search",
      "filters",
      "sorting",
      "favorites",
      "billing credits",
      "plan entitlements",
      "brand list",
      "brand editor",
      "brand assets",
      "workspace roles",
    ],
    subjects: [
      "document cards",
      "empty state",
      "tag filter",
      "favorite toggle",
      "rename dialog",
      "delete dialog",
      "unlimited credits",
      "custom font gate",
      "brand palette",
      "viewer restriction",
      "upgrade CTA",
    ],
    interactions: [
      "renders expected state",
      "updates query params",
      "opens safe dialogs",
      "cancels destructive action",
      "persists after reload",
      "enforces entitlement gate",
    ],
    variants: [
      "owner",
      "viewer",
      "free plan",
      "plus plan",
      "pro plan",
      "desktop",
    ],
  },
];

const AUTOMATED_CASES: UiTestCase[] = [
  {
    id: "AUTH-013",
    subsystem: "auth-public",
    area: "public home, login, and signup",
    title:
      "public home, login, and signup expose primary unauthenticated controls",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/ui-matrix/auth-public-ui.spec.ts",
      "docs/security/access-and-sharing.md",
    ],
    tags: ["anonymous", "auth-controls", "desktop"],
    automation: {
      spec: "e2e/ui-matrix/auth-public-ui.spec.ts",
      test: "public home, login, and signup expose primary unauthenticated controls",
    },
  },
  {
    id: "AUTH-014",
    subsystem: "auth-public",
    area: "protected routes",
    title: "root and deep protected routes redirect with callbackUrl intact",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/ui-matrix/auth-public-ui.spec.ts",
      "docs/security/access-and-sharing.md",
    ],
    tags: ["anonymous", "auth-redirect", "callback-url"],
    automation: {
      spec: "e2e/ui-matrix/auth-public-ui.spec.ts",
      test: "root and deep protected routes redirect with callbackUrl intact",
    },
  },
  {
    id: "AUTH-015",
    subsystem: "auth-public",
    area: "Google OAuth CTA",
    title:
      "Google OAuth CTA matches provider configuration on login and signup",
    status: "automated",
    priority: "P1",
    refs: [
      "e2e/ui-matrix/auth-public-ui.spec.ts",
      "docs/security/access-and-sharing.md",
    ],
    tags: ["anonymous", "oauth-configuration", "desktop"],
    automation: {
      spec: "e2e/ui-matrix/auth-public-ui.spec.ts",
      test: "Google OAuth CTA matches provider configuration on login and signup",
    },
  },
  {
    id: "AUTH-016",
    subsystem: "auth-public",
    area: "invalid credentials",
    title:
      "invalid credentials stay generic and a successful retry preserves the deep callback",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/ui-matrix/auth-public-ui.spec.ts",
      "docs/security/access-and-sharing.md",
    ],
    tags: ["seeded-owner", "credential-retry", "callback-url"],
    automation: {
      spec: "e2e/ui-matrix/auth-public-ui.spec.ts",
      test: "invalid credentials stay generic and a successful retry preserves the deep callback",
    },
  },
  {
    id: "AUTH-017",
    subsystem: "auth-public",
    area: "recovery and verification pages",
    title: "recovery and verification pages expose safe public failure states",
    status: "automated",
    priority: "P0",
    refs: ["e2e/ui-matrix/account-lifecycle-ui.spec.ts", "docs/auth/README.md"],
    tags: ["anonymous", "password-recovery", "email-verification"],
    automation: {
      spec: "e2e/ui-matrix/account-lifecycle-ui.spec.ts",
      test: "recovery and verification pages expose safe public failure states",
    },
  },
  {
    id: "AUTH-018",
    subsystem: "auth-public",
    area: "settings",
    title:
      "seeded owner can inspect settings and download a scoped data export",
    status: "automated",
    priority: "P0",
    refs: ["e2e/ui-matrix/account-lifecycle-ui.spec.ts", "docs/auth/README.md"],
    tags: ["seeded-owner", "settings", "account-export"],
    automation: {
      spec: "e2e/ui-matrix/account-lifecycle-ui.spec.ts",
      test: "seeded owner can inspect settings and download a scoped data export",
    },
  },
  {
    id: "AUTH-019",
    subsystem: "auth-public",
    area: "new account",
    title:
      "new account signs up, recovers onboarding dismissal, persists it, and deletes cleanly",
    status: "automated",
    priority: "P0",
    refs: ["e2e/ui-matrix/account-lifecycle-ui.spec.ts", "docs/auth/README.md"],
    tags: ["signup", "onboarding", "account-deletion"],
    automation: {
      spec: "e2e/ui-matrix/account-lifecycle-ui.spec.ts",
      test: "new account signs up, recovers onboarding dismissal, persists it, and deletes cleanly",
    },
  },
  {
    id: "AUTH-020",
    subsystem: "auth-public",
    area: "isolated account",
    title:
      "isolated account persists profile edits and rotates credentials with explicit re-login",
    status: "automated",
    priority: "P0",
    refs: ["e2e/ui-matrix/account-lifecycle-ui.spec.ts", "docs/auth/README.md"],
    tags: ["isolated-account", "profile", "password-rotation"],
    automation: {
      spec: "e2e/ui-matrix/account-lifecycle-ui.spec.ts",
      test: "isolated account persists profile edits and rotates credentials with explicit re-login",
    },
  },
  {
    id: "AUTH-021",
    subsystem: "auth-public",
    area: "password failures",
    title:
      "password failures preserve the session and deletion stays confirmation-gated",
    status: "automated",
    priority: "P0",
    refs: ["e2e/ui-matrix/account-lifecycle-ui.spec.ts", "docs/auth/README.md"],
    tags: ["seeded-owner", "password-failure", "deletion-confirmation"],
    automation: {
      spec: "e2e/ui-matrix/account-lifecycle-ui.spec.ts",
      test: "password failures preserve the session and deletion stays confirmation-gated",
    },
  },
  {
    id: "AUTH-022",
    subsystem: "auth-public",
    area: "desktop themes",
    title: "desktop themes update every persistence channel and survive reload",
    status: "automated",
    priority: "P1",
    refs: [
      "e2e/ui-matrix/app-shell-ui.spec.ts",
      "docs/system/design-system.md",
    ],
    tags: ["seeded-owner", "theme", "persistence"],
    automation: {
      spec: "e2e/ui-matrix/app-shell-ui.spec.ts",
      test: "desktop themes update every persistence channel and survive reload",
    },
  },
  {
    id: "AUTH-023",
    subsystem: "auth-public",
    area: "desktop user and shortcut menus",
    title: "desktop user and shortcut menus close accessibly and ignore typing",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/ui-matrix/app-shell-ui.spec.ts",
      "docs/commands/actions-and-shortcuts.md",
    ],
    tags: ["seeded-owner", "keyboard", "focus-restoration"],
    automation: {
      spec: "e2e/ui-matrix/app-shell-ui.spec.ts",
      test: "desktop user and shortcut menus close accessibly and ignore typing",
    },
  },
  {
    id: "AUTH-024",
    subsystem: "auth-public",
    area: "mobile drawer",
    title:
      "mobile drawer composes theme and shortcut overlays without duplicates or overflow",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/ui-matrix/app-shell-ui.spec.ts",
      "docs/system/design-system.md",
      "docs/commands/actions-and-shortcuts.md",
    ],
    tags: ["seeded-owner", "mobile", "nested-overlays"],
    automation: {
      spec: "e2e/ui-matrix/app-shell-ui.spec.ts",
      test: "mobile drawer composes theme and shortcut overlays without duplicates or overflow",
    },
  },
  {
    id: "AUTH-025",
    subsystem: "auth-public",
    area: "dashboard-linked document",
    title:
      "dashboard-linked document, billing, and slide routes render after login",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/auth/authenticated-nested-routes.spec.ts",
      "docs/security/access-and-sharing.md",
    ],
    tags: ["seeded-owner", "authenticated-routes", "required-profile"],
    automation: {
      spec: "e2e/auth/authenticated-nested-routes.spec.ts",
      test: "dashboard-linked document, billing, and slide routes render after login",
    },
  },
  {
    id: "AUTH-026",
    subsystem: "auth-public",
    area: "real HTTPS login",
    title:
      "real HTTPS login keeps the Auth.js session cookie secure and isolates the proxy key",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/auth/authenticated-nested-routes.spec.ts",
      "docs/security/access-and-sharing.md",
    ],
    tags: ["secure-cookie", "https", "proxy-isolation"],
    automation: {
      spec: "e2e/auth/authenticated-nested-routes.spec.ts",
      test: "real HTTPS login keeps the Auth.js session cookie secure and isolates the proxy key",
    },
  },
  {
    id: "AUTH-027",
    subsystem: "auth-public",
    area: "running secure profile",
    title:
      "running secure profile isolates the private-key descriptor from runner, app, Playwright, and Chromium",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/auth/authenticated-nested-routes.spec.ts",
      "docs/security/access-and-sharing.md",
    ],
    tags: ["private-key", "process-boundary", "required-profile"],
    automation: {
      spec: "e2e/auth/authenticated-nested-routes.spec.ts",
      test: "running secure profile isolates the private-key descriptor from runner, app, Playwright, and Chromium",
    },
  },
  {
    id: "AUTH-028",
    subsystem: "auth-public",
    area: "unauthenticated access to /app",
    title: "unauthenticated access to /app redirects to login",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/slides-smoke.spec.ts",
      "docs/security/access-and-sharing.md",
    ],
    tags: ["anonymous", "protected-route", "login-redirect"],
    automation: {
      spec: "e2e/presentation/slides-smoke.spec.ts",
      test: "unauthenticated access to /app redirects to login",
    },
  },
  {
    id: "DOC-EDIT-020",
    subsystem: "document-editor",
    area: "owner document editor",
    title:
      "owner document editor renders the body surface and slide entry point",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/ui-matrix/document-editor-ui.spec.ts",
      "docs/editor/document-editor.md",
    ],
    tags: ["seeded-owner", "document-body", "slide-entry"],
    automation: {
      spec: "e2e/ui-matrix/document-editor-ui.spec.ts",
      test: "owner document editor renders the body surface and slide entry point",
    },
  },
  {
    id: "DOC-EDIT-021",
    subsystem: "document-editor",
    area: "selected text",
    title:
      "selected text exposes a keyboard-operable formatting toolbar and restores editor focus",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/ui-matrix/document-editor-ui.spec.ts",
      "docs/editor/document-editor.md",
    ],
    tags: ["seeded-owner", "keyboard", "formatting-toolbar"],
    automation: {
      spec: "e2e/ui-matrix/document-editor-ui.spec.ts",
      test: "selected text exposes a keyboard-operable formatting toolbar and restores editor focus",
    },
  },
  {
    id: "DOC-EDIT-022",
    subsystem: "document-editor",
    area: "slash insert filtering",
    title:
      "slash insert filtering supports keyboard navigation and Escape dismissal",
    status: "automated",
    priority: "P1",
    refs: [
      "e2e/ui-matrix/document-editor-ui.spec.ts",
      "docs/editor/document-editor.md",
    ],
    tags: ["seeded-owner", "keyboard", "insert-menu"],
    automation: {
      spec: "e2e/ui-matrix/document-editor-ui.spec.ts",
      test: "slash insert filtering supports keyboard navigation and Escape dismissal",
    },
  },
  {
    id: "DOC-EDIT-023",
    subsystem: "document-editor",
    area: "visual editing",
    title:
      "visual editing transfers keyboard focus into its tools and restores the preview on Escape",
    status: "automated",
    priority: "P1",
    refs: [
      "e2e/ui-matrix/document-editor-ui.spec.ts",
      "docs/editor/document-editor.md",
    ],
    tags: ["seeded-owner", "keyboard", "visual-controls"],
    automation: {
      spec: "e2e/ui-matrix/document-editor-ui.spec.ts",
      test: "visual editing transfers keyboard focus into its tools and restores the preview on Escape",
    },
  },
  {
    id: "DOC-EDIT-024",
    subsystem: "document-editor",
    area: "table controls",
    title:
      "table controls mutate structure and require confirmation before deletion",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/ui-matrix/document-editor-ui.spec.ts",
      "docs/editor/document-editor.md",
    ],
    tags: ["seeded-owner", "table-editing", "confirmation"],
    automation: {
      spec: "e2e/ui-matrix/document-editor-ui.spec.ts",
      test: "table controls mutate structure and require confirmation before deletion",
    },
  },
  {
    id: "DOC-EDIT-025",
    subsystem: "document-editor",
    area: "open slide editor link",
    title: "open slide editor link reaches the canonical presentation route",
    status: "automated",
    priority: "P1",
    refs: [
      "e2e/ui-matrix/document-editor-ui.spec.ts",
      "docs/editor/document-editor.md",
    ],
    tags: ["seeded-owner", "presentation-navigation", "canonical-route"],
    automation: {
      spec: "e2e/ui-matrix/document-editor-ui.spec.ts",
      test: "open slide editor link reaches the canonical presentation route",
    },
  },
  {
    id: "DOC-EDIT-026",
    subsystem: "document-editor",
    area: "viewer",
    title: "viewer sees a read-only document with edit-only controls removed",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/ui-matrix/document-editor-ui.spec.ts",
      "docs/editor/document-editor.md",
    ],
    tags: ["seeded-viewer", "read-only", "authorization"],
    automation: {
      spec: "e2e/ui-matrix/document-editor-ui.spec.ts",
      test: "viewer sees a read-only document with edit-only controls removed",
    },
  },
  {
    id: "DOC-EDIT-027",
    subsystem: "document-editor",
    area: "selected text",
    title:
      "selected text uses the mobile editing sheet, keeps its color picker above the sheet, and restores its trigger on Escape",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/ui-matrix/document-editor-ui.spec.ts",
      "docs/editor/document-editor.md",
    ],
    tags: ["seeded-owner", "mobile", "nested-overlay"],
    automation: {
      spec: "e2e/ui-matrix/document-editor-ui.spec.ts",
      test: "selected text uses the mobile editing sheet, keeps its color picker above the sheet, and restores its trigger on Escape",
    },
  },
  {
    id: "DOC-EDIT-028",
    subsystem: "document-editor",
    area: "owner and viewer",
    title:
      "owner and viewer recover comment failure and complete the persisted lifecycle",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/ui-matrix/document-comments-lifecycle-ui.spec.ts",
      "docs/editor/comments-and-anchors.md",
    ],
    tags: ["owner-viewer", "comments", "failure-recovery"],
    automation: {
      spec: "e2e/ui-matrix/document-comments-lifecycle-ui.spec.ts",
      test: "owner and viewer recover comment failure and complete the persisted lifecycle",
    },
  },
  {
    id: "DOC-EDIT-029",
    subsystem: "document-editor",
    area: "tag and restore failures",
    title:
      "tag and restore failures recover once before persistence and reversible reload",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/ui-matrix/document-metadata-history-ui.spec.ts",
      "docs/editor/document-editor.md",
    ],
    tags: ["seeded-owner", "tags", "version-restore"],
    automation: {
      spec: "e2e/ui-matrix/document-metadata-history-ui.spec.ts",
      test: "tag and restore failures recover once before persistence and reversible reload",
    },
  },
  {
    id: "DOC-EDIT-030",
    subsystem: "document-editor",
    area: "block bids",
    title: "block bids survive edit, autosave, and reload",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/editor/block-id-preservation.spec.ts",
      "docs/editor/document-editor.md",
    ],
    tags: ["seeded-owner", "block-id", "autosave"],
    automation: {
      spec: "e2e/editor/block-id-preservation.spec.ts",
      test: "block bids survive edit, autosave, and reload",
    },
  },
  {
    id: "DOC-EDIT-031",
    subsystem: "document-editor",
    area: "inserted document source",
    title: "inserted document source persists the originating block bid",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/editor/block-id-preservation.spec.ts",
      "docs/editor/document-editor.md",
    ],
    tags: ["seeded-owner", "source-insertion", "block-id"],
    automation: {
      spec: "e2e/editor/block-id-preservation.spec.ts",
      test: "inserted document source persists the originating block bid",
    },
  },
  {
    id: "DOC-EDIT-032",
    subsystem: "document-editor",
    area: "duplicate document",
    title:
      "duplicate document gets independent block ids and remapped source refs",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/editor/block-id-preservation.spec.ts",
      "docs/editor/document-editor.md",
    ],
    tags: ["seeded-owner", "document-duplication", "source-remapping"],
    automation: {
      spec: "e2e/editor/block-id-preservation.spec.ts",
      test: "duplicate document gets independent block ids and remapped source refs",
    },
  },
  {
    id: "DOC-EDIT-033",
    subsystem: "document-editor",
    area: "sustained document and table edits",
    title:
      "sustained document and table edits persist after saved state and reload",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/editor/document-table-autosave.spec.ts",
      "docs/editor/document-editor.md",
    ],
    tags: ["seeded-owner", "table-editing", "autosave"],
    automation: {
      spec: "e2e/editor/document-table-autosave.spec.ts",
      test: "sustained document and table edits persist after saved state and reload",
    },
  },
  {
    id: "DOC-EDIT-034",
    subsystem: "document-editor",
    area: "seeded document editor",
    title: "opens the seeded document editor with deterministic content",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/editor/document-editor-profile.spec.ts",
      "docs/editor/document-editor.md",
    ],
    tags: ["seeded-owner", "body-hydration", "document-statistics"],
    automation: {
      spec: "e2e/editor/document-editor-profile.spec.ts",
      test: "opens the seeded document editor with deterministic content",
    },
  },
  {
    id: "DOC-EDIT-035",
    subsystem: "document-editor",
    area: "reload and browser back-forward navigation",
    title:
      "document editor survives reload and browser back-forward navigation",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/editor/document-editor-profile.spec.ts",
      "docs/editor/document-editor.md",
    ],
    tags: ["seeded-owner", "reload", "browser-history"],
    automation: {
      spec: "e2e/editor/document-editor-profile.spec.ts",
      test: "document editor survives reload and browser back-forward navigation",
    },
  },
  {
    id: "DOC-EDIT-036",
    subsystem: "document-editor",
    area: "non-mutating panels",
    title: "editor chrome exposes non-mutating panels and share metadata",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/editor/document-editor-profile.spec.ts",
      "docs/editor/document-editor.md",
    ],
    tags: ["seeded-owner", "style-history", "share-metadata"],
    automation: {
      spec: "e2e/editor/document-editor-profile.spec.ts",
      test: "editor chrome exposes non-mutating panels and share metadata",
    },
  },
  {
    id: "DOC-EDIT-037",
    subsystem: "document-editor",
    area: "import and export controls",
    title:
      "editor import and export controls expose non-destructive menu states",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/editor/document-editor-profile.spec.ts",
      "docs/editor/document-editor.md",
    ],
    tags: ["seeded-owner", "import-focus", "export-menu"],
    automation: {
      spec: "e2e/editor/document-editor-profile.spec.ts",
      test: "editor import and export controls expose non-destructive menu states",
    },
  },
  {
    id: "DOC-EDIT-038",
    subsystem: "document-editor",
    area: "read-only mode",
    title:
      "viewer can open the seeded document in read-only mode without owner controls",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/editor/document-editor-profile.spec.ts",
      "docs/editor/document-editor.md",
    ],
    tags: ["seeded-viewer", "read-only", "control-suppression"],
    automation: {
      spec: "e2e/editor/document-editor-profile.spec.ts",
      test: "viewer can open the seeded document in read-only mode without owner controls",
    },
  },
  {
    id: "DOC-EDIT-039",
    subsystem: "document-editor",
    area: "autosave status live region",
    title:
      "editor autosave status live region is present and reports a known save state",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/editor/document-editor-profile.spec.ts",
      "docs/editor/document-editor.md",
    ],
    tags: ["seeded-owner", "autosave", "live-region"],
    automation: {
      spec: "e2e/editor/document-editor-profile.spec.ts",
      test: "editor autosave status live region is present and reports a known save state",
    },
  },
  {
    id: "DOC-EDIT-040",
    subsystem: "document-editor",
    area: "copy and regenerate link controls",
    title:
      "share dialog exposes copy and regenerate link controls alongside share metadata",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/editor/document-editor-profile.spec.ts",
      "docs/editor/document-editor.md",
    ],
    tags: ["seeded-owner", "share-link", "rotation"],
    automation: {
      spec: "e2e/editor/document-editor-profile.spec.ts",
      test: "share dialog exposes copy and regenerate link controls alongside share metadata",
    },
  },
  {
    id: "DOC-EDIT-041",
    subsystem: "document-editor",
    area: "mobile editor chrome",
    title:
      "mobile editor chrome keeps key slide and collaboration actions reachable",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/editor/document-editor-profile.spec.ts",
      "docs/editor/document-editor.md",
    ],
    tags: ["seeded-owner", "mobile", "action-reachability"],
    automation: {
      spec: "e2e/editor/document-editor-profile.spec.ts",
      test: "mobile editor chrome keeps key slide and collaboration actions reachable",
    },
  },
  {
    id: "DOC-EDIT-042",
    subsystem: "document-editor",
    area: "document editor route",
    title: "app document editor route does not return a server error",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/slides-smoke.spec.ts",
      "docs/editor/document-editor.md",
    ],
    tags: ["anonymous", "unknown-document", "graceful-response"],
    automation: {
      spec: "e2e/presentation/slides-smoke.spec.ts",
      test: "app document editor route does not return a server error",
    },
  },
  {
    id: "PRES-EDIT-059",
    subsystem: "presentation-editor",
    area: "canonical slide editor route",
    title:
      "canonical slide editor route renders shell, stage, and deck actions",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/ui-matrix/presentation-ui.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "editor-shell", "deck-actions"],
    automation: {
      spec: "e2e/ui-matrix/presentation-ui.spec.ts",
      test: "canonical slide editor route renders shell, stage, and deck actions",
    },
  },
  {
    id: "PRES-EDIT-060",
    subsystem: "presentation-editor",
    area: "command palette",
    title: "command palette filters and runs insert and panel commands",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/ui-matrix/presentation-ui.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "keyboard", "commands"],
    automation: {
      spec: "e2e/ui-matrix/presentation-ui.spec.ts",
      test: "command palette filters and runs insert and panel commands",
    },
  },
  {
    id: "PRES-EDIT-061",
    subsystem: "presentation-editor",
    area: "filmstrip",
    title: "filmstrip exposes both seeded slides and their controls",
    status: "automated",
    priority: "P1",
    refs: [
      "e2e/ui-matrix/presentation-ui.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "filmstrip", "slide-controls"],
    automation: {
      spec: "e2e/ui-matrix/presentation-ui.spec.ts",
      test: "filmstrip exposes both seeded slides and their controls",
    },
  },
  {
    id: "PRES-EDIT-062",
    subsystem: "presentation-editor",
    area: "bottom dock zoom controls",
    title:
      "bottom dock zoom controls change canvas geometry without entering deck history",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/ui-matrix/presentation-ui.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "zoom", "history-isolation"],
    automation: {
      spec: "e2e/ui-matrix/presentation-ui.spec.ts",
      test: "bottom dock zoom controls change canvas geometry without entering deck history",
    },
  },
  {
    id: "PRES-EDIT-063",
    subsystem: "presentation-editor",
    area: "Chromium touch taps",
    title:
      "Chromium touch taps select text and navigate the mobile text inspector",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/touch-controls.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "touch", "mobile-inspector"],
    automation: {
      spec: "e2e/presentation/touch-controls.spec.ts",
      test: "Chromium touch taps select text and navigate the mobile text inspector",
    },
  },
  {
    id: "PRES-EDIT-064",
    subsystem: "presentation-editor",
    area: "reorders, persists, cycles",
    title:
      "reorders, persists, cycles, groups, filters locked layers, edits, deletes, and matches Layers",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/overlap-selection-regression.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "overlap-selection", "layers"],
    automation: {
      spec: "e2e/presentation/overlap-selection-regression.spec.ts",
      test: "reorders, persists, cycles, groups, filters locked layers, edits, deletes, and matches Layers",
    },
  },
  {
    id: "PRES-EDIT-065",
    subsystem: "presentation-editor",
    area: "filmstrip pointer drag",
    title:
      "filmstrip pointer drag reorders slides and persists without a post-drag click rollback",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/pointer-interactions.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "pointer-drag", "filmstrip"],
    automation: {
      spec: "e2e/presentation/pointer-interactions.spec.ts",
      test: "filmstrip pointer drag reorders slides and persists without a post-drag click rollback",
    },
  },
  {
    id: "PRES-EDIT-066",
    subsystem: "presentation-editor",
    area: "resize and rotation handles",
    title:
      "resize and rotation handles update geometry, undo, and persist committed pointer changes",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/pointer-interactions.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "resize", "rotation"],
    automation: {
      spec: "e2e/presentation/pointer-interactions.spec.ts",
      test: "resize and rotation handles update geometry, undo, and persist committed pointer changes",
    },
  },
  {
    id: "PRES-EDIT-067",
    subsystem: "presentation-editor",
    area: "connector endpoint pointer drag",
    title:
      "connector endpoint pointer drag snaps to a node and persists the binding",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/pointer-interactions.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "connector", "binding"],
    automation: {
      spec: "e2e/presentation/pointer-interactions.spec.ts",
      test: "connector endpoint pointer drag snaps to a node and persists the binding",
    },
  },
  {
    id: "PRES-EDIT-126",
    subsystem: "presentation-editor",
    area: "connector endpoint keyboard editing",
    title:
      "keyboard connector endpoint editing free-draws both ends and persists",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/pointer-interactions.spec.ts",
      "docs/system/slide-canvas-keyboard-accessibility.md",
    ],
    tags: ["seeded-owner", "keyboard", "connector", "accessibility"],
    automation: {
      spec: "e2e/presentation/pointer-interactions.spec.ts",
      test: "keyboard connector endpoint editing free-draws both ends and persists",
    },
  },
  {
    id: "PRES-EDIT-068",
    subsystem: "presentation-editor",
    area: "image crop handles",
    title:
      "image crop handles, inspector values, history, reset, and reload stay in sync",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/pointer-interactions.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "image-crop", "history"],
    automation: {
      spec: "e2e/presentation/pointer-interactions.spec.ts",
      test: "image crop handles, inspector values, history, reset, and reload stay in sync",
    },
  },
  {
    id: "PRES-EDIT-069",
    subsystem: "presentation-editor",
    area: "owner fetches protected bytes",
    title:
      "owner fetches protected bytes; anonymous denied for private, allowed for shared",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/slide-asset-upload.spec.ts",
      "docs/presentation/assets.md",
    ],
    tags: ["asset-authorization", "anonymous-public", "required-profile"],
    automation: {
      spec: "e2e/presentation/slide-asset-upload.spec.ts",
      test: "owner fetches protected bytes; anonymous denied for private, allowed for shared",
    },
  },
  {
    id: "PRES-EDIT-070",
    subsystem: "presentation-editor",
    area: "an unrelated authenticated user",
    title: "an unrelated authenticated user is denied the private asset",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/slide-asset-upload.spec.ts",
      "docs/presentation/assets.md",
    ],
    tags: ["asset-authorization", "cross-account", "private-asset"],
    automation: {
      spec: "e2e/presentation/slide-asset-upload.spec.ts",
      test: "an unrelated authenticated user is denied the private asset",
    },
  },
  {
    id: "PRES-EDIT-071",
    subsystem: "presentation-editor",
    area: "uploads via the inspector",
    title:
      "uploads via the inspector and the reloaded slide resolves the protected asset",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/slide-asset-upload.spec.ts",
      "docs/presentation/assets.md",
    ],
    tags: ["seeded-owner", "image-upload", "required-profile"],
    automation: {
      spec: "e2e/presentation/slide-asset-upload.spec.ts",
      test: "uploads via the inspector and the reloaded slide resolves the protected asset",
    },
  },
  {
    id: "PRES-EDIT-072",
    subsystem: "presentation-editor",
    area: "canonical seeded deck delete",
    title:
      "canonical seeded deck delete autosaves and survives a direct slides-route reload",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/slide-delete-persistence.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "slide-delete", "autosave"],
    automation: {
      spec: "e2e/presentation/slide-delete-persistence.spec.ts",
      test: "canonical seeded deck delete autosaves and survives a direct slides-route reload",
    },
  },
  {
    id: "PRES-EDIT-073",
    subsystem: "presentation-editor",
    area: "generated first-save deck delete",
    title:
      "generated first-save deck delete rotates its null token and survives reload",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/slide-delete-persistence.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "first-save", "revision-token"],
    automation: {
      spec: "e2e/presentation/slide-delete-persistence.spec.ts",
      test: "generated first-save deck delete rotates its null token and survives reload",
    },
  },
  {
    id: "PRES-EDIT-074",
    subsystem: "presentation-editor",
    area: "multi-select Arrange",
    title:
      "multi-select Arrange distributes three named nodes with undo, redo, and persistence",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/presentation-controls.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["multi-select", "arrange", "history"],
    automation: {
      spec: "e2e/presentation/presentation-controls.spec.ts",
      test: "multi-select Arrange distributes three named nodes with undo, redo, and persistence",
    },
  },
  {
    id: "PRES-EDIT-075",
    subsystem: "presentation-editor",
    area: "precision guide preferences",
    title:
      "precision guide preferences persist locally and custom guide visibility controls snapping",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/presentation-controls.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["precision-guides", "snapping", "local-persistence"],
    automation: {
      spec: "e2e/presentation/presentation-controls.spec.ts",
      test: "precision guide preferences persist locally and custom guide visibility controls snapping",
    },
  },
  {
    id: "PRES-EDIT-076",
    subsystem: "presentation-editor",
    area: "built-in theme selection",
    title:
      "built-in theme selection preserves geometry and survives undo, redo, and reload",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/presentation-controls.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["built-in-theme", "geometry", "history"],
    automation: {
      spec: "e2e/presentation/presentation-controls.spec.ts",
      test: "built-in theme selection preserves geometry and survives undo, redo, and reload",
    },
  },
  {
    id: "PRES-EDIT-077",
    subsystem: "presentation-editor",
    area: "slide ratio",
    title:
      "slide ratio preserves percent geometry through undo, redo, reload, and public rendering",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/presentation-controls.spec.ts",
      "docs/presentation/rendering-and-export.md",
    ],
    tags: ["slide-ratio", "geometry", "public-parity"],
    automation: {
      spec: "e2e/presentation/presentation-controls.spec.ts",
      test: "slide ratio preserves percent geometry through undo, redo, reload, and public rendering",
    },
  },
  {
    id: "PRES-EDIT-078",
    subsystem: "presentation-editor",
    area: "slide master",
    title:
      "slide master preserves deck defaults and slide overrides through history, reload, and public rendering",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/presentation-controls.spec.ts",
      "docs/presentation/rendering-and-export.md",
    ],
    tags: ["slide-master", "overrides", "public-parity"],
    automation: {
      spec: "e2e/presentation/presentation-controls.spec.ts",
      test: "slide master preserves deck defaults and slide overrides through history, reload, and public rendering",
    },
  },
  {
    id: "PRES-EDIT-079",
    subsystem: "presentation-editor",
    area: "document source review",
    title:
      "document source review refreshes stale content through history, reload, and public rendering",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/presentation-controls.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["source-review", "stale-content", "public-parity"],
    automation: {
      spec: "e2e/presentation/presentation-controls.spec.ts",
      test: "document source review refreshes stale content through history, reload, and public rendering",
    },
  },
  {
    id: "PRES-EDIT-080",
    subsystem: "presentation-editor",
    area: "source review navigation",
    title:
      "source review navigation, dismiss, unlink, and relink actions preserve reversible state",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/presentation-controls.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["source-review", "unlink-relink", "reversible-state"],
    automation: {
      spec: "e2e/presentation/presentation-controls.spec.ts",
      test: "source review navigation, dismiss, unlink, and relink actions preserve reversible state",
    },
  },
  {
    id: "PRES-EDIT-081",
    subsystem: "presentation-editor",
    area: "speaker notes",
    title:
      "speaker notes preserve slide scope through history, reload, and presenter mode",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/presentation-controls.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["speaker-notes", "slide-scope", "presenter-mode"],
    automation: {
      spec: "e2e/presentation/presentation-controls.spec.ts",
      test: "speaker notes preserve slide scope through history, reload, and presenter mode",
    },
  },
  {
    id: "PRES-EDIT-082",
    subsystem: "presentation-editor",
    area: "deck diagnostics review",
    title:
      "deck diagnostics review traps focus, navigates, repairs, and persists an empty state",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/presentation-controls.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["diagnostics", "focus-trap", "repair"],
    automation: {
      spec: "e2e/presentation/presentation-controls.spec.ts",
      test: "deck diagnostics review traps focus, navigates, repairs, and persists an empty state",
    },
  },
  {
    id: "PRES-EDIT-083",
    subsystem: "presentation-editor",
    area: "custom theme authoring",
    title:
      "custom theme authoring saves, re-enters the picker, applies, and persists",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/presentation-controls.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["custom-theme", "picker", "persistence"],
    automation: {
      spec: "e2e/presentation/presentation-controls.spec.ts",
      test: "custom theme authoring saves, re-enters the picker, applies, and persists",
    },
  },
  {
    id: "PRES-EDIT-084",
    subsystem: "presentation-editor",
    area: "latest same-id catalog snapshot",
    title:
      "latest same-id catalog snapshot applies over the active exact version and survives reload",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/presentation-controls.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["theme-catalog", "version-update", "reload"],
    automation: {
      spec: "e2e/presentation/presentation-controls.spec.ts",
      test: "latest same-id catalog snapshot applies over the active exact version and survives reload",
    },
  },
  {
    id: "PRES-EDIT-085",
    subsystem: "presentation-editor",
    area: "theme customization and custom guides",
    title:
      "theme customization and custom guides restore their stable triggers across close paths",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/presentation-controls.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["focus-restoration", "theme-customization", "custom-guides"],
    automation: {
      spec: "e2e/presentation/presentation-controls.spec.ts",
      test: "theme customization and custom guides restore their stable triggers across close paths",
    },
  },
  {
    id: "PRES-EDIT-086",
    subsystem: "presentation-editor",
    area: "creates, persists, nests",
    title:
      "creates, persists, nests, reorders, and recursively ungroups UI-authored groups",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/presentation-controls.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["groups", "nested-groups", "recursive-ungroup"],
    automation: {
      spec: "e2e/presentation/presentation-controls.spec.ts",
      test: "creates, persists, nests, reorders, and recursively ungroups UI-authored groups",
    },
  },
  {
    id: "PRES-EDIT-087",
    subsystem: "presentation-editor",
    area: "slide editor opens",
    title:
      "slide editor opens, exposes controls and insert panels, then closes cleanly",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/editor/document-editor-profile.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "editor-shell", "insert-panels"],
    automation: {
      spec: "e2e/editor/document-editor-profile.spec.ts",
      test: "slide editor opens, exposes controls and insert panels, then closes cleanly",
    },
  },
  {
    id: "PRES-EDIT-088",
    subsystem: "presentation-editor",
    area: "slide rail duplicate, delete, and reorder actions",
    title:
      "slide rail duplicate, delete, and reorder actions mutate deck state and persist after reload",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/editor/document-editor-profile.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "slide-rail", "reload-persistence"],
    automation: {
      spec: "e2e/editor/document-editor-profile.spec.ts",
      test: "slide rail duplicate, delete, and reorder actions mutate deck state and persist after reload",
    },
  },
  {
    id: "PRES-EDIT-089",
    subsystem: "presentation-editor",
    area: "rapid slide edit and delete",
    title:
      "rapid slide edit and delete cannot race Save now or regeneration into stale rollback",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/editor/document-editor-profile.spec.ts",
      "docs/presentation/autosave-and-commands.md",
    ],
    tags: ["seeded-owner", "save-race", "regeneration"],
    automation: {
      spec: "e2e/editor/document-editor-profile.spec.ts",
      test: "rapid slide edit and delete cannot race Save now or regeneration into stale rollback",
    },
  },
  {
    id: "PRES-EDIT-090",
    subsystem: "presentation-editor",
    area: "create-edit-save-reopen-export-share roundtrip",
    title:
      "deckpresentation create-edit-save-reopen-export-share roundtrip stays deterministic",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/editor/document-editor-profile.spec.ts",
      "docs/presentation/rendering-and-export.md",
    ],
    tags: ["seeded-owner", "anonymous-public", "roundtrip"],
    automation: {
      spec: "e2e/editor/document-editor-profile.spec.ts",
      test: "deckpresentation create-edit-save-reopen-export-share roundtrip stays deterministic",
    },
  },
  {
    id: "PRES-EDIT-091",
    subsystem: "presentation-editor",
    area: "undo and redo",
    title:
      "slide editor undo and redo keep deck state, autosave status, and focus coherent",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/editor/document-editor-profile.spec.ts",
      "docs/presentation/autosave-and-commands.md",
    ],
    tags: ["seeded-owner", "history", "focus-restoration"],
    automation: {
      spec: "e2e/editor/document-editor-profile.spec.ts",
      test: "slide editor undo and redo keep deck state, autosave status, and focus coherent",
    },
  },
  {
    id: "PRES-EDIT-092",
    subsystem: "presentation-editor",
    area: "context toolbar Escape",
    title: "context toolbar Escape restores focus to the selected stage target",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/editor/document-editor-profile.spec.ts",
      "docs/presentation/slide-stage-interactions.md",
    ],
    tags: ["seeded-owner", "keyboard", "focus-restoration"],
    automation: {
      spec: "e2e/editor/document-editor-profile.spec.ts",
      test: "context toolbar Escape restores focus to the selected stage target",
    },
  },
  {
    id: "PRES-EDIT-093",
    subsystem: "presentation-editor",
    area: "bottom dock",
    title:
      "slide editor bottom dock stays compact and keyboard reachable across viewports",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/editor/document-editor-profile.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "responsive", "keyboard"],
    automation: {
      spec: "e2e/editor/document-editor-profile.spec.ts",
      test: "slide editor bottom dock stays compact and keyboard reachable across viewports",
    },
  },
  {
    id: "PRES-EDIT-094",
    subsystem: "presentation-editor",
    area: "shortcut help",
    title:
      "shortcut help restores the current opener across Escape, Close, and reopen cycles",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/focus-and-mobile-controls-regression.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "focus-restoration", "shortcut-dialog"],
    automation: {
      spec: "e2e/presentation/focus-and-mobile-controls-regression.spec.ts",
      test: "shortcut help restores the current opener across Escape, Close, and reopen cycles",
    },
  },
  {
    id: "PRES-EDIT-095",
    subsystem: "presentation-editor",
    area: "full slide editor",
    title:
      "closing the full slide editor restores focus to the document toolbar opener",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/focus-and-mobile-controls-regression.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "route-close", "focus-restoration"],
    automation: {
      spec: "e2e/presentation/focus-and-mobile-controls-regression.spec.ts",
      test: "closing the full slide editor restores focus to the document toolbar opener",
    },
  },
  {
    id: "PRES-EDIT-096",
    subsystem: "presentation-editor",
    area: "forced-colors",
    title: "forced-colors keeps the focused stage node visibly outlined",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/focus-and-mobile-controls-regression.spec.ts",
      "docs/system/slide-canvas-keyboard-accessibility.md",
    ],
    tags: ["seeded-owner", "forced-colors", "focus-indicator"],
    automation: {
      spec: "e2e/presentation/focus-and-mobile-controls-regression.spec.ts",
      test: "forced-colors keeps the focused stage node visibly outlined",
    },
  },
  {
    id: "PRES-EDIT-097",
    subsystem: "presentation-editor",
    area: "mobile width",
    title:
      "responsive inspector sheet stays above the filmstrip and bottom dock at mobile width",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/focus-and-mobile-controls-regression.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "mobile", "inspector-stacking"],
    automation: {
      spec: "e2e/presentation/focus-and-mobile-controls-regression.spec.ts",
      test: "responsive inspector sheet stays above the filmstrip and bottom dock at mobile width",
    },
  },
  {
    id: "PRES-EDIT-098",
    subsystem: "presentation-editor",
    area: "tablet width",
    title:
      "responsive inspector sheet stays above the filmstrip and bottom dock at tablet width",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/focus-and-mobile-controls-regression.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "tablet", "inspector-stacking"],
    automation: {
      spec: "e2e/presentation/focus-and-mobile-controls-regression.spec.ts",
      test: "responsive inspector sheet stays above the filmstrip and bottom dock at tablet width",
    },
  },
  {
    id: "PRES-EDIT-099",
    subsystem: "presentation-editor",
    area: "390x844",
    title:
      "mobile Edit slide and Add slide controls stay independently actionable at 390x844",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/focus-and-mobile-controls-regression.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "mobile", "hit-testing"],
    automation: {
      spec: "e2e/presentation/focus-and-mobile-controls-regression.spec.ts",
      test: "mobile Edit slide and Add slide controls stay independently actionable at 390x844",
    },
  },
  {
    id: "PRES-EDIT-100",
    subsystem: "presentation-editor",
    area: "412x915",
    title:
      "mobile Edit slide and Add slide controls stay independently actionable at 412x915",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/focus-and-mobile-controls-regression.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "mobile", "hit-testing"],
    automation: {
      spec: "e2e/presentation/focus-and-mobile-controls-regression.spec.ts",
      test: "mobile Edit slide and Add slide controls stay independently actionable at 412x915",
    },
  },
  {
    id: "PRES-EDIT-101",
    subsystem: "presentation-editor",
    area: "desktop",
    title:
      "desktop keeps Add slide actionable without rendering the mobile Edit slide control",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/focus-and-mobile-controls-regression.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "desktop", "control-suppression"],
    automation: {
      spec: "e2e/presentation/focus-and-mobile-controls-regression.spec.ts",
      test: "desktop keeps Add slide actionable without rendering the mobile Edit slide control",
    },
  },
  {
    id: "PRES-EDIT-102",
    subsystem: "presentation-editor",
    area: "navigate to the Slides editor",
    title: "authenticated user can navigate to the Slides editor",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/slides-smoke.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "document-entry", "canonical-route"],
    automation: {
      spec: "e2e/presentation/slides-smoke.spec.ts",
      test: "authenticated user can navigate to the Slides editor",
    },
  },
  {
    id: "PRES-EDIT-103",
    subsystem: "presentation-editor",
    area: "edit a slide title",
    title: "edit a slide title, save, and reload to verify persistence",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/slides-smoke.spec.ts",
      "docs/presentation/autosave-and-commands.md",
    ],
    tags: ["seeded-owner", "inline-edit", "reload-persistence"],
    automation: {
      spec: "e2e/presentation/slides-smoke.spec.ts",
      test: "edit a slide title, save, and reload to verify persistence",
    },
  },
  {
    id: "PRES-EDIT-104",
    subsystem: "presentation-editor",
    area: "inline selection formatting",
    title:
      "inline selection formatting stays in edit mode and survives history and reload",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/slides-smoke.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "rich-text", "history-reload"],
    automation: {
      spec: "e2e/presentation/slides-smoke.spec.ts",
      test: "inline selection formatting stays in edit mode and survives history and reload",
    },
  },
  {
    id: "PRES-EDIT-105",
    subsystem: "presentation-editor",
    area: "inline list conversion and indentation",
    title:
      "inline list conversion and indentation stay editable through history and reload",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/slides-smoke.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "inline-lists", "history-reload"],
    automation: {
      spec: "e2e/presentation/slides-smoke.spec.ts",
      test: "inline list conversion and indentation stay editable through history and reload",
    },
  },
  {
    id: "PRES-EDIT-106",
    subsystem: "presentation-editor",
    area: "table cells and structure",
    title:
      "table cells and structure stay keyboard-editable through history and reload",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/slides-smoke.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "table-editing", "keyboard-history"],
    automation: {
      spec: "e2e/presentation/slides-smoke.spec.ts",
      test: "table cells and structure stay keyboard-editable through history and reload",
    },
  },
  {
    id: "PRES-EDIT-107",
    subsystem: "presentation-editor",
    area: "export menu or dialog",
    title: "export menu or dialog is reachable from the Slides editor",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/slides-smoke.spec.ts",
      "docs/presentation/rendering-and-export.md",
    ],
    tags: ["seeded-owner", "export-menu", "accessible-actions"],
    automation: {
      spec: "e2e/presentation/slides-smoke.spec.ts",
      test: "export menu or dialog is reachable from the Slides editor",
    },
  },
  {
    id: "PRES-EDIT-108",
    subsystem: "presentation-editor",
    area: "stage keyboard traversal",
    title:
      "presentation stage keyboard traversal, resize shortcuts, and live announcements are behavioral",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/slides-smoke.spec.ts",
      "docs/system/slide-canvas-keyboard-accessibility.md",
    ],
    tags: ["seeded-owner", "keyboard-resize", "live-announcements"],
    automation: {
      spec: "e2e/presentation/slides-smoke.spec.ts",
      test: "presentation stage keyboard traversal, resize shortcuts, and live announcements are behavioral",
    },
  },
  {
    id: "PRES-EDIT-109",
    subsystem: "presentation-editor",
    area: "toolbar controls",
    title: "slide editor toolbar controls are reachable by accessible role",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/slides-smoke.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "toolbar", "accessible-role"],
    automation: {
      spec: "e2e/presentation/slides-smoke.spec.ts",
      test: "slide editor toolbar controls are reachable by accessible role",
    },
  },
  {
    id: "PRES-EDIT-110",
    subsystem: "presentation-editor",
    area: "add slide template picker",
    title:
      "add slide template picker traps focus and supports keyboard insertion",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/slides-smoke.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "focus-trap", "keyboard-insertion"],
    automation: {
      spec: "e2e/presentation/slides-smoke.spec.ts",
      test: "add slide template picker traps focus and supports keyboard insertion",
    },
  },
  {
    id: "PRES-EDIT-111",
    subsystem: "presentation-editor",
    area: "visual picker modal",
    title:
      "presentation visual picker modal traps focus and restores invoking focus",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/slides-smoke.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "visual-picker", "focus-restoration"],
    automation: {
      spec: "e2e/presentation/slides-smoke.spec.ts",
      test: "presentation visual picker modal traps focus and restores invoking focus",
    },
  },
  {
    id: "PRES-EDIT-112",
    subsystem: "presentation-editor",
    area: "Keep my version",
    title:
      "Keep my version overwrites the newer server deck and persists on reload",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/slides-conflict-recovery.spec.ts",
      "docs/presentation/autosave-and-commands.md",
    ],
    tags: ["two-session", "cas-conflict", "keep-mine"],
    automation: {
      spec: "e2e/presentation/slides-conflict-recovery.spec.ts",
      test: "Keep my version overwrites the newer server deck and persists on reload",
    },
  },
  {
    id: "PRES-EDIT-113",
    subsystem: "presentation-editor",
    area: "Use server version",
    title:
      "Use server version discards stale local edits, clears history, and persists on reload",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/slides-conflict-recovery.spec.ts",
      "docs/presentation/autosave-and-commands.md",
    ],
    tags: ["two-session", "cas-conflict", "server-version"],
    automation: {
      spec: "e2e/presentation/slides-conflict-recovery.spec.ts",
      test: "Use server version discards stale local edits, clears history, and persists on reload",
    },
  },
  {
    id: "PRES-EDIT-114",
    subsystem: "presentation-editor",
    area: "base editor layout",
    title: "base editor layout (desktop)",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/slides-layout-screenshots.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "desktop", "base-layout"],
    automation: {
      spec: "e2e/presentation/slides-layout-screenshots.spec.ts",
      test: "base editor layout (desktop)",
    },
  },
  {
    id: "PRES-EDIT-115",
    subsystem: "presentation-editor",
    area: "rail hidden",
    title: "rail hidden (desktop)",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/slides-layout-screenshots.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "desktop", "filmstrip-toggle"],
    automation: {
      spec: "e2e/presentation/slides-layout-screenshots.spec.ts",
      test: "rail hidden (desktop)",
    },
  },
  {
    id: "PRES-EDIT-116",
    subsystem: "presentation-editor",
    area: "notes expanded",
    title: "notes expanded (desktop)",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/slides-layout-screenshots.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "desktop", "speaker-notes"],
    automation: {
      spec: "e2e/presentation/slides-layout-screenshots.spec.ts",
      test: "notes expanded (desktop)",
    },
  },
  {
    id: "PRES-EDIT-117",
    subsystem: "presentation-editor",
    area: "right panel open with selection",
    title: "right panel open with selection (desktop)",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/slides-layout-screenshots.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "desktop", "text-inspector"],
    automation: {
      spec: "e2e/presentation/slides-layout-screenshots.spec.ts",
      test: "right panel open with selection (desktop)",
    },
  },
  {
    id: "PRES-EDIT-118",
    subsystem: "presentation-editor",
    area: "base editor layout",
    title: "base editor layout (tablet)",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/slides-layout-screenshots.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "tablet", "base-layout"],
    automation: {
      spec: "e2e/presentation/slides-layout-screenshots.spec.ts",
      test: "base editor layout (tablet)",
    },
  },
  {
    id: "PRES-EDIT-119",
    subsystem: "presentation-editor",
    area: "rail hidden",
    title: "rail hidden (tablet)",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/slides-layout-screenshots.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "tablet", "filmstrip-toggle"],
    automation: {
      spec: "e2e/presentation/slides-layout-screenshots.spec.ts",
      test: "rail hidden (tablet)",
    },
  },
  {
    id: "PRES-EDIT-120",
    subsystem: "presentation-editor",
    area: "notes expanded",
    title: "notes expanded (tablet)",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/slides-layout-screenshots.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "tablet", "speaker-notes"],
    automation: {
      spec: "e2e/presentation/slides-layout-screenshots.spec.ts",
      test: "notes expanded (tablet)",
    },
  },
  {
    id: "PRES-EDIT-121",
    subsystem: "presentation-editor",
    area: "right panel open with selection",
    title: "right panel open with selection (tablet)",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/slides-layout-screenshots.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "tablet", "text-inspector"],
    automation: {
      spec: "e2e/presentation/slides-layout-screenshots.spec.ts",
      test: "right panel open with selection (tablet)",
    },
  },
  {
    id: "PRES-EDIT-122",
    subsystem: "presentation-editor",
    area: "base editor layout",
    title: "base editor layout (mobile)",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/slides-layout-screenshots.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "mobile", "base-layout"],
    automation: {
      spec: "e2e/presentation/slides-layout-screenshots.spec.ts",
      test: "base editor layout (mobile)",
    },
  },
  {
    id: "PRES-EDIT-123",
    subsystem: "presentation-editor",
    area: "rail hidden",
    title: "rail hidden (mobile)",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/slides-layout-screenshots.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "mobile", "filmstrip-toggle"],
    automation: {
      spec: "e2e/presentation/slides-layout-screenshots.spec.ts",
      test: "rail hidden (mobile)",
    },
  },
  {
    id: "PRES-EDIT-124",
    subsystem: "presentation-editor",
    area: "notes expanded",
    title: "notes expanded (mobile)",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/slides-layout-screenshots.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "mobile", "speaker-notes"],
    automation: {
      spec: "e2e/presentation/slides-layout-screenshots.spec.ts",
      test: "notes expanded (mobile)",
    },
  },
  {
    id: "PRES-EDIT-125",
    subsystem: "presentation-editor",
    area: "right panel open with selection",
    title: "right panel open with selection (mobile)",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/slides-layout-screenshots.spec.ts",
      "docs/presentation/slide-editor.md",
    ],
    tags: ["seeded-owner", "mobile", "text-inspector"],
    automation: {
      spec: "e2e/presentation/slides-layout-screenshots.spec.ts",
      test: "right panel open with selection (mobile)",
    },
  },
  {
    id: "PRES-RENDER-044",
    subsystem: "presentation-render-export",
    area: "public present route",
    title:
      "public present route exposes first-slide content and navigation controls",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/ui-matrix/presentation-ui.spec.ts",
      "docs/presentation/rendering-and-export.md",
    ],
    tags: ["anonymous", "public-present", "navigation"],
    automation: {
      spec: "e2e/ui-matrix/presentation-ui.spec.ts",
      test: "public present route exposes first-slide content and navigation controls",
    },
  },
  {
    id: "PRES-RENDER-045",
    subsystem: "presentation-render-export",
    area: "authenticated present mode",
    title: "authenticated present mode renders the seeded slide text",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/present-export.spec.ts",
      "docs/presentation/rendering-and-export.md",
    ],
    tags: ["seeded-owner", "present-overlay", "asset-loading"],
    automation: {
      spec: "e2e/presentation/present-export.spec.ts",
      test: "authenticated present mode renders the seeded slide text",
    },
  },
  {
    id: "PRES-RENDER-046",
    subsystem: "presentation-render-export",
    area: "presenter controls",
    title:
      "authenticated present mode exposes presenter controls and slide overview navigation",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/present-export.spec.ts",
      "docs/presentation/rendering-and-export.md",
    ],
    tags: ["seeded-owner", "presenter-tools", "slide-overview"],
    automation: {
      spec: "e2e/presentation/present-export.spec.ts",
      test: "authenticated present mode exposes presenter controls and slide overview navigation",
    },
  },
  {
    id: "PRES-RENDER-047",
    subsystem: "presentation-render-export",
    area: "mobile safe areas",
    title:
      "authenticated present mode keeps HUD chrome outside mobile safe areas",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/present-export.spec.ts",
      "docs/presentation/rendering-and-export.md",
    ],
    tags: ["seeded-owner", "mobile", "safe-area-hud"],
    automation: {
      spec: "e2e/presentation/present-export.spec.ts",
      test: "authenticated present mode keeps HUD chrome outside mobile safe areas",
    },
  },
  {
    id: "PRES-RENDER-048",
    subsystem: "presentation-render-export",
    area: "public present mode",
    title: "public present mode renders the seeded deck via the share link",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/present-export.spec.ts",
      "docs/presentation/rendering-and-export.md",
    ],
    tags: ["anonymous", "public-present", "asset-loading"],
    automation: {
      spec: "e2e/presentation/present-export.spec.ts",
      test: "public present mode renders the seeded deck via the share link",
    },
  },
  {
    id: "PRES-RENDER-049",
    subsystem: "presentation-render-export",
    area: "mobile safe areas",
    title: "public present mode keeps HUD chrome outside mobile safe areas",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/present-export.spec.ts",
      "docs/presentation/rendering-and-export.md",
    ],
    tags: ["anonymous", "mobile", "safe-area-hud"],
    automation: {
      spec: "e2e/presentation/present-export.spec.ts",
      test: "public present mode keeps HUD chrome outside mobile safe areas",
    },
  },
  {
    id: "PRES-RENDER-050",
    subsystem: "presentation-render-export",
    area: "deterministic slide navigation",
    title: "public present mode supports deterministic slide navigation",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/present-export.spec.ts",
      "docs/presentation/rendering-and-export.md",
    ],
    tags: ["anonymous", "home-shortcut", "url-hash"],
    automation: {
      spec: "e2e/presentation/present-export.spec.ts",
      test: "public present mode supports deterministic slide navigation",
    },
  },
  {
    id: "PRES-RENDER-051",
    subsystem: "presentation-render-export",
    area: "chrome-free navigation",
    title: "public presentation embed route renders chrome-free navigation",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/present-export.spec.ts",
      "docs/presentation/rendering-and-export.md",
    ],
    tags: ["anonymous", "embed", "chrome-suppression"],
    automation: {
      spec: "e2e/presentation/present-export.spec.ts",
      test: "public presentation embed route renders chrome-free navigation",
    },
  },
  {
    id: "PRES-RENDER-052",
    subsystem: "presentation-render-export",
    area: "keyboard ArrowRight and ArrowLeft navigation",
    title:
      "public present mode supports keyboard ArrowRight and ArrowLeft navigation",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/present-export.spec.ts",
      "docs/presentation/rendering-and-export.md",
    ],
    tags: ["anonymous", "keyboard", "bidirectional-navigation"],
    automation: {
      spec: "e2e/presentation/present-export.spec.ts",
      test: "public present mode supports keyboard ArrowRight and ArrowLeft navigation",
    },
  },
  {
    id: "PRES-RENDER-053",
    subsystem: "presentation-render-export",
    area: "End key",
    title: "public present mode End key navigates to the last slide",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/present-export.spec.ts",
      "docs/presentation/rendering-and-export.md",
    ],
    tags: ["anonymous", "keyboard", "last-slide"],
    automation: {
      spec: "e2e/presentation/present-export.spec.ts",
      test: "public present mode End key navigates to the last slide",
    },
  },
  {
    id: "PRES-RENDER-054",
    subsystem: "presentation-render-export",
    area: "closes overlay on Escape",
    title: "authenticated present mode closes overlay on Escape",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/present-export.spec.ts",
      "docs/presentation/rendering-and-export.md",
    ],
    tags: ["seeded-owner", "keyboard", "overlay-dismissal"],
    automation: {
      spec: "e2e/presentation/present-export.spec.ts",
      test: "authenticated present mode closes overlay on Escape",
    },
  },
  {
    id: "PRES-RENDER-055",
    subsystem: "presentation-render-export",
    area: "viewer user",
    title: "viewer user can open the public presentation link",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/present-export.spec.ts",
      "docs/presentation/rendering-and-export.md",
    ],
    tags: ["seeded-viewer", "public-present", "role-access"],
    automation: {
      spec: "e2e/presentation/present-export.spec.ts",
      test: "viewer user can open the public presentation link",
    },
  },
  {
    id: "PRES-RENDER-056",
    subsystem: "presentation-render-export",
    area: "direct deep-link",
    title:
      "public present direct deep-link to slide 2 renders the second slide",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/present-export.spec.ts",
      "docs/presentation/rendering-and-export.md",
    ],
    tags: ["anonymous", "deep-link", "second-slide"],
    automation: {
      spec: "e2e/presentation/present-export.spec.ts",
      test: "public present direct deep-link to slide 2 renders the second slide",
    },
  },
  {
    id: "PRES-RENDER-057",
    subsystem: "presentation-render-export",
    area: "Previous slide button",
    title:
      "public presentation embed mode Previous slide button returns to first slide",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/present-export.spec.ts",
      "docs/presentation/rendering-and-export.md",
    ],
    tags: ["anonymous", "embed", "previous-navigation"],
    automation: {
      spec: "e2e/presentation/present-export.spec.ts",
      test: "public presentation embed mode Previous slide button returns to first slide",
    },
  },
  {
    id: "PRES-RENDER-058",
    subsystem: "presentation-render-export",
    area: "real PDF file",
    title: "exports a real PDF file with nonzero bytes",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/present-export.spec.ts",
      "docs/presentation/rendering-and-export.md",
    ],
    tags: ["seeded-owner", "pdf", "nonzero-download"],
    automation: {
      spec: "e2e/presentation/present-export.spec.ts",
      test: "exports a real PDF file with nonzero bytes",
    },
  },
  {
    id: "PRES-RENDER-059",
    subsystem: "presentation-render-export",
    area: "infographic PNG and PDF files",
    title: "exports real infographic PNG and PDF files at the selected widths",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/present-export.spec.ts",
      "docs/presentation/rendering-and-export.md",
    ],
    tags: ["seeded-owner", "selected-width", "format-signature"],
    automation: {
      spec: "e2e/presentation/present-export.spec.ts",
      test: "exports real infographic PNG and PDF files at the selected widths",
    },
  },
  {
    id: "PRES-RENDER-060",
    subsystem: "presentation-render-export",
    area: "rasterization failure",
    title: "contains a browser rasterization failure and succeeds on retry",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/present-export.spec.ts",
      "docs/presentation/rendering-and-export.md",
    ],
    tags: ["seeded-owner", "failure-alert", "retry"],
    automation: {
      spec: "e2e/presentation/present-export.spec.ts",
      test: "contains a browser rasterization failure and succeeds on retry",
    },
  },
  {
    id: "PRES-RENDER-061",
    subsystem: "presentation-render-export",
    area: "paid workspace editor",
    title: "a paid workspace editor exports the current document deck as PPTX",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/present-export.spec.ts",
      "docs/presentation/rendering-and-export.md",
    ],
    tags: ["seeded-editor", "pro-plan", "pptx-download"],
    automation: {
      spec: "e2e/presentation/present-export.spec.ts",
      test: "a paid workspace editor exports the current document deck as PPTX",
    },
  },
  {
    id: "PRES-RENDER-062",
    subsystem: "presentation-render-export",
    area: "open present mode",
    title: "authenticated user can open present mode",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/slides-smoke.spec.ts",
      "docs/presentation/rendering-and-export.md",
    ],
    tags: ["seeded-owner", "present-navigation", "document-language"],
    automation: {
      spec: "e2e/presentation/slides-smoke.spec.ts",
      test: "authenticated user can open present mode",
    },
  },
  {
    id: "PUBLIC-018",
    subsystem: "public-render-share",
    area: "share-bound asset lifecycle",
    title:
      "share-bound asset lifecycle follows passcode, expiry, rotation, and disablement",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/ui-matrix/document-sharing-lifecycle-ui.spec.ts",
      "docs/security/access-and-sharing.md",
      "docs/presentation/assets.md",
    ],
    tags: [
      "anonymous",
      "asset-authorization",
      "passcode",
      "expiry",
      "rotation",
      "revocation",
    ],
    automation: {
      spec: "e2e/ui-matrix/document-sharing-lifecycle-ui.spec.ts",
      test: "owner configures, expires, protects, rotates, and disables a public share",
    },
  },
  {
    id: "PUBLIC-021",
    subsystem: "public-render-share",
    area: "valid public present route",
    title: "valid public present route renders seeded slide content",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/ui-matrix/public-render-ui.spec.ts",
      "docs/public-render/README.md",
    ],
    tags: ["anonymous", "public-present", "seeded-content"],
    automation: {
      spec: "e2e/ui-matrix/public-render-ui.spec.ts",
      test: "valid public present route renders seeded slide content",
    },
  },
  {
    id: "PUBLIC-022",
    subsystem: "public-render-share",
    area: "public present keyboard listeners",
    title:
      "public present keyboard listeners release after client-side navigation",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/ui-matrix/public-render-ui.spec.ts",
      "docs/public-render/README.md",
    ],
    tags: ["anonymous", "keyboard", "listener-cleanup"],
    automation: {
      spec: "e2e/ui-matrix/public-render-ui.spec.ts",
      test: "public present keyboard listeners release after client-side navigation",
    },
  },
  {
    id: "PUBLIC-023",
    subsystem: "public-render-share",
    area: "presentation embed route",
    title:
      "presentation embed route suppresses top HUD chrome and renders the first slide",
    status: "automated",
    priority: "P1",
    refs: [
      "e2e/ui-matrix/public-render-ui.spec.ts",
      "docs/public-render/README.md",
    ],
    tags: ["anonymous", "embed", "chrome-free"],
    automation: {
      spec: "e2e/ui-matrix/public-render-ui.spec.ts",
      test: "presentation embed route suppresses top HUD chrome and renders the first slide",
    },
  },
  {
    id: "PUBLIC-024",
    subsystem: "public-render-share",
    area: "unknown share and present routes",
    title:
      "unknown share and present routes return safe 404s without fixture leaks",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/ui-matrix/public-render-ui.spec.ts",
      "docs/public-render/README.md",
    ],
    tags: ["anonymous", "safe-404", "privacy"],
    automation: {
      spec: "e2e/ui-matrix/public-render-ui.spec.ts",
      test: "unknown share and present routes return safe 404s without fixture leaks",
    },
  },
  {
    id: "PUBLIC-025",
    subsystem: "public-render-share",
    area: "share-bound slide assets",
    title:
      "share-bound slide assets require an active present or embed binding",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/ui-matrix/public-render-ui.spec.ts",
      "docs/public-render/README.md",
    ],
    tags: ["anonymous", "asset-authorization", "share-binding"],
    automation: {
      spec: "e2e/ui-matrix/public-render-ui.spec.ts",
      test: "share-bound slide assets require an active present or embed binding",
    },
  },
  {
    id: "PUBLIC-026",
    subsystem: "public-render-share",
    area: "valid public share route",
    title: "valid public share route renders a read-only document surface",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/ui-matrix/public-render-ui.spec.ts",
      "docs/public-render/README.md",
    ],
    tags: ["anonymous", "read-only", "public-share"],
    automation: {
      spec: "e2e/ui-matrix/public-render-ui.spec.ts",
      test: "valid public share route renders a read-only document surface",
    },
  },
  {
    id: "PUBLIC-027",
    subsystem: "public-render-share",
    area: "public share visuals",
    title: "public share visuals expose an accessible lightbox lifecycle",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/ui-matrix/public-render-ui.spec.ts",
      "docs/public-render/README.md",
    ],
    tags: ["anonymous", "mobile", "lightbox-accessibility"],
    automation: {
      spec: "e2e/ui-matrix/public-render-ui.spec.ts",
      test: "public share visuals expose an accessible lightbox lifecycle",
    },
  },
  {
    id: "PUBLIC-028",
    subsystem: "public-render-share",
    area: "owner configures",
    title:
      "owner configures, expires, protects, rotates, and disables a public share",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/ui-matrix/document-sharing-lifecycle-ui.spec.ts",
      "docs/security/access-and-sharing.md",
    ],
    tags: ["seeded-owner", "anonymous-public", "share-lifecycle"],
    automation: {
      spec: "e2e/ui-matrix/document-sharing-lifecycle-ui.spec.ts",
      test: "owner configures, expires, protects, rotates, and disables a public share",
    },
  },
  {
    id: "PUBLIC-029",
    subsystem: "public-render-share",
    area: "unknown and malformed public routes",
    title:
      "unknown and malformed public routes return 404 without leaking fixture content",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/public-render/share-fallback.spec.ts",
      "docs/public-render/README.md",
    ],
    tags: ["anonymous", "request-api", "privacy-404"],
    automation: {
      spec: "e2e/public-render/share-fallback.spec.ts",
      test: "unknown and malformed public routes return 404 without leaking fixture content",
    },
  },
  {
    id: "PUBLIC-030",
    subsystem: "public-render-share",
    area: "unknown /share link",
    title: "unknown /share link renders the not-found fallback",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/public-render/share-fallback.spec.ts",
      "docs/public-render/README.md",
    ],
    tags: ["anonymous", "share-route", "safe-404"],
    automation: {
      spec: "e2e/public-render/share-fallback.spec.ts",
      test: "unknown /share link renders the not-found fallback",
    },
  },
  {
    id: "PUBLIC-031",
    subsystem: "public-render-share",
    area: "unknown /present link",
    title: "unknown /present link renders the not-found fallback",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/public-render/share-fallback.spec.ts",
      "docs/public-render/README.md",
    ],
    tags: ["anonymous", "present-route", "safe-404"],
    automation: {
      spec: "e2e/public-render/share-fallback.spec.ts",
      test: "unknown /present link renders the not-found fallback",
    },
  },
  {
    id: "PUBLIC-032",
    subsystem: "public-render-share",
    area: "unknown /embed link",
    title: "unknown /embed link renders the not-found fallback",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/public-render/share-fallback.spec.ts",
      "docs/public-render/README.md",
    ],
    tags: ["anonymous", "embed-route", "safe-404"],
    automation: {
      spec: "e2e/public-render/share-fallback.spec.ts",
      test: "unknown /embed link renders the not-found fallback",
    },
  },
  {
    id: "PUBLIC-033",
    subsystem: "public-render-share",
    area: "unknown /present/<share>/embed",
    title: "unknown /present/<share>/embed renders the not-found fallback",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/public-render/share-fallback.spec.ts",
      "docs/public-render/README.md",
    ],
    tags: ["anonymous", "present-embed", "safe-404"],
    automation: {
      spec: "e2e/public-render/share-fallback.spec.ts",
      test: "unknown /present/<share>/embed renders the not-found fallback",
    },
  },
  {
    id: "PUBLIC-034",
    subsystem: "public-render-share",
    area: "slug-prefixed unknown share ID",
    title:
      "slug-prefixed unknown share ID resolves to the safe 404 fallback without leaking content",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/public-render/share-fallback.spec.ts",
      "docs/public-render/README.md",
    ],
    tags: ["anonymous", "slug-prefixed", "privacy-404"],
    automation: {
      spec: "e2e/public-render/share-fallback.spec.ts",
      test: "slug-prefixed unknown share ID resolves to the safe 404 fallback without leaking content",
    },
  },
  {
    id: "PUBLIC-035",
    subsystem: "public-render-share",
    area: "malformed share ID",
    title:
      "malformed share ID resolves to the safe 404 fallback without leaking content",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/public-render/share-fallback.spec.ts",
      "docs/public-render/README.md",
    ],
    tags: ["anonymous", "malformed-id", "privacy-404"],
    automation: {
      spec: "e2e/public-render/share-fallback.spec.ts",
      test: "malformed share ID resolves to the safe 404 fallback without leaking content",
    },
  },
  {
    id: "PUBLIC-036",
    subsystem: "public-render-share",
    area: "fallback 404 page",
    title:
      "fallback 404 page does not render document editor or presentation regions",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/public-render/share-fallback.spec.ts",
      "docs/public-render/README.md",
    ],
    tags: ["anonymous", "private-ui-suppression", "safe-404"],
    automation: {
      spec: "e2e/public-render/share-fallback.spec.ts",
      test: "fallback 404 page does not render document editor or presentation regions",
    },
  },
  {
    id: "PUBLIC-037",
    subsystem: "public-render-share",
    area: "unknown present link",
    title: "unknown present link returns 404",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/slides-smoke.spec.ts",
      "docs/public-render/README.md",
    ],
    tags: ["anonymous", "present-route", "safe-404"],
    automation: {
      spec: "e2e/presentation/slides-smoke.spec.ts",
      test: "unknown present link returns 404",
    },
  },
  {
    id: "PUBLIC-038",
    subsystem: "public-render-share",
    area: "unknown /present/<slug>/embed path",
    title: "unknown /present/<slug>/embed path returns 404",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/slides-smoke.spec.ts",
      "docs/public-render/README.md",
    ],
    tags: ["anonymous", "present-embed", "safe-404"],
    automation: {
      spec: "e2e/presentation/slides-smoke.spec.ts",
      test: "unknown /present/<slug>/embed path returns 404",
    },
  },
  {
    id: "PUBLIC-039",
    subsystem: "public-render-share",
    area: "root-layout language",
    title:
      "present-route 404 exposes root-layout language after navigation readiness",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/slides-smoke.spec.ts",
      "docs/public-render/README.md",
    ],
    tags: ["anonymous", "safe-404", "document-language"],
    automation: {
      spec: "e2e/presentation/slides-smoke.spec.ts",
      test: "present-route 404 exposes root-layout language after navigation readiness",
    },
  },
  {
    id: "PUBLIC-041",
    subsystem: "public-render-share",
    area: "expired public routes",
    title:
      "expired public routes return privacy-preserving 404s until the owner clears expiry",
    status: "automated",
    priority: "P1",
    refs: [
      "e2e/ui-matrix/document-sharing-lifecycle-ui.spec.ts",
      "docs/security/access-and-sharing.md",
    ],
    tags: ["anonymous", "expired-link", "privacy-404", "owner-recovery"],
    automation: {
      spec: "e2e/ui-matrix/document-sharing-lifecycle-ui.spec.ts",
      test: "owner configures, expires, protects, rotates, and disables a public share",
    },
  },
  {
    id: "WORKSPACE-021",
    subsystem: "workspace-billing-brand",
    area: "dashboard search and favorite controls",
    title:
      "dashboard search and favorite controls are available for the seeded owner",
    status: "automated",
    priority: "P1",
    refs: [
      "e2e/ui-matrix/workspace-billing-brand-ui.spec.ts",
      "docs/documents/README.md",
    ],
    tags: ["seeded-owner", "dashboard", "search-favorites"],
    automation: {
      spec: "e2e/ui-matrix/workspace-billing-brand-ui.spec.ts",
      test: "dashboard search and favorite controls are available for the seeded owner",
    },
  },
  {
    id: "WORKSPACE-022",
    subsystem: "workspace-billing-brand",
    area: "billing credits panel",
    title: "billing credits panel reflects the sqlite E2E environment gate",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/ui-matrix/workspace-billing-brand-ui.spec.ts",
      "docs/product/billing.md",
    ],
    tags: ["seeded-owner", "billing", "credits"],
    automation: {
      spec: "e2e/ui-matrix/workspace-billing-brand-ui.spec.ts",
      test: "billing credits panel reflects the sqlite E2E environment gate",
    },
  },
  {
    id: "WORKSPACE-023",
    subsystem: "workspace-billing-brand",
    area: "billing upgrades",
    title:
      "billing upgrades, cancellation, downgrade, persistence, and mobile layout work end to end",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/ui-matrix/workspace-billing-brand-ui.spec.ts",
      "docs/product/billing.md",
    ],
    tags: ["isolated-user", "billing-lifecycle", "mobile"],
    automation: {
      spec: "e2e/ui-matrix/workspace-billing-brand-ui.spec.ts",
      test: "billing upgrades, cancellation, downgrade, persistence, and mobile layout work end to end",
    },
  },
  {
    id: "WORKSPACE-024",
    subsystem: "workspace-billing-brand",
    area: "free owner",
    title: "free owner sees the Brand Studio upgrade gate",
    status: "automated",
    priority: "P1",
    refs: [
      "e2e/ui-matrix/workspace-billing-brand-ui.spec.ts",
      "docs/product/brand-studio.md",
    ],
    tags: ["seeded-owner", "free-plan", "brand-gate"],
    automation: {
      spec: "e2e/ui-matrix/workspace-billing-brand-ui.spec.ts",
      test: "free owner sees the Brand Studio upgrade gate",
    },
  },
  {
    id: "WORKSPACE-025",
    subsystem: "workspace-billing-brand",
    area: "Pro editor",
    title: "Pro editor creates, uploads, reloads, edits, and deletes a brand",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/ui-matrix/workspace-billing-brand-ui.spec.ts",
      "docs/product/brand-studio.md",
    ],
    tags: ["seeded-editor", "pro-plan", "brand-lifecycle"],
    automation: {
      spec: "e2e/ui-matrix/workspace-billing-brand-ui.spec.ts",
      test: "Pro editor creates, uploads, reloads, edits, and deletes a brand",
    },
  },
  {
    id: "WORKSPACE-026",
    subsystem: "workspace-billing-brand",
    area: "search and favorite failure recovery",
    title:
      "search and favorite failure recovery, duplicate, rename, undo, trash restore, and permanent delete persist",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/ui-matrix/dashboard-document-lifecycle-ui.spec.ts",
      "docs/documents/README.md",
    ],
    tags: ["seeded-owner", "dashboard", "document-lifecycle"],
    automation: {
      spec: "e2e/ui-matrix/dashboard-document-lifecycle-ui.spec.ts",
      test: "search and favorite failure recovery, duplicate, rename, undo, trash restore, and permanent delete persist",
    },
  },
  {
    id: "WORKSPACE-027",
    subsystem: "workspace-billing-brand",
    area: "owner, editor, and viewer",
    title:
      "owner, editor, and viewer recover invite failures and complete the workspace lifecycle",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/ui-matrix/workspace-lifecycle-ui.spec.ts",
      "docs/security/workspaces.md",
    ],
    tags: ["workspace-roles", "invites", "lifecycle"],
    automation: {
      spec: "e2e/ui-matrix/workspace-lifecycle-ui.spec.ts",
      test: "owner, editor, and viewer recover invite failures and complete the workspace lifecycle",
    },
  },
  {
    id: "WORKSPACE-028",
    subsystem: "workspace-billing-brand",
    area: "search, filters, sorting, favorites, and safe actions",
    title:
      "dashboard search, filters, sorting, favorites, and safe actions are deterministic",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/editor/document-editor-profile.spec.ts",
      "docs/documents/README.md",
    ],
    tags: ["seeded-owner", "dashboard", "safe-actions"],
    automation: {
      spec: "e2e/editor/document-editor-profile.spec.ts",
      test: "dashboard search, filters, sorting, favorites, and safe actions are deterministic",
    },
  },
  {
    id: "WORKSPACE-029",
    subsystem: "workspace-billing-brand",
    area: "search, history, and template picker controls",
    title:
      "dashboard search, history, and template picker controls are reachable",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/editor/document-editor-profile.spec.ts",
      "docs/documents/README.md",
    ],
    tags: ["seeded-owner", "browser-history", "template-picker"],
    automation: {
      spec: "e2e/editor/document-editor-profile.spec.ts",
      test: "dashboard search, history, and template picker controls are reachable",
    },
  },
  {
    id: "WORKSPACE-030",
    subsystem: "workspace-billing-brand",
    area: "mobile authenticated navigation drawer",
    title:
      "mobile authenticated navigation drawer reaches workspace and brand routes",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/editor/document-editor-profile.spec.ts",
      "docs/system/design-system.md",
    ],
    tags: ["seeded-owner", "mobile", "workspace-brand-routes"],
    automation: {
      spec: "e2e/editor/document-editor-profile.spec.ts",
      test: "mobile authenticated navigation drawer reaches workspace and brand routes",
    },
  },
  {
    id: "WORKSPACE-031",
    subsystem: "workspace-billing-brand",
    area: "sort by date created",
    title:
      "dashboard sort by date created changes the sort URL param and preserves all documents",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/editor/document-editor-profile.spec.ts",
      "docs/documents/README.md",
    ],
    tags: ["seeded-owner", "dashboard-sort", "url-state"],
    automation: {
      spec: "e2e/editor/document-editor-profile.spec.ts",
      test: "dashboard sort by date created changes the sort URL param and preserves all documents",
    },
  },
  {
    id: "WORKSPACE-032",
    subsystem: "workspace-billing-brand",
    area: "main landmark and a non-empty page title",
    title: "workspace page has a main landmark and a non-empty page title",
    status: "automated",
    priority: "P0",
    refs: [
      "e2e/presentation/slides-smoke.spec.ts",
      "docs/system/design-system.md",
    ],
    tags: ["seeded-owner", "landmark", "document-title"],
    automation: {
      spec: "e2e/presentation/slides-smoke.spec.ts",
      test: "workspace page has a main landmark and a non-empty page title",
    },
  },
  {
    id: "WORKSPACE-033",
    subsystem: "workspace-billing-brand",
    area: "create-document control",
    title: "authenticated workspace exposes a visible create-document control",
    status: "automated",
    priority: "P0",
    refs: ["e2e/presentation/slides-smoke.spec.ts", "docs/documents/README.md"],
    tags: ["seeded-owner", "workspace", "create-document"],
    automation: {
      spec: "e2e/presentation/slides-smoke.spec.ts",
      test: "authenticated workspace exposes a visible create-document control",
    },
  },
];

const AUTOMATED_CASES_BY_ID = new Map(
  AUTOMATED_CASES.map((testCase) => [testCase.id, testCase]),
);
if (AUTOMATED_CASES_BY_ID.size !== AUTOMATED_CASES.length) {
  throw new Error("Automated UI matrix case IDs must be unique");
}

function statusFor(
  plan: SubsystemPlan,
  zeroBasedNonAutomatedIndex: number,
): UiCaseStatus {
  const generatedCounts: Record<UiCaseStatus, number> = {
    ...plan.statusCounts,
    automated: 0,
  };
  let cursor = 0;
  for (const status of STATUS_ORDER) {
    cursor += generatedCounts[status];
    if (zeroBasedNonAutomatedIndex < cursor) return status;
  }
  throw new Error(
    `Status plan for ${plan.subsystem} does not cover non-automated case ${zeroBasedNonAutomatedIndex + 1}`,
  );
}

function priorityFor(
  status: UiCaseStatus,
  zeroBasedIndex: number,
): UiCasePriority {
  if (status === "automated" && zeroBasedIndex % 3 === 0) return "P0";
  if (status === "blocked" || zeroBasedIndex % 5 === 0) return "P1";
  return "P2";
}

function buildCases(): UiTestCase[] {
  return PLANS.flatMap((plan) => {
    const planned = Object.values(plan.statusCounts).reduce(
      (sum, count) => sum + count,
      0,
    );
    if (planned !== plan.total) {
      throw new Error(
        `${plan.subsystem} expected ${plan.total} cases but planned ${planned}`,
      );
    }

    let nonAutomatedIndex = 0;
    return Array.from({ length: plan.total }, (_, index): UiTestCase => {
      const oneBased = index + 1;
      const area = plan.areas[index % plan.areas.length]!;
      const subject =
        plan.subjects[
          Math.floor(index / plan.areas.length) % plan.subjects.length
        ]!;
      const interaction = plan.interactions[index % plan.interactions.length]!;
      const variant =
        plan.variants[
          Math.floor(index / plan.interactions.length) % plan.variants.length
        ]!;
      const id = `${plan.prefix}-${String(oneBased).padStart(3, "0")}`;
      const automatedCase = AUTOMATED_CASES_BY_ID.get(id);
      if (automatedCase) {
        if (automatedCase.subsystem !== plan.subsystem) {
          throw new Error(
            `Automated case ${id} belongs to ${automatedCase.subsystem}, expected ${plan.subsystem}`,
          );
        }
        return automatedCase;
      }
      const status = statusFor(plan, nonAutomatedIndex);
      nonAutomatedIndex += 1;
      return {
        id,
        subsystem: plan.subsystem,
        area,
        title: `${area}: ${interaction} for ${subject} (${variant})`,
        status,
        priority: priorityFor(status, index),
        refs: plan.refs,
        tags: [area, subject, variant].map((tag) =>
          tag
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, ""),
        ),
      };
    });
  });
}

export const UI_TEST_CASES = buildCases();

export const UI_TEST_CASE_TOTAL = 500;

export function summarizeUiCases(cases: readonly UiTestCase[] = UI_TEST_CASES) {
  return cases.reduce(
    (summary, testCase) => {
      summary.total += 1;
      summary.byStatus[testCase.status] += 1;
      const subsystem = (summary.bySubsystem[testCase.subsystem] ??= {
        total: 0,
        automated: 0,
        manual: 0,
        blocked: 0,
        catalog: 0,
      });
      subsystem.total += 1;
      subsystem[testCase.status] += 1;
      return summary;
    },
    {
      total: 0,
      byStatus: { automated: 0, manual: 0, blocked: 0, catalog: 0 },
      bySubsystem: {} as Record<
        UiSubsystem,
        { total: number } & Record<UiCaseStatus, number>
      >,
    },
  );
}

const summary = summarizeUiCases();
if (summary.total !== UI_TEST_CASE_TOTAL) {
  throw new Error(
    `UI matrix expected ${UI_TEST_CASE_TOTAL} cases, found ${summary.total}`,
  );
}
for (const plan of PLANS) {
  const actual = summary.bySubsystem[plan.subsystem];
  for (const status of STATUS_ORDER) {
    if (actual?.[status] !== plan.statusCounts[status]) {
      throw new Error(
        `${plan.subsystem} expected ${plan.statusCounts[status]} ${status} cases, found ${actual?.[status] ?? 0}`,
      );
    }
  }
}
for (const automatedCase of AUTOMATED_CASES) {
  if (!UI_TEST_CASES.includes(automatedCase)) {
    throw new Error(
      `Automated case ${automatedCase.id} does not replace a generated catalog case`,
    );
  }
}
