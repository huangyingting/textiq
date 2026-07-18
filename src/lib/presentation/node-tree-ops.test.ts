import assert from "node:assert/strict";
import { test } from "node:test";

import type { GroupNode, LayoutBox } from "./schema";
import {
  ancestorIdsForNode,
  buildLayerReorderPatches,
  collectDescendantNodeIds,
  collectNodeTreeIds,
  collectSubtreeNodeIds,
  commonAncestorPath,
  expandNodeIdsWithDescendants,
  findNodeById,
  flattenLeafNodes,
  flattenNodeTree,
  flattenNodeTreeEntries,
  groupNodesById,
  insertNodeAtPath,
  insertNodeRelativeTo,
  isAncestorOfNode,
  mapNodes,
  nodesInLayerOrder,
  parentGroupIdForNode,
  parentPathForNode,
  removeNodeById,
  removeNodesById,
  reorderNodeWithinParent,
  topLevelSelectedNodeIds,
  ungroupNodeById,
} from "./node-tree-ops";
import {
  buildLayoutBox,
  buildShapeNode,
  buildTextNode,
} from "@/test/builders/presentation-deck";

function frame(x: number, y: number): LayoutBox["frame"] {
  return { x, y, w: 10, h: 10 };
}

function textNode(id: string, zIndex = 1) {
  return buildTextNode({
    id,
    layout: buildLayoutBox({ frame: frame(zIndex, zIndex), zIndex }),
  });
}

function shapeNode(id: string, zIndex = 1) {
  return buildShapeNode({
    id,
    layout: buildLayoutBox({ frame: frame(zIndex, zIndex), zIndex }),
  });
}

function groupNode(
  id: string,
  children: GroupNode["children"],
  zIndex = 1,
): GroupNode {
  return {
    id,
    type: "group",
    component: "custom",
    layout: buildLayoutBox({ frame: frame(zIndex, zIndex), zIndex }),
    children,
  };
}

function customGroup(
  id: string,
  children: readonly GroupNode["children"][number][],
) {
  return groupNode(
    id,
    [...children],
    Math.max(...children.map((node) => node.layout?.zIndex ?? 0), 0),
  );
}

test("flattens, finds parents, and checks ancestors in true nested Deck trees", () => {
  const nodes = [
    groupNode("outer", [
      textNode("sibling", 2),
      groupNode("inner", [textNode("leaf", 3)], 4),
    ]),
    textNode("root", 5),
  ];

  assert.deepEqual(
    flattenNodeTree(nodes).map((node) => node.id),
    ["outer", "sibling", "inner", "leaf", "root"],
  );
  assert.deepEqual(
    flattenLeafNodes(nodes).map((node) => node.id),
    ["sibling", "leaf", "root"],
  );
  assert.equal(findNodeById(nodes, "leaf")?.id, "leaf");
  assert.equal(parentGroupIdForNode(nodes, "leaf"), "inner");
  assert.deepEqual(parentPathForNode(nodes, "leaf"), ["outer", "inner"]);
  assert.deepEqual(ancestorIdsForNode(nodes, "leaf"), ["outer", "inner"]);
  assert.equal(isAncestorOfNode(nodes, "outer", "leaf"), true);
  assert.equal(isAncestorOfNode(nodes, "inner", "outer"), false);

  assert.deepEqual(
    flattenNodeTreeEntries(nodes).map((entry) => ({
      id: entry.node.id,
      depth: entry.depth,
      parentId: entry.parentId,
      path: entry.path,
    })),
    [
      { id: "outer", depth: 0, parentId: null, path: [0] },
      { id: "sibling", depth: 1, parentId: "outer", path: [0, 0] },
      { id: "inner", depth: 1, parentId: "outer", path: [0, 1] },
      { id: "leaf", depth: 2, parentId: "inner", path: [0, 1, 0] },
      { id: "root", depth: 0, parentId: null, path: [1] },
    ],
  );
});

test("collects node ids, descendants, expanded selections, and top-level selections", () => {
  const inner = groupNode("inner", [textNode("leaf")]);
  const outer = groupNode("outer", [textNode("child"), inner]);
  const nodes = [outer, textNode("root")];

  assert.deepEqual(collectNodeTreeIds(nodes), [
    "outer",
    "child",
    "inner",
    "leaf",
    "root",
  ]);
  assert.deepEqual(collectSubtreeNodeIds(outer), [
    "outer",
    "child",
    "inner",
    "leaf",
  ]);
  assert.deepEqual(collectDescendantNodeIds(outer), ["child", "inner", "leaf"]);
  assert.deepEqual(
    [...expandNodeIdsWithDescendants(nodes, new Set(["inner", "missing"]))],
    ["inner", "missing", "leaf"],
  );
  assert.deepEqual(
    topLevelSelectedNodeIds(nodes, new Set(["outer", "leaf", "root"])),
    ["outer", "root"],
  );
});

test("orders layers within stacking contexts and normalizes only same-parent siblings", () => {
  const nodes = [
    textNode("back", 1),
    groupNode(
      "group",
      [
        textNode("child-front", 5),
        { ...textNode("layoutless-child", 4), layout: undefined },
        textNode("child-mid", 3),
      ],
      4,
    ),
    shapeNode("tie", 4),
  ];

  assert.deepEqual(
    nodesInLayerOrder(nodes, { order: "back-to-front" }).map((node) => node.id),
    ["back", "group", "child-mid", "child-front", "tie"],
  );
  assert.deepEqual(
    nodesInLayerOrder(nodes, {
      includeGroups: false,
      order: "front-to-back",
    }).map((node) => node.id),
    ["tie", "child-front", "child-mid", "back"],
  );

  const patches = buildLayerReorderPatches(nodes, "child-mid", 1);
  assert.deepEqual(
    [...patches.entries()].map(([id, patch]) => [id, patch.zIndex]),
    [
      ["child-front", 0],
      ["child-mid", 1],
    ],
  );
  assert.equal(patches.has("back"), false);
  assert.equal(patches.has("group"), false);
  assert.equal(patches.has("tie"), false);
  assert.equal(patches.has("layoutless-child"), false);
});

test("inserts nodes by parent path and relative placement", () => {
  const nodes = [textNode("root"), groupNode("group", [textNode("child")])];
  const inserted = insertNodeAtPath(nodes, ["group"], textNode("inserted"), 1);

  assert.equal(inserted.inserted, true);
  assert.deepEqual(collectNodeTreeIds(inserted.nodes), [
    "root",
    "group",
    "child",
    "inserted",
  ]);
  assert.deepEqual(collectNodeTreeIds(nodes), ["root", "group", "child"]);

  const relative = insertNodeRelativeTo(
    inserted.nodes,
    "child",
    shapeNode("before"),
    "before",
  );
  assert.deepEqual(collectNodeTreeIds(relative.nodes), [
    "root",
    "group",
    "before",
    "child",
    "inserted",
  ]);

  const inside = insertNodeRelativeTo(
    relative.nodes,
    "group",
    textNode("first"),
    "inside-start",
  );
  assert.deepEqual(collectNodeTreeIds(inside.nodes), [
    "root",
    "group",
    "first",
    "before",
    "child",
    "inserted",
  ]);
});

test("removes nodes immutably and can prune emptied ancestor groups", () => {
  const nodes = [
    groupNode("empty-after-remove", [textNode("only-child")]),
    groupNode("kept", [textNode("kept-child"), textNode("removed-child")]),
  ];

  const result = removeNodesById(
    nodes,
    new Set(["only-child", "removed-child"]),
    {
      pruneEmptyGroups: true,
    },
  );

  assert.deepEqual(
    result.removedNodes.map((node) => node.id),
    ["only-child", "removed-child"],
  );
  assert.deepEqual(result.prunedGroupIds, ["empty-after-remove"]);
  assert.deepEqual(collectNodeTreeIds(result.nodes), ["kept", "kept-child"]);
  assert.deepEqual(collectNodeTreeIds(nodes), [
    "empty-after-remove",
    "only-child",
    "kept",
    "kept-child",
    "removed-child",
  ]);

  const groupRemoved = removeNodeById(result.nodes, "kept");
  assert.deepEqual(
    groupRemoved.removedNodes.map((node) => node.id),
    ["kept"],
  );
  assert.deepEqual(collectNodeTreeIds(groupRemoved.nodes), []);
});

test("reorders a node only within its current parent", () => {
  const nodes = [
    textNode("root"),
    groupNode("group", [textNode("a"), textNode("b"), textNode("c")]),
  ];

  const reordered = reorderNodeWithinParent(nodes, "a", 2);
  assert.equal(reordered.changed, true);
  assert.equal(reordered.parentId, "group");
  assert.equal(reordered.index, 2);
  assert.deepEqual(collectNodeTreeIds(reordered.nodes), [
    "root",
    "group",
    "b",
    "c",
    "a",
  ]);

  const sameIndex = reorderNodeWithinParent(reordered.nodes, "a", 2);
  assert.equal(sameIndex.changed, false);
  assert.deepEqual(collectNodeTreeIds(sameIndex.nodes), [
    "root",
    "group",
    "b",
    "c",
    "a",
  ]);

  const missing = reorderNodeWithinParent(reordered.nodes, "missing", 0);
  assert.equal(missing.changed, false);
  assert.equal(missing.node, null);
});

test("groups selected nodes at their common ancestor without flat group ids", () => {
  const nodes = [
    groupNode("outer", [textNode("a"), groupNode("inner", [textNode("b")])]),
    textNode("c"),
  ];

  const result = groupNodesById(
    nodes,
    new Set(["a", "b"]),
    (children, context) => {
      assert.deepEqual(context.parentPath, ["outer"]);
      assert.deepEqual(context.groupedNodeIds, ["a", "b"]);
      return customGroup("grouped", children);
    },
  );

  assert.equal(result.changed, true);
  assert.deepEqual(
    result.groupedNodes.map((node) => node.id),
    ["a", "b"],
  );
  assert.deepEqual(result.parentPath, ["outer"]);
  assert.deepEqual(collectNodeTreeIds(result.nodes), [
    "outer",
    "grouped",
    "a",
    "b",
    "c",
  ]);
  assert.deepEqual(commonAncestorPath([["outer"], ["outer", "inner"]]), [
    "outer",
  ]);
});

test("ungroups a deeply nested group in its exact sibling position", () => {
  const nodes = [
    textNode("root"),
    groupNode("outer", [
      textNode("before"),
      groupNode("middle", [
        textNode("middle-before"),
        groupNode("grouped", [textNode("a"), textNode("b")]),
        textNode("middle-after"),
      ]),
      textNode("after"),
    ]),
  ];

  const result = ungroupNodeById(nodes, "grouped");

  assert.equal(result.changed, true);
  assert.equal(result.group?.id, "grouped");
  assert.deepEqual(
    result.ungroupedNodes.map((node) => node.id),
    ["a", "b"],
  );
  assert.deepEqual(collectNodeTreeIds(result.nodes), [
    "root",
    "outer",
    "before",
    "middle",
    "middle-before",
    "a",
    "b",
    "middle-after",
    "after",
  ]);
});

test("mapNodes applies mapper to top-level and nested group nodes", () => {
  const visited: string[] = [];
  const nodes = [
    textNode("root"),
    groupNode("outer", [
      textNode("child"),
      groupNode("inner", [textNode("leaf")]),
    ]),
  ];

  const result = mapNodes(nodes, (node) => {
    visited.push(node.id);
    return { ...node, name: `mapped-${node.id}` };
  });

  // Pre-order: each node is mapped before its children are recursed into
  assert.deepEqual(visited, ["root", "outer", "child", "inner", "leaf"]);

  assert.equal(result[0]!.name, "mapped-root");
  assert.equal(result[1]!.name, "mapped-outer");

  const outer = result[1]!;
  if (outer.type !== "group") assert.fail("expected outer to be a group node");
  assert.equal(outer.children[0]!.name, "mapped-child");
  const inner = outer.children[1]!;
  if (inner.type !== "group") assert.fail("expected inner to be a group node");
  assert.equal(inner.name, "mapped-inner");
  assert.equal(inner.children[0]!.name, "mapped-leaf");
});

test("mapNodes recurses into transformed group children", () => {
  // When the mapper replaces a group node entirely, the new group's children
  // are still recursed, so descendants of the replacement are also mapped.
  const nodes = [groupNode("g", [textNode("a"), textNode("b")]), textNode("c")];

  const result = mapNodes(nodes, (node) =>
    node.id === "g"
      ? groupNode("g-renamed", [textNode("x"), textNode("y")])
      : { ...node, name: `mapped-${node.id}` },
  );

  const renamed = result[0]!;
  if (renamed.type !== "group")
    assert.fail("expected result[0] to be a group node");
  assert.equal(renamed.id, "g-renamed");
  // Children of the replacement group are also mapped
  assert.equal(renamed.children[0]!.name, "mapped-x");
  assert.equal(renamed.children[1]!.name, "mapped-y");
  // Top-level leaf is also mapped
  assert.equal(result[1]!.name, "mapped-c");
});
