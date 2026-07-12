/**
 * Unit tests for edge-level visual schema validation: `validateEdge`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ARROW_STYLES,
  EDGE_STYLES,
  LINE_STYLES,
} from "@/lib/visual/schema-types";
import { validateEdge } from "./edges";

const NODE_IDS = new Set(["a", "b"]);

test("validateEdge rejects a non-object input", () => {
  const invalid: unknown[] = [null, undefined, "edge", 42, []];
  for (const value of invalid) {
    assert.throws(
      () => validateEdge(value, 0, NODE_IDS),
      /edges\[0\] must be an object/,
      `expected validateEdge to reject ${JSON.stringify(value)}`,
    );
  }
});

test("validateEdge requires a non-empty string id", () => {
  assert.throws(
    () => validateEdge({ from: "a", to: "b" }, 0, NODE_IDS),
    /edges\[0\]\.id must be a non-empty string/,
  );
  assert.throws(
    () => validateEdge({ id: "", from: "a", to: "b" }, 0, NODE_IDS),
    /edges\[0\]\.id must be a non-empty string/,
  );
  assert.throws(
    () => validateEdge({ id: 42, from: "a", to: "b" }, 0, NODE_IDS),
    /edges\[0\]\.id must be a non-empty string/,
  );
});

test("validateEdge requires from and to to reference existing node ids", () => {
  const cases: { input: Record<string, unknown>; pattern: RegExp }[] = [
    {
      input: { id: "e1", to: "b" },
      pattern: /edges\[0\]\.from must reference an existing node id/,
    },
    {
      input: { id: "e1", from: "missing", to: "b" },
      pattern: /edges\[0\]\.from must reference an existing node id/,
    },
    {
      input: { id: "e1", from: 42, to: "b" },
      pattern: /edges\[0\]\.from must reference an existing node id/,
    },
    {
      input: { id: "e1", from: "a" },
      pattern: /edges\[0\]\.to must reference an existing node id/,
    },
    {
      input: { id: "e1", from: "a", to: "missing" },
      pattern: /edges\[0\]\.to must reference an existing node id/,
    },
    {
      input: { id: "e1", from: "a", to: 42 },
      pattern: /edges\[0\]\.to must reference an existing node id/,
    },
  ];
  for (const { input, pattern } of cases) {
    assert.throws(
      () => validateEdge(input, 0, NODE_IDS),
      pattern,
      `expected validateEdge(${JSON.stringify(input)}) to fail endpoint validation`,
    );
  }
});

test("validateEdge accepts endpoints present in the supplied node id set", () => {
  const edge = validateEdge({ id: "e1", from: "a", to: "b" }, 0, NODE_IDS);
  assert.equal(edge.from, "a");
  assert.equal(edge.to, "b");
});

test("validateEdge allows self-referencing edges when the id is known", () => {
  const edge = validateEdge({ id: "e1", from: "a", to: "a" }, 0, NODE_IDS);
  assert.equal(edge.from, "a");
  assert.equal(edge.to, "a");
});

test("validateEdge requires label to be a string and directed to be a boolean", () => {
  assert.throws(
    () =>
      validateEdge({ id: "e1", from: "a", to: "b", label: 42 }, 0, NODE_IDS),
    /edges\[0\]\.label must be a string/,
  );
  assert.throws(
    () =>
      validateEdge(
        { id: "e1", from: "a", to: "b", directed: "yes" },
        0,
        NODE_IDS,
      ),
    /edges\[0\]\.directed must be a boolean/,
  );
  const edge = validateEdge(
    { id: "e1", from: "a", to: "b", label: "Approves", directed: false },
    0,
    NODE_IDS,
  );
  assert.equal(edge.label, "Approves");
  assert.equal(edge.directed, false);
});

test("validateEdge keeps every declared connector style and silently drops unknown ones", () => {
  for (const style of EDGE_STYLES) {
    const edge = validateEdge(
      { id: "e1", from: "a", to: "b", style },
      0,
      NODE_IDS,
    );
    assert.equal(edge.style, style);
  }
  const invalid = validateEdge(
    { id: "e1", from: "a", to: "b", style: "zigzag" },
    0,
    NODE_IDS,
  );
  assert.equal(invalid.style, undefined);
});

test("validateEdge keeps every declared arrow style and silently drops unknown ones", () => {
  for (const arrowStyle of ARROW_STYLES) {
    const edge = validateEdge(
      { id: "e1", from: "a", to: "b", arrowStyle },
      0,
      NODE_IDS,
    );
    assert.equal(edge.arrowStyle, arrowStyle);
  }
  const invalid = validateEdge(
    { id: "e1", from: "a", to: "b", arrowStyle: "star" },
    0,
    NODE_IDS,
  );
  assert.equal(invalid.arrowStyle, undefined);
});

test("validateEdge keeps every declared line style and silently drops unknown ones", () => {
  for (const lineStyle of LINE_STYLES) {
    const edge = validateEdge(
      { id: "e1", from: "a", to: "b", lineStyle },
      0,
      NODE_IDS,
    );
    assert.equal(edge.lineStyle, lineStyle);
  }
  const invalid = validateEdge(
    { id: "e1", from: "a", to: "b", lineStyle: "wavy" },
    0,
    NODE_IDS,
  );
  assert.equal(invalid.lineStyle, undefined);
});

test("validateEdge requires lineWidth to be a positive number when present", () => {
  const edge = validateEdge(
    { id: "e1", from: "a", to: "b", lineWidth: 2.5 },
    0,
    NODE_IDS,
  );
  assert.equal(edge.lineWidth, 2.5);
  assert.throws(
    () =>
      validateEdge({ id: "e1", from: "a", to: "b", lineWidth: 0 }, 0, NODE_IDS),
    /edges\[0\]\.lineWidth must be greater than 0/,
  );
  assert.throws(
    () =>
      validateEdge(
        { id: "e1", from: "a", to: "b", lineWidth: -1 },
        0,
        NODE_IDS,
      ),
    /edges\[0\]\.lineWidth must be greater than 0/,
  );
});
