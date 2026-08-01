import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, describe, test } from "node:test";
import { startTransition } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import "@/test/react-render-harness";
import { PROFILE_NAME_MAX_LENGTH } from "@/lib/account/profile-policy";
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_INPUT_MAX_LENGTH,
} from "@/lib/auth/password-policy";

type SignupFormTestState = {
  calls: FormData[];
  impl: (
    previous: string | undefined,
    payload: FormData,
  ) => Promise<string | undefined>;
};

const globalForTest = globalThis as typeof globalThis & {
  __signupFormTestState: SignupFormTestState;
};

function resetState() {
  globalForTest.__signupFormTestState = {
    calls: [],
    impl: async () => "Could not create account.",
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
const actionsStubUrl = "textiq-signup-form-actions:test";
const linkStubUrl = "textiq-signup-form-link:test";

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
          export async function register(previous, payload) {
            const state = globalThis.__signupFormTestState;
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

type SignupFormModule = typeof import("./signup-form");
let mod: SignupFormModule;

before(async () => {
  mod = await import("./signup-form");
});

beforeEach(resetState);

function waitForAsyncDrain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function mount(callbackUrl = "/app"): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<mod.SignupForm callbackUrl={callbackUrl} />);
  });
  return renderer;
}

function signupPayload(callbackUrl = "/app") {
  const payload = new FormData();
  payload.set("callbackUrl", callbackUrl);
  payload.set("name", "Ada");
  payload.set("email", "ada@example.com");
  payload.set("password", "password-123");
  return payload;
}

describe("SignupForm", () => {
  test("wires shared profile and password constraints into account creation", () => {
    const renderer = mount();
    try {
      const name = renderer.root.findByProps({ name: "name" });
      const password = renderer.root.findByProps({ name: "password" });
      assert.equal(name.props.maxLength, PROFILE_NAME_MAX_LENGTH);
      assert.equal(password.props.required, true);
      assert.equal(password.props.minLength, MIN_PASSWORD_LENGTH);
      assert.equal(password.props.maxLength, PASSWORD_INPUT_MAX_LENGTH);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("pending registration owns every editable identity and credential field", async () => {
    let resolvePending!: (result: string | undefined) => void;
    globalForTest.__signupFormTestState.impl = () =>
      new Promise((resolve) => {
        resolvePending = resolve;
      });
    const renderer = mount();
    try {
      act(() => {
        startTransition(() => {
          const action = renderer.root.findByType("form").props.action as (
            payload: FormData,
          ) => void;
          action(signupPayload());
        });
      });
      await act(async () => {
        await waitForAsyncDrain();
      });

      for (const name of ["name", "email", "password"]) {
        assert.equal(renderer.root.findByProps({ name }).props.disabled, true);
      }
      assert.equal(renderer.root.findByType("button").props.disabled, true);
      assert.equal(
        renderer.root.findByType("button").children.join(""),
        "Creating account…",
      );
    } finally {
      await act(async () => {
        resolvePending(undefined);
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      act(() => renderer.unmount());
    }
  });

  test("same-event repeated registration creates once and releases after ordinary failure", async () => {
    let resolveFirst!: (result: string | undefined) => void;
    globalForTest.__signupFormTestState.impl = async () => {
      if (globalForTest.__signupFormTestState.calls.length === 1) {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return "Duplicate registration request.";
    };
    const renderer = mount();
    try {
      const action = renderer.root.findByType("form").props.action as (
        payload: FormData,
      ) => void;
      const payload = signupPayload();
      act(() => {
        startTransition(() => {
          action(payload);
          action(payload);
        });
      });
      await act(async () => {
        await waitForAsyncDrain();
      });
      assert.equal(globalForTest.__signupFormTestState.calls.length, 1);

      await act(async () => {
        resolveFirst("Email is already registered.");
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      assert.equal(globalForTest.__signupFormTestState.calls.length, 1);
      assert.match(
        JSON.stringify(renderer.toJSON()),
        /Email is already registered\./,
      );
      assert.equal(renderer.root.findByType("button").props.disabled, false);

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
      assert.equal(globalForTest.__signupFormTestState.calls.length, 2);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("switching callback targets invalidates pending registration state and old feedback", async () => {
    let resolveOld!: (result: string | undefined) => void;
    globalForTest.__signupFormTestState.impl = async (_previous, payload) => {
      if (payload.get("callbackUrl") === "/app/old") {
        return new Promise((resolve) => {
          resolveOld = resolve;
        });
      }
      return "New callback registration feedback.";
    };
    const renderer = mount("/app/old");
    try {
      act(() => {
        startTransition(() => {
          const oldAction = renderer.root.findByType("form").props.action as (
            payload: FormData,
          ) => void;
          oldAction(signupPayload("/app/old"));
        });
      });
      await act(async () => {
        await waitForAsyncDrain();
      });

      act(() => {
        renderer.update(<mod.SignupForm callbackUrl="/app/new" />);
      });
      assert.equal(
        renderer.root.findByProps({ name: "callbackUrl" }).props.value,
        "/app/new",
      );
      assert.equal(renderer.root.findByType("button").props.disabled, false);

      act(() => {
        startTransition(() => {
          const newAction = renderer.root.findByType("form").props.action as (
            payload: FormData,
          ) => void;
          newAction(signupPayload("/app/new"));
        });
      });
      await act(async () => {
        await waitForAsyncDrain();
      });
      assert.deepEqual(
        globalForTest.__signupFormTestState.calls.map((payload) =>
          payload.get("callbackUrl"),
        ),
        ["/app/old", "/app/new"],
      );

      await act(async () => {
        resolveOld("Old callback registration feedback.");
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      const tree = JSON.stringify(renderer.toJSON());
      assert.match(tree, /New callback registration feedback\./);
      assert.doesNotMatch(tree, /Old callback registration feedback\./);
    } finally {
      act(() => renderer.unmount());
    }
  });
});
