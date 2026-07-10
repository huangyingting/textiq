import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildConnectorElement,
  buildDeck,
  buildImageElement,
  buildShapeElement,
  buildSlide,
  buildTableElement,
  buildVisualElement,
} from "@/test/builders/deck";
import {
  safeParseDeck,
  validateElement,
  validateImageCrop,
  validateImageFitMode,
  validateImageMaskShape,
  validateSourceRef,
} from "./deck-schema";

test("safeParseDeck returns a normalized deck for valid current schema payloads", () => {
  const deck = buildDeck({
    design: {
      themeId: "  default  ",
      themeOverrides: { colors: { primary: "#000" } },
    },
    slides: [
      buildSlide({
        designOverrides: {
          background: { type: "image", url: "data:image/png;base64,bg" },
        },
      }),
    ],
  });
  const result = safeParseDeck(deck);
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.design?.themeId, "default");
    assert.equal(
      result.data.slides[0].designOverrides?.background?.type,
      "image",
    );
  }
});

test("safeParseDeck returns validator messages for schema errors", () => {
  const result = safeParseDeck({ ...buildDeck(), slides: "nope" });
  assert.deepEqual(result, {
    success: false,
    error: "Deck.slides must be an array",
  });
});

test("safeParseDeck masks unexpected non-validation errors", () => {
  const throwingDeck = new Proxy(buildDeck(), {
    ownKeys() {
      throw new Error("unexpected trap");
    },
  });
  assert.deepEqual(safeParseDeck(throwingDeck), {
    success: false,
    error: "Invalid deck",
  });
});

test("re-exported validators accept and reject focused element subcontracts", () => {
  assert.equal(validateImageFitMode("cover", "fitMode"), "cover");
  assert.throws(
    () => validateImageFitMode("stretch", "fitMode"),
    /must be one of/,
  );
  assert.equal(validateImageMaskShape("circle", "maskShape"), "circle");
  assert.throws(
    () => validateImageMaskShape("star", "maskShape"),
    /must be one of/,
  );
  assert.deepEqual(
    validateImageCrop({ top: 0, right: 0.1, bottom: 0.2, left: 0.3 }, "crop"),
    { top: 0, right: 0.1, bottom: 0.2, left: 0.3 },
  );
  assert.throws(
    () => validateImageCrop({ top: -1, right: 0, bottom: 0, left: 0 }, "crop"),
    /top must be between 0 and 1/,
  );
  assert.deepEqual(
    validateSourceRef(
      {
        documentId: "doc",
        blockId: "block",
        linkedAt: "2026-07-02T20:42:41Z",
        blockKind: "table",
      },
      "source",
    ),
    {
      documentId: "doc",
      blockId: "block",
      linkedAt: "2026-07-02T20:42:41Z",
      blockKind: "table",
    },
  );
  assert.throws(
    () =>
      validateSourceRef(
        {
          documentId: "",
          blockId: "block",
          linkedAt: "2026-07-02T20:42:41Z",
          blockKind: "text",
        },
        "source",
      ),
    /documentId/,
  );
  assert.equal(
    validateElement(
      buildImageElement({ src: "data:image/png;base64,abc" }),
      "element",
    ).kind,
    "image",
  );
  assert.throws(
    () =>
      validateElement({ ...buildImageElement(), kind: "unknown" }, "element"),
    /kind/,
  );
});

// ---------------------------------------------------------------------------
// Custom template contracts
// ---------------------------------------------------------------------------

test("safeParseDeck accepts a valid custom template with optional fields", () => {
  const deck = buildDeck({
    customTemplates: [
      {
        id: "tmpl-intro",
        name: "Intro",
        category: "title",
        source: "system",
        styleMode: "fixed",
        accepts: ["title", "subtitle"],
        elements: [],
      },
    ],
  });
  const result = safeParseDeck(deck);
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.customTemplates?.[0]?.id, "tmpl-intro");
    assert.equal(result.data.customTemplates?.[0]?.category, "title");
  }
});

test("safeParseDeck rejects a custom template with an unrecognised category", () => {
  const result = safeParseDeck({
    ...buildDeck(),
    customTemplates: [
      { id: "t1", name: "Bad", category: "outro", elements: [] },
    ],
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.error, /category.*must be one of/);
  }
});

test("safeParseDeck rejects a custom template with an invalid styleMode", () => {
  const result = safeParseDeck({
    ...buildDeck(),
    customTemplates: [
      {
        id: "t1",
        name: "Tmpl",
        category: "content",
        styleMode: "adaptive",
        elements: [],
      },
    ],
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.error, /styleMode.*must be one of/);
  }
});

test("safeParseDeck rejects a custom template whose accepts entry is an empty string", () => {
  const result = safeParseDeck({
    ...buildDeck(),
    customTemplates: [
      {
        id: "t1",
        name: "Tmpl",
        category: "media",
        accepts: [""],
        elements: [],
      },
    ],
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.error, /accepts.*non-empty/);
  }
});

test("safeParseDeck rejects a custom template with non-array elements", () => {
  const result = safeParseDeck({
    ...buildDeck(),
    customTemplates: [
      { id: "t1", name: "Tmpl", category: "blank", elements: "not-an-array" },
    ],
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.error, /elements.*must be an array/);
  }
});

// ---------------------------------------------------------------------------
// Valid element content — visual, shape, connector, table
// ---------------------------------------------------------------------------

test("validateElement accepts a visual element with visualId, styleThemeId, and alt", () => {
  const el = buildVisualElement({
    visualId: "chart-abc",
    styleThemeId: "ocean",
    alt: "Revenue chart",
  });
  const result = validateElement(el, "element");
  assert.equal(result.kind, "visual");
  if (result.kind === "visual") {
    assert.equal(result.content.visualId, "chart-abc");
  }
});

test("validateElement accepts a shape element with a valid shape kind", () => {
  const el = buildShapeElement({ shape: "ellipse" });
  const result = validateElement(el, "element");
  assert.equal(result.kind, "shape");
  if (result.kind === "shape") {
    assert.equal(result.content.shape, "ellipse");
  }
});

test("validateElement accepts a connector element with free-coordinate endpoints", () => {
  const el = buildConnectorElement({
    start: { x: 10, y: 20 },
    end: { x: 80, y: 70 },
  });
  const result = validateElement(el, "element");
  assert.equal(result.kind, "connector");
  if (result.kind === "connector") {
    assert.deepEqual(result.content.start, { x: 10, y: 20 });
    assert.deepEqual(result.content.end, { x: 80, y: 70 });
  }
});

test("validateElement accepts a table element with columns, rows, header, and caption", () => {
  const el = buildTableElement({ header: true, caption: "Summary" });
  const result = validateElement(el, "element");
  assert.equal(result.kind, "table");
  if (result.kind === "table") {
    assert.equal(result.content.columns.length, 2);
    assert.equal(result.content.rows.length, 1);
    assert.equal(result.content.header, true);
    assert.equal(result.content.caption, "Summary");
  }
});

// ---------------------------------------------------------------------------
// Invalid visual input and invalid table bounds/input
// ---------------------------------------------------------------------------

test("validateElement rejects a visual element with an empty visualId", () => {
  const el = buildVisualElement({ content: { kind: "visual", visualId: "" } });
  assert.throws(() => validateElement(el, "element"), /visualId.*non-empty/);
});

test("validateElement rejects a table element with zero columns", () => {
  const el = buildTableElement({
    content: { kind: "table", columns: [], rows: [] },
  });
  assert.throws(() => validateElement(el, "element"), /columns.*contain/);
});

test("validateElement rejects a table element exceeding the maximum column count", () => {
  const cols = Array.from({ length: 9 }, (_, i) => ({
    id: `col-${i}`,
    label: `C${i}`,
  }));
  const el = buildTableElement({
    content: {
      kind: "table",
      columns: cols,
      rows: [{ id: "row-1", cells: cols.map(() => ({ text: "" })) }],
    },
  });
  assert.throws(() => validateElement(el, "element"), /columns.*contain/);
});

test("validateElement rejects a table element exceeding the maximum row count", () => {
  const cols = [{ id: "col-1", label: "C1" }];
  const rows = Array.from({ length: 21 }, (_, i) => ({
    id: `row-${i}`,
    cells: [{ text: "" }],
  }));
  const el = buildTableElement({
    content: { kind: "table", columns: cols, rows },
  });
  assert.throws(() => validateElement(el, "element"), /rows.*contain/);
});

test("validateElement rejects a table row whose cell count does not match the column count", () => {
  const el = buildTableElement({
    content: {
      kind: "table",
      columns: [
        { id: "col-1", label: "C1" },
        { id: "col-2", label: "C2" },
      ],
      rows: [{ id: "row-1", cells: [{ text: "one cell only" }] }],
    },
  });
  assert.throws(() => validateElement(el, "element"), /cells.*exactly/);
});

// ---------------------------------------------------------------------------
// Master element validation — valid acceptance and mismatch rejection
// ---------------------------------------------------------------------------

test("safeParseDeck accepts a valid logo master element", () => {
  const deck = buildDeck({
    masters: [
      {
        id: "master-default",
        name: "Default",
        elements: [
          {
            id: "logo-el",
            kind: "image",
            role: "logo",
            layer: "foreground",
            locked: true,
            masterChromeKind: "logo",
            zIndex: 0,
            box: { x: 80, y: 2, w: 15, h: 8 },
            content: { kind: "image", src: "data:image/png;base64,logo" },
          },
        ],
      },
    ],
  });
  const result = safeParseDeck(deck);
  assert.equal(result.success, true);
  if (result.success) {
    const masterEl = result.data.masters?.[0]?.elements?.[0] as
      | { masterChromeKind: string; layer: string }
      | undefined;
    assert.equal(masterEl?.masterChromeKind, "logo");
    assert.equal(masterEl?.layer, "foreground");
  }
});

test("safeParseDeck rejects a master element whose layer mismatches the chrome kind", () => {
  const result = safeParseDeck(
    buildDeck({
      masters: [
        {
          id: "master-default",
          name: "Default",
          elements: [
            {
              id: "logo-el",
              kind: "image",
              role: "logo",
              layer: "background", // logo requires "foreground"
              locked: true,
              masterChromeKind: "logo",
              zIndex: 0,
              box: { x: 80, y: 2, w: 15, h: 8 },
              content: { kind: "image", src: "data:image/png;base64,logo" },
            },
          ],
        },
      ],
    }),
  );
  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.error, /layer.*foreground.*logo/);
  }
});

test("safeParseDeck rejects a master element whose kind mismatches the chrome kind", () => {
  const result = safeParseDeck(
    buildDeck({
      masters: [
        {
          id: "master-default",
          name: "Default",
          elements: [
            {
              id: "logo-el",
              kind: "text", // logo requires "image"
              role: "logo",
              layer: "foreground",
              locked: true,
              masterChromeKind: "logo",
              zIndex: 0,
              box: { x: 80, y: 2, w: 15, h: 8 },
              content: { kind: "text", text: "Logo" },
            },
          ],
        },
      ],
    }),
  );
  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.error, /kind.*image.*logo/);
  }
});
