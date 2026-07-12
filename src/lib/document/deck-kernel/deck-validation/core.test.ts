import assert from "node:assert/strict";
import { test } from "node:test";

import { buildDeck, buildSlide, buildTextElement } from "@/test/builders/deck";
import { validateDeck } from "./core";

/**
 * Returns a plain, untyped deck payload built from a canonical valid deck plus
 * the given overrides. Kept as `unknown` (matching `validateDeck`'s boundary
 * type) so malformed shapes that intentionally violate the `Deck` type can be
 * expressed directly, without casting at every call site.
 */
function corruptDeck(overrides: Record<string, unknown>): unknown {
  return { ...buildDeck(), ...overrides };
}

test("validateDeck accepts a canonical valid deck and returns a normalized copy", () => {
  const deck = buildDeck({
    design: { themeId: "  default  ", themeOverrides: { accent: "#000" } },
    masters: [
      {
        id: "master-default",
        name: "Default",
        elements: [],
      },
    ],
    slides: [buildSlide()],
  });
  const result = validateDeck(deck);
  assert.equal(result.schemaVersion, 6);
  assert.deepEqual(result.canvas, { format: "16:9" });
  assert.equal(result.design?.themeId, "default");
  assert.deepEqual(result.design?.themeOverrides, { accent: "#000" });
  assert.equal(result.defaultMasterId, "master-default");
  assert.equal(result.masters?.[0]?.id, "master-default");
  assert.equal(result.slides.length, 1);
  assert.equal(result.slides[0].id, "slide-fixture");
  assert.equal(result.slides[0].elements?.length, 2);
});

test("validateDeck rejects a non-object input", () => {
  assert.throws(() => validateDeck(null), {
    message: /^Deck must be an object$/,
  });
  assert.throws(() => validateDeck("deck"), {
    message: /^Deck must be an object$/,
  });
});

test("validateDeck rejects an array input (arrays are not plain objects)", () => {
  assert.throws(() => validateDeck([]), {
    message: /^Deck must be an object$/,
  });
});

test("validateDeck rejects an unknown top-level key", () => {
  assert.throws(() => validateDeck(corruptDeck({ extraTopLevelField: true })), {
    message: /^Deck\.extraTopLevelField is not part of the current schema$/,
  });
});

test("validateDeck rejects a non-integer schemaVersion", () => {
  assert.throws(() => validateDeck(corruptDeck({ schemaVersion: 6.5 })), {
    message: /^Deck\.schemaVersion must be an integer$/,
  });
});

test("validateDeck rejects an unsupported schemaVersion", () => {
  assert.throws(() => validateDeck(corruptDeck({ schemaVersion: 7 })), {
    message: /^Deck\.schemaVersion 7 is not supported \(legacy v6: 6\)$/,
  });
});

test("validateDeck rejects a non-object canvas", () => {
  assert.throws(() => validateDeck(corruptDeck({ canvas: "16:9" })), {
    message: /^Deck\.canvas must be an object$/,
  });
});

test("validateDeck rejects an unknown canvas key", () => {
  assert.throws(
    () =>
      validateDeck(
        corruptDeck({ canvas: { format: "16:9", pixelDensity: 2 } }),
      ),
    {
      message: /^Deck\.canvas\.pixelDensity is not part of the current schema$/,
    },
  );
});

test("validateDeck rejects an unrecognised canvas.format", () => {
  assert.throws(
    () => validateDeck(corruptDeck({ canvas: { format: "1:1" } })),
    { message: /^Deck\.canvas\.format must be one of: 16:9, 4:3$/ },
  );
});

test("validateDeck rejects a non-object design", () => {
  assert.throws(() => validateDeck(corruptDeck({ design: "default" })), {
    message: /^Deck\.design must be an object$/,
  });
});

test("validateDeck rejects an unknown design key", () => {
  assert.throws(
    () =>
      validateDeck(
        corruptDeck({ design: { themeId: "default", legacyTheme: "x" } }),
      ),
    {
      message: /^Deck\.design\.legacyTheme is not part of the current schema$/,
    },
  );
});

test("validateDeck rejects a blank design.themeId", () => {
  assert.throws(
    () => validateDeck(corruptDeck({ design: { themeId: "   " } })),
    { message: /^Deck\.design\.themeId must be a non-empty string$/ },
  );
});

test("validateDeck rejects a non-object design.themeOverrides", () => {
  assert.throws(
    () =>
      validateDeck(
        corruptDeck({
          design: { themeId: "default", themeOverrides: "not-an-object" },
        }),
      ),
    { message: /^Deck\.design\.themeOverrides must be an object$/ },
  );
});

test("validateDeck rejects a non-array masters list", () => {
  assert.throws(() => validateDeck(corruptDeck({ masters: "not-an-array" })), {
    message: /^Deck\.masters must be an array$/,
  });
});

test("validateDeck rejects an unknown key on a slide master", () => {
  assert.throws(
    () =>
      validateDeck(
        corruptDeck({
          masters: [{ id: "m1", name: "M1", elements: [], legacyField: true }],
        }),
      ),
    {
      message:
        /^Deck\.masters\[0\]\.legacyField is not part of the current schema$/,
    },
  );
});

test("validateDeck rejects an empty defaultMasterId", () => {
  assert.throws(() => validateDeck(corruptDeck({ defaultMasterId: "" })), {
    message: /^Deck\.defaultMasterId must be a non-empty string$/,
  });
});

test("validateDeck rejects a defaultMasterId that does not reference an existing master", () => {
  assert.throws(
    () => validateDeck(corruptDeck({ defaultMasterId: "missing-master" })),
    { message: /^Deck\.defaultMasterId must reference an existing master$/ },
  );
});

test("validateDeck rejects a non-array slides list", () => {
  assert.throws(() => validateDeck(corruptDeck({ slides: "not-an-array" })), {
    message: /^Deck\.slides must be an array$/,
  });
});

test("validateDeck rejects an unknown key on a slide with the indexed slide context", () => {
  assert.throws(
    () =>
      validateDeck(
        corruptDeck({ slides: [{ ...buildSlide(), legacySlideField: true }] }),
      ),
    {
      message:
        /^slides\[0\]\.legacySlideField is not part of the current schema$/,
    },
  );
});

test("validateDeck rejects a non-array customTemplates list", () => {
  assert.throws(
    () => validateDeck(corruptDeck({ customTemplates: "not-an-array" })),
    { message: /^Deck\.customTemplates must be an array$/ },
  );
});

test("validateDeck rejects a non-string deckContentHash", () => {
  assert.throws(() => validateDeck(corruptDeck({ deckContentHash: 12345 })), {
    message: /^Deck\.deckContentHash must be a string$/,
  });
});

test("validateDeck drops an empty-string deckContentHash instead of persisting it", () => {
  const result = validateDeck(corruptDeck({ deckContentHash: "" }));
  assert.equal(result.deckContentHash, undefined);
});

test("validateDeck keeps a non-empty deckContentHash", () => {
  const result = validateDeck(corruptDeck({ deckContentHash: "hash-123" }));
  assert.equal(result.deckContentHash, "hash-123");
});

// ---------------------------------------------------------------------------
// Nested context-rich error paths — errors from deep inside a slide element
// must surface with the full `slides[i].elements[j]...` context, proving
// core.ts correctly threads context strings into the elements.ts validators
// it delegates to.
// ---------------------------------------------------------------------------

test("validateDeck surfaces a deeply nested invalid element kind with full slide/element context", () => {
  const deck = corruptDeck({
    slides: [
      {
        ...buildSlide(),
        elements: [{ ...buildTextElement(), kind: "unknown" }],
      },
    ],
  });
  assert.throws(() => validateDeck(deck), {
    message:
      /^slides\[0\]\.elements\[0\]\.kind must be one of: text, visual, image, shape, connector, table$/,
  });
});

test("validateDeck surfaces a deeply nested design-override error with full slide/element context", () => {
  const deck = corruptDeck({
    slides: [
      {
        ...buildSlide(),
        elements: [
          {
            ...buildTextElement(),
            designOverrides: { fill: { token: "not-a-real-token" } },
          },
        ],
      },
    ],
  });
  assert.throws(() => validateDeck(deck), {
    message:
      /^slides\[0\]\.elements\[0\]\.designOverrides\.fill\.token must be one of:/,
  });
});
