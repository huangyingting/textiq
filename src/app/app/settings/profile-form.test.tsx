/**
 * Direct contract coverage for `ProfileForm` (issue #1928).
 *
 * `renderProfileFormView` is the pure state -> markup decision extracted
 * from the component so the read-only email field, the display-name
 * default, and the success/error/pending mapping are unit-testable directly.
 * A mounted lifecycle regression exercises `useActionState` to prove
 * same-event duplicate saves collapse into one write while later intentional
 * edits remain saveable.
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
import type { ProfileResult } from "@/lib/auth/form-state";
import { PROFILE_NAME_MAX_LENGTH } from "@/lib/account/profile-policy";

type ProfileFormTestState = {
  calls: FormData[];
  impl: (
    previous: ProfileResult | null,
    payload: FormData,
  ) => Promise<ProfileResult>;
};

const globalForTest = globalThis as typeof globalThis & {
  __profileFormTestState: ProfileFormTestState;
};

function resetState() {
  globalForTest.__profileFormTestState = {
    calls: [],
    impl: async () => ({ ok: false, error: "Profile update failed." }),
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
const actionsStubUrl = "textiq-profile-form-actions:test";

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
          export async function updateProfile(previous, payload) {
            const state = globalThis.__profileFormTestState;
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

type ProfileFormModule = typeof import("./profile-form");
let mod: ProfileFormModule;

before(async () => {
  mod = await import("./profile-form");
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
    const tree = mod.renderProfileFormView({
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
    const tree = mod.renderProfileFormView({
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
    assert.equal(name.props.maxLength, PROFILE_NAME_MAX_LENGTH);
    assert.equal(name.props.readOnly, undefined);
    assert.equal(name.props.disabled, false);
  });

  test("idle: renders no status/alert message", () => {
    const tree = mod.renderProfileFormView({
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
    const tree = mod.renderProfileFormView({
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
    const tree = mod.renderProfileFormView({
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
    const tree = mod.renderProfileFormView({
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

  test("pending: owns the display-name field and submit control", () => {
    const tree = mod.renderProfileFormView({
      initialName: "Ada",
      email: "ada@example.com",
      state: null,
      formAction: () => undefined,
      isPending: true,
    });
    const name = firstElement(
      tree,
      (element) => element.type === "input" && element.props.name === "name",
    );
    const submit = firstElement(tree, (element) => element.type === "button");
    assert.equal(name.props.disabled, true);
    assert.equal(submit.props.disabled, true);
    assert.equal(submit.props.children, "Saving…");
  });
});

describe("ProfileForm", () => {
  test("same-event repeated save performs one update and permits a later deliberate save", async () => {
    let resolveFirst!: (result: ProfileResult) => void;
    globalForTest.__profileFormTestState.impl = async (_previous, payload) => {
      if (globalForTest.__profileFormTestState.calls.length === 1) {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return { ok: true, data: { name: String(payload.get("name")) } };
    };

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <mod.ProfileForm initialName="Ada" email="ada@example.com" />,
      );
    });
    try {
      const firstAction = renderer.root.findByType("form").props.action as (
        payload: FormData,
      ) => void;
      const firstPayload = new FormData();
      firstPayload.set("name", "Ada One");
      act(() => {
        startTransition(() => {
          firstAction(firstPayload);
          firstAction(firstPayload);
        });
      });
      await act(async () => {
        await waitForAsyncDrain();
      });
      assert.equal(globalForTest.__profileFormTestState.calls.length, 1);

      await act(async () => {
        resolveFirst({ ok: true, data: { name: "Ada One" } });
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      assert.equal(globalForTest.__profileFormTestState.calls.length, 1);
      assert.match(JSON.stringify(renderer.toJSON()), /Profile updated\./);

      const secondPayload = new FormData();
      secondPayload.set("name", "Ada Two");
      act(() => {
        startTransition(() => {
          const secondAction = renderer.root.findByType("form").props
            .action as (payload: FormData) => void;
          secondAction(secondPayload);
        });
      });
      await act(async () => {
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      assert.deepEqual(
        globalForTest.__profileFormTestState.calls.map((payload) =>
          payload.get("name"),
        ),
        ["Ada One", "Ada Two"],
      );
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("renders the idle form through the real useActionState wiring", () => {
    const renderer = createReactRenderHarness();
    try {
      const tree = renderer.run(() =>
        mod.ProfileForm({ initialName: "Ada", email: "ada@example.com" }),
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
