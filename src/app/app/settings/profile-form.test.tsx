/**
 * Direct contract coverage for `ProfileForm` (issue #1928).
 *
 * `renderProfileFormView` is the pure state -> markup decision extracted
 * from the component so the read-only email field, the display-name
 * default, and the success/error/pending mapping are unit-testable without
 * exercising `useActionState` (which needs a live action dispatch to move
 * between states). A single harness-rendered pass through the exported
 * `ProfileForm` component confirms the hook wiring itself still produces the
 * same idle markup the pure function predicts.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { createReactRenderHarness } from "@/test/react-render-harness";

import { ProfileForm, renderProfileFormView } from "./profile-form";

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

describe("renderProfileFormView", () => {
  test("email field is read-only, disabled, and carries the given value", () => {
    const tree = renderProfileFormView({
      initialName: "Ada",
      email: "ada@example.com",
      state: null,
      formAction: () => undefined,
      isPending: false,
    });
    const email = firstElement(
      tree,
      (element) => element.type === "input" && element.props.type === "email",
    );
    assert.equal(email.props.value, "ada@example.com");
    assert.equal(email.props.readOnly, true);
    assert.equal(email.props.disabled, true);
  });

  test("display-name field defaults to initialName and is editable", () => {
    const tree = renderProfileFormView({
      initialName: "Ada",
      email: "ada@example.com",
      state: null,
      formAction: () => undefined,
      isPending: false,
    });
    const name = firstElement(
      tree,
      (element) => element.type === "input" && element.props.name === "name",
    );
    assert.equal(name.props.defaultValue, "Ada");
    assert.equal(name.props.maxLength, 100);
    assert.equal(name.props.readOnly, undefined);
    assert.equal(name.props.disabled, undefined);
  });

  test("idle: renders no status/alert message", () => {
    const tree = renderProfileFormView({
      initialName: "Ada",
      email: "ada@example.com",
      state: null,
      formAction: () => undefined,
      isPending: false,
    });
    const html = renderToStaticMarkup(tree);
    assert.doesNotMatch(html, /role="status"/);
    assert.doesNotMatch(html, /role="alert"/);
  });

  test("success: renders the 'Profile updated.' status message", () => {
    const tree = renderProfileFormView({
      initialName: "Ada",
      email: "ada@example.com",
      state: { ok: true, data: { name: "Ada" } },
      formAction: () => undefined,
      isPending: false,
    });
    const status = firstElement(
      tree,
      (element) => element.props.role === "status",
    );
    assert.equal(status.props.children, "Profile updated.");
  });

  test("error: renders the server message as an alert", () => {
    const tree = renderProfileFormView({
      initialName: "Ada",
      email: "ada@example.com",
      state: { ok: false, error: "Name is too long." },
      formAction: () => undefined,
      isPending: false,
    });
    const alert = firstElement(
      tree,
      (element) => element.props.role === "alert",
    );
    assert.equal(alert.props.children, "Name is too long.");
  });

  test("idle: the submit button is enabled and reads 'Save changes'", () => {
    const tree = renderProfileFormView({
      initialName: "Ada",
      email: "ada@example.com",
      state: null,
      formAction: () => undefined,
      isPending: false,
    });
    const submit = firstElement(tree, (element) => element.type === "button");
    assert.equal(submit.props.disabled, false);
    assert.equal(submit.props.children, "Save changes");
  });

  test("pending: disables the submit button and shows 'Saving…'", () => {
    const tree = renderProfileFormView({
      initialName: "Ada",
      email: "ada@example.com",
      state: null,
      formAction: () => undefined,
      isPending: true,
    });
    const submit = firstElement(tree, (element) => element.type === "button");
    assert.equal(submit.props.disabled, true);
    assert.equal(submit.props.children, "Saving…");
  });
});

describe("ProfileForm", () => {
  test("renders the idle form through the real useActionState wiring", () => {
    const renderer = createReactRenderHarness();
    try {
      const tree = renderer.run(() =>
        ProfileForm({ initialName: "Ada", email: "ada@example.com" }),
      );
      const html = renderToStaticMarkup(tree as ReactNode);
      assert.match(html, /ada@example\.com/);
      assert.match(html, /value="Ada"/);
      assert.match(html, /Save changes/);
      assert.doesNotMatch(html, /role="alert"/);
    } finally {
      renderer.cleanup();
    }
  });
});
