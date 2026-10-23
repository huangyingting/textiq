import assert from "node:assert/strict";
import { test } from "node:test";

import { containsFloatingTarget } from "./floating-target";

function containerWith(child: Node): HTMLElement {
  return { contains: (node: Node) => node === child } as unknown as HTMLElement;
}

function portaledNode(trigger: () => Node | null): Node {
  return {
    nodeType: 1,
    closest: () => ({
      getAttribute: () => "trigger",
      ownerDocument: { getElementById: trigger },
    }),
  } as unknown as Node;
}

test("floating target containment handles absent surfaces and direct children", () => {
  const child = {} as Node;
  const container = containerWith(child);
  assert.equal(containsFloatingTarget(null, child), false);
  assert.equal(containsFloatingTarget(container, null), false);
  assert.equal(containsFloatingTarget(container, child), true);
});

test("floating target containment follows nested portal owners and text targets", () => {
  const trigger = {} as Node;
  const outerMenu = portaledNode(() => trigger);
  const innerMenu = portaledNode(() => outerMenu);
  const text = { nodeType: 3, parentElement: innerMenu } as unknown as Node;
  assert.equal(containsFloatingTarget(containerWith(trigger), text), true);
});

test("floating target containment rejects unrelated, missing, and cyclic owners", () => {
  const container = containerWith({} as Node);
  assert.equal(
    containsFloatingTarget(
      container,
      portaledNode(() => null),
    ),
    false,
  );
  const unrelated = { nodeType: 1, closest: () => null } as unknown as Node;
  assert.equal(containsFloatingTarget(container, unrelated), false);
  const cyclic = portaledNode(() => cyclic);
  assert.equal(containsFloatingTarget(container, cyclic), false);
});
