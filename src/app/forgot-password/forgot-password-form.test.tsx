/**
 * Direct contract coverage for `ForgotPasswordForm` (issue #1927).
 *
 * `renderForgotPasswordView` is the pure state -> markup decision extracted
 * from the component so the "idle"/"sent"/"error" transitions, field
 * wiring, and pending/disabled submit behavior are unit-testable without
 * exercising `useActionState` (which needs a live action dispatch to move
 * between states). A single harness-rendered pass through the exported
 * `ForgotPasswordForm` component confirms the hook wiring itself still
 * produces the same idle markup the pure function predicts.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { createReactRenderHarness } from "@/test/react-render-harness";

import {
  ForgotPasswordForm,
  renderForgotPasswordView,
} from "./forgot-password-form";

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

describe("renderForgotPasswordView", () => {
  test("idle: renders the email field and an enabled submit button", () => {
    const calls: FormData[] = [];
    const tree = renderForgotPasswordView({
      state: { status: "idle" },
      formAction: (payload) => calls.push(payload),
      isPending: false,
    });
    const form = firstElement(tree, (element) => element.type === "form");
    assert.equal(typeof form.props.action, "function");
    const email = firstElement(
      tree,
      (element) => element.type === "input" && element.props.name === "email",
    );
    assert.equal(email.props.id, "email");
    assert.equal(email.props.type, "email");
    assert.equal(email.props.required, true);
    assert.equal(email.props.autoComplete, "email");
    const submit = firstElement(tree, (element) => element.type === "button");
    assert.equal(submit.props.disabled, false);
    assert.equal(submit.props.children, "Send reset link");
    const html = renderToStaticMarkup(tree);
    assert.doesNotMatch(html, /role="alert"/);
  });

  test("idle + pending: disables the submit button and shows the pending label", () => {
    const tree = renderForgotPasswordView({
      state: { status: "idle" },
      formAction: () => undefined,
      isPending: true,
    });
    const submit = firstElement(tree, (element) => element.type === "button");
    assert.equal(submit.props.disabled, true);
    assert.equal(submit.props.children, "Sending…");
  });

  test("error: renders the error message as an alert alongside the form", () => {
    const tree = renderForgotPasswordView({
      state: { status: "error", message: "Too many attempts. Try later." },
      formAction: () => undefined,
      isPending: false,
    });
    const alert = firstElement(
      tree,
      (element) => element.props.role === "alert",
    );
    assert.equal(alert.props.children, "Too many attempts. Try later.");
    // The form must still be present alongside the error.
    firstElement(tree, (element) => element.type === "form");
  });

  test("sent: replaces the form with a status confirmation and a back-to-login link", () => {
    const tree = renderForgotPasswordView({
      state: {
        status: "sent",
        message: "If an account exists, we sent a link.",
      },
      formAction: () => undefined,
      isPending: false,
    });
    const status = firstElement(
      tree,
      (element) => element.props.role === "status",
    );
    assert.equal(
      status.props.children,
      "If an account exists, we sent a link.",
    );
    const html = renderToStaticMarkup(tree);
    assert.match(html, /Back to log in/);
    assert.doesNotMatch(html, /<form/);
    assert.doesNotMatch(html, /Send reset link/);
  });
});

describe("ForgotPasswordForm", () => {
  test("renders the idle form through the real useActionState wiring", () => {
    const renderer = createReactRenderHarness();
    try {
      const tree = renderer.run(() => ForgotPasswordForm());
      const html = renderToStaticMarkup(tree as ReactNode);
      assert.match(html, /you@example\.com/);
      assert.match(html, /Send reset link/);
      assert.doesNotMatch(html, /role="alert"/);
    } finally {
      renderer.cleanup();
    }
  });
});
