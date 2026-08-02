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
    statusCounts: { automated: 0, manual: 48, blocked: 10, catalog: 122 },
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
    statusCounts: { automated: 0, manual: 35, blocked: 8, catalog: 77 },
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
    statusCounts: { automated: 0, manual: 16, blocked: 4, catalog: 40 },
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
    statusCounts: { automated: 4, manual: 10, blocked: 2, catalog: 24 },
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
    statusCounts: { automated: 8, manual: 15, blocked: 4, catalog: 18 },
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
    statusCounts: { automated: 0, manual: 15, blocked: 5, catalog: 35 },
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
];

const AUTOMATED_CASES_BY_ID = new Map(
  AUTOMATED_CASES.map((testCase) => [testCase.id, testCase]),
);
if (AUTOMATED_CASES_BY_ID.size !== AUTOMATED_CASES.length) {
  throw new Error("Automated UI matrix case IDs must be unique");
}

function statusFor(plan: SubsystemPlan, zeroBasedIndex: number): UiCaseStatus {
  const generatedCounts: Record<UiCaseStatus, number> = {
    ...plan.statusCounts,
    automated: 0,
    catalog: plan.statusCounts.catalog + plan.statusCounts.automated,
  };
  let cursor = 0;
  for (const status of STATUS_ORDER) {
    cursor += generatedCounts[status];
    if (zeroBasedIndex < cursor) return status;
  }
  throw new Error(
    `Status plan for ${plan.subsystem} does not cover case ${zeroBasedIndex + 1}`,
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

    return Array.from({ length: plan.total }, (_, index): UiTestCase => {
      const oneBased = index + 1;
      const status = statusFor(plan, index);
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
