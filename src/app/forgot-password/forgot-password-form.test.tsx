/**
 * Direct contract coverage for `ForgotPasswordForm` (issue #1927).
 *
 * `renderForgotPasswordView` is the pure state -> markup decision extracted
 * from the component so the "idle"/"sent"/"error" transitions, field
 * wiring, and pending/disabled submit behavior are unit-testable directly.
 * A mounted lifecycle regression exercises `useActionState` to prove repeated
 * same-event submission sends one email and cannot overwrite terminal sent
 * feedback.
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
import type { ForgotPasswordState } from "@/lib/auth/form-state";

type ForgotPasswordFormTestState = {
  calls: FormData[];
  impl: (
    previous: ForgotPasswordState,
    payload: FormData,
  ) => Promise<ForgotPasswordState>;
};

const globalForTest = globalThis as typeof globalThis & {
  __forgotPasswordFormTestState: ForgotPasswordFormTestState;
};

function resetState() {
  globalForTest.__forgotPasswordFormTestState = {
    calls: [],
    impl: async () => ({ status: "error", message: "Request failed." }),
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
const actionsStubUrl = "textiq-forgot-password-form-actions:test";
const linkStubUrl = "textiq-forgot-password-form-link:test";

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
          export async function requestPasswordReset(previous, payload) {
            const state = globalThis.__forgotPasswordFormTestState;
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

type ForgotPasswordFormModule = typeof import("./forgot-password-form");
let mod: ForgotPasswordFormModule;

before(async () => {
  mod = await import("./forgot-password-form");
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

describe("renderForgotPasswordView", () => {
  test("idle: renders the email field and an enabled submit button", () => {
    const calls: FormData[] = [];
    const tree = mod.renderForgotPasswordView({
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

  test("idle + pending: owns the email field and submit control", () => {
    const tree = mod.renderForgotPasswordView({
      state: { status: "idle" },
      formAction: () => undefined,
      isPending: true,
    });
    const email = firstElement(
      tree,
      (element) => element.type === "input" && element.props.name === "email",
    );
    const submit = firstElement(tree, (element) => element.type === "button");
    assert.equal(email.props.disabled, true);
    assert.equal(submit.props.disabled, true);
    assert.equal(submit.props.children, "Sending…");
  });

  test("error: renders the error message as an alert alongside the form", () => {
    const tree = mod.renderForgotPasswordView({
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
    const tree = mod.renderForgotPasswordView({
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
  test("same-event repeated submission sends one reset request and preserves terminal confirmation", async () => {
    let resolveFirst!: (state: ForgotPasswordState) => void;
    globalForTest.__forgotPasswordFormTestState.impl = async () => {
      if (globalForTest.__forgotPasswordFormTestState.calls.length === 1) {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return { status: "error", message: "Duplicate reset email request." };
    };

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<mod.ForgotPasswordForm />);
    });
    try {
      const action = renderer.root.findByType("form").props.action as (
        payload: FormData,
      ) => void;
      const payload = new FormData();
      payload.set("email", "ada@example.com");
      act(() => {
        startTransition(() => {
          action(payload);
          action(payload);
        });
      });
      await act(async () => {
        await waitForAsyncDrain();
      });
      assert.equal(globalForTest.__forgotPasswordFormTestState.calls.length, 1);

      await act(async () => {
        resolveFirst({
          status: "sent",
          message: "If an account exists, we sent a link.",
        });
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });

      assert.equal(globalForTest.__forgotPasswordFormTestState.calls.length, 1);
      assert.match(
        JSON.stringify(renderer.toJSON()),
        /If an account exists, we sent a link\./,
      );
      assert.equal(renderer.root.findAllByType("form").length, 0);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("renders the idle form through the real useActionState wiring", () => {
    const renderer = createReactRenderHarness();
    try {
      const tree = renderer.run(() => mod.ForgotPasswordForm());
      const html = renderToStaticMarkup(tree as ReactNode);
      assert.match(html, /you@example\.com/);
      assert.match(html, /Send reset link/);
      assert.doesNotMatch(html, /role="alert"/);
    } finally {
      renderer.cleanup();
    }
  });
});
