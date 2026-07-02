import { isBuiltInThemePackageId } from "@/lib/presentation/theme-package-ids";
import {
  isSlideFontId,
  slideFontCssStack,
} from "@/lib/presentation/slide-fonts";

import type { StyleObject } from "../style-schema";
import { STYLE_REFS } from "../style-registry";
import type { ThemePackageV1 } from "../theme-package-schema";
import { validateThemePackage } from "../theme-package-schema";
import type {
  BrandKitCompileResult,
  BrandKitDiagnostic,
  BrandKitDraftV1,
  BrandKitFontAsset,
  BrandKitImageAsset,
  BrandKitTypographyRole,
} from "./schema";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const SEMVERISH = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);
const FONT_STYLES = new Set(["normal", "italic"]);
const WCAG_TEXT_CONTRAST_THRESHOLD = 4.5;
const WCAG_NON_TEXT_CONTRAST_THRESHOLD = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addDiagnostic(
  diagnostics: BrandKitDiagnostic[],
  severity: BrandKitDiagnostic["severity"],
  code: string,
  message: string,
  path: string,
): void {
  diagnostics.push({ severity, code, message, path });
}

function readString(
  input: Record<string, unknown>,
  key: string,
  path: string,
  diagnostics: BrandKitDiagnostic[],
): string | undefined {
  const value = input[key];
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  addDiagnostic(
    diagnostics,
    "error",
    "required-string",
    `${path} is required`,
    path,
  );
  return undefined;
}

function readOptionalString(
  input: Record<string, unknown>,
  key: string,
  path: string,
  diagnostics: BrandKitDiagnostic[],
): string | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value === "string") return value.trim();
  addDiagnostic(
    diagnostics,
    "error",
    "invalid-string",
    `${path} must be a string`,
    path,
  );
  return undefined;
}

function readOptionalStringArrayOrNumber(
  input: Record<string, unknown>,
  key: string,
  path: string,
  diagnostics: BrandKitDiagnostic[],
): number | number[] | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    Array.isArray(value) &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
  ) {
    return value;
  }
  addDiagnostic(
    diagnostics,
    "error",
    "invalid-font-weight",
    `${path} must be a finite number or number[]`,
    path,
  );
  return undefined;
}

function readNumber(
  input: Record<string, unknown>,
  key: string,
  path: string,
  diagnostics: BrandKitDiagnostic[],
): number | undefined {
  const value = input[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  addDiagnostic(
    diagnostics,
    "error",
    "required-number",
    `${path} is required`,
    path,
  );
  return undefined;
}

function expectObject(
  value: unknown,
  path: string,
  diagnostics: BrandKitDiagnostic[],
): Record<string, unknown> | undefined {
  if (isRecord(value)) return value;
  addDiagnostic(
    diagnostics,
    "error",
    "required-object",
    `${path} must be an object`,
    path,
  );
  return undefined;
}

function validateHex(
  value: string | undefined,
  path: string,
  diagnostics: BrandKitDiagnostic[],
): string {
  if (!value) return "#000000";
  if (!HEX_COLOR.test(value)) {
    addDiagnostic(
      diagnostics,
      "error",
      "invalid-color",
      `${path} must be a #RRGGBB color`,
      path,
    );
  }
  return value;
}

function readColor(
  input: Record<string, unknown>,
  key: string,
  path: string,
  diagnostics: BrandKitDiagnostic[],
): string {
  return validateHex(
    readString(input, key, path, diagnostics),
    path,
    diagnostics,
  );
}

function parseTypographyRole(
  input: Record<string, unknown>,
  path: string,
  diagnostics: BrandKitDiagnostic[],
): BrandKitTypographyRole {
  const family =
    readString(input, "family", `${path}.family`, diagnostics) ??
    "Inter, system-ui, sans-serif";
  const fontAssetId = readOptionalString(
    input,
    "fontAssetId",
    `${path}.fontAssetId`,
    diagnostics,
  );
  const sizePt =
    readNumber(input, "sizePt", `${path}.sizePt`, diagnostics) ?? 12;
  const weight =
    readNumber(input, "weight", `${path}.weight`, diagnostics) ?? 400;
  const lineHeight =
    readNumber(input, "lineHeight", `${path}.lineHeight`, diagnostics) ?? 1.3;
  const letterSpacingEm =
    input.letterSpacingEm === undefined
      ? undefined
      : readNumber(
          input,
          "letterSpacingEm",
          `${path}.letterSpacingEm`,
          diagnostics,
        );

  if (sizePt < 6 || sizePt > 96) {
    addDiagnostic(
      diagnostics,
      "error",
      "invalid-font-size",
      `${path}.sizePt must be between 6 and 96`,
      `${path}.sizePt`,
    );
  }
  if (weight < 100 || weight > 1000) {
    addDiagnostic(
      diagnostics,
      "error",
      "invalid-font-weight",
      `${path}.weight must be between 100 and 1000`,
      `${path}.weight`,
    );
  }
  if (lineHeight < 0.8 || lineHeight > 2.5) {
    addDiagnostic(
      diagnostics,
      "error",
      "invalid-line-height",
      `${path}.lineHeight must be between 0.8 and 2.5`,
      `${path}.lineHeight`,
    );
  }

  return {
    family,
    ...(fontAssetId === undefined ? {} : { fontAssetId }),
    sizePt,
    weight,
    lineHeight,
    ...(letterSpacingEm === undefined ? {} : { letterSpacingEm }),
  };
}

function parseFontAsset(
  input: Record<string, unknown>,
  path: string,
  diagnostics: BrandKitDiagnostic[],
): BrandKitFontAsset {
  const id = readString(input, "id", `${path}.id`, diagnostics) ?? "font";
  const family =
    readString(input, "family", `${path}.family`, diagnostics) ?? "";
  const src = readString(input, "src", `${path}.src`, diagnostics) ?? "";
  const weight = readOptionalStringArrayOrNumber(
    input,
    "weight",
    `${path}.weight`,
    diagnostics,
  );
  const style = readOptionalString(
    input,
    "style",
    `${path}.style`,
    diagnostics,
  );
  const contentHash = readOptionalString(
    input,
    "contentHash",
    `${path}.contentHash`,
    diagnostics,
  );

  if (style !== undefined && !FONT_STYLES.has(style)) {
    addDiagnostic(
      diagnostics,
      "error",
      "invalid-font-style",
      `${path}.style must be normal or italic`,
      `${path}.style`,
    );
  }

  return {
    id,
    family,
    src,
    ...(weight === undefined ? {} : { weight }),
    ...(style === undefined
      ? {}
      : { style: style as BrandKitFontAsset["style"] }),
    ...(contentHash === undefined ? {} : { contentHash }),
  };
}

function relativeLuminance(color: string): number {
  const channels = [1, 3, 5].map((start) => {
    const value = Number.parseInt(color.slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

function addContrastDiagnostic(
  diagnostics: BrandKitDiagnostic[],
  severity: BrandKitDiagnostic["severity"],
  foreground: string,
  background: string,
  foregroundPath: string,
  backgroundPath: string,
  threshold: number,
  label: string,
): void {
  if (!HEX_COLOR.test(foreground) || !HEX_COLOR.test(background)) return;
  const ratio = contrastRatio(foreground, background);
  if (ratio >= threshold) return;
  addDiagnostic(
    diagnostics,
    severity,
    "insufficient-contrast",
    `${label} contrast is ${ratio.toFixed(2)}:1; expected at least ${threshold}:1. Adjust ${foregroundPath} or ${backgroundPath}.`,
    foregroundPath,
  );
}

function validateTypographyFontAssets(
  draft: BrandKitDraftV1,
  diagnostics: BrandKitDiagnostic[],
): void {
  const roles = Object.entries(draft.typography) as Array<
    [keyof BrandKitDraftV1["typography"], BrandKitTypographyRole]
  >;
  for (const [roleName, role] of roles) {
    if (!role.fontAssetId) continue;
    if (draft.assets?.fonts?.[role.fontAssetId]) continue;
    addDiagnostic(
      diagnostics,
      "error",
      "missing-font-asset",
      `typography.${roleName}.fontAssetId references missing font asset "${role.fontAssetId}"`,
      `typography.${roleName}.fontAssetId`,
    );
  }
}

function solidFillColor(style: StyleObject | undefined): string | undefined {
  const fill = style?.fill;
  return fill?.type === "solid" && typeof fill.color === "string"
    ? fill.color
    : undefined;
}

function slideBackgroundColor(
  style: StyleObject | undefined,
): string | undefined {
  const background = style?.slide?.background;
  return background?.type === "solid" && typeof background.color === "string"
    ? background.color
    : undefined;
}

function textColor(style: StyleObject | undefined): string | undefined {
  return typeof style?.text?.color === "string" ? style.text.color : undefined;
}

function strokeColor(style: StyleObject | undefined): string | undefined {
  return typeof style?.stroke?.color === "string"
    ? style.stroke.color
    : undefined;
}

function isColorPair(
  pair: unknown[],
): pair is [string, string, string, string, string] {
  return pair.length === 5 && pair.every((value) => typeof value === "string");
}

function validateCompiledPackageContrast(
  themePackage: ThemePackageV1,
  diagnostics: BrandKitDiagnostic[],
): void {
  const styles = themePackage.styles;
  const canvas = slideBackgroundColor(styles["slide.content"]?.default);
  const cover = slideBackgroundColor(styles["slide.cover"]?.default);
  const cardFill = solidFillColor(styles["surface.card"]?.default);
  const calloutFill = solidFillColor(styles["surface.callout"]?.default);
  const warningFill = solidFillColor(styles["surface.callout"]?.warning);
  const dangerFill = solidFillColor(styles["surface.callout"]?.danger);
  const textPairs = [
    [
      textColor(styles["text.title"]?.default),
      canvas,
      "palette.text.primary",
      "palette.backgrounds.canvas",
      "primary text on canvas",
    ],
    [
      textColor(styles["text.subtitle"]?.default),
      canvas,
      "palette.text.secondary",
      "palette.backgrounds.canvas",
      "secondary text on canvas",
    ],
    [
      textColor(styles["text.body"]?.default),
      cardFill,
      "palette.text.primary",
      "palette.surfaces.elevated",
      "primary text on card surface",
    ],
    [
      textColor(styles["text.body"]?.small),
      cardFill,
      "palette.text.secondary",
      "palette.surfaces.elevated",
      "secondary text on card surface",
    ],
    [
      textColor(styles["text.body"]?.default),
      calloutFill,
      "palette.text.primary",
      "palette.surfaces.subtle",
      "primary text on callout surface",
    ],
    [
      textColor(styles["text.title"]?.cover),
      cover,
      "palette.text.inverse",
      "palette.backgrounds.inverse",
      "inverse text on inverse background",
    ],
    [
      themePackage.tokens.colors?.accent?.text,
      themePackage.tokens.colors?.accent?.fill,
      "palette.text.inverse",
      "palette.accents.primary",
      "accent text on primary accent",
    ],
    [
      textColor(styles["text.kicker"]?.default),
      canvas,
      "palette.text.accent",
      "palette.backgrounds.canvas",
      "accent text on canvas",
    ],
    [
      themePackage.tokens.colors?.status?.success?.text,
      themePackage.tokens.colors?.status?.success?.fill,
      "palette.states.success.text",
      "palette.states.success.fill",
      "success state text",
    ],
    [
      textColor(styles["surface.callout"]?.warning),
      warningFill,
      "palette.states.warning.text",
      "palette.states.warning.fill",
      "warning state text",
    ],
    [
      textColor(styles["surface.callout"]?.danger),
      dangerFill,
      "palette.states.danger.text",
      "palette.states.danger.fill",
      "danger state text",
    ],
  ].filter(isColorPair);

  for (const [
    foreground,
    background,
    foregroundPath,
    backgroundPath,
    label,
  ] of textPairs) {
    addContrastDiagnostic(
      diagnostics,
      "error",
      foreground,
      background,
      foregroundPath,
      backgroundPath,
      WCAG_TEXT_CONTRAST_THRESHOLD,
      label,
    );
  }

  const channelColors = styles["chart.primary"]?.default?.visual?.channelColors;
  const chartColors = isRecord(channelColors)
    ? Object.values(channelColors).filter(
        (color): color is string => typeof color === "string",
      )
    : [];
  const nonTextPairs = [
    [
      strokeColor(styles["surface.card"]?.default),
      cardFill,
      "palette.borders.default",
      "palette.surfaces.elevated",
      "default border on surface",
    ],
    [
      styles["connector.primary"]?.default?.connector?.stroke?.color,
      canvas,
      "palette.borders.strong",
      "palette.backgrounds.canvas",
      "strong border on surface",
    ],
    ...chartColors.map(
      (color, index) =>
        [
          color,
          canvas,
          `palette.charts.${index}`,
          "palette.backgrounds.canvas",
          `chart series ${index + 1} on canvas`,
        ] as [string, string | undefined, string, string, string],
    ),
  ].filter(isColorPair);

  for (const [
    foreground,
    background,
    foregroundPath,
    backgroundPath,
    label,
  ] of nonTextPairs) {
    addContrastDiagnostic(
      diagnostics,
      "warning",
      foreground,
      background,
      foregroundPath,
      backgroundPath,
      WCAG_NON_TEXT_CONTRAST_THRESHOLD,
      label,
    );
  }
}

function parseImageAsset(
  input: Record<string, unknown>,
  path: string,
  diagnostics: BrandKitDiagnostic[],
): BrandKitImageAsset {
  const id = readString(input, "id", `${path}.id`, diagnostics) ?? "logo";
  const src = readString(input, "src", `${path}.src`, diagnostics) ?? "";
  const alt = readOptionalString(input, "alt", `${path}.alt`, diagnostics);
  const widthPx =
    input.widthPx === undefined
      ? undefined
      : readNumber(input, "widthPx", `${path}.widthPx`, diagnostics);
  const heightPx =
    input.heightPx === undefined
      ? undefined
      : readNumber(input, "heightPx", `${path}.heightPx`, diagnostics);
  const mimeType = readOptionalString(
    input,
    "mimeType",
    `${path}.mimeType`,
    diagnostics,
  ) as BrandKitImageAsset["mimeType"] | undefined;
  const contentHash = readOptionalString(
    input,
    "contentHash",
    `${path}.contentHash`,
    diagnostics,
  );

  if (mimeType && !IMAGE_MIME_TYPES.has(mimeType)) {
    addDiagnostic(
      diagnostics,
      "error",
      "invalid-image-mime",
      `${path}.mimeType is not supported`,
      `${path}.mimeType`,
    );
  }

  return {
    id,
    src,
    ...(alt === undefined ? {} : { alt }),
    ...(widthPx === undefined ? {} : { widthPx }),
    ...(heightPx === undefined ? {} : { heightPx }),
    ...(mimeType === undefined ? {} : { mimeType }),
    ...(contentHash === undefined ? {} : { contentHash }),
  };
}

function parseDraft(input: unknown): {
  draft?: BrandKitDraftV1;
  diagnostics: BrandKitDiagnostic[];
} {
  const diagnostics: BrandKitDiagnostic[] = [];
  const root = expectObject(input, "draft", diagnostics);
  if (!root) return { diagnostics };

  if (root.schemaVersion !== 1) {
    addDiagnostic(
      diagnostics,
      "error",
      "invalid-schema-version",
      "schemaVersion must be 1",
      "schemaVersion",
    );
  }

  const id = readString(root, "id", "id", diagnostics) ?? "draft";
  const name =
    readString(root, "name", "name", diagnostics) ?? "Untitled Brand Kit";
  const slug = readString(root, "slug", "slug", diagnostics) ?? "brand-kit";
  const sourcePresetId = readOptionalString(
    root,
    "sourcePresetId",
    "sourcePresetId",
    diagnostics,
  );
  const version =
    readString(root, "version", "version", diagnostics) ?? "1.0.0";

  if (!SLUG.test(slug)) {
    addDiagnostic(
      diagnostics,
      "error",
      "invalid-slug",
      "slug must be lower-case kebab-case",
      "slug",
    );
  }
  if (!SEMVERISH.test(version)) {
    addDiagnostic(
      diagnostics,
      "error",
      "invalid-version",
      "version must be semver-like",
      "version",
    );
  }

  const scope = expectObject(root.scope, "scope", diagnostics) ?? {};
  const scopeKind = readString(scope, "kind", "scope.kind", diagnostics);
  const ownerId =
    readString(scope, "ownerId", "scope.ownerId", diagnostics) ?? "owner";
  const workspaceId = readOptionalString(
    scope,
    "workspaceId",
    "scope.workspaceId",
    diagnostics,
  );
  if (scopeKind !== "user" && scopeKind !== "workspace") {
    addDiagnostic(
      diagnostics,
      "error",
      "invalid-scope",
      "scope.kind must be user or workspace",
      "scope.kind",
    );
  }
  if (scopeKind === "workspace" && !workspaceId) {
    addDiagnostic(
      diagnostics,
      "error",
      "missing-workspace",
      "workspace-scoped drafts require scope.workspaceId",
      "scope.workspaceId",
    );
  }

  const revision = expectObject(root.revision, "revision", diagnostics) ?? {};
  const revisionId =
    readString(revision, "id", "revision.id", diagnostics) ?? "r1";
  const revisionNumber =
    readNumber(revision, "number", "revision.number", diagnostics) ?? 1;
  const createdAt =
    readString(revision, "createdAt", "revision.createdAt", diagnostics) ??
    new Date(0).toISOString();
  const updatedAt = readOptionalString(
    revision,
    "updatedAt",
    "revision.updatedAt",
    diagnostics,
  );
  if (!Number.isInteger(revisionNumber) || revisionNumber < 1) {
    addDiagnostic(
      diagnostics,
      "error",
      "invalid-revision",
      "revision.number must be a positive integer",
      "revision.number",
    );
  }

  const palette = expectObject(root.palette, "palette", diagnostics) ?? {};
  const backgrounds =
    expectObject(palette.backgrounds, "palette.backgrounds", diagnostics) ?? {};
  const surfaces =
    expectObject(palette.surfaces, "palette.surfaces", diagnostics) ?? {};
  const text = expectObject(palette.text, "palette.text", diagnostics) ?? {};
  const accents =
    expectObject(palette.accents, "palette.accents", diagnostics) ?? {};
  const borders =
    expectObject(palette.borders, "palette.borders", diagnostics) ?? {};
  const states =
    expectObject(palette.states, "palette.states", diagnostics) ?? {};
  const chartValues = Array.isArray(palette.charts) ? palette.charts : [];
  if (!Array.isArray(palette.charts)) {
    addDiagnostic(
      diagnostics,
      "error",
      "missing-charts",
      "palette.charts must be an array",
      "palette.charts",
    );
  }
  if (chartValues.length < 3) {
    addDiagnostic(
      diagnostics,
      "warning",
      "sparse-chart-palette",
      "Provide at least three chart colors for distinguishable charts",
      "palette.charts",
    );
  }
  const charts = chartValues.map((value, index) => {
    if (typeof value !== "string") {
      addDiagnostic(
        diagnostics,
        "error",
        "invalid-color",
        `palette.charts.${index} must be a #RRGGBB color`,
        `palette.charts.${index}`,
      );
      return "#000000";
    }
    return validateHex(value, `palette.charts.${index}`, diagnostics);
  });

  function state(name: "success" | "warning" | "danger" | "info") {
    const stateInput =
      expectObject(states[name], `palette.states.${name}`, diagnostics) ?? {};
    return {
      fill: readColor(
        stateInput,
        "fill",
        `palette.states.${name}.fill`,
        diagnostics,
      ),
      text: readColor(
        stateInput,
        "text",
        `palette.states.${name}.text`,
        diagnostics,
      ),
    };
  }

  const typography =
    expectObject(root.typography, "typography", diagnostics) ?? {};
  function typo(
    name: "display" | "heading" | "body" | "caption" | "mono" | "data",
  ) {
    return parseTypographyRole(
      expectObject(typography[name], `typography.${name}`, diagnostics) ?? {},
      `typography.${name}`,
      diagnostics,
    );
  }

  const assets =
    root.assets === undefined
      ? undefined
      : expectObject(root.assets, "assets", diagnostics);
  const logo =
    assets?.logo === undefined
      ? undefined
      : parseImageAsset(
          expectObject(assets.logo, "assets.logo", diagnostics) ?? {},
          "assets.logo",
          diagnostics,
        );
  const fontAssetsInput =
    assets?.fonts === undefined
      ? undefined
      : expectObject(assets.fonts, "assets.fonts", diagnostics);
  const fonts =
    fontAssetsInput === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(fontAssetsInput).map(([assetId, font]) => {
            const parsed = parseFontAsset(
              expectObject(font, `assets.fonts.${assetId}`, diagnostics) ?? {},
              `assets.fonts.${assetId}`,
              diagnostics,
            );
            if (parsed.id !== assetId) {
              addDiagnostic(
                diagnostics,
                "error",
                "font-id-mismatch",
                `assets.fonts.${assetId}.id must match manifest key "${assetId}"`,
                `assets.fonts.${assetId}.id`,
              );
            }
            return [assetId, parsed];
          }),
        );
  const decorations =
    root.decorations === undefined
      ? undefined
      : expectObject(root.decorations, "decorations", diagnostics);
  const background = decorations?.background;
  if (
    background !== undefined &&
    background !== "none" &&
    background !== "subtle" &&
    background !== "expressive"
  ) {
    addDiagnostic(
      diagnostics,
      "error",
      "invalid-decoration",
      "decorations.background must be none, subtle, or expressive",
      "decorations.background",
    );
  }
  const chrome = decorations?.chrome;
  if (chrome !== undefined && chrome !== "default" && chrome !== "minimal") {
    addDiagnostic(
      diagnostics,
      "error",
      "invalid-decoration",
      "decorations.chrome must be default or minimal",
      "decorations.chrome",
    );
  }

  const scopeValue =
    scopeKind === "workspace"
      ? {
          kind: "workspace" as const,
          ownerId,
          workspaceId: workspaceId ?? "workspace",
        }
      : { kind: "user" as const, ownerId };

  const draft: BrandKitDraftV1 = {
    schemaVersion: 1,
    id,
    name,
    slug,
    scope: scopeValue,
    ...(sourcePresetId ? { sourcePresetId } : {}),
    version,
    revision: {
      id: revisionId,
      number: revisionNumber,
      createdAt,
      ...(updatedAt ? { updatedAt } : {}),
    },
    palette: {
      backgrounds: {
        canvas: readColor(
          backgrounds,
          "canvas",
          "palette.backgrounds.canvas",
          diagnostics,
        ),
        muted: readColor(
          backgrounds,
          "muted",
          "palette.backgrounds.muted",
          diagnostics,
        ),
        inverse: readColor(
          backgrounds,
          "inverse",
          "palette.backgrounds.inverse",
          diagnostics,
        ),
      },
      surfaces: {
        default: readColor(
          surfaces,
          "default",
          "palette.surfaces.default",
          diagnostics,
        ),
        elevated: readColor(
          surfaces,
          "elevated",
          "palette.surfaces.elevated",
          diagnostics,
        ),
        subtle: readColor(
          surfaces,
          "subtle",
          "palette.surfaces.subtle",
          diagnostics,
        ),
      },
      text: {
        primary: readColor(
          text,
          "primary",
          "palette.text.primary",
          diagnostics,
        ),
        secondary: readColor(
          text,
          "secondary",
          "palette.text.secondary",
          diagnostics,
        ),
        inverse: readColor(
          text,
          "inverse",
          "palette.text.inverse",
          diagnostics,
        ),
        accent: readColor(text, "accent", "palette.text.accent", diagnostics),
      },
      accents: {
        primary: readColor(
          accents,
          "primary",
          "palette.accents.primary",
          diagnostics,
        ),
        secondary: readColor(
          accents,
          "secondary",
          "palette.accents.secondary",
          diagnostics,
        ),
      },
      borders: {
        default: readColor(
          borders,
          "default",
          "palette.borders.default",
          diagnostics,
        ),
        strong: readColor(
          borders,
          "strong",
          "palette.borders.strong",
          diagnostics,
        ),
      },
      charts,
      states: {
        success: state("success"),
        warning: state("warning"),
        danger: state("danger"),
        ...(states.info === undefined ? {} : { info: state("info") }),
      },
    },
    typography: {
      display: typo("display"),
      heading: typo("heading"),
      body: typo("body"),
      caption: typo("caption"),
      mono: typo("mono"),
      data: typo("data"),
    },
    ...(logo || fonts
      ? { assets: { ...(logo ? { logo } : {}), ...(fonts ? { fonts } : {}) } }
      : {}),
    ...(decorations
      ? {
          decorations: {
            ...(background === undefined
              ? {}
              : {
                  background: background as "none" | "subtle" | "expressive",
                }),
            ...(chrome === undefined
              ? {}
              : { chrome: chrome as "default" | "minimal" }),
          },
        }
      : {}),
  };

  return { draft, diagnostics };
}

function packageIdForDraft(draft: BrandKitDraftV1): string {
  const scopePart =
    draft.scope.kind === "workspace"
      ? `workspace-${draft.scope.workspaceId}`
      : `user-${draft.scope.ownerId}`;
  return `brand-kit:${scopePart}:${draft.slug}`;
}

function fontFamilyForRole(
  role: BrandKitTypographyRole,
  draft: BrandKitDraftV1,
): string {
  if (role.fontAssetId) {
    return draft.assets?.fonts?.[role.fontAssetId]?.family ?? role.family;
  }
  if (draft.assets?.fonts?.[role.family]) {
    return draft.assets.fonts[role.family].family;
  }
  return isSlideFontId(role.family)
    ? (slideFontCssStack(role.family) ?? role.family)
    : role.family;
}

function textStyle(
  role: BrandKitTypographyRole,
  color: string,
  draft: BrandKitDraftV1,
): StyleObject {
  return {
    text: {
      fontFamily: fontFamilyForRole(role, draft),
      fontSizePt: role.sizePt,
      weight: role.weight,
      color,
      lineHeight: role.lineHeight,
      ...(role.letterSpacingEm === undefined
        ? {}
        : { letterSpacingEm: role.letterSpacingEm }),
    },
  };
}

function buildStyles(draft: BrandKitDraftV1): ThemePackageV1["styles"] {
  const p = draft.palette;
  const t = draft.typography;
  const styles: Partial<ThemePackageV1["styles"]> = {
    "slide.cover": {
      default: {
        slide: {
          background: { type: "solid", color: p.backgrounds.inverse },
          accent: p.accents.primary,
          chrome: draft.decorations?.chrome ?? "minimal",
          decoration: draft.decorations?.background ?? "subtle",
        },
      },
    },
    "slide.content": {
      default: {
        slide: {
          background: { type: "solid", color: p.backgrounds.canvas },
          accent: p.accents.primary,
          chrome: draft.decorations?.chrome ?? "default",
          decoration: draft.decorations?.background ?? "subtle",
        },
      },
    },
    "slide.section": {
      default: {
        slide: {
          background: { type: "solid", color: p.backgrounds.muted },
          accent: p.accents.secondary,
          chrome: "minimal",
          decoration: draft.decorations?.background ?? "subtle",
        },
      },
    },
    "text.title": {
      default: textStyle(t.display, p.text.primary, draft),
      cover: textStyle(t.display, p.text.inverse, draft),
    },
    "text.subtitle": {
      default: textStyle(t.heading, p.text.secondary, draft),
      cover: textStyle(t.heading, p.text.inverse, draft),
    },
    "text.body": {
      default: textStyle(t.body, p.text.primary, draft),
      small: textStyle(t.caption, p.text.secondary, draft),
    },
    "text.kicker": {
      default: textStyle(
        {
          ...t.caption,
          weight: Math.max(t.caption.weight, 600),
          letterSpacingEm: t.caption.letterSpacingEm ?? 0.06,
        },
        p.text.accent,
        draft,
      ),
    },
    "text.caption": { default: textStyle(t.caption, p.text.secondary, draft) },
    "text.quote": {
      default: {
        ...textStyle(t.heading, p.text.primary, draft),
        text: {
          ...textStyle(t.heading, p.text.primary, draft).text,
          italic: true,
        },
      },
    },
    "text.metric": {
      default: textStyle(t.data, p.text.primary, draft),
      accent: textStyle(t.data, p.accents.primary, draft),
    },
    "surface.card": {
      default: {
        fill: { type: "solid", color: p.surfaces.elevated },
        stroke: { color: p.borders.default, widthPt: 1 },
        radius: { allPt: 8 },
      },
    },
    "surface.callout": {
      default: {
        fill: { type: "solid", color: p.surfaces.subtle },
        stroke: { color: p.borders.default, widthPt: 1 },
        radius: { allPt: 6 },
      },
      warning: {
        fill: { type: "solid", color: p.states.warning.fill },
        text: { color: p.states.warning.text },
        stroke: { color: p.states.warning.fill, widthPt: 1 },
        radius: { allPt: 6 },
      },
      danger: {
        fill: { type: "solid", color: p.states.danger.fill },
        text: { color: p.states.danger.text },
        stroke: { color: p.states.danger.fill, widthPt: 1 },
        radius: { allPt: 6 },
      },
    },
    "surface.table": {
      default: {
        fill: { type: "solid", color: p.surfaces.default },
        stroke: { color: p.borders.default, widthPt: 1 },
      },
    },
    "media.hero": {
      default: { image: { fit: "cover" }, radius: { allPt: 4 } },
    },
    "media.inline": {
      default: { image: { fit: "contain" }, radius: { allPt: 2 } },
    },
    "chart.primary": {
      default: {
        fill: { type: "solid", color: p.charts[0] ?? p.accents.primary },
        text: {
          fontFamily: fontFamilyForRole(t.caption, draft),
          fontSizePt: t.caption.sizePt,
          color: p.text.secondary,
        },
        visual: {
          channelColors: Object.fromEntries(
            p.charts.map((color, index) => [`series${index + 1}`, color]),
          ),
        },
      },
    },
    "connector.primary": {
      default: {
        connector: {
          stroke: { color: p.borders.strong, widthPt: 1.5 },
          routing: "straight",
        },
      },
    },
    "decoration.background": {
      default: {
        fill: { type: "solid", color: p.surfaces.subtle },
        opacity: draft.decorations?.background === "expressive" ? 0.4 : 0.18,
      },
    },
  };

  for (const ref of STYLE_REFS) {
    styles[ref] ??= { default: {} };
  }
  return styles as ThemePackageV1["styles"];
}

function compilePackage(draft: BrandKitDraftV1): ThemePackageV1 {
  const packageId = packageIdForDraft(draft);
  const logo = draft.assets?.logo;
  const fonts = draft.assets?.fonts;
  return {
    schemaVersion: 1,
    id: packageId,
    version: `${draft.version}+r${draft.revision.number}`,
    name: draft.name,
    tagline: draft.sourcePresetId
      ? `Custom brand kit from ${draft.sourcePresetId}`
      : "Custom brand kit",
    tokens: {
      colors: {
        canvas: {
          fill: draft.palette.backgrounds.canvas,
          text: draft.palette.text.primary,
          mutedText: draft.palette.text.secondary,
        },
        surface: {
          fill: draft.palette.surfaces.default,
          text: draft.palette.text.primary,
          mutedText: draft.palette.text.secondary,
          border: draft.palette.borders.default,
        },
        accent: {
          fill: draft.palette.accents.primary,
          text: draft.palette.text.inverse,
        },
        status: {
          danger: draft.palette.states.danger,
          warning: draft.palette.states.warning,
          success: draft.palette.states.success,
        },
      },
      fonts: {
        heading: fontFamilyForRole(draft.typography.heading, draft),
        body: fontFamilyForRole(draft.typography.body, draft),
        mono: fontFamilyForRole(draft.typography.mono, draft),
      },
      radii: { card: 8, callout: 6, media: 4 },
    },
    styles: buildStyles(draft),
    chrome: {
      ...(logo
        ? {
            logo: {
              enabled: true,
              assetId: logo.id,
              alt: logo.alt ?? `${draft.name} logo`,
              placement: "top-right",
              size: "medium",
            },
          }
        : {}),
      pageNumber: {
        enabled: true,
        format: "number-total",
        placement: "bottom-right",
      },
    },
    ...(logo || fonts
      ? {
          assets: {
            ...(logo ? { images: { [logo.id]: logo } } : {}),
            ...(fonts ? { fonts } : {}),
          },
        }
      : {}),
  };
}

export function compileBrandKitDraft(input: unknown): BrandKitCompileResult {
  const parsed = parseDraft(input);
  if (parsed.draft) {
    validateTypographyFontAssets(parsed.draft, parsed.diagnostics);
  }
  if (
    !parsed.draft ||
    parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error")
  ) {
    return { ok: false, diagnostics: parsed.diagnostics };
  }

  const themePackage = compilePackage(parsed.draft);
  validateCompiledPackageContrast(themePackage, parsed.diagnostics);
  if (
    parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error")
  ) {
    return { ok: false, diagnostics: parsed.diagnostics };
  }

  if (isBuiltInThemePackageId(themePackage.id)) {
    addDiagnostic(
      parsed.diagnostics,
      "error",
      "package-id-collision",
      "Compiled package id collides with a built-in package id",
      "slug",
    );
    return { ok: false, diagnostics: parsed.diagnostics };
  }

  const validation = validateThemePackage(themePackage);
  if (!validation.valid) {
    return {
      ok: false,
      diagnostics: [
        ...parsed.diagnostics,
        ...validation.diagnostics.map((diagnostic) => ({
          severity: "error" as const,
          code: `theme-package-${diagnostic.code}`,
          message: diagnostic.message,
          path: diagnostic.path ?? "package",
        })),
      ],
    };
  }

  return {
    ok: true,
    draft: parsed.draft,
    package: Object.freeze(validation.package),
    diagnostics: parsed.diagnostics,
  };
}

export function brandKitPackageIdForDraft(draft: BrandKitDraftV1): string {
  return packageIdForDraft(draft);
}
