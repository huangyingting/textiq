import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AddSlideTemplatePicker } from "./add-slide-template-picker";
import { createDefaultTemplateRegistry } from "@/lib/presentation/theme-packages";

type TestElementProps = {
  children?: ReactNode;
  onClick?: () => void;
  "aria-label"?: string;
};

function findButtonByText(
  node: unknown,
  text: string,
): ReactElement<TestElementProps> | undefined {
  if (!isValidElement(node)) return undefined;
  const element = node as ReactElement<{ children?: ReactNode }>;
  const children = element.props.children;
  const childText = Array.isArray(children)
    ? children.filter((child) => typeof child === "string").join("")
    : typeof children === "string"
      ? children
      : "";
  if (element.type === "button" && childText.includes(text)) return element;
  const childNodes = Array.isArray(children) ? children : [children];
  for (const child of childNodes) {
    const found = findButtonByText(child, text);
    if (found) return found;
  }
  return undefined;
}

function collectButtons(
  node: unknown,
  result: ReactElement<TestElementProps>[] = [],
): ReactElement<TestElementProps>[] {
  if (!isValidElement(node)) return result;
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (element.type === "button")
    result.push(element as ReactElement<TestElementProps>);
  const children = element.props.children;
  const childNodes = Array.isArray(children) ? children : [children];
  for (const child of childNodes) {
    collectButtons(child, result);
  }
  return result;
}

describe("AddSlideTemplatePicker", () => {
  test("renders semantic template groups and layout choices in product language", () => {
    const registry = createDefaultTemplateRegistry();
    const html = renderToStaticMarkup(
      createElement(AddSlideTemplatePicker, {
        templates: registry
          .all()
          .filter((template) =>
            ["cover", "content", "comparison"].includes(template.kind),
          ),
        onChoose: () => undefined,
        onClose: () => undefined,
      }),
    );

    assert.match(html, /Add semantic slide/);
    assert.match(html, /Cover/);
    assert.match(html, /Content/);
    assert.match(html, /Compare/);
    assert.match(html, /airy · balanced/);
  });

  test("emits the chosen semantic template kind and layout", () => {
    const registry = createDefaultTemplateRegistry();
    const choices: unknown[] = [];
    const tree = AddSlideTemplatePicker({
      templates: [registry.get("content")!],
      onChoose: (choice) => choices.push(choice),
      onClose: () => undefined,
    });
    const airyButton = findButtonByText(tree, "airy · balanced");

    assert.ok(airyButton);
    const chooseAiry = airyButton.props.onClick;
    if (typeof chooseAiry !== "function") throw new Error("Missing handler");
    chooseAiry();
    assert.deepEqual(choices, [{ kind: "content", layoutId: "content-airy" }]);
  });

  test("gives repeated layout choices unique accessible names", () => {
    const registry = createDefaultTemplateRegistry();
    const tree = AddSlideTemplatePicker({
      templates: registry.all(),
      onChoose: () => undefined,
      onClose: () => undefined,
    });
    const layoutButtons = collectButtons(tree).filter((button) =>
      typeof button.props.children === "string"
        ? button.props.children.includes("·")
        : false,
    );

    const labelsByVisibleText = new Map<string, string[]>();
    for (const button of layoutButtons) {
      const visibleText = button.props.children as string;
      const accessibleName = button.props["aria-label"];
      assert.equal(typeof accessibleName, "string");
      const labels = labelsByVisibleText.get(visibleText) ?? [];
      labels.push(accessibleName as string);
      labelsByVisibleText.set(visibleText, labels);
    }

    const repeatedLayoutChoices = [...labelsByVisibleText.entries()].filter(
      ([, labels]) => labels.length > 1,
    );
    assert.ok(repeatedLayoutChoices.length > 0);
    for (const [visibleText, labels] of repeatedLayoutChoices) {
      assert.equal(
        new Set(labels).size,
        labels.length,
        `Expected unique accessible names for "${visibleText}"`,
      );
    }
  });

  test("routes the close button to the onClose callback", () => {
    const registry = createDefaultTemplateRegistry();
    const calls: string[] = [];
    const tree = AddSlideTemplatePicker({
      templates: [registry.get("content")!],
      onChoose: () => undefined,
      onClose: () => calls.push("close"),
    });
    const closeButton = findButtonByText(tree, "Close");
    assert.ok(closeButton);
    const close = closeButton.props.onClick;
    if (typeof close !== "function") throw new Error("Missing handler");
    close();
    assert.deepEqual(calls, ["close"]);
  });

  test("routes the brand-kit authoring affordance when provided", () => {
    const registry = createDefaultTemplateRegistry();
    const calls: string[] = [];
    const tree = AddSlideTemplatePicker({
      templates: [registry.get("content")!],
      onChoose: () => undefined,
      onClose: () => undefined,
      onAuthorBrandKit: () => calls.push("author"),
    });
    const authorButton = findButtonByText(tree, "Author brand kit");
    assert.ok(authorButton);
    const author = authorButton.props.onClick;
    if (typeof author !== "function") throw new Error("Missing handler");
    author();
    assert.deepEqual(calls, ["author"]);
  });
});
