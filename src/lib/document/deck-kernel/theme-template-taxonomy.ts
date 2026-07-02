import type { SlideTemplate } from "./deck-core";

export const THEME_PACKAGE_TEMPLATE_KINDS = [
  "cover",
  "agenda",
  "section",
  "executive-summary",
  "content",
  "detail",
  "quote",
  "big-stat",
  "metric-row",
  "insight",
  "evidence",
  "table",
  "comparison",
  "matrix",
  "framework",
  "process",
  "timeline",
  "roadmap",
  "architecture",
  "case-study",
  "risks",
  "recommendation",
  "pricing",
  "team",
  "visual-focus",
  "closing",
  "appendix",
] as const;

export type ThemePackageTemplateKind =
  (typeof THEME_PACKAGE_TEMPLATE_KINDS)[number];

export const THEME_PACKAGE_RENDER_FAMILIES = [
  "cover",
  "section-divider",
  "agenda",
  "summary-list",
  "title-bullets",
  "title-body",
  "visual-focus",
  "quote-hero",
  "stat-hero",
  "metric-row",
  "data-insight",
  "table",
  "two-column",
  "matrix-2x2",
  "process-steps",
  "timeline",
  "roadmap",
  "framework-diagram",
  "architecture-diagram",
  "case-study",
  "risk-register",
  "recommendation",
  "team-grid",
  "pricing-cards",
  "closing",
  "appendix-detail",
] as const;

export type ThemePackageRenderFamily =
  (typeof THEME_PACKAGE_RENDER_FAMILIES)[number];

export const THEME_PACKAGE_TEMPLATE_GROUPS = [
  "orient",
  "explain",
  "compare",
  "prove",
  "sequence",
  "decision",
  "commercial",
  "closing",
] as const;

export type ThemePackageTemplateGroup =
  (typeof THEME_PACKAGE_TEMPLATE_GROUPS)[number];

export const THEME_PACKAGE_TEMPLATE_INTENTS = THEME_PACKAGE_TEMPLATE_GROUPS;
export type ThemePackageTemplateIntent =
  (typeof THEME_PACKAGE_TEMPLATE_INTENTS)[number];

export const THEME_PACKAGE_TEMPLATE_CONTENT_MEDIA = [
  "text",
  "bullets",
  "table",
  "metric",
  "chart",
  "quote",
  "image",
  "diagram",
  "document",
  "cards",
  "steps",
  "two-sided",
] as const;

export type ThemePackageTemplateContentMedium =
  (typeof THEME_PACKAGE_TEMPLATE_CONTENT_MEDIA)[number];

export const THEME_PACKAGE_TEMPLATE_ARTIFACT_ROLES = [
  "agenda",
  "analysis",
  "appendix-detail",
  "conceptual-model",
  "detail",
  "hero",
  "market-landscape",
  "narrative-proof",
  "paired-analysis",
  "pricing",
  "recommendation",
  "risk-register",
  "section-marker",
  "source-support",
  "structural-map",
  "summary",
  "team",
  "timeline",
  "visual-story",
  "workflow",
] as const;

export type ThemePackageTemplateArtifactRole =
  (typeof THEME_PACKAGE_TEMPLATE_ARTIFACT_ROLES)[number];

export type TemplateSlotKey =
  | "kicker"
  | "title"
  | "subtitle"
  | "body"
  | "bullets"
  | "leftTitle"
  | "leftBody"
  | "leftBullets"
  | "rightTitle"
  | "rightBody"
  | "rightBullets"
  | "cards"
  | "steps"
  | "quote"
  | "attribution"
  | "stat"
  | "statLabel"
  | "metrics"
  | "table"
  | "visualId"
  | "imagePrompt"
  | "caption";

export interface TemplateCapacity {
  bullets?: number;
  body?: { paragraphs: number; chars: number };
  cards?: number;
  steps?: number;
  metrics?: number;
  table?: { columns: number; rows: number };
}

export interface TemplateSlotBinding {
  slot: TemplateSlotKey;
  target:
    | "title"
    | "subtitle"
    | "body"
    | "bullets"
    | "table"
    | "visual"
    | "caption";
  elementRole?: string;
  elementIndex?: number;
}

export interface ThemePackageTemplateMetadata {
  kind: ThemePackageTemplateKind;
  label: string;
  group: ThemePackageTemplateGroup;
  intent: ThemePackageTemplateIntent;
  contentMedium: ThemePackageTemplateContentMedium;
  artifactRole?: ThemePackageTemplateArtifactRole;
  priority: number;
  renderFamily: ThemePackageRenderFamily;
  bestFor: string;
  avoidFor?: string;
  signals: string[];
  accepts: TemplateSlotKey[];
  required?: TemplateSlotKey[];
  capacity: TemplateCapacity;
  bindings: TemplateSlotBinding[];
}

export const SEMANTIC_TO_RENDER_FAMILY = {
  cover: "cover",
  agenda: "agenda",
  section: "section-divider",
  "executive-summary": "summary-list",
  content: "title-bullets",
  detail: "title-body",
  quote: "quote-hero",
  "big-stat": "stat-hero",
  "metric-row": "metric-row",
  insight: "data-insight",
  evidence: "table",
  table: "table",
  comparison: "two-column",
  matrix: "matrix-2x2",
  framework: "framework-diagram",
  process: "process-steps",
  timeline: "timeline",
  roadmap: "roadmap",
  architecture: "architecture-diagram",
  "case-study": "case-study",
  risks: "risk-register",
  recommendation: "recommendation",
  pricing: "pricing-cards",
  team: "team-grid",
  "visual-focus": "visual-focus",
  closing: "closing",
  appendix: "appendix-detail",
} as const satisfies Record<ThemePackageTemplateKind, ThemePackageRenderFamily>;

const KIND_SET = new Set<string>(THEME_PACKAGE_TEMPLATE_KINDS);

export function isThemePackageTemplateKind(
  value: unknown,
): value is ThemePackageTemplateKind {
  return typeof value === "string" && KIND_SET.has(value);
}

export function resolveThemePackageTemplateKind(
  value: unknown,
): ThemePackageTemplateKind | undefined {
  if (isThemePackageTemplateKind(value)) return value;
  return undefined;
}

function titleCase(kind: string): string {
  return kind
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function groupForKind(
  kind: ThemePackageTemplateKind,
): ThemePackageTemplateGroup {
  if (["cover", "agenda", "section", "executive-summary"].includes(kind))
    return "orient";
  if (["comparison", "matrix"].includes(kind)) return "compare";
  if (
    [
      "big-stat",
      "metric-row",
      "insight",
      "evidence",
      "table",
      "case-study",
    ].includes(kind)
  )
    return "prove";
  if (["process", "timeline", "roadmap"].includes(kind)) return "sequence";
  if (["risks", "recommendation"].includes(kind)) return "decision";
  if (["pricing", "team"].includes(kind)) return "commercial";
  if (["closing", "appendix"].includes(kind)) return "closing";
  return "explain";
}

function contentMediumForKind(
  kind: ThemePackageTemplateKind,
): ThemePackageTemplateContentMedium {
  switch (kind) {
    case "cover":
    case "visual-focus":
      return "image";
    case "agenda":
    case "executive-summary":
    case "content":
    case "recommendation":
      return "bullets";
    case "detail":
      return "text";
    case "quote":
      return "quote";
    case "big-stat":
    case "metric-row":
      return "metric";
    case "insight":
      return "chart";
    case "evidence":
    case "appendix":
      return "document";
    case "table":
    case "risks":
      return "table";
    case "comparison":
      return "two-sided";
    case "matrix":
    case "framework":
    case "architecture":
      return "diagram";
    case "process":
    case "timeline":
    case "roadmap":
      return "steps";
    case "case-study":
    case "pricing":
    case "team":
      return "cards";
    default:
      return "text";
  }
}

const ARTIFACT_ROLE_BY_KIND: Partial<
  Record<ThemePackageTemplateKind, ThemePackageTemplateArtifactRole>
> = {
  cover: "hero",
  agenda: "agenda",
  section: "section-marker",
  "executive-summary": "summary",
  detail: "detail",
  insight: "analysis",
  evidence: "source-support",
  comparison: "paired-analysis",
  matrix: "market-landscape",
  framework: "conceptual-model",
  process: "workflow",
  timeline: "timeline",
  roadmap: "timeline",
  architecture: "structural-map",
  "case-study": "narrative-proof",
  risks: "risk-register",
  recommendation: "recommendation",
  pricing: "pricing",
  team: "team",
  "visual-focus": "visual-story",
  appendix: "appendix-detail",
};

function artifactRoleForKind(
  kind: ThemePackageTemplateKind,
): ThemePackageTemplateArtifactRole | undefined {
  return ARTIFACT_ROLE_BY_KIND[kind];
}

function acceptsForFamily(family: ThemePackageRenderFamily): TemplateSlotKey[] {
  switch (family) {
    case "cover":
    case "section-divider":
    case "closing":
      return ["kicker", "title", "subtitle", "caption"];
    case "quote-hero":
      return ["title", "quote", "attribution", "caption"];
    case "stat-hero":
      return ["title", "stat", "statLabel", "caption"];
    case "metric-row":
      return ["title", "metrics", "caption"];
    case "title-body":
      return ["title", "subtitle", "body", "bullets", "caption"];
    case "table":
    case "data-insight":
    case "risk-register":
      return ["title", "subtitle", "table", "caption"];
    case "two-column":
      return [
        "title",
        "leftTitle",
        "leftBody",
        "leftBullets",
        "rightTitle",
        "rightBody",
        "rightBullets",
        "caption",
      ];
    case "team-grid":
    case "pricing-cards":
      return ["title", "cards", "caption"];
    case "process-steps":
    case "timeline":
    case "roadmap":
      return ["title", "steps", "caption"];
    case "visual-focus":
    case "architecture-diagram":
    case "framework-diagram":
      return ["title", "body", "bullets", "visualId", "imagePrompt", "caption"];
    default:
      return ["title", "subtitle", "body", "bullets", "caption"];
  }
}

function bindingsForSlots(
  slots: readonly TemplateSlotKey[],
): TemplateSlotBinding[] {
  const bindings: TemplateSlotBinding[] = [];
  for (const slot of slots) {
    if (slot === "title")
      bindings.push({ slot, target: "title", elementRole: "title" });
    else if (slot === "subtitle")
      bindings.push({ slot, target: "subtitle", elementRole: "subtitle" });
    else if (slot === "body")
      bindings.push({ slot, target: "body", elementRole: "body" });
    else if (slot === "bullets")
      bindings.push({ slot, target: "bullets", elementRole: "bullet" });
    else if (slot === "table")
      bindings.push({ slot, target: "table", elementRole: "table" });
    else if (slot === "visualId")
      bindings.push({ slot, target: "visual", elementRole: "visual" });
    else if (slot === "caption")
      bindings.push({ slot, target: "caption", elementRole: "caption" });
  }
  return bindings;
}

function capacityForFamily(family: ThemePackageRenderFamily): TemplateCapacity {
  if (
    family === "table" ||
    family === "data-insight" ||
    family === "risk-register"
  ) {
    return { table: { columns: 4, rows: 6 } };
  }
  if (family === "team-grid" || family === "pricing-cards") return { cards: 3 };
  if (family === "metric-row") return { metrics: 4 };
  if (family === "title-body") return { body: { paragraphs: 4, chars: 900 } };
  if (
    family === "process-steps" ||
    family === "timeline" ||
    family === "roadmap"
  )
    return { steps: 5 };
  return { bullets: 5 };
}

function bestFor(
  kind: ThemePackageTemplateKind,
  family: ThemePackageRenderFamily,
): string {
  if (kind === "detail")
    return "Dense explanatory narrative, background, requirements, analysis, and content-heavy slides with paragraphs.";
  if (kind === "evidence")
    return "Proof, evidence, source-to-claim, legal, audit, and factual support slides.";
  if (kind === "table")
    return "General structured data that is useful to compare across rows and columns.";
  if (family === "two-column")
    return "Direct comparisons, alternatives, tradeoffs, and paired arguments.";
  if (family === "process-steps")
    return "Sequential steps, workflows, and repeatable processes.";
  if (family === "timeline") return "Chronological events and milestones.";
  if (family === "roadmap") return "Forward-looking phases and delivery plans.";
  if (family === "data-insight")
    return "Results, experiments, metrics, and analytic evidence.";
  return `${titleCase(kind)} slide content.`;
}

export const THEME_PACKAGE_TEMPLATE_METADATA = Object.fromEntries(
  THEME_PACKAGE_TEMPLATE_KINDS.map((kind, index) => {
    const renderFamily = SEMANTIC_TO_RENDER_FAMILY[kind];
    const accepts = acceptsForFamily(renderFamily);
    const intent = groupForKind(kind);
    const contentMedium = contentMediumForKind(kind);
    const artifactRole = artifactRoleForKind(kind);
    const signals = Array.from(
      new Set([
        kind,
        renderFamily,
        intent,
        contentMedium,
        ...(artifactRole ? [artifactRole] : []),
        ...kind.split("-"),
      ]),
    );
    return [
      kind,
      {
        kind,
        label: titleCase(kind),
        group: intent,
        intent,
        contentMedium,
        ...(artifactRole ? { artifactRole } : {}),
        priority: index + 1,
        renderFamily,
        bestFor: bestFor(kind, renderFamily),
        ...(kind === "table"
          ? { avoidFor: "Proof-heavy source support; prefer evidence." }
          : {}),
        signals,
        accepts,
        required: accepts.includes("title") ? ["title"] : undefined,
        capacity: capacityForFamily(renderFamily),
        bindings: bindingsForSlots(accepts),
      } satisfies ThemePackageTemplateMetadata,
    ];
  }),
) as Record<ThemePackageTemplateKind, ThemePackageTemplateMetadata>;

export function templateCategoryForFamily(
  family: ThemePackageRenderFamily,
): SlideTemplate["category"] {
  if (family === "cover" || family === "closing") return "title";
  if (family === "section-divider") return "section";
  if (family === "visual-focus") return "media";
  if (["two-column", "matrix-2x2"].includes(family)) return "comparison";
  return "content";
}
