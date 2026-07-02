import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildLayoutBox,
  buildShapeNode,
  buildTextNode,
} from "@/test/builders/presentation-deck";
import type { GroupNode } from "./schema";
import {
  buildLayerReorderPatches,
  collectDescendantNodeIds,
  commonAncestorPath,
  groupNodesById,
  insertNodeAtPath,
  insertNodeRelativeTo,
  nodesInLayerOrder,
  removeNodesById,
  ungroupNodeById,
} from "./node-tree-ops";

function text(id: string, zIndex = 1) {
  return buildTextNode({ id, layout: buildLayoutBox({ zIndex }) });
}
function group(id: string, children: GroupNode["children"]): GroupNode {
  return { id, type: "group", component: "custom", children };
}

test("node tree ops no-op and option branches", () => {
  const hidden = buildShapeNode({
    id: "hidden",
    hidden: true,
    layout: buildLayoutBox({ zIndex: 3 }),
  });
  const noLayout = buildShapeNode({ id: "no-layout", layout: undefined });
  const nodes = [
    text("root", 1),
    group("group", [text("child", 2)]),
    hidden,
    noLayout,
  ];

  assert.deepEqual(collectDescendantNodeIds(text("leaf")), []);
  assert.deepEqual(commonAncestorPath([]), []);
  assert.deepEqual(commonAncestorPath([["a"], ["b"]]), []);
  assert.deepEqual(
    nodesInLayerOrder(nodes, {
      includeHidden: false,
      requireLayout: false,
    }).map((node) => node.id),
    ["group", "no-layout", "root", "child"],
  );
  assert.equal(buildLayerReorderPatches(nodes, "missing", 0).size, 0);

  assert.deepEqual(
    insertNodeAtPath(nodes, ["missing"], text("new")).inserted,
    false,
  );
  assert.equal(
    insertNodeRelativeTo(nodes, "missing", text("new"), "after").inserted,
    false,
  );
  assert.equal(
    insertNodeRelativeTo(nodes, "root", text("new"), "inside-end").inserted,
    false,
  );

  const emptyRemove = removeNodesById(nodes, new Set());
  assert.equal(emptyRemove.changed, false);
  const keepEmptyGroup = removeNodesById(
    [group("g", [text("only")])],
    new Set(["only"]),
  );
  assert.deepEqual(keepEmptyGroup.prunedGroupIds, []);
  assert.deepEqual(
    keepEmptyGroup.nodes.map((node) => node.id),
    ["g"],
  );

  const noSelection = groupNodesById(nodes, new Set(["missing"]), (children) =>
    group("created", [...children]),
  );
  assert.equal(noSelection.changed, false);
  const missingUngroup = ungroupNodeById(nodes, "missing");
  assert.equal(missingUngroup.changed, false);
  assert.deepEqual(missingUngroup.ungroupedNodes, []);
});

test("node tree ops cover sibling insertion and unchanged recursive removal", () => {
  const nodes = [group("g", [text("a"), text("b")]), text("root")];
  const after = insertNodeRelativeTo(nodes, "a", text("after-a"), "after");
  assert.deepEqual(
    after.nodes[0].type === "group"
      ? after.nodes[0].children.map((node) => node.id)
      : [],
    ["a", "after-a", "b"],
  );
  const insideEnd = insertNodeRelativeTo(
    after.nodes,
    "g",
    text("last"),
    "inside-end",
  );
  assert.deepEqual(
    insideEnd.nodes[0].type === "group"
      ? insideEnd.nodes[0].children.map((node) => node.id)
      : [],
    ["a", "after-a", "b", "last"],
  );
  const noMatch = removeNodesById(nodes, new Set(["missing"]), {
    pruneEmptyGroups: true,
  });
  assert.equal(noMatch.changed, false);
  assert.deepEqual(
    noMatch.nodes.map((node) => node.id),
    ["g", "root"],
  );
  const notPruned = removeNodesById(nodes, new Set(["a", "b"]), {
    pruneEmptyGroups: false,
  });
  assert.deepEqual(
    notPruned.nodes.map((node) => node.id),
    ["g", "root"],
  );
});
