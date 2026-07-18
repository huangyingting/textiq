/**
 * Tests for src/lib/presentation/inspector-panel-ui.ts
 *
 * Covers the `availablePanels` panel routing for every node type documented
 * in the presentation slide editor UI spec (§3 "Right Properties Panel").
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  availablePanels,
  defaultPanelForNode,
  resolveInspectorPanelContinuity,
} from "@/lib/presentation/inspector-panel-ui";
import type { InspectorPanelId } from "@/lib/presentation/inspector-panel-ui";
import {
  buildTextNode,
  buildShapeNode,
  buildImageNode,
  buildTableNode,
} from "@/test/builders/presentation-deck";
import type { SlideChildNode } from "@/lib/presentation/schema";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function panelIds(
  node: SlideChildNode | null,
  opts?: {
    multiSelect?: boolean;
    isDecoration?: boolean;
    hasDiagnostics?: boolean;
  },
): InspectorPanelId[] {
  return availablePanels(node, opts).map((p) => p.id);
}

function resolvePanel(
  activePanel: InspectorPanelId | null | undefined,
  node: SlideChildNode | null,
  opts?: {
    multiSelect?: boolean;
    isDecoration?: boolean;
    hasDiagnostics?: boolean;
  },
): InspectorPanelId {
  return resolveInspectorPanelContinuity({
    activePanel,
    panels: availablePanels(node, opts),
    defaultPanel: defaultPanelForNode(node, opts?.isDecoration ?? false),
  });
}

// ---------------------------------------------------------------------------
// No selection (slide as current object)
// ---------------------------------------------------------------------------

describe("availablePanels — no selection", () => {
  test("returns slide, notes, layers for null node", () => {
    const ids = panelIds(null);
    assert.deepEqual(ids, ["slide", "notes", "layers"]);
  });
});

// ---------------------------------------------------------------------------
// Text node
// ---------------------------------------------------------------------------

describe("availablePanels — text node", () => {
  test("includes text, arrange, style, effects, source, layers", () => {
    const ids = panelIds(buildTextNode());
    assert.ok(ids.includes("text"), "should include text");
    assert.ok(ids.includes("arrange"), "should include arrange");
    assert.ok(ids.includes("effects"), "should include effects");
    assert.ok(ids.includes("source"), "should include source");
    assert.ok(ids.includes("layers"), "should include layers");
  });

  test("first panel is text", () => {
    assert.equal(panelIds(buildTextNode())[0], "text");
  });
});

// ---------------------------------------------------------------------------
// Shape node
// ---------------------------------------------------------------------------

describe("availablePanels — shape node", () => {
  test("includes shape, arrange, layers", () => {
    const ids = panelIds(buildShapeNode());
    assert.ok(ids.includes("shape"), "should include shape");
    assert.ok(ids.includes("arrange"), "should include arrange");
    assert.ok(ids.includes("layers"), "should include layers");
  });

  test("does not include 'text' panel when shape has no inline text", () => {
    const ids = panelIds(buildShapeNode());
    assert.equal(
      ids.includes("text"),
      false,
      "text panel should not appear for shape without text",
    );
  });
});

// ---------------------------------------------------------------------------
// Image node
// ---------------------------------------------------------------------------

describe("availablePanels — image node", () => {
  test("includes image, adjust, arrange, effects, source, layers", () => {
    const ids = panelIds(buildImageNode());
    assert.ok(ids.includes("image"), "should include image");
    assert.ok(ids.includes("adjust"), "should include adjust");
    assert.ok(ids.includes("arrange"), "should include arrange");
    assert.ok(ids.includes("effects"), "should include effects");
    assert.ok(ids.includes("source"), "should include source");
    assert.ok(ids.includes("layers"), "should include layers");
  });

  test("first panel is image", () => {
    assert.equal(panelIds(buildImageNode())[0], "image");
  });
});

// ---------------------------------------------------------------------------
// Visual node
// ---------------------------------------------------------------------------

describe("availablePanels — visual node", () => {
  test("includes visual, arrange, source, layers", () => {
    const visualNode: SlideChildNode = {
      id: "vis-001",
      type: "visual",
      layout: { frame: { x: 10, y: 10, w: 40, h: 40 }, zIndex: 1 },
      style: { ref: "chart.primary" },
      content: { visualId: "vis-abc" },
    };
    const ids = panelIds(visualNode);
    assert.ok(ids.includes("visual"), "should include visual");
    assert.ok(ids.includes("arrange"), "should include arrange");
    assert.ok(ids.includes("source"), "should include source");
    assert.ok(ids.includes("layers"), "should include layers");
  });
});

// ---------------------------------------------------------------------------
// Connector node
// ---------------------------------------------------------------------------

describe("availablePanels — connector node", () => {
  test("includes line, arrange, effects, layers (no source)", () => {
    const connectorNode: SlideChildNode = {
      id: "conn-001",
      type: "connector",
      layout: { frame: { x: 0, y: 0, w: 50, h: 50 }, zIndex: 1 },
      style: { ref: "connector.primary" },
      content: {
        from: { kind: "point", point: { x: 0, y: 0 } },
        to: { kind: "point", point: { x: 50, y: 50 } },
      },
    };
    const ids = panelIds(connectorNode);
    assert.ok(ids.includes("line"), "should include line");
    assert.ok(ids.includes("arrange"), "should include arrange");
    assert.ok(ids.includes("effects"), "should include effects");
    assert.ok(ids.includes("layers"), "should include layers");
    assert.equal(
      ids.includes("source"),
      false,
      "connector should not show source panel",
    );
  });

  test("first panel is line", () => {
    const connectorNode: SlideChildNode = {
      id: "conn-002",
      type: "connector",
      layout: { frame: { x: 0, y: 0, w: 20, h: 20 }, zIndex: 1 },
      style: { ref: "connector.primary" },
      content: {
        from: { kind: "point", point: { x: 0, y: 0 } },
        to: { kind: "point", point: { x: 20, y: 20 } },
      },
    };
    assert.equal(panelIds(connectorNode)[0], "line");
  });
});

// ---------------------------------------------------------------------------
// Table node
// ---------------------------------------------------------------------------

describe("availablePanels — table node", () => {
  test("includes table, arrange, effects, source, layers", () => {
    const ids = panelIds(buildTableNode());
    assert.ok(ids.includes("table"), "should include table");
    assert.ok(ids.includes("arrange"), "should include arrange");
    assert.ok(ids.includes("effects"), "should include effects");
    assert.ok(ids.includes("source"), "should include source");
    assert.ok(ids.includes("layers"), "should include layers");
  });
});

// ---------------------------------------------------------------------------
// Group node
// ---------------------------------------------------------------------------

describe("availablePanels — group node", () => {
  test("includes only arrange and layers because group paint is nonvisual", () => {
    const groupNode: SlideChildNode = {
      id: "grp-001",
      type: "group",
      component: "custom",
      layout: { frame: { x: 5, y: 5, w: 50, h: 50 }, zIndex: 10 },
      children: [],
    };
    const ids = panelIds(groupNode);
    assert.deepEqual(ids, ["arrange", "layers"]);
    assert.equal(ids.includes("text"), false);
    assert.equal(ids.includes("shape"), false);
  });
});

// ---------------------------------------------------------------------------
// Multi-selection
// ---------------------------------------------------------------------------

describe("availablePanels — multi-select", () => {
  test("returns arrange, effects, layers regardless of node type", () => {
    const ids = panelIds(buildTextNode(), { multiSelect: true });
    assert.deepEqual(ids.slice(0, 3), ["arrange", "effects", "layers"]);
    assert.equal(ids.includes("text"), false);
  });

  test("first panel is arrange", () => {
    assert.equal(panelIds(null, { multiSelect: true })[0], "arrange");
  });
});

// ---------------------------------------------------------------------------
// Decoration node (layers mode)
// ---------------------------------------------------------------------------

describe("availablePanels — decoration node", () => {
  test("returns decoration, arrange, layers when isDecoration=true", () => {
    const ids = panelIds(buildShapeNode(), { isDecoration: true });
    assert.deepEqual(ids.slice(0, 3), ["decoration", "arrange", "layers"]);
  });

  test("first panel is decoration", () => {
    assert.equal(
      panelIds(buildShapeNode(), { isDecoration: true })[0],
      "decoration",
    );
  });
});

// ---------------------------------------------------------------------------
// Diagnostics badge
// ---------------------------------------------------------------------------

describe("availablePanels — diagnostics flag", () => {
  test("appends diagnostics panel when hasDiagnostics=true and not already present", () => {
    const ids = panelIds(buildTextNode(), { hasDiagnostics: true });
    assert.equal(ids[ids.length - 1], "diagnostics");
  });

  test("does not duplicate diagnostics when already present", () => {
    const ids = panelIds(buildTextNode(), { hasDiagnostics: true });
    const count = ids.filter((id) => id === "diagnostics").length;
    assert.equal(count, 1);
  });

  test("no diagnostics panel without flag", () => {
    const ids = panelIds(buildTextNode());
    assert.equal(ids.includes("diagnostics"), false);
  });
});

// ---------------------------------------------------------------------------
// Inspector panel continuity
// ---------------------------------------------------------------------------

describe("resolveInspectorPanelContinuity", () => {
  test("preserves a compatible panel when selection changes", () => {
    assert.equal(resolvePanel("style", buildTextNode()), "style");
    assert.equal(resolvePanel("style", buildShapeNode()), "style");
  });

  test("replaces an incompatible panel with the selected object's default panel", () => {
    assert.equal(resolvePanel("text", buildShapeNode()), "shape");
    assert.equal(resolvePanel("shape", buildImageNode()), "image");
  });

  test("falls back to the common arrange panel for incompatible multi-selection", () => {
    assert.equal(
      resolvePanel("text", buildTextNode(), { multiSelect: true }),
      "arrange",
    );
  });

  test("closes object-specific panels when no object is selected", () => {
    assert.equal(resolvePanel("shape", null), "slide");
  });
});

// ---------------------------------------------------------------------------
// defaultPanelForNode
// ---------------------------------------------------------------------------

describe("defaultPanelForNode", () => {
  test("returns slide for null node (no selection)", () => {
    assert.equal(defaultPanelForNode(null, false), "slide");
  });

  test("returns decoration for any decoration node", () => {
    assert.equal(defaultPanelForNode(buildShapeNode(), true), "decoration");
  });

  test("returns text for text node", () => {
    assert.equal(defaultPanelForNode(buildTextNode(), false), "text");
  });

  test("returns shape for shape node", () => {
    assert.equal(defaultPanelForNode(buildShapeNode(), false), "shape");
  });

  test("returns image for image node", () => {
    assert.equal(defaultPanelForNode(buildImageNode(), false), "image");
  });

  test("returns arrange for group node", () => {
    const groupNode: SlideChildNode = {
      id: "grp-001",
      type: "group",
      component: "custom",
      layout: { frame: { x: 5, y: 5, w: 50, h: 50 }, zIndex: 1 },
      children: [],
    };
    assert.equal(defaultPanelForNode(groupNode, false), "arrange");
  });

  test("returns line for connector node", () => {
    const connectorNode: SlideChildNode = {
      id: "conn-001",
      type: "connector",
      layout: { frame: { x: 0, y: 0, w: 20, h: 20 }, zIndex: 1 },
      style: { ref: "connector.primary" },
      content: {
        from: { kind: "point", point: { x: 0, y: 0 } },
        to: { kind: "point", point: { x: 20, y: 20 } },
      },
    };
    assert.equal(defaultPanelForNode(connectorNode, false), "line");
  });

  test("returns visual for visual node", () => {
    const visualNode: SlideChildNode = {
      id: "vis-001",
      type: "visual",
      layout: { frame: { x: 10, y: 10, w: 40, h: 40 }, zIndex: 1 },
      style: { ref: "chart.primary" },
      content: { visualId: "v-1" },
    };
    assert.equal(defaultPanelForNode(visualNode, false), "visual");
  });

  test("returns table for table node", () => {
    assert.equal(defaultPanelForNode(buildTableNode(), false), "table");
  });
});
