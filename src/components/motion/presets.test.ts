import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  resolveCardMotion,
  resolveOverlayMotion,
  resolvePopMotion,
  resolveStatusMotion,
  resolveVisualSkeletonMotion,
} from "./presets";
import { DURATION, EASE } from "./tokens";

describe("shared motion presets", () => {
  test("preserve the established normal-motion variants", () => {
    assert.deepEqual(resolvePopMotion(false), {
      initial: { opacity: 0, scale: 0.96 },
      animate: { opacity: 1, scale: 1 },
      exit: { opacity: 0, scale: 0.96 },
      transition: { duration: DURATION.pop, ease: EASE.out },
    });
    assert.deepEqual(resolveCardMotion(false), {
      initial: { opacity: 0, scale: 0.97 },
      animate: { opacity: 1, scale: 1 },
      exit: { opacity: 0, scale: 0.97 },
      transition: { duration: DURATION.card, ease: EASE.out },
    });
    assert.deepEqual(resolveStatusMotion(false), {
      initial: { opacity: 0, y: 2 },
      animate: { opacity: 1, y: 0 },
      exit: { opacity: 0, y: -2 },
      transition: { duration: DURATION.status },
    });
    assert.deepEqual(resolveVisualSkeletonMotion(false), {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0, scale: 0.97 },
      transition: { duration: DURATION.card },
    });
    assert.deepEqual(resolveOverlayMotion(false), {
      backdrop: {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: DURATION.backdrop },
      },
      modal: {
        initial: { opacity: 0, scale: 0.98 },
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 0, scale: 0.98 },
        transition: { duration: DURATION.modal, ease: EASE.out },
      },
      drawer: {
        initial: { x: "100%" },
        animate: { x: 0 },
        exit: { x: "100%" },
        transition: { duration: DURATION.drawer, ease: EASE.out },
      },
      sheet: {
        initial: { y: "100%" },
        animate: { opacity: 1, y: 0 },
        exit: { y: "100%" },
        transition: { duration: DURATION.sheet, ease: EASE.out },
      },
    });
  });

  test("collapse every shared preset to an instant static state", () => {
    const expected = {
      initial: { opacity: 1 },
      animate: { opacity: 1 },
      exit: { opacity: 1 },
      transition: { duration: DURATION.instant },
    };

    assert.deepEqual(resolvePopMotion(true), expected);
    assert.deepEqual(resolveCardMotion(true), expected);
    assert.deepEqual(resolveStatusMotion(true), expected);
    assert.deepEqual(resolveVisualSkeletonMotion(true), expected);
    assert.deepEqual(resolveOverlayMotion(true), {
      backdrop: expected,
      modal: expected,
      drawer: expected,
      sheet: expected,
    });
  });
});
