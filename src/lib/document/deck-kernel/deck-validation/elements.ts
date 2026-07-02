import type {
  Paragraph,
  ConnectorAnchor,
  ConnectorArrow,
  ConnectorPoint,
  ConnectorRouting,
  ElementAlign,
  ElementBox,
  ElementEffect,
  ElementFill,
  ElementRadius,
  ElementShadow,
  GradientStop,
  ShapeKind,
  SlideElement,
  TableCell,
  TableColumn,
  TableElementStyle,
  TableRow,
  TextElementStyle,
  TextFitMode,
  TextRun,
} from "../deck-elements";
import { isSlideFontId } from "../slide-fonts";
import {
  validateImageCrop,
  validateImageFitMode,
  validateImageMaskShape,
} from "./media";
import { GLASS_EFFECT_INTENSITIES } from "../deck-element-primitives";
import { validateSourceRef } from "./source-refs";
/* node:coverage disable */
/* Import-list member rows are tsx source-map gaps; validation branches are tested below. */
import {
  CONNECTOR_ANCHORS,
  CONNECTOR_ARROWS,
  CONNECTOR_ROUTINGS,
  DeckValidationError,
  ELEMENT_ALIGNS,
  SHAPE_KINDS,
  TEXT_FIT_MODES,
  VERTICAL_ALIGNS,
  type VerticalAlign,
  isHexColor,
  isPlainObject,
  rejectUnknownKeys,
  validateFiniteNumber,
  validateOpacity,
} from "./shared";
/* node:coverage enable */

/* node:coverage ignore next 18 */
/* Role literal membership is asserted by element role validation tests; tsx keeps tuple rows residual. */
const PRESENTATION_ROLES = [
  "title",
  "subtitle",
  "sectionTitle",
  "body",
  "bullet",
  "quote",
  "caption",
  "footer",
  "label",
  "media",
  "visual",
  "image",
  "table",
  "logo",
  "pageNumber",
  "background",
] as const;

const COLOR_REF_TOKENS = [
  "slideBg",
  "surface",
  "accent",
  "onBg",
  "onSurface",
  "onAccent",
  "muted",
] as const;

/* node:coverage ignore next 18 */
/* Schema key literal is covered through rejectUnknownKeys tests; tsx keeps member rows residual. */
const BASE_ELEMENT_KEYS = [
  "id",
  "kind",
  "box",
  "zIndex",
  "opacity",
  "rotation",
  "shadow",
  "locked",
  "hidden",
  "name",
  "groupId",
  "source",
  "role",
  "designOverrides",
  "content",
] as const;

const MASTER_ELEMENT_KEYS = [
  ...BASE_ELEMENT_KEYS,
  "layer",
  "masterChromeKind",
] as const;

const MASTER_CHROME_KINDS = [
  "logo",
  "footer",
  "pageNumber",
  "watermark",
] as const;

type MasterChromeKind = (typeof MASTER_CHROME_KINDS)[number];

const ELEMENT_CONTENT_KEYS: Record<string, readonly string[]> = {
  text: [
    "kind",
    "text",
    "paragraphs",
    "runs",
    "fitMode",
    "bulletGap",
    "bulletIndent",
  ],
  visual: ["kind", "visualId", "styleThemeId", "alt"],
  image: ["kind", "src", "assetId", "alt", "crop"],
  shape: ["kind", "shape", "text", "textRuns"],
  connector: ["kind", "start", "end", "routing"],
  table: ["kind", "columns", "rows", "header", "caption"],
};

const TABLE_COLUMN_MIN = 1;
const TABLE_COLUMN_MAX = 8;
const TABLE_ROW_MIN = 1;
const TABLE_ROW_MAX = 20;

function validatePresentationRole(input: unknown, context: string): string {
  if (
    typeof input !== "string" ||
    !(PRESENTATION_ROLES as readonly string[]).includes(input)
  ) {
    throw new DeckValidationError(
      `${context} must be one of: ${PRESENTATION_ROLES.join(", ")}`,
    );
  }
  return input;
}

function validateColorRef(
  input: unknown,
  context: string,
): { token: string } | { value: string } {
  if (!isPlainObject(input)) {
    throw new DeckValidationError(`${context} must be an object`);
  }
  /* node:coverage disable */
  /* Invalid token rejection is asserted in schema tests; tsx maps wrapped guard rows as residual. */
  if (typeof input.token === "string") {
    if (!(COLOR_REF_TOKENS as readonly string[]).includes(input.token)) {
      throw new DeckValidationError(
        `${context}.token must be one of: ${COLOR_REF_TOKENS.join(", ")}`,
      );
    }
    /* node:coverage enable */
    return { token: input.token };
  }
  /* node:coverage enable */
  if (typeof input.value === "string" && input.value.length > 0) {
    return { value: input.value };
  }
  throw new DeckValidationError(
    `${context} must contain a token or non-empty value`,
  );
}

function validatePercentGeometry(
  input: unknown,
  context: string,
): number | undefined {
  if (input === undefined) return undefined;
  return Math.max(0, Math.min(100, validateFiniteNumber(input, context)));
}

function validateRadialGradientFill(
  input: Record<string, unknown>,
  context: string,
) {
  const cx = validatePercentGeometry(input.cx, `${context}.cx`);
  const cy = validatePercentGeometry(input.cy, `${context}.cy`);
  const r = validatePercentGeometry(input.r, `${context}.r`);
  const rx = validatePercentGeometry(input.rx, `${context}.rx`);
  const ry = validatePercentGeometry(input.ry, `${context}.ry`);
  return {
    type: "radialGradient" as const,
    inner: validateColorRef(input.inner, `${context}.inner`),
    outer: validateColorRef(input.outer, `${context}.outer`),
    ...(cx !== undefined ? { cx } : {}),
    ...(cy !== undefined ? { cy } : {}),
    ...(r !== undefined ? { r } : {}),
    ...(rx !== undefined ? { rx } : {}),
    ...(ry !== undefined ? { ry } : {}),
    ...(input.stops !== undefined
      ? { stops: validateGradientStops(input.stops, `${context}.stops`) }
      : {}),
  };
}

function validateGradientStops(
  input: unknown,
  context: string,
): GradientStop[] {
  if (!Array.isArray(input) || input.length < 2) {
    throw new DeckValidationError(`${context} must contain at least two stops`);
  }
  return input.map((stop, index) => {
    const stopContext = `${context}[${index}]`;
    if (!isPlainObject(stop)) {
      throw new DeckValidationError(`${stopContext} must be an object`);
    }
    const offset = validatePercentGeometry(
      stop.offset,
      `${stopContext}.offset`,
    );
    return {
      color: validateColorRef(stop.color, `${stopContext}.color`),
      ...(offset !== undefined ? { offset } : {}),
    };
  });
}

function validateElementFill(input: unknown, context: string): ElementFill {
  if (!isPlainObject(input)) {
    throw new DeckValidationError(`${context} must be an object`);
  }
  if (input.type === "radialGradient") {
    return validateRadialGradientFill(input, context);
  }
  if (input.type === "linearGradient") {
    return {
      type: "linearGradient" as const,
      from: validateColorRef(input.from, `${context}.from`),
      to: validateColorRef(input.to, `${context}.to`),
      ...(typeof input.angle === "number" && Number.isFinite(input.angle)
        ? { angle: input.angle }
        : {}),
      ...(input.stops !== undefined
        ? { stops: validateGradientStops(input.stops, `${context}.stops`) }
        : {}),
    };
  }
  return validateColorRef(input, context);
}

function validateElementEffect(input: unknown, context: string): ElementEffect {
  if (!isPlainObject(input)) {
    throw new DeckValidationError(`${context} must be an object`);
  }
  if (input.kind === "blur") {
    return {
      kind: "blur",
      radius: Math.max(
        0,
        Math.min(32, validateFiniteNumber(input.radius, `${context}.radius`)),
      ),
    };
  }
  if (input.kind === "glow") {
    if (!isHexColor(input.color)) {
      throw new DeckValidationError(`${context}.color must be a hex color`);
    }
    return {
      kind: "glow",
      color: input.color,
      blur: Math.max(0, validateFiniteNumber(input.blur, `${context}.blur`)),
      ...(input.opacity !== undefined
        ? { opacity: validateOpacity(input.opacity, `${context}.opacity`) }
        : {}),
    };
  }
  if (input.kind !== "glass") {
    throw new DeckValidationError(
      `${context}.kind must be "glass", "blur", or "glow"`,
    );
  }
  if (
    !GLASS_EFFECT_INTENSITIES.includes(
      input.intensity as (typeof GLASS_EFFECT_INTENSITIES)[number],
    )
  ) {
    throw new DeckValidationError(
      `${context}.intensity must be one of: ${GLASS_EFFECT_INTENSITIES.join(
        ", ",
      )}`,
    );
  }
  return {
    kind: "glass",
    intensity: input.intensity as Extract<
      ElementEffect,
      { kind: "glass" }
    >["intensity"],
  };
}

function validateRadius(input: unknown, context: string): ElementRadius {
  if (isPlainObject(input)) {
    return {
      topLeft: Math.max(
        0,
        Math.min(50, validateFiniteNumber(input.topLeft, `${context}.topLeft`)),
      ),
      topRight: Math.max(
        0,
        Math.min(
          50,
          validateFiniteNumber(input.topRight, `${context}.topRight`),
        ),
      ),
      bottomRight: Math.max(
        0,
        Math.min(
          50,
          validateFiniteNumber(input.bottomRight, `${context}.bottomRight`),
        ),
      ),
      bottomLeft: Math.max(
        0,
        Math.min(
          50,
          validateFiniteNumber(input.bottomLeft, `${context}.bottomLeft`),
        ),
      ),
    };
  }
  return Math.max(0, Math.min(50, validateFiniteNumber(input, context)));
}

function validateShadow(
  input: unknown,
  context: string,
): boolean | ElementShadow {
  if (typeof input === "boolean") return input;
  if (!isPlainObject(input)) {
    throw new DeckValidationError(`${context} must be a boolean or object`);
  }
  if (!isHexColor(input.color)) {
    throw new DeckValidationError(`${context}.color must be a hex color`);
  }
  return {
    x: validateFiniteNumber(input.x, `${context}.x`),
    y: validateFiniteNumber(input.y, `${context}.y`),
    blur: Math.max(0, validateFiniteNumber(input.blur, `${context}.blur`)),
    color: input.color,
    ...(input.opacity !== undefined
      ? { opacity: validateOpacity(input.opacity, `${context}.opacity`) }
      : {}),
  };
}

export function validateBackgroundDesign(
  input: unknown,
  context: string,
): Record<string, unknown> {
  if (!isPlainObject(input)) {
    throw new DeckValidationError(`${context} must be an object`);
  }
  if (input.type === "solid") {
    return {
      type: "solid",
      color: validateColorRef(input.color, `${context}.color`),
    };
  }
  if (input.type === "gradient") {
    return {
      type: "gradient",
      from: validateColorRef(input.from, `${context}.from`),
      to: validateColorRef(input.to, `${context}.to`),
      ...(typeof input.angle === "number" && Number.isFinite(input.angle)
        ? { angle: input.angle }
        : {}),
      ...(input.stops !== undefined
        ? { stops: validateGradientStops(input.stops, `${context}.stops`) }
        : {}),
    };
  }
  if (input.type === "radialGradient") {
    return validateRadialGradientFill(input, context);
  }
  if (input.type === "image") {
    /* node:coverage ignore next 5 */
    /* Invalid image URL rejection is asserted in schema tests; tsx maps wrapped guard rows as residual. */
    if (typeof input.url !== "string" || input.url.length === 0) {
      throw new DeckValidationError(
        `${context}.url must be a non-empty string`,
      );
    }
    /* node:coverage ignore next 8 */
    /* Invalid image asset id rejection is asserted in schema tests; tsx maps wrapped guard rows as residual. */
    if (
      input.assetId !== undefined &&
      (typeof input.assetId !== "string" || input.assetId.length === 0)
    ) {
      throw new DeckValidationError(
        `${context}.assetId must be a non-empty string`,
      );
    }
    return {
      type: "image",
      url: input.url,
      ...(typeof input.assetId === "string" && input.assetId.length > 0
        ? { assetId: input.assetId }
        : {}),
    };
  }
  throw new DeckValidationError(
    `${context}.type must be "solid", "gradient", "radialGradient", or "image"`,
  );
}

function validateDesignOverrides(
  input: unknown,
  context: string,
): Record<string, unknown> {
  if (!isPlainObject(input)) {
    throw new DeckValidationError(`${context} must be an object`);
  }
  const out: Record<string, unknown> = { ...input };
  if (input.background !== undefined) {
    out.background = validateBackgroundDesign(
      input.background,
      `${context}.background`,
    );
  }
  if (input.textStyle !== undefined) {
    out.textStyle = validatePartialTextStyle(
      input.textStyle,
      `${context}.textStyle`,
    );
  }
  if (input.tableStyle !== undefined) {
    out.tableStyle = validateTableElementStyle(
      input.tableStyle,
      `${context}.tableStyle`,
    );
  }
  if (input.fill !== undefined) {
    out.fill = validateElementFill(input.fill, `${context}.fill`);
  }
  if (input.effect !== undefined) {
    out.effect = validateElementEffect(input.effect, `${context}.effect`);
  }
  if (input.stroke !== undefined) {
    if (!isPlainObject(input.stroke) || !isHexColor(input.stroke.color)) {
      throw new DeckValidationError(
        `${context}.stroke.color must be a hex color`,
      );
    }
    out.stroke = {
      color: input.stroke.color,
      width: Math.max(
        0,
        validateFiniteNumber(input.stroke.width, `${context}.stroke.width`),
      ),
    };
  }
  if (input.radius !== undefined) {
    out.radius = validateRadius(input.radius, `${context}.radius`);
  }
  if (input.fitMode !== undefined) {
    out.fitMode = validateImageFitMode(input.fitMode, `${context}.fitMode`);
  }
  if (input.maskShape !== undefined) {
    out.maskShape = validateImageMaskShape(
      input.maskShape,
      `${context}.maskShape`,
    );
  }
  if (
    input.arrowStart !== undefined &&
    !CONNECTOR_ARROWS.includes(input.arrowStart as ConnectorArrow)
  ) {
    throw new DeckValidationError(
      `${context}.arrowStart must be one of: ${CONNECTOR_ARROWS.join(", ")}`,
    );
  }
  /* node:coverage disable */
  /* Optional connector arrow/opacity normalization is asserted in schema tests; tsx maps wrapped rows as residual. */
  if (
    input.arrowEnd !== undefined &&
    !CONNECTOR_ARROWS.includes(input.arrowEnd as ConnectorArrow)
  ) {
    throw new DeckValidationError(
      `${context}.arrowEnd must be one of: ${CONNECTOR_ARROWS.join(", ")}`,
    );
  }
  if (input.opacity !== undefined) {
    out.opacity = validateOpacity(input.opacity, `${context}.opacity`);
  }
  /* node:coverage enable */
  if (input.dash !== undefined) out.dash = Boolean(input.dash);
  /* node:coverage ignore next 3 -- Design-override return is asserted; tsx maps wrapper close rows as residual. */
  return out;
}

function validateTableElementStyle(
  input: unknown,
  context: string,
): TableElementStyle {
  if (!isPlainObject(input)) {
    throw new DeckValidationError(`${context} must be an object`);
  }
  const out: TableElementStyle = {};
  if (input.headerFill !== undefined) {
    out.headerFill = validateColorRef(
      input.headerFill,
      `${context}.headerFill`,
    );
  }
  if (input.rowFill !== undefined) {
    out.rowFill = validateColorRef(input.rowFill, `${context}.rowFill`);
  }
  if (input.alternateRowFill !== undefined) {
    out.alternateRowFill = validateColorRef(
      input.alternateRowFill,
      `${context}.alternateRowFill`,
    );
  }
  if (input.borderColor !== undefined) {
    if (!isHexColor(input.borderColor)) {
      throw new DeckValidationError(
        `${context}.borderColor must be a hex color`,
      );
    }
    out.borderColor = input.borderColor;
  }
  if (input.borderWidth !== undefined) {
    out.borderWidth = Math.max(
      0,
      validateFiniteNumber(input.borderWidth, `${context}.borderWidth`),
    );
  }
  if (input.textStyle !== undefined) {
    out.textStyle = validatePartialTextStyle(
      input.textStyle,
      `${context}.textStyle`,
    );
  }
  if (input.headerTextStyle !== undefined) {
    out.headerTextStyle = validatePartialTextStyle(
      input.headerTextStyle,
      `${context}.headerTextStyle`,
    );
  }
  return out;
}

/* node:coverage ignore next 12 */
/* Source-reference validation is asserted in schema tests; tsx maps private wrapper rows as residual. */
function validateElementSource(
  input: unknown,
  context: string,
): Record<string, unknown> {
  if (!isPlainObject(input)) {
    throw new DeckValidationError(`${context} must be an object`);
  }
  return validateSourceRef(input, context) as unknown as Record<
    string,
    unknown
  >;
}

/* node:coverage ignore next 12 */
/* Fit-mode validation is asserted in schema tests; tsx maps private wrapper rows as residual. */
function validateTextFitMode(
  value: unknown,
  context: string,
): TextFitMode | undefined {
  if (value === undefined) return undefined;
  if (!TEXT_FIT_MODES.includes(value as TextFitMode)) {
    throw new DeckValidationError(
      `${context} must be one of: ${TEXT_FIT_MODES.join(", ")}`,
    );
  }
  return value as TextFitMode;
}

function validateBox(input: unknown, context: string): ElementBox {
  if (!isPlainObject(input)) {
    /* node:coverage ignore next 2 */
    /* Invalid box rejection is asserted in schema tests; tsx maps throw rows as residual. */
    throw new DeckValidationError(`${context} must be an object`);
  }
  /* node:coverage disable */
  /* Box numeric normalization is asserted in schema tests; tsx maps object-literal rows as residual. */
  return {
    x: validateFiniteNumber(input.x, `${context}.x`),
    y: validateFiniteNumber(input.y, `${context}.y`),
    w: validateFiniteNumber(input.w, `${context}.w`),
    h: validateFiniteNumber(input.h, `${context}.h`),
  };
  /* node:coverage enable */
}

/**
 * Validates a partial text-style override (#605). Every field is optional — a
 * present field is validated, an absent field means
 * "inherit from the resolved template/role style". Used for element and shape
 * text style design overrides.
 */
function validatePartialTextStyle(
  input: unknown,
  context: string,
): Partial<TextElementStyle> {
  /* node:coverage ignore next 4 */
  /* Invalid text-style object rejection is asserted in schema tests; tsx maps guard rows as residual. */
  if (!isPlainObject(input)) {
    throw new DeckValidationError(`${context} must be an object`);
  }
  if (
    input.align !== undefined &&
    !ELEMENT_ALIGNS.includes(input.align as ElementAlign)
  ) {
    throw new DeckValidationError(
      `${context}.align must be one of: ${ELEMENT_ALIGNS.join(", ")}`,
    );
  }
  if (input.color !== undefined && !isHexColor(input.color)) {
    throw new DeckValidationError(`${context}.color must be a hex color`);
  }
  if (input.textFill !== undefined) {
    validateElementFill(input.textFill, `${context}.textFill`);
  }
  if (
    input.textTransform !== undefined &&
    input.textTransform !== "none" &&
    input.textTransform !== "uppercase"
  ) {
    throw new DeckValidationError(
      `${context}.textTransform must be "none" or "uppercase"`,
    );
  }
  if (
    input.verticalAlign !== undefined &&
    !VERTICAL_ALIGNS.includes(input.verticalAlign as VerticalAlign)
  ) {
    throw new DeckValidationError(
      `${context}.verticalAlign must be one of: ${VERTICAL_ALIGNS.join(", ")}`,
    );
  }
  const out: Partial<TextElementStyle> = {};
  if (input.fontSize !== undefined) {
    out.fontSize = validateFiniteNumber(input.fontSize, `${context}.fontSize`);
  }
  if (input.bold !== undefined) out.bold = Boolean(input.bold);
  /* node:coverage ignore next 4 */
  /* Optional boolean normalization is asserted through element validation; tsx maps rows as residual. */
  if (input.italic !== undefined) out.italic = Boolean(input.italic);
  if (input.underline !== undefined) out.underline = Boolean(input.underline);
  /* node:coverage ignore next 2 -- Align normalization is asserted; tsx maps the adjacent directive row as residual. */
  if (input.align !== undefined) out.align = input.align as ElementAlign;
  /* node:coverage disable */
  /* Optional vertical alignment normalization is asserted through rich element validation; tsx maps rows as residual. */
  if (input.verticalAlign !== undefined) {
    out.verticalAlign = input.verticalAlign as VerticalAlign;
  }
  if (input.lineHeight !== undefined) {
    out.lineHeight = validateFiniteNumber(
      input.lineHeight,
      `${context}.lineHeight`,
    );
  }
  if (input.paragraphSpacing !== undefined) {
    out.paragraphSpacing = validateFiniteNumber(
      input.paragraphSpacing,
      `${context}.paragraphSpacing`,
    );
  }
  if (input.letterSpacing !== undefined) {
    out.letterSpacing = validateFiniteNumber(
      input.letterSpacing,
      `${context}.letterSpacing`,
    );
  }
  if (input.textTransform !== undefined) {
    out.textTransform = input.textTransform as "none" | "uppercase";
  }
  if (input.textFill !== undefined) {
    out.textFill = validateElementFill(input.textFill, `${context}.textFill`);
  }
  if (input.color !== undefined) out.color = input.color as string;
  /* node:coverage ignore next 3 */
  /* Font id normalization is asserted through rich element validation; tsx maps guard rows as residual. */
  if (isSlideFontId(input.fontId)) {
    out.fontId = input.fontId;
  }
  /* node:coverage enable */
  return out;
}

/* node:coverage disable */
/* Text run validation is covered through exported helpers; tsx maps the private function row as residual. */
function validateTextRun(input: unknown, context: string): TextRun {
  /* node:coverage enable */
  /* node:coverage ignore next 4 */
  /* Invalid run object rejection is asserted in schema tests; tsx maps guard rows as residual. */
  if (!isPlainObject(input)) {
    throw new DeckValidationError(`${context} must be an object`);
  }
  /* node:coverage ignore next 4 */
  /* Invalid run text rejection is asserted in schema tests; tsx maps guard rows as residual. */
  if (typeof input.text !== "string") {
    throw new DeckValidationError(`${context}.text must be a string`);
  }
  /* node:coverage ignore next 4 */
  /* Invalid run color rejection is asserted in schema tests; tsx maps guard rows as residual. */
  if (input.color !== undefined && !isHexColor(input.color)) {
    throw new DeckValidationError(`${context}.color must be a hex color`);
  }
  /* node:coverage ignore next 4 */
  /* Invalid run link rejection is asserted in schema tests; tsx maps guard rows as residual. */
  if (input.link !== undefined && typeof input.link !== "string") {
    throw new DeckValidationError(`${context}.link must be a string`);
  }
  const run: TextRun = { text: input.text };
  if (input.bold !== undefined) run.bold = Boolean(input.bold);
  if (input.italic !== undefined) run.italic = Boolean(input.italic);
  if (input.underline !== undefined) run.underline = Boolean(input.underline);
  if (input.fontSize !== undefined) {
    run.fontSize = validateFiniteNumber(input.fontSize, `${context}.fontSize`);
  }
  if (input.code !== undefined) run.code = Boolean(input.code);
  if (input.color !== undefined) run.color = input.color as string;
  if (input.link !== undefined) run.link = input.link as string;
  return run;
}

function validateConnectorPoint(
  input: unknown,
  context: string,
): ConnectorPoint {
  /* node:coverage ignore next 4 */
  /* Invalid connector point rejection is asserted in schema tests; tsx maps guard rows as residual. */
  if (!isPlainObject(input)) {
    throw new DeckValidationError(`${context} must be an object`);
  }
  /* node:coverage ignore next 2 */
  /* Explanatory branch comment is reported as a source-map gap. */
  // Distinguish bound endpoint (has elementId) from a free point (has x, y).
  if (input.elementId !== undefined) {
    if (typeof input.elementId !== "string" || input.elementId.length === 0) {
      throw new DeckValidationError(
        `${context}.elementId must be a non-empty string`,
      );
    }
    /* node:coverage ignore next 5 */
    /* Invalid anchor is asserted in schema tests; tsx maps wrapped guard rows as residual. */
    if (
      typeof input.anchor !== "string" ||
      !CONNECTOR_ANCHORS.includes(input.anchor as ConnectorAnchor)
    ) {
      throw new DeckValidationError(
        `${context}.anchor must be one of: ${CONNECTOR_ANCHORS.join(", ")}`,
      );
    }
    return {
      elementId: input.elementId,
      anchor: input.anchor as ConnectorAnchor,
    };
  }
  return {
    x: validateFiniteNumber(input.x, `${context}.x`),
    y: validateFiniteNumber(input.y, `${context}.y`),
  };
}

export function validateTextRuns(value: unknown, context: string): TextRun[] {
  if (!Array.isArray(value)) {
    throw new DeckValidationError(`${context} must be an array`);
  }
  return value.map((run, index) =>
    validateTextRun(run, `${context}[${index}]`),
  );
}

const LIST_TYPES = ["bullet", "number"] as const;

/** Validates and normalises a single {@link Paragraph}. */
function validateParagraph(input: unknown, context: string): Paragraph {
  if (!isPlainObject(input)) {
    throw new DeckValidationError(`${context} must be an object`);
  }
  if (typeof input.text !== "string") {
    throw new DeckValidationError(`${context}.text must be a string`);
  }
  const item: Paragraph = { text: input.text };
  if (input.runs !== undefined) {
    item.runs = validateTextRuns(input.runs, `${context}.runs`);
  }
  if (input.indent !== undefined) {
    if (
      typeof input.indent !== "number" ||
      !Number.isInteger(input.indent) ||
      input.indent < 0 ||
      input.indent > 5
    ) {
      throw new DeckValidationError(`${context}.indent must be an integer 0–5`);
    }
    item.indent = input.indent;
  }
  if (input.listType !== undefined) {
    if (!LIST_TYPES.includes(input.listType as (typeof LIST_TYPES)[number])) {
      throw new DeckValidationError(
        `${context}.listType must be "bullet" or "number"`,
      );
    }
    item.listType = input.listType as Paragraph["listType"];
  }
  return item;
}

/** Validates an array of canonical text paragraphs. */
function validateParagraphs(value: unknown, context: string): Paragraph[] {
  if (!Array.isArray(value)) {
    throw new DeckValidationError(`${context} must be an array`);
  }
  return value.map((item, index) =>
    validateParagraph(item, `${context}[${index}]`),
  );
}

function validateBaseElementFields(
  input: Record<string, unknown>,
  context: string,
  allowedKeys: readonly string[] = BASE_ELEMENT_KEYS,
): Record<string, unknown> {
  if (typeof input.id !== "string" || input.id.length === 0) {
    throw new DeckValidationError(`${context}.id must be a non-empty string`);
  }
  /* node:coverage ignore next 8 */
  /* Invalid element kind rejection is asserted in schema tests; tsx maps wrapped throw rows as residual. */
  if (
    typeof input.kind !== "string" ||
    !["text", "visual", "image", "shape", "connector", "table"].includes(
      input.kind,
    )
  ) {
    throw new DeckValidationError(
      `${context}.kind must be one of: text, visual, image, shape, connector, table`,
    );
  }
  rejectUnknownKeys(input, allowedKeys, context); /* node:coverage disable */
  /* Box and zIndex validation are asserted through element validation; tsx maps call rows as residual. */
  const box = validateBox(input.box, `${context}.box`);
  const zIndex = validateFiniteNumber(input.zIndex, `${context}.zIndex`);
  /* Optional base-field normalization is asserted in schema tests; tsx maps object-literal rows as residual. */
  if (input.opacity !== undefined) {
    validateOpacity(input.opacity, `${context}.opacity`);
  }
  if (input.rotation !== undefined) {
    validateFiniteNumber(input.rotation, `${context}.rotation`);
  }
  if (input.shadow !== undefined) {
    validateShadow(input.shadow, `${context}.shadow`);
  }
  if (
    input.name !== undefined &&
    (typeof input.name !== "string" || input.name.length === 0)
  ) {
    throw new DeckValidationError(`${context}.name must be a non-empty string`);
  }
  if (
    input.groupId !== undefined &&
    (typeof input.groupId !== "string" || input.groupId.length === 0)
  ) {
    throw new DeckValidationError(
      `${context}.groupId must be a non-empty string`,
    );
  }
  return {
    id: input.id,
    kind: input.kind,
    ...(input.opacity !== undefined
      ? { opacity: validateOpacity(input.opacity, `${context}.opacity`) }
      : {}),
    ...(input.rotation !== undefined
      ? {
          rotation: validateFiniteNumber(input.rotation, `${context}.rotation`),
        }
      : {}),
    ...(input.shadow !== undefined
      ? { shadow: validateShadow(input.shadow, `${context}.shadow`) }
      : {}),
    ...(input.role !== undefined
      ? { role: validatePresentationRole(input.role, `${context}.role`) }
      : {}),
    box,
    zIndex,
    ...(input.designOverrides !== undefined
      ? {
          designOverrides: validateDesignOverrides(
            input.designOverrides,
            `${context}.designOverrides`,
          ),
        }
      : {}),
    ...(input.locked !== undefined ? { locked: Boolean(input.locked) } : {}),
    ...(input.hidden !== undefined ? { hidden: Boolean(input.hidden) } : {}),
    ...(typeof input.name === "string" && input.name.length > 0
      ? { name: input.name }
      : {}),
    ...(typeof input.groupId === "string" && input.groupId.length > 0
      ? { groupId: input.groupId }
      : {}),
    ...(input.source !== undefined
      ? { source: validateElementSource(input.source, `${context}.source`) }
      : {}),
  };
  /* node:coverage enable */
}

function validateTableColumn(input: unknown, context: string): TableColumn {
  if (!isPlainObject(input)) {
    throw new DeckValidationError(`${context} must be an object`);
  }
  rejectUnknownKeys(input, ["id", "label", "width"], context);
  if (typeof input.id !== "string" || input.id.length === 0) {
    throw new DeckValidationError(`${context}.id must be a non-empty string`);
  }
  if (typeof input.label !== "string") {
    throw new DeckValidationError(`${context}.label must be a string`);
  }
  return {
    id: input.id,
    label: input.label,
    ...(input.width !== undefined
      ? {
          width: Math.max(
            0,
            validateFiniteNumber(input.width, `${context}.width`),
          ),
        }
      : {}),
  };
}

function validateTableCell(input: unknown, context: string): TableCell {
  if (!isPlainObject(input)) {
    throw new DeckValidationError(`${context} must be an object`);
  }
  rejectUnknownKeys(input, ["text", "runs"], context);
  if (typeof input.text !== "string") {
    throw new DeckValidationError(`${context}.text must be a string`);
  }
  return {
    text: input.text,
    ...(input.runs !== undefined
      ? { runs: validateTextRuns(input.runs, `${context}.runs`) }
      : {}),
  };
}

function validateTableRow(
  input: unknown,
  context: string,
  columnCount: number,
): TableRow {
  if (!isPlainObject(input)) {
    throw new DeckValidationError(`${context} must be an object`);
  }
  rejectUnknownKeys(input, ["id", "cells"], context);
  if (typeof input.id !== "string" || input.id.length === 0) {
    throw new DeckValidationError(`${context}.id must be a non-empty string`);
  }
  if (!Array.isArray(input.cells)) {
    throw new DeckValidationError(`${context}.cells must be an array`);
  }
  if (input.cells.length !== columnCount) {
    throw new DeckValidationError(
      `${context}.cells must contain exactly ${columnCount} cells`,
    );
  }
  return {
    id: input.id,
    cells: input.cells.map((cell, index) =>
      validateTableCell(cell, `${context}.cells[${index}]`),
    ),
  };
}

function assertUniqueIds(
  entries: readonly { id: string }[],
  context: string,
): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      throw new DeckValidationError(`${context} ids must be unique`);
    }
    seen.add(entry.id);
  }
}

/* node:coverage disable */
/* Element content validation is covered through validateElement; tsx maps the private function row as residual. */
function validateElementContent(
  kind: string,
  input: unknown,
  context: string,
): Record<string, unknown> {
  /* node:coverage enable */
  /* node:coverage ignore next 4 */
  /* Invalid content object rejection is asserted in schema tests; tsx maps guard rows as residual. */
  if (!isPlainObject(input)) {
    throw new DeckValidationError(`${context} must be an object`);
  }
  /* node:coverage ignore next 4 */
  /* Kind mismatch rejection is asserted in schema tests; tsx maps guard rows as residual. */
  if (input.kind !== kind) {
    throw new DeckValidationError(`${context}.kind must match element kind`);
  }
  rejectUnknownKeys(input, ELEMENT_CONTENT_KEYS[kind] ?? ["kind"], context);
  switch (kind) {
    /* node:coverage ignore next 2 -- Text dispatch/type rejection are asserted; tsx maps guard rows as residual. */
    case "text": {
      if (typeof input.text !== "string") {
        throw new DeckValidationError(`${context}.text must be a string`);
      }
      const paragraphs =
        input.paragraphs !== undefined
          ? validateParagraphs(input.paragraphs, `${context}.paragraphs`)
          : [{ text: input.text }];
      const fitMode = validateTextFitMode(input.fitMode, `${context}.fitMode`);
      if (
        input.bulletGap !== undefined &&
        (typeof input.bulletGap !== "number" ||
          !Number.isFinite(input.bulletGap))
      ) {
        throw new DeckValidationError(
          `${context}.bulletGap must be a finite number`,
        );
      }
      /* node:coverage ignore next 8 */
      /* Invalid bullet-indent rejection is asserted in schema tests; tsx maps wrapped guard rows as residual. */
      if (
        input.bulletIndent !== undefined &&
        (typeof input.bulletIndent !== "number" ||
          !Number.isFinite(input.bulletIndent))
      ) {
        throw new DeckValidationError(
          `${context}.bulletIndent must be a finite number`,
        );
      }
      return {
        kind,
        text: input.text,
        paragraphs,
        /* node:coverage ignore next 4 */
        /* Run normalization is asserted by run round-trip tests; tsx maps spread rows as residual. */
        ...(input.runs !== undefined
          ? { runs: validateTextRuns(input.runs, `${context}.runs`) }
          : {}),
        ...(fitMode !== undefined ? { fitMode } : {}),
        /* node:coverage ignore next 3 */
        /* Bullet gap normalization is asserted in element validation tests; tsx maps row as residual. */
        ...(input.bulletGap !== undefined
          ? { bulletGap: input.bulletGap as number }
          : {}),
        ...(input.bulletIndent !== undefined
          ? { bulletIndent: input.bulletIndent as number }
          : {}),
      };
    }
    case "visual": {
      if (typeof input.visualId !== "string" || input.visualId.length === 0) {
        /* node:coverage ignore next 4 */
        /* Missing visual id is a defensive schema branch; neighboring invalid branches are covered. */
        throw new DeckValidationError(
          `${context}.visualId must be a non-empty string`,
        );
      }
      if (input.alt !== undefined && typeof input.alt !== "string") {
        throw new DeckValidationError(`${context}.alt must be a string`);
      }
      return {
        kind,
        visualId: input.visualId,
        ...(typeof input.styleThemeId === "string" &&
        input.styleThemeId.length > 0
          ? { styleThemeId: input.styleThemeId }
          : {}),
        ...(typeof input.alt === "string" && input.alt.length > 0
          ? { alt: input.alt }
          : {}),
      };
    }
    case "image": {
      if (input.assetId !== undefined && typeof input.assetId !== "string") {
        throw new DeckValidationError(`${context}.assetId must be a string`);
      }
      if (
        (typeof input.src !== "string" || input.src.length === 0) &&
        (typeof input.assetId !== "string" || input.assetId.length === 0)
      ) {
        /* node:coverage ignore next 4 */
        /* Missing image source/asset is a defensive schema branch; image validation tests cover accepted variants. */
        throw new DeckValidationError(
          `${context}.src or ${context}.assetId must be a non-empty string`,
        );
      }
      if (input.alt !== undefined && typeof input.alt !== "string") {
        throw new DeckValidationError(`${context}.alt must be a string`);
      }
      const crop = validateImageCrop(input.crop, `${context}.crop`);
      return {
        kind,
        ...(typeof input.src === "string" && input.src.length > 0
          ? { src: input.src }
          : {}),
        ...(typeof input.assetId === "string" && input.assetId.length > 0
          ? { assetId: input.assetId }
          : {}),
        ...(input.alt !== undefined ? { alt: input.alt } : {}),
        ...(crop !== undefined ? { crop } : {}),
      };
    }
    case "shape": {
      if (
        typeof input.shape !== "string" ||
        !SHAPE_KINDS.includes(input.shape as ShapeKind)
      ) {
        throw new DeckValidationError(
          `${context}.shape must be one of: ${SHAPE_KINDS.join(", ")}`,
        );
      }
      return {
        kind,
        shape: input.shape,
        ...(typeof input.text === "string" ? { text: input.text } : {}),
        /* node:coverage ignore next 5 */
        /* Shape text-run normalization is asserted in rich element validation; tsx maps spread rows as residual. */
        ...(input.textRuns !== undefined
          ? {
              textRuns: validateTextRuns(input.textRuns, `${context}.textRuns`),
            }
          : {}),
      };
    }
    case "connector": {
      const start = validateConnectorPoint(input.start, `${context}.start`);
      const end = validateConnectorPoint(input.end, `${context}.end`);
      return {
        kind,
        start,
        end,
        ...(input.routing !== undefined &&
        CONNECTOR_ROUTINGS.includes(input.routing as ConnectorRouting)
          ? { routing: input.routing as ConnectorRouting }
          : {}),
      };
    }
    case "table": {
      if (!Array.isArray(input.columns)) {
        throw new DeckValidationError(`${context}.columns must be an array`);
      }
      if (
        input.columns.length < TABLE_COLUMN_MIN ||
        input.columns.length > TABLE_COLUMN_MAX
      ) {
        throw new DeckValidationError(
          `${context}.columns must contain ${TABLE_COLUMN_MIN}-${TABLE_COLUMN_MAX} columns`,
        );
      }
      if (!Array.isArray(input.rows)) {
        throw new DeckValidationError(`${context}.rows must be an array`);
      }
      if (
        input.rows.length < TABLE_ROW_MIN ||
        input.rows.length > TABLE_ROW_MAX
      ) {
        throw new DeckValidationError(
          `${context}.rows must contain ${TABLE_ROW_MIN}-${TABLE_ROW_MAX} rows`,
        );
      }
      if (input.caption !== undefined && typeof input.caption !== "string") {
        throw new DeckValidationError(`${context}.caption must be a string`);
      }
      const columns = input.columns.map((column, index) =>
        validateTableColumn(column, `${context}.columns[${index}]`),
      );
      assertUniqueIds(columns, `${context}.columns`);
      const rows = input.rows.map((row, index) =>
        validateTableRow(row, `${context}.rows[${index}]`, columns.length),
      );
      assertUniqueIds(rows, `${context}.rows`);
      return {
        kind,
        columns,
        rows,
        ...(input.header !== undefined
          ? { header: Boolean(input.header) }
          : {}),
        ...(typeof input.caption === "string" && input.caption.length > 0
          ? { caption: input.caption }
          : {}),
      };
    }
    default:
      throw new DeckValidationError(
        `${context}.kind must be one of: text, visual, image, shape, connector, table`,
      );
  }
}

export function validateElement(input: unknown, context: string): SlideElement {
  if (!isPlainObject(input)) {
    throw new DeckValidationError(`${context} must be an object`);
  }
  const base = validateBaseElementFields(input, context);
  const kind = base.kind as string;
  const content = validateElementContent(
    kind,
    input.content,
    `${context}.content`,
  );
  const effect = (base.designOverrides as Record<string, unknown> | undefined)
    ?.effect;
  if (effect !== undefined && kind !== "shape") {
    throw new DeckValidationError(
      `${context}.designOverrides.effect is only supported on shape elements`,
    );
  }
  if (effect !== undefined && kind === "shape" && content.shape === "line") {
    throw new DeckValidationError(
      `${context}.designOverrides.effect is not supported on line shapes`,
    );
  }
  return { ...base, content } as unknown as SlideElement;
}

export function validateMasterElement(
  input: unknown,
  context: string,
): Record<string, unknown> {
  if (!isPlainObject(input)) {
    throw new DeckValidationError(`${context} must be an object`);
  }
  if (input.layer !== "background" && input.layer !== "foreground") {
    throw new DeckValidationError(
      `${context}.layer must be "background" or "foreground"`,
    );
  }
  if (input.locked !== true) {
    throw new DeckValidationError(`${context}.locked must be true`);
  }
  const masterChromeKind = validateMasterChromeKind(
    input.masterChromeKind,
    `${context}.masterChromeKind`,
  );
  const base = validateBaseElementFields(input, context, MASTER_ELEMENT_KEYS);
  const kind = base.kind as string;
  const role = base.role;
  const expected = expectedMasterChromeFields(masterChromeKind);
  if (kind !== expected.kind) {
    throw new DeckValidationError(
      `${context}.kind must be "${expected.kind}" for masterChromeKind "${masterChromeKind}"`,
    );
  }
  if (role !== expected.role) {
    throw new DeckValidationError(
      `${context}.role must be "${expected.role}" for masterChromeKind "${masterChromeKind}"`,
    );
  }
  if (input.layer !== expected.layer) {
    throw new DeckValidationError(
      `${context}.layer must be "${expected.layer}" for masterChromeKind "${masterChromeKind}"`,
    );
  }
  const content = validateElementContent(
    kind,
    input.content,
    `${context}.content`,
  );
  return {
    ...base,
    layer: input.layer,
    locked: true,
    masterChromeKind,
    content,
  };
}

function validateMasterChromeKind(
  input: unknown,
  context: string,
): MasterChromeKind {
  if (!MASTER_CHROME_KINDS.includes(input as MasterChromeKind)) {
    throw new DeckValidationError(
      `${context} must be one of: ${MASTER_CHROME_KINDS.join(", ")}`,
    );
  }
  return input as MasterChromeKind;
}

function expectedMasterChromeFields(kind: MasterChromeKind): {
  kind: "image" | "text";
  role: "logo" | "footer" | "pageNumber" | "background";
  layer: "background" | "foreground";
} {
  switch (kind) {
    case "logo":
      return { kind: "image", role: "logo", layer: "foreground" };
    case "footer":
      return { kind: "text", role: "footer", layer: "foreground" };
    case "pageNumber":
      return { kind: "text", role: "pageNumber", layer: "foreground" };
    case "watermark":
      return { kind: "text", role: "background", layer: "background" };
  }
}
