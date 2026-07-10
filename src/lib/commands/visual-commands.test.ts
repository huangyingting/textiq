import assert from "node:assert/strict";
import { test } from "node:test";

import { executeVisualCommand } from "@/lib/commands/visual-commands";
import type { VisualCommand } from "@/lib/commands/visual-command-contracts";
import { createBlankVisual } from "@/lib/visual/blank";
import { safeParseVisual, type Visual } from "@/lib/visual/schema";
import { makeVisualCommand } from "@/test/builders/commands";

const VISUAL_ID = "vis-1";
const makeCommand = makeVisualCommand;

test("executeVisualCommand supports every visual command op with schema-valid output", () => {
  const flowchart = createBlankVisual("flowchart");
  const mergedVisual = createBlankVisual("mindmap");

  const cases: Array<{ name: string; visual: Visual; command: VisualCommand }> =
    [
      {
        name: "apply_theme",
        visual: flowchart,
        command: makeCommand({ op: "visual.apply_theme", themeId: "ocean" }),
      },
      {
        name: "set_style",
        visual: flowchart,
        command: makeCommand({
          op: "visual.set_style",
          patch: { background: "#101010", fontSize: 18 },
        }),
      },
      {
        name: "apply_display_style",
        visual: flowchart,
        command: makeCommand({
          op: "visual.apply_display_style",
          styleId: "clean",
        }),
      },
      {
        name: "set_kind",
        visual: flowchart,
        command: makeCommand({ op: "visual.set_kind", kind: "mindmap" }),
      },
      {
        name: "set_canvas_style",
        visual: flowchart,
        command: makeCommand({
          op: "visual.set_canvas_style",
          canvasStyle: "ruled",
        }),
      },
      {
        name: "set_aspect_ratio",
        visual: flowchart,
        command: makeCommand({ op: "visual.set_aspect_ratio", preset: "1:1" }),
      },
      {
        name: "set_auto_layout",
        visual: flowchart,
        command: makeCommand({ op: "visual.set_auto_layout", enabled: true }),
      },
      {
        name: "set_node_style",
        visual: flowchart,
        command: makeCommand({
          op: "visual.set_node_style",
          nodeId: "n1",
          field: "color",
          value: "#abcdef",
        }),
      },
      {
        name: "reset_node_style",
        visual: {
          ...flowchart,
          nodes: [
            { ...flowchart.nodes[0]!, color: "#abcdef" },
            ...flowchart.nodes.slice(1),
          ],
        },
        command: makeCommand({ op: "visual.reset_node_style", nodeId: "n1" }),
      },
      {
        name: "set_node_ext_style",
        visual: flowchart,
        command: makeCommand({
          op: "visual.set_node_ext_style",
          nodeId: "n1",
          patch: { fillStyle: "gradient", borderWidth: 2.5, textAlign: "left" },
        }),
      },
      {
        name: "reset_node_ext_style",
        visual: {
          ...flowchart,
          nodes: [
            {
              ...flowchart.nodes[0]!,
              fillStyle: "gradient",
              borderStyle: "dashed",
              borderWidth: 2,
              textAlign: "left",
              fontFamily: "serif",
            },
            ...flowchart.nodes.slice(1),
          ],
        },
        command: makeCommand({
          op: "visual.reset_node_ext_style",
          nodeId: "n1",
        }),
      },
      {
        name: "set_node_icon",
        visual: flowchart,
        command: makeCommand({
          op: "visual.set_node_icon",
          nodeId: "n1",
          icon: "Rocket",
        }),
      },
      {
        name: "clear_node_icon",
        visual: {
          ...flowchart,
          nodes: [
            { ...flowchart.nodes[0]!, icon: "Rocket" },
            ...flowchart.nodes.slice(1),
          ],
        },
        command: makeCommand({ op: "visual.clear_node_icon", nodeId: "n1" }),
      },
      {
        name: "set_node_label",
        visual: flowchart,
        command: makeCommand({
          op: "visual.set_node_label",
          nodeId: "n1",
          label: "Renamed",
        }),
      },
      {
        name: "set_edge_style",
        visual: flowchart,
        command: makeCommand({
          op: "visual.set_edge_style",
          edgeId: "e1",
          patch: { arrowStyle: "open", lineStyle: "dashed", lineWidth: 2 },
        }),
      },
      {
        name: "set_all_edges_style",
        visual: flowchart,
        command: makeCommand({
          op: "visual.set_all_edges_style",
          patch: { lineStyle: "dotted", lineWidth: 1.8 },
        }),
      },
      {
        name: "set_effect",
        visual: flowchart,
        command: makeCommand({
          op: "visual.set_effect",
          effect: { kind: "shadow", dx: 4, dy: 4, blur: 6 },
        }),
      },
      {
        name: "clear_effect",
        visual: { ...flowchart, effects: [{ kind: "shadow", dx: 2 }] },
        command: makeCommand({ op: "visual.clear_effect", kind: "shadow" }),
      },
      {
        name: "merge_content",
        visual: flowchart,
        command: makeCommand({
          op: "visual.merge_content",
          newVisual: mergedVisual,
        }),
      },
    ];

  for (const entry of cases) {
    const result = executeVisualCommand(entry.visual, entry.command);
    assert.equal(result.ok, true, entry.name);
    assert.equal(result.patches.length, 1, `${entry.name} patch count`);
    assert.ok(result.sideEffects.length >= 2, `${entry.name} side effects`);
    const parsed = safeParseVisual(result.visual);
    assert.equal(
      parsed.success,
      true,
      `${entry.name} should stay schema-valid`,
    );
    if (entry.command.payload.op === "visual.merge_content") {
      assert.ok(
        result.sideEffects.some(
          (effect) => effect.kind === "source_staleness_recompute",
        ),
        "merge_content should signal source staleness recompute",
      );
    }
  }
});

test("executeVisualCommand updates node labels and emits command metadata", () => {
  const visual = createBlankVisual("flowchart");
  const result = executeVisualCommand(
    visual,
    makeCommand(
      { op: "visual.set_node_label", nodeId: "n2", label: "Decision" },
      { coalesceKey: "label:n2" },
    ),
  );

  assert.equal(result.ok, true);
  assert.equal(result.visual.nodes[1]!.label, "Decision");
  assert.deepEqual(result.affectedNodeIds, ["n2"]);
  assert.equal(result.historyKey, "label:n2");
  assert.equal(result.patches[0]!.visualId, VISUAL_ID);
  assert.equal(result.patches[0]!.op, "visual.set_node_label");
});

test("executeVisualCommand composes set_node_ext_style over inline transforms", () => {
  const visual = createBlankVisual("flowchart");
  const result = executeVisualCommand(
    visual,
    makeCommand({
      op: "visual.set_node_ext_style",
      nodeId: "n1",
      patch: {
        fillStyle: "gradient",
        borderStyle: "dashed",
        borderWidth: 3,
        textAlign: "left",
        fontFamily: "serif",
      },
    }),
  );

  assert.equal(result.ok, true);
  const node = result.visual.nodes.find((entry) => entry.id === "n1");
  assert.ok(node);
  assert.equal(node?.fillStyle, "gradient");
  assert.equal(node?.borderStyle, "dashed");
  assert.equal(node?.borderWidth, 3);
  assert.equal(node?.textAlign, "left");
  assert.equal(node?.fontFamily, "serif");
});

test("invalid visual commands fail without partially mutating the input visual", () => {
  const visual = createBlankVisual("flowchart");
  const before = JSON.stringify(visual);

  const result = executeVisualCommand(
    visual,
    makeCommand({
      op: "visual.set_node_label",
      nodeId: "missing-node",
      label: "Nope",
    }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.visual, visual);
  assert.equal(JSON.stringify(visual), before);
  assert.deepEqual(result.patches, []);
  assert.deepEqual(result.sideEffects, []);
});
