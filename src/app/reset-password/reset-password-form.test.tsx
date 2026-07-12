/**
 * Direct contract coverage for `ResetPasswordForm` (issue #1927).
 *
 * `renderResetPasswordView` is the pure state -> markup decision extracted
 * from the component so the "idle"/"success"/"error" transitions, the
 * hidden token wiring, field labels/values, and pending/disabled submit
 * behavior are unit-testable without exercising `useActionState` (which
 * needs a live action dispatch to move between states). A single
 * harness-rendered pass through the exported `ResetPasswordForm` component
 * confirms the hook wiring itself still produces the same idle markup the
 * pure function predicts.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { createReactRenderHarness } from "@/test/react-render-harness";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";

import {
  ResetPasswordForm,
  renderResetPasswordView,
} from "./reset-password-form";

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

describe("renderResetPasswordView", () => {
  test("idle: carries the token in a hidden input and wires both password fields", () => {
    const tree = renderResetPasswordView({
      token: "raw-reset-token",
      state: { status: "idle" },
      formAction: () => undefined,
      isPending: false,
    });
    const form = firstElement(tree, (element) => element.type === "form");
    assert.equal(typeof form.props.action, "function");
    const hiddenToken = firstElement(
      tree,
      (element) => element.type === "input" && element.props.name === "token",
    );
    assert.equal(hiddenToken.props.type, "hidden");
    assert.equal(hiddenToken.props.value, "raw-reset-token");

    const newPassword = firstElement(
      tree,
      (element) =>
        element.type === "input" && element.props.name === "newPassword",
    );
    assert.equal(newPassword.props.id, "newPassword");
    assert.equal(newPassword.props.type, "password");
    assert.equal(newPassword.props.required, true);
    assert.equal(newPassword.props.minLength, MIN_PASSWORD_LENGTH);
    assert.equal(newPassword.props.autoComplete, "new-password");

    const confirmPassword = firstElement(
      tree,
      (element) =>
        element.type === "input" && element.props.name === "confirmPassword",
    );
    assert.equal(confirmPassword.props.id, "confirmPassword");
    assert.equal(confirmPassword.props.minLength, MIN_PASSWORD_LENGTH);

    const submit = firstElement(tree, (element) => element.type === "button");
    assert.equal(submit.props.disabled, false);
    assert.equal(submit.props.children, "Reset password");
  });

  test("re-renders the hidden token when the token prop changes", () => {
    const tree = renderResetPasswordView({
      token: "second-token",
      state: { status: "idle" },
      formAction: () => undefined,
      isPending: false,
    });
    const hiddenToken = firstElement(
      tree,
      (element) => element.type === "input" && element.props.name === "token",
    );
    assert.equal(hiddenToken.props.value, "second-token");
  });

  test("idle + pending: disables the submit button and shows the pending label", () => {
    const tree = renderResetPasswordView({
      token: "raw-reset-token",
      state: { status: "idle" },
      formAction: () => undefined,
      isPending: true,
    });
    const submit = firstElement(tree, (element) => element.type === "button");
    assert.equal(submit.props.disabled, true);
    assert.equal(submit.props.children, "Resetting…");
  });

  test("error: renders the error message as an alert alongside the form", () => {
    const tree = renderResetPasswordView({
      token: "raw-reset-token",
      state: {
        status: "error",
        message: "This reset link is invalid or has expired.",
      },
      formAction: () => undefined,
      isPending: false,
    });
    const alert = firstElement(
      tree,
      (element) => element.props.role === "alert",
    );
    assert.equal(
      alert.props.children,
      "This reset link is invalid or has expired.",
    );
    firstElement(tree, (element) => element.type === "form");
  });

  test("success: replaces the form with a status confirmation and a log-in link", () => {
    const tree = renderResetPasswordView({
      token: "raw-reset-token",
      state: { status: "success" },
      formAction: () => undefined,
      isPending: false,
    });
    const status = firstElement(
      tree,
      (element) => element.props.role === "status",
    );
    assert.match(status.props.children as string, /password has been reset/);
    const html = renderToStaticMarkup(tree);
    assert.match(html, /Log in/);
    assert.doesNotMatch(html, /<form/);
    assert.doesNotMatch(html, /raw-reset-token/);
  });
});

describe("ResetPasswordForm", () => {
  test("renders the idle form with the token wired through the real useActionState hook", () => {
    const renderer = createReactRenderHarness();
    try {
      const tree = renderer.run(() =>
        ResetPasswordForm({ token: "harness-token" }),
      );
      const html = renderToStaticMarkup(tree as ReactNode);
      assert.match(html, /harness-token/);
      assert.match(html, /Reset password/);
      assert.doesNotMatch(html, /role="alert"/);
    } finally {
      renderer.cleanup();
    }
  });
});
