import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canCoalesceVisualCommands,
  getVisualCommandMetadata,
  mergeVisualCommandPayload,
  mergeVisualCommands,
  validateVisualCommandPayload,
} from "@/lib/commands/visual-command-metadata";
import type { VisualCommandPayload } from "@/lib/commands/visual-command-contracts";
import { createBlankVisual } from "@/lib/visual/blank";
import { makeVisualCommand } from "@/test/builders/commands";

const validVisual = createBlankVisual("flowchart");

const validPayloads: VisualCommandPayload[] = [
  { op: "visual.apply_theme", themeId: "ocean" },
  {
    op: "visual.set_style",
    patch: {
      palette: ["#111111", "#eeeeee"],
      background: "#ffffff",
      nodeFill: "#f8fafc",
      nodeStroke: "#111827",
      nodeText: "#0f172a",
      edgeColor: "#334155",
      fontFamily: "Inter",
      fontSize: 16,
      fontWeight: 600,
    },
  },
  { op: "visual.apply_display_style", styleId: "clean" },
  { op: "visual.set_kind", kind: "mindmap" },
  { op: "visual.set_canvas_style", canvasStyle: "dot-grid" },
  { op: "visual.set_aspect_ratio", preset: "16:9" },
  { op: "visual.set_auto_layout", enabled: false },
  {
    op: "visual.set_node_style",
    nodeId: "n1",
    field: "color",
    value: "#abcdef",
  },
  { op: "visual.reset_node_style", nodeId: "n1" },
  {
    op: "visual.set_node_ext_style",
    nodeId: "n1",
    patch: {
      fillStyle: "gradient",
      borderStyle: "dashed",
      borderWidth: 2,
      textAlign: "center",
      fontFamily: "Inter",
    },
  },
  { op: "visual.reset_node_ext_style", nodeId: "n1" },
  { op: "visual.set_node_icon", nodeId: "n1", icon: "Rocket" },
  { op: "visual.clear_node_icon", nodeId: "n1" },
  { op: "visual.set_node_label", nodeId: "n1", label: "Start" },
  { op: "visual.set_edge_label", edgeId: "e1", label: "Yes" },
  {
    op: "visual.set_edge_style",
    edgeId: "e1",
    patch: { arrowStyle: "open", lineStyle: "dotted", lineWidth: 2 },
  },
  { op: "visual.flip_edge", edgeId: "e1" },
  { op: "visual.toggle_edge_directed", edgeId: "e1" },
  { op: "visual.toggle_edge_style", edgeId: "e1" },
  {
    op: "visual.set_all_edges_style",
    patch: { arrowStyle: "filled", lineStyle: "solid", lineWidth: 1 },
  },
  { op: "visual.set_effect", effect: { kind: "shadow", dx: 1, dy: 2 } },
  {
    op: "visual.set_effect",
    effect: { kind: "sketch", frequency: 2, scale: 1 },
  },
  { op: "visual.clear_effect", kind: "shadow" },
  { op: "visual.merge_content", newVisual: validVisual },
  { op: "visual.add_node", node: { id: "n3", label: "New" } },
  { op: "visual.delete_node", nodeId: "n1" },
  { op: "visual.add_edge", edge: { id: "e3", from: "n1", to: "n2" } },
  { op: "visual.delete_edge", edgeId: "e1" },
  {
    op: "visual.reconnect_edge",
    edgeId: "e1",
    fromNodeId: "n2",
    toNodeId: "n1",
  },
  { op: "visual.duplicate_node", nodeId: "n1", newNodeId: "n3" },
  { op: "visual.relayout_graph" },
];

describe("validateVisualCommandPayload", () => {
  it("accepts every supported visual payload shape", () => {
    for (const payload of validPayloads) {
      const errors: string[] = [];

      validateVisualCommandPayload(payload.op, payload, errors);

      assert.deepEqual(errors, [], payload.op);
    }
  });

  it("reports envelope and unsupported-op problems", () => {
    const nonObjectErrors: string[] = [];
    validateVisualCommandPayload("visual.set_style", null, nonObjectErrors);
    assert.deepEqual(nonObjectErrors, [
      "payload must be an object for visual commands.",
    ]);

    const mismatchErrors: string[] = [];
    validateVisualCommandPayload(
      "visual.set_style",
      { op: "visual.apply_theme", themeId: "ocean" },
      mismatchErrors,
    );
    assert.deepEqual(mismatchErrors, ["payload.op must match envelope.type."]);

    const unsupportedErrors: string[] = [];
    validateVisualCommandPayload(
      "visual.unknown",
      { op: "visual.unknown" },
      unsupportedErrors,
    );
    assert.deepEqual(unsupportedErrors, ["Unsupported visual payload op."]);
  });

  it("reports only label type errors for malformed edge-label payloads with a valid edge id", () => {
    const errors: string[] = [];

    validateVisualCommandPayload(
      "visual.set_edge_label",
      { op: "visual.set_edge_label", edgeId: "e1", label: 42 },
      errors,
    );

    assert.deepEqual(errors, ["payload.label must be a string."]);
  });

  it("requires reconnect_edge to provide at least one valid endpoint", () => {
    const validCases: VisualCommandPayload[] = [
      { op: "visual.reconnect_edge", edgeId: "e1", fromNodeId: "n1" },
      { op: "visual.reconnect_edge", edgeId: "e1", toNodeId: "n2" },
    ];
    for (const payload of validCases) {
      const errors: string[] = [];
      validateVisualCommandPayload("visual.reconnect_edge", payload, errors);
      assert.deepEqual(errors, [], JSON.stringify(payload));
    }

    const noOpErrors: string[] = [];
    validateVisualCommandPayload(
      "visual.reconnect_edge",
      { op: "visual.reconnect_edge", edgeId: "e1" },
      noOpErrors,
    );
    assert.deepEqual(noOpErrors, [
      "payload.fromNodeId or payload.toNodeId must be provided.",
    ]);

    const nonStringErrors: string[] = [];
    validateVisualCommandPayload(
      "visual.reconnect_edge",
      {
        op: "visual.reconnect_edge",
        edgeId: "e1",
        fromNodeId: 42,
        toNodeId: "",
      },
      nonStringErrors,
    );
    assert.deepEqual(nonStringErrors, [
      "payload.fromNodeId must be a non-empty string when provided.",
      "payload.toNodeId must be a non-empty string when provided.",
    ]);
  });

  it("reports only edge id errors for edge-label payloads with a string label", () => {
    const errors: string[] = [];

    validateVisualCommandPayload(
      "visual.set_edge_label",
      { op: "visual.set_edge_label", edgeId: "", label: "Yes" },
      errors,
    );

    assert.deepEqual(errors, ["payload.edgeId must be a non-empty string."]);
  });

  it("reports only edge id errors for edge-toggle payloads with unsupported ids", () => {
    for (const op of [
      "visual.flip_edge",
      "visual.toggle_edge_directed",
      "visual.toggle_edge_style",
    ] as const) {
      const errors: string[] = [];

      validateVisualCommandPayload(op, { op, edgeId: "" }, errors);

      assert.deepEqual(
        errors,
        ["payload.edgeId must be a non-empty string."],
        op,
      );
    }
  });

  it("reports detailed validation errors for malformed payloads", () => {
    const cases: Array<{ payload: Record<string, unknown>; match: RegExp }> = [
      {
        payload: { op: "visual.apply_theme", themeId: "missing-theme" },
        match: /themeId is unknown/,
      },
      {
        payload: { op: "visual.set_style", patch: { palette: [] } },
        match: /palette must be a non-empty array/,
      },
      {
        payload: { op: "visual.set_style", patch: { unknown: true } },
        match: /payload\.patch\.unknown is not supported/,
      },
      {
        payload: {
          op: "visual.set_style",
          patch: {
            palette: ["#111111", 42],
            fontSize: 0,
            fontWeight: 0,
            extra: true,
          },
        },
        match:
          /palette must be a non-empty array[\s\S]*fontSize must be a positive number[\s\S]*fontWeight must be a positive number/,
      },
      {
        payload: { op: "visual.set_node_ext_style", nodeId: "", patch: 1 },
        match: /nodeId must be a non-empty string/,
      },
      {
        payload: {
          op: "visual.set_node_ext_style",
          nodeId: "n1",
          patch: {
            fillStyle: "pattern",
            borderStyle: "double",
            borderWidth: 0,
            textAlign: "justify",
            fontFamily: 7,
          },
        },
        match:
          /fillStyle must be one of[\s\S]*borderStyle must be one of[\s\S]*borderWidth must be a positive number[\s\S]*textAlign must be one of[\s\S]*fontFamily must be a string/,
      },
      {
        payload: {
          op: "visual.set_edge_style",
          edgeId: "",
          patch: { arrowStyle: "triangle", lineWidth: 0 },
        },
        match: /edgeId must be a non-empty string/,
      },
      {
        payload: {
          op: "visual.set_edge_style",
          edgeId: "e1",
          patch: null,
        },
        match: /payload\.patch must be an object/,
      },
      {
        payload: {
          op: "visual.set_edge_style",
          edgeId: "e1",
          patch: { lineStyle: "wavy", lineWidth: 0, extra: true },
        },
        match:
          /payload\.patch\.extra is not supported[\s\S]*lineStyle must be one of[\s\S]*lineWidth must be a positive number/,
      },
      {
        payload: {
          op: "visual.set_effect",
          effect: null,
        },
        match: /effect must be an object/,
      },
      {
        payload: {
          op: "visual.set_effect",
          effect: { kind: "glow" },
        },
        match: /kind must be one of/,
      },
      {
        payload: {
          op: "visual.set_effect",
          effect: { kind: "shadow", blur: -1 },
        },
        match: /blur must be a non-negative number/,
      },
      {
        payload: {
          op: "visual.set_effect",
          effect: { kind: "shadow", dx: Number.NaN, dy: Infinity, color: 123 },
        },
        match:
          /dx must be a finite number[\s\S]*dy must be a finite number[\s\S]*color must be a string/,
      },
      {
        payload: {
          op: "visual.set_effect",
          effect: { kind: "sketch", frequency: 0, scale: -1 },
        },
        match:
          /frequency must be a positive number[\s\S]*scale must be a non-negative number/,
      },
      {
        payload: { op: "visual.apply_display_style", styleId: "missing-style" },
        match: /styleId is unknown/,
      },
      {
        payload: { op: "visual.set_kind", kind: "spreadsheet" },
        match: /kind must be a supported visual kind/,
      },
      {
        payload: { op: "visual.set_canvas_style", canvasStyle: "lined" },
        match: /canvasStyle must be one of/,
      },
      {
        payload: { op: "visual.set_aspect_ratio", preset: "cinematic" },
        match: /preset must be one of/,
      },
      {
        payload: { op: "visual.set_auto_layout", enabled: "yes" },
        match: /enabled must be a boolean/,
      },
      {
        payload: {
          op: "visual.set_node_style",
          nodeId: "n1",
          field: "fill",
          value: 42,
        },
        match: /field must be one of[\s\S]*value must be a string/,
      },
      {
        payload: { op: "visual.set_node_style", nodeId: "", field: "color" },
        match: /nodeId must be a non-empty string[\s\S]*value must be a string/,
      },
      {
        payload: { op: "visual.set_node_label", nodeId: "n1", label: 42 },
        match: /label must be a string/,
      },
      {
        payload: { op: "visual.set_edge_label", edgeId: "", label: 42 },
        match: /edgeId must be a non-empty string[\s\S]*label must be a string/,
      },
      {
        payload: { op: "visual.clear_node_icon", nodeId: "" },
        match: /nodeId must be a non-empty string/,
      },
      {
        payload: { op: "visual.reset_node_style", nodeId: "", extra: true },
        match:
          /payload\.extra is not supported[\s\S]*nodeId must be a non-empty string/,
      },
      {
        payload: { op: "visual.reset_node_ext_style", nodeId: 42 },
        match: /nodeId must be a non-empty string/,
      },
      {
        payload: { op: "visual.set_node_icon", nodeId: "n1", icon: "" },
        match: /icon must be a non-empty string/,
      },
      {
        payload: { op: "visual.flip_edge", edgeId: "" },
        match: /edgeId must be a non-empty string/,
      },
      {
        payload: { op: "visual.toggle_edge_directed", edgeId: "" },
        match: /edgeId must be a non-empty string/,
      },
      {
        payload: { op: "visual.toggle_edge_style", edgeId: "" },
        match: /edgeId must be a non-empty string/,
      },
      {
        payload: { op: "visual.clear_effect", kind: "glow" },
        match: /kind must be one of/,
      },
      {
        payload: { op: "visual.merge_content", newVisual: { not: "visual" } },
        match: /schema-valid visual/,
      },
      {
        payload: { op: "visual.add_node", node: null },
        match: /node must be an object/,
      },
      {
        payload: { op: "visual.reconnect_edge", edgeId: "" },
        match: /edgeId must be a non-empty string/,
      },
      {
        payload: { op: "visual.add_edge", edge: null },
        match: /edge must be an object/,
      },
      {
        payload: { op: "visual.delete_node", nodeId: "" },
        match: /nodeId must be a non-empty string/,
      },
    ];

    for (const entry of cases) {
      const errors: string[] = [];
      validateVisualCommandPayload(
        String(entry.payload.op),
        entry.payload,
        errors,
      );
      assert.match(errors.join(" "), entry.match, String(entry.payload.op));
    }
  });
});

describe("visual command metadata coalescing", () => {
  it("exposes affected ids for node and edge targeted operations", () => {
    assert.deepEqual(
      getVisualCommandMetadata("visual.set_node_label")?.affectedIds({
        op: "visual.set_node_label",
        nodeId: "n1",
        label: "Renamed",
      }),
      { nodeIds: ["n1"], edgeIds: [] },
    );
    assert.deepEqual(
      getVisualCommandMetadata("visual.set_edge_label")?.affectedIds({
        op: "visual.set_edge_label",
        edgeId: "e1",
        label: "Yes",
      }),
      { nodeIds: [], edgeIds: ["e1"] },
    );
    assert.deepEqual(
      getVisualCommandMetadata("visual.delete_edge")?.affectedIds({
        op: "visual.delete_edge",
        edgeId: "edge-delete",
      }),
      { nodeIds: [], edgeIds: ["edge-delete"] },
    );
    assert.deepEqual(
      getVisualCommandMetadata("visual.delete_edge")?.affectedIds({
        op: "visual.relayout_graph",
      } as never),
      { nodeIds: [], edgeIds: [] },
    );
    assert.deepEqual(
      getVisualCommandMetadata("visual.flip_edge")?.affectedIds({
        op: "visual.flip_edge",
        edgeId: "edge-flip",
      }),
      { nodeIds: [], edgeIds: ["edge-flip"] },
    );
    assert.deepEqual(
      getVisualCommandMetadata("visual.reconnect_edge")?.affectedIds({
        op: "visual.reconnect_edge",
        edgeId: "edge-reconnect",
        fromNodeId: "from",
        toNodeId: "to",
      }),
      { nodeIds: [], edgeIds: ["edge-reconnect"] },
    );
    assert.deepEqual(
      getVisualCommandMetadata("visual.duplicate_node")?.affectedIds({
        op: "visual.duplicate_node",
        nodeId: "node-duplicate",
        newNodeId: "node-copy",
      }),
      { nodeIds: ["node-duplicate"], edgeIds: [] },
    );
    assert.equal(getVisualCommandMetadata("visual.unknown"), undefined);
  });

  it("marks effect and merge-content operations as visual-wide changes", () => {
    const visualWideOps = [
      "visual.set_effect",
      "visual.clear_effect",
      "visual.merge_content",
    ] as const;

    for (const op of visualWideOps) {
      const metadata = getVisualCommandMetadata(op);

      assert.equal(metadata?.coalescing.kind, "visual");
      assert.deepEqual(metadata?.affectedIds({ op } as VisualCommandPayload), {
        nodeIds: [],
        edgeIds: [],
      });
    }
  });

  it("exposes metadata contracts for reset, icon, and edge toggle operations", () => {
    const contracts = [
      ["visual.reset_node_style", { nodeId: "required" }, "node"],
      ["visual.reset_node_ext_style", { nodeId: "required" }, "node"],
      ["visual.set_node_icon", { nodeId: "required" }, "node"],
      ["visual.set_edge_label", { edgeId: "required" }, "edge"],
      ["visual.set_edge_style", { edgeId: "required" }, "edge"],
      ["visual.flip_edge", { edgeId: "required" }, "none"],
      ["visual.toggle_edge_directed", { edgeId: "required" }, "none"],
      ["visual.toggle_edge_style", { edgeId: "required" }, "none"],
    ] as const;

    for (const [op, target, kind] of contracts) {
      const metadata = getVisualCommandMetadata(op);

      assert.equal(metadata?.op, op);
      assert.deepEqual(metadata?.target, target);
      assert.equal(metadata?.coalescing.kind, kind);
      assert.equal(typeof metadata?.payloadValidator, "function");
      assert.equal(typeof metadata?.affectedIds, "function");
    }

    assert.deepEqual(
      getVisualCommandMetadata("visual.reset_node_ext_style")?.affectedIds({
        op: "visual.reset_node_ext_style",
        nodeId: "node-reset-ext",
      }),
      { nodeIds: ["node-reset-ext"], edgeIds: [] },
    );
    assert.deepEqual(
      getVisualCommandMetadata("visual.clear_node_icon")?.affectedIds({
        op: "visual.clear_node_icon",
        nodeId: "node-clear-icon",
      }),
      { nodeIds: ["node-clear-icon"], edgeIds: [] },
    );
    assert.deepEqual(
      getVisualCommandMetadata("visual.toggle_edge_directed")?.affectedIds({
        op: "visual.toggle_edge_directed",
        edgeId: "edge-directed",
      }),
      { nodeIds: [], edgeIds: ["edge-directed"] },
    );
    assert.deepEqual(
      getVisualCommandMetadata("visual.toggle_edge_style")?.affectedIds({
        op: "visual.toggle_edge_style",
        edgeId: "edge-style",
      }),
      { nodeIds: [], edgeIds: ["edge-style"] },
    );
    assert.equal(
      getVisualCommandMetadata("visual.merge_content")?.coalescing.kind,
      "visual",
    );
  });

  it("exposes visual-wide metadata for all-edges style updates", () => {
    const metadata = getVisualCommandMetadata("visual.set_all_edges_style");

    assert.equal(metadata?.op, "visual.set_all_edges_style");
    assert.deepEqual(metadata?.target, {});
    assert.equal(metadata?.coalescing.kind, "visual");
    assert.deepEqual(
      metadata?.affectedIds({
        op: "visual.set_all_edges_style",
        patch: { lineStyle: "dashed" },
      }),
      { nodeIds: [], edgeIds: [] },
    );
  });

  it("coalesces only matching visual command targets", () => {
    const first = makeVisualCommand(
      { op: "visual.set_node_label", nodeId: "n1", label: "A" },
      { coalesceKey: "label:n1" },
    );
    const second = makeVisualCommand(
      { op: "visual.set_node_label", nodeId: "n1", label: "B" },
      { coalesceKey: "label:n1" },
    );
    const differentNode = makeVisualCommand(
      { op: "visual.set_node_label", nodeId: "n2", label: "B" },
      { coalesceKey: "label:n1" },
    );
    const noCoalesce = makeVisualCommand(
      { op: "visual.flip_edge", edgeId: "e1" },
      { coalesceKey: "edge:e1" },
    );
    const nodeStyle = makeVisualCommand(
      {
        op: "visual.set_node_style",
        nodeId: "n1",
        field: "color",
        value: "#111111",
      },
      { coalesceKey: "node-style:n1:color" },
    );
    const sameNodeStyle = makeVisualCommand(
      {
        op: "visual.set_node_style",
        nodeId: "n1",
        field: "color",
        value: "#222222",
      },
      { coalesceKey: "node-style:n1:color" },
    );
    const differentField = makeVisualCommand(
      {
        op: "visual.set_node_style",
        nodeId: "n1",
        field: "stroke",
        value: "#222222",
      },
      { coalesceKey: "node-style:n1:color" },
    );
    const visualStyle = makeVisualCommand(
      { op: "visual.set_style", patch: { background: "#111111" } },
      { coalesceKey: "visual-style" },
    );
    const sameVisualStyle = makeVisualCommand(
      { op: "visual.set_style", patch: { background: "#222222" } },
      { coalesceKey: "visual-style" },
    );
    const differentActor = makeVisualCommand(
      { op: "visual.set_node_label", nodeId: "n1", label: "C" },
      { coalesceKey: "label:n1", actor: { id: "other" } },
    );

    assert.equal(canCoalesceVisualCommands(first, second), true);
    assert.equal(canCoalesceVisualCommands(first, differentNode), false);
    assert.equal(canCoalesceVisualCommands(noCoalesce, noCoalesce), false);
    assert.equal(canCoalesceVisualCommands(nodeStyle, sameNodeStyle), true);
    assert.equal(canCoalesceVisualCommands(nodeStyle, differentField), false);
    assert.equal(canCoalesceVisualCommands(visualStyle, sameVisualStyle), true);
    assert.equal(canCoalesceVisualCommands(first, differentActor), false);
  });

  it("merges patch-style payloads and carries the newer command timestamp", () => {
    assert.deepEqual(
      mergeVisualCommandPayload(
        { op: "visual.set_style", patch: { fontSize: 12, nodeFill: "#fff" } },
        { op: "visual.set_style", patch: { fontSize: 18 } },
      ),
      { op: "visual.set_style", patch: { fontSize: 18, nodeFill: "#fff" } },
    );

    const first = makeVisualCommand(
      {
        op: "visual.set_edge_style",
        edgeId: "e1",
        patch: { lineStyle: "solid" },
      },
      { timestamp: "2026-06-28T00:00:00.000Z" },
    );
    const second = makeVisualCommand(
      {
        op: "visual.set_edge_style",
        edgeId: "e1",
        patch: { lineWidth: 3 },
      },
      { timestamp: "2026-06-28T00:01:00.000Z" },
    );

    const merged = mergeVisualCommands(first, second);

    assert.equal(merged.timestamp, "2026-06-28T00:01:00.000Z");
    assert.deepEqual(merged.payload, {
      op: "visual.set_edge_style",
      edgeId: "e1",
      patch: { lineStyle: "solid", lineWidth: 3 },
    });

    assert.deepEqual(
      mergeVisualCommandPayload(
        {
          op: "visual.set_node_ext_style",
          nodeId: "n1",
          patch: { fillStyle: "solid" },
        },
        {
          op: "visual.set_node_ext_style",
          nodeId: "n1",
          patch: { textAlign: "right" },
        },
      ),
      {
        op: "visual.set_node_ext_style",
        nodeId: "n1",
        patch: { fillStyle: "solid", textAlign: "right" },
      },
    );
    assert.deepEqual(
      mergeVisualCommandPayload(
        {
          op: "visual.set_all_edges_style",
          patch: { lineStyle: "solid" },
        },
        {
          op: "visual.set_all_edges_style",
          patch: { lineWidth: 4 },
        },
      ),
      {
        op: "visual.set_all_edges_style",
        patch: { lineStyle: "solid", lineWidth: 4 },
      },
    );
    assert.deepEqual(
      mergeVisualCommandPayload(
        { op: "visual.set_style", patch: { background: "#fff" } },
        { op: "visual.relayout_graph" },
      ),
      { op: "visual.relayout_graph" },
    );
  });
});
