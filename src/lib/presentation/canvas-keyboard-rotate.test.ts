import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  announceRotation,
  applyKeyboardRotation,
  deckRotationFromKeyboardAngle,
  keyboardRotationDelta,
  normalizeKeyboardRotationAngle,
} from "./canvas-keyboard-rotate";

describe("canvas-keyboard-rotate", () => {
  test("maps bracket keys to coarse rotation deltas", () => {
    assert.equal(keyboardRotationDelta(key("[")), -15);
    assert.equal(keyboardRotationDelta(key("]")), 15);
  });

  test("uses Shift for one-degree fine rotation", () => {
    assert.equal(keyboardRotationDelta(key("{", { shiftKey: true })), -1);
    assert.equal(keyboardRotationDelta(key("}", { shiftKey: true })), 1);
  });

  test("ignores chords reserved for existing resize and nudge behavior", () => {
    assert.equal(keyboardRotationDelta(key("ArrowLeft")), null);
    assert.equal(
      keyboardRotationDelta(key("ArrowLeft", { altKey: true })),
      null,
    );
    assert.equal(keyboardRotationDelta(key("[", { ctrlKey: true })), null);
  });

  test("normalizes display angles into 0–359 degrees", () => {
    assert.equal(normalizeKeyboardRotationAngle(360), 0);
    assert.equal(normalizeKeyboardRotationAngle(-15), 345);
    assert.equal(normalizeKeyboardRotationAngle(725), 5);
    assert.equal(Object.is(normalizeKeyboardRotationAngle(-0), -0), false);
  });

  test("converts display angles to the deck rotation convention", () => {
    assert.equal(deckRotationFromKeyboardAngle(0), undefined);
    assert.equal(deckRotationFromKeyboardAngle(180), 180);
    assert.equal(deckRotationFromKeyboardAngle(345), -15);
  });

  test("applies deltas and wraps across zero", () => {
    assert.deepEqual(applyKeyboardRotation(undefined, -15), {
      angle: 345,
      rotation: -15,
    });
    assert.deepEqual(applyKeyboardRotation(-15, 15), {
      angle: 0,
      rotation: undefined,
    });
  });

  test("builds rotation announcements from normalized display angles", () => {
    assert.equal(announceRotation("Title", -15), "Rotated Title to 345°");
  });
});

function key(
  keyName: string,
  mods: Partial<{
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  }> = {},
) {
  return {
    key: keyName,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...mods,
  };
}
