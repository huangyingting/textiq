/**
 * Direct contract coverage for `ResetPasswordForm` (issue #1927).
 *
 * `renderResetPasswordView` is the pure state -> markup decision extracted
 * from the component so the "idle"/"success"/"error" transitions, the
 * hidden token wiring, field labels/values, and pending/disabled submit
 * behavior are unit-testable independently. Mounted lifecycle regressions
 * exercise `useActionState` directly to prove duplicate consumption cannot
 * overwrite success and a token identity change resets pending/result state
 * while rejecting the old token's late completion.
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
import type { ResetPasswordState } from "@/lib/auth/form-state";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";

type ResetPasswordFormTestState = {
  calls: FormData[];
  impl: (
    previous: ResetPasswordState,
    payload: FormData,
  ) => Promise<ResetPasswordState>;
};

const globalForTest = globalThis as typeof globalThis & {
  __resetPasswordFormTestState: ResetPasswordFormTestState;
};

function resetState() {
  globalForTest.__resetPasswordFormTestState = {
    calls: [],
    impl: async () => ({ status: "error", message: "Reset failed." }),
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
const actionsStubUrl = "textiq-reset-password-form-actions:test";
const linkStubUrl = "textiq-reset-password-form-link:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./actions") {
      return { url: actionsStubUrl, shortCircuit: true };
    }
    if (specifier === "next/link") {
      return { url: linkStubUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === actionsStubUrl) {
      return {
        format: "module",
        source: `
          export async function resetPassword(previous, payload) {
            const state = globalThis.__resetPasswordFormTestState;
            state.calls.push(payload);
            return state.impl(previous, payload);
          }
        `,
        shortCircuit: true,
      };
    }
    if (url === linkStubUrl) {
      return {
        format: "module",
        source: `
          import { createElement } from "react";
          export default function Link({ children, ...props }) {
            return createElement("a", props, children);
          }
        `,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

type ResetPasswordFormModule = typeof import("./reset-password-form");
let mod: ResetPasswordFormModule;

before(async () => {
  mod = await import("./reset-password-form");
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

describe("renderResetPasswordView", () => {
  test("idle: carries the token in a hidden input and wires both password fields", () => {
    const tree = mod.renderResetPasswordView({
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
    const tree = mod.renderResetPasswordView({
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
    const tree = mod.renderResetPasswordView({
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
    const tree = mod.renderResetPasswordView({
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
    const tree = mod.renderResetPasswordView({
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
  test("same-event repeated submission cannot overwrite success after consuming the token", async () => {
    let resolveFirst!: (state: ResetPasswordState) => void;
    globalForTest.__resetPasswordFormTestState.impl = async () => {
      if (globalForTest.__resetPasswordFormTestState.calls.length === 1) {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return {
        status: "error",
        message: "This reset link has already been used.",
      };
    };

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<mod.ResetPasswordForm token="single-use-token" />);
    });
    try {
      const action = renderer.root.findByType("form").props.action as (
        payload: FormData,
      ) => void;
      const payload = new FormData();
      payload.set("token", "single-use-token");
      payload.set("newPassword", "new-password-123");
      payload.set("confirmPassword", "new-password-123");

      act(() => {
        startTransition(() => {
          action(payload);
          action(payload);
        });
      });
      await act(async () => {
        await waitForAsyncDrain();
      });
      assert.equal(globalForTest.__resetPasswordFormTestState.calls.length, 1);

      await act(async () => {
        resolveFirst({ status: "success" });
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });

      assert.equal(globalForTest.__resetPasswordFormTestState.calls.length, 1);
      assert.match(
        JSON.stringify(renderer.toJSON()),
        /Your password has been reset\./,
      );
      assert.equal(renderer.root.findAllByType("form").length, 0);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("switching reset tokens invalidates the pending action and result from the old token", async () => {
    let resolveOld!: (state: ResetPasswordState) => void;
    globalForTest.__resetPasswordFormTestState.impl = async (
      _previous,
      payload,
    ) => {
      if (payload.get("token") === "token-old") {
        return new Promise((resolve) => {
          resolveOld = resolve;
        });
      }
      return { status: "error", message: "New token retry feedback." };
    };

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<mod.ResetPasswordForm token="token-old" />);
    });
    try {
      const oldAction = renderer.root.findByType("form").props.action as (
        payload: FormData,
      ) => void;
      const oldPayload = new FormData();
      oldPayload.set("token", "token-old");
      oldPayload.set("newPassword", "old-password-123");
      oldPayload.set("confirmPassword", "old-password-123");
      act(() => {
        startTransition(() => oldAction(oldPayload));
      });
      await act(async () => {
        await waitForAsyncDrain();
      });

      act(() => {
        renderer.update(<mod.ResetPasswordForm token="token-new" />);
      });
      const newTokenInput = renderer.root.findByProps({ name: "token" });
      assert.equal(newTokenInput.props.value, "token-new");
      assert.equal(renderer.root.findByType("button").props.disabled, false);

      const newPayload = new FormData();
      newPayload.set("token", "token-new");
      newPayload.set("newPassword", "new-password-123");
      newPayload.set("confirmPassword", "new-password-123");
      act(() => {
        startTransition(() => {
          const newAction = renderer.root.findByType("form").props.action as (
            payload: FormData,
          ) => void;
          newAction(newPayload);
        });
      });
      await act(async () => {
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      assert.deepEqual(
        globalForTest.__resetPasswordFormTestState.calls.map((payload) =>
          payload.get("token"),
        ),
        ["token-old", "token-new"],
      );
      await act(async () => {
        resolveOld({ status: "success" });
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      const finalTree = JSON.stringify(renderer.toJSON());
      assert.match(finalTree, /New token retry feedback/);
      assert.doesNotMatch(finalTree, /Your password has been reset/);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("renders the idle form with the token wired through the real useActionState hook", () => {
    const renderer = createReactRenderHarness();
    try {
      const tree = renderer.run(() =>
        mod.ResetPasswordForm({ token: "harness-token" }),
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
