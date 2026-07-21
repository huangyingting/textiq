/**
 * Unit tests for core visual schema validation and composition:
 * `validateVisual`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { FIXTURES } from "@/lib/visual/fixtures";
import {
  DEFAULT_CANVAS_HEIGHT,
  DEFAULT_CANVAS_WIDTH,
  DEFAULT_STYLE,
  VISUAL_KINDS,
  VISUAL_SCHEMA_VERSION,
} from "@/lib/visual/schema-types";
import { validateVisual } from "./core";

function baseVisual(
  nodes: Record<string, unknown>[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: VISUAL_SCHEMA_VERSION,
    type: "flowchart",
    width: 760,
    height: 480,
    nodes,
    edges: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Canonical valid payloads (reuses the shared fixtures — one per VisualKind).
// ---------------------------------------------------------------------------

test("validateVisual accepts the canonical fixture for every visual kind", () => {
  for (const kind of VISUAL_KINDS) {
    const fixture = FIXTURES[kind];
    const validated = validateVisual(fixture);
    assert.equal(validated.type, kind, `expected kind "${kind}" to round-trip`);
    assert.equal(validated.version, VISUAL_SCHEMA_VERSION);
    assert.equal(
      validated.nodes.length,
      fixture.nodes.length,
      `expected all nodes to survive for kind "${kind}"`,
    );
    assert.equal(
      validated.edges.length,
      fixture.edges.length,
      `expected all edges to survive for kind "${kind}"`,
    );
  }
});

// ---------------------------------------------------------------------------
// Top-level structural validation
// ---------------------------------------------------------------------------

test("validateVisual rejects a non-object input", () => {
  const invalid: unknown[] = [null, undefined, "visual", 42, []];
  for (const value of invalid) {
    assert.throws(
      () => validateVisual(value),
      /Visual must be an object/,
      `expected validateVisual to reject ${JSON.stringify(value)}`,
    );
  }
});

test("validateVisual rejects an unsupported schema version", () => {
  assert.throws(
    () =>
      validateVisual(
        baseVisual([{ id: "a", label: "Alpha" }], { version: 999 }),
      ),
    /Unsupported visual version: 999 \(expected 1\)/,
  );
});

test("validateVisual rejects an unknown visual type", () => {
  assert.throws(
    () =>
      validateVisual(
        baseVisual([{ id: "a", label: "Alpha" }], { type: "unknown" }),
      ),
    /Visual\.type must be one of/,
  );
});

test("validateVisual accepts every declared visual kind", () => {
  for (const kind of VISUAL_KINDS) {
    const visual = validateVisual(
      baseVisual([{ id: "a", label: "Alpha" }], { type: kind }),
    );
    assert.equal(visual.type, kind);
  }
});

test("validateVisual requires nodes to be a non-empty array", () => {
  const invalid: unknown[] = [undefined, null, "nodes", []];
  for (const nodes of invalid) {
    assert.throws(
      () =>
        validateVisual({
          version: VISUAL_SCHEMA_VERSION,
          type: "flowchart",
          nodes,
          edges: [],
        }),
      /Visual\.nodes must be a non-empty array/,
      `expected validateVisual to reject nodes=${JSON.stringify(nodes)}`,
    );
  }
});

test("validateVisual propagates per-node validation errors with node context", () => {
  assert.throws(
    () => validateVisual(baseVisual([{ id: "", label: "Alpha" }])),
    /nodes\[0\]\.id must be a non-empty string/,
  );
});

test("validateVisual rejects duplicate node ids", () => {
  assert.throws(
    () =>
      validateVisual(
        baseVisual([
          { id: "dup", label: "Alpha" },
          { id: "dup", label: "Beta" },
        ]),
      ),
    /Duplicate node id: dup/,
  );
});

test("validateVisual defaults edges to an empty array and rejects non-array edges", () => {
  const visual = validateVisual({
    version: VISUAL_SCHEMA_VERSION,
    type: "flowchart",
    nodes: [{ id: "a", label: "Alpha" }],
  });
  assert.deepEqual(visual.edges, []);

  assert.throws(
    () =>
      validateVisual(
        baseVisual([{ id: "a", label: "Alpha" }], { edges: "not-an-array" }),
      ),
    /Visual\.edges must be an array/,
  );
});

test("validateVisual propagates per-edge validation errors with edge context", () => {
  assert.throws(
    () =>
      validateVisual(
        baseVisual(
          [
            { id: "a", label: "Alpha" },
            { id: "b", label: "Beta" },
          ],
          { edges: [{ id: "e1", from: "a", to: "missing" }] },
        ),
      ),
    /edges\[0\]\.to must reference an existing node id/,
  );
});

test("validateVisual rejects duplicate edge ids and accepts unique edge ids", () => {
  const unique = validateVisual(
    baseVisual(
      [
        { id: "a", label: "Alpha" },
        { id: "b", label: "Beta" },
        { id: "c", label: "Gamma" },
      ],
      {
        edges: [
          { id: "e1", from: "a", to: "b" },
          { id: "e2", from: "b", to: "c" },
        ],
      },
    ),
  );
  assert.deepEqual(
    unique.edges.map((edge) => edge.id),
    ["e1", "e2"],
  );

  assert.throws(
    () =>
      validateVisual(
        baseVisual(
          [
            { id: "a", label: "Alpha" },
            { id: "b", label: "Beta" },
            { id: "c", label: "Gamma" },
          ],
          {
            edges: [
              { id: "dup", from: "a", to: "b" },
              { id: "dup", from: "b", to: "c" },
            ],
          },
        ),
      ),
    /Duplicate edge id: dup/,
  );
});

test("validateVisual requires title to be a string when present", () => {
  assert.throws(
    () =>
      validateVisual(baseVisual([{ id: "a", label: "Alpha" }], { title: 42 })),
    /Visual\.title must be a string/,
  );
  const visual = validateVisual(
    baseVisual([{ id: "a", label: "Alpha" }], { title: "My Visual" }),
  );
  assert.equal(visual.title, "My Visual");
});

test("validateVisual omits title entirely when not provided", () => {
  const visual = validateVisual(baseVisual([{ id: "a", label: "Alpha" }]));
  assert.equal("title" in visual, false);
});

// ---------------------------------------------------------------------------
// Canvas dimensions
// ---------------------------------------------------------------------------

test("validateVisual defaults width and height when omitted", () => {
  const visual = validateVisual({
    version: VISUAL_SCHEMA_VERSION,
    type: "flowchart",
    nodes: [{ id: "a", label: "Alpha" }],
    edges: [],
  });
  assert.equal(visual.width, DEFAULT_CANVAS_WIDTH);
  assert.equal(visual.height, DEFAULT_CANVAS_HEIGHT);
});

test("validateVisual enforces positive width and height when provided", () => {
  const dimensionFields = ["width", "height"] as const;
  for (const field of dimensionFields) {
    const visual = validateVisual(
      baseVisual([{ id: "a", label: "Alpha" }], { [field]: 320 }),
    );
    assert.equal(visual[field], 320);
    assert.throws(
      () =>
        validateVisual(
          baseVisual([{ id: "a", label: "Alpha" }], { [field]: 0 }),
        ),
      new RegExp(`Visual\\.${field} must be greater than 0`),
      `expected ${field}=0 to be rejected`,
    );
    assert.throws(
      () =>
        validateVisual(
          baseVisual([{ id: "a", label: "Alpha" }], { [field]: -10 }),
        ),
      new RegExp(`Visual\\.${field} must be greater than 0`),
      `expected ${field}=-10 to be rejected`,
    );
  }
});

// ---------------------------------------------------------------------------
// Style composition
// ---------------------------------------------------------------------------

test("validateVisual defaults style when omitted and propagates style errors", () => {
  const visual = validateVisual(baseVisual([{ id: "a", label: "Alpha" }]));
  assert.deepEqual(visual.style, DEFAULT_STYLE);

  assert.throws(
    () =>
      validateVisual(
        baseVisual([{ id: "a", label: "Alpha" }], { style: "not-an-object" }),
      ),
    /style must be an object/,
  );
});

// ---------------------------------------------------------------------------
// Export options, effects, and passthrough fields
// ---------------------------------------------------------------------------

test("validateVisual keeps valid export options and drops unsupported ones", () => {
  const visual = validateVisual(
    baseVisual([{ id: "a", label: "Alpha" }], {
      aspectRatio: "16:9",
      canvasStyle: "dot-grid",
    }),
  );
  assert.equal(visual.aspectRatio, "16:9");
  assert.equal(visual.canvasStyle, "dot-grid");

  const dropped = validateVisual(
    baseVisual([{ id: "a", label: "Alpha" }], {
      aspectRatio: "2:1",
      canvasStyle: "unsupported",
    }),
  );
  assert.equal(dropped.aspectRatio, undefined);
  assert.equal(dropped.canvasStyle, undefined);
});

test("validateVisual keeps a non-empty effects array and omits effects when none parse", () => {
  const visual = validateVisual(
    baseVisual([{ id: "a", label: "Alpha" }], {
      effects: [{ kind: "shadow", blur: 4 }],
    }),
  );
  assert.equal(visual.effects?.length, 1);
  assert.equal(visual.effects?.[0].kind, "shadow");

  const withoutEffects = validateVisual(
    baseVisual([{ id: "a", label: "Alpha" }], { effects: [] }),
  );
  assert.equal("effects" in withoutEffects, false);

  const unparseable = validateVisual(
    baseVisual([{ id: "a", label: "Alpha" }], {
      effects: [{ kind: "glow" }],
    }),
  );
  assert.equal("effects" in unparseable, false);
});

test("validateVisual keeps sourceText, sourceTextHash, and autoLayout only when correctly typed", () => {
  const visual = validateVisual(
    baseVisual([{ id: "a", label: "Alpha" }], {
      sourceText: "Some source text",
      sourceTextHash: "deadbeef",
      autoLayout: true,
    }),
  );
  assert.equal(visual.sourceText, "Some source text");
  assert.equal(visual.sourceTextHash, "deadbeef");
  assert.equal(visual.autoLayout, true);

  const mistyped = validateVisual(
    baseVisual([{ id: "a", label: "Alpha" }], {
      sourceText: 42,
      sourceTextHash: false,
      autoLayout: "yes",
    }),
  );
  assert.equal("sourceText" in mistyped, false);
  assert.equal("sourceTextHash" in mistyped, false);
  assert.equal("autoLayout" in mistyped, false);
});
