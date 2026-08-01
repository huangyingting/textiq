/**
 * Direct contract coverage for `CreateWorkspaceButton` (issue #1957).
 *
 * `renderCreateWorkspaceView` is the pure state -> markup decision extracted
 * from the component (including the submit button, which previously read
 * its own pending flag via `useFormStatus()` — a hook that cannot be driven
 * without a live form submission). It owns the dialog open/close wiring,
 * the "is this error message text or a redirect-target path" branch, and
 * the submit button's pending label/disabled state, so every visual state
 * is unit-testable without exercising `useActionState`. A harness-rendered
 * passes through the real `CreateWorkspaceButton` confirm the hook wiring,
 * synchronous duplicate-submission boundary, and post-validation retry;
 * `./actions`' real dependencies (session, workspace service, next/cache,
 * next/navigation) are stubbed via module hooks purely so the real
 * `createWorkspace` action module can load — its own authorization/service
 * authorization and persistence behavior are already covered by
 * `actions.test.ts` and are not re-asserted here.
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

import { WORKSPACE_NAME_MAX_LENGTH } from "@/lib/limits";
import "@/test/react-render-harness";

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

type CreateWorkspaceButtonTestState = {
  calls: unknown[];
  requireUser: (redirect: (url: string) => never) => Promise<{ id: string }>;
  createWorkspaceForUser: (
    ownerId: string,
    rawName: string,
  ) => Promise<{ id: string }>;
};

const globalForTest = globalThis as typeof globalThis & {
  __createWorkspaceButtonTestState: CreateWorkspaceButtonTestState;
};

function createDefaultState(): CreateWorkspaceButtonTestState {
  const calls: unknown[] = [];
  return {
    calls,
    async requireUser() {
      calls.push(["requireUser"]);
      return { id: "user-1" };
    },
    async createWorkspaceForUser(ownerId, rawName) {
      calls.push(["createWorkspaceForUser", ownerId, rawName]);
      return { id: "workspace-1" };
    },
  };
}

globalForTest.__createWorkspaceButtonTestState = createDefaultState();

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-create-workspace-button-test:";

const stubbedModules = new Map<string, string>([
  [
    "@/components/ui",
    `
      import { createElement } from "react";
      export const FIELD_CONTROL = "field-control";
      export function Button({ variant, size, leadingIcon, children, ...props }) {
        return createElement("button", props, leadingIcon, children);
      }
      export function Dialog({ open, children, restoreFocusRef, ...props }) {
        return open ? createElement("div", props, children) : null;
      }
    `,
  ],
  [
    "next/navigation",
    `
      export function redirect(url) {
        throw new Error("unexpected redirect: " + url);
      }
      export function useRouter() {
        return { push() {}, replace() {}, refresh() {} };
      }
    `,
  ],
  [
    "next/cache",
    `
      export function revalidatePath() {}
    `,
  ],
  [
    "@/lib/session",
    `
      export async function requireUser(redirect) {
        return globalThis.__createWorkspaceButtonTestState.requireUser(redirect);
      }
    `,
  ],
  [
    "@/lib/workspace/service",
    `
      export async function createWorkspaceForUser(ownerId, rawName) {
        return globalThis.__createWorkspaceButtonTestState.createWorkspaceForUser(
          ownerId, rawName,
        );
      }
    `,
  ],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (stubbedModules.has(specifier)) {
      return {
        url: `${stubPrefix}${encodeURIComponent(specifier)}`,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(stubPrefix)) {
      const specifier = decodeURIComponent(url.slice(stubPrefix.length));
      return {
        format: "module",
        source: stubbedModules.get(specifier) ?? "",
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

type CreateWorkspaceButtonModule = typeof import("./create-workspace-button");

let mod: CreateWorkspaceButtonModule;

before(async () => {
  mod = await import("./create-workspace-button");
});

beforeEach(() => {
  globalForTest.__createWorkspaceButtonTestState = createDefaultState();
});

type ElementLike = ReactElement<Record<string, unknown>>;

// Purely structural: pushes every element and recurses only into its
// literal `children` prop. Function components (Dialog/Button) are never
// invoked directly — Dialog uses hooks internally (useState/useContext/
// useId), and calling it outside of a real React render pass would throw
// "Invalid hook call". Since JSX children are already fully-constructed
// element data at the point `renderCreateWorkspaceView` returns, this is
// sufficient to find the Dialog's nested form/input/button elements
// without ever executing Dialog's own render body.
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

function waitForAsyncDrain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("renderCreateWorkspaceView", () => {
  test("closed dialog: clicking the default 'New workspace' trigger opens it", () => {
    const calls: boolean[] = [];
    const tree = mod.renderCreateWorkspaceView({
      error: null,
      action: () => undefined,
      isPending: false,
      open: false,
      onOpenChange: (open) => calls.push(open),
    });
    // The trigger is rendered via the `Button` primitive (forwardRef), not
    // a host <button>; find it by its onClick + label instead.
    const trigger = firstElement(
      tree,
      (element) =>
        typeof element.props.onClick === "function" &&
        element.props.children === "New workspace",
    );
    (trigger.props.onClick as () => void)();
    assert.deepEqual(calls, [true]);
  });

  test("custom children override the trigger label", () => {
    const tree = mod.renderCreateWorkspaceView({
      error: null,
      action: () => undefined,
      isPending: false,
      open: false,
      onOpenChange: () => undefined,
      children: "Create your first workspace",
    });
    const trigger = firstElement(
      tree,
      (element) => element.props.children === "Create your first workspace",
    );
    assert.ok(trigger);
  });

  test("passes the className through to the trigger button", () => {
    const tree = mod.renderCreateWorkspaceView({
      error: null,
      action: () => undefined,
      isPending: false,
      open: false,
      onOpenChange: () => undefined,
      className: "w-full",
    });
    const trigger = firstElement(
      tree,
      (element) => element.props.children === "New workspace",
    );
    assert.equal(trigger.props.className, "w-full");
  });

  test("wires the dialog's open flag and exposes the form/name field", () => {
    const tree = mod.renderCreateWorkspaceView({
      error: null,
      action: () => undefined,
      isPending: false,
      open: true,
      onOpenChange: () => undefined,
    });
    const dialog = firstElement(
      tree,
      (element) =>
        (element.props as { "aria-labelledby"?: string })["aria-labelledby"] ===
        "create-workspace-title",
    );
    assert.equal(dialog.props.open, true);
    const form = firstElement(tree, (element) => element.type === "form");
    assert.equal(typeof form.props.action, "function");
    const nameField = firstElement(
      tree,
      (element) => element.type === "input" && element.props.name === "name",
    );
    assert.equal(nameField.props.id, "name");
    assert.equal(nameField.props.required, true);
    assert.equal(nameField.props.autoFocus, true);
    assert.equal(nameField.props.placeholder, "Marketing team");
  });

  test("the name field enforces the canonical stored workspace-name limit", () => {
    const tree = mod.renderCreateWorkspaceView({
      error: null,
      action: () => undefined,
      isPending: false,
      open: true,
      onOpenChange: () => undefined,
    });
    const nameField = firstElement(
      tree,
      (element) => element.type === "input" && element.props.name === "name",
    );

    assert.equal(nameField.props.maxLength, WORKSPACE_NAME_MAX_LENGTH);
  });

  test("dialog onClose and the Cancel button both close the dialog", () => {
    const calls: boolean[] = [];
    const tree = mod.renderCreateWorkspaceView({
      error: null,
      action: () => undefined,
      isPending: false,
      open: true,
      onOpenChange: (open) => calls.push(open),
    });
    const dialog = firstElement(
      tree,
      (element) =>
        (element.props as { "aria-labelledby"?: string })["aria-labelledby"] ===
        "create-workspace-title",
    );
    (dialog.props.onClose as () => void)();
    const cancel = firstElement(
      tree,
      (element) => element.props.children === "Cancel",
    );
    (cancel.props.onClick as () => void)();
    assert.deepEqual(calls, [false, false]);
  });

  test("a plain validation error message renders as an alert next to the field", () => {
    const tree = mod.renderCreateWorkspaceView({
      error: "Workspace name is required.",
      action: () => undefined,
      isPending: false,
      open: true,
      onOpenChange: () => undefined,
    });
    const alert = firstElement(
      tree,
      (element) => element.props.role === "alert",
    );
    assert.equal(alert.props.children, "Workspace name is required.");
  });

  test("a path-like success/redirect value never renders as an error message", () => {
    const tree = mod.renderCreateWorkspaceView({
      error: "/app/workspaces/workspace-1",
      action: () => undefined,
      isPending: false,
      open: true,
      onOpenChange: () => undefined,
    });
    assert.throws(() =>
      firstElement(tree, (element) => element.props.role === "alert"),
    );
  });

  test("no error and idle: no alert is rendered", () => {
    const tree = mod.renderCreateWorkspaceView({
      error: null,
      action: () => undefined,
      isPending: false,
      open: true,
      onOpenChange: () => undefined,
    });
    assert.throws(() =>
      firstElement(tree, (element) => element.props.role === "alert"),
    );
  });

  test("idle: the submit button reads 'Create' and is enabled", () => {
    const tree = mod.renderCreateWorkspaceView({
      error: null,
      action: () => undefined,
      isPending: false,
      open: true,
      onOpenChange: () => undefined,
    });
    const submit = firstElement(
      tree,
      (element) => element.props.type === "submit",
    );
    assert.equal(submit.props.disabled, false);
    assert.equal(submit.props.children, "Create");
  });

  test("pending creation owns the dialog and locks every dismissal or edit path", () => {
    const openChanges: boolean[] = [];
    const tree = mod.renderCreateWorkspaceView({
      error: null,
      action: () => undefined,
      isPending: true,
      open: true,
      onOpenChange: (open) => openChanges.push(open),
    });
    const trigger = firstElement(
      tree,
      (element) => element.props.children === "New workspace",
    );
    const dialog = firstElement(
      tree,
      (element) =>
        (element.props as { "aria-labelledby"?: string })["aria-labelledby"] ===
        "create-workspace-title",
    );
    const nameField = firstElement(
      tree,
      (element) => element.type === "input" && element.props.name === "name",
    );
    const submit = firstElement(
      tree,
      (element) => element.props.type === "submit",
    );
    const cancel = firstElement(
      tree,
      (element) => element.props.children === "Cancel",
    );

    (trigger.props.onClick as () => void)();
    (dialog.props.onClose as () => void)();
    (cancel.props.onClick as () => void)();

    assert.equal(trigger.props.disabled, true);
    assert.equal(dialog.props["aria-busy"], true);
    assert.equal(nameField.props.disabled, true);
    assert.equal(submit.props.disabled, true);
    assert.equal(submit.props.children, "Creating...");
    assert.equal(cancel.props.disabled, true);
    assert.deepEqual(openChanges, []);
  });

  test("the form's action prop is the exact dispatcher passed in", () => {
    const action = (payload: FormData) => {
      void payload;
    };
    const tree = mod.renderCreateWorkspaceView({
      error: null,
      action,
      isPending: false,
      open: true,
      onOpenChange: () => undefined,
    });
    const form = firstElement(tree, (element) => element.type === "form");
    assert.equal(form.props.action, action);
  });
});

describe("CreateWorkspaceButton", () => {
  test("same-event repeated submission issues one workspace creation", async () => {
    let resolveFirstCreation!: () => void;
    let creationCount = 0;
    globalForTest.__createWorkspaceButtonTestState.createWorkspaceForUser = (
      ownerId,
      rawName,
    ) => {
      globalForTest.__createWorkspaceButtonTestState.calls.push([
        "createWorkspaceForUser",
        ownerId,
        rawName,
      ]);
      creationCount += 1;
      if (creationCount === 1) {
        return new Promise((resolve) => {
          resolveFirstCreation = () => resolve({ id: "workspace-1" });
        });
      }
      return Promise.resolve({ id: `workspace-${creationCount}` });
    };

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<mod.CreateWorkspaceButton />);
    });
    try {
      act(() => {
        renderer.root.findByType("button").props.onClick();
      });
      const action = renderer.root.findByType("form").props.action as (
        payload: FormData,
      ) => void;
      const payload = new FormData();
      payload.set("name", "Production team");

      act(() => {
        startTransition(() => {
          action(payload);
          action(payload);
        });
      });
      await act(async () => {
        await waitForAsyncDrain();
      });
      assert.equal(creationCount, 1);

      await act(async () => {
        resolveFirstCreation();
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      assert.equal(creationCount, 1);
      assert.equal(
        renderer.root.findByProps({
          "aria-labelledby": "create-workspace-title",
        }).props["aria-busy"],
        true,
      );
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("a validation result releases the submission boundary for retry", async () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<mod.CreateWorkspaceButton />);
    });
    try {
      act(() => {
        renderer.root.findByType("button").props.onClick();
      });

      const invalidPayload = new FormData();
      invalidPayload.set("name", "   ");
      act(() => {
        startTransition(() => {
          const action = renderer.root.findByType("form").props.action as (
            payload: FormData,
          ) => void;
          action(invalidPayload);
        });
      });
      await act(async () => {
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      assert.match(
        JSON.stringify(renderer.toJSON()),
        /Workspace name is required\./,
      );

      const validPayload = new FormData();
      validPayload.set("name", "Retry team");
      act(() => {
        startTransition(() => {
          const action = renderer.root.findByType("form").props.action as (
            payload: FormData,
          ) => void;
          action(validPayload);
        });
      });
      await act(async () => {
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });

      assert.deepEqual(
        globalForTest.__createWorkspaceButtonTestState.calls.filter(
          (call) => (call as unknown[])[0] === "createWorkspaceForUser",
        ),
        [["createWorkspaceForUser", "user-1", "Retry team"]],
      );
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("renders the idle trigger through the real useActionState wiring, with no dialog markup (no document)", () => {
    // The UI bridge keeps Dialog deterministic and portal-free in this file;
    // its closed state returns no dialog content, matching the production
    // primitive's server-rendered result without installing DOM globals.
    const html = renderToStaticMarkup(<mod.CreateWorkspaceButton />);
    assert.match(html, /New workspace/);
    assert.doesNotMatch(html, /Workspace name/);
    assert.doesNotMatch(html, /role="alert"/);
  });

  test("renders a custom trigger label through the real hook wiring", () => {
    const html = renderToStaticMarkup(
      <mod.CreateWorkspaceButton>
        Create your first workspace
      </mod.CreateWorkspaceButton>,
    );
    assert.match(html, /Create your first workspace/);
  });
});
