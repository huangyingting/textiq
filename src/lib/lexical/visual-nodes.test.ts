import assert from "node:assert/strict";
import { test } from "node:test";

import type { Visual } from "@/lib/visual/schema";

import { collectVisualNodes } from "@/lib/lexical/visual-nodes";

function visualFixture(value: unknown): Visual {
  return value as unknown as Visual;
}

function visual(id: string): Visual {
  return visualFixture({
    version: 1,
    type: "flowchart",
    nodes: [{ id: `${id}-n1`, label: "Node" }],
    edges: [],
    style: {},
  });
}

function visualNode(visualId: string) {
  return { type: "visual", visualId, visual: visual(visualId) };
}

function paragraph(text: string) {
  return { type: "paragraph", children: [{ type: "text", text }] };
}

function state(children: unknown[]): string {
  return JSON.stringify({ root: { type: "root", children } });
}

test("collects visual nodes in document order", () => {
  const json = state([
    paragraph("intro"),
    visualNode("a"),
    paragraph("middle"),
    visualNode("b"),
  ]);
  const collected = collectVisualNodes(json);
  assert.deepEqual(
    collected.map((node) => node.visualId),
    ["a", "b"],
  );
});

test("accepts an already-parsed state object", () => {
  const parsed = JSON.parse(state([visualNode("only")]));
  const collected = collectVisualNodes(parsed);
  assert.equal(collected.length, 1);
  assert.equal(collected[0].visualId, "only");
  assert.equal(collected[0].visual.type, "flowchart");
});

test("walks nested children to find visual nodes", () => {
  const json = state([
    {
      type: "container",
      children: [paragraph("nested"), visualNode("deep")],
    },
  ]);
  const collected = collectVisualNodes(json);
  assert.deepEqual(
    collected.map((node) => node.visualId),
    ["deep"],
  );
});

test("de-duplicates repeated visual ids to the first occurrence", () => {
  const json = state([visualNode("dup"), visualNode("dup")]);
  const collected = collectVisualNodes(json);
  assert.equal(collected.length, 1);
});

test("ignores nodes without a usable visualId or payload", () => {
  const json = state([
    { type: "visual", visualId: "", visual: visual("x") },
    { type: "visual", visualId: "no-payload" },
    { type: "visual", visual: visual("y") },
  ]);
  assert.deepEqual(collectVisualNodes(json), []);
});

test("returns an empty array for malformed input", () => {
  assert.deepEqual(collectVisualNodes("not json"), []);
  assert.deepEqual(collectVisualNodes(null), []);
  assert.deepEqual(collectVisualNodes({}), []);
});
