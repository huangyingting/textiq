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
import { createRequire } from "node:module";
import { before, beforeEach, describe, test } from "node:test";
import {
  isValidElement,
  startTransition,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { createReactRenderHarness } from "@/test/react-render-harness";
import type { PasswordResult } from "@/lib/auth/form-state";

type PasswordFormTestState = {
  calls: FormData[];
  impl: (
    previous: PasswordResult | null,
    payload: FormData,
  ) => Promise<PasswordResult>;
};

const globalForTest = globalThis as typeof globalThis & {
  __passwordFormTestState: PasswordFormTestState;
};

function resetState() {
  globalForTest.__passwordFormTestState = {
    calls: [],
    impl: async () => ({ ok: false, error: "Password update failed." }),
  };
}

resetState();

type ModuleHooks = {
  registerHooks(hooks: {
    resolve(
      specifier: string,
      context: unknown,
      nextResolve: (specifier: string, context: unknown) => unknown,
    ): unknown;
    load(
      url: string,
      context: unknown,
      nextLoad: (url: string, context: unknown) => unknown,
    ): unknown;
  }): void;
};

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;
const actionsStubUrl = "textiq-password-form-actions:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./actions") {
      return { url: actionsStubUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === actionsStubUrl) {
      return {
        format: "module",
        source: `
          export async function changePassword(previous, payload) {
            const state = globalThis.__passwordFormTestState;
            state.calls.push(payload);
            return state.impl(previous, payload);
          }
        `,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

type PasswordFormModule = typeof import("./password-form");
let mod: PasswordFormModule;

before(async () => {
  mod = await import("./password-form");
});

beforeEach(resetState);

function waitForAsyncDrain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

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
    const tree = mod.renderPasswordFormView({
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
    const tree = mod.renderPasswordFormView({
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
    const tree = mod.renderPasswordFormView({
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
    assert.match(html, /you&#x27;ll be signed out after this change/i);
  });

  test("success while hasPassword: shows the 'Password updated.' message", () => {
    const tree = mod.renderPasswordFormView({
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
    const tree = mod.renderPasswordFormView({
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
    const tree = mod.renderPasswordFormView({
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
    const tree = mod.renderPasswordFormView({
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
    const tree = mod.renderPasswordFormView({
      hasPassword: false,
      state: null,
      formAction: () => undefined,
      isPending: false,
    });
    const submit = firstElement(tree, (element) => element.type === "button");
    assert.equal(submit.props.children, "Set password");
  });

  test("pending: disables the submit button and shows the pending label", () => {
    const tree = mod.renderPasswordFormView({
      hasPassword: true,
      state: null,
      formAction: () => undefined,
      isPending: true,
    });
    const submit = firstElement(tree, (element) => element.type === "button");
    const passwordFields = collectElements(tree).filter(
      (element) =>
        element.type === "input" && element.props.type === "password",
    );
    assert.equal(passwordFields.length, 3);
    assert.ok(passwordFields.every((field) => field.props.disabled === true));
    assert.equal(submit.props.disabled, true);
    assert.equal(submit.props.children, "Saving…");
  });
});

describe("PasswordForm", () => {
  test("pending password change owns secrets, suppresses duplicate dispatch, and stays terminal through sign-out", async () => {
    let resolveFirst!: (result: PasswordResult) => void;
    globalForTest.__passwordFormTestState.impl = async () => {
      if (globalForTest.__passwordFormTestState.calls.length === 1) {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return { ok: false, error: "Duplicate password change." };
    };
    let resetCount = 0;
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<mod.PasswordForm hasPassword />, {
        createNodeMock: (element) =>
          element.type === "form" ? { reset: () => (resetCount += 1) } : {},
      });
    });
    try {
      const action = renderer.root.findByType("form").props.action as (
        payload: FormData,
      ) => void;
      const payload = new FormData();
      payload.set("currentPassword", "current-secret");
      payload.set("newPassword", "new-secret-123");
      payload.set("confirmPassword", "new-secret-123");

      act(() => {
        startTransition(() => {
          action(payload);
          action(payload);
        });
      });
      await act(async () => {
        await waitForAsyncDrain();
      });
      assert.equal(globalForTest.__passwordFormTestState.calls.length, 1);
      assert.ok(
        renderer.root
          .findAllByType("input")
          .filter((input) => input.props.type === "password")
          .every((input) => input.props.disabled === true),
      );

      await act(async () => {
        resolveFirst({ ok: true, data: undefined });
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      assert.equal(globalForTest.__passwordFormTestState.calls.length, 1);
      assert.equal(resetCount, 1);
      assert.match(JSON.stringify(renderer.toJSON()), /Password updated\./);
      assert.equal(renderer.root.findByType("button").props.disabled, true);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("a rejected password change releases ownership for a corrected retry", async () => {
    globalForTest.__passwordFormTestState.impl = async () =>
      globalForTest.__passwordFormTestState.calls.length === 1
        ? { ok: false, error: "Current password is incorrect." }
        : { ok: true, data: undefined };
    let resetCount = 0;
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<mod.PasswordForm hasPassword />, {
        createNodeMock: (element) =>
          element.type === "form" ? { reset: () => (resetCount += 1) } : {},
      });
    });
    try {
      const payload = new FormData();
      payload.set("currentPassword", "incorrect");
      payload.set("newPassword", "new-secret-123");
      payload.set("confirmPassword", "new-secret-123");
      act(() => {
        startTransition(() => {
          const action = renderer.root.findByType("form").props.action as (
            formData: FormData,
          ) => void;
          action(payload);
        });
      });
      await act(async () => {
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      assert.match(
        JSON.stringify(renderer.toJSON()),
        /Current password is incorrect\./,
      );
      assert.equal(renderer.root.findByType("button").props.disabled, false);
      assert.equal(resetCount, 0);

      payload.set("currentPassword", "correct");
      act(() => {
        startTransition(() => {
          const retryAction = renderer.root.findByType("form").props.action as (
            formData: FormData,
          ) => void;
          retryAction(payload);
        });
      });
      await act(async () => {
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      assert.equal(globalForTest.__passwordFormTestState.calls.length, 2);
      assert.equal(resetCount, 1);
      assert.equal(renderer.root.findByType("button").props.disabled, true);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("renders the idle, hasPassword form through the real useActionState wiring", () => {
    const renderer = createReactRenderHarness();
    try {
      const tree = renderer.run(() => mod.PasswordForm({ hasPassword: true }));
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
      const tree = renderer.run(() => mod.PasswordForm({ hasPassword: false }));
      const html = renderToStaticMarkup(tree as ReactNode);
      assert.match(html, /You signed in with Google/);
      assert.match(html, /Set password/);
    } finally {
      renderer.cleanup();
    }
  });
});
