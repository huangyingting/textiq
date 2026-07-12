import assert from "node:assert/strict";
import { test } from "node:test";

import { PRESENTATION_THEME_IDS } from "../deck-core";
import {
  DeckValidationError,
  isHexColor,
  isPresentationThemeId,
  isSlideFormat,
  rejectUnknownKeys,
  validateFiniteNumber,
  validateOpacity,
  validateStringArray,
  validateUnitFraction,
} from "./shared";

test("DeckValidationError carries the message and a stable error name", () => {
  const error = new DeckValidationError("Deck.canvas must be an object");
  assert.equal(error.name, "DeckValidationError");
  assert.equal(error.message, "Deck.canvas must be an object");
  assert.ok(error instanceof Error);
});

test("rejectUnknownKeys accepts an input whose keys are all allowed", () => {
  assert.doesNotThrow(() =>
    rejectUnknownKeys({ format: "16:9" }, ["format"], "Deck.canvas"),
  );
});

test("rejectUnknownKeys throws a context-qualified error for the first unknown key", () => {
  assert.throws(
    () =>
      rejectUnknownKeys(
        { format: "16:9", legacyFlag: true },
        ["format"],
        "Deck.canvas",
      ),
    { message: /^Deck\.canvas\.legacyFlag is not part of the current schema$/ },
  );
});

test("isSlideFormat is true only for canonical slide formats", () => {
  assert.equal(isSlideFormat("16:9"), true);
  assert.equal(isSlideFormat("4:3"), true);
  assert.equal(isSlideFormat("21:9"), false);
  assert.equal(isSlideFormat(undefined), false);
  assert.equal(isSlideFormat(9), false);
});

test("isPresentationThemeId accepts a catalog id and rejects unknown strings", () => {
  assert.equal(isPresentationThemeId(PRESENTATION_THEME_IDS[0]), true);
  assert.equal(isPresentationThemeId("not-a-real-theme"), false);
  assert.equal(isPresentationThemeId(42), false);
});

test("validateStringArray returns a copy of a valid string array", () => {
  const input = ["title", "subtitle"];
  const result = validateStringArray(input, "accepts");
  assert.deepEqual(result, input);
});

test("validateStringArray rejects a non-array value", () => {
  assert.throws(() => validateStringArray("title", "accepts"), {
    message: /^accepts must be an array$/,
  });
});

test("validateStringArray rejects an array containing a non-string entry", () => {
  assert.throws(() => validateStringArray(["title", 7], "accepts"), {
    message: /^accepts\[1\] must be a string$/,
  });
});

test("validateFiniteNumber accepts finite numbers and rejects NaN/Infinity/non-numbers", () => {
  assert.equal(validateFiniteNumber(12.5, "zIndex"), 12.5);
  assert.throws(() => validateFiniteNumber(Number.NaN, "zIndex"), {
    message: /^zIndex must be a finite number$/,
  });
  assert.throws(
    () => validateFiniteNumber(Number.POSITIVE_INFINITY, "zIndex"),
    { message: /^zIndex must be a finite number$/ },
  );
  assert.throws(() => validateFiniteNumber("3", "zIndex"), {
    message: /^zIndex must be a finite number$/,
  });
});

test("validateOpacity clamps in-range values and passes through boundary values", () => {
  assert.equal(validateOpacity(0.5, "opacity"), 0.5);
  assert.equal(validateOpacity(-3, "opacity"), 0);
  assert.equal(validateOpacity(3, "opacity"), 1);
});

test("validateOpacity still rejects non-finite input before clamping", () => {
  assert.throws(() => validateOpacity(Number.NaN, "opacity"), {
    message: /^opacity must be a finite number$/,
  });
});

test("isHexColor accepts 3/4/6/8 digit hex colors and rejects malformed values", () => {
  assert.equal(isHexColor("#fff"), true);
  assert.equal(isHexColor("#ffff"), true);
  assert.equal(isHexColor("#112233"), true);
  assert.equal(isHexColor("#11223344"), true);
  assert.equal(isHexColor("#12"), false);
  assert.equal(isHexColor("blue"), false);
  assert.equal(isHexColor(123), false);
});

test("validateUnitFraction accepts the inclusive [0, 1] range and rejects out-of-range values", () => {
  assert.equal(validateUnitFraction(0, "crop.top"), 0);
  assert.equal(validateUnitFraction(1, "crop.top"), 1);
  assert.throws(() => validateUnitFraction(-0.01, "crop.top"), {
    message: /^crop\.top must be between 0 and 1$/,
  });
  assert.throws(() => validateUnitFraction(1.01, "crop.top"), {
    message: /^crop\.top must be between 0 and 1$/,
  });
});
