import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";

import { renderLoginFormView } from "./login-form";

type ElementLike = ReactElement<Record<string, unknown>>;

function collectElements(node: ReactNode, collected: ElementLike[] = []) {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, collected);
    return collected;
  }
  if (!isValidElement(node)) return collected;
  const element = node as ElementLike;
  collected.push(element);
  if (typeof element.type === "function") {
    const rendered = (element.type as (props: unknown) => ReactNode)(
      element.props,
    );
    collectElements(rendered, collected);
    return collected;
  }
  const props = element.props as { children?: ReactNode };
  collectElements(props.children, collected);
  return collected;
}

function firstElement(
  node: ReactNode,
  predicate: (element: ElementLike) => boolean,
): ElementLike {
  const element = collectElements(node).find(predicate);
  assert.ok(element, "expected a matching element");
  return element;
}

function renderView(
  overrides: Partial<Parameters<typeof renderLoginFormView>[0]> = {},
) {
  return renderLoginFormView({
    callbackUrl: "/app/documents/doc-1",
    errorMessage: undefined,
    formAction: () => undefined,
    isPending: false,
    email: "owner@example.com",
    onEmailChange: () => undefined,
    ...overrides,
  });
}

describe("renderLoginFormView", () => {
  test("keeps email controlled for retries while never retaining the password", () => {
    const onEmailChange = () => undefined;
    const tree = renderView({ onEmailChange });
    const email = firstElement(
      tree,
      (element) => element.type === "input" && element.props.name === "email",
    );
    const password = firstElement(
      tree,
      (element) =>
        element.type === "input" && element.props.name === "password",
    );

    assert.equal(email.props.value, "owner@example.com");
    assert.equal(email.props.onChange, onEmailChange);
    assert.equal(password.props.value, undefined);
    assert.equal(password.props.defaultValue, undefined);
  });

  test("preserves the safe callback target and renders a generic error as an alert", () => {
    const tree = renderView({ errorMessage: "Invalid email or password." });
    const callback = firstElement(
      tree,
      (element) =>
        element.type === "input" && element.props.name === "callbackUrl",
    );
    const alert = firstElement(
      tree,
      (element) => element.props.role === "alert",
    );

    assert.equal(callback.props.value, "/app/documents/doc-1");
    assert.equal(alert.props.children, "Invalid email or password.");
  });
});
