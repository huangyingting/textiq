import assert from "node:assert/strict";
import { test } from "node:test";

import { skipIf } from "@/test/skip";

import { VISUAL_KINDS, safeParseVisual } from "@/lib/visual/schema";
import {
  resetNodeExtStyle,
  resetNodeStyle,
  setAllEdgesStyle,
  setEdgeArrowStyle,
  setEdgeLineStyle,
  setEdgeLineWidth,
  setNodeBorderStyle,
  setNodeBorderWidth,
  setNodeFillStyle,
  setNodeIcon,
  clearNodeIcon,
  flipEdge,
  setNodeStyle,
  setNodeTextAlign,
  setVisualStyle,
  toggleEdgeDirected,
  toggleEdgeStyle,
  setEdgeLabel,
} from "./transforms";
import { sourceFor } from "./transforms.test-helpers";

test("setVisualStyle merges a patch immutably", () => {
  const source = sourceFor("chart");
  const before = JSON.stringify(source);
  const next = setVisualStyle(source, { background: "#000000", fontSize: 20 });
  assert.equal(next.style.background, "#000000");
  assert.equal(next.style.fontSize, 20);
  assert.equal(next.style.nodeFill, source.style.nodeFill);
  assert.equal(JSON.stringify(source), before);
  assert.ok(safeParseVisual(next).success);
});

test("setVisualStyle copies a patched palette (no aliasing)", () => {
  const source = sourceFor("chart");
  const palette = ["#111111", "#222222"];
  const next = setVisualStyle(source, { palette });
  palette.push("#333333");
  assert.deepEqual(next.style.palette, ["#111111", "#222222"]);
});

test("setNodeStyle / resetNodeStyle override and clear per-node colors", () => {
  const source = sourceFor("flowchart");
  const id = source.nodes[0].id;
  const colored = setNodeStyle(source, id, "color", "#abcdef");
  assert.equal(colored.nodes[0].color, "#abcdef");
  assert.equal(source.nodes[0].color, undefined, "input untouched");

  const withAll = setNodeStyle(
    setNodeStyle(colored, id, "stroke", "#123456"),
    id,
    "textColor",
    "#654321",
  );
  const reset = resetNodeStyle(withAll, id);
  assert.equal(reset.nodes[0].color, undefined);
  assert.equal(reset.nodes[0].stroke, undefined);
  assert.equal(reset.nodes[0].textColor, undefined);
  assert.ok(safeParseVisual(reset).success);
});

test("setNodeIcon / clearNodeIcon set and remove a node icon", () => {
  const source = sourceFor("list");
  const id = source.nodes[0].id;
  const withIcon = setNodeIcon(source, id, "Rocket");
  assert.equal(withIcon.nodes[0].icon, "Rocket");
  const cleared = clearNodeIcon(withIcon, id);
  assert.equal(cleared.nodes[0].icon, undefined);
  // safeParseVisual drops unknown icons but keeps known ones.
  const parsed = safeParseVisual(withIcon);
  assert.ok(parsed.success);
  if (parsed.success) {
    assert.equal(parsed.data.nodes[0].icon, "Rocket");
  }
});

// ── New per-node extended style transforms ────────────────────────────────────

test("setNodeFillStyle sets fillStyle and is immutable", () => {
  const source = sourceFor("flowchart");
  const id = source.nodes[0].id;
  const before = JSON.stringify(source);
  const next = setNodeFillStyle(source, id, "gradient");
  assert.equal(next.nodes[0].fillStyle, "gradient");
  assert.equal(source.nodes[0].fillStyle, undefined, "input untouched");
  assert.equal(JSON.stringify(source), before);
  assert.ok(safeParseVisual(next).success);
});

test("setNodeBorderStyle sets borderStyle and is immutable", () => {
  const source = sourceFor("flowchart");
  const id = source.nodes[0].id;
  const before = JSON.stringify(source);
  const next = setNodeBorderStyle(source, id, "dashed");
  assert.equal(next.nodes[0].borderStyle, "dashed");
  assert.equal(source.nodes[0].borderStyle, undefined, "input untouched");
  assert.equal(JSON.stringify(source), before);
  assert.ok(safeParseVisual(next).success);
});

test("setNodeBorderWidth sets borderWidth and is immutable", () => {
  const source = sourceFor("flowchart");
  const id = source.nodes[0].id;
  const before = JSON.stringify(source);
  const next = setNodeBorderWidth(source, id, 3);
  assert.equal(next.nodes[0].borderWidth, 3);
  assert.equal(source.nodes[0].borderWidth, undefined, "input untouched");
  assert.equal(JSON.stringify(source), before);
  assert.ok(safeParseVisual(next).success);
});

test("setNodeTextAlign sets textAlign and is immutable", () => {
  const source = sourceFor("flowchart");
  const id = source.nodes[0].id;
  const before = JSON.stringify(source);
  const next = setNodeTextAlign(source, id, "left");
  assert.equal(next.nodes[0].textAlign, "left");
  assert.equal(source.nodes[0].textAlign, undefined, "input untouched");
  assert.equal(JSON.stringify(source), before);
  assert.ok(safeParseVisual(next).success);
});

test("resetNodeExtStyle clears extended node presentation overrides", () => {
  const source = sourceFor("flowchart");
  const id = source.nodes[0].id;
  const styled = setNodeFillStyle(
    setNodeBorderStyle(
      setNodeBorderWidth(setNodeTextAlign(source, id, "right"), id, 4),
      id,
      "dotted",
    ),
    id,
    "gradient",
  );
  styled.nodes[0].fontFamily = "Georgia";
  assert.equal(styled.nodes[0].fillStyle, "gradient");
  const reset = resetNodeExtStyle(styled, id);
  assert.equal(reset.nodes[0].fillStyle, undefined);
  assert.equal(reset.nodes[0].borderStyle, undefined);
  assert.equal(reset.nodes[0].borderWidth, undefined);
  assert.equal(reset.nodes[0].textAlign, undefined);
  assert.equal(reset.nodes[0].fontFamily, undefined);
  assert.ok(safeParseVisual(reset).success);
});

test("resetNodeExtStyle leaves other nodes unchanged", () => {
  const source = sourceFor("flowchart");
  const id0 = source.nodes[0].id;
  const id1 = source.nodes[1].id;
  const styled = setNodeFillStyle(
    setNodeFillStyle(source, id0, "gradient"),
    id1,
    "gradient",
  );
  const reset = resetNodeExtStyle(styled, id0);
  assert.equal(reset.nodes[0].fillStyle, undefined);
  assert.equal(reset.nodes[1].fillStyle, "gradient");
});

// ── New per-edge transforms ───────────────────────────────────────────────────

test("setEdgeArrowStyle sets arrowStyle and is immutable", (t) => {
  const source = sourceFor("flowchart");
  skipIf(t, source.edges.length === 0, "flowchart fixture has no edges");
  const id = source.edges[0].id;
  const before = JSON.stringify(source);
  const next = setEdgeArrowStyle(source, id, "open");
  assert.equal(next.edges[0].arrowStyle, "open");
  assert.equal(source.edges[0].arrowStyle, undefined, "input untouched");
  assert.equal(JSON.stringify(source), before);
  assert.ok(safeParseVisual(next).success);
});

test("setEdgeLineStyle sets lineStyle and is immutable", (t) => {
  const source = sourceFor("flowchart");
  skipIf(t, source.edges.length === 0, "flowchart fixture has no edges");
  const id = source.edges[0].id;
  const before = JSON.stringify(source);
  const next = setEdgeLineStyle(source, id, "dashed");
  assert.equal(next.edges[0].lineStyle, "dashed");
  assert.equal(source.edges[0].lineStyle, undefined, "input untouched");
  assert.equal(JSON.stringify(source), before);
  assert.ok(safeParseVisual(next).success);
});

test("setEdgeLineWidth sets lineWidth and is immutable", (t) => {
  const source = sourceFor("flowchart");
  skipIf(t, source.edges.length === 0, "flowchart fixture has no edges");
  const id = source.edges[0].id;
  const before = JSON.stringify(source);
  const next = setEdgeLineWidth(source, id, 3);
  assert.equal(next.edges[0].lineWidth, 3);
  assert.equal(source.edges[0].lineWidth, undefined, "input untouched");
  assert.equal(JSON.stringify(source), before);
  assert.ok(safeParseVisual(next).success);
});

test("setAllEdgesStyle applies patch to all edges", () => {
  const source = sourceFor("flowchart");
  const before = JSON.stringify(source);
  const next = setAllEdgesStyle(source, {
    arrowStyle: "diamond",
    lineStyle: "dotted",
    lineWidth: 2,
  });
  for (const edge of next.edges) {
    assert.equal(edge.arrowStyle, "diamond");
    assert.equal(edge.lineStyle, "dotted");
    assert.equal(edge.lineWidth, 2);
  }
  assert.equal(JSON.stringify(source), before, "input untouched");
  assert.ok(safeParseVisual(next).success);
});

test("setAllEdgesStyle preserves edge content (from/to/label)", () => {
  const source = sourceFor("flowchart");
  const next = setAllEdgesStyle(source, { lineStyle: "dashed" });
  for (let i = 0; i < source.edges.length; i++) {
    assert.equal(next.edges[i].from, source.edges[i].from);
    assert.equal(next.edges[i].to, source.edges[i].to);
    assert.equal(next.edges[i].label, source.edges[i].label);
  }
});

test("edge content transforms update only the selected connector", () => {
  const source = sourceFor("flowchart");
  assert.ok(source.edges.length >= 1, "flowchart fixture has an edge");
  const edge = source.edges[0];

  const labeled = setEdgeLabel(source, edge.id, "Reviewed");
  assert.equal(labeled.edges[0].label, "Reviewed");
  assert.equal(source.edges[0].label, edge.label);

  const flipped = flipEdge(source, edge.id);
  assert.equal(flipped.edges[0].from, edge.to);
  assert.equal(flipped.edges[0].to, edge.from);

  const hiddenArrow = toggleEdgeDirected(source, edge.id);
  assert.equal(hiddenArrow.edges[0].directed, false);
  const shownArrow = toggleEdgeDirected(hiddenArrow, edge.id);
  assert.equal(shownArrow.edges[0].directed, true);

  const curved = toggleEdgeStyle(source, edge.id);
  assert.equal(curved.edges[0].style, "curved");
  const straight = toggleEdgeStyle(curved, edge.id);
  assert.equal(straight.edges[0].style, "straight");
});

test("edge transforms reject duplicate edge ids", () => {
  const source = sourceFor("flowchart");
  assert.ok(source.edges.length >= 1, "flowchart fixture has an edge");
  const duplicate = {
    ...source,
    edges: [
      { ...source.edges[0], id: "dup-edge" },
      { ...source.edges[0], id: "dup-edge" },
    ],
  };

  assert.throws(
    () => setEdgeLabel(duplicate, "dup-edge", "Reviewed"),
    /Duplicate edge id: dup-edge/,
  );
});

// ── Optional current fields ───────────────────────────────────────────────────

test("validateVisual accepts visuals without optional node style fields", () => {
  for (const kind of VISUAL_KINDS) {
    const source = sourceFor(kind);
    // Strip optional fields.
    const stripped = {
      ...source,
      nodes: source.nodes.map((n) => {
        const {
          fillStyle: _1,
          borderStyle: _2,
          borderWidth: _3,
          textAlign: _4,
          ...rest
        } = n;
        void _1;
        void _2;
        void _3;
        void _4;
        return rest;
      }),
      edges: source.edges.map((e) => {
        const { arrowStyle: _5, lineStyle: _6, lineWidth: _7, ...rest } = e;
        void _5;
        void _6;
        void _7;
        return rest;
      }),
    };
    const result = safeParseVisual(stripped);
    assert.ok(result.success, `${kind} old visual still validates`);
  }
});

test("validateVisual accepts all new field values", () => {
  const source = sourceFor("flowchart");
  const node = source.nodes[0];
  const edge = source.edges.length > 0 ? source.edges[0] : null;

  const withNewFields = {
    ...source,
    nodes: source.nodes.map((n) =>
      n.id === node.id
        ? {
            ...n,
            fillStyle: "gradient",
            borderStyle: "dashed",
            borderWidth: 2.5,
            textAlign: "right",
          }
        : n,
    ),
    edges:
      edge !== null
        ? source.edges.map((e) =>
            e.id === edge.id
              ? {
                  ...e,
                  arrowStyle: "circle",
                  lineStyle: "dotted",
                  lineWidth: 3,
                }
              : e,
          )
        : source.edges,
  };

  const result = safeParseVisual(withNewFields);
  assert.ok(result.success, "new fields validate");
  if (!result.success) return;

  const n = result.data.nodes.find((x) => x.id === node.id)!;
  assert.equal(n.fillStyle, "gradient");
  assert.equal(n.borderStyle, "dashed");
  assert.equal(n.borderWidth, 2.5);
  assert.equal(n.textAlign, "right");

  if (edge !== null) {
    const e = result.data.edges.find((x) => x.id === edge.id)!;
    assert.equal(e.arrowStyle, "circle");
    assert.equal(e.lineStyle, "dotted");
    assert.equal(e.lineWidth, 3);
  }
});

test("validateVisual silently drops unknown fillStyle values", () => {
  const source = sourceFor("flowchart");
  const withBad = {
    ...source,
    nodes: [
      { ...source.nodes[0], fillStyle: "radial" },
      ...source.nodes.slice(1),
    ],
  };
  const result = safeParseVisual(withBad);
  assert.ok(result.success, "unknown fillStyle accepted as no-op");
  if (result.success) {
    assert.equal(result.data.nodes[0].fillStyle, undefined);
  }
});

test("validateVisual silently drops unknown arrowStyle values", (t) => {
  const source = sourceFor("flowchart");
  skipIf(t, source.edges.length === 0, "flowchart fixture has no edges");
  const withBad = {
    ...source,
    edges: [
      { ...source.edges[0], arrowStyle: "zigzag" },
      ...source.edges.slice(1),
    ],
  };
  const result = safeParseVisual(withBad);
  assert.ok(result.success, "unknown arrowStyle accepted as no-op");
  if (result.success) {
    assert.equal(result.data.edges[0].arrowStyle, undefined);
  }
});

test("new node/edge style fields round-trip through safeParseVisual", () => {
  const source = sourceFor("flowchart");
  let v = source;
  const id0 = source.nodes[0].id;
  v = setNodeFillStyle(v, id0, "gradient");
  v = setNodeBorderStyle(v, id0, "dashed");
  v = setNodeBorderWidth(v, id0, 2);
  v = setNodeTextAlign(v, id0, "left");
  if (source.edges.length > 0) {
    const eid = source.edges[0].id;
    v = setEdgeArrowStyle(v, eid, "diamond");
    v = setEdgeLineStyle(v, eid, "dotted");
    v = setEdgeLineWidth(v, eid, 2.5);
  }
  const result = safeParseVisual(v);
  assert.ok(result.success, "round-trip succeeds");
  if (result.success) {
    assert.deepEqual(safeParseVisual(result.data), result);
  }
});
