import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";

import { createReactRenderHarness } from "@/test/react-render-harness";

import { PrecisionGuideToolbarControls } from "./precision-guides-controls";

type ElementLike = ReactElement<Record<string, unknown>>;

function collectElements(
  node: ReactNode,
  predicate: (element: ElementLike) => boolean,
  collected: ElementLike[] = [],
): ElementLike[] {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, predicate, collected);
    return collected;
  }
  if (!isValidElement(node)) return collected;
  const element = node as ElementLike;
  if (predicate(element)) collected.push(element);
  collectElements(element.props.children as ReactNode, predicate, collected);
  return collected;
}

test("custom guide controls expose accessible roles and invoke operations", () => {
  const calls: unknown[][] = [];
  const harness = createReactRenderHarness();
  const render = () =>
    harness.run(() =>
      PrecisionGuideToolbarControls({
        preferences: {
          gridVisible: false,
          rulersVisible: false,
          guidesVisible: true,
          customGuides: [
            { axis: "x", positionPct: 25 },
            { axis: "y", positionPct: 75 },
          ],
        },
        onToggleGrid: () => calls.push(["grid"]),
        onToggleRulers: () => calls.push(["rulers"]),
        onToggleCustomGuides: () => calls.push(["visible"]),
        onAddCustomGuide: (axis, position) =>
          calls.push(["add", axis, position]),
        onRemoveCustomGuide: (index) => calls.push(["remove", index]),
      }),
    );
  let tree = render();

  const popover = collectElements(
    tree,
    (element) => element.props["aria-label"] === "Custom guides",
  )[0];
  const trigger = popover.props.trigger as ElementLike;
  assert.equal(trigger.props.hasPopup, "dialog");
  assert.equal(trigger.props.expanded, false);
  (trigger.props.onClick as () => void)();
  tree = render();
  const openPopover = collectElements(
    tree,
    (element) => element.props["aria-label"] === "Custom guides",
  )[0];
  assert.equal((openPopover.props.trigger as ElementLike).props.expanded, true);
  const close = collectElements(
    tree,
    (element) => element.props.children === "Close",
  )[0];
  assert.ok(close);

  const toggle = collectElements(
    tree,
    (element) => element.props["aria-pressed"] === true,
  )[0];
  assert.equal(toggle.props.children instanceof Array, true);
  (toggle.props.onClick as () => void)();

  const orientation = collectElements(
    tree,
    (element) => element.props["aria-label"] === "Guide orientation",
  )[0];
  assert.equal(orientation.type, "select");
  assert.equal(orientation.props.value, "x");

  const position = collectElements(
    tree,
    (element) => element.props["aria-label"] === "Guide position (%)",
  )[0];
  assert.equal(position.props.role, "spinbutton");
  assert.equal(position.props.min, 0);
  assert.equal(position.props.max, 100);
  (position.props.onChange as (event: unknown) => void)({
    currentTarget: { value: "33.5" },
  });
  tree = render();

  const add = collectElements(
    tree,
    (element) => element.props.children === "Add guide",
  )[0];
  (add.props.onClick as () => void)();

  const removeButtons = collectElements(
    tree,
    (element) =>
      typeof element.props["aria-label"] === "string" &&
      String(element.props["aria-label"]).startsWith("Remove "),
  );
  assert.deepEqual(
    removeButtons.map((button) => button.props["aria-label"]),
    ["Remove vertical guide at 25%", "Remove horizontal guide at 75%"],
  );
  (removeButtons[1]?.props.onClick as () => void)();

  assert.deepEqual(calls, [["visible"], ["add", "x", "33.5"], ["remove", 1]]);
  harness.cleanup();
});
