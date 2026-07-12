/**
 * Unit tests for effect-level visual schema validation: `parseEffect` and
 * `parseEffects`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { parseEffect, parseEffects } from "./effects";

test("parseEffect rejects non-objects and unknown effect kinds", () => {
  const invalid: unknown[] = [
    null,
    undefined,
    "shadow",
    42,
    [],
    { kind: "glow" },
  ];
  for (const item of invalid) {
    assert.equal(
      parseEffect(item),
      null,
      `expected parseEffect to reject ${JSON.stringify(item)}`,
    );
  }
});

test("parseEffect keeps valid shadow fields and drops invalid ones", () => {
  const cases: {
    input: Record<string, unknown>;
    expected: Record<string, unknown>;
  }[] = [
    {
      input: { kind: "shadow", dx: 2, dy: 3, blur: 4, color: "black" },
      expected: { kind: "shadow", dx: 2, dy: 3, blur: 4, color: "black" },
    },
    {
      // Negative blur is dropped (must be >= 0); other fields survive.
      input: { kind: "shadow", dx: 5, blur: -1 },
      expected: { kind: "shadow", dx: 5 },
    },
    {
      // blur of exactly 0 is a valid, meaningful boundary value.
      input: { kind: "shadow", blur: 0 },
      expected: { kind: "shadow", blur: 0 },
    },
    {
      // Non-numeric dx/dy and non-string color are dropped, not thrown.
      input: { kind: "shadow", dx: "far", color: 7 },
      expected: { kind: "shadow" },
    },
  ];
  for (const { input, expected } of cases) {
    assert.deepEqual(
      parseEffect(input),
      expected,
      `expected parseEffect(${JSON.stringify(input)}) to equal ${JSON.stringify(expected)}`,
    );
  }
});

test("parseEffect keeps valid sketch fields and drops out-of-range ones", () => {
  const cases: {
    input: Record<string, unknown>;
    expected: Record<string, unknown>;
  }[] = [
    {
      input: { kind: "sketch", frequency: 0.05, scale: 4 },
      expected: { kind: "sketch", frequency: 0.05, scale: 4 },
    },
    {
      // frequency must be > 0; 0 and negative values are dropped.
      input: { kind: "sketch", frequency: 0 },
      expected: { kind: "sketch" },
    },
    {
      input: { kind: "sketch", frequency: -0.1 },
      expected: { kind: "sketch" },
    },
    {
      // scale of exactly 0 is a valid boundary value (>= 0).
      input: { kind: "sketch", scale: 0 },
      expected: { kind: "sketch", scale: 0 },
    },
    {
      input: { kind: "sketch", scale: -2 },
      expected: { kind: "sketch" },
    },
  ];
  for (const { input, expected } of cases) {
    assert.deepEqual(
      parseEffect(input),
      expected,
      `expected parseEffect(${JSON.stringify(input)}) to equal ${JSON.stringify(expected)}`,
    );
  }
});

test("parseEffects returns undefined for non-array input", () => {
  const invalid: unknown[] = [undefined, null, "shadow", {}, 5];
  for (const value of invalid) {
    assert.equal(
      parseEffects(value),
      undefined,
      `expected parseEffects to reject ${JSON.stringify(value)}`,
    );
  }
});

test("parseEffects drops unparseable entries and returns undefined when nothing survives", () => {
  assert.equal(parseEffects([]), undefined);
  assert.equal(
    parseEffects([{ kind: "glow" }, null, "not-an-effect"]),
    undefined,
  );
});

test("parseEffects keeps only the entries that parse successfully, in order", () => {
  const effects = parseEffects([
    { kind: "shadow", dx: 2, dy: 3, blur: 0, color: "black" },
    { kind: "future-effect", value: true },
    { kind: "sketch", frequency: 0.05, scale: 4 },
  ]);
  assert.equal(effects?.length, 2);
  assert.equal(effects?.[0].kind, "shadow");
  assert.equal(effects?.[1].kind, "sketch");
});
