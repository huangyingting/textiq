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
    statusCounts: { automated: 0, manual: 10, blocked: 2, catalog: 28 },
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
    statusCounts: { automated: 0, manual: 15, blocked: 4, catalog: 26 },
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

function statusFor(plan: SubsystemPlan, zeroBasedIndex: number): UiCaseStatus {
  let cursor = 0;
  for (const status of STATUS_ORDER) {
    cursor += plan.statusCounts[status];
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
