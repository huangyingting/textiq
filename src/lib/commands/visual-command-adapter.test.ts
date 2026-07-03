/**
 * Tests for the visual command adapter (issue #471).
 *
 * Verifies that `applyVisualCommand` correctly routes typed command payloads
 * through `executeVisualCommand`, returning the expected result visual and
 * command metadata (patches, side effects, affected ids).
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";

import {
  applyVisualCommand,
  buildVisualCommand,
} from "./visual-command-adapter";
import { createBlankVisual } from "@/lib/visual/blank";
import { STYLE_THEMES } from "@/lib/visual/themes";
import {
  applyTheme,
  flipEdge,
  setEdgeLabel,
  setNodeLabel,
  toggleEdgeDirected,
  toggleEdgeStyle,
} from "@/lib/visual/transforms";

const VISUAL_ID = "vis-adapter-1";
const DOC_ID = "doc-1";
type VisualCommandPayload = Parameters<typeof applyVisualCommand>[2];

function malformedVisualPayload(value: unknown): VisualCommandPayload {
  return value as unknown as VisualCommandPayload;
}

describe("buildVisualCommand", () => {
  test("builds a valid VisualCommand envelope", () => {
    const payload = { op: "visual.apply_theme" as const, themeId: "ocean" };
    const cmd = buildVisualCommand(payload, VISUAL_ID, DOC_ID);

    assert.strictEqual(cmd.type, "visual.apply_theme");
    assert.strictEqual(cmd.target.surface, "visual");
    assert.strictEqual(cmd.target.visualId, VISUAL_ID);
    assert.strictEqual(cmd.target.documentId, DOC_ID);
    assert.strictEqual(cmd.source, "user");
    assert.deepStrictEqual(cmd.payload, payload);
    assert.ok(typeof cmd.id === "string" && cmd.id.length > 0);
  });

  test("includes coalesceKey when provided", () => {
    const payload = { op: "visual.set_auto_layout" as const, enabled: true };
    const cmd = buildVisualCommand(payload, VISUAL_ID, undefined, "gesture-1");
    assert.strictEqual(cmd.coalesceKey, "gesture-1");
  });

  test("omits coalesceKey when not provided", () => {
    const payload = { op: "visual.apply_theme" as const, themeId: "indigo" };
    const cmd = buildVisualCommand(payload, VISUAL_ID);
    assert.ok(!("coalesceKey" in cmd) || cmd.coalesceKey === undefined);
  });
});

describe("applyVisualCommand — theme", () => {
  test("visual.apply_theme returns correct theme and metadata", () => {
    const visual = createBlankVisual("flowchart");
    const themeId = STYLE_THEMES[1]?.id ?? "ocean";

    const result = applyVisualCommand(visual, VISUAL_ID, {
      op: "visual.apply_theme",
      themeId,
    });

    assert.ok(result.ok, "result should be ok");
    // The resulting visual should differ from the input (theme was applied).
    const expected = applyTheme(visual, themeId);
    assert.deepStrictEqual(result.visual.style, expected.style);
    // Metadata: patches emitted
    assert.ok(result.patches.length === 1, "one patch emitted");
    assert.strictEqual(result.patches[0]!.op, "visual.apply_theme");
    assert.strictEqual(result.patches[0]!.visualId, VISUAL_ID);
    // Side effects include render invalidation
    assert.ok(result.sideEffects.some((e) => e.kind === "render_invalidation"));
  });
});

describe("applyVisualCommand — style", () => {
  test("visual.set_style applies color patch", () => {
    const visual = createBlankVisual("flowchart");

    const result = applyVisualCommand(visual, VISUAL_ID, {
      op: "visual.set_style",
      patch: { background: "#ff0000" },
    });

    assert.ok(result.ok);
    assert.strictEqual(result.visual.style.background, "#ff0000");
    assert.strictEqual(result.patches[0]!.op, "visual.set_style");
  });
});

describe("applyVisualCommand — display style", () => {
  test("visual.apply_display_style applies known style", () => {
    const visual = createBlankVisual("flowchart");

    const result = applyVisualCommand(visual, VISUAL_ID, {
      op: "visual.apply_display_style",
      styleId: "clean",
    });

    assert.ok(result.ok);
    assert.strictEqual(result.patches[0]!.op, "visual.apply_display_style");
  });
});

describe("applyVisualCommand — effects", () => {
  test("visual.set_effect adds shadow and emits patch", () => {
    const visual = createBlankVisual("flowchart");

    const result = applyVisualCommand(visual, VISUAL_ID, {
      op: "visual.set_effect",
      effect: { kind: "shadow" },
    });

    assert.ok(result.ok);
    assert.ok(result.visual.effects?.some((e) => e.kind === "shadow"));
    assert.strictEqual(result.patches[0]!.op, "visual.set_effect");
  });

  test("visual.clear_effect removes shadow and emits patch", () => {
    const visual = {
      ...createBlankVisual("flowchart"),
      effects: [{ kind: "shadow" as const }],
    };

    const result = applyVisualCommand(visual, VISUAL_ID, {
      op: "visual.clear_effect",
      kind: "shadow",
    });

    assert.ok(result.ok);
    assert.ok(!(result.visual.effects ?? []).some((e) => e.kind === "shadow"));
    assert.strictEqual(result.patches[0]!.op, "visual.clear_effect");
  });
});

describe("applyVisualCommand — node style edits (#507)", () => {
  test("visual.set_node_style updates a node color and emits patch", () => {
    const visual = createBlankVisual("flowchart");
    const nodeId = visual.nodes[0]!.id;

    const result = applyVisualCommand(visual, VISUAL_ID, {
      op: "visual.set_node_style",
      nodeId,
      field: "color",
      value: "#abcdef",
    });

    assert.ok(result.ok);
    assert.strictEqual(
      result.visual.nodes.find((n) => n.id === nodeId)?.color,
      "#abcdef",
    );
    assert.strictEqual(result.patches[0]!.op, "visual.set_node_style");
    assert.deepStrictEqual(result.patches[0]!.affectedNodeIds, [nodeId]);
  });

  test("visual.set_node_ext_style applies fill/border/text patch", () => {
    const visual = createBlankVisual("flowchart");
    const nodeId = visual.nodes[0]!.id;

    const result = applyVisualCommand(visual, VISUAL_ID, {
      op: "visual.set_node_ext_style",
      nodeId,
      patch: { fillStyle: "gradient", textAlign: "left" },
    });

    assert.ok(result.ok);
    const node = result.visual.nodes.find((n) => n.id === nodeId);
    assert.strictEqual(node?.fillStyle, "gradient");
    assert.strictEqual(node?.textAlign, "left");
    assert.strictEqual(result.patches[0]!.op, "visual.set_node_ext_style");
  });

  test("visual.set_node_icon and clear_node_icon round-trip", () => {
    const visual = createBlankVisual("flowchart");
    const nodeId = visual.nodes[0]!.id;

    const set = applyVisualCommand(visual, VISUAL_ID, {
      op: "visual.set_node_icon",
      nodeId,
      icon: "Sparkles",
    });
    assert.ok(set.ok);
    assert.strictEqual(
      set.visual.nodes.find((n) => n.id === nodeId)?.icon,
      "Sparkles",
    );

    const cleared = applyVisualCommand(set.visual, VISUAL_ID, {
      op: "visual.clear_node_icon",
      nodeId,
    });
    assert.ok(cleared.ok);
    assert.strictEqual(
      cleared.visual.nodes.find((n) => n.id === nodeId)?.icon,
      undefined,
    );
  });

  test("visual.set_node_label updates a node label", () => {
    const visual = createBlankVisual("flowchart");
    const nodeId = visual.nodes[0]!.id;

    const result = applyVisualCommand(visual, VISUAL_ID, {
      op: "visual.set_node_label",
      nodeId,
      label: "Renamed",
    });

    assert.ok(result.ok);
    assert.strictEqual(
      result.visual.nodes.find((n) => n.id === nodeId)?.label,
      "Renamed",
    );
    assert.strictEqual(result.patches[0]!.op, "visual.set_node_label");
  });
});

describe("applyVisualCommand — edge + lifecycle edits (#507)", () => {
  test("visual.set_all_edges_style applies arrow/line patch to all edges", () => {
    const visual = createBlankVisual("flowchart");

    const result = applyVisualCommand(visual, VISUAL_ID, {
      op: "visual.set_all_edges_style",
      patch: { lineStyle: "dashed" },
    });

    assert.ok(result.ok);
    assert.ok(result.visual.edges.every((e) => e.lineStyle === "dashed"));
    assert.strictEqual(result.patches[0]!.op, "visual.set_all_edges_style");
  });

  test("visual.delete_node removes node + connected edges and reports affected ids", () => {
    const visual = createBlankVisual("flowchart");
    // n2 is connected to both e1 (n1->n2) and e2 (n2->n3).
    const result = applyVisualCommand(visual, VISUAL_ID, {
      op: "visual.delete_node",
      nodeId: "n2",
    });

    assert.ok(result.ok);
    assert.ok(!result.visual.nodes.some((n) => n.id === "n2"));
    assert.ok(
      !result.visual.edges.some((e) => e.from === "n2" || e.to === "n2"),
    );
    const patch = result.patches[0]!;
    assert.strictEqual(patch.op, "visual.delete_node");
    assert.deepStrictEqual(patch.affectedNodeIds, ["n2"]);
    assert.deepStrictEqual([...patch.affectedEdgeIds].sort(), ["e1", "e2"]);
  });

  test("visual.merge_content preserves refreshed source metadata", () => {
    const visual = createBlankVisual("flowchart");
    const refreshed = {
      ...createBlankVisual("mindmap"),
      sourceText: "Updated source",
      sourceTextHash: "source-hash",
    };

    const result = applyVisualCommand(visual, VISUAL_ID, {
      op: "visual.merge_content",
      newVisual: refreshed,
    });

    assert.ok(result.ok);
    assert.strictEqual(result.visual.sourceText, "Updated source");
    assert.strictEqual(result.visual.sourceTextHash, "source-hash");
  });
});

describe("applyVisualCommand — edge flip/toggle + label commits (#507)", () => {
  test("visual.flip_edge swaps from/to and matches the direct transform", () => {
    const visual = createBlankVisual("flowchart");

    const result = applyVisualCommand(visual, VISUAL_ID, {
      op: "visual.flip_edge",
      edgeId: "e1",
    });

    assert.ok(result.ok);
    const edge = result.visual.edges.find((e) => e.id === "e1")!;
    assert.strictEqual(edge.from, "n2");
    assert.strictEqual(edge.to, "n1");
    assert.strictEqual(result.patches[0]!.op, "visual.flip_edge");
    assert.deepStrictEqual(result.patches[0]!.affectedEdgeIds, ["e1"]);
    // Byte-identical to the direct pure transform.
    assert.deepStrictEqual(result.visual, flipEdge(visual, "e1"));
  });

  test("visual.toggle_edge_directed flips the directed flag (matches transform)", () => {
    const visual = createBlankVisual("flowchart");

    const result = applyVisualCommand(visual, VISUAL_ID, {
      op: "visual.toggle_edge_directed",
      edgeId: "e1",
    });

    assert.ok(result.ok);
    assert.strictEqual(
      result.visual.edges.find((e) => e.id === "e1")?.directed,
      false,
    );
    assert.strictEqual(result.patches[0]!.op, "visual.toggle_edge_directed");
    assert.deepStrictEqual(result.patches[0]!.affectedEdgeIds, ["e1"]);
    assert.deepStrictEqual(result.visual, toggleEdgeDirected(visual, "e1"));
  });

  test("visual.toggle_edge_style flips curved/straight (matches transform)", () => {
    const visual = createBlankVisual("flowchart");

    const result = applyVisualCommand(visual, VISUAL_ID, {
      op: "visual.toggle_edge_style",
      edgeId: "e1",
    });

    assert.ok(result.ok);
    assert.strictEqual(
      result.visual.edges.find((e) => e.id === "e1")?.style,
      "curved",
    );
    assert.strictEqual(result.patches[0]!.op, "visual.toggle_edge_style");
    assert.deepStrictEqual(result.patches[0]!.affectedEdgeIds, ["e1"]);
    assert.deepStrictEqual(result.visual, toggleEdgeStyle(visual, "e1"));
  });

  test("visual.set_edge_label commits the label (matches transform)", () => {
    const visual = createBlankVisual("flowchart");

    const result = applyVisualCommand(visual, VISUAL_ID, {
      op: "visual.set_edge_label",
      edgeId: "e1",
      label: "Yes",
    });

    assert.ok(result.ok);
    assert.strictEqual(
      result.visual.edges.find((e) => e.id === "e1")?.label,
      "Yes",
    );
    assert.strictEqual(result.patches[0]!.op, "visual.set_edge_label");
    assert.deepStrictEqual(result.patches[0]!.affectedEdgeIds, ["e1"]);
    assert.deepStrictEqual(result.visual, setEdgeLabel(visual, "e1", "Yes"));
  });

  test("visual.set_node_label commit matches the direct transform byte-for-byte", () => {
    const visual = createBlankVisual("flowchart");

    const result = applyVisualCommand(visual, VISUAL_ID, {
      op: "visual.set_node_label",
      nodeId: "n1",
      label: "Begin",
    });

    assert.ok(result.ok);
    assert.deepStrictEqual(result.visual, setNodeLabel(visual, "n1", "Begin"));
  });

  test("edge flip/toggle/label on a missing edge fail without mutating", () => {
    const visual = createBlankVisual("flowchart");

    for (const payload of [
      { op: "visual.flip_edge" as const, edgeId: "missing-edge" },
      { op: "visual.toggle_edge_directed" as const, edgeId: "missing-edge" },
      { op: "visual.toggle_edge_style" as const, edgeId: "missing-edge" },
      {
        op: "visual.set_edge_label" as const,
        edgeId: "missing-edge",
        label: "x",
      },
    ]) {
      const result = applyVisualCommand(visual, VISUAL_ID, payload);
      assert.ok(!result.ok, `${payload.op} should fail for missing edge`);
      assert.strictEqual(result.visual, visual);
      assert.strictEqual(result.patches.length, 0);
    }
  });

  test("a malformed edge payload (missing edgeId) is rejected before persistence", () => {
    const visual = createBlankVisual("flowchart");

    const result = applyVisualCommand(
      visual,
      VISUAL_ID,
      malformedVisualPayload({
        op: "visual.flip_edge",
      }),
    );

    assert.ok(!result.ok, "malformed payload should be rejected");
    assert.strictEqual(result.visual, visual);
    assert.strictEqual(result.patches.length, 0);
  });
});

describe("applyVisualCommand — failure path", () => {
  test("returns original visual on failure (no mutation)", () => {
    const visual = createBlankVisual("flowchart");

    // Attempting to delete a non-existent node should fail.
    const result = applyVisualCommand(visual, VISUAL_ID, {
      op: "visual.delete_node",
      nodeId: "node-does-not-exist",
    });

    assert.ok(!result.ok, "should fail for missing node");
    // Input visual unchanged.
    assert.strictEqual(result.visual, visual);
    assert.strictEqual(result.patches.length, 0);
  });

  test("set_node_style on a missing node does not mutate the visual", () => {
    const visual = createBlankVisual("flowchart");

    const result = applyVisualCommand(visual, VISUAL_ID, {
      op: "visual.set_node_style",
      nodeId: "missing-node",
      field: "color",
      value: "#000000",
    });

    assert.ok(!result.ok, "should fail for missing node");
    assert.strictEqual(result.visual, visual);
    assert.strictEqual(result.patches.length, 0);
  });

  test("a malformed payload is rejected before persistence", () => {
    const visual = createBlankVisual("flowchart");

    // Missing the required `value` field — invalid envelope payload.
    const result = applyVisualCommand(
      visual,
      VISUAL_ID,
      malformedVisualPayload({
        op: "visual.set_node_style",
        nodeId: visual.nodes[0]!.id,
        field: "color",
      }),
    );

    assert.ok(!result.ok, "malformed payload should be rejected");
    assert.strictEqual(result.visual, visual);
    assert.strictEqual(result.patches.length, 0);
  });
});
