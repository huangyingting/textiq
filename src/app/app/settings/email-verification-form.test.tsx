/**
 * Direct contract coverage for `EmailVerificationForm` (issue #1928).
 *
 * `renderEmailVerificationView` is the pure state -> markup decision
 * extracted from the component so the "sent"/"already_verified"/error
 * transitions and pending/disabled submit behavior are unit-testable
 * directly. A mounted lifecycle regression exercises `useActionState` to
 * prove repeated same-event submission sends once while a later deliberate
 * resend remains available.
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
import type { VerifyEmailResult } from "@/lib/auth/form-state";

type EmailVerificationFormTestState = {
  calls: FormData[];
  impl: (
    previous: VerifyEmailResult | null,
    payload: FormData,
  ) => Promise<VerifyEmailResult>;
};

const globalForTest = globalThis as typeof globalThis & {
  __emailVerificationFormTestState: EmailVerificationFormTestState;
};

function resetState() {
  globalForTest.__emailVerificationFormTestState = {
    calls: [],
    impl: async () => ({ ok: false, error: "Verification request failed." }),
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
const actionsStubUrl = "textiq-email-verification-form-actions:test";

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
          export async function requestEmailVerification(previous, payload) {
            const state = globalThis.__emailVerificationFormTestState;
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

type EmailVerificationFormModule = typeof import("./email-verification-form");
let mod: EmailVerificationFormModule;

before(async () => {
  mod = await import("./email-verification-form");
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
    const tree = mod.renderEmailVerificationView({
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
    const tree = mod.renderEmailVerificationView({
      state: null,
      formAction: () => undefined,
      isPending: true,
    });
    const submit = firstElement(tree, (element) => element.type === "button");
    assert.equal(submit.props.disabled, true);
    assert.equal(submit.props.children, "Sending…");
  });

  test("sent: shows the 'check your inbox' success message", () => {
    const tree = mod.renderEmailVerificationView({
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
    const tree = mod.renderEmailVerificationView({
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
    const tree = mod.renderEmailVerificationView({
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
  test("same-event repeated submission sends once, then permits a deliberate resend after settlement", async () => {
    let resolveFirst!: (result: VerifyEmailResult) => void;
    globalForTest.__emailVerificationFormTestState.impl = async () => {
      if (globalForTest.__emailVerificationFormTestState.calls.length === 1) {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return { ok: true, data: { status: "already_verified" } };
    };

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<mod.EmailVerificationForm />);
    });
    try {
      const firstAction = renderer.root.findByType("form").props.action as (
        payload: FormData,
      ) => void;
      const payload = new FormData();
      act(() => {
        startTransition(() => {
          firstAction(payload);
          firstAction(payload);
        });
      });
      await act(async () => {
        await waitForAsyncDrain();
      });
      assert.equal(
        globalForTest.__emailVerificationFormTestState.calls.length,
        1,
      );

      await act(async () => {
        resolveFirst({ ok: true, data: { status: "sent" } });
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      assert.equal(
        globalForTest.__emailVerificationFormTestState.calls.length,
        1,
      );
      assert.match(JSON.stringify(renderer.toJSON()), /Check your inbox/);

      act(() => {
        startTransition(() => {
          const retryAction = renderer.root.findByType("form").props.action as (
            retryPayload: FormData,
          ) => void;
          retryAction(payload);
        });
      });
      await act(async () => {
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      assert.equal(
        globalForTest.__emailVerificationFormTestState.calls.length,
        2,
      );
      assert.match(
        JSON.stringify(renderer.toJSON()),
        /Your email is already verified/,
      );
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("renders the idle form through the real useActionState wiring", () => {
    const renderer = createReactRenderHarness();
    try {
      const tree = renderer.run(() => mod.EmailVerificationForm());
      const html = renderToStaticMarkup(tree as ReactNode);
      assert.match(html, /Send verification email/);
      assert.doesNotMatch(html, /role="alert"/);
    } finally {
      renderer.cleanup();
    }
  });
});
