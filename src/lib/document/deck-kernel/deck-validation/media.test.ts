import assert from "node:assert/strict";
import { test } from "node:test";

import { buildDeck, buildImageElement, buildSlide } from "@/test/builders/deck";
import { validateDeck } from "./core";
import {
  validateImageCrop,
  validateImageFitMode,
  validateImageMaskShape,
} from "./media";

test("validateImageFitMode passes through undefined and accepts every catalog mode", () => {
  assert.equal(validateImageFitMode(undefined, "fitMode"), undefined);
  for (const mode of ["contain", "cover", "fill", "none"]) {
    assert.equal(validateImageFitMode(mode, "fitMode"), mode);
  }
});

test("validateImageFitMode rejects an unrecognised fit mode", () => {
  assert.throws(
    () => validateImageFitMode("stretch", "designOverrides.fitMode"),
    {
      message:
        /^designOverrides\.fitMode must be one of: contain, cover, fill, none$/,
    },
  );
});

test("validateImageMaskShape passes through undefined and accepts every catalog shape", () => {
  assert.equal(validateImageMaskShape(undefined, "maskShape"), undefined);
  for (const shape of [
    "none",
    "rect",
    "circle",
    "ellipse",
    "rounded",
    "diamond",
    "triangle",
  ]) {
    assert.equal(validateImageMaskShape(shape, "maskShape"), shape);
  }
});

test("validateImageMaskShape rejects an unrecognised mask shape", () => {
  assert.throws(
    () => validateImageMaskShape("star", "designOverrides.maskShape"),
    {
      message:
        /^designOverrides\.maskShape must be one of: none, rect, circle, ellipse, rounded, diamond, triangle$/,
    },
  );
});

test("validateImageCrop passes through undefined and normalizes a full crop", () => {
  assert.equal(validateImageCrop(undefined, "crop"), undefined);
  assert.deepEqual(
    validateImageCrop({ top: 0.1, right: 0.2, bottom: 0.3, left: 0.4 }, "crop"),
    { top: 0.1, right: 0.2, bottom: 0.3, left: 0.4 },
  );
});

test("validateImageCrop rejects a non-object crop", () => {
  assert.throws(() => validateImageCrop("full", "content.crop"), {
    message: /^content\.crop must be an object$/,
  });
});

test("validateImageCrop rejects an out-of-range crop edge with a nested context path", () => {
  assert.throws(
    () =>
      validateImageCrop(
        { top: 1.5, right: 0, bottom: 0, left: 0 },
        "content.crop",
      ),
    { message: /^content\.crop\.top must be between 0 and 1$/ },
  );
});

// ---------------------------------------------------------------------------
// validateDeck boundary — media rules threaded through a real image element
// ---------------------------------------------------------------------------

test("validateDeck accepts a slide image element with fitMode, maskShape, and crop", () => {
  const deck = buildDeck({
    slides: [
      buildSlide({
        elements: [
          buildImageElement({
            fitMode: "cover",
            maskShape: "circle",
            crop: { top: 0, right: 0.1, bottom: 0, left: 0.1 },
          }),
        ],
      }),
    ],
  });
  const result = validateDeck(deck);
  const [element] = result.slides[0].elements ?? [];
  assert.equal(
    (element?.designOverrides as { fitMode?: string } | undefined)?.fitMode,
    "cover",
  );
  assert.equal(
    (element?.designOverrides as { maskShape?: string } | undefined)?.maskShape,
    "circle",
  );
  assert.deepEqual((element?.content as { crop?: unknown } | undefined)?.crop, {
    top: 0,
    right: 0.1,
    bottom: 0,
    left: 0.1,
  });
});

test("validateDeck rejects an invalid fitMode with the full nested element context", () => {
  const deck = buildDeck({
    slides: [
      buildSlide({
        elements: [buildImageElement({ fitMode: "stretch" as never })],
      }),
    ],
  });
  assert.throws(() => validateDeck(deck), {
    message:
      /^slides\[0\]\.elements\[0\]\.designOverrides\.fitMode must be one of: contain, cover, fill, none$/,
  });
});

test("validateDeck rejects an invalid maskShape with the full nested element context", () => {
  const deck = buildDeck({
    slides: [
      buildSlide({
        elements: [buildImageElement({ maskShape: "star" as never })],
      }),
    ],
  });
  assert.throws(() => validateDeck(deck), {
    message:
      /^slides\[0\]\.elements\[0\]\.designOverrides\.maskShape must be one of: none, rect, circle, ellipse, rounded, diamond, triangle$/,
  });
});

test("validateDeck rejects an out-of-range image crop with the full nested content context", () => {
  const deck = buildDeck({
    slides: [
      buildSlide({
        elements: [
          buildImageElement({
            crop: { top: 0, right: 0, bottom: -0.5, left: 0 },
          }),
        ],
      }),
    ],
  });
  assert.throws(() => validateDeck(deck), {
    message:
      /^slides\[0\]\.elements\[0\]\.content\.crop\.bottom must be between 0 and 1$/,
  });
});
