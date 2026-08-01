import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, describe, test } from "node:test";
import {
  isValidElement,
  startTransition,
  type ReactElement,
  type ReactNode,
} from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import "@/test/react-render-harness";

type LoginFormTestState = {
  calls: FormData[];
  impl: (
    previous: string | undefined,
    payload: FormData,
  ) => Promise<string | undefined>;
};

const globalForTest = globalThis as typeof globalThis & {
  __loginFormTestState: LoginFormTestState;
};

function resetState() {
  globalForTest.__loginFormTestState = {
    calls: [],
    impl: async () => "Invalid email or password.",
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
const actionsStubUrl = "textiq-login-form-actions:test";
const linkStubUrl = "textiq-login-form-link:test";

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
          export async function authenticate(previous, payload) {
            const state = globalThis.__loginFormTestState;
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

type LoginFormModule = typeof import("./login-form");
let mod: LoginFormModule;

before(async () => {
  mod = await import("./login-form");
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

function renderView(
  overrides: Partial<
    Parameters<LoginFormModule["renderLoginFormView"]>[0]
  > = {},
) {
  return mod.renderLoginFormView({
    callbackUrl: "/app/documents/doc-1",
    errorMessage: undefined,
    formAction: () => undefined,
    isPending: false,
    email: "owner@example.com",
    onEmailChange: () => undefined,
    ...overrides,
  });
}

describe("renderLoginFormView", () => {
  test("keeps email controlled for retries while never retaining the password", () => {
    const onEmailChange = () => undefined;
    const tree = renderView({ onEmailChange });
    const email = firstElement(
      tree,
      (element) => element.type === "input" && element.props.name === "email",
    );
    const password = firstElement(
      tree,
      (element) =>
        element.type === "input" && element.props.name === "password",
    );

    assert.equal(email.props.value, "owner@example.com");
    assert.equal(email.props.onChange, onEmailChange);
    assert.equal(password.props.value, undefined);
    assert.equal(password.props.defaultValue, undefined);
  });

  test("preserves the safe callback target and renders a generic error as an alert", () => {
    const tree = renderView({ errorMessage: "Invalid email or password." });
    const callback = firstElement(
      tree,
      (element) =>
        element.type === "input" && element.props.name === "callbackUrl",
    );
    const alert = firstElement(
      tree,
      (element) => element.props.role === "alert",
    );

    assert.equal(callback.props.value, "/app/documents/doc-1");
    assert.equal(alert.props.children, "Invalid email or password.");
  });

  test("pending owns both credential fields and the submit control", () => {
    const tree = renderView({ isPending: true });
    const email = firstElement(
      tree,
      (element) => element.type === "input" && element.props.name === "email",
    );
    const password = firstElement(
      tree,
      (element) =>
        element.type === "input" && element.props.name === "password",
    );
    const submit = firstElement(
      tree,
      (element) => element.type === "button" && element.props.type === "submit",
    );
    assert.equal(email.props.disabled, true);
    assert.equal(password.props.disabled, true);
    assert.equal(submit.props.disabled, true);
    assert.equal(submit.props.children, "Signing in…");
  });
});

describe("LoginForm", () => {
  test("same-event repeated login dispatch authenticates once and releases after ordinary failure", async () => {
    let resolveFirst!: (result: string | undefined) => void;
    globalForTest.__loginFormTestState.impl = async () => {
      if (globalForTest.__loginFormTestState.calls.length === 1) {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return "Duplicate authentication request.";
    };
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<mod.LoginForm callbackUrl="/app" />);
    });
    try {
      const email = renderer.root.findByProps({ name: "email" });
      act(() => {
        email.props.onChange({ currentTarget: { value: "ada@example.com" } });
      });
      const payload = new FormData();
      payload.set("callbackUrl", "/app");
      payload.set("email", "ada@example.com");
      payload.set("password", "password-123");
      const action = renderer.root.findByType("form").props.action as (
        formData: FormData,
      ) => void;
      act(() => {
        startTransition(() => {
          action(payload);
          action(payload);
        });
      });
      await act(async () => {
        await waitForAsyncDrain();
      });
      assert.equal(globalForTest.__loginFormTestState.calls.length, 1);

      await act(async () => {
        resolveFirst("Invalid email or password.");
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      assert.equal(globalForTest.__loginFormTestState.calls.length, 1);
      assert.match(
        JSON.stringify(renderer.toJSON()),
        /Invalid email or password\./,
      );
      assert.equal(
        renderer.root.findByProps({ name: "email" }).props.disabled,
        false,
      );

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
      assert.equal(globalForTest.__loginFormTestState.calls.length, 2);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("switching callback targets invalidates pending login state and the old result", async () => {
    let resolveOld!: (result: string | undefined) => void;
    globalForTest.__loginFormTestState.impl = async (_previous, payload) => {
      if (payload.get("callbackUrl") === "/app/old") {
        return new Promise((resolve) => {
          resolveOld = resolve;
        });
      }
      return "New callback login feedback.";
    };
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<mod.LoginForm callbackUrl="/app/old" />);
    });
    try {
      const oldPayload = new FormData();
      oldPayload.set("callbackUrl", "/app/old");
      oldPayload.set("email", "ada@example.com");
      oldPayload.set("password", "password-123");
      act(() => {
        startTransition(() => {
          const oldAction = renderer.root.findByType("form").props.action as (
            formData: FormData,
          ) => void;
          oldAction(oldPayload);
        });
      });
      await act(async () => {
        await waitForAsyncDrain();
      });

      act(() => {
        renderer.update(<mod.LoginForm callbackUrl="/app/new" />);
      });
      assert.equal(
        renderer.root.findByProps({ name: "callbackUrl" }).props.value,
        "/app/new",
      );
      assert.equal(renderer.root.findByType("button").props.disabled, false);

      const newPayload = new FormData();
      newPayload.set("callbackUrl", "/app/new");
      newPayload.set("email", "ada@example.com");
      newPayload.set("password", "password-123");
      act(() => {
        startTransition(() => {
          const newAction = renderer.root.findByType("form").props.action as (
            formData: FormData,
          ) => void;
          newAction(newPayload);
        });
      });
      await act(async () => {
        await waitForAsyncDrain();
      });
      assert.deepEqual(
        globalForTest.__loginFormTestState.calls.map((payload) =>
          payload.get("callbackUrl"),
        ),
        ["/app/old", "/app/new"],
      );

      await act(async () => {
        resolveOld("Old callback login feedback.");
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      const tree = JSON.stringify(renderer.toJSON());
      assert.match(tree, /New callback login feedback\./);
      assert.doesNotMatch(tree, /Old callback login feedback\./);
    } finally {
      act(() => renderer.unmount());
    }
  });
});
