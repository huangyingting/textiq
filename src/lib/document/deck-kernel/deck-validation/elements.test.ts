import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildConnectorElement,
  buildImageElement,
  buildShapeElement,
  buildTableElement,
  buildTextElement,
  buildVisualElement,
} from "@/test/builders/deck";
import { DEFAULT_SLIDE_FONT_ID } from "../slide-fonts";
import type {
  ConnectorElementContent,
  ShapeElementContent,
  TableElementContent,
  TextElementContent,
} from "../deck-elements";
import {
  validateBackgroundDesign,
  validateAddElementPayload,
  validateElement,
  validateElementContentPayload,
  validateElementDesignOverridesPayload,
  validateElementPatchPayload,
  validateElementRole,
  validateMasterElement,
  validateTextRuns,
} from "./elements";

// ---------------------------------------------------------------------------
// validateBackgroundDesign — solid/gradient/radialGradient/image variants and
// nested color-ref/gradient-stop error propagation.
// ---------------------------------------------------------------------------

test("validateBackgroundDesign rejects a non-object input", () => {
  assert.throws(() => validateBackgroundDesign("solid", "background"), {
    message: /^background must be an object$/,
  });
});

test("validateBackgroundDesign rejects an unrecognised type", () => {
  assert.throws(
    () => validateBackgroundDesign({ type: "checkerboard" }, "background"),
    {
      message:
        /^background\.type must be "solid", "gradient", "radialGradient", or "image"$/,
    },
  );
});

test("validateBackgroundDesign accepts a solid color-ref token", () => {
  const result = validateBackgroundDesign(
    { type: "solid", color: { token: "slideBg" } },
    "background",
  );
  assert.deepEqual(result, { type: "solid", color: { token: "slideBg" } });
});

test("validateBackgroundDesign accepts a solid color-ref literal value", () => {
  const result = validateBackgroundDesign(
    { type: "solid", color: { value: "#ff00ff" } },
    "background",
  );
  assert.deepEqual(result, { type: "solid", color: { value: "#ff00ff" } });
});

test("validateBackgroundDesign rejects an unrecognised color-ref token with nested context", () => {
  assert.throws(
    () =>
      validateBackgroundDesign(
        { type: "solid", color: { token: "brand" } },
        "background",
      ),
    { message: /^background\.color\.token must be one of:/ },
  );
});

test("validateBackgroundDesign rejects a color ref with neither token nor value", () => {
  assert.throws(
    () => validateBackgroundDesign({ type: "solid", color: {} }, "background"),
    {
      message: /^background\.color must contain a token or non-empty value$/,
    },
  );
});

test("validateBackgroundDesign accepts a linear gradient with angle and stops", () => {
  const result = validateBackgroundDesign(
    {
      type: "gradient",
      from: { token: "slideBg" },
      to: { token: "accent" },
      angle: 45,
      stops: [
        { color: { value: "#000000" }, offset: 0 },
        { color: { value: "#ffffff" }, offset: 100 },
      ],
    },
    "background",
  );
  assert.equal(result.type, "gradient");
  assert.equal(result.angle, 45);
  assert.deepEqual(result.stops, [
    { color: { value: "#000000" }, offset: 0 },
    { color: { value: "#ffffff" }, offset: 100 },
  ]);
});

test("validateBackgroundDesign rejects a gradient with fewer than two stops (nested context)", () => {
  assert.throws(
    () =>
      validateBackgroundDesign(
        {
          type: "gradient",
          from: { token: "slideBg" },
          to: { token: "accent" },
          stops: [{ color: { value: "#000000" } }],
        },
        "background",
      ),
    {
      message: /^background\.stops must contain at least two stops$/,
    },
  );
});

test("validateBackgroundDesign accepts a radial gradient and clamps percent geometry", () => {
  const result = validateBackgroundDesign(
    {
      type: "radialGradient",
      inner: { token: "slideBg" },
      outer: { token: "accent" },
      cx: 150,
      cy: -20,
      r: 60,
    },
    "background",
  );
  assert.equal(result.type, "radialGradient");
  assert.equal(result.cx, 100);
  assert.equal(result.cy, 0);
  assert.equal(result.r, 60);
});

test("validateBackgroundDesign accepts an image background with url and assetId", () => {
  const result = validateBackgroundDesign(
    { type: "image", url: "https://example.test/bg.png", assetId: "asset-1" },
    "background",
  );
  assert.deepEqual(result, {
    type: "image",
    url: "https://example.test/bg.png",
    assetId: "asset-1",
  });
});

test("validateBackgroundDesign rejects an image background with an empty url", () => {
  assert.throws(
    () => validateBackgroundDesign({ type: "image", url: "" }, "background"),
    { message: /^background\.url must be a non-empty string$/ },
  );
});

test("validateBackgroundDesign rejects an image background with a blank assetId", () => {
  assert.throws(
    () =>
      validateBackgroundDesign(
        { type: "image", url: "https://example.test/bg.png", assetId: "" },
        "background",
      ),
    { message: /^background\.assetId must be a non-empty string$/ },
  );
});

// ---------------------------------------------------------------------------
// validateTextRuns — array boundary and per-run field validation.
// ---------------------------------------------------------------------------

test("validateTextRuns rejects a non-array input", () => {
  assert.throws(() => validateTextRuns("not-an-array", "content.runs"), {
    message: /^content\.runs must be an array$/,
  });
});

test("validateTextRuns normalizes every optional run field", () => {
  const result = validateTextRuns(
    [
      {
        text: "Hello",
        bold: 1,
        italic: 0,
        underline: true,
        code: false,
        fontSize: 12,
        color: "#123456",
        link: "https://example.test",
      },
    ],
    "content.runs",
  );
  assert.deepEqual(result, [
    {
      text: "Hello",
      bold: true,
      italic: false,
      underline: true,
      code: false,
      fontSize: 12,
      color: "#123456",
      link: "https://example.test",
    },
  ]);
});

test("validateTextRuns rejects a run missing a string text field with an indexed context", () => {
  assert.throws(() => validateTextRuns([{ text: 42 }], "content.runs"), {
    message: /^content\.runs\[0\]\.text must be a string$/,
  });
});

test("validateTextRuns rejects a run with an invalid color", () => {
  assert.throws(
    () => validateTextRuns([{ text: "hi", color: "blue" }], "content.runs"),
    { message: /^content\.runs\[0\]\.color must be a hex color$/ },
  );
});

test("validateTextRuns rejects a run with a non-string link", () => {
  assert.throws(
    () => validateTextRuns([{ text: "hi", link: 5 }], "content.runs"),
    { message: /^content\.runs\[0\]\.link must be a string$/ },
  );
});

// ---------------------------------------------------------------------------
// validateElement — base fields, geometry, and unknown-key rejection.
// ---------------------------------------------------------------------------

test("validateElement rejects a non-object input", () => {
  assert.throws(() => validateElement(null, "element"), {
    message: /^element must be an object$/,
  });
});

test("validateElement rejects a blank id", () => {
  assert.throws(
    () => validateElement({ ...buildTextElement(), id: "" }, "element"),
    { message: /^element\.id must be a non-empty string$/ },
  );
});

test("validateElement rejects an unrecognised kind", () => {
  assert.throws(
    () => validateElement({ ...buildTextElement(), kind: "video" }, "element"),
    {
      message:
        /^element\.kind must be one of: text, visual, image, shape, connector, table$/,
    },
  );
});

test("validateElement rejects an unknown top-level key", () => {
  assert.throws(
    () =>
      validateElement({ ...buildTextElement(), legacyFlag: true }, "element"),
    { message: /^element\.legacyFlag is not part of the current schema$/ },
  );
});

test("validateElement rejects an invalid box", () => {
  assert.throws(
    () => validateElement({ ...buildTextElement(), box: "full" }, "element"),
    { message: /^element\.box must be an object$/ },
  );
});

test("validateElement rejects a non-finite zIndex", () => {
  assert.throws(
    () =>
      validateElement({ ...buildTextElement(), zIndex: Infinity }, "element"),
    { message: /^element\.zIndex must be a finite number$/ },
  );
});

test("validateElement rejects an unrecognised presentation role", () => {
  assert.throws(
    () =>
      validateElement(
        { ...buildTextElement(), role: "hero" as never },
        "element",
      ),
    { message: /^element\.role must be one of:/ },
  );
});

test("validateElement rejects a blank name", () => {
  assert.throws(
    () => validateElement({ ...buildTextElement(), name: "" }, "element"),
    { message: /^element\.name must be a non-empty string$/ },
  );
});

test("validateElement rejects a blank groupId", () => {
  assert.throws(
    () => validateElement({ ...buildTextElement(), groupId: "" }, "element"),
    { message: /^element\.groupId must be a non-empty string$/ },
  );
});

test("validateElement accepts and normalizes a full set of optional base fields", () => {
  const result = validateElement(
    {
      ...buildTextElement(),
      opacity: 1.4,
      rotation: 90,
      shadow: true,
      locked: 1,
      hidden: 0,
      name: "Layer name",
      groupId: "group-1",
    },
    "element",
  );
  assert.equal(result.opacity, 1);
  assert.equal(result.rotation, 90);
  assert.equal(result.shadow, true);
  assert.equal(result.locked, true);
  assert.equal(result.hidden, false);
  assert.equal(result.name, "Layer name");
  assert.equal(result.groupId, "group-1");
});

test("validateElement accepts an object shadow and normalizes its optional opacity", () => {
  const result = validateElement(
    {
      ...buildTextElement(),
      shadow: { x: 2, y: 2, blur: -5, color: "#000000", opacity: 1.5 },
    },
    "element",
  );
  assert.deepEqual(result.shadow, {
    x: 2,
    y: 2,
    blur: 0,
    color: "#000000",
    opacity: 1,
  });
});

test("validateElement rejects an object shadow with a non-hex color", () => {
  assert.throws(
    () =>
      validateElement(
        {
          ...buildTextElement(),
          shadow: { x: 0, y: 0, blur: 0, color: "red" },
        },
        "element",
      ),
    { message: /^element\.shadow\.color must be a hex color$/ },
  );
});

test("validateElement requires content and rejects a missing content object", () => {
  const { content: _content, ...withoutContent } = buildTextElement();
  assert.throws(() => validateElement(withoutContent, "element"), {
    message: /^element\.content must be an object$/,
  });
});

test("validateElement rejects a content.kind mismatched with the element kind", () => {
  assert.throws(
    () =>
      validateElement(
        {
          ...buildTextElement(),
          content: { ...buildTextElement().content, kind: "shape" as never },
        },
        "element",
      ),
    { message: /^element\.content\.kind must match element kind$/ },
  );
});

test("validateElement rejects an unknown content key", () => {
  assert.throws(
    () =>
      validateElement(
        {
          ...buildTextElement(),
          content: { ...buildTextElement().content, legacyField: true },
        },
        "element",
      ),
    {
      message:
        /^element\.content\.legacyField is not part of the current schema$/,
    },
  );
});

test("validateAddElementPayload accepts an add-element shape without id or zIndex", () => {
  const result = validateAddElementPayload(
    {
      kind: "shape",
      box: { x: 0, y: 0, w: 10, h: 10 },
      content: { kind: "shape", shape: "rect" },
    },
    "payload.element",
  );
  assert.equal(result.id, "__command_validation_element__");
  assert.equal(result.zIndex, 0);
  assert.equal(result.kind, "shape");
});

test("validateAddElementPayload rejects malformed add-element content", () => {
  assert.throws(
    () =>
      validateAddElementPayload(
        {
          kind: "visual",
          box: { x: 0, y: 0, w: 10, h: 10 },
          content: { kind: "visual", visualId: "" },
        },
        "payload.element",
      ),
    {
      message:
        /^payload\.element\.content\.visualId must be a non-empty string$/,
    },
  );
});

test("validateElementPatchPayload accepts valid mutable element fields", () => {
  const result = validateElementPatchPayload(
    {
      box: { x: 1, y: 2, w: 3, h: 4 },
      hidden: false,
      locked: true,
      content: { kind: "shape", shape: "ellipse" },
      designOverrides: { fill: { value: "#ff00ff" } },
      role: "body",
    },
    "payload.patch",
  );
  assert.deepEqual(result.box, { x: 1, y: 2, w: 3, h: 4 });
  assert.equal(result.hidden, false);
  assert.equal(result.locked, true);
});

test("validateElementPatchPayload rejects immutable and typed-wrong patch fields", () => {
  assert.throws(
    () => validateElementPatchPayload({ kind: "shape" }, "payload.patch"),
    {
      message: /^payload\.patch\.kind is not part of the current schema$/,
    },
  );
  assert.throws(
    () => validateElementPatchPayload({ hidden: 1 }, "payload.patch"),
    { message: /^payload\.patch\.hidden must be a boolean$/ },
  );
});

test("validateElementContentPayload validates standalone element content", () => {
  assert.deepEqual(
    validateElementContentPayload(
      { kind: "text", text: "Hello" },
      "payload.content",
    ),
    {
      kind: "text",
      text: "Hello",
      paragraphs: [{ text: "Hello" }],
    },
  );
  assert.throws(
    () =>
      validateElementContentPayload(
        { kind: "visual", visualId: "" },
        "payload.content",
      ),
    { message: /^payload\.content\.visualId must be a non-empty string$/ },
  );
});

test("validateElementDesignOverridesPayload and role helper reject invalid command values", () => {
  assert.throws(
    () =>
      validateElementDesignOverridesPayload(
        { fill: "red" },
        "payload.designOverrides",
      ),
    { message: /^payload\.designOverrides\.fill must be an object$/ },
  );
  assert.throws(() => validateElementRole("hero", "payload.role"), {
    message: /^payload\.role must be one of:/,
  });
});

// ---------------------------------------------------------------------------
// validateElement — color refs, fills, gradients (via designOverrides.fill).
// ---------------------------------------------------------------------------

test("validateElement normalizes a linear gradient fill with stops", () => {
  const result = validateElement(
    buildShapeElement({
      designOverrides: {
        fill: {
          type: "linearGradient",
          from: { value: "#000000" },
          to: { value: "#ffffff" },
          angle: 30,
          stops: [
            { color: { value: "#000000" }, offset: 0 },
            { color: { value: "#ffffff" }, offset: 100 },
          ],
        },
      },
    }),
    "element",
  );
  const fill = result.designOverrides?.fill as Record<string, unknown>;
  assert.equal(fill.type, "linearGradient");
  assert.equal(fill.angle, 30);
});

test("validateElement normalizes a radial gradient fill", () => {
  const result = validateElement(
    buildShapeElement({
      designOverrides: {
        fill: {
          type: "radialGradient",
          inner: { token: "slideBg" },
          outer: { token: "accent" },
        },
      },
    }),
    "element",
  );
  const fill = result.designOverrides?.fill as Record<string, unknown>;
  assert.equal(fill.type, "radialGradient");
});

test("validateElement rejects an invalid fill color-ref token with full nested context", () => {
  assert.throws(
    () =>
      validateElement(
        buildShapeElement({
          designOverrides: { fill: { token: "brand" } },
        }),
        "element",
      ),
    { message: /^element\.designOverrides\.fill\.token must be one of:/ },
  );
});

// ---------------------------------------------------------------------------
// validateElement — effects, shadows, radii, stroke.
// ---------------------------------------------------------------------------

test("validateElement accepts a blur effect on a non-line shape", () => {
  const result = validateElement(
    buildShapeElement({
      shape: "rect",
      designOverrides: { effect: { kind: "blur", radius: 50 } },
    }),
    "element",
  );
  assert.deepEqual(result.designOverrides?.effect, {
    kind: "blur",
    radius: 32,
  });
});

test("validateElement accepts a glow effect with a clamped opacity", () => {
  const result = validateElement(
    buildShapeElement({
      shape: "ellipse",
      designOverrides: {
        effect: { kind: "glow", color: "#00ff00", blur: 4, opacity: 2 },
      },
    }),
    "element",
  );
  assert.deepEqual(result.designOverrides?.effect, {
    kind: "glow",
    color: "#00ff00",
    blur: 4,
    opacity: 1,
  });
});

test("validateElement accepts a glass effect with a valid intensity", () => {
  const result = validateElement(
    buildShapeElement({
      shape: "circle",
      designOverrides: { effect: { kind: "glass", intensity: "medium" } },
    }),
    "element",
  );
  assert.deepEqual(result.designOverrides?.effect, {
    kind: "glass",
    intensity: "medium",
  });
});

test("validateElement rejects an unrecognised effect kind", () => {
  assert.throws(
    () =>
      validateElement(
        buildShapeElement({
          designOverrides: { effect: { kind: "sparkle" } as never },
        }),
        "element",
      ),
    {
      message:
        /^element\.designOverrides\.effect\.kind must be "glass", "blur", or "glow"$/,
    },
  );
});

test("validateElement rejects designOverrides.effect on a non-shape element", () => {
  assert.throws(
    () =>
      validateElement(
        {
          ...buildTextElement(),
          designOverrides: {
            ...buildTextElement().designOverrides,
            effect: { kind: "blur", radius: 4 },
          },
        },
        "element",
      ),
    {
      message:
        /^element\.designOverrides\.effect is only supported on shape elements$/,
    },
  );
});

test("validateElement rejects designOverrides.effect on a line shape", () => {
  assert.throws(
    () =>
      validateElement(
        buildShapeElement({
          shape: "line",
          designOverrides: { effect: { kind: "blur", radius: 4 } },
        }),
        "element",
      ),
    {
      message:
        /^element\.designOverrides\.effect is not supported on line shapes$/,
    },
  );
});

test("validateElement clamps a uniform radius and a per-corner radius object", () => {
  const uniform = validateElement(buildImageElement({ radius: 90 }), "element");
  assert.equal(uniform.designOverrides?.radius, 50);

  const perCorner = validateElement(
    buildImageElement({
      designOverrides: {
        radius: { topLeft: -5, topRight: 60, bottomRight: 10, bottomLeft: 0 },
      },
    }),
    "element",
  );
  assert.deepEqual(perCorner.designOverrides?.radius, {
    topLeft: 0,
    topRight: 50,
    bottomRight: 10,
    bottomLeft: 0,
  });
});

test("validateElement normalizes a stroke and clamps a negative width", () => {
  const result = validateElement(
    buildConnectorElement({ stroke: { color: "#ff0000", width: -3 } }),
    "element",
  );
  assert.deepEqual(result.designOverrides?.stroke, {
    color: "#ff0000",
    width: 0,
  });
});

test("validateElement rejects a stroke with a non-hex color", () => {
  assert.throws(
    () =>
      validateElement(
        buildConnectorElement({ stroke: { color: "cyan", width: 1 } }),
        "element",
      ),
    {
      message: /^element\.designOverrides\.stroke\.color must be a hex color$/,
    },
  );
});

test("validateElement rejects an unrecognised arrowStart", () => {
  assert.throws(
    () =>
      validateElement(
        buildConnectorElement({ arrowStart: "diamond" as never }),
        "element",
      ),
    { message: /^element\.designOverrides\.arrowStart must be one of:/ },
  );
});

test("validateElement accepts arrowStart/arrowEnd/dash overrides on a connector", () => {
  const result = validateElement(
    buildConnectorElement({
      arrowStart: "arrow",
      arrowEnd: "filled",
      dash: true,
    }),
    "element",
  );
  assert.equal(result.designOverrides?.arrowStart, "arrow");
  assert.equal(result.designOverrides?.arrowEnd, "filled");
  assert.equal(result.designOverrides?.dash, true);
});

// ---------------------------------------------------------------------------
// validateElement — text style / table style design overrides.
// ---------------------------------------------------------------------------

test("validateElement normalizes a partial text-style override with every optional field", () => {
  const result = validateElement(
    buildTextElement({
      designOverrides: {
        textStyle: {
          fontSize: 5,
          bold: 1,
          italic: 0,
          underline: true,
          align: "center",
          verticalAlign: "middle",
          lineHeight: 1.2,
          paragraphSpacing: 0.5,
          letterSpacing: 0.1,
          textTransform: "uppercase",
          color: "#112233",
          fontId: DEFAULT_SLIDE_FONT_ID,
        } as never,
      },
    }),
    "element",
  );
  const style = result.designOverrides?.textStyle as Record<string, unknown>;
  assert.equal(style.fontSize, 5);
  assert.equal(style.bold, true);
  assert.equal(style.italic, false);
  assert.equal(style.align, "center");
  assert.equal(style.verticalAlign, "middle");
  assert.equal(style.textTransform, "uppercase");
  assert.equal(style.color, "#112233");
  assert.equal(style.fontId, DEFAULT_SLIDE_FONT_ID);
});

test("validateElement rejects an invalid textStyle.align", () => {
  assert.throws(
    () =>
      validateElement(
        buildTextElement({
          designOverrides: { textStyle: { align: "justify" as never } },
        }),
        "element",
      ),
    { message: /^element\.designOverrides\.textStyle\.align must be one of:/ },
  );
});

test("validateElement rejects an invalid textStyle.verticalAlign", () => {
  assert.throws(
    () =>
      validateElement(
        buildTextElement({
          designOverrides: {
            textStyle: { verticalAlign: "center" as never },
          },
        }),
        "element",
      ),
    {
      message:
        /^element\.designOverrides\.textStyle\.verticalAlign must be one of:/,
    },
  );
});

test("validateElement rejects an invalid textStyle.textTransform", () => {
  assert.throws(
    () =>
      validateElement(
        buildTextElement({
          designOverrides: {
            textStyle: { textTransform: "capitalize" as never },
          },
        }),
        "element",
      ),
    {
      message:
        /^element\.designOverrides\.textStyle\.textTransform must be "none" or "uppercase"$/,
    },
  );
});

test("validateElement rejects an invalid textStyle.color", () => {
  assert.throws(
    () =>
      validateElement(
        buildTextElement({
          designOverrides: { textStyle: { color: "green" } },
        }),
        "element",
      ),
    {
      message:
        /^element\.designOverrides\.textStyle\.color must be a hex color$/,
    },
  );
});

test("validateElement normalizes a full table-style design override on a table element", () => {
  const result = validateElement(
    {
      ...buildTableElement(),
      designOverrides: {
        tableStyle: {
          headerFill: { token: "surface" },
          rowFill: { value: "#ffffff" },
          alternateRowFill: { value: "#eeeeee" },
          borderColor: "#cccccc",
          borderWidth: -2,
          textStyle: { fontSize: 3 },
          headerTextStyle: { bold: true },
        },
      },
    },
    "element",
  );
  const style = result.designOverrides?.tableStyle as Record<string, unknown>;
  assert.deepEqual(style.headerFill, { token: "surface" });
  assert.equal(style.borderColor, "#cccccc");
  assert.equal(style.borderWidth, 0);
  assert.equal((style.textStyle as Record<string, unknown>).fontSize, 3);
  assert.equal((style.headerTextStyle as Record<string, unknown>).bold, true);
});

test("validateElement rejects a table-style borderColor that is not a hex color", () => {
  assert.throws(
    () =>
      validateElement(
        {
          ...buildTableElement(),
          designOverrides: { tableStyle: { borderColor: "black" } },
        },
        "element",
      ),
    {
      message:
        /^element\.designOverrides\.tableStyle\.borderColor must be a hex color$/,
    },
  );
});

test("validateElement threads a nested designOverrides.background error through the full context", () => {
  assert.throws(
    () =>
      validateElement(
        buildShapeElement({
          designOverrides: { background: { type: "checkerboard" } } as never,
        }),
        "element",
      ),
    {
      message:
        /^element\.designOverrides\.background\.type must be "solid", "gradient", "radialGradient", or "image"$/,
    },
  );
});

// ---------------------------------------------------------------------------
// validateElement — text runs, paragraphs, and fit mode via text content.
// ---------------------------------------------------------------------------

test("validateElement defaults paragraphs from text when paragraphs are absent", () => {
  const { paragraphs: _paragraphs, ...contentWithoutParagraphs } =
    buildTextElement().content;
  const result = validateElement(
    {
      ...buildTextElement(),
      content: { ...contentWithoutParagraphs, text: "Solo line" },
    },
    "element",
  );
  assert.deepEqual((result.content as TextElementContent).paragraphs, [
    { text: "Solo line" },
  ]);
});

test("validateElement normalizes explicit paragraphs with indent, listType, and runs", () => {
  const result = validateElement(
    buildTextElement({
      paragraphs: [
        {
          text: "Nested bullet",
          indent: 2,
          listType: "number",
          runs: [{ text: "Nested bullet", bold: true }],
        },
      ],
    }),
    "element",
  );
  assert.deepEqual((result.content as TextElementContent).paragraphs, [
    {
      text: "Nested bullet",
      indent: 2,
      listType: "number",
      runs: [{ text: "Nested bullet", bold: true }],
    },
  ]);
});

test("validateElement rejects a paragraph indent outside the 0-5 range", () => {
  assert.throws(
    () =>
      validateElement(
        buildTextElement({ paragraphs: [{ text: "x", indent: 6 }] }),
        "element",
      ),
    {
      message:
        /^element\.content\.paragraphs\[0\]\.indent must be an integer 0–5$/,
    },
  );
});

test("validateElement rejects an unrecognised paragraph listType", () => {
  assert.throws(
    () =>
      validateElement(
        buildTextElement({
          paragraphs: [{ text: "x", listType: "checklist" as never }],
        }),
        "element",
      ),
    {
      message:
        /^element\.content\.paragraphs\[0\]\.listType must be "bullet" or "number"$/,
    },
  );
});

test("validateElement accepts every catalog text fitMode", () => {
  for (const fitMode of [
    "auto-height",
    "fixed-box",
    "shrink-to-fit",
  ] as const) {
    const result = validateElement(
      buildTextElement({ content: { fitMode } as never }),
      "element",
    );
    assert.equal((result.content as TextElementContent).fitMode, fitMode);
  }
});

test("validateElement rejects an unrecognised fitMode", () => {
  assert.throws(
    () =>
      validateElement(
        buildTextElement({ content: { fitMode: "auto" } as never }),
        "element",
      ),
    { message: /^element\.content\.fitMode must be one of:/ },
  );
});

test("validateElement rejects a non-numeric bulletGap", () => {
  assert.throws(
    () =>
      validateElement(
        buildTextElement({ content: { bulletGap: "large" } as never }),
        "element",
      ),
    { message: /^element\.content\.bulletGap must be a finite number$/ },
  );
});

test("validateElement rejects a non-numeric bulletIndent", () => {
  assert.throws(
    () =>
      validateElement(
        buildTextElement({ content: { bulletIndent: "big" } as never }),
        "element",
      ),
    { message: /^element\.content\.bulletIndent must be a finite number$/ },
  );
});

test("validateElement normalizes bulletGap, bulletIndent, and top-level runs together", () => {
  const result = validateElement(
    buildTextElement({
      content: { bulletGap: 2, bulletIndent: 4 } as never,
      runs: [{ text: "Fixture text" }],
    }),
    "element",
  );
  const content = result.content as TextElementContent;
  assert.equal(content.bulletGap, 2);
  assert.equal(content.bulletIndent, 4);
  assert.deepEqual(content.runs, [{ text: "Fixture text" }]);
});

// ---------------------------------------------------------------------------
// validateElement — connectors: free/bound points, anchors, routing.
// ---------------------------------------------------------------------------

test("validateElement accepts a connector with free points and a routing mode", () => {
  const result = validateElement(
    buildConnectorElement({
      start: { x: 5, y: 5 },
      end: { x: 90, y: 90 },
      routing: "elbow",
    }),
    "element",
  );
  const content = result.content as ConnectorElementContent;
  assert.deepEqual(content.start, { x: 5, y: 5 });
  assert.deepEqual(content.end, { x: 90, y: 90 });
  assert.equal(content.routing, "elbow");
});

test("validateElement accepts a connector with bound endpoints", () => {
  const result = validateElement(
    buildConnectorElement({
      start: { elementId: "shape-a", anchor: "right" },
      end: { elementId: "shape-b", anchor: "left" },
    }),
    "element",
  );
  const content = result.content as ConnectorElementContent;
  assert.deepEqual(content.start, {
    elementId: "shape-a",
    anchor: "right",
  });
  assert.deepEqual(content.end, {
    elementId: "shape-b",
    anchor: "left",
  });
});

test("validateElement rejects a bound connector endpoint with an empty elementId", () => {
  assert.throws(
    () =>
      validateElement(
        buildConnectorElement({
          start: { elementId: "", anchor: "center" },
        }),
        "element",
      ),
    {
      message:
        /^element\.content\.start\.elementId must be a non-empty string$/,
    },
  );
});

test("validateElement rejects a bound connector endpoint with an invalid anchor", () => {
  assert.throws(
    () =>
      validateElement(
        buildConnectorElement({
          end: { elementId: "shape-a", anchor: "middle" as never },
        }),
        "element",
      ),
    { message: /^element\.content\.end\.anchor must be one of:/ },
  );
});

test("validateElement rejects a free connector point with a non-finite coordinate", () => {
  assert.throws(
    () =>
      validateElement(
        buildConnectorElement({ start: { x: "left" as never, y: 5 } }),
        "element",
      ),
    { message: /^element\.content\.start\.x must be a finite number$/ },
  );
});

test("validateElement drops an unrecognised connector routing instead of rejecting it", () => {
  const result = validateElement(
    buildConnectorElement({ routing: "curved" as never }),
    "element",
  );
  assert.equal((result.content as ConnectorElementContent).routing, undefined);
});

// ---------------------------------------------------------------------------
// validateElement — tables: columns, rows, cells, and uniqueness.
// ---------------------------------------------------------------------------

test("validateElement accepts a canonical table with header and caption", () => {
  const result = validateElement(
    buildTableElement({ header: true, caption: "Fixture caption" }),
    "element",
  );
  const content = result.content as TableElementContent;
  assert.equal(content.columns.length, 2);
  assert.equal(content.rows.length, 1);
  assert.equal(content.header, true);
  assert.equal(content.caption, "Fixture caption");
});

test("validateElement rejects a table with too few columns", () => {
  assert.throws(
    () => validateElement(buildTableElement({ columns: [] }), "element"),
    { message: /^element\.content\.columns must contain \d+-\d+ columns$/ },
  );
});

test("validateElement rejects a table with too many rows", () => {
  const columns = [{ id: "col-1", label: "Column 1" }];
  const rows = Array.from({ length: 25 }, (_unused, index) => ({
    id: `row-${index}`,
    cells: [{ text: "" }],
  }));
  assert.throws(
    () => validateElement(buildTableElement({ columns, rows }), "element"),
    { message: /^element\.content\.rows must contain \d+-\d+ rows$/ },
  );
});

test("validateElement rejects duplicate table column ids", () => {
  assert.throws(
    () =>
      validateElement(
        buildTableElement({
          columns: [
            { id: "col-1", label: "A" },
            { id: "col-1", label: "B" },
          ],
          rows: [{ id: "row-1", cells: [{ text: "" }, { text: "" }] }],
        }),
        "element",
      ),
    { message: /^element\.content\.columns ids must be unique$/ },
  );
});

test("validateElement rejects duplicate table row ids", () => {
  assert.throws(
    () =>
      validateElement(
        buildTableElement({
          rows: [
            { id: "row-1", cells: [{ text: "" }, { text: "" }] },
            { id: "row-1", cells: [{ text: "" }, { text: "" }] },
          ],
        }),
        "element",
      ),
    { message: /^element\.content\.rows ids must be unique$/ },
  );
});

test("validateElement rejects a row whose cell count does not match the column count", () => {
  assert.throws(
    () =>
      validateElement(
        buildTableElement({
          rows: [{ id: "row-1", cells: [{ text: "only one" }] }],
        }),
        "element",
      ),
    {
      message:
        /^element\.content\.rows\[0\]\.cells must contain exactly 2 cells$/,
    },
  );
});

test("validateElement rejects an unknown key on a table column", () => {
  assert.throws(
    () =>
      validateElement(
        buildTableElement({
          columns: [{ id: "col-1", label: "A", legacyWidth: 10 } as never],
        }),
        "element",
      ),
    {
      message:
        /^element\.content\.columns\[0\]\.legacyWidth is not part of the current schema$/,
    },
  );
});

test("validateElement rejects an unknown key on a table cell", () => {
  assert.throws(
    () =>
      validateElement(
        buildTableElement({
          rows: [
            {
              id: "row-1",
              cells: [{ text: "a", legacy: true } as never, { text: "b" }],
            },
          ],
        }),
        "element",
      ),
    {
      message:
        /^element\.content\.rows\[0\]\.cells\[0\]\.legacy is not part of the current schema$/,
    },
  );
});

test("validateElement normalizes table cell runs", () => {
  const result = validateElement(
    buildTableElement({
      rows: [
        {
          id: "row-1",
          cells: [
            { text: "Rich", runs: [{ text: "Rich", bold: true }] },
            { text: "" },
          ],
        },
      ],
    }),
    "element",
  );
  assert.deepEqual(
    (result.content as TableElementContent).rows[0].cells[0].runs,
    [{ text: "Rich", bold: true }],
  );
});

// ---------------------------------------------------------------------------
// validateElement — shape content (kind, text, textRuns).
// ---------------------------------------------------------------------------

test("validateElement accepts a shape with text and textRuns", () => {
  const result = validateElement(
    buildShapeElement({
      shape: "triangle",
      text: "Label",
      textRuns: [{ text: "Label", bold: true }],
    }),
    "element",
  );
  const content = result.content as ShapeElementContent;
  assert.equal(content.shape, "triangle");
  assert.equal(content.text, "Label");
  assert.deepEqual(content.textRuns, [{ text: "Label", bold: true }]);
});

test("validateElement rejects an unrecognised shape kind", () => {
  assert.throws(
    () =>
      validateElement(
        buildShapeElement({ shape: "hexagon" as never }),
        "element",
      ),
    { message: /^element\.content\.shape must be one of:/ },
  );
});

// ---------------------------------------------------------------------------
// validateElement — visual (media) and image content.
// ---------------------------------------------------------------------------

test("validateElement accepts a visual element with styleThemeId and alt", () => {
  const result = validateElement(
    buildVisualElement({ styleThemeId: "theme-1", alt: "Chart" }),
    "element",
  );
  const content = result.content as {
    visualId?: string;
    styleThemeId?: string;
    alt?: string;
  };
  assert.equal(content.visualId, "visual-fixture");
  assert.equal(content.styleThemeId, "theme-1");
  assert.equal(content.alt, "Chart");
});

test("validateElement rejects a visual element with a blank visualId", () => {
  assert.throws(
    () => validateElement(buildVisualElement({ visualId: "" }), "element"),
    { message: /^element\.content\.visualId must be a non-empty string$/ },
  );
});

test("validateElement accepts an image element identified only by assetId", () => {
  const result = validateElement(
    buildImageElement({ content: { kind: "image", assetId: "asset-only" } }),
    "element",
  );
  const content = result.content as { assetId?: string; src?: string };
  assert.equal(content.assetId, "asset-only");
  assert.equal(content.src, undefined);
});

test("validateElement rejects an image element with neither src nor assetId", () => {
  assert.throws(
    () =>
      validateElement(
        buildImageElement({ content: { kind: "image" } }),
        "element",
      ),
    {
      message:
        /^element\.content\.src or element\.content\.assetId must be a non-empty string$/,
    },
  );
});

test("validateElement rejects an image element with a non-string alt", () => {
  assert.throws(
    () =>
      validateElement(
        buildImageElement({
          content: {
            kind: "image",
            src: "https://example.test/i.png",
            alt: 5 as never,
          },
        }),
        "element",
      ),
    { message: /^element\.content\.alt must be a string$/ },
  );
});

test("validateElement normalizes an image crop through the full element boundary", () => {
  const result = validateElement(
    buildImageElement({
      crop: { top: 0, right: 0.2, bottom: 0, left: 0.2 },
    }),
    "element",
  );
  const content = result.content as { crop?: unknown };
  assert.deepEqual(content.crop, {
    top: 0,
    right: 0.2,
    bottom: 0,
    left: 0.2,
  });
});

// ---------------------------------------------------------------------------
// validateElement — source-ref provenance threading.
// ---------------------------------------------------------------------------

const VALID_SOURCE_REF = {
  documentId: "doc-1",
  blockId: "block-1",
  blockKind: "text" as const,
  linkedAt: "2026-07-02T20:42:41Z",
};

test("validateElement accepts a valid element source ref", () => {
  const result = validateElement(
    buildTextElement({ source: VALID_SOURCE_REF }),
    "element",
  );
  assert.deepEqual(result.source, VALID_SOURCE_REF);
});

test("validateElement rejects an invalid element source ref with nested context", () => {
  assert.throws(
    () =>
      validateElement(
        buildTextElement({
          source: { ...VALID_SOURCE_REF, blockKind: "spreadsheet" as never },
        }),
        "element",
      ),
    {
      message:
        /^element\.source\.blockKind must be "text", "visual", or "table"$/,
    },
  );
});

// ---------------------------------------------------------------------------
// validateMasterElement — chrome kind/kind/role/layer pairing.
// ---------------------------------------------------------------------------

function buildMasterChromeElement(
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id: "chrome-fixture",
    box: { x: 0, y: 0, w: 20, h: 10 },
    zIndex: 0,
    layer: "foreground",
    locked: true,
    ...overrides,
  };
}

test("validateMasterElement rejects a non-object input", () => {
  assert.throws(() => validateMasterElement("chrome", "master.elements[0]"), {
    message: /^master\.elements\[0\] must be an object$/,
  });
});

test("validateMasterElement rejects an invalid layer", () => {
  assert.throws(
    () =>
      validateMasterElement(
        buildMasterChromeElement({ layer: "sideground" }),
        "master.elements[0]",
      ),
    {
      message:
        /^master\.elements\[0\]\.layer must be "background" or "foreground"$/,
    },
  );
});

test("validateMasterElement rejects locked !== true", () => {
  assert.throws(
    () =>
      validateMasterElement(
        buildMasterChromeElement({ locked: false }),
        "master.elements[0]",
      ),
    { message: /^master\.elements\[0\]\.locked must be true$/ },
  );
});

test("validateMasterElement rejects an unrecognised masterChromeKind", () => {
  assert.throws(
    () =>
      validateMasterElement(
        buildMasterChromeElement({ masterChromeKind: "sticker" }),
        "master.elements[0]",
      ),
    {
      message: /^master\.elements\[0\]\.masterChromeKind must be one of:/,
    },
  );
});

test("validateMasterElement accepts a logo chrome element (image/logo/foreground)", () => {
  const result = validateMasterElement(
    buildMasterChromeElement({
      masterChromeKind: "logo",
      kind: "image",
      role: "logo",
      content: { kind: "image", src: "https://example.test/logo.png" },
    }),
    "master.elements[0]",
  );
  assert.equal(result.masterChromeKind, "logo");
  assert.equal(result.kind, "image");
  assert.equal(result.layer, "foreground");
  assert.equal(result.locked, true);
});

test("validateMasterElement accepts a footer chrome element (text/footer/foreground)", () => {
  const result = validateMasterElement(
    buildMasterChromeElement({
      masterChromeKind: "footer",
      kind: "text",
      role: "footer",
      content: { kind: "text", text: "Footer" },
    }),
    "master.elements[0]",
  );
  assert.equal(result.masterChromeKind, "footer");
  assert.equal(result.kind, "text");
});

test("validateMasterElement accepts a pageNumber chrome element (text/pageNumber/foreground)", () => {
  const result = validateMasterElement(
    buildMasterChromeElement({
      masterChromeKind: "pageNumber",
      kind: "text",
      role: "pageNumber",
      content: { kind: "text", text: "1" },
    }),
    "master.elements[0]",
  );
  assert.equal(result.masterChromeKind, "pageNumber");
});

test("validateMasterElement accepts a watermark chrome element (text/background/background layer)", () => {
  const result = validateMasterElement(
    buildMasterChromeElement({
      layer: "background",
      masterChromeKind: "watermark",
      kind: "text",
      role: "background",
      content: { kind: "text", text: "WM" },
    }),
    "master.elements[0]",
  );
  assert.equal(result.masterChromeKind, "watermark");
  assert.equal(result.layer, "background");
});

test("validateMasterElement rejects a kind mismatched with its masterChromeKind", () => {
  assert.throws(
    () =>
      validateMasterElement(
        buildMasterChromeElement({
          masterChromeKind: "logo",
          kind: "text",
          role: "logo",
          content: { kind: "text", text: "not a logo" },
        }),
        "master.elements[0]",
      ),
    {
      message:
        /^master\.elements\[0\]\.kind must be "image" for masterChromeKind "logo"$/,
    },
  );
});

test("validateMasterElement rejects a role mismatched with its masterChromeKind", () => {
  assert.throws(
    () =>
      validateMasterElement(
        buildMasterChromeElement({
          masterChromeKind: "footer",
          kind: "text",
          role: "label",
          content: { kind: "text", text: "Footer" },
        }),
        "master.elements[0]",
      ),
    {
      message:
        /^master\.elements\[0\]\.role must be "footer" for masterChromeKind "footer"$/,
    },
  );
});

test("validateMasterElement rejects a layer mismatched with its masterChromeKind", () => {
  assert.throws(
    () =>
      validateMasterElement(
        buildMasterChromeElement({
          layer: "background",
          masterChromeKind: "footer",
          kind: "text",
          role: "footer",
          content: { kind: "text", text: "Footer" },
        }),
        "master.elements[0]",
      ),
    {
      message:
        /^master\.elements\[0\]\.layer must be "foreground" for masterChromeKind "footer"$/,
    },
  );
});

test("validateMasterElement rejects an unknown top-level key beyond the master element schema", () => {
  assert.throws(
    () =>
      validateMasterElement(
        buildMasterChromeElement({
          masterChromeKind: "footer",
          kind: "text",
          role: "footer",
          content: { kind: "text", text: "Footer" },
          legacyChromeFlag: true,
        }),
        "master.elements[0]",
      ),
    {
      message:
        /^master\.elements\[0\]\.legacyChromeFlag is not part of the current schema$/,
    },
  );
});
