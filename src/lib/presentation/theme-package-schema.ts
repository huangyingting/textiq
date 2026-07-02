/**
 * Theme package schema for presentation.
 *
 * `ThemePackageV1` is the full package contract that the style resolver and
 * render resolver consume. It must be validated before use.
 */

import type { ThemePackageId, ThemeVersion, AssetId } from "./types";
import type { StyleObject, ThemeTokens, StyleRef } from "./style-schema";
import type {
  DeckChromeConfig,
  LayoutBox,
  SemanticTemplateKind,
} from "./schema";
import type { PresentationDiagnostic } from "./diagnostics";
import type { TemplateStaticContent } from "./template-registry";

// ---------------------------------------------------------------------------
// Decoration recipe
// ---------------------------------------------------------------------------

export type { TemplateStaticContent } from "./template-registry";

export type ThemeDecorationRecipe = {
  id: string;
  component: "shape" | "image" | "text";
  role: "themeDecoration";
  layout: LayoutBox;
  style: StyleObject;
  content?: TemplateStaticContent;
  appliesTo?: {
    templateKinds?: SemanticTemplateKind[];
    layoutIds?: string[];
  };
  visibility?: "subtle" | "default" | "expressive";
  chrome?: "default" | "minimal";
};

// ---------------------------------------------------------------------------
// Package asset manifest
// ---------------------------------------------------------------------------

export type ThemeAssetManifest = {
  images?: Record<AssetId, Omit<import("./schema").ImageAsset, "origin">>;
  fonts?: Record<AssetId, import("./schema").FontAsset>;
};

// ---------------------------------------------------------------------------
// Package itself
// ---------------------------------------------------------------------------

export type ThemePackageV1 = {
  schemaVersion: 1;
  id: ThemePackageId;
  version: ThemeVersion;
  name: string;
  tagline?: string;
  tokens: ThemeTokens;
  styles: Record<StyleRef, Record<string, StyleObject>>;
  decorations?: Record<string, ThemeDecorationRecipe>;
  chrome?: Partial<DeckChromeConfig>;
  assets?: ThemeAssetManifest;
};

// ---------------------------------------------------------------------------
// Package validation
// ---------------------------------------------------------------------------

export type ThemePackageValidationResult =
  | { valid: true; package: ThemePackageV1 }
  | { valid: false; diagnostics: PresentationDiagnostic[] };

import { DiagnosticCollector } from "./diagnostics";
import { STYLE_REFS } from "./style-registry";
import { SEMANTIC_TEMPLATE_KINDS } from "./template-registry";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function resolveTokenInValue(
  value: unknown,
  tokens: ThemeTokens,
  ctx: string,
): { resolved: true } | { resolved: false; missing: string; path: string } {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const r = resolveTokenInValue(item, tokens, `${ctx}.${index}`);
      if (!r.resolved) return r;
    }
    return { resolved: true };
  }
  if (!isPlainObject(value)) return { resolved: true };
  if (typeof value.token === "string") {
    const parts = (value.token as string).split(".");
    let cursor: any = tokens;
    for (const part of parts) {
      if (!isPlainObject(cursor))
        return {
          resolved: false,
          missing: value.token as string,
          path: ctx,
        };
      cursor = cursor[part];
    }
    return cursor !== undefined
      ? { resolved: true }
      : {
          resolved: false,
          missing: value.token as string,
          path: ctx,
        };
  }
  for (const [key, child] of Object.entries(value)) {
    const r = resolveTokenInValue(child, tokens, `${ctx}.${key}`);
    if (!r.resolved) return r;
  }
  return { resolved: true };
}

const THEME_CHROME_KINDS = [
  "logo",
  "footer",
  "pageNumber",
  "watermark",
  "border",
  "safeArea",
] as const;

const DECORATION_COMPONENTS = ["shape", "image", "text"] as const;
const DECORATION_VISIBILITY = ["subtle", "default", "expressive"] as const;
const DECORATION_CHROME = ["default", "minimal"] as const;
const DECORATION_ROLE = "themeDecoration";
const LAYOUT_ANCHORS = ["topLeft", "center"] as const;
const STYLE_KEYS = new Set([
  "text",
  "fill",
  "stroke",
  "radius",
  "opacity",
  "shadow",
  "effect",
  "image",
  "connector",
  "table",
  "slide",
  "visual",
  "clip",
  "blendMode",
]);
const STYLE_FILL_TYPES = [
  "solid",
  "linearGradient",
  "radialGradient",
  "conicGradient",
  "repeatingLinearGradient",
  "pattern",
  "image",
] as const;
const STYLE_PATTERN_FILL_KINDS = [
  "grid",
  "dots",
  "stripes",
  "scanlines",
] as const;
const STYLE_BLEND_MODES = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
] as const;
const STYLE_IMAGE_FITS = ["contain", "cover", "fill", "none"] as const;
const STYLE_IMAGE_MASKS = [
  "none",
  "rect",
  "circle",
  "ellipse",
  "rounded",
  "diamond",
  "triangle",
] as const;
const STYLE_CONNECTOR_ARROWS = ["none", "arrow", "filled"] as const;
const STYLE_CONNECTOR_ROUTING = ["straight", "elbow", "curved"] as const;
const STYLE_SLIDE_CHROME = ["default", "minimal", "none"] as const;
const STYLE_SLIDE_DECORATION = [
  "none",
  "subtle",
  "default",
  "expressive",
] as const;
const STYLE_EFFECT_KINDS = ["none", "glass", "blur", "glow"] as const;
const STYLE_EFFECT_GLASS_INTENSITIES = ["light", "medium", "strong"] as const;
const IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
] as const;
const FONT_STYLES = ["normal", "italic"] as const;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validateKnownKeys(
  input: Record<string, unknown>,
  ctx: string,
  allowed: Set<string>,
  description: string,
  errors: string[],
): void {
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      errors.push(`${ctx}.${key} is not a known ${description}`);
    }
  }
}

function validateDecorationLayout(
  input: unknown,
  ctx: string,
  errors: string[],
): void {
  if (!isPlainObject(input)) {
    errors.push(`${ctx} must be an object`);
    return;
  }
  validateKnownKeys(
    input,
    ctx,
    new Set([
      "frame",
      "rotation",
      "zIndex",
      "autoHeight",
      "flipX",
      "flipY",
      "anchor",
      "constraints",
    ]),
    "layout field",
    errors,
  );
  if (!isPlainObject(input.frame)) {
    errors.push(`${ctx}.frame must be an object`);
  } else {
    for (const key of ["x", "y", "w", "h"] as const) {
      if (!isFiniteNumber(input.frame[key])) {
        errors.push(`${ctx}.frame.${key} must be a finite number`);
      }
    }
    if (
      typeof input.frame.w === "number" &&
      typeof input.frame.h === "number" &&
      (input.frame.w <= 0 || input.frame.h <= 0)
    ) {
      errors.push(`${ctx}.frame.w and ${ctx}.frame.h must be greater than 0`);
    }
  }
  if (!Number.isInteger(input.zIndex)) {
    errors.push(`${ctx}.zIndex must be an integer`);
  }
  if (input.rotation !== undefined && !isFiniteNumber(input.rotation)) {
    errors.push(`${ctx}.rotation must be a finite number`);
  }
  if (input.autoHeight !== undefined && typeof input.autoHeight !== "boolean") {
    errors.push(`${ctx}.autoHeight must be a boolean`);
  }
  if (input.flipX !== undefined && typeof input.flipX !== "boolean") {
    errors.push(`${ctx}.flipX must be a boolean`);
  }
  if (input.flipY !== undefined && typeof input.flipY !== "boolean") {
    errors.push(`${ctx}.flipY must be a boolean`);
  }
  if (
    input.anchor !== undefined &&
    !LAYOUT_ANCHORS.includes(input.anchor as (typeof LAYOUT_ANCHORS)[number])
  ) {
    errors.push(`${ctx}.anchor must be one of: ${LAYOUT_ANCHORS.join(", ")}`);
  }
  if (input.constraints !== undefined) {
    if (!isPlainObject(input.constraints)) {
      errors.push(`${ctx}.constraints must be an object`);
    } else {
      validateKnownKeys(
        input.constraints,
        `${ctx}.constraints`,
        new Set(["minW", "minH", "maxW", "maxH", "preserveAspectRatio"]),
        "constraints field",
        errors,
      );
      for (const key of ["minW", "minH", "maxW", "maxH"] as const) {
        if (
          input.constraints[key] !== undefined &&
          !isFiniteNumber(input.constraints[key])
        ) {
          errors.push(`${ctx}.constraints.${key} must be a finite number`);
        }
      }
      if (
        input.constraints.preserveAspectRatio !== undefined &&
        typeof input.constraints.preserveAspectRatio !== "boolean"
      ) {
        errors.push(`${ctx}.constraints.preserveAspectRatio must be a boolean`);
      }
    }
  }
}

function validateDecorationStyle(
  input: unknown,
  ctx: string,
  errors: string[],
): string[] {
  const assetRefs: string[] = [];
  if (!isPlainObject(input)) {
    errors.push(`${ctx} must be an object`);
    return assetRefs;
  }
  validateKnownKeys(input, ctx, STYLE_KEYS, "style field", errors);

  if (input.opacity !== undefined && !isFiniteNumber(input.opacity)) {
    errors.push(`${ctx}.opacity must be a finite number`);
  }
  if (input.blendMode !== undefined) {
    validateChromeEnum(
      input.blendMode,
      STYLE_BLEND_MODES,
      `${ctx}.blendMode`,
      errors,
    );
  }

  if (input.fill !== undefined) {
    if (!isPlainObject(input.fill)) {
      errors.push(`${ctx}.fill must be an object`);
    } else {
      validateChromeEnum(
        input.fill.type,
        STYLE_FILL_TYPES,
        `${ctx}.fill.type`,
        errors,
      );
      if (input.fill.type === "image") {
        if (!isNonEmptyString(input.fill.assetId)) {
          errors.push(`${ctx}.fill.assetId must be a non-empty string`);
        } else {
          assetRefs.push(input.fill.assetId);
        }
        if (
          input.fill.opacity !== undefined &&
          !isFiniteNumber(input.fill.opacity)
        ) {
          errors.push(`${ctx}.fill.opacity must be a finite number`);
        }
      }
      if (input.fill.type === "pattern") {
        validateChromeEnum(
          input.fill.kind,
          STYLE_PATTERN_FILL_KINDS,
          `${ctx}.fill.kind`,
          errors,
        );
      }
    }
  }

  if (input.image !== undefined) {
    if (!isPlainObject(input.image)) {
      errors.push(`${ctx}.image must be an object`);
    } else {
      validateChromeEnum(
        input.image.fit,
        STYLE_IMAGE_FITS,
        `${ctx}.image.fit`,
        errors,
      );
      validateChromeEnum(
        input.image.maskShape,
        STYLE_IMAGE_MASKS,
        `${ctx}.image.maskShape`,
        errors,
      );
    }
  }

  if (input.connector !== undefined) {
    if (!isPlainObject(input.connector)) {
      errors.push(`${ctx}.connector must be an object`);
    } else {
      validateChromeEnum(
        input.connector.startArrow,
        STYLE_CONNECTOR_ARROWS,
        `${ctx}.connector.startArrow`,
        errors,
      );
      validateChromeEnum(
        input.connector.endArrow,
        STYLE_CONNECTOR_ARROWS,
        `${ctx}.connector.endArrow`,
        errors,
      );
      validateChromeEnum(
        input.connector.routing,
        STYLE_CONNECTOR_ROUTING,
        `${ctx}.connector.routing`,
        errors,
      );
    }
  }

  if (input.slide !== undefined) {
    if (!isPlainObject(input.slide)) {
      errors.push(`${ctx}.slide must be an object`);
    } else {
      validateChromeEnum(
        input.slide.chrome,
        STYLE_SLIDE_CHROME,
        `${ctx}.slide.chrome`,
        errors,
      );
      validateChromeEnum(
        input.slide.decoration,
        STYLE_SLIDE_DECORATION,
        `${ctx}.slide.decoration`,
        errors,
      );
    }
  }

  if (input.effect !== undefined) {
    if (!isPlainObject(input.effect)) {
      errors.push(`${ctx}.effect must be an object`);
    } else {
      validateChromeEnum(
        input.effect.kind,
        STYLE_EFFECT_KINDS,
        `${ctx}.effect.kind`,
        errors,
      );
      if (input.effect.kind === "glass") {
        validateChromeEnum(
          input.effect.intensity,
          STYLE_EFFECT_GLASS_INTENSITIES,
          `${ctx}.effect.intensity`,
          errors,
        );
      }
    }
  }

  return assetRefs;
}

function validateDecorationContent(
  input: unknown,
  component: unknown,
  ctx: string,
  errors: string[],
): { imageAssetId?: string } {
  if (input === undefined) {
    if (component === "image" || component === "text") {
      errors.push(`${ctx} is required when component is "${component}"`);
    }
    return {};
  }

  if (!isPlainObject(input)) {
    errors.push(`${ctx} must be an object`);
    return {};
  }

  validateChromeEnum(
    input.type,
    ["text", "shape", "image"],
    `${ctx}.type`,
    errors,
  );

  if (input.type === "text") {
    validateKnownKeys(
      input,
      ctx,
      new Set(["type", "text"]),
      "content field",
      errors,
    );
    if (!isNonEmptyString(input.text)) {
      errors.push(`${ctx}.text must be a non-empty string`);
    }
    if (component !== "text") {
      errors.push(`${ctx}.type must match component "${component}"`);
    }
    return {};
  }

  if (input.type === "shape") {
    validateKnownKeys(
      input,
      ctx,
      new Set(["type", "shape"]),
      "content field",
      errors,
    );
    if (!isNonEmptyString(input.shape)) {
      errors.push(`${ctx}.shape must be a non-empty string`);
    }
    if (component !== "shape") {
      errors.push(`${ctx}.type must match component "${component}"`);
    }
    return {};
  }

  if (input.type === "image") {
    validateKnownKeys(
      input,
      ctx,
      new Set(["type", "assetId"]),
      "content field",
      errors,
    );
    if (!isNonEmptyString(input.assetId)) {
      errors.push(`${ctx}.assetId must be a non-empty string`);
      return {};
    }
    if (component !== "image") {
      errors.push(`${ctx}.type must match component "${component}"`);
    }
    return { imageAssetId: input.assetId };
  }

  return {};
}

function validateDecorations(
  input: unknown,
  tokens: ThemeTokens,
  ctx: string,
  errors: string[],
): Array<{ assetId: string; path: string }> {
  const imageAssetRefs: Array<{ assetId: string; path: string }> = [];
  if (input === undefined) return imageAssetRefs;
  if (!isPlainObject(input)) {
    errors.push(`${ctx} must be an object`);
    return imageAssetRefs;
  }

  const semanticTemplateKinds = new Set<string>(SEMANTIC_TEMPLATE_KINDS);

  for (const [decorationId, recipe] of Object.entries(input)) {
    const recipeCtx = `${ctx}.${decorationId}`;
    if (!isPlainObject(recipe)) {
      errors.push(`${recipeCtx} must be an object`);
      continue;
    }
    validateKnownKeys(
      recipe,
      recipeCtx,
      new Set([
        "id",
        "component",
        "role",
        "layout",
        "style",
        "content",
        "appliesTo",
        "visibility",
        "chrome",
      ]),
      "decoration field",
      errors,
    );

    if (!isNonEmptyString(recipe.id)) {
      errors.push(`${recipeCtx}.id must be a non-empty string`);
    } else if (recipe.id !== decorationId) {
      errors.push(`${recipeCtx}.id must match registry key "${decorationId}"`);
    }

    validateChromeEnum(
      recipe.component,
      DECORATION_COMPONENTS,
      `${recipeCtx}.component`,
      errors,
    );
    if (recipe.role !== DECORATION_ROLE) {
      errors.push(`${recipeCtx}.role must be "${DECORATION_ROLE}"`);
    }

    validateDecorationLayout(recipe.layout, `${recipeCtx}.layout`, errors);
    const styleAssetRefs = validateDecorationStyle(
      recipe.style,
      `${recipeCtx}.style`,
      errors,
    );
    for (const assetId of styleAssetRefs) {
      imageAssetRefs.push({ assetId, path: `${recipeCtx}.style.fill.assetId` });
    }

    const resolved = resolveTokenInValue(
      recipe.style,
      tokens,
      `${recipeCtx}.style`,
    );
    if (!resolved.resolved) {
      errors.push(
        `${recipeCtx}.style references unknown token "${resolved.missing}" at ${resolved.path}`,
      );
    }

    const content = validateDecorationContent(
      recipe.content,
      recipe.component,
      `${recipeCtx}.content`,
      errors,
    );
    if (content.imageAssetId) {
      imageAssetRefs.push({
        assetId: content.imageAssetId,
        path: `${recipeCtx}.content.assetId`,
      });
    }

    if (recipe.appliesTo !== undefined) {
      if (!isPlainObject(recipe.appliesTo)) {
        errors.push(`${recipeCtx}.appliesTo must be an object`);
      } else {
        validateKnownKeys(
          recipe.appliesTo,
          `${recipeCtx}.appliesTo`,
          new Set(["templateKinds", "layoutIds"]),
          "appliesTo field",
          errors,
        );
        if (recipe.appliesTo.templateKinds !== undefined) {
          if (!Array.isArray(recipe.appliesTo.templateKinds)) {
            errors.push(
              `${recipeCtx}.appliesTo.templateKinds must be an array`,
            );
          } else {
            for (const [
              index,
              kind,
            ] of recipe.appliesTo.templateKinds.entries()) {
              if (
                typeof kind !== "string" ||
                !semanticTemplateKinds.has(kind)
              ) {
                errors.push(
                  `${recipeCtx}.appliesTo.templateKinds.${index} must be one of: ${SEMANTIC_TEMPLATE_KINDS.join(", ")}`,
                );
              }
            }
          }
        }
        if (recipe.appliesTo.layoutIds !== undefined) {
          if (!Array.isArray(recipe.appliesTo.layoutIds)) {
            errors.push(`${recipeCtx}.appliesTo.layoutIds must be an array`);
          } else {
            for (const [
              index,
              layoutId,
            ] of recipe.appliesTo.layoutIds.entries()) {
              if (!isNonEmptyString(layoutId)) {
                errors.push(
                  `${recipeCtx}.appliesTo.layoutIds.${index} must be a non-empty string`,
                );
              }
            }
          }
        }
      }
    }

    validateChromeEnum(
      recipe.visibility,
      DECORATION_VISIBILITY,
      `${recipeCtx}.visibility`,
      errors,
    );
    validateChromeEnum(
      recipe.chrome,
      DECORATION_CHROME,
      `${recipeCtx}.chrome`,
      errors,
    );
  }

  return imageAssetRefs;
}

function validateThemeAssetManifest(
  input: unknown,
  ctx: string,
  errors: string[],
): Set<string> {
  const imageIds = new Set<string>();
  if (input === undefined) return imageIds;
  if (!isPlainObject(input)) {
    errors.push(`${ctx} must be an object`);
    return imageIds;
  }

  validateKnownKeys(
    input,
    ctx,
    new Set(["images", "fonts"]),
    "asset manifest field",
    errors,
  );

  if (input.images !== undefined) {
    if (!isPlainObject(input.images)) {
      errors.push(`${ctx}.images must be an object`);
    } else {
      for (const [assetId, image] of Object.entries(input.images)) {
        const imageCtx = `${ctx}.images.${assetId}`;
        if (!isPlainObject(image)) {
          errors.push(`${imageCtx} must be an object`);
          continue;
        }
        validateKnownKeys(
          image,
          imageCtx,
          new Set([
            "id",
            "src",
            "alt",
            "widthPx",
            "heightPx",
            "mimeType",
            "contentHash",
          ]),
          "image asset field",
          errors,
        );
        if (!isNonEmptyString(image.id)) {
          errors.push(`${imageCtx}.id must be a non-empty string`);
        } else if (image.id !== assetId) {
          errors.push(`${imageCtx}.id must match manifest key "${assetId}"`);
        }
        if (!isNonEmptyString(image.src)) {
          errors.push(`${imageCtx}.src must be a non-empty string`);
        }
        if (image.alt !== undefined && typeof image.alt !== "string") {
          errors.push(`${imageCtx}.alt must be a string`);
        }
        if (image.widthPx !== undefined && !isFiniteNumber(image.widthPx)) {
          errors.push(`${imageCtx}.widthPx must be a finite number`);
        }
        if (image.heightPx !== undefined && !isFiniteNumber(image.heightPx)) {
          errors.push(`${imageCtx}.heightPx must be a finite number`);
        }
        validateChromeEnum(
          image.mimeType,
          IMAGE_MIME_TYPES,
          `${imageCtx}.mimeType`,
          errors,
        );
        if (
          image.contentHash !== undefined &&
          typeof image.contentHash !== "string"
        ) {
          errors.push(`${imageCtx}.contentHash must be a string`);
        }
        imageIds.add(assetId);
      }
    }
  }

  if (input.fonts !== undefined) {
    if (!isPlainObject(input.fonts)) {
      errors.push(`${ctx}.fonts must be an object`);
    } else {
      for (const [assetId, font] of Object.entries(input.fonts)) {
        const fontCtx = `${ctx}.fonts.${assetId}`;
        if (!isPlainObject(font)) {
          errors.push(`${fontCtx} must be an object`);
          continue;
        }
        validateKnownKeys(
          font,
          fontCtx,
          new Set(["id", "family", "src", "weight", "style", "contentHash"]),
          "font asset field",
          errors,
        );
        if (!isNonEmptyString(font.id)) {
          errors.push(`${fontCtx}.id must be a non-empty string`);
        } else if (font.id !== assetId) {
          errors.push(`${fontCtx}.id must match manifest key "${assetId}"`);
        }
        if (!isNonEmptyString(font.family)) {
          errors.push(`${fontCtx}.family must be a non-empty string`);
        }
        if (!isNonEmptyString(font.src)) {
          errors.push(`${fontCtx}.src must be a non-empty string`);
        }
        if (font.weight !== undefined) {
          if (Array.isArray(font.weight)) {
            for (const [index, weight] of font.weight.entries()) {
              if (!isFiniteNumber(weight)) {
                errors.push(
                  `${fontCtx}.weight.${index} must be a finite number`,
                );
              }
            }
          } else if (!isFiniteNumber(font.weight)) {
            errors.push(
              `${fontCtx}.weight must be a finite number or number[]`,
            );
          }
        }
        validateChromeEnum(font.style, FONT_STYLES, `${fontCtx}.style`, errors);
        if (
          font.contentHash !== undefined &&
          typeof font.contentHash !== "string"
        ) {
          errors.push(`${fontCtx}.contentHash must be a string`);
        }
      }
    }
  }

  return imageIds;
}

function validateChromeEnum(
  value: unknown,
  allowed: readonly string[],
  ctx: string,
  errors: string[],
): void {
  if (value !== undefined && !allowed.includes(value as string)) {
    errors.push(`${ctx} must be one of: ${allowed.join(", ")}`);
  }
}

function validateChromeString(
  value: unknown,
  ctx: string,
  errors: string[],
): void {
  if (value !== undefined && typeof value !== "string") {
    errors.push(`${ctx} must be a string`);
  }
}

function validateChromeNumber(
  value: unknown,
  ctx: string,
  errors: string[],
): void {
  if (value !== undefined && !isFiniteNumber(value)) {
    errors.push(`${ctx} must be a finite number`);
  }
}

function validateChromeLayout(
  value: unknown,
  ctx: string,
  errors: string[],
): void {
  if (!isPlainObject(value)) {
    errors.push(`${ctx} must be an object`);
    return;
  }
  if (!isPlainObject(value.frame)) {
    errors.push(`${ctx}.frame must be an object`);
  } else {
    for (const key of ["x", "y", "w", "h"] as const) {
      if (!isFiniteNumber(value.frame[key])) {
        errors.push(`${ctx}.frame.${key} must be a finite number`);
      }
    }
  }
  if (!Number.isInteger(value.zIndex)) {
    errors.push(`${ctx}.zIndex must be an integer`);
  }
}

function validateChromeInsets(
  value: unknown,
  ctx: string,
  errors: string[],
): void {
  if (!isPlainObject(value)) {
    errors.push(`${ctx} must be an object`);
    return;
  }
  for (const key of ["top", "right", "bottom", "left"] as const) {
    if (!isFiniteNumber(value[key])) {
      errors.push(`${ctx}.${key} must be a finite number`);
    }
  }
}

function validateChromeItem(
  input: unknown,
  ctx: string,
  allowedSpecificKeys: readonly string[],
  errors: string[],
): Record<string, unknown> | undefined {
  if (!isPlainObject(input)) {
    errors.push(`${ctx} must be an object`);
    return undefined;
  }
  const allowed = new Set([
    "enabled",
    "layout",
    "style",
    "layer",
    ...allowedSpecificKeys,
  ]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      errors.push(`${ctx}.${key} is not a known chrome field`);
    }
  }
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") {
    errors.push(`${ctx}.enabled must be a boolean`);
  }
  validateChromeEnum(
    input.layer,
    ["background", "foreground"],
    `${ctx}.layer`,
    errors,
  );
  if (input.layout !== undefined) {
    validateChromeLayout(input.layout, `${ctx}.layout`, errors);
  }
  return input;
}

function validateThemeChrome(input: unknown, ctx: string): string[] {
  const errors: string[] = [];
  if (input === undefined) return errors;
  if (!isPlainObject(input)) {
    return [`${ctx} must be an object`];
  }
  for (const key of Object.keys(input)) {
    if (
      !THEME_CHROME_KINDS.includes(key as (typeof THEME_CHROME_KINDS)[number])
    ) {
      errors.push(`${ctx}.${key} is not a known chrome slot`);
    }
  }
  if (input.logo !== undefined) {
    const logo = validateChromeItem(
      input.logo,
      `${ctx}.logo`,
      ["assetId", "alt", "placement", "size"],
      errors,
    );
    if (logo) {
      validateChromeString(logo.assetId, `${ctx}.logo.assetId`, errors);
      validateChromeString(logo.alt, `${ctx}.logo.alt`, errors);
      validateChromeEnum(
        logo.placement,
        ["top-left", "top-right", "bottom-left", "bottom-right"],
        `${ctx}.logo.placement`,
        errors,
      );
      validateChromeEnum(
        logo.size,
        ["small", "medium", "large"],
        `${ctx}.logo.size`,
        errors,
      );
    }
  }

  if (input.footer !== undefined) {
    const footer = validateChromeItem(
      input.footer,
      `${ctx}.footer`,
      ["text", "align"],
      errors,
    );
    if (footer) {
      validateChromeString(footer.text, `${ctx}.footer.text`, errors);
      validateChromeEnum(
        footer.align,
        ["left", "center", "right"],
        `${ctx}.footer.align`,
        errors,
      );
    }
  }

  if (input.pageNumber !== undefined) {
    const pageNumber = validateChromeItem(
      input.pageNumber,
      `${ctx}.pageNumber`,
      ["format", "placement"],
      errors,
    );
    if (pageNumber) {
      validateChromeEnum(
        pageNumber.format,
        ["number", "number-total"],
        `${ctx}.pageNumber.format`,
        errors,
      );
      validateChromeEnum(
        pageNumber.placement,
        ["bottom-left", "bottom-center", "bottom-right"],
        `${ctx}.pageNumber.placement`,
        errors,
      );
    }
  }

  if (input.watermark !== undefined) {
    const watermark = validateChromeItem(
      input.watermark,
      `${ctx}.watermark`,
      ["text", "opacity", "layoutMode", "size"],
      errors,
    );
    if (watermark) {
      validateChromeString(watermark.text, `${ctx}.watermark.text`, errors);
      validateChromeNumber(
        watermark.opacity,
        `${ctx}.watermark.opacity`,
        errors,
      );
      validateChromeEnum(
        watermark.layoutMode,
        ["center", "diagonal"],
        `${ctx}.watermark.layoutMode`,
        errors,
      );
      validateChromeEnum(
        watermark.size,
        ["small", "medium", "large"],
        `${ctx}.watermark.size`,
        errors,
      );
    }
  }

  if (input.border !== undefined) {
    const border = validateChromeItem(
      input.border,
      `${ctx}.border`,
      ["color", "widthPt"],
      errors,
    );
    if (border) {
      validateChromeString(border.color, `${ctx}.border.color`, errors);
      validateChromeNumber(border.widthPt, `${ctx}.border.widthPt`, errors);
    }
  }

  if (input.safeArea !== undefined) {
    const safeArea = validateChromeItem(
      input.safeArea,
      `${ctx}.safeArea`,
      ["insets", "color", "widthPt"],
      errors,
    );
    if (safeArea) {
      validateChromeString(safeArea.color, `${ctx}.safeArea.color`, errors);
      validateChromeNumber(safeArea.widthPt, `${ctx}.safeArea.widthPt`, errors);
      if (safeArea.insets !== undefined) {
        validateChromeInsets(safeArea.insets, `${ctx}.safeArea.insets`, errors);
      }
    }
  }
  return errors;
}

/** Validates a ThemePackageV1 manifest. Returns diagnostics for every issue found. */
export function validateThemePackage(
  input: unknown,
): ThemePackageValidationResult {
  const dc = new DiagnosticCollector();
  const topLevelValidationErrors: string[] = [];
  const topLevelAllowedKeys = new Set([
    "schemaVersion",
    "id",
    "version",
    "name",
    "tagline",
    "tokens",
    "styles",
    "decorations",
    "chrome",
    "assets",
  ]);

  if (!isPlainObject(input)) {
    dc.fatal("missing-style-default", "Theme package must be an object");
    return { valid: false, diagnostics: dc.diagnostics };
  }

  if (input.schemaVersion !== 1) {
    dc.fatal(
      "invalid-schema-version",
      `Theme package schemaVersion must be 1 (got ${input.schemaVersion})`,
    );
    return { valid: false, diagnostics: dc.diagnostics };
  }

  validateKnownKeys(
    input,
    "ThemePackage",
    topLevelAllowedKeys,
    "theme package field",
    topLevelValidationErrors,
  );
  for (const error of topLevelValidationErrors) {
    dc.error("unknown-field", error, {
      target: { scope: "theme" },
    });
  }

  if (typeof input.id !== "string" || input.id.length === 0) {
    dc.error("unknown-field", "Theme package id must be a non-empty string");
  }

  if (typeof input.version !== "string" || input.version.length === 0) {
    dc.error(
      "unknown-field",
      "Theme package version must be a non-empty string",
    );
  }

  if (!isPlainObject(input.tokens)) {
    dc.error("missing-token", "Theme package tokens must be an object");
  } else {
    // Check required token sub-structure exists
    const tokens = input.tokens as ThemeTokens;
    if (!isPlainObject(tokens.colors)) {
      dc.error("missing-token", "tokens.colors must be an object");
    }
    if (!isPlainObject(tokens.fonts)) {
      dc.error("missing-token", "tokens.fonts must be an object");
    }
  }

  if (!isPlainObject(input.styles)) {
    dc.error("missing-style-default", "Theme package styles must be an object");
  } else {
    const styles = input.styles as Record<string, unknown>;
    const tokens = (input.tokens ?? {}) as ThemeTokens;

    // Every registered style ref must have a default variant
    for (const ref of STYLE_REFS) {
      if (!isPlainObject(styles[ref])) {
        dc.error(
          "missing-style-default",
          `Theme package is missing style ref "${ref}"`,
          { path: `styles.${ref}` },
        );
        continue;
      }
      const variants = styles[ref] as Record<string, unknown>;
      if (!isPlainObject(variants.default)) {
        dc.error(
          "missing-style-default",
          `Theme package style "${ref}" is missing the "default" variant`,
          { path: `styles.${ref}.default` },
        );
      }
      // Validate token refs within styles
      for (const [variantId, styleObj] of Object.entries(variants)) {
        const variantPath = `styles.${ref}.${variantId}`;
        const r = resolveTokenInValue(styleObj, tokens, variantPath);
        if (!r.resolved) {
          dc.error(
            "missing-token",
            `Style "${ref}/${variantId}" references unknown token "${r.missing}"`,
            { path: r.path },
          );
        }
      }
    }
  }

  if (input.chrome !== undefined) {
    const chromeErrors = validateThemeChrome(
      input.chrome,
      "ThemePackage.chrome",
    );
    for (const error of chromeErrors) {
      dc.error("unknown-field", error, {
        path: "chrome",
        target: { scope: "theme" },
      });
    }
  }

  const assetErrors: string[] = [];
  const packageImageAssets = validateThemeAssetManifest(
    input.assets,
    "ThemePackage.assets",
    assetErrors,
  );
  const decorationErrors: string[] = [];
  const decorationAssetRefs = validateDecorations(
    input.decorations,
    (input.tokens ?? {}) as ThemeTokens,
    "ThemePackage.decorations",
    decorationErrors,
  );
  for (const error of decorationErrors) {
    if (error.includes("unknown token")) {
      dc.error("missing-token", error, {
        path: "decorations",
        target: { scope: "theme" },
      });
    } else {
      dc.error("unknown-field", error, {
        path: "decorations",
        target: { scope: "theme" },
      });
    }
  }

  for (const error of assetErrors) {
    dc.error("unknown-field", error, {
      path: "assets",
      target: { scope: "theme" },
    });
  }

  for (const assetRef of decorationAssetRefs) {
    if (!packageImageAssets.has(assetRef.assetId)) {
      dc.error(
        "missing-asset",
        `Theme package decoration references missing image asset "${assetRef.assetId}"`,
        {
          path: assetRef.path,
          target: { scope: "theme" },
        },
      );
    }
  }

  if (dc.hasErrors()) {
    return { valid: false, diagnostics: dc.diagnostics };
  }

  return { valid: true, package: input as ThemePackageV1 };
}
