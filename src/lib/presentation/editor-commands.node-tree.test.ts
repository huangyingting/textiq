/**
 * Editor command node-tree tests.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  insertNode,
  pasteNodes,
  cutNodes,
  updateNodeAttributes,
  updateNodeLayouts,
  deleteNodes,
  duplicateNodes,
  reorderZIndex,
  groupNodes,
  ungroupNodes,
} from "@/lib/presentation/editor-commands";
import { resetBuilderCounter } from "@/test/builders/presentation-deck";
import type { LayoutBox, SlideChildNode } from "@/lib/presentation/schema";
import { hitTestSlideNodes } from "@/lib/presentation/stage-hit-test";
import { openDeckFromJson } from "@/lib/presentation/open-deck";
import { buildLayerReorderPatches } from "@/lib/presentation/node-tree-ops";
import { makeTestDeck, findNode } from "./editor-commands.test-utils";

describe("updateNodeAttributes", () => {
  test("renames a node and can clear the custom name", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const nodeId = slide.children[0].id;

    const renamed = updateNodeAttributes(deck, slide.id, nodeId, {
      name: "Renamed from layers",
    });
    const renamedNode = findNode(renamed.slides[0].children, nodeId);
    assert.equal(renamedNode?.name, "Renamed from layers");

    const cleared = updateNodeAttributes(renamed, slide.id, nodeId, {
      name: undefined,
    });
    const clearedNode = findNode(cleared.slides[0].children, nodeId);
    assert.equal(clearedNode?.name, undefined);
  });
});

describe("insertNode and pasteNodes", () => {
  test("insertNode appends a presentation node to the target slide", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const result = insertNode(deck, slide.id, {
      id: "inserted-text",
      type: "text",
      role: "body",
      layout: { frame: { x: 12, y: 12, w: 30, h: 12 }, zIndex: 50 },
      style: { ref: "text.body" },
      content: { paragraphs: [{ id: "p1", text: "Inserted" }] },
    });

    assert.equal(result.nodeId, "inserted-text");
    assert.equal(result.deck.slides[0].children.at(-1)?.id, "inserted-text");
    assert.equal(
      result.deck.slides[0].children.at(-1)?.layout?.zIndex,
      Math.max(...slide.children.map((node) => node.layout?.zIndex ?? 0)) + 1,
    );
  });

  test("appended insertion is foreground even with a stale lower z-index", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const existing = slide.children[0];
    assert.ok(existing.layout);
    const overlappingDeck = {
      ...deck,
      slides: [
        {
          ...slide,
          children: [
            {
              ...existing,
              layout: { ...existing.layout, zIndex: 900 },
            } as SlideChildNode,
          ],
        },
      ],
    };
    const result = insertNode(overlappingDeck, slide.id, {
      id: "inserted-foreground",
      type: "text",
      role: "body",
      layout: { ...existing.layout, zIndex: -900 },
      style: { ref: "text.body" },
      content: {
        paragraphs: [{ id: "inserted-foreground-p", text: "Foreground" }],
      },
    });
    const frame = existing.layout.frame;

    const hits = hitTestSlideNodes(
      { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 },
      result.deck.slides[0].children,
      { includeLocked: true, order: "visual" },
    );

    assert.equal(hits[0]?.node.id, "inserted-foreground");
    assert.ok(
      (findNode(result.deck.slides[0].children, "inserted-foreground")?.layout
        ?.zIndex ?? 0) > 900,
    );
  });

  test("insertNode re-identifies colliding nodes and ignores missing slides", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const source = slide.children[0];
    const inserted = insertNode(deck, slide.id, source);
    const missingSlide = insertNode(deck, "missing-slide", {
      id: "orphan-node",
      type: "text",
      role: "body",
      layout: { frame: { x: 0, y: 0, w: 10, h: 10 }, zIndex: 1 },
      style: { ref: "text.body" },
      content: { paragraphs: [{ id: "p1", text: "Orphan" }] },
    });

    assert.equal(inserted.nodeId, `${source.id}-copy`);
    assert.equal(
      inserted.deck.slides[0].children.at(-1)?.id,
      `${source.id}-copy`,
    );
    assert.equal(missingSlide.nodeId, "orphan-node");
    assert.strictEqual(missingSlide.deck.slides[0], deck.slides[0]);
  });

  test("pasteNodes re-identifies pasted nodes and offsets their frames", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const source = slide.children[0];
    const result = pasteNodes(deck, slide.id, [source]);
    const pasted = result.deck.slides[0].children.find(
      (node) => node.id === result.nodeIds[0],
    );

    assert.ok(pasted);
    assert.notEqual(pasted.id, source.id);
    assert.equal(pasted.layout?.frame.x, source.layout!.frame.x + 2);
    assert.equal(
      pasted.layout?.zIndex,
      Math.max(...slide.children.map((node) => node.layout?.zIndex ?? 0)) + 1,
    );
  });

  test("pasteNodes returns empty no-op result for empty input or missing slides", () => {
    const deck = makeTestDeck();
    const empty = pasteNodes(deck, deck.slides[0].id, []);
    const missingSlide = pasteNodes(deck, "missing-slide", [
      deck.slides[0].children[0],
    ]);

    assert.deepEqual(empty, { deck, nodeIds: [] });
    assert.deepEqual(missingSlide.nodeIds, [
      `${deck.slides[0].children[0].id}-copy`,
    ]);
    assert.strictEqual(missingSlide.deck.slides[0], deck.slides[0]);
  });
});

describe("cutNodes", () => {
  test("cuts selected nodes so they can be pasted back as new copies", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const selected = slide.children[0];
    const cut = cutNodes(deck, slide.id, [selected.id]);

    assert.deepEqual(
      cut.nodes.map((node) => node.id),
      [selected.id],
    );
    assert.equal(
      cut.deck.slides[0].children.some((node) => node.id === selected.id),
      false,
    );

    const pasted = pasteNodes(cut.deck, slide.id, cut.nodes);
    assert.equal(pasted.nodeIds.length, 1);
    assert.notEqual(pasted.nodeIds[0], selected.id);
    assert.equal(
      pasted.deck.slides[0].children.some(
        (node) => node.id === pasted.nodeIds[0],
      ),
      true,
    );
  });

  test("preserves delete behavior by using the same delete output", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const selectedId = slide.children[0].id;
    const cut = cutNodes(deck, slide.id, [selectedId]);
    const deleted = deleteNodes(deck, slide.id, [selectedId]);

    assert.deepEqual(cut.deck, deleted);
  });
});

describe("deleteNodes", () => {
  test("removes selected nodes from a slide", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const nodeId = slide.children[0].id;
    const updated = deleteNodes(deck, slide.id, [nodeId]);

    assert.equal(
      updated.slides[0].children.some((node) => node.id === nodeId),
      false,
    );
  });

  test("deleteNodes no-ops for empty selection and expands group deletion", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const group = groupNodes(
      deck,
      slide.id,
      slide.children.map((node) => node.id),
      "delete-group",
    );
    const empty = deleteNodes(deck, slide.id, []);
    const deletedGroup = deleteNodes(group, slide.id, ["delete-group"]);

    assert.strictEqual(empty, deck);
    assert.equal(deletedGroup.slides[0].children.length, 0);
  });

  test("repairs connector node bindings before deleting target nodes", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const target = slide.children[0];
    const connector: SlideChildNode = {
      id: "connector-bound",
      type: "connector",
      role: "connector",
      layout: { frame: { x: 0, y: 0, w: 100, h: 100 }, zIndex: 99 },
      style: { ref: "connector.primary" },
      content: {
        from: { kind: "node", nodeId: target.id, anchor: "right" },
        to: { kind: "point", point: { x: 100, y: 50 } },
      },
    };
    const withConnector = {
      ...deck,
      slides: deck.slides.map((candidate) =>
        candidate.id === slide.id
          ? { ...candidate, children: [...candidate.children, connector] }
          : candidate,
      ),
    };

    const updated = deleteNodes(withConnector, slide.id, [target.id]);
    const repaired = findNode(updated.slides[0].children, "connector-bound");

    assert.equal(repaired?.type, "connector");
    if (repaired?.type === "connector") {
      assert.deepEqual(repaired.content.from, {
        kind: "point",
        point: {
          x: target.layout!.frame.x + target.layout!.frame.w,
          y: target.layout!.frame.y + target.layout!.frame.h / 2,
        },
      });
    }
  });

  test("clamps repaired connector endpoints into point percent bounds", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const target: SlideChildNode = {
      id: "far-target",
      type: "text",
      role: "body",
      layout: { frame: { x: 80, y: 80, w: 10, h: 10 }, zIndex: 2 },
      style: { ref: "text.body" },
      content: { paragraphs: [{ id: "far-target-p1", text: "Far" }] },
    };
    const connector: SlideChildNode = {
      id: "small-connector",
      type: "connector",
      role: "connector",
      layout: { frame: { x: 0, y: 0, w: 20, h: 20 }, zIndex: 99 },
      style: { ref: "connector.primary" },
      content: {
        from: { kind: "node", nodeId: target.id, anchor: "right" },
        to: { kind: "point", point: { x: 100, y: 50 } },
      },
    };
    const withConnector = {
      ...deck,
      slides: deck.slides.map((candidate) =>
        candidate.id === slide.id
          ? {
              ...candidate,
              children: [...candidate.children, target, connector],
            }
          : candidate,
      ),
    };

    const updated = deleteNodes(withConnector, slide.id, [target.id]);
    const repaired = findNode(updated.slides[0].children, "small-connector");

    assert.equal(repaired?.type, "connector");
    if (repaired?.type === "connector") {
      assert.deepEqual(repaired.content.from, {
        kind: "point",
        point: { x: 100, y: 100 },
      });
    }
  });
});

describe("duplicateNodes", () => {
  test("duplicates selected top-level nodes with new ids and offset frames", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const node = slide.children[0];
    const result = duplicateNodes(deck, slide.id, [node.id]);

    assert.equal(
      result.deck.slides[0].children.length,
      slide.children.length + 1,
    );
    assert.equal(result.duplicatedIds.length, 1);
    const duplicated = result.deck.slides[0].children.find(
      (candidate) => candidate.id === result.duplicatedIds[0],
    );
    assert.ok(duplicated);
    assert.equal(duplicated.layout?.frame.x, node.layout!.frame.x + 2);
  });

  test("duplicates selected group children inside their group scope", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const child: SlideChildNode = {
      id: "group-child",
      type: "text",
      role: "body",
      layout: { frame: { x: 10, y: 10, w: 20, h: 8 }, zIndex: 1 },
      style: { ref: "text.body" },
      content: { paragraphs: [{ id: "group-child-p1", text: "Inside" }] },
    };
    const group: SlideChildNode = {
      id: "group-node",
      type: "group",
      component: "custom",
      layout: { frame: { x: 8, y: 8, w: 30, h: 20 }, zIndex: 10 },
      children: [child],
    };
    const withGroup = {
      ...deck,
      slides: deck.slides.map((candidate) =>
        candidate.id === slide.id
          ? { ...candidate, children: [...candidate.children, group] }
          : candidate,
      ),
    };

    const result = duplicateNodes(withGroup, slide.id, [child.id]);
    const updatedGroup = findNode(result.deck.slides[0].children, group.id);

    assert.equal(result.duplicatedIds.length, 1);
    assert.equal(updatedGroup?.type, "group");
    if (updatedGroup?.type === "group") {
      assert.deepEqual(
        updatedGroup.children.map((node) => node.id),
        [child.id, result.duplicatedIds[0]],
      );
      assert.ok(
        (updatedGroup.children[1]?.layout?.zIndex ?? 0) >
          (updatedGroup.children[0]?.layout?.zIndex ?? 0),
      );
    }
  });

  test("duplicateNodes no-ops for empty, missing slide, and missing node selections", () => {
    const deck = makeTestDeck();

    assert.deepEqual(duplicateNodes(deck, deck.slides[0].id, []), {
      deck,
      duplicatedIds: [],
    });
    assert.deepEqual(duplicateNodes(deck, "missing-slide", ["text-1"]), {
      deck,
      duplicatedIds: [],
    });
    assert.deepEqual(
      duplicateNodes(deck, deck.slides[0].id, ["missing-node"]),
      {
        deck,
        duplicatedIds: [],
      },
    );
  });
});

test("z-index changes survive JSON serialization and deck reload", () => {
  const deck = makeTestDeck();
  const slide = deck.slides[0];
  const first = slide.children[0];
  const second = slide.children[1];
  assert.ok(first.layout);
  assert.ok(second.layout);
  const reordered = reorderZIndex(
    reorderZIndex(deck, slide.id, first.id, 50),
    slide.id,
    second.id,
    10,
  );

  const opened = openDeckFromJson(JSON.parse(JSON.stringify(reordered)));
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  assert.equal(
    findNode(opened.deck.slides[0].children, first.id)?.layout?.zIndex,
    50,
  );
  assert.equal(
    findNode(opened.deck.slides[0].children, second.id)?.layout?.zIndex,
    10,
  );
});

test("layer reorder normalizes missing and non-finite sibling z-index values before serialization", () => {
  const deck = makeTestDeck();
  const slide = deck.slides[0];
  const frame = { x: 10, y: 10, w: 30, h: 12 };
  const text = (id: string, zIndex: number | undefined): SlideChildNode => ({
    id,
    type: "text",
    role: "body",
    layout: {
      frame,
      ...(zIndex === undefined ? {} : { zIndex }),
    } as LayoutBox,
    style: { ref: "text.body" },
    content: { paragraphs: [{ id: `${id}-p`, text: id }] },
  });
  const group: SlideChildNode = {
    id: "invalid-z-group",
    type: "group",
    component: "custom",
    layout: { frame, zIndex: 5 },
    children: [
      text("invalid-z-nan", Number.NaN),
      text("invalid-z-missing", undefined),
      text("invalid-z-infinity", Number.POSITIVE_INFINITY),
    ],
  };
  const malformed = {
    ...deck,
    slides: [{ ...slide, children: [slide.children[0], group] }],
  };

  const patches = buildLayerReorderPatches(
    malformed.slides[0].children,
    "invalid-z-missing",
    2,
  );
  assert.deepEqual(
    [...patches.entries()].map(([id, patch]) => [id, patch.zIndex]),
    [
      ["invalid-z-nan", 0],
      ["invalid-z-infinity", 1],
      ["invalid-z-missing", 2],
    ],
  );

  const normalized = updateNodeLayouts(malformed, slide.id, patches);
  const opened = openDeckFromJson(JSON.parse(JSON.stringify(normalized)));
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  for (const id of [
    "invalid-z-nan",
    "invalid-z-infinity",
    "invalid-z-missing",
  ]) {
    const zIndex: number | undefined = findNode(
      opened.deck.slides[0].children,
      id,
    )?.layout?.zIndex;
    assert.equal(Number.isFinite(zIndex), true);
    assert.equal(Number.isInteger(zIndex), true);
  }
});

describe("reorderZIndex", () => {
  test("updates zIndex of target node", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const nodeId = slide.children[0].id;
    const updated = reorderZIndex(deck, slide.id, nodeId, 99);
    const node = updated.slides[0].children.find((n) => n.id === nodeId);
    assert.equal(node?.layout?.zIndex, 99);
  });
});

describe("groupNodes", () => {
  test("creates a group node from specified children", () => {
    resetBuilderCounter();
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const nodeIds = slide.children.map((n) => n.id);
    const updated = groupNodes(deck, slide.id, nodeIds, "group-001");
    const grouped = updated.slides[0].children.find(
      (n) => n.id === "group-001",
    );
    assert.ok(grouped, "Expected group node");
    assert.equal(grouped.type, "group");
    assert.equal(grouped.style, undefined);
    assert.equal(grouped.localStyle, undefined);
  });

  test("does not create a group with an existing deck id", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const updated = groupNodes(
      deck,
      slide.id,
      slide.children.map((node) => node.id),
      slide.children[0]!.id,
    );

    assert.strictEqual(updated, deck);
  });

  test("creates group bounds and z-index from selected children", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const children: SlideChildNode[] = [
      {
        id: "group-bound-a",
        type: "text",
        role: "body",
        layout: { frame: { x: 12, y: 18, w: 20, h: 10 }, zIndex: 3 },
        style: { ref: "text.body" },
        content: { paragraphs: [{ id: "group-bound-a-p1", text: "A" }] },
      },
      {
        id: "group-bound-b",
        type: "text",
        role: "body",
        layout: { frame: { x: 40, y: 10, w: 25, h: 30 }, zIndex: 7 },
        style: { ref: "text.body" },
        content: { paragraphs: [{ id: "group-bound-b-p1", text: "B" }] },
      },
    ];
    const withChildren = {
      ...deck,
      slides: deck.slides.map((candidate) =>
        candidate.id === slide.id
          ? { ...candidate, children: [...candidate.children, ...children] }
          : candidate,
      ),
    };

    const updated = groupNodes(
      withChildren,
      slide.id,
      children.map((node) => node.id),
      "group-bounds",
    );
    const grouped = findNode(updated.slides[0].children, "group-bounds");

    assert.equal(grouped?.type, "group");
    if (grouped?.type === "group") {
      assert.deepEqual(grouped.layout?.frame, { x: 12, y: 10, w: 53, h: 30 });
      assert.equal(grouped.layout?.zIndex, 7);
      assert.deepEqual(
        grouped.children.map((node) => node.id),
        ["group-bound-a", "group-bound-b"],
      );
    }
  });

  test("groups selected nested and top-level nodes without dropping unselected siblings", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const nestedSelected: SlideChildNode = {
      id: "nested-selected",
      type: "text",
      role: "body",
      layout: { frame: { x: 10, y: 10, w: 10, h: 10 }, zIndex: 2 },
      style: { ref: "text.body" },
      content: { paragraphs: [{ id: "nested-selected-p1", text: "Nested" }] },
    };
    const nestedUnselected: SlideChildNode = {
      id: "nested-unselected",
      type: "text",
      role: "body",
      layout: { frame: { x: 24, y: 10, w: 12, h: 10 }, zIndex: 3 },
      style: { ref: "text.body" },
      content: { paragraphs: [{ id: "nested-unselected-p1", text: "Keep" }] },
    };
    const parentGroup: SlideChildNode = {
      id: "nested-parent",
      type: "group",
      component: "custom",
      layout: { frame: { x: 8, y: 8, w: 32, h: 16 }, zIndex: 5 },
      children: [nestedSelected, nestedUnselected],
    };
    const topLevelSelected: SlideChildNode = {
      id: "top-selected",
      type: "shape",
      role: "background",
      layout: { frame: { x: 60, y: 15, w: 20, h: 10 }, zIndex: 8 },
      content: { shape: "rect" },
    };
    const withGroup = {
      ...deck,
      slides: deck.slides.map((candidate) =>
        candidate.id === slide.id
          ? {
              ...candidate,
              children: [...candidate.children, parentGroup, topLevelSelected],
            }
          : candidate,
      ),
    };

    const updated = groupNodes(
      withGroup,
      slide.id,
      [nestedSelected.id, topLevelSelected.id],
      "group-mixed-nested",
    );
    const grouped = findNode(updated.slides[0].children, "group-mixed-nested");
    const updatedParent = findNode(updated.slides[0].children, parentGroup.id);

    assert.equal(grouped?.type, "group");
    if (grouped?.type === "group") {
      assert.deepEqual(
        grouped.children.map((node) => node.id),
        [nestedSelected.id, topLevelSelected.id],
      );
      assert.deepEqual(grouped.layout?.frame, { x: 10, y: 10, w: 70, h: 15 });
      assert.equal(grouped.layout?.zIndex, 8);
    }
    assert.equal(updatedParent?.type, "group");
    if (updatedParent?.type === "group") {
      assert.deepEqual(
        updatedParent.children.map((node) => node.id),
        [nestedUnselected.id],
      );
    }
    assert.equal(
      updated.slides[0].children.some(
        (node) => node.id === topLevelSelected.id,
      ),
      false,
    );
  });

  test("groups nested siblings inside their parent group scope", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const firstSelected: SlideChildNode = {
      id: "nested-a",
      type: "text",
      role: "body",
      layout: { frame: { x: 20, y: 20, w: 10, h: 10 }, zIndex: 1 },
      style: { ref: "text.body" },
      content: { paragraphs: [{ id: "nested-a-p1", text: "A" }] },
    };
    const unselectedSibling: SlideChildNode = {
      id: "nested-keep",
      type: "text",
      role: "body",
      layout: { frame: { x: 10, y: 10, w: 8, h: 8 }, zIndex: 0 },
      style: { ref: "text.body" },
      content: { paragraphs: [{ id: "nested-keep-p1", text: "Keep" }] },
    };
    const secondSelected: SlideChildNode = {
      id: "nested-b",
      type: "text",
      role: "body",
      layout: { frame: { x: 40, y: 25, w: 15, h: 10 }, zIndex: 5 },
      style: { ref: "text.body" },
      content: { paragraphs: [{ id: "nested-b-p1", text: "B" }] },
    };
    const parentGroup: SlideChildNode = {
      id: "nested-scope-parent",
      type: "group",
      component: "custom",
      layout: { frame: { x: 5, y: 5, w: 60, h: 40 }, zIndex: 7 },
      children: [firstSelected, unselectedSibling, secondSelected],
    };
    const withGroup = {
      ...deck,
      slides: deck.slides.map((candidate) =>
        candidate.id === slide.id
          ? { ...candidate, children: [...candidate.children, parentGroup] }
          : candidate,
      ),
    };

    const updated = groupNodes(
      withGroup,
      slide.id,
      [firstSelected.id, secondSelected.id],
      "group-nested-siblings",
    );
    const updatedParent = findNode(updated.slides[0].children, parentGroup.id);
    const grouped = findNode(
      updated.slides[0].children,
      "group-nested-siblings",
    );

    assert.equal(updatedParent?.type, "group");
    if (updatedParent?.type === "group") {
      assert.deepEqual(
        updatedParent.children.map((node) => node.id),
        [unselectedSibling.id, "group-nested-siblings"],
      );
    }
    assert.equal(grouped?.type, "group");
    if (grouped?.type === "group") {
      assert.deepEqual(
        grouped.children.map((node) => node.id),
        [firstSelected.id, secondSelected.id],
      );
      assert.deepEqual(grouped.layout?.frame, { x: 20, y: 20, w: 35, h: 15 });
      assert.equal(grouped.layout?.zIndex, 5);
    }
    assert.equal(
      updated.slides[0].children.some(
        (node) => node.id === "group-nested-siblings",
      ),
      false,
    );
  });

  test("returns unchanged deck if no matching nodes", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const updated = groupNodes(deck, slide.id, ["nonexistent-id"], "group-002");
    // No group should be created since no nodes matched
    assert.ok(!updated.slides[0].children.some((n) => n.id === "group-002"));
  });
});

describe("ungroupNodes", () => {
  test("replaces a group node with its children", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const nodeIds = slide.children.map((node) => node.id);
    const grouped = groupNodes(deck, slide.id, nodeIds, "group-ungroup");
    const result = ungroupNodes(grouped, slide.id, "group-ungroup");

    assert.deepEqual(new Set(result.nodeIds), new Set(nodeIds));
    assert.equal(
      result.deck.slides[0].children.some(
        (node) => node.id === "group-ungroup",
      ),
      false,
    );
  });

  test("ungroups a nested group in its parent sibling position", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const childA = slide.children[0]!;
    const childB = slide.children[1]!;
    const nestedGroup: SlideChildNode = {
      id: "nested-group",
      type: "group",
      component: "custom",
      layout: { frame: { x: 5, y: 5, w: 60, h: 30 }, zIndex: 4 },
      children: [childA, childB],
    };
    const outerGroup: SlideChildNode = {
      id: "outer-group",
      type: "group",
      component: "custom",
      layout: { frame: { x: 0, y: 0, w: 80, h: 60 }, zIndex: 5 },
      children: [
        {
          ...childA,
          id: "before-nested",
        },
        nestedGroup,
        {
          ...childB,
          id: "after-nested",
        },
      ],
    };
    const nestedDeck = {
      ...deck,
      slides: deck.slides.map((candidate) =>
        candidate.id === slide.id
          ? { ...candidate, children: [outerGroup] }
          : candidate,
      ),
    };

    const result = ungroupNodes(nestedDeck, slide.id, nestedGroup.id);
    const updatedOuter = findNode(
      result.deck.slides[0].children,
      outerGroup.id,
    );

    assert.deepEqual(result.nodeIds, [childA.id, childB.id]);
    assert.equal(updatedOuter?.type, "group");
    if (updatedOuter?.type === "group") {
      assert.deepEqual(
        updatedOuter.children.map((node) => node.id),
        ["before-nested", childA.id, childB.id, "after-nested"],
      );
      assert.strictEqual(updatedOuter.children[1], childA);
      assert.strictEqual(updatedOuter.children[2], childB);
    }
  });

  test("does not ungroup locked or hidden groups", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    for (const state of [{ locked: true }, { hidden: true }]) {
      const group: SlideChildNode = {
        id: state.locked ? "locked-group" : "hidden-group",
        type: "group",
        component: "custom",
        layout: { frame: { x: 0, y: 0, w: 50, h: 50 }, zIndex: 1 },
        ...state,
        children: slide.children,
      };
      const guardedDeck = {
        ...deck,
        slides: deck.slides.map((candidate) =>
          candidate.id === slide.id
            ? { ...candidate, children: [group] }
            : candidate,
        ),
      };

      assert.deepEqual(ungroupNodes(guardedDeck, slide.id, group.id), {
        deck: guardedDeck,
        nodeIds: [],
      });
    }
  });
});
