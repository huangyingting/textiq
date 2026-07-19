/**
 * Safe parse / validation for presentation deck JSON.
 *
 * `safeParseDeck` is the public entry point. It accepts only structurally
 * valid presentation decks and returns typed errors for anything else.
 *
 * Repair is NOT done here. Repair happens only at import, migration, paste, and
 * AI-plan boundaries before the value is saved.
 */

import type { Deck } from "./schema";
import { DECK_SCHEMA_VERSION } from "./schema";
import { isValidId, isPositiveFinite } from "./ids";
import { isStyleRef } from "./style-registry";
import { SEMANTIC_TEMPLATE_KINDS } from "./template-registry";
import {
  isLiteralMember,
  isValidationFiniteNumber as isFiniteNumber,
  isValidationNonEmptyString,
  isValidationPlainObject as isPlainObject,
} from "@/lib/validation-primitives";

// ---------------------------------------------------------------------------
// Public parse result
// ---------------------------------------------------------------------------

export type DeckParseResult =
  { success: true; data: Deck } | { success: false; errors: string[] };

export const DECK_VALIDATION_CODES = [
  "duplicate_id",
  "invalid_limit",
  "invalid_structure",
  "invalid_type",
  "invalid_value",
  "invalid_version",
  "unsupported_property",
  "validation_internal_error",
] as const;

export type DeckValidationCode = (typeof DECK_VALIDATION_CODES)[number];

const DECK_VALIDATION_CODE_SET: ReadonlySet<string> = new Set(
  DECK_VALIDATION_CODES,
);

export function isDeckValidationCode(
  value: string,
): value is DeckValidationCode {
  return DECK_VALIDATION_CODE_SET.has(value);
}

/** Validates and parses an unknown value as a presentation deck. Does not mutate input. */
export function safeParseDeck(input: unknown): DeckParseResult {
  const errors: string[] = [];
  try {
    const deck = validateDeck(input, errors);
    if (errors.length > 0) {
      return { success: false, errors };
    }
    return { success: true, data: deck as Deck };
  } catch {
    return {
      success: false,
      errors: [
        ...errors,
        formatDiagnostic(
          "validation_internal_error",
          "Deck",
          "validation could not be completed",
        ),
      ],
    };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function formatDiagnostic(
  code: DeckValidationCode,
  path: string,
  detail: string,
): string {
  return `${code}: ${path}: ${detail}`;
}

function fail(
  errors: string[],
  msg: string,
  code: DeckValidationCode = "invalid_value",
): void {
  errors.push(`${code}: ${msg}`);
}

function rejectUnknownProperties(
  input: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  ctx: string,
  errors: string[],
): void {
  const count = Object.keys(input).filter((key) => !allowed.has(key)).length;
  if (count > 0) {
    errors.push(
      formatDiagnostic(
        "unsupported_property",
        ctx,
        `unsupported property count=${count}`,
      ),
    );
  }
}

function validateId(
  value: unknown,
  ctx: string,
  errors: string[],
): string | undefined {
  if (!isValidId(value)) {
    fail(errors, `${ctx} must be a valid id (non-empty ASCII, max 128 chars)`);
    return undefined;
  }
  return value as string;
}

const SAFE_ASSET_URL_SCHEMES = ["http:", "https:", "data:"] as const;
const SAFE_TEXT_LINK_URL_SCHEMES = [
  "http:",
  "https:",
  "mailto:",
  "tel:",
] as const;
const IMAGE_ASSET_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
] as const;
const FONT_ASSET_STYLES = ["normal", "italic"] as const;
const ASSET_ORIGIN_KINDS = [
  "upload",
  "document",
  "ai",
  "theme",
  "remote",
] as const;
const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/;

function validateSafeUrlString(
  value: unknown,
  ctx: string,
  errors: string[],
  allowedSchemes: readonly string[],
): void {
  if (typeof value !== "string") {
    fail(errors, `${ctx} must be a string`);
    return;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    fail(errors, `${ctx} must be a non-empty string`);
    return;
  }
  if (CONTROL_CHAR_PATTERN.test(trimmed)) {
    fail(errors, `${ctx} must not contain control characters`);
    return;
  }
  if (
    trimmed.startsWith("//") ||
    trimmed.startsWith("\\\\") ||
    trimmed.startsWith("/\\")
  ) {
    fail(
      errors,
      `${ctx} must not be a protocol-relative URL and must use one of: ${allowedSchemes.join(", ")}`,
    );
    return;
  }
  const schemeMatch = /^([a-zA-Z][a-zA-Z\d+\-.]*):/.exec(trimmed);
  if (!schemeMatch) {
    return;
  }
  const scheme = `${schemeMatch[1].toLowerCase()}:`;
  if (!allowedSchemes.includes(scheme)) {
    fail(
      errors,
      `${ctx} must use one of the allowed URL schemes: ${allowedSchemes.join(", ")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

const CANVAS_FORMATS = ["16:9", "4:3", "square", "custom"] as const;

function validateCanvas(
  input: unknown,
  ctx: string,
  errors: string[],
): Record<string, unknown> {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return {};
  }
  const allowed = new Set(["format", "width", "height", "unit", "safeArea"]);
  rejectUnknownProperties(input, allowed, ctx, errors);
  if (
    !CANVAS_FORMATS.includes(input.format as (typeof CANVAS_FORMATS)[number])
  ) {
    fail(errors, `${ctx}.format must be one of: ${CANVAS_FORMATS.join(", ")}`);
  }
  if (!isPositiveFinite(input.width)) {
    fail(errors, `${ctx}.width must be a positive number`);
  }
  if (!isPositiveFinite(input.height)) {
    fail(errors, `${ctx}.height must be a positive number`);
  }
  if (input.unit !== "percent") {
    fail(errors, `${ctx}.unit must be "percent"`);
  }
  if (input.safeArea !== undefined) {
    validateInsetsPct(input.safeArea, `${ctx}.safeArea`, errors);
  }
  return input;
}

// ---------------------------------------------------------------------------
// Asset registry
// ---------------------------------------------------------------------------

const ASSET_REGISTRY_KEYS = new Set(["images", "fonts", "visuals", "files"]);
const IMAGE_ASSET_KEYS = new Set([
  "id",
  "src",
  "alt",
  "widthPx",
  "heightPx",
  "mimeType",
  "contentHash",
  "origin",
]);
const FONT_ASSET_KEYS = new Set([
  "id",
  "family",
  "src",
  "weight",
  "style",
  "contentHash",
]);
const VISUAL_ASSET_KEYS = new Set([
  "id",
  "visualId",
  "documentId",
  "title",
  "alt",
  "contentHash",
]);
const FILE_ASSET_KEYS = new Set([
  "id",
  "src",
  "filename",
  "mimeType",
  "contentHash",
]);
const ASSET_ORIGIN_KEYS = new Set(["kind", "sourceId", "importedAt"]);

function validateAssetIdField(
  value: unknown,
  assetId: string,
  ctx: string,
  errors: string[],
): void {
  const parsedId = validateId(value, `${ctx}.id`, errors);
  if (parsedId !== undefined && parsedId !== assetId) {
    fail(errors, `${ctx}.id must match its registry key`);
  }
}

function validateAssetOrigin(
  input: unknown,
  ctx: string,
  errors: string[],
): void {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }
  validateKnownObjectKeys(
    input,
    ctx,
    ASSET_ORIGIN_KEYS,
    "asset origin field",
    errors,
  );
  if (
    !ASSET_ORIGIN_KINDS.includes(
      input.kind as (typeof ASSET_ORIGIN_KINDS)[number],
    )
  ) {
    fail(
      errors,
      `${ctx}.kind must be one of: ${ASSET_ORIGIN_KINDS.join(", ")}`,
    );
  }
  validateOptionalString(input.sourceId, `${ctx}.sourceId`, errors);
  validateOptionalString(input.importedAt, `${ctx}.importedAt`, errors);
}

function validateImageAssetEntry(
  input: unknown,
  assetId: string,
  ctx: string,
  errors: string[],
): void {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }
  validateKnownObjectKeys(
    input,
    ctx,
    IMAGE_ASSET_KEYS,
    "image asset field",
    errors,
  );
  validateAssetIdField(input.id, assetId, ctx, errors);
  validateSafeUrlString(
    input.src,
    `${ctx}.src`,
    errors,
    SAFE_ASSET_URL_SCHEMES,
  );
  validateOptionalString(input.alt, `${ctx}.alt`, errors);
  validateOptionalFiniteNumber(input.widthPx, `${ctx}.widthPx`, errors);
  validateOptionalFiniteNumber(input.heightPx, `${ctx}.heightPx`, errors);
  validateEnumValue(
    input.mimeType,
    IMAGE_ASSET_MIME_TYPES,
    `${ctx}.mimeType`,
    errors,
  );
  validateOptionalString(input.contentHash, `${ctx}.contentHash`, errors);
  if (input.origin !== undefined) {
    validateAssetOrigin(input.origin, `${ctx}.origin`, errors);
  }
}

function validateFontAssetEntry(
  input: unknown,
  assetId: string,
  ctx: string,
  errors: string[],
): void {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }
  validateKnownObjectKeys(
    input,
    ctx,
    FONT_ASSET_KEYS,
    "font asset field",
    errors,
  );
  validateAssetIdField(input.id, assetId, ctx, errors);
  if (!isValidationNonEmptyString(input.family, "exact")) {
    fail(errors, `${ctx}.family must be a non-empty string`);
  }
  validateSafeUrlString(
    input.src,
    `${ctx}.src`,
    errors,
    SAFE_ASSET_URL_SCHEMES,
  );
  if (input.weight !== undefined) {
    if (Array.isArray(input.weight)) {
      for (let index = 0; index < input.weight.length; index++) {
        if (!isFiniteNumber(input.weight[index])) {
          fail(errors, `${ctx}.weight[${index}] must be a finite number`);
        }
      }
    } else if (!isFiniteNumber(input.weight)) {
      fail(
        errors,
        `${ctx}.weight must be a finite number or an array of finite numbers`,
      );
    }
  }
  validateEnumValue(input.style, FONT_ASSET_STYLES, `${ctx}.style`, errors);
  validateOptionalString(input.contentHash, `${ctx}.contentHash`, errors);
}

function validateVisualAssetEntry(
  input: unknown,
  assetId: string,
  ctx: string,
  errors: string[],
): void {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }
  validateKnownObjectKeys(
    input,
    ctx,
    VISUAL_ASSET_KEYS,
    "visual asset field",
    errors,
  );
  validateAssetIdField(input.id, assetId, ctx, errors);
  if (!isValidationNonEmptyString(input.visualId, "exact")) {
    fail(errors, `${ctx}.visualId must be a non-empty string`);
  }
  validateOptionalString(input.documentId, `${ctx}.documentId`, errors);
  validateOptionalString(input.title, `${ctx}.title`, errors);
  validateOptionalString(input.alt, `${ctx}.alt`, errors);
  validateOptionalString(input.contentHash, `${ctx}.contentHash`, errors);
}

function validateFileAssetEntry(
  input: unknown,
  assetId: string,
  ctx: string,
  errors: string[],
): void {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }
  validateKnownObjectKeys(
    input,
    ctx,
    FILE_ASSET_KEYS,
    "file asset field",
    errors,
  );
  validateAssetIdField(input.id, assetId, ctx, errors);
  validateSafeUrlString(
    input.src,
    `${ctx}.src`,
    errors,
    SAFE_ASSET_URL_SCHEMES,
  );
  validateOptionalString(input.filename, `${ctx}.filename`, errors);
  validateOptionalString(input.mimeType, `${ctx}.mimeType`, errors);
  validateOptionalString(input.contentHash, `${ctx}.contentHash`, errors);
}

function validateAssetRegistry(
  input: unknown,
  ctx: string,
  errors: string[],
): Record<string, unknown> {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return { images: {} };
  }
  validateKnownObjectKeys(
    input,
    ctx,
    ASSET_REGISTRY_KEYS,
    "asset registry field",
    errors,
  );
  if (!isPlainObject(input.images)) {
    fail(errors, `${ctx}.images must be an object`);
  } else {
    for (const [assetId, asset] of Object.entries(input.images)) {
      const assetCtx = `${ctx}.images[entry]`;
      validateImageAssetEntry(asset, assetId, assetCtx, errors);
    }
  }
  if (input.fonts !== undefined) {
    if (!isPlainObject(input.fonts)) {
      fail(errors, `${ctx}.fonts must be an object`);
    } else {
      for (const [assetId, asset] of Object.entries(input.fonts)) {
        const assetCtx = `${ctx}.fonts[entry]`;
        validateFontAssetEntry(asset, assetId, assetCtx, errors);
      }
    }
  }
  if (input.visuals !== undefined) {
    if (!isPlainObject(input.visuals)) {
      fail(errors, `${ctx}.visuals must be an object`);
    } else {
      for (const [assetId, asset] of Object.entries(input.visuals)) {
        const assetCtx = `${ctx}.visuals[entry]`;
        validateVisualAssetEntry(asset, assetId, assetCtx, errors);
      }
    }
  }
  if (input.files !== undefined) {
    if (!isPlainObject(input.files)) {
      fail(errors, `${ctx}.files must be an object`);
    } else {
      for (const [assetId, asset] of Object.entries(input.files)) {
        const assetCtx = `${ctx}.files[entry]`;
        validateFileAssetEntry(asset, assetId, assetCtx, errors);
      }
    }
  }
  return input;
}

// ---------------------------------------------------------------------------
// Layout box
// ---------------------------------------------------------------------------

function validateFrame(
  input: unknown,
  ctx: string,
  errors: string[],
): Record<string, unknown> {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return {};
  }
  for (const key of ["x", "y", "w", "h"] as const) {
    if (!isFiniteNumber(input[key])) {
      fail(errors, `${ctx}.${key} must be a finite number`);
    }
  }
  if (
    typeof input.w === "number" &&
    typeof input.h === "number" &&
    (input.w <= 0 || input.h <= 0)
  ) {
    fail(errors, `${ctx}: w and h must be greater than 0`);
  }
  return input;
}

function validateLayoutBox(
  input: unknown,
  ctx: string,
  errors: string[],
): Record<string, unknown> {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return {};
  }
  const allowed = new Set([
    "frame",
    "rotation",
    "zIndex",
    "autoHeight",
    "flipX",
    "flipY",
    "anchor",
    "constraints",
  ]);
  rejectUnknownProperties(input, allowed, ctx, errors);
  validateFrame(input.frame, `${ctx}.frame`, errors);
  if (!Number.isInteger(input.zIndex) || typeof input.zIndex !== "number") {
    fail(errors, `${ctx}.zIndex must be an integer`);
  }
  if (input.rotation !== undefined && !isFiniteNumber(input.rotation)) {
    fail(errors, `${ctx}.rotation must be a finite number`);
  }
  if (input.autoHeight !== undefined && typeof input.autoHeight !== "boolean") {
    fail(errors, `${ctx}.autoHeight must be a boolean`);
  }
  if (input.flipX !== undefined && typeof input.flipX !== "boolean") {
    fail(errors, `${ctx}.flipX must be a boolean`);
  }
  if (input.flipY !== undefined && typeof input.flipY !== "boolean") {
    fail(errors, `${ctx}.flipY must be a boolean`);
  }
  if (
    input.anchor !== undefined &&
    input.anchor !== "topLeft" &&
    input.anchor !== "center"
  ) {
    fail(errors, `${ctx}.anchor must be topLeft or center`);
  }
  if (input.constraints !== undefined) {
    validateLayoutConstraints(input.constraints, `${ctx}.constraints`, errors);
  }
  return input;
}

function validateLayoutConstraints(
  input: unknown,
  ctx: string,
  errors: string[],
): void {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }
  const allowed = new Set([
    "minW",
    "minH",
    "maxW",
    "maxH",
    "preserveAspectRatio",
  ]);
  rejectUnknownProperties(input, allowed, ctx, errors);
  for (const key of ["minW", "minH", "maxW", "maxH"] as const) {
    if (input[key] !== undefined && !isFiniteNumber(input[key])) {
      fail(errors, `${ctx}.${key} must be a finite number`);
    }
  }
  if (
    input.preserveAspectRatio !== undefined &&
    typeof input.preserveAspectRatio !== "boolean"
  ) {
    fail(errors, `${ctx}.preserveAspectRatio must be a boolean`);
  }
}

// ---------------------------------------------------------------------------
// Deck chrome
// ---------------------------------------------------------------------------

const DECK_CHROME_KINDS = [
  "logo",
  "footer",
  "pageNumber",
  "watermark",
  "border",
  "safeArea",
] as const;

const STYLE_PATCH_TOP_LEVEL_KEYS = new Set([
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
const TEXT_STYLE_ALIGNMENTS = ["left", "center", "right"] as const;
const TEXT_STYLE_VERTICAL_ALIGNMENTS = ["top", "middle", "bottom"] as const;
const TEXT_STYLE_TRANSFORMS = ["none", "uppercase"] as const;
const FILL_TYPES = [
  "solid",
  "linearGradient",
  "radialGradient",
  "conicGradient",
  "repeatingLinearGradient",
  "pattern",
  "image",
] as const;
const PATTERN_FILL_KINDS = ["grid", "dots", "stripes", "scanlines"] as const;
const STROKE_DASHES = ["solid", "dashed", "dotted"] as const;
const EFFECT_KINDS = ["none", "glass", "blur", "glow"] as const;
const EFFECT_GLASS_INTENSITIES = ["light", "medium", "strong"] as const;
const STYLE_IMAGE_FIT_MODES = ["contain", "cover", "fill", "none"] as const;
const IMAGE_MASK_SHAPES = [
  "none",
  "rect",
  "circle",
  "ellipse",
  "rounded",
  "diamond",
  "triangle",
] as const;
const CONNECTOR_ANCHOR_KINDS = [
  "center",
  "top",
  "right",
  "bottom",
  "left",
] as const;
const CONNECTOR_ARROW_KINDS = ["none", "arrow", "filled"] as const;
const CONNECTOR_ROUTING_KINDS = ["straight", "elbow", "curved"] as const;
const SLIDE_SURFACE_CHROME = ["default", "minimal", "none"] as const;
const SLIDE_SURFACE_DECORATION = ["none", "subtle", "default", "expressive"];
const BLEND_MODES = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
] as const;

function validateKnownObjectKeys(
  input: Record<string, unknown>,
  ctx: string,
  allowed: Set<string>,
  _fieldDescription: string,
  errors: string[],
): void {
  rejectUnknownProperties(input, allowed, ctx, errors);
}

function validateTokenRef(input: unknown, ctx: string, errors: string[]): void {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be a token reference object`);
    return;
  }
  validateKnownObjectKeys(
    input,
    ctx,
    new Set(["token"]),
    "token ref field",
    errors,
  );
  if (!isValidationNonEmptyString(input.token, "exact")) {
    fail(errors, `${ctx}.token must be a non-empty string`);
  }
}

function validateColorValue(
  input: unknown,
  ctx: string,
  errors: string[],
): void {
  if (typeof input === "string") return;
  if (isPlainObject(input)) {
    validateTokenRef(input, ctx, errors);
    return;
  }
  fail(errors, `${ctx} must be a string or token reference`);
}

function validateColorOrTokenString(
  input: unknown,
  ctx: string,
  errors: string[],
): void {
  if (typeof input === "string") return;
  if (isPlainObject(input)) {
    validateTokenRef(input, ctx, errors);
    return;
  }
  fail(errors, `${ctx} must be a string or token reference`);
}

function validateInsetsPatch(
  input: unknown,
  ctx: string,
  errors: string[],
): void {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }
  const allowed = new Set(["top", "right", "bottom", "left"]);
  validateKnownObjectKeys(input, ctx, allowed, "inset field", errors);
  for (const key of ["top", "right", "bottom", "left"] as const) {
    if (input[key] !== undefined && !isFiniteNumber(input[key])) {
      fail(errors, `${ctx}.${key} must be a finite number`);
    }
  }
}

function validateTextStylePatch(
  input: unknown,
  ctx: string,
  errors: string[],
): void {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }
  const allowed = new Set([
    "fontFamily",
    "fontSizePt",
    "weight",
    "italic",
    "underline",
    "strikethrough",
    "color",
    "lineHeight",
    "paragraphSpacingPt",
    "align",
    "verticalAlign",
    "letterSpacingEm",
    "textTransform",
  ]);
  validateKnownObjectKeys(input, ctx, allowed, "text style field", errors);
  if (input.fontFamily !== undefined) {
    validateColorOrTokenString(input.fontFamily, `${ctx}.fontFamily`, errors);
  }
  validateOptionalFiniteNumber(input.fontSizePt, `${ctx}.fontSizePt`, errors);
  validateOptionalFiniteNumber(input.weight, `${ctx}.weight`, errors);
  if (input.italic !== undefined && typeof input.italic !== "boolean") {
    fail(errors, `${ctx}.italic must be a boolean`);
  }
  if (input.underline !== undefined && typeof input.underline !== "boolean") {
    fail(errors, `${ctx}.underline must be a boolean`);
  }
  if (
    input.strikethrough !== undefined &&
    typeof input.strikethrough !== "boolean"
  ) {
    fail(errors, `${ctx}.strikethrough must be a boolean`);
  }
  if (input.color !== undefined) {
    validateColorValue(input.color, `${ctx}.color`, errors);
  }
  validateOptionalFiniteNumber(input.lineHeight, `${ctx}.lineHeight`, errors);
  validateOptionalFiniteNumber(
    input.paragraphSpacingPt,
    `${ctx}.paragraphSpacingPt`,
    errors,
  );
  validateEnumValue(input.align, TEXT_STYLE_ALIGNMENTS, `${ctx}.align`, errors);
  validateEnumValue(
    input.verticalAlign,
    TEXT_STYLE_VERTICAL_ALIGNMENTS,
    `${ctx}.verticalAlign`,
    errors,
  );
  validateOptionalFiniteNumber(
    input.letterSpacingEm,
    `${ctx}.letterSpacingEm`,
    errors,
  );
  validateEnumValue(
    input.textTransform,
    TEXT_STYLE_TRANSFORMS,
    `${ctx}.textTransform`,
    errors,
  );
}

function validateGradientStopsPatch(
  input: unknown,
  ctx: string,
  errors: string[],
): void {
  if (!Array.isArray(input)) {
    fail(errors, `${ctx} must be an array`);
    return;
  }
  for (let i = 0; i < input.length; i++) {
    const stop = input[i];
    const stopCtx = `${ctx}[${i}]`;
    if (!isPlainObject(stop)) {
      fail(errors, `${stopCtx} must be an object`);
      continue;
    }
    validateKnownObjectKeys(
      stop,
      stopCtx,
      new Set(["color", "offsetPct"]),
      "gradient stop field",
      errors,
    );
    if (stop.color !== undefined) {
      validateColorValue(stop.color, `${stopCtx}.color`, errors);
    }
    if (stop.offsetPct !== undefined && !isFiniteNumber(stop.offsetPct)) {
      fail(errors, `${stopCtx}.offsetPct must be a finite number`);
    }
  }
}

function validateFillStylePatch(
  input: unknown,
  ctx: string,
  errors: string[],
): void {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }
  const allowed = new Set([
    "type",
    "color",
    "from",
    "to",
    "angle",
    "stops",
    "inner",
    "outer",
    "cx",
    "cy",
    "r",
    "rx",
    "ry",
    "fromAngle",
    "kind",
    "background",
    "spacingPct",
    "strokeWidthPct",
    "assetId",
    "opacity",
    "sizePct",
  ]);
  validateKnownObjectKeys(input, ctx, allowed, "fill style field", errors);
  validateEnumValue(input.type, FILL_TYPES, `${ctx}.type`, errors);
  for (const key of [
    "color",
    "from",
    "to",
    "inner",
    "outer",
    "background",
  ] as const) {
    if (input[key] !== undefined) {
      validateColorValue(input[key], `${ctx}.${key}`, errors);
    }
  }
  for (const key of [
    "angle",
    "cx",
    "cy",
    "r",
    "rx",
    "ry",
    "fromAngle",
    "spacingPct",
    "strokeWidthPct",
    "sizePct",
    "opacity",
  ] as const) {
    if (input[key] !== undefined && !isFiniteNumber(input[key])) {
      fail(errors, `${ctx}.${key} must be a finite number`);
    }
  }
  if (input.stops !== undefined) {
    validateGradientStopsPatch(input.stops, `${ctx}.stops`, errors);
  }
  validateEnumValue(input.kind, PATTERN_FILL_KINDS, `${ctx}.kind`, errors);
  if (
    input.assetId !== undefined &&
    !isValidationNonEmptyString(input.assetId, "exact")
  ) {
    fail(errors, `${ctx}.assetId must be a non-empty string`);
  }
}

function validateStrokeStylePatch(
  input: unknown,
  ctx: string,
  errors: string[],
): void {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }
  validateKnownObjectKeys(
    input,
    ctx,
    new Set(["color", "widthPt", "dash"]),
    "stroke style field",
    errors,
  );
  if (input.color !== undefined) {
    validateColorValue(input.color, `${ctx}.color`, errors);
  }
  validateOptionalFiniteNumber(input.widthPt, `${ctx}.widthPt`, errors);
  validateEnumValue(input.dash, STROKE_DASHES, `${ctx}.dash`, errors);
}

function validateRadiusStylePatch(
  input: unknown,
  ctx: string,
  errors: string[],
): void {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }
  validateKnownObjectKeys(
    input,
    ctx,
    new Set([
      "allPt",
      "topLeftPt",
      "topRightPt",
      "bottomRightPt",
      "bottomLeftPt",
    ]),
    "radius style field",
    errors,
  );
  for (const key of [
    "allPt",
    "topLeftPt",
    "topRightPt",
    "bottomRightPt",
    "bottomLeftPt",
  ] as const) {
    if (input[key] !== undefined && !isFiniteNumber(input[key])) {
      fail(errors, `${ctx}.${key} must be a finite number`);
    }
  }
}

function validateShadowStylePatch(
  input: unknown,
  ctx: string,
  errors: string[],
): void {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }
  validateKnownObjectKeys(
    input,
    ctx,
    new Set(["xPt", "yPt", "blurPt", "color", "opacity"]),
    "shadow style field",
    errors,
  );
  for (const key of ["xPt", "yPt", "blurPt", "opacity"] as const) {
    if (input[key] !== undefined && !isFiniteNumber(input[key])) {
      fail(errors, `${ctx}.${key} must be a finite number`);
    }
  }
  if (input.color !== undefined) {
    validateColorValue(input.color, `${ctx}.color`, errors);
  }
}

function validateEffectStylePatch(
  input: unknown,
  ctx: string,
  errors: string[],
): void {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }
  validateKnownObjectKeys(
    input,
    ctx,
    new Set(["kind", "intensity", "radiusPt", "color", "blurPt", "opacity"]),
    "effect style field",
    errors,
  );
  validateEnumValue(input.kind, EFFECT_KINDS, `${ctx}.kind`, errors);
  validateEnumValue(
    input.intensity,
    EFFECT_GLASS_INTENSITIES,
    `${ctx}.intensity`,
    errors,
  );
  validateOptionalFiniteNumber(input.radiusPt, `${ctx}.radiusPt`, errors);
  if (input.color !== undefined) {
    validateColorValue(input.color, `${ctx}.color`, errors);
  }
  validateOptionalFiniteNumber(input.blurPt, `${ctx}.blurPt`, errors);
  validateOptionalFiniteNumber(input.opacity, `${ctx}.opacity`, errors);
}

function validateImageStylePatch(
  input: unknown,
  ctx: string,
  errors: string[],
): void {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }
  validateKnownObjectKeys(
    input,
    ctx,
    new Set([
      "fit",
      "brightness",
      "contrast",
      "saturation",
      "maskShape",
      "radiusPct",
      "shadow",
    ]),
    "image style field",
    errors,
  );
  validateEnumValue(input.fit, STYLE_IMAGE_FIT_MODES, `${ctx}.fit`, errors);
  validateOptionalFiniteNumber(input.brightness, `${ctx}.brightness`, errors);
  validateOptionalFiniteNumber(input.contrast, `${ctx}.contrast`, errors);
  validateOptionalFiniteNumber(input.saturation, `${ctx}.saturation`, errors);
  validateEnumValue(
    input.maskShape,
    IMAGE_MASK_SHAPES,
    `${ctx}.maskShape`,
    errors,
  );
  validateOptionalFiniteNumber(input.radiusPct, `${ctx}.radiusPct`, errors);
  if (input.shadow !== undefined && typeof input.shadow !== "boolean") {
    fail(errors, `${ctx}.shadow must be a boolean`);
  }
}

function validateConnectorStylePatch(
  input: unknown,
  ctx: string,
  errors: string[],
): void {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }
  validateKnownObjectKeys(
    input,
    ctx,
    new Set(["stroke", "startArrow", "endArrow", "routing"]),
    "connector style field",
    errors,
  );
  if (input.stroke !== undefined) {
    validateStrokeStylePatch(input.stroke, `${ctx}.stroke`, errors);
  }
  validateEnumValue(
    input.startArrow,
    CONNECTOR_ARROW_KINDS,
    `${ctx}.startArrow`,
    errors,
  );
  validateEnumValue(
    input.endArrow,
    CONNECTOR_ARROW_KINDS,
    `${ctx}.endArrow`,
    errors,
  );
  validateEnumValue(
    input.routing,
    CONNECTOR_ROUTING_KINDS,
    `${ctx}.routing`,
    errors,
  );
}

function validateTableStylePatch(
  input: unknown,
  ctx: string,
  errors: string[],
): void {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }
  validateKnownObjectKeys(
    input,
    ctx,
    new Set([
      "headerFill",
      "rowFill",
      "alternateRowFill",
      "border",
      "cellPaddingPt",
      "text",
      "headerText",
    ]),
    "table style field",
    errors,
  );
  if (input.headerFill !== undefined) {
    validateFillStylePatch(input.headerFill, `${ctx}.headerFill`, errors);
  }
  if (input.rowFill !== undefined) {
    validateFillStylePatch(input.rowFill, `${ctx}.rowFill`, errors);
  }
  if (input.alternateRowFill !== undefined) {
    validateFillStylePatch(
      input.alternateRowFill,
      `${ctx}.alternateRowFill`,
      errors,
    );
  }
  if (input.border !== undefined) {
    validateStrokeStylePatch(input.border, `${ctx}.border`, errors);
  }
  if (input.cellPaddingPt !== undefined) {
    validateInsetsPatch(input.cellPaddingPt, `${ctx}.cellPaddingPt`, errors);
  }
  if (input.text !== undefined) {
    validateTextStylePatch(input.text, `${ctx}.text`, errors);
  }
  if (input.headerText !== undefined) {
    validateTextStylePatch(input.headerText, `${ctx}.headerText`, errors);
  }
}

function validateSlideSurfaceStylePatch(
  input: unknown,
  ctx: string,
  errors: string[],
): void {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }
  validateKnownObjectKeys(
    input,
    ctx,
    new Set(["background", "accent", "paddingPct", "chrome", "decoration"]),
    "slide style field",
    errors,
  );
  if (input.background !== undefined) {
    validateFillStylePatch(input.background, `${ctx}.background`, errors);
  }
  if (input.accent !== undefined) {
    validateColorValue(input.accent, `${ctx}.accent`, errors);
  }
  if (input.paddingPct !== undefined) {
    validateInsetsPatch(input.paddingPct, `${ctx}.paddingPct`, errors);
  }
  validateEnumValue(
    input.chrome,
    SLIDE_SURFACE_CHROME,
    `${ctx}.chrome`,
    errors,
  );
  validateEnumValue(
    input.decoration,
    SLIDE_SURFACE_DECORATION,
    `${ctx}.decoration`,
    errors,
  );
}

function validateVisualStylePatch(
  input: unknown,
  ctx: string,
  errors: string[],
): void {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }
  validateKnownObjectKeys(
    input,
    ctx,
    new Set(["styleThemeId", "transparentBackground", "channelColors"]),
    "visual style field",
    errors,
  );
  validateOptionalString(input.styleThemeId, `${ctx}.styleThemeId`, errors);
  if (
    input.transparentBackground !== undefined &&
    typeof input.transparentBackground !== "boolean"
  ) {
    fail(errors, `${ctx}.transparentBackground must be a boolean`);
  }
  if (input.channelColors !== undefined) {
    if (!isPlainObject(input.channelColors)) {
      fail(errors, `${ctx}.channelColors must be an object`);
    } else {
      for (const value of Object.values(input.channelColors)) {
        validateColorValue(value, `${ctx}.channelColors[entry]`, errors);
      }
    }
  }
}

function validateClipStylePatch(
  input: unknown,
  ctx: string,
  errors: string[],
): void {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }
  validateKnownObjectKeys(
    input,
    ctx,
    new Set(["enabled"]),
    "clip style field",
    errors,
  );
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") {
    fail(errors, `${ctx}.enabled must be a boolean`);
  }
}

function validateStylePatch(
  input: unknown,
  ctx: string,
  errors: string[],
): void {
  if (input === undefined) return;
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }
  validateKnownObjectKeys(
    input,
    ctx,
    STYLE_PATCH_TOP_LEVEL_KEYS,
    "style field",
    errors,
  );
  if (input.text !== undefined) {
    validateTextStylePatch(input.text, `${ctx}.text`, errors);
  }
  if (input.fill !== undefined) {
    validateFillStylePatch(input.fill, `${ctx}.fill`, errors);
  }
  if (input.stroke !== undefined) {
    validateStrokeStylePatch(input.stroke, `${ctx}.stroke`, errors);
  }
  if (input.radius !== undefined) {
    validateRadiusStylePatch(input.radius, `${ctx}.radius`, errors);
  }
  validateOptionalFiniteNumber(input.opacity, `${ctx}.opacity`, errors);
  if (input.shadow !== undefined) {
    validateShadowStylePatch(input.shadow, `${ctx}.shadow`, errors);
  }
  if (input.effect !== undefined) {
    validateEffectStylePatch(input.effect, `${ctx}.effect`, errors);
  }
  if (input.image !== undefined) {
    validateImageStylePatch(input.image, `${ctx}.image`, errors);
  }
  if (input.connector !== undefined) {
    validateConnectorStylePatch(input.connector, `${ctx}.connector`, errors);
  }
  if (input.table !== undefined) {
    validateTableStylePatch(input.table, `${ctx}.table`, errors);
  }
  if (input.slide !== undefined) {
    validateSlideSurfaceStylePatch(input.slide, `${ctx}.slide`, errors);
  }
  if (input.visual !== undefined) {
    validateVisualStylePatch(input.visual, `${ctx}.visual`, errors);
  }
  if (input.clip !== undefined) {
    validateClipStylePatch(input.clip, `${ctx}.clip`, errors);
  }
  validateEnumValue(input.blendMode, BLEND_MODES, `${ctx}.blendMode`, errors);
}

function validateInsetsPct(
  input: unknown,
  ctx: string,
  errors: string[],
): void {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }
  const allowed = new Set(["top", "right", "bottom", "left"]);
  rejectUnknownProperties(input, allowed, ctx, errors);
  for (const key of ["top", "right", "bottom", "left"] as const) {
    if (!isFiniteNumber(input[key])) {
      fail(errors, `${ctx}.${key} must be a finite number`);
    }
  }
}

function validateChromeItem(
  input: unknown,
  ctx: string,
  errors: string[],
  allowedSpecificKeys: readonly string[],
): void {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }
  const allowed = new Set([
    "enabled",
    "layout",
    "style",
    "layer",
    ...allowedSpecificKeys,
  ]);
  rejectUnknownProperties(input, allowed, ctx, errors);
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") {
    fail(errors, `${ctx}.enabled must be a boolean`);
  }
  if (
    input.layer !== undefined &&
    input.layer !== "background" &&
    input.layer !== "foreground"
  ) {
    fail(errors, `${ctx}.layer must be background or foreground`);
  }
  if (input.layout !== undefined) {
    validateLayoutBox(input.layout, `${ctx}.layout`, errors);
  }
  validateStylePatch(input.style, `${ctx}.style`, errors);
}

function validateEnumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  ctx: string,
  errors: string[],
): void {
  if (value !== undefined && !isLiteralMember(value, allowed)) {
    fail(errors, `${ctx} must be one of: ${allowed.join(", ")}`);
  }
}

function validateOptionalString(
  value: unknown,
  ctx: string,
  errors: string[],
): void {
  if (value !== undefined && typeof value !== "string") {
    fail(errors, `${ctx} must be a string`);
  }
}

function validateOptionalFiniteNumber(
  value: unknown,
  ctx: string,
  errors: string[],
): void {
  if (value !== undefined && !isFiniteNumber(value)) {
    fail(errors, `${ctx} must be a finite number`);
  }
}

export function validateDeckChromeConfig(
  input: unknown,
  ctx: string,
  errors: string[],
): void {
  if (input === undefined) return;
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }
  rejectUnknownProperties(input, new Set(DECK_CHROME_KINDS), ctx, errors);
  if (input.logo !== undefined) {
    validateChromeItem(input.logo, `${ctx}.logo`, errors, [
      "assetId",
      "alt",
      "placement",
      "size",
    ]);
    if (isPlainObject(input.logo)) {
      validateOptionalString(input.logo.assetId, `${ctx}.logo.assetId`, errors);
      validateOptionalString(input.logo.alt, `${ctx}.logo.alt`, errors);
      validateEnumValue(
        input.logo.placement,
        ["top-left", "top-right", "bottom-left", "bottom-right"],
        `${ctx}.logo.placement`,
        errors,
      );
      validateEnumValue(
        input.logo.size,
        ["small", "medium", "large"],
        `${ctx}.logo.size`,
        errors,
      );
    }
  }
  if (input.footer !== undefined) {
    validateChromeItem(input.footer, `${ctx}.footer`, errors, [
      "text",
      "align",
    ]);
    if (isPlainObject(input.footer)) {
      validateOptionalString(input.footer.text, `${ctx}.footer.text`, errors);
      validateEnumValue(
        input.footer.align,
        ["left", "center", "right"],
        `${ctx}.footer.align`,
        errors,
      );
    }
  }
  if (input.pageNumber !== undefined) {
    validateChromeItem(input.pageNumber, `${ctx}.pageNumber`, errors, [
      "format",
      "placement",
    ]);
    if (isPlainObject(input.pageNumber)) {
      validateEnumValue(
        input.pageNumber.format,
        ["number", "number-total"],
        `${ctx}.pageNumber.format`,
        errors,
      );
      validateEnumValue(
        input.pageNumber.placement,
        ["bottom-left", "bottom-center", "bottom-right"],
        `${ctx}.pageNumber.placement`,
        errors,
      );
    }
  }
  if (input.watermark !== undefined) {
    validateChromeItem(input.watermark, `${ctx}.watermark`, errors, [
      "text",
      "opacity",
      "layoutMode",
      "size",
    ]);
    if (isPlainObject(input.watermark)) {
      validateOptionalString(
        input.watermark.text,
        `${ctx}.watermark.text`,
        errors,
      );
      validateOptionalFiniteNumber(
        input.watermark.opacity,
        `${ctx}.watermark.opacity`,
        errors,
      );
      validateEnumValue(
        input.watermark.layoutMode,
        ["center", "diagonal"],
        `${ctx}.watermark.layoutMode`,
        errors,
      );
      validateEnumValue(
        input.watermark.size,
        ["small", "medium", "large"],
        `${ctx}.watermark.size`,
        errors,
      );
    }
  }
  if (input.border !== undefined) {
    validateChromeItem(input.border, `${ctx}.border`, errors, [
      "color",
      "widthPt",
    ]);
    if (isPlainObject(input.border)) {
      validateOptionalString(input.border.color, `${ctx}.border.color`, errors);
      validateOptionalFiniteNumber(
        input.border.widthPt,
        `${ctx}.border.widthPt`,
        errors,
      );
    }
  }
  if (input.safeArea !== undefined) {
    validateChromeItem(input.safeArea, `${ctx}.safeArea`, errors, [
      "insets",
      "color",
      "widthPt",
    ]);
    if (isPlainObject(input.safeArea)) {
      validateOptionalString(
        input.safeArea.color,
        `${ctx}.safeArea.color`,
        errors,
      );
      validateOptionalFiniteNumber(
        input.safeArea.widthPt,
        `${ctx}.safeArea.widthPt`,
        errors,
      );
      if (input.safeArea.insets !== undefined) {
        validateInsetsPct(
          input.safeArea.insets,
          `${ctx}.safeArea.insets`,
          errors,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Style binding
// ---------------------------------------------------------------------------

function validateStyleBinding(
  input: unknown,
  ctx: string,
  errors: string[],
): void {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }
  if (!isStyleRef(input.ref)) {
    fail(errors, `${ctx}.ref must be a registered StyleRef`);
  }
}

// ---------------------------------------------------------------------------
// Text content
// ---------------------------------------------------------------------------

const TEXT_FIT_MODES = ["auto-height", "fixed-box", "shrink-to-fit"] as const;
const TEXT_CONTENT_KEYS = new Set(["paragraphs", "fit", "language"]);
const PARAGRAPH_KEYS = new Set(["id", "text", "runs", "list"]);
const TEXT_RUN_KEYS = new Set([
  "text",
  "bold",
  "italic",
  "underline",
  "strikethrough",
  "code",
  "link",
  "localStyle",
]);
const RUN_LOCAL_STYLE_KEYS = new Set(["color", "fontSizePt", "fontFamily"]);
const LIST_MARKER_KEYS = new Set(["kind", "indent", "numberStyle"]);

function validateTextContent(
  input: unknown,
  ctx: string,
  errors: string[],
): void {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }
  validateKnownObjectKeys(
    input,
    ctx,
    TEXT_CONTENT_KEYS,
    "text content field",
    errors,
  );
  if (!Array.isArray(input.paragraphs)) {
    fail(errors, `${ctx}.paragraphs must be an array`);
    return;
  }
  validateEnumValue(input.fit, TEXT_FIT_MODES, `${ctx}.fit`, errors);
  validateOptionalString(input.language, `${ctx}.language`, errors);
  for (let i = 0; i < input.paragraphs.length; i++) {
    const para = input.paragraphs[i];
    const pCtx = `${ctx}.paragraphs[${i}]`;
    if (!isPlainObject(para)) {
      fail(errors, `${pCtx} must be an object`);
      continue;
    }
    validateKnownObjectKeys(
      para,
      pCtx,
      PARAGRAPH_KEYS,
      "paragraph field",
      errors,
    );
    if (!isValidationNonEmptyString(para.id, "exact")) {
      fail(errors, `${pCtx}.id must be a non-empty string`);
    }
    if (typeof para.text !== "string") {
      fail(errors, `${pCtx}.text must be a string`);
    }
    if (para.runs !== undefined && !Array.isArray(para.runs)) {
      fail(errors, `${pCtx}.runs must be an array`);
    }
    // Validate runs and enforce run text concatenation to paragraph text.
    if (Array.isArray(para.runs)) {
      const joined = para.runs
        .map((run, runIndex) =>
          validateTextRun(run, `${pCtx}.runs[${runIndex}]`, errors),
        )
        .join("");
      if (typeof para.text === "string" && joined !== para.text) {
        fail(
          errors,
          `${pCtx}: runs text must concatenate to paragraph text (runLength=${joined.length}, paragraphLength=${para.text.length})`,
        );
      }
    }
    if (para.list !== undefined) {
      validateListMarker(para.list, `${pCtx}.list`, errors);
    }
  }
}

const LIST_MARKER_KINDS = ["bullet", "number"] as const;
const LIST_MARKER_NUMBER_STYLES = [
  "decimal",
  "lower-alpha",
  "upper-alpha",
  "lower-roman",
] as const;
const TEXT_RUN_BOOLEAN_FIELDS = [
  "bold",
  "italic",
  "underline",
  "strikethrough",
  "code",
] as const;

function validateTextRun(
  input: unknown,
  ctx: string,
  errors: string[],
): string {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return "";
  }
  validateKnownObjectKeys(input, ctx, TEXT_RUN_KEYS, "text run field", errors);
  if (typeof input.text !== "string") {
    fail(errors, `${ctx}.text must be a string`);
  }
  for (const key of TEXT_RUN_BOOLEAN_FIELDS) {
    const value = input[key];
    if (value !== undefined && typeof value !== "boolean") {
      fail(errors, `${ctx}.${key} must be a boolean`);
    }
  }
  if (input.link !== undefined) {
    validateSafeUrlString(
      input.link,
      `${ctx}.link`,
      errors,
      SAFE_TEXT_LINK_URL_SCHEMES,
    );
  }
  if (input.localStyle !== undefined) {
    validateRunLocalStyle(input.localStyle, `${ctx}.localStyle`, errors);
  }
  return typeof input.text === "string" ? input.text : "";
}

function validateRunLocalStyle(
  input: unknown,
  ctx: string,
  errors: string[],
): void {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }
  validateKnownObjectKeys(
    input,
    ctx,
    RUN_LOCAL_STYLE_KEYS,
    "run style field",
    errors,
  );
  validateOptionalString(input.color, `${ctx}.color`, errors);
  validateOptionalFiniteNumber(input.fontSizePt, `${ctx}.fontSizePt`, errors);
  validateOptionalString(input.fontFamily, `${ctx}.fontFamily`, errors);
}

function validateListMarker(
  input: unknown,
  ctx: string,
  errors: string[],
): void {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }
  validateKnownObjectKeys(
    input,
    ctx,
    LIST_MARKER_KEYS,
    "list marker field",
    errors,
  );
  if (
    !LIST_MARKER_KINDS.includes(
      input.kind as (typeof LIST_MARKER_KINDS)[number],
    )
  ) {
    fail(errors, `${ctx}.kind must be one of: ${LIST_MARKER_KINDS.join(", ")}`);
  }
  if (input.indent !== undefined) {
    if (!Number.isInteger(input.indent) || (input.indent as number) < 0) {
      fail(errors, `${ctx}.indent must be an integer >= 0`);
    }
  }
  if (
    input.numberStyle !== undefined &&
    !LIST_MARKER_NUMBER_STYLES.includes(
      input.numberStyle as (typeof LIST_MARKER_NUMBER_STYLES)[number],
    )
  ) {
    fail(
      errors,
      `${ctx}.numberStyle must be one of: ${LIST_MARKER_NUMBER_STYLES.join(", ")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Table content
// ---------------------------------------------------------------------------

const TABLE_CONTENT_KEYS = new Set(["columns", "rows", "header", "caption"]);
const TABLE_COLUMN_KEYS = new Set(["id", "label", "width"]);
const TABLE_ROW_KEYS = new Set(["id", "cells"]);
const TABLE_CELL_KEYS = new Set(["text", "runs"]);

function validateTableContent(
  input: unknown,
  ctx: string,
  errors: string[],
): void {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }
  validateKnownObjectKeys(
    input,
    ctx,
    TABLE_CONTENT_KEYS,
    "table content field",
    errors,
  );
  if (!Array.isArray(input.columns)) {
    fail(errors, `${ctx}.columns must be an array`);
    return;
  }
  if (!Array.isArray(input.rows)) {
    fail(errors, `${ctx}.rows must be an array`);
    return;
  }
  const colCount = input.columns.length;
  if (colCount < 1 || colCount > 8) {
    fail(errors, `${ctx}: columns count must be 1..8`, "invalid_limit");
  }
  if (input.rows.length < 1 || input.rows.length > 20) {
    fail(errors, `${ctx}: rows count must be 1..20`, "invalid_limit");
  }
  const colIds = new Set<string>();
  for (let ci = 0; ci < input.columns.length; ci++) {
    const col = input.columns[ci];
    const colCtx = `${ctx}.columns[${ci}]`;
    if (!isPlainObject(col)) {
      fail(errors, `${colCtx} must be an object`);
      continue;
    }
    validateKnownObjectKeys(
      col,
      colCtx,
      TABLE_COLUMN_KEYS,
      "column field",
      errors,
    );
    if (typeof col.id !== "string" || colIds.has(col.id)) {
      fail(errors, `${ctx}.columns[${ci}].id must be unique and non-empty`);
    }
    colIds.add(col.id as string);
  }
  const rowIds = new Set<string>();
  for (let ri = 0; ri < input.rows.length; ri++) {
    const row = input.rows[ri];
    const rowCtx = `${ctx}.rows[${ri}]`;
    if (!isPlainObject(row)) {
      fail(errors, `${rowCtx} must be an object`);
      continue;
    }
    validateKnownObjectKeys(row, rowCtx, TABLE_ROW_KEYS, "row field", errors);
    if (typeof row.id !== "string" || rowIds.has(row.id)) {
      fail(errors, `${ctx}.rows[${ri}].id must be unique and non-empty`);
    }
    rowIds.add(row.id as string);
    if (!Array.isArray(row.cells) || row.cells.length !== colCount) {
      fail(errors, `${ctx}.rows[${ri}]: must have exactly ${colCount} cells`);
      continue;
    }
    for (let ci = 0; ci < row.cells.length; ci++) {
      const cell = row.cells[ci];
      const cellCtx = `${ctx}.rows[${ri}].cells[${ci}]`;
      if (!isPlainObject(cell)) {
        fail(errors, `${cellCtx} must be an object`);
        continue;
      }
      validateKnownObjectKeys(
        cell,
        cellCtx,
        TABLE_CELL_KEYS,
        "cell field",
        errors,
      );
      if (typeof cell.text !== "string") {
        fail(errors, `${cellCtx}.text must be a string`);
      }
      if (cell.runs !== undefined && !Array.isArray(cell.runs)) {
        fail(errors, `${cellCtx}.runs must be an array`);
        continue;
      }
      if (Array.isArray(cell.runs)) {
        for (let runIndex = 0; runIndex < cell.runs.length; runIndex++) {
          validateTextRun(
            cell.runs[runIndex],
            `${cellCtx}.runs[${runIndex}]`,
            errors,
          );
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Connector content
// ---------------------------------------------------------------------------

function validateConnectorEndpoint(
  input: unknown,
  ctx: string,
  errors: string[],
): void {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }
  if (input.kind !== "point" && input.kind !== "node") {
    fail(errors, `${ctx}.kind must be "point" or "node"`);
    return;
  }
  if (input.kind === "point") {
    validateKnownObjectKeys(
      input,
      ctx,
      new Set(["kind", "point"]),
      "connector endpoint field",
      errors,
    );
    validatePointPct(input.point, `${ctx}.point`, errors);
    return;
  }
  validateKnownObjectKeys(
    input,
    ctx,
    new Set(["kind", "nodeId", "anchor"]),
    "connector endpoint field",
    errors,
  );
  validateId(input.nodeId, `${ctx}.nodeId`, errors);
  if (
    !CONNECTOR_ANCHOR_KINDS.includes(
      input.anchor as (typeof CONNECTOR_ANCHOR_KINDS)[number],
    )
  ) {
    fail(
      errors,
      `${ctx}.anchor must be one of: ${CONNECTOR_ANCHOR_KINDS.join(", ")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Child node
// ---------------------------------------------------------------------------

const SHAPE_KINDS = [
  "rect",
  "ellipse",
  "line",
  "triangle",
  "diamond",
  "circle",
  "square",
  "path",
] as const;
const IMAGE_FIT_MODES = ["contain", "cover", "fill", "none"] as const;
const GROUP_COMPONENT_KINDS = [
  "metricCard",
  "quoteBlock",
  "timeline",
  "comparisonGrid",
  "cardGrid",
  "custom",
] as const;
const SEMANTIC_ROLES = [
  "slide",
  "title",
  "subtitle",
  "kicker",
  "body",
  "bullet",
  "caption",
  "quote",
  "attribution",
  "metric",
  "label",
  "table",
  "visual",
  "image",
  "card",
  "callout",
  "connector",
  "background",
  "themeDecoration",
] as const;
const SLOT_KEYS = [
  "kicker",
  "title",
  "subtitle",
  "body",
  "bullets",
  "leftTitle",
  "leftBody",
  "leftBullets",
  "rightTitle",
  "rightBody",
  "rightBullets",
  "cards",
  "steps",
  "quote",
  "attribution",
  "stat",
  "statLabel",
  "metrics",
  "table",
  "visualId",
  "imagePrompt",
  "caption",
] as const;

const SOURCE_BLOCK_KINDS = ["text", "visual", "table", "image"] as const;
const SOURCE_REFRESH_STATES = [
  "fresh",
  "stale",
  "orphan",
  "unlinked",
  "unknown",
] as const;
const BASE_CHILD_NODE_KEYS = [
  "id",
  "name",
  "role",
  "slot",
  "layout",
  "style",
  "localStyle",
  "locked",
  "hidden",
  "accessibility",
  "source",
  "type",
] as const;
const CHILD_NODE_CONTENT_KEYS = new Set([...BASE_CHILD_NODE_KEYS, "content"]);
const CHILD_NODE_GROUP_KEYS = new Set([
  ...BASE_CHILD_NODE_KEYS.filter(
    (key) => key !== "style" && key !== "localStyle",
  ),
  "component",
  "children",
]);
const CHILD_NODE_ALL_KEYS = new Set([
  ...BASE_CHILD_NODE_KEYS,
  "content",
  "component",
  "children",
]);
const IMAGE_CONTENT_KEYS = new Set([
  "assetId",
  "crop",
  "fit",
  "focalPoint",
  "alt",
]);
const SHAPE_CONTENT_KEYS = new Set(["shape", "path"]);
const CONNECTOR_CONTENT_KEYS = new Set(["from", "to", "routing"]);
const VISUAL_CONTENT_KEYS = new Set([
  "assetId",
  "visualId",
  "transparentBackground",
  "alt",
]);

function validateChildNodeKeys(
  input: Record<string, unknown>,
  ctx: string,
  type: string,
  errors: string[],
): void {
  switch (type) {
    case "text":
    case "image":
    case "shape":
    case "connector":
    case "table":
    case "visual":
      validateKnownObjectKeys(
        input,
        ctx,
        CHILD_NODE_CONTENT_KEYS,
        "node field",
        errors,
      );
      break;
    case "group":
      validateKnownObjectKeys(
        input,
        ctx,
        CHILD_NODE_GROUP_KEYS,
        "node field",
        errors,
      );
      break;
    default:
      validateKnownObjectKeys(
        input,
        ctx,
        CHILD_NODE_ALL_KEYS,
        "node field",
        errors,
      );
      break;
  }
}

function validatePointPct(input: unknown, ctx: string, errors: string[]): void {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }
  const allowed = new Set(["x", "y"]);
  rejectUnknownProperties(input, allowed, ctx, errors);
  if (!isFiniteNumber(input.x)) {
    fail(errors, `${ctx}.x must be a finite number`);
  }
  if (!isFiniteNumber(input.y)) {
    fail(errors, `${ctx}.y must be a finite number`);
  }
}

function validateImageCrop(
  input: unknown,
  ctx: string,
  errors: string[],
): void {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }
  const allowed = new Set(["top", "right", "bottom", "left"]);
  rejectUnknownProperties(input, allowed, ctx, errors);
  for (const key of ["top", "right", "bottom", "left"] as const) {
    if (!isFiniteNumber(input[key])) {
      fail(errors, `${ctx}.${key} must be a finite number`);
    }
  }
}

function validateStringField(
  value: unknown,
  ctx: string,
  errors: string[],
): void {
  if (value !== undefined && typeof value !== "string") {
    fail(errors, `${ctx} must be a string`);
  }
}

function validateAccessibilityMetadata(
  input: unknown,
  ctx: string,
  errors: string[],
): void {
  if (input === undefined) return;
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }

  const allowed = new Set(["label", "alt", "decorative", "readingOrder"]);
  rejectUnknownProperties(input, allowed, ctx, errors);

  validateOptionalString(input.label, `${ctx}.label`, errors);
  validateOptionalString(input.alt, `${ctx}.alt`, errors);
  if (input.decorative !== undefined && typeof input.decorative !== "boolean") {
    fail(errors, `${ctx}.decorative must be a boolean`);
  }
  validateOptionalFiniteNumber(
    input.readingOrder,
    `${ctx}.readingOrder`,
    errors,
  );
}

function validateBaseNodeMetadata(
  input: Record<string, unknown>,
  ctx: string,
  errors: string[],
): void {
  validateOptionalString(input.name, `${ctx}.name`, errors);

  if (
    input.role !== undefined &&
    !SEMANTIC_ROLES.includes(input.role as (typeof SEMANTIC_ROLES)[number])
  ) {
    fail(errors, `${ctx}.role is not a known semantic role`);
  }

  if (
    input.slot !== undefined &&
    !SLOT_KEYS.includes(input.slot as (typeof SLOT_KEYS)[number])
  ) {
    fail(errors, `${ctx}.slot is not a known slot key`);
  }

  if (input.locked !== undefined && typeof input.locked !== "boolean") {
    fail(errors, `${ctx}.locked must be a boolean`);
  }
  if (input.hidden !== undefined && typeof input.hidden !== "boolean") {
    fail(errors, `${ctx}.hidden must be a boolean`);
  }

  validateAccessibilityMetadata(
    input.accessibility,
    `${ctx}.accessibility`,
    errors,
  );
  validateStylePatch(input.localStyle, `${ctx}.localStyle`, errors);
}

function validateSourceMetadata(
  input: unknown,
  ctx: string,
  errors: string[],
): void {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }

  const allowed = new Set([
    "documentId",
    "blockId",
    "blockKind",
    "contentHash",
    "blockRevision",
    "linkedAt",
    "display",
    "refresh",
    "unlinked",
    "extra",
  ]);
  rejectUnknownProperties(input, allowed, ctx, errors);

  validateStringField(input.documentId, `${ctx}.documentId`, errors);
  validateStringField(input.blockId, `${ctx}.blockId`, errors);
  validateStringField(input.contentHash, `${ctx}.contentHash`, errors);
  validateStringField(input.blockRevision, `${ctx}.blockRevision`, errors);
  validateStringField(input.linkedAt, `${ctx}.linkedAt`, errors);
  if (
    input.blockKind !== undefined &&
    !SOURCE_BLOCK_KINDS.includes(
      input.blockKind as (typeof SOURCE_BLOCK_KINDS)[number],
    )
  ) {
    fail(
      errors,
      `${ctx}.blockKind must be one of: ${SOURCE_BLOCK_KINDS.join(", ")}`,
    );
  }
  if (input.unlinked !== undefined && typeof input.unlinked !== "boolean") {
    fail(errors, `${ctx}.unlinked must be a boolean`);
  }

  if (input.display !== undefined) {
    if (!isPlainObject(input.display)) {
      fail(errors, `${ctx}.display must be an object`);
    } else {
      const displayAllowed = new Set([
        "documentTitle",
        "blockLabel",
        "blockKindLabel",
      ]);
      rejectUnknownProperties(
        input.display,
        displayAllowed,
        `${ctx}.display`,
        errors,
      );
      validateStringField(
        input.display.documentTitle,
        `${ctx}.display.documentTitle`,
        errors,
      );
      validateStringField(
        input.display.blockLabel,
        `${ctx}.display.blockLabel`,
        errors,
      );
      validateStringField(
        input.display.blockKindLabel,
        `${ctx}.display.blockKindLabel`,
        errors,
      );
    }
  }

  if (input.refresh !== undefined) {
    if (!isPlainObject(input.refresh)) {
      fail(errors, `${ctx}.refresh must be an object`);
    } else {
      const refreshAllowed = new Set([
        "state",
        "checkedAt",
        "refreshedAt",
        "sourceHash",
        "reason",
      ]);
      rejectUnknownProperties(
        input.refresh,
        refreshAllowed,
        `${ctx}.refresh`,
        errors,
      );
      if (
        !SOURCE_REFRESH_STATES.includes(
          input.refresh.state as (typeof SOURCE_REFRESH_STATES)[number],
        )
      ) {
        fail(
          errors,
          `${ctx}.refresh.state must be one of: ${SOURCE_REFRESH_STATES.join(", ")}`,
        );
      }
      validateStringField(
        input.refresh.checkedAt,
        `${ctx}.refresh.checkedAt`,
        errors,
      );
      validateStringField(
        input.refresh.refreshedAt,
        `${ctx}.refresh.refreshedAt`,
        errors,
      );
      validateStringField(
        input.refresh.sourceHash,
        `${ctx}.refresh.sourceHash`,
        errors,
      );
      validateStringField(
        input.refresh.reason,
        `${ctx}.refresh.reason`,
        errors,
      );
    }
  }

  if (input.extra !== undefined && !isPlainObject(input.extra)) {
    fail(errors, `${ctx}.extra must be an object`);
  }
}

function validateChildNode(
  input: unknown,
  ctx: string,
  errors: string[],
  nodeIds: Set<string>,
  depth: number = 0,
): void {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }

  const id = validateId(input.id, `${ctx}.id`, errors);
  if (id !== undefined) {
    if (nodeIds.has(id)) {
      fail(errors, `${ctx}.id is duplicated`, "duplicate_id");
    } else {
      nodeIds.add(id);
    }
  }
  validateBaseNodeMetadata(input, ctx, errors);

  if (input.layout !== undefined) {
    validateLayoutBox(input.layout, `${ctx}.layout`, errors);
  }

  if (input.source !== undefined) {
    validateSourceMetadata(input.source, `${ctx}.source`, errors);
  }

  if (input.style !== undefined) {
    validateStyleBinding(input.style, `${ctx}.style`, errors);
  }

  const type = input.type;
  if (typeof type !== "string") {
    fail(errors, `${ctx}.type must be a string`);
    return;
  }
  validateChildNodeKeys(input, ctx, type, errors);

  switch (type) {
    case "text":
      validateTextContent(input.content, `${ctx}.content`, errors);
      break;
    case "image":
      if (!isPlainObject(input.content)) {
        fail(errors, `${ctx}.content must be an object`);
      } else {
        validateKnownObjectKeys(
          input.content,
          `${ctx}.content`,
          IMAGE_CONTENT_KEYS,
          "image content field",
          errors,
        );
        if (
          typeof input.content.assetId !== "string" ||
          input.content.assetId.length === 0
        ) {
          fail(errors, `${ctx}.content.assetId must be a non-empty string`);
        }
        if (input.content.crop !== undefined) {
          validateImageCrop(input.content.crop, `${ctx}.content.crop`, errors);
        }
        validateEnumValue(
          input.content.fit,
          IMAGE_FIT_MODES,
          `${ctx}.content.fit`,
          errors,
        );
        if (input.content.focalPoint !== undefined) {
          validatePointPct(
            input.content.focalPoint,
            `${ctx}.content.focalPoint`,
            errors,
          );
        }
        validateOptionalString(input.content.alt, `${ctx}.content.alt`, errors);
      }
      break;
    case "shape": {
      if (!isPlainObject(input.content)) {
        fail(errors, `${ctx}.content must be an object`);
      } else {
        validateKnownObjectKeys(
          input.content,
          `${ctx}.content`,
          SHAPE_CONTENT_KEYS,
          "shape content field",
          errors,
        );
        if (
          !SHAPE_KINDS.includes(
            input.content.shape as (typeof SHAPE_KINDS)[number],
          )
        ) {
          fail(
            errors,
            `${ctx}.content.shape must be one of: ${SHAPE_KINDS.join(", ")}`,
          );
        }
        if (
          input.content.shape === "path" &&
          (typeof input.content.path !== "string" ||
            input.content.path.length === 0)
        ) {
          fail(errors, `${ctx}.content.path is required when shape is "path"`);
        }
      }
      break;
    }
    case "connector": {
      if (!isPlainObject(input.content)) {
        fail(errors, `${ctx}.content must be an object`);
      } else {
        validateKnownObjectKeys(
          input.content,
          `${ctx}.content`,
          CONNECTOR_CONTENT_KEYS,
          "connector content field",
          errors,
        );
        validateConnectorEndpoint(
          input.content.from,
          `${ctx}.content.from`,
          errors,
        );
        validateConnectorEndpoint(
          input.content.to,
          `${ctx}.content.to`,
          errors,
        );
        validateEnumValue(
          input.content.routing,
          CONNECTOR_ROUTING_KINDS,
          `${ctx}.content.routing`,
          errors,
        );
      }
      break;
    }
    case "table":
      validateTableContent(input.content, `${ctx}.content`, errors);
      break;
    case "visual":
      if (!isPlainObject(input.content)) {
        fail(errors, `${ctx}.content must be an object`);
      } else {
        validateKnownObjectKeys(
          input.content,
          `${ctx}.content`,
          VISUAL_CONTENT_KEYS,
          "visual content field",
          errors,
        );
        if (
          input.content.assetId === undefined &&
          input.content.visualId === undefined
        ) {
          fail(errors, `${ctx}.content must provide assetId or visualId`);
        }
      }
      break;
    case "group": {
      if (depth >= 4) {
        fail(errors, `${ctx}: groups may not be nested beyond depth 4`);
      }
      if (
        !GROUP_COMPONENT_KINDS.includes(
          input.component as (typeof GROUP_COMPONENT_KINDS)[number],
        )
      ) {
        fail(
          errors,
          `${ctx}.component must be one of: ${GROUP_COMPONENT_KINDS.join(", ")}`,
        );
      }
      if (!Array.isArray(input.children) || input.children.length === 0) {
        fail(errors, `${ctx}.children must be a non-empty array`);
      } else {
        for (let i = 0; i < input.children.length; i++) {
          validateChildNode(
            input.children[i],
            `${ctx}.children[${i}]`,
            errors,
            nodeIds,
            depth + 1,
          );
        }
      }
      break;
    }
    default:
      fail(errors, `${ctx}.type is not a known node type`, "invalid_type");
  }
}

// ---------------------------------------------------------------------------
// Slide
// ---------------------------------------------------------------------------

const SLIDE_TONES = [
  "neutral",
  "confident",
  "warm",
  "urgent",
  "premium",
  "technical",
] as const;
const SLIDE_DENSITIES = ["airy", "normal", "dense"] as const;
const SLIDE_EMPHASIS = [
  "balanced",
  "title",
  "data",
  "visual",
  "quote",
  "action",
] as const;
const SLIDE_DECORATION_LEVELS = ["none", "subtle", "default", "expressive"];
const SLIDE_CHROME_LEVELS = ["default", "minimal", "none"];
const SLIDE_CHROME_OVERRIDE_MODES = [
  "inherit",
  "disabled",
  "detached",
  "override",
];

function validateSlideProps(
  input: unknown,
  ctx: string,
  errors: string[],
): void {
  if (input === undefined) return;
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }
  if (
    input.decoration !== undefined &&
    !SLIDE_DECORATION_LEVELS.includes(input.decoration as string)
  ) {
    fail(errors, `${ctx}.decoration is not a known decoration level`);
  }
  if (
    input.chrome !== undefined &&
    !SLIDE_CHROME_LEVELS.includes(input.chrome as string)
  ) {
    fail(errors, `${ctx}.chrome is not a known chrome level`);
  }
  if (input.deckChrome !== undefined) {
    if (!isPlainObject(input.deckChrome)) {
      fail(errors, `${ctx}.deckChrome must be an object`);
    } else {
      for (const [kind, override] of Object.entries(input.deckChrome)) {
        if (
          !DECK_CHROME_KINDS.includes(
            kind as (typeof DECK_CHROME_KINDS)[number],
          )
        ) {
          errors.push(
            formatDiagnostic(
              "unsupported_property",
              `${ctx}.deckChrome`,
              "unsupported property count=1",
            ),
          );
          continue;
        }
        if (!isPlainObject(override)) {
          fail(errors, `${ctx}.deckChrome.${kind} must be an object`);
          continue;
        }
        if (!SLIDE_CHROME_OVERRIDE_MODES.includes(override.mode as string)) {
          fail(errors, `${ctx}.deckChrome.${kind}.mode is not supported`);
        }
        if (override.mode === "override") {
          if (!isPlainObject(override.value)) {
            fail(errors, `${ctx}.deckChrome.${kind}.value must be an object`);
          } else {
            validateDeckChromeConfig(
              { [kind]: override.value },
              `${ctx}.deckChrome.${kind}.value`,
              errors,
            );
          }
        }
      }
    }
  }
}

const SLIDE__KEYS = new Set([
  "id",
  "name",
  "role",
  "slot",
  "layout",
  "style",
  "localStyle",
  "locked",
  "hidden",
  "accessibility",
  "source",
  "type",
  "template",
  "controls",
  "props",
  "children",
  "notes",
]);

function validateSlideNode(
  input: unknown,
  ctx: string,
  errors: string[],
  nodeIds: Set<string>,
): void {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }
  rejectUnknownProperties(input, SLIDE__KEYS, ctx, errors);
  if ("elements" in input) {
    fail(
      errors,
      `${ctx}.elements is a v6 field and not valid in a presentation slide`,
    );
  }
  if (input.type !== "slide") {
    fail(errors, `${ctx}.type must be "slide"`);
  }
  const id = validateId(input.id, `${ctx}.id`, errors);
  if (id !== undefined) {
    if (nodeIds.has(id)) {
      fail(errors, `${ctx}.id is duplicated`, "duplicate_id");
    } else {
      nodeIds.add(id);
    }
  }
  validateBaseNodeMetadata(input, ctx, errors);

  // Template binding
  if (!isPlainObject(input.template)) {
    fail(errors, `${ctx}.template must be an object`);
  } else {
    if (
      !SEMANTIC_TEMPLATE_KINDS.includes(
        input.template.kind as (typeof SEMANTIC_TEMPLATE_KINDS)[number],
      )
    ) {
      fail(
        errors,
        `${ctx}.template.kind is not a known template kind`,
        "invalid_type",
      );
    }
  }

  // Controls (optional)
  if (isPlainObject(input.controls)) {
    const { tone, density, emphasis } = input.controls;
    if (
      tone !== undefined &&
      !SLIDE_TONES.includes(tone as (typeof SLIDE_TONES)[number])
    ) {
      fail(errors, `${ctx}.controls.tone is not a known tone`);
    }
    if (
      density !== undefined &&
      !SLIDE_DENSITIES.includes(density as (typeof SLIDE_DENSITIES)[number])
    ) {
      fail(errors, `${ctx}.controls.density is not a known density`);
    }
    if (
      emphasis !== undefined &&
      !SLIDE_EMPHASIS.includes(emphasis as (typeof SLIDE_EMPHASIS)[number])
    ) {
      fail(errors, `${ctx}.controls.emphasis is not a known emphasis`);
    }
  }

  validateSlideProps(input.props, `${ctx}.props`, errors);

  if (input.style !== undefined) {
    validateStyleBinding(input.style, `${ctx}.style`, errors);
  }

  if (input.source !== undefined) {
    validateSourceMetadata(input.source, `${ctx}.source`, errors);
  }

  validateOptionalString(input.notes, `${ctx}.notes`, errors);

  if (!Array.isArray(input.children)) {
    fail(errors, `${ctx}.children must be an array`);
  } else {
    for (let i = 0; i < input.children.length; i++) {
      validateChildNode(
        input.children[i],
        `${ctx}.children[${i}]`,
        errors,
        nodeIds,
      );
    }
  }
}

const DECK_METADATA_KEYS = new Set([
  "createdAt",
  "updatedAt",
  "sourceDocumentId",
  "contentHash",
  "locale",
  "extra",
]);

function validateJsonValue(
  input: unknown,
  ctx: string,
  errors: string[],
): void {
  if (
    input === null ||
    typeof input === "string" ||
    typeof input === "boolean"
  ) {
    return;
  }
  if (typeof input === "number") {
    if (!Number.isFinite(input)) {
      fail(errors, `${ctx} must be a finite number`);
    }
    return;
  }
  if (Array.isArray(input)) {
    for (let i = 0; i < input.length; i++) {
      validateJsonValue(input[i], `${ctx}[${i}]`, errors);
    }
    return;
  }
  if (isPlainObject(input)) {
    for (const value of Object.values(input)) {
      validateJsonValue(value, `${ctx}[entry]`, errors);
    }
    return;
  }
  fail(errors, `${ctx} must be a JSON-serializable value`);
}

function validateDeckMetadata(
  input: unknown,
  ctx: string,
  errors: string[],
): void {
  if (input === undefined) return;
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }
  rejectUnknownProperties(input, DECK_METADATA_KEYS, ctx, errors);
  validateStringField(input.createdAt, `${ctx}.createdAt`, errors);
  validateStringField(input.updatedAt, `${ctx}.updatedAt`, errors);
  validateStringField(
    input.sourceDocumentId,
    `${ctx}.sourceDocumentId`,
    errors,
  );
  validateStringField(input.contentHash, `${ctx}.contentHash`, errors);
  validateStringField(input.locale, `${ctx}.locale`, errors);
  if (input.extra !== undefined) {
    if (!isPlainObject(input.extra)) {
      fail(errors, `${ctx}.extra must be an object`);
    } else {
      for (const value of Object.values(input.extra)) {
        validateJsonValue(value, `${ctx}.extra[entry]`, errors);
      }
    }
  }
}

const DECK_THEME_KEYS = new Set([
  "packageId",
  "packageVersion",
  "brandKitId",
  "overrides",
]);

const THEME_OVERRIDE_KEYS = new Set([
  "tokens",
  "styles",
  "disabledDecorations",
  "chrome",
]);

function validateThemeStylesOverrides(
  input: unknown,
  ctx: string,
  errors: string[],
): void {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }
  for (const [styleRef, variants] of Object.entries(input)) {
    const styleCtx = `${ctx}[style]`;
    if (!isStyleRef(styleRef)) {
      fail(errors, `${styleCtx} must be a registered StyleRef`);
    }
    if (!isPlainObject(variants)) {
      fail(errors, `${styleCtx} must be an object`);
      continue;
    }
    for (const patch of Object.values(variants)) {
      const variantCtx = `${styleCtx}[variant]`;
      if (!isPlainObject(patch)) {
        fail(errors, `${variantCtx} must be an object`);
      } else {
        validateStylePatch(patch, variantCtx, errors);
      }
    }
  }
}

function validateThemeOverridePatch(
  input: unknown,
  ctx: string,
  errors: string[],
): void {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }
  rejectUnknownProperties(input, THEME_OVERRIDE_KEYS, ctx, errors);
  if (input.tokens !== undefined && !isPlainObject(input.tokens)) {
    fail(errors, `${ctx}.tokens must be an object`);
  }
  if (input.styles !== undefined) {
    validateThemeStylesOverrides(input.styles, `${ctx}.styles`, errors);
  }
  if (input.disabledDecorations !== undefined) {
    if (!Array.isArray(input.disabledDecorations)) {
      fail(errors, `${ctx}.disabledDecorations must be an array`);
    } else {
      for (let i = 0; i < input.disabledDecorations.length; i++) {
        if (typeof input.disabledDecorations[i] !== "string") {
          fail(errors, `${ctx}.disabledDecorations[${i}] must be a string`);
        }
      }
    }
  }
  validateDeckChromeConfig(input.chrome, `${ctx}.chrome`, errors);
}

function validateDeckThemeBinding(
  input: unknown,
  ctx: string,
  errors: string[],
): void {
  if (!isPlainObject(input)) {
    fail(errors, `${ctx} must be an object`);
    return;
  }
  rejectUnknownProperties(input, DECK_THEME_KEYS, ctx, errors);
  if (!isValidationNonEmptyString(input.packageId, "exact")) {
    fail(errors, `${ctx}.packageId must be a non-empty string`);
  }
  validateStringField(input.packageVersion, `${ctx}.packageVersion`, errors);
  validateStringField(input.brandKitId, `${ctx}.brandKitId`, errors);
  if (input.overrides !== undefined) {
    validateThemeOverridePatch(input.overrides, `${ctx}.overrides`, errors);
  }
}

// ---------------------------------------------------------------------------
// Deck
// ---------------------------------------------------------------------------

const DECK__KEYS = new Set([
  "schemaVersion",
  "id",
  "title",
  "canvas",
  "theme",
  "chrome",
  "assets",
  "slides",
  "metadata",
]);

function validateDeck(input: unknown, errors: string[]): Partial<Deck> {
  if (!isPlainObject(input)) {
    fail(errors, "Deck must be an object", "invalid_structure");
    return {};
  }

  rejectUnknownProperties(input, DECK__KEYS, "Deck", errors);

  // Check schemaVersion first
  if (input.schemaVersion !== DECK_SCHEMA_VERSION) {
    if (
      typeof input.schemaVersion === "number" &&
      input.schemaVersion !== DECK_SCHEMA_VERSION
    ) {
      fail(
        errors,
        `Deck.schemaVersion is not presentation (expected ${DECK_SCHEMA_VERSION})`,
        "invalid_version",
      );
    } else {
      fail(
        errors,
        `Deck.schemaVersion must be ${DECK_SCHEMA_VERSION}`,
        "invalid_version",
      );
    }
    // Fatal: stop further validation
    return {};
  }

  validateCanvas(input.canvas, "Deck.canvas", errors);
  validateAssetRegistry(input.assets, "Deck.assets", errors);
  validateDeckThemeBinding(input.theme, "Deck.theme", errors);
  validateDeckMetadata(input.metadata, "Deck.metadata", errors);
  validateDeckChromeConfig(input.chrome, "Deck.chrome", errors);

  if (!Array.isArray(input.slides)) {
    fail(errors, "Deck.slides must be an array", "invalid_structure");
  } else if (input.slides.length === 0) {
    fail(
      errors,
      "Deck.slides must contain at least one slide",
      "invalid_structure",
    );
  } else {
    const nodeIds = new Set<string>();
    for (let i = 0; i < input.slides.length; i++) {
      validateSlideNode(input.slides[i], `slides[${i}]`, errors, nodeIds);
    }
  }

  // Reject v6 fields
  for (const v6Key of [
    "elements",
    "masters",
    "customTemplates",
    "design",
    "defaultMasterId",
  ]) {
    if (v6Key in input) {
      fail(
        errors,
        `Deck.${v6Key} is a v6 field and not valid in a presentation deck`,
      );
    }
  }

  return input as Partial<Deck>;
}
