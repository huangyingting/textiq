import assert from "node:assert/strict";
import { test } from "node:test";

import { buildDeck, buildImageElement, buildSlide } from "@/test/builders/deck";
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
