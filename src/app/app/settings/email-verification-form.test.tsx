/**
 * Direct contract coverage for `EmailVerificationForm` (issue #1928).
 *
 * `renderEmailVerificationView` is the pure state -> markup decision
 * extracted from the component so the "sent"/"already_verified"/error
 * transitions and pending/disabled submit behavior are unit-testable
 * without exercising `useActionState` (which needs a live action dispatch
 * to move between states). A single harness-rendered pass through the
 * exported `EmailVerificationForm` component confirms the hook wiring
 * itself still produces the same idle markup the pure function predicts.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { createReactRenderHarness } from "@/test/react-render-harness";

import {
  EmailVerificationForm,
  renderEmailVerificationView,
} from "./email-verification-form";

type ElementLike = ReactElement<Record<string, unknown>>;

function collectElements(node: ReactNode, collected: ElementLike[] = []) {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, collected);
    return collected;
  }
  if (!isValidElement(node)) return collected;
  const element = node as ElementLike;
  collected.push(element);
  // Expand pure function components (AuthMessage/AuthSubmitButton) so the
  // host elements they render are visible to assertions below.
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

describe("renderEmailVerificationView", () => {
  test("idle: renders an enabled submit button and no message", () => {
    const tree = renderEmailVerificationView({
      state: null,
      formAction: () => undefined,
      isPending: false,
    });
    const submit = firstElement(tree, (element) => element.type === "button");
    assert.equal(submit.props.disabled, false);
    assert.equal(submit.props.children, "Send verification email");
    const html = renderToStaticMarkup(tree);
    assert.doesNotMatch(html, /role="status"/);
    assert.doesNotMatch(html, /role="alert"/);
  });

  test("idle + pending: disables the submit button and shows 'Sending…'", () => {
    const tree = renderEmailVerificationView({
      state: null,
      formAction: () => undefined,
      isPending: true,
    });
    const submit = firstElement(tree, (element) => element.type === "button");
    assert.equal(submit.props.disabled, true);
    assert.equal(submit.props.children, "Sending…");
  });

  test("sent: shows the 'check your inbox' success message", () => {
    const tree = renderEmailVerificationView({
      state: { ok: true, data: { status: "sent" } },
      formAction: () => undefined,
      isPending: false,
    });
    const status = firstElement(
      tree,
      (element) => element.props.role === "status",
    );
    assert.match(String(status.props.children), /Check your inbox/);
  });

  test("already_verified: shows the 'already verified' success message", () => {
    const tree = renderEmailVerificationView({
      state: { ok: true, data: { status: "already_verified" } },
      formAction: () => undefined,
      isPending: false,
    });
    const status = firstElement(
      tree,
      (element) => element.props.role === "status",
    );
    assert.equal(status.props.children, "Your email is already verified.");
  });

  test("error: renders the server message as an alert alongside the form", () => {
    const tree = renderEmailVerificationView({
      state: { ok: false, error: "Too many requests. Try later." },
      formAction: () => undefined,
      isPending: false,
    });
    const alert = firstElement(
      tree,
      (element) => element.props.role === "alert",
    );
    assert.equal(alert.props.children, "Too many requests. Try later.");
    // The submit button must still be present alongside the error.
    firstElement(tree, (element) => element.type === "button");
  });
});

describe("EmailVerificationForm", () => {
  test("renders the idle form through the real useActionState wiring", () => {
    const renderer = createReactRenderHarness();
    try {
      const tree = renderer.run(() => EmailVerificationForm());
      const html = renderToStaticMarkup(tree as ReactNode);
      assert.match(html, /Send verification email/);
      assert.doesNotMatch(html, /role="alert"/);
    } finally {
      renderer.cleanup();
    }
  });
});
