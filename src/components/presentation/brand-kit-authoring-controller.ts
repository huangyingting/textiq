import { compileBrandKitDraft } from "@/lib/presentation/brand-kit/compiler";
import type {
  BrandKitCompileResult,
  BrandKitDiagnostic,
  BrandKitDraftV1,
  BrandKitTypographyRole,
} from "@/lib/presentation/brand-kit/schema";
import type {
  BrandKitSavePort,
  SaveBrandKitDraftResult,
} from "@/lib/action-ports";

export type BrandKitPaletteColorPath =
  | "palette.backgrounds.canvas"
  | "palette.backgrounds.muted"
  | "palette.backgrounds.inverse"
  | "palette.surfaces.default"
  | "palette.surfaces.elevated"
  | "palette.surfaces.subtle"
  | "palette.text.primary"
  | "palette.text.secondary"
  | "palette.text.inverse"
  | "palette.text.accent"
  | "palette.accents.primary"
  | "palette.accents.secondary"
  | "palette.borders.default"
  | "palette.borders.strong"
  | `palette.charts.${number}`
  | "palette.states.success.fill"
  | "palette.states.success.text"
  | "palette.states.warning.fill"
  | "palette.states.warning.text"
  | "palette.states.danger.fill"
  | "palette.states.danger.text"
  | "palette.states.info.fill"
  | "palette.states.info.text";

export type BrandKitTypographyRoleName = keyof BrandKitDraftV1["typography"];
export type BrandKitTypographyField = keyof BrandKitTypographyRole;
export type BrandKitAssetField = "id" | "src" | "alt" | "widthPx" | "heightPx";

export type BrandKitAuthoringState = {
  draft: BrandKitDraftV1;
  compileResult: BrandKitCompileResult;
  saving: boolean;
  saveResult?: SaveBrandKitDraftResult;
};

export type BrandKitDraftSeed = {
  ownerId: string;
  now?: string;
  id?: string;
  slug?: string;
  name?: string;
};

export const PALETTE_COLOR_FIELDS: readonly {
  path: BrandKitPaletteColorPath;
  label: string;
}[] = [
  { path: "palette.backgrounds.canvas", label: "Canvas" },
  { path: "palette.backgrounds.muted", label: "Muted background" },
  { path: "palette.backgrounds.inverse", label: "Inverse background" },
  { path: "palette.surfaces.default", label: "Default surface" },
  { path: "palette.surfaces.elevated", label: "Elevated surface" },
  { path: "palette.surfaces.subtle", label: "Subtle surface" },
  { path: "palette.text.primary", label: "Primary text" },
  { path: "palette.text.secondary", label: "Secondary text" },
  { path: "palette.text.inverse", label: "Inverse text" },
  { path: "palette.text.accent", label: "Accent text" },
  { path: "palette.accents.primary", label: "Primary accent" },
  { path: "palette.accents.secondary", label: "Secondary accent" },
  { path: "palette.borders.default", label: "Default border" },
  { path: "palette.borders.strong", label: "Strong border" },
  { path: "palette.charts.0", label: "Chart 1" },
  { path: "palette.charts.1", label: "Chart 2" },
  { path: "palette.charts.2", label: "Chart 3" },
  { path: "palette.states.success.fill", label: "Success fill" },
  { path: "palette.states.success.text", label: "Success text" },
  { path: "palette.states.warning.fill", label: "Warning fill" },
  { path: "palette.states.warning.text", label: "Warning text" },
  { path: "palette.states.danger.fill", label: "Danger fill" },
  { path: "palette.states.danger.text", label: "Danger text" },
  { path: "palette.states.info.fill", label: "Info fill" },
  { path: "palette.states.info.text", label: "Info text" },
] as const;

export const TYPOGRAPHY_ROLE_FIELDS: readonly {
  role: BrandKitTypographyRoleName;
  label: string;
}[] = [
  { role: "display", label: "Display" },
  { role: "heading", label: "Heading" },
  { role: "body", label: "Body" },
  { role: "caption", label: "Caption" },
  { role: "mono", label: "Mono" },
  { role: "data", label: "Data" },
] as const;

export function createDefaultBrandKitDraft({
  ownerId,
  now = new Date().toISOString(),
  id = "brand-kit-draft",
  slug = "custom-brand-kit",
  name = "Custom Brand Kit",
}: BrandKitDraftSeed): BrandKitDraftV1 {
  const body: BrandKitTypographyRole = {
    family: "Inter",
    sizePt: 18,
    weight: 400,
    lineHeight: 1.35,
  };
  return {
    schemaVersion: 1,
    id,
    name,
    slug,
    scope: { kind: "user", ownerId },
    version: "1.0.0",
    revision: { id: `${id}-r1`, number: 1, createdAt: now },
    palette: {
      backgrounds: { canvas: "#ffffff", muted: "#f8fafc", inverse: "#0f172a" },
      surfaces: { default: "#ffffff", elevated: "#f1f5f9", subtle: "#e2e8f0" },
      text: {
        primary: "#0f172a",
        secondary: "#475569",
        inverse: "#ffffff",
        accent: "#2563eb",
      },
      accents: { primary: "#2563eb", secondary: "#7c3aed" },
      borders: { default: "#cbd5e1", strong: "#64748b" },
      charts: ["#2563eb", "#7c3aed", "#14b8a6"],
      states: {
        success: { fill: "#dcfce7", text: "#166534" },
        warning: { fill: "#fef3c7", text: "#92400e" },
        danger: { fill: "#fee2e2", text: "#991b1b" },
        info: { fill: "#dbeafe", text: "#1d4ed8" },
      },
    },
    typography: {
      display: {
        family: "Inter",
        sizePt: 44,
        weight: 700,
        lineHeight: 1.05,
        letterSpacingEm: -0.02,
      },
      heading: {
        family: "Inter",
        sizePt: 30,
        weight: 700,
        lineHeight: 1.12,
        letterSpacingEm: -0.01,
      },
      body,
      caption: { family: "Inter", sizePt: 12, weight: 500, lineHeight: 1.3 },
      mono: {
        family: "JetBrains Mono",
        sizePt: 14,
        weight: 500,
        lineHeight: 1.3,
      },
      data: { family: "Inter", sizePt: 13, weight: 600, lineHeight: 1.25 },
    },
    decorations: { background: "subtle", chrome: "default" },
  };
}

export function createBrandKitAuthoringState(
  draft: BrandKitDraftV1,
): BrandKitAuthoringState {
  return { draft, compileResult: compileBrandKitDraft(draft), saving: false };
}

function setPathValue<T extends object>(
  object: T,
  path: string,
  value: unknown,
): T {
  const keys = path.split(".");
  const root = (Array.isArray(object) ? [...object] : { ...object }) as Record<
    string,
    unknown
  >;
  let cursor: Record<string, unknown> = root;
  let source: unknown = object;
  for (const key of keys.slice(0, -1)) {
    const nextSource =
      source && typeof source === "object"
        ? (source as Record<string, unknown>)[key]
        : undefined;
    const nextValue = Array.isArray(nextSource)
      ? [...nextSource]
      : { ...(nextSource && typeof nextSource === "object" ? nextSource : {}) };
    cursor[key] = nextValue;
    cursor = nextValue as Record<string, unknown>;
    source = nextSource;
  }
  cursor[keys[keys.length - 1]!] = value;
  return root as T;
}

export function updateBrandKitDraft(
  state: BrandKitAuthoringState,
  updater: (draft: BrandKitDraftV1) => BrandKitDraftV1,
): BrandKitAuthoringState {
  const draft = updater(state.draft);
  return { draft, compileResult: compileBrandKitDraft(draft), saving: false };
}

export function updateBrandKitIdentity(
  state: BrandKitAuthoringState,
  field: "name" | "slug" | "version",
  value: string,
): BrandKitAuthoringState {
  return updateBrandKitDraft(state, (draft) => ({ ...draft, [field]: value }));
}

export function updateBrandKitPaletteColor(
  state: BrandKitAuthoringState,
  path: BrandKitPaletteColorPath,
  value: string,
): BrandKitAuthoringState {
  return updateBrandKitDraft(state, (draft) =>
    setPathValue(draft, path, value),
  );
}

export function updateBrandKitTypography(
  state: BrandKitAuthoringState,
  role: BrandKitTypographyRoleName,
  field: BrandKitTypographyField,
  rawValue: string,
): BrandKitAuthoringState {
  const value = field === "family" ? rawValue : Number(rawValue);
  return updateBrandKitDraft(state, (draft) => ({
    ...draft,
    typography: {
      ...draft.typography,
      [role]: { ...draft.typography[role], [field]: value },
    },
  }));
}

export function updateBrandKitLogo(
  state: BrandKitAuthoringState,
  field: BrandKitAssetField,
  rawValue: string,
): BrandKitAuthoringState {
  const value =
    field === "widthPx" || field === "heightPx"
      ? Number(rawValue) || undefined
      : rawValue;
  return updateBrandKitDraft(state, (draft) => ({
    ...draft,
    assets: {
      ...draft.assets,
      logo: {
        id: draft.assets?.logo?.id ?? "logo",
        src: draft.assets?.logo?.src ?? "",
        ...draft.assets?.logo,
        [field]: value,
      },
    },
  }));
}

export function updateBrandKitDecoration(
  state: BrandKitAuthoringState,
  field: "background" | "chrome",
  value:
    | NonNullable<BrandKitDraftV1["decorations"]>["background"]
    | NonNullable<BrandKitDraftV1["decorations"]>["chrome"],
): BrandKitAuthoringState {
  return updateBrandKitDraft(state, (draft) => ({
    ...draft,
    decorations: { ...draft.decorations, [field]: value },
  }));
}

export function diagnosticsForPath(
  diagnostics: readonly BrandKitDiagnostic[],
  path: string,
): BrandKitDiagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.path === path);
}

export async function saveBrandKitAuthoringState(
  state: BrandKitAuthoringState,
  saveBrandKitDraft: BrandKitSavePort["saveBrandKitDraft"],
): Promise<BrandKitAuthoringState> {
  if (!state.compileResult.ok) return { ...state, saveResult: undefined };
  const compiled = state.compileResult;
  const savingState = { ...state, saving: true, saveResult: undefined };
  const saveResult = await saveBrandKitDraft(compiled.draft, compiled.package);
  return { ...savingState, saving: false, saveResult };
}
