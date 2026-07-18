import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  LayoutBox,
  SlideChildNode,
  ConnectorNode,
  ShapeNode,
  TextNode,
} from "./schema";
import { hitTestSlideNodes } from "./stage-hit-test";

function frame(x: number, y: number, w: number, h: number): LayoutBox["frame"] {
  return { x, y, w, h };
}

function textNode(
  id: string,
  zIndex: number,
  box: LayoutBox["frame"],
  text = "Revenue",
): TextNode {
  return {
    id,
    type: "text",
    role: "body",
    layout: { frame: box, zIndex },
    style: { ref: "text.body" },
    content: {
      paragraphs: [{ id: `${id}-p`, text }],
    },
  };
}

function rectNode(
  id: string,
  zIndex: number,
  box: LayoutBox["frame"],
): ShapeNode {
  return {
    id,
    type: "shape",
    role: "card",
    layout: { frame: box, zIndex },
    style: { ref: "surface.card" },
    content: { shape: "rect" },
  };
}

function connectorNode(
  id: string,
  zIndex: number,
  box: LayoutBox["frame"],
): ConnectorNode {
  return {
    id,
    type: "connector",
    role: "connector",
    layout: { frame: box, zIndex },
    style: { ref: "connector.primary" },
    content: {
      from: { kind: "point", point: { x: 0, y: 50 } },
      to: { kind: "point", point: { x: 100, y: 50 } },
      routing: "straight",
    },
  };
}

test("hitTestSlideNodes prefers covered text content over large covering shapes", () => {
  const nodes: SlideChildNode[] = [
    textNode("covered-text", 0, frame(10, 40, 80, 20), "Revenue"),
    rectNode("large-cover", 20, frame(0, 0, 100, 100)),
  ];

  const hits = hitTestSlideNodes({ x: 12, y: 50 }, nodes, {
    includeLocked: true,
  });

  assert.equal(hits[0]?.node.id, "covered-text");
  assert.equal(hits[0]?.reason, "text-content");
});

test("hitTestSlideNodes prefers shape edges over covered text", () => {
  const nodes: SlideChildNode[] = [
    textNode("covered-text", 0, frame(10, 40, 80, 20), "Revenue"),
    rectNode("large-cover", 20, frame(10, 30, 80, 40)),
  ];

  const hits = hitTestSlideNodes({ x: 10.5, y: 50 }, nodes, {
    includeLocked: true,
  });

  assert.equal(hits[0]?.node.id, "large-cover");
  assert.equal(hits[0]?.reason, "shape-edge");
});

test("hitTestSlideNodes keeps selected covering nodes sticky", () => {
  const nodes: SlideChildNode[] = [
    textNode("covered-text", 0, frame(10, 40, 80, 20), "Revenue"),
    rectNode("selected-cover", 20, frame(0, 0, 100, 100)),
  ];

  const hits = hitTestSlideNodes({ x: 12, y: 50 }, nodes, {
    includeLocked: true,
    selectedNodeIds: new Set(["selected-cover"]),
  });

  assert.equal(hits[0]?.node.id, "selected-cover");
});

test("hitTestSlideNodes visual order uses z-index with stable source ties", () => {
  const nodes: SlideChildNode[] = [
    textNode("earlier-high-z", 500, frame(10, 40, 80, 20), "Revenue"),
    rectNode("later-low-z", -500, frame(0, 0, 100, 100)),
    rectNode("equal-order-later", -500, frame(0, 0, 100, 100)),
  ];

  const hits = hitTestSlideNodes({ x: 12, y: 50 }, nodes, {
    includeLocked: true,
    order: "visual",
  });

  assert.deepEqual(
    hits.map((hit) => hit.node.id),
    ["earlier-high-z", "equal-order-later", "later-low-z"],
  );
});

test("hitTestSlideNodes keeps nested siblings inside their parent stacking context", () => {
  const backGroup: SlideChildNode = {
    id: "back-group",
    type: "group",
    component: "custom",
    layout: { frame: frame(0, 0, 100, 100), zIndex: 10 },
    children: [
      rectNode("group-low", -100, frame(0, 0, 100, 100)),
      rectNode("group-high", 1000, frame(0, 0, 100, 100)),
    ],
  };
  const frontSibling = rectNode("front-sibling", 20, frame(0, 0, 100, 100));

  assert.deepEqual(
    hitTestSlideNodes({ x: 50, y: 50 }, [backGroup, frontSibling], {
      includeLocked: true,
      order: "visual",
    }).map((hit) => hit.node.id),
    ["front-sibling", "group-high", "group-low", "back-group"],
  );
});

test("hitTestSlideNodes visual selection filters hidden and locked nodes", () => {
  const hidden = {
    ...rectNode("hidden", 30, frame(0, 0, 100, 100)),
    hidden: true,
  };
  const locked = {
    ...rectNode("locked", 20, frame(0, 0, 100, 100)),
    locked: true,
  };
  const selectable = rectNode("selectable", 10, frame(0, 0, 100, 100));

  assert.deepEqual(
    hitTestSlideNodes({ x: 50, y: 50 }, [selectable, locked, hidden], {
      order: "visual",
    }).map((hit) => hit.node.id),
    ["selectable"],
  );
});

test("hitTestSlideNodes prunes visible children of hidden groups", () => {
  const hiddenGroup: SlideChildNode = {
    id: "hidden-group",
    type: "group",
    component: "custom",
    hidden: true,
    layout: { frame: frame(0, 0, 100, 100), zIndex: 20 },
    children: [rectNode("visible-child", 30, frame(0, 0, 100, 100))],
  };
  const visibleSibling = rectNode("visible-sibling", 10, frame(0, 0, 100, 100));

  assert.deepEqual(
    hitTestSlideNodes({ x: 50, y: 50 }, [visibleSibling, hiddenGroup], {
      includeLocked: true,
      order: "visual",
    }).map((hit) => hit.node.id),
    ["visible-sibling"],
  );
});

test("hitTestSlideNodes prunes descendants beneath nested hidden ancestors", () => {
  const outerGroup: SlideChildNode = {
    id: "outer-group",
    type: "group",
    component: "custom",
    layout: { frame: frame(0, 0, 100, 100), zIndex: 10 },
    children: [
      {
        id: "hidden-inner-group",
        type: "group",
        component: "custom",
        hidden: true,
        layout: { frame: frame(0, 0, 100, 100), zIndex: 20 },
        children: [rectNode("nested-visible-child", 30, frame(0, 0, 100, 100))],
      },
    ],
  };

  const hitIds = hitTestSlideNodes({ x: 50, y: 50 }, [outerGroup], {
    includeLocked: true,
    order: "visual",
  }).map((hit) => hit.node.id);

  assert.deepEqual(hitIds, ["outer-group"]);
  assert.equal(hitIds.includes("nested-visible-child"), false);
});

test("hitTestSlideNodes restores normal visual order when a group is unhidden", () => {
  const group: SlideChildNode = {
    id: "group",
    type: "group",
    component: "custom",
    hidden: true,
    layout: { frame: frame(0, 0, 100, 100), zIndex: 10 },
    children: [rectNode("child", 20, frame(0, 0, 100, 100))],
  };

  assert.deepEqual(
    hitTestSlideNodes({ x: 50, y: 50 }, [group], {
      includeLocked: true,
      order: "visual",
    }),
    [],
  );
  assert.deepEqual(
    hitTestSlideNodes({ x: 50, y: 50 }, [{ ...group, hidden: false }], {
      includeLocked: true,
      order: "visual",
    }).map((hit) => hit.node.id),
    ["child", "group"],
  );
});

test("hitTestSlideNodes keeps unlocked children interactive beneath locked groups", () => {
  const lockedGroup: SlideChildNode = {
    id: "locked-group",
    type: "group",
    component: "custom",
    locked: true,
    layout: { frame: frame(0, 0, 100, 100), zIndex: 10 },
    children: [rectNode("unlocked-child", 20, frame(0, 0, 100, 100))],
  };

  assert.deepEqual(
    hitTestSlideNodes({ x: 50, y: 50 }, [lockedGroup], {
      order: "visual",
    }).map((hit) => hit.node.id),
    ["unlocked-child"],
  );
});

test("hitTestSlideNodes can ignore selected bonus for hover preselection", () => {
  const nodes: SlideChildNode[] = [
    textNode("covered-text", 0, frame(10, 40, 80, 20), "Revenue"),
    rectNode("selected-cover", 20, frame(0, 0, 100, 100)),
  ];

  const hits = hitTestSlideNodes({ x: 12, y: 50 }, nodes, {
    includeLocked: true,
    selectedNodeBonus: false,
    selectedNodeIds: new Set(["selected-cover"]),
  });

  assert.equal(hits[0]?.node.id, "covered-text");
});

test("hitTestSlideNodes hits connector strokes with tolerance", () => {
  const nodes: SlideChildNode[] = [
    rectNode("background", 0, frame(0, 0, 100, 100)),
    connectorNode("connector", 10, frame(10, 45, 80, 10)),
  ];

  assert.equal(
    hitTestSlideNodes({ x: 50, y: 50 }, nodes, { includeLocked: true })[0]?.node
      .id,
    "connector",
  );
  assert.equal(
    hitTestSlideNodes({ x: 50, y: 70 }, nodes, { includeLocked: true })[0]?.node
      .id,
    "background",
  );
});

test("hitTestSlideNodes includes group containers behind their children", () => {
  const group: SlideChildNode = {
    id: "group",
    type: "group",
    component: "custom",
    layout: { frame: frame(10, 10, 60, 40), zIndex: 5 },
    children: [textNode("group-child", 10, frame(20, 20, 20, 10), "Child")],
  };

  const childHits = hitTestSlideNodes({ x: 25, y: 25 }, [group], {
    includeLocked: true,
  });

  const emptyGroupHits = hitTestSlideNodes({ x: 65, y: 45 }, [group], {
    includeLocked: true,
  });
  const selectedGroupHits = hitTestSlideNodes({ x: 25, y: 25 }, [group], {
    includeLocked: true,
    selectedNodeIds: new Set(["group"]),
  });

  assert.equal(childHits[0]?.node.id, "group-child");
  assert.ok(childHits.some((hit) => hit.node.id === "group"));
  assert.equal(emptyGroupHits[0]?.node.id, "group");
  assert.equal(selectedGroupHits[0]?.node.id, "group");
});

test("visual hit order reverses canonical nested renderer traversal", () => {
  const nestedGroup: SlideChildNode = {
    id: "nested-group",
    type: "group",
    component: "custom",
    layout: { frame: frame(0, 0, 100, 100), zIndex: 500 },
    children: [
      rectNode("nested-first-high-z", 900, frame(0, 0, 100, 100)),
      {
        id: "inner-group-low-z",
        type: "group",
        component: "custom",
        layout: { frame: frame(0, 0, 100, 100), zIndex: -900 },
        children: [rectNode("nested-foreground", -1000, frame(0, 0, 100, 100))],
      },
    ],
  };
  const laterSibling = rectNode(
    "later-sibling-low-z",
    -2000,
    frame(0, 0, 100, 100),
  );

  const hits = hitTestSlideNodes(
    { x: 50, y: 50 },
    [nestedGroup, laterSibling],
    { includeLocked: true, order: "visual" },
  );

  assert.deepEqual(
    hits.map((hit) => hit.node.id),
    [
      "nested-first-high-z",
      "nested-foreground",
      "inner-group-low-z",
      "nested-group",
      "later-sibling-low-z",
    ],
  );
});

test("hitTestSlideNodes prefers grouped box children over their parent group for hover", () => {
  const imageChild: SlideChildNode = {
    id: "group-image-child",
    type: "image",
    role: "image",
    layout: { frame: frame(20, 20, 20, 10), zIndex: 1 },
    style: { ref: "media.inline" },
    content: { assetId: "image-1" },
  };
  const group: SlideChildNode = {
    id: "group",
    type: "group",
    component: "custom",
    layout: { frame: frame(10, 10, 60, 40), zIndex: 20 },
    children: [imageChild],
  };

  const hits = hitTestSlideNodes({ x: 25, y: 25 }, [group], {
    includeLocked: true,
    selectedNodeIds: new Set(["group"]),
    selectedNodeBonus: false,
  });

  assert.equal(hits[0]?.node.id, "group-image-child");
  assert.ok(hits.some((hit) => hit.node.id === "group"));
});
