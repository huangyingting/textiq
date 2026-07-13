/**
 * Direct behavior coverage for `SignOutButton` (#1964) — the
 * `"use server"` sign-out form used both as a standalone pill button and as
 * a full-width item inside `UserMenu`.
 *
 * `@/auth`'s `signOut` is stubbed via the shared `@/test/module-stub` helper
 * (same technique as `src/app/signout/route.test.ts`'s ad hoc predecessor,
 * centralized) so this file never loads the real NextAuth config — it only
 * asserts *that* the inline server action calls `signOut({ redirectTo: "/" })`
 * exactly once, that the call is genuinely awaited (not fire-and-forget), and
 * that a `signOut` rejection propagates instead of being swallowed. Mounted
 * directly with `react-test-renderer` — no `document`/`window` fake needed,
 * since the component renders a plain form/button and never touches a
 * browser API itself.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { createElement, type ReactNode } from "react";

import { stubModule } from "@/test/module-stub";

type SignOutOptions = { redirectTo: string };
type SignOutTestState = {
  calls: SignOutOptions[];
  impl: (options: SignOutOptions) => Promise<void>;
};

const globalForAuth = globalThis as typeof globalThis & {
  __signOutButtonTestState: SignOutTestState;
};

function resetState(): void {
  globalForAuth.__signOutButtonTestState = {
    calls: [],
    impl: async () => undefined,
  };
}
resetState();

stubModule(
  "@/auth",
  `module.exports = {
  signOut: async (options) => {
    const s = globalThis.__signOutButtonTestState;
    s.calls.push(options);
    return s.impl(options);
  },
};`,
);

const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const [message] = args;
  if (
    typeof message === "string" &&
    message.startsWith("react-test-renderer is deprecated")
  ) {
    return;
  }
  originalConsoleError(...args);
};
after(() => {
  console.error = originalConsoleError;
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Dynamically imported after the `stubModule` call above: a static import
// resolves the whole module graph (including `@/auth`) before this file's
// own top-level statements run.
let SignOutButton: typeof import("./sign-out-button").SignOutButton;
before(async () => {
  SignOutButton = (await import("./sign-out-button")).SignOutButton;
});

beforeEach(resetState);

function mount(props: {
  className?: string;
  leadingIcon?: ReactNode;
  role?: string;
}): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(createElement(SignOutButton, props));
  });
  return renderer;
}

function state(): SignOutTestState {
  return globalForAuth.__signOutButtonTestState;
}

describe("SignOutButton — form rendering", () => {
  test("renders a submit button with the default label and default className, no role", () => {
    const renderer = mount({});
    try {
      const form = renderer.root.findByType("form");
      assert.equal(typeof form.props.action, "function");

      const button = renderer.root.findByType("button");
      assert.equal(button.props.type, "submit");
      assert.equal(button.props.role, undefined);
      assert.match(button.props.className, /rounded-full/);
      assert.deepEqual(button.children, ["Sign out"]);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("renders a custom className, role, and leadingIcon when provided", () => {
    const icon = createElement("svg", { "data-testid": "icon" });
    const renderer = mount({
      className: "custom-class",
      role: "menuitem",
      leadingIcon: icon,
    });
    try {
      const button = renderer.root.findByType("button");
      assert.equal(button.props.className, "custom-class");
      assert.equal(button.props.role, "menuitem");
      const svg = renderer.root.findByType("svg");
      assert.equal(svg.props["data-testid"], "icon");
      assert.match(
        renderer.root.findByType("button").children.join(""),
        /Sign out/,
      );
    } finally {
      act(() => renderer.unmount());
    }
  });
});

describe("SignOutButton — server action", () => {
  test("invoking the form action calls signOut({ redirectTo: '/' }) exactly once", async () => {
    const renderer = mount({});
    try {
      const form = renderer.root.findByType("form");
      await act(async () => {
        await (form.props.action as () => Promise<void>)();
      });
      assert.deepEqual(state().calls, [{ redirectTo: "/" }]);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("the action stays pending until signOut's own promise resolves (genuinely awaited, not fire-and-forget)", async () => {
    let resolveSignOut!: () => void;
    state().impl = () =>
      new Promise((resolve) => {
        resolveSignOut = resolve;
      });

    const renderer = mount({});
    try {
      const form = renderer.root.findByType("form");
      let settled = false;
      const actionPromise = (form.props.action as () => Promise<void>)().then(
        () => {
          settled = true;
        },
      );

      // Give any microtasks a chance to run; the action must still be
      // pending because signOut's own promise hasn't resolved yet.
      await Promise.resolve();
      await Promise.resolve();
      assert.equal(settled, false, "action resolved before signOut did");

      resolveSignOut();
      await act(async () => {
        await actionPromise;
      });
      assert.equal(settled, true);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("a signOut rejection propagates out of the form action instead of being swallowed", async () => {
    const failure = new Error("session store unavailable");
    state().impl = async () => {
      throw failure;
    };

    const renderer = mount({});
    try {
      const form = renderer.root.findByType("form");
      await assert.rejects(
        () => (form.props.action as () => Promise<void>)(),
        /session store unavailable/,
      );
      assert.deepEqual(state().calls, [{ redirectTo: "/" }]);
    } finally {
      act(() => renderer.unmount());
    }
  });
});
