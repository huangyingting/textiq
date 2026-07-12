/**
 * Direct contract coverage for `@/components/auth/auth-form` (issue #1927).
 *
 * `AuthField`, `AuthMessage`, and `AuthSubmitButton` are pure, hook-free
 * components shared by every credential form (login, signup, forgot- and
 * reset-password). These tests pin field/label wiring (htmlFor/id pairing,
 * optional hint and label accessory), accessible role selection for error
 * vs. success/status messages, and the pending/disabled submit-button
 * contract that every consuming form relies on.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AuthField, AuthMessage, AuthSubmitButton } from "./auth-form";

type ElementLike = ReactElement<Record<string, unknown>>;

function collectElements(node: ReactNode, collected: ElementLike[] = []) {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, collected);
    return collected;
  }
  if (!isValidElement(node)) return collected;
  const element = node as ElementLike;
  collected.push(element);
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

describe("AuthField", () => {
  test("binds the label to the input via htmlFor/id", () => {
    const tree = AuthField({
      id: "email",
      name: "email",
      label: "Email",
      type: "email",
    });
    const label = firstElement(tree, (element) => element.type === "label");
    const input = firstElement(tree, (element) => element.type === "input");
    assert.equal(label.props.htmlFor, "email");
    assert.equal(input.props.id, "email");
    assert.equal(input.props.name, "email");
    assert.equal(input.props.type, "email");
  });

  test("renders an optional label accessory next to the label", () => {
    const html = renderToStaticMarkup(
      AuthField({
        id: "password",
        name: "password",
        label: "Password",
        type: "password",
        labelAccessory: <a href="/forgot-password">Forgot password?</a>,
      }) as ReactNode,
    );
    assert.match(html, /Forgot password\?/);
  });

  test("omits the label accessory and hint when not provided", () => {
    const html = renderToStaticMarkup(
      AuthField({
        id: "name",
        name: "name",
        label: "Name",
        type: "text",
      }) as ReactNode,
    );
    assert.doesNotMatch(html, /<p class="text-xs/);
  });

  test("renders an optional hint below the input", () => {
    const html = renderToStaticMarkup(
      AuthField({
        id: "newPassword",
        name: "newPassword",
        label: "New password",
        type: "password",
        hint: "At least 8 characters",
      }) as ReactNode,
    );
    assert.match(html, /At least 8 characters/);
  });

  test("merges a custom inputClassName with the shared field styling", () => {
    const tree = AuthField({
      id: "email",
      name: "email",
      label: "Email",
      type: "email",
      inputClassName: "border-ds-danger",
    });
    const input = firstElement(tree, (element) => element.type === "input");
    assert.match(input.props.className as string, /border-ds-danger/);
    assert.match(input.props.className as string, /rounded-ds-md/);
  });

  test("spreads through arbitrary input props such as required and minLength", () => {
    const tree = AuthField({
      id: "newPassword",
      name: "newPassword",
      label: "New password",
      type: "password",
      required: true,
      minLength: 8,
      placeholder: "At least 8 characters",
      autoComplete: "new-password",
    });
    const input = firstElement(tree, (element) => element.type === "input");
    assert.equal(input.props.required, true);
    assert.equal(input.props.minLength, 8);
    assert.equal(input.props.placeholder, "At least 8 characters");
    assert.equal(input.props.autoComplete, "new-password");
  });
});

describe("AuthMessage", () => {
  test("uses an alert role and danger styling for error messages", () => {
    const tree = AuthMessage({ kind: "error", children: "Invalid token." });
    assert.equal(tree.props.role, "alert");
    assert.match(tree.props.className as string, /text-ds-danger/);
    assert.equal(
      renderToStaticMarkup(tree as ReactNode).includes("Invalid token."),
      true,
    );
  });

  test("uses a status role and success styling for success messages", () => {
    const tree = AuthMessage({
      kind: "success",
      children: "Password updated.",
    });
    assert.equal(tree.props.role, "status");
    assert.match(tree.props.className as string, /text-ds-success/);
  });

  test("uses a status role and neutral panel styling for status messages", () => {
    const tree = AuthMessage({
      kind: "status",
      children: "If an account exists, we sent a link.",
    });
    assert.equal(tree.props.role, "status");
    assert.doesNotMatch(tree.props.className as string, /text-ds-success/);
    assert.doesNotMatch(tree.props.className as string, /text-ds-danger/);
    assert.match(tree.props.className as string, /border-ds-border-subtle/);
  });
});

describe("AuthSubmitButton", () => {
  test("renders enabled with its children label when not pending", () => {
    const tree = AuthSubmitButton({
      isPending: false,
      pendingLabel: "Sending…",
      children: "Send reset link",
    });
    assert.equal(tree.props.disabled, false);
    assert.equal(tree.props.type, "submit");
    assert.equal(tree.props.children, "Send reset link");
  });

  test("disables the button and swaps in the pending label while pending", () => {
    const tree = AuthSubmitButton({
      isPending: true,
      pendingLabel: "Sending…",
      children: "Send reset link",
    });
    assert.equal(tree.props.disabled, true);
    assert.equal(tree.props.children, "Sending…");
  });

  test("merges a custom className with the shared submit styling", () => {
    const tree = AuthSubmitButton({
      isPending: false,
      pendingLabel: "Working…",
      children: "Continue",
      className: "w-full",
    });
    assert.match(tree.props.className as string, /w-full/);
    assert.match(tree.props.className as string, /rounded-ds-pill/);
  });
});
