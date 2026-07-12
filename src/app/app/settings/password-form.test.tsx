/**
 * Direct contract coverage for `PasswordForm` (issue #1928).
 *
 * `renderPasswordFormView` is the pure state -> markup decision extracted
 * from the component so the current-password-field/Google-note branch, the
 * success/error message mapping, and pending/disabled submit behavior are
 * unit-testable without exercising `useActionState` (which needs a live
 * action dispatch to move between states). A single harness-rendered pass
 * through the exported `PasswordForm` component confirms the hook wiring
 * itself still produces the same idle markup the pure function predicts.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { createReactRenderHarness } from "@/test/react-render-harness";

import { PasswordForm, renderPasswordFormView } from "./password-form";

type ElementLike = ReactElement<Record<string, unknown>>;

function collectElements(node: ReactNode, collected: ElementLike[] = []) {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, collected);
    return collected;
  }
  if (!isValidElement(node)) return collected;
  const element = node as ElementLike;
  collected.push(element);
  // Expand pure function components (AuthField/AuthMessage/AuthSubmitButton)
  // so the host elements they render are visible to assertions below.
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

describe("renderPasswordFormView", () => {
  test("hasPassword: renders the current-password field, hides the Google note", () => {
    const tree = renderPasswordFormView({
      hasPassword: true,
      state: null,
      formAction: () => undefined,
      isPending: false,
    });
    const current = firstElement(
      tree,
      (element) =>
        element.type === "input" && element.props.name === "currentPassword",
    );
    assert.equal(current.props.id, "settings-current-password");
    assert.equal(current.props.type, "password");
    assert.equal(current.props.autoComplete, "current-password");
    const html = renderToStaticMarkup(tree);
    assert.doesNotMatch(html, /You signed in with Google/);
  });

  test("no password: hides the current-password field, shows the Google note", () => {
    const tree = renderPasswordFormView({
      hasPassword: false,
      state: null,
      formAction: () => undefined,
      isPending: false,
    });
    const inputs = collectElements(tree).filter(
      (element) => element.type === "input",
    );
    assert.ok(
      !inputs.some((input) => input.props.name === "currentPassword"),
      "the current-password field must not render when hasPassword is false",
    );
    const html = renderToStaticMarkup(tree);
    assert.match(html, /You signed in with Google/);
  });

  test("wires the new/confirm password fields with hints and autocomplete", () => {
    const tree = renderPasswordFormView({
      hasPassword: true,
      state: null,
      formAction: () => undefined,
      isPending: false,
    });
    const newPassword = firstElement(
      tree,
      (element) =>
        element.type === "input" && element.props.name === "newPassword",
    );
    assert.equal(newPassword.props.autoComplete, "new-password");
    const confirmPassword = firstElement(
      tree,
      (element) =>
        element.type === "input" && element.props.name === "confirmPassword",
    );
    assert.equal(confirmPassword.props.autoComplete, "new-password");
    const html = renderToStaticMarkup(tree);
    assert.match(html, /Use at least 8 characters\./);
  });

  test("success while hasPassword: shows the 'Password updated.' message", () => {
    const tree = renderPasswordFormView({
      hasPassword: true,
      state: { ok: true, data: undefined },
      formAction: () => undefined,
      isPending: false,
    });
    const status = firstElement(
      tree,
      (element) => element.props.role === "status",
    );
    assert.equal(status.props.children, "Password updated.");
  });

  test("success while setting a first password: shows the 'Password set.' message", () => {
    const tree = renderPasswordFormView({
      hasPassword: false,
      state: { ok: true, data: undefined },
      formAction: () => undefined,
      isPending: false,
    });
    const status = firstElement(
      tree,
      (element) => element.props.role === "status",
    );
    assert.equal(status.props.children, "Password set.");
  });

  test("error: renders the server message as an alert", () => {
    const tree = renderPasswordFormView({
      hasPassword: true,
      state: { ok: false, error: "Current password is incorrect." },
      formAction: () => undefined,
      isPending: false,
    });
    const alert = firstElement(
      tree,
      (element) => element.props.role === "alert",
    );
    assert.equal(alert.props.children, "Current password is incorrect.");
  });

  test("idle: submit label reflects hasPassword and the button is enabled", () => {
    const tree = renderPasswordFormView({
      hasPassword: true,
      state: null,
      formAction: () => undefined,
      isPending: false,
    });
    const submit = firstElement(tree, (element) => element.type === "button");
    assert.equal(submit.props.disabled, false);
    assert.equal(submit.props.children, "Update password");
  });

  test("no password + idle: submit label is 'Set password'", () => {
    const tree = renderPasswordFormView({
      hasPassword: false,
      state: null,
      formAction: () => undefined,
      isPending: false,
    });
    const submit = firstElement(tree, (element) => element.type === "button");
    assert.equal(submit.props.children, "Set password");
  });

  test("pending: disables the submit button and shows the pending label", () => {
    const tree = renderPasswordFormView({
      hasPassword: true,
      state: null,
      formAction: () => undefined,
      isPending: true,
    });
    const submit = firstElement(tree, (element) => element.type === "button");
    assert.equal(submit.props.disabled, true);
    assert.equal(submit.props.children, "Saving…");
  });
});

describe("PasswordForm", () => {
  test("renders the idle, hasPassword form through the real useActionState wiring", () => {
    const renderer = createReactRenderHarness();
    try {
      const tree = renderer.run(() => PasswordForm({ hasPassword: true }));
      const html = renderToStaticMarkup(tree as ReactNode);
      assert.match(html, /Current password/);
      assert.match(html, /Update password/);
      assert.doesNotMatch(html, /role="alert"/);
    } finally {
      renderer.cleanup();
    }
  });

  test("renders the idle, no-password form through the real useActionState wiring", () => {
    const renderer = createReactRenderHarness();
    try {
      const tree = renderer.run(() => PasswordForm({ hasPassword: false }));
      const html = renderToStaticMarkup(tree as ReactNode);
      assert.match(html, /You signed in with Google/);
      assert.match(html, /Set password/);
    } finally {
      renderer.cleanup();
    }
  });
});
