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
  deleteNodes,
  duplicateNodes,
  reorderZIndex,
  groupNodes,
  ungroupNodes,
} from "@/lib/presentation/editor-commands";
import { resetBuilderCounter } from "@/test/builders/presentation-deck";
import type { SlideChildNode } from "@/lib/presentation/schema";
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
      { ref: "surface.card" },
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
      style: { ref: "surface.card" },
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
    const updated = groupNodes(deck, slide.id, nodeIds, "group-001", {
      ref: "surface.card",
    });
    const grouped = updated.slides[0].children.find(
      (n) => n.id === "group-001",
    );
    assert.ok(grouped, "Expected group node");
    assert.equal(grouped.type, "group");
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
      { ref: "surface.card" },
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
      style: { ref: "surface.card" },
      children: [nestedSelected, nestedUnselected],
    };
    const topLevelSelected: SlideChildNode = {
      id: "top-selected",
      type: "shape",
      role: "background",
      layout: { frame: { x: 60, y: 15, w: 20, h: 10 }, zIndex: 8 },
      style: { ref: "surface.card" },
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
      { ref: "surface.card" },
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
      style: { ref: "surface.card" },
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
      { ref: "surface.card" },
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
    const updated = groupNodes(
      deck,
      slide.id,
      ["nonexistent-id"],
      "group-002",
      { ref: "surface.card" },
    );
    // No group should be created since no nodes matched
    assert.ok(!updated.slides[0].children.some((n) => n.id === "group-002"));
  });
});

describe("ungroupNodes", () => {
  test("replaces a group node with its children", () => {
    const deck = makeTestDeck();
    const slide = deck.slides[0];
    const nodeIds = slide.children.map((node) => node.id);
    const grouped = groupNodes(deck, slide.id, nodeIds, "group-ungroup", {
      ref: "surface.card",
    });
    const result = ungroupNodes(grouped, slide.id, "group-ungroup");

    assert.deepEqual(new Set(result.nodeIds), new Set(nodeIds));
    assert.equal(
      result.deck.slides[0].children.some(
        (node) => node.id === "group-ungroup",
      ),
      false,
    );
  });
});
