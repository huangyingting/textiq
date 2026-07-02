import auroraPackageJson from "./theme-package-sources/aurora.package.json";
import clarityPackageJson from "./theme-package-sources/clarity.package.json";
import editorialPackageJson from "./theme-package-sources/editorial.package.json";
import monolithPackageJson from "./theme-package-sources/monolith.package.json";
import noirPackageJson from "./theme-package-sources/noir.package.json";
import oceanPackageJson from "./theme-package-sources/ocean.package.json";
import pulsePackageJson from "./theme-package-sources/pulse.package.json";
import terraPackageJson from "./theme-package-sources/terra.package.json";

import {
  BUILT_IN_THEME_PACKAGE_IDS,
  DEFAULT_BUILT_IN_THEME_PACKAGE_ID,
  isBuiltInThemePackageId,
  resolveBuiltInThemePackageId,
  type BuiltInThemePackageId,
} from "../../presentation-shared/theme-package-ids";
import type { Deck, Slide, SlideMaster, SlideTemplate } from "./deck-core";
import type { PresentationTheme } from "./presentation-theme-types";
import {
  THEME_PACKAGE_TEMPLATE_KINDS,
  THEME_PACKAGE_TEMPLATE_METADATA,
  resolveThemePackageTemplateKind,
  type ThemePackageTemplateGroup,
  type ThemePackageTemplateKind,
  type ThemePackageTemplateMetadata,
} from "./theme-template-taxonomy";

export {
  SEMANTIC_TO_RENDER_FAMILY,
  THEME_PACKAGE_RENDER_FAMILIES,
  THEME_PACKAGE_TEMPLATE_ARTIFACT_ROLES,
  THEME_PACKAGE_TEMPLATE_CONTENT_MEDIA,
  THEME_PACKAGE_TEMPLATE_GROUPS,
  THEME_PACKAGE_TEMPLATE_INTENTS,
  THEME_PACKAGE_TEMPLATE_KINDS,
  THEME_PACKAGE_TEMPLATE_METADATA,
  isThemePackageTemplateKind,
  resolveThemePackageTemplateKind,
  type TemplateCapacity,
  type TemplateSlotBinding,
  type TemplateSlotKey,
  type ThemePackageRenderFamily,
  type ThemePackageTemplateArtifactRole,
  type ThemePackageTemplateContentMedium,
  type ThemePackageTemplateGroup,
  type ThemePackageTemplateIntent,
  type ThemePackageTemplateKind,
  type ThemePackageTemplateMetadata,
} from "./theme-template-taxonomy";

export const THEME_PACKAGE_IDS = BUILT_IN_THEME_PACKAGE_IDS;

export type ThemePackageId = BuiltInThemePackageId;

export const DEFAULT_THEME_PACKAGE_ID: ThemePackageId =
  DEFAULT_BUILT_IN_THEME_PACKAGE_ID;

export interface PresentationThemePackage {
  id: ThemePackageId;
  name: string;
  tagline: string;
  accent: string;
  tokenSet: PresentationTheme;
  masters: SlideMaster[];
  defaultMasterId: string;
  templates: SlideTemplate[];
  templateMetadata: ThemePackageTemplateMetadata[];
}

type PackageDeckSource = {
  id: ThemePackageId;
  name: string;
  tagline: string;
  accent: string;
  tokenSet: PresentationTheme;
  masters: SlideMaster[];
  defaultMasterId: string;
  templates: SlideTemplate[];
};

const TEMPLATE_ID_KIND_SET = new Set<string>(THEME_PACKAGE_TEMPLATE_KINDS);
const PACKAGE_SOURCE_BY_ID = {
  clarity: clarityPackageJson,
  ocean: oceanPackageJson,
  aurora: auroraPackageJson,
  monolith: monolithPackageJson,
  editorial: editorialPackageJson,
  noir: noirPackageJson,
  terra: terraPackageJson,
  pulse: pulsePackageJson,
} as const satisfies Record<ThemePackageId, unknown>;

const PACKAGE_SOURCES: PackageDeckSource[] = THEME_PACKAGE_IDS.map(
  (packageId) =>
    PACKAGE_SOURCE_BY_ID[packageId] as unknown as PackageDeckSource,
);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function resolveThemePackageTemplateId(
  packageId: ThemePackageId,
  kind: ThemePackageTemplateKind,
): string {
  return `theme:${packageId}:${kind}`;
}

function buildThemePackage(
  source: PackageDeckSource,
): PresentationThemePackage {
  const tokenSet = clone(source.tokenSet);
  return {
    id: source.id,
    name: source.name,
    tagline: source.tagline,
    accent: source.accent,
    tokenSet: { ...tokenSet, id: source.id, name: source.name },
    masters: clone(source.masters),
    defaultMasterId: source.defaultMasterId,
    templates: clone(source.templates),
    templateMetadata: THEME_PACKAGE_TEMPLATE_KINDS.map((kind) =>
      clone(THEME_PACKAGE_TEMPLATE_METADATA[kind]),
    ),
  };
}

export const THEME_PACKAGES: readonly PresentationThemePackage[] =
  PACKAGE_SOURCES.map(buildThemePackage);

const PACKAGE_BY_ID = new Map(
  THEME_PACKAGES.map((themePackage) => [themePackage.id, themePackage]),
);

export function isThemePackageId(value: unknown): value is ThemePackageId {
  return isBuiltInThemePackageId(value);
}

export function resolveThemePackageId(
  packageId: string,
): ThemePackageId | undefined {
  return resolveBuiltInThemePackageId(packageId);
}

export function getThemePackage(
  packageId: string,
): PresentationThemePackage | undefined {
  const resolvedPackageId = resolveThemePackageId(packageId);
  return resolvedPackageId ? PACKAGE_BY_ID.get(resolvedPackageId) : undefined;
}

export function isThemePackageTemplateId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const [prefix, packageId, kind] = value.split(":");
  return (
    prefix === "theme" &&
    !!resolveThemePackageId(packageId ?? "") &&
    TEMPLATE_ID_KIND_SET.has(kind ?? "")
  );
}

export function getThemePackageTemplateMetadata(
  _packageId: string,
  kind: unknown,
): ThemePackageTemplateMetadata | undefined {
  const resolvedKind = resolveThemePackageTemplateKind(kind);
  return resolvedKind
    ? clone(THEME_PACKAGE_TEMPLATE_METADATA[resolvedKind])
    : undefined;
}

export function themePackageTemplateCatalogForAi(
  packageId: string,
): Array<
  Pick<
    ThemePackageTemplateMetadata,
    | "kind"
    | "label"
    | "group"
    | "intent"
    | "contentMedium"
    | "artifactRole"
    | "priority"
    | "renderFamily"
    | "bestFor"
    | "avoidFor"
    | "signals"
    | "accepts"
    | "required"
    | "capacity"
  >
> {
  const themePackage = getThemePackage(packageId);
  if (!themePackage) return [];
  return themePackage.templateMetadata.map(
    ({ bindings: _bindings, ...metadata }) => clone(metadata),
  );
}

export function themePackageTemplateGroupsForUi(packageId: string): Array<{
  group: ThemePackageTemplateGroup;
  templates: ThemePackageTemplateMetadata[];
}> {
  const themePackage = getThemePackage(packageId);
  if (!themePackage) return [];
  const groups = new Map<
    ThemePackageTemplateGroup,
    ThemePackageTemplateMetadata[]
  >();
  for (const metadata of themePackage.templateMetadata) {
    const bucket = groups.get(metadata.group) ?? [];
    bucket.push(clone(metadata));
    groups.set(metadata.group, bucket);
  }
  return [...groups.entries()].map(([group, templates]) => ({
    group,
    templates: templates.sort((a, b) => a.priority - b.priority),
  }));
}

export function themePackageTemplatesForDeck(deck: Deck): SlideTemplate[] {
  return (deck.customTemplates ?? []).filter(
    (template) => template.source === "theme",
  );
}

export function slideFromThemePackageTemplate(template: SlideTemplate): Slide {
  return {
    id: `preview-${template.id.replace(/[^a-z0-9-]+/gi, "-")}`,
    index: 0,
    title: template.name,
    notes: "",
    templateId: template.id,
    ...(template.defaultMasterId ? { masterId: template.defaultMasterId } : {}),
    ...(template.slideDesignDefaults
      ? { designOverrides: template.slideDesignDefaults }
      : {}),
    elements: template.elements.map((element, index) => ({
      id: element.id,
      kind: element.kind,
      ...(element.role ? { role: element.role } : {}),
      box: element.box ?? { x: 10, y: 10, w: 80, h: 20 },
      zIndex: index,
      content: element.contentDefaults ?? { kind: element.kind },
      ...(element.designOverrides
        ? { designOverrides: element.designOverrides }
        : {}),
      ...(typeof element.opacity === "number"
        ? { opacity: element.opacity }
        : {}),
      ...(typeof element.rotation === "number"
        ? { rotation: element.rotation }
        : {}),
      ...(typeof element.locked === "boolean"
        ? { locked: element.locked }
        : {}),
      ...(typeof element.name === "string" ? { name: element.name } : {}),
    })),
  } as unknown as Slide;
}

export function previewDeckForThemePackage(
  themePackage: PresentationThemePackage,
): Deck {
  return {
    schemaVersion: 6,
    canvas: { format: "16:9" },
    design: {
      themeId: themePackage.id,
      themeOverrides: { tokenSet: themePackage.tokenSet },
    },
    masters: themePackage.masters,
    defaultMasterId: themePackage.defaultMasterId,
    slides: [],
  } as Deck;
}

export function applyThemePackage(deck: Deck, packageId: string): Deck | null {
  const themePackage = getThemePackage(packageId);
  if (!themePackage) return null;

  const customTemplates = [
    ...(deck.customTemplates ?? []).filter(
      (template) => template.source !== "theme",
    ),
    ...clone(themePackage.templates),
  ];
  const slides = deck.slides.map(
    (slide) =>
      ({ ...slide, masterId: themePackage.defaultMasterId }) as typeof slide,
  );

  return {
    ...deck,
    design: {
      ...((deck as any).design ?? {}),
      themeId: themePackage.id,
      themeOverrides: { tokenSet: clone(themePackage.tokenSet) },
    },
    masters: clone(themePackage.masters),
    defaultMasterId: themePackage.defaultMasterId,
    customTemplates,
    slides,
  } as Deck;
}
