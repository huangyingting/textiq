import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  Children,
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  EditorActionButton,
  EditorActionMenu,
  EditorField,
  EditorNumberField,
  parseEditorNumberInput,
  type EditorActionDescriptor,
} from "./editor-primitives";

type ElementWithProps = ReactElement<Record<string, unknown>>;

function elements(root: ReactNode): ElementWithProps[] {
  const found: ElementWithProps[] = [];
  function visit(node: ReactNode): void {
    Children.forEach(node, (child) => {
      if (!isValidElement(child)) return;
      const element = child as ElementWithProps;
      found.push(element);
      visit(element.props.children as ReactNode);
    });
  }
  visit(root);
  return found;
}

describe("editor inspector primitives", () => {
  test("EditorField wires labels with description, help, and error text", () => {
    const html = renderToStaticMarkup(
      createElement(
        EditorField,
        {
          id: "field-1",
          label: "Field label",
          description: "What this field owns",
          helpText: "Helpful guidance",
          errorText: "Invalid value",
        },
        createElement("input", {
          id: "field-1",
          "aria-describedby": "field-1-description field-1-help field-1-error",
        }),
      ),
    );

    assert.match(html, /for="field-1"/);
    assert.match(html, /id="field-1-description"/);
    assert.match(html, /Helpful guidance/);
    assert.match(html, /Invalid value/);
  });

  test("EditorNumberField parses finite values and exposes field state", () => {
    const values: Array<number | undefined> = [];
    const element = EditorNumberField({
      id: "width",
      label: "Width",
      description: "Width in points",
      min: 0,
      step: 0.25,
      value: 1.5,
      onValueChange: (value) => values.push(value),
    });
    const input = elements(element).find(
      (candidate) => candidate.type === "input",
    );

    assert.equal(parseEditorNumberInput("2.25"), 2.25);
    assert.equal(parseEditorNumberInput("not a number"), undefined);
    assert.ok(input);
    assert.equal(input.props["aria-describedby"], "width-description");
    (
      input.props.onChange as (event: {
        currentTarget: { value: string };
      }) => void
    )({ currentTarget: { value: "3.5" } });
    (
      input.props.onChange as (event: {
        currentTarget: { value: string };
      }) => void
    )({ currentTarget: { value: "bad" } });
    assert.deepEqual(values, [3.5, undefined]);
  });

  test("EditorActionButton carries descriptors, shortcuts, and live messages", () => {
    const action: EditorActionDescriptor = {
      id: "duplicate",
      label: "Duplicate",
      description: "Duplicate selection",
      shortcut: "⌘D",
      liveMessage: "Selection duplicated",
    };
    const announcements: string[] = [];
    let clicked = false;
    const element = EditorActionButton({
      action,
      onClick: () => {
        clicked = true;
      },
      onAnnounce: (message) => announcements.push(message),
    });

    assert.equal(element.props["data-command-id"], "duplicate");
    assert.match(String(element.props.title), /Shortcut: ⌘D/);
    (element.props.onClick as (event: { defaultPrevented: boolean }) => void)({
      defaultPrevented: false,
    });
    assert.equal(clicked, true);
    assert.deepEqual(announcements, ["Selection duplicated"]);
  });

  test("EditorActionMenu renders grouped descriptors and disabled reasons", () => {
    const actions: EditorActionDescriptor[] = [
      { id: "align-left", label: "Align left" },
      {
        id: "group",
        label: "Group",
        disabledReason: "Select at least two objects",
      },
    ];
    const invoked: string[] = [];
    const element = createElement(EditorActionMenu, {
      label: "Arrange actions",
      groups: [{ label: "Arrange", actions }],
      onAction: (action) => invoked.push(action.id),
    });
    const html = renderToStaticMarkup(element);

    assert.match(html, /role="menu"/);
    assert.match(html, /Arrange actions/);
    assert.match(html, /Disabled: Select at least two objects/);

    const menu = EditorActionMenu({
      label: "Arrange actions",
      groups: [{ label: "Arrange", actions }],
      onAction: (action) => invoked.push(action.id),
    });
    const firstAction = elements(menu).find(
      (candidate) =>
        candidate.type === EditorActionButton &&
        (candidate.props.action as EditorActionDescriptor).id === "align-left",
    );
    assert.ok(firstAction);
    (firstAction.props.onClick as () => void)();
    assert.deepEqual(invoked, ["align-left"]);
  });
});
