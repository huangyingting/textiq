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
 * pass through the real `CreateWorkspaceButton` confirms the hook wiring
 * itself still produces the same idle markup the pure function predicts;
 * `./actions`' real dependencies (session, workspace service, next/cache,
 * next/navigation) are stubbed via module hooks purely so the real
 * `createWorkspace` action module can load — its own authorization/service
 * behavior is already covered by `actions.test.ts` and is not re-asserted
 * here.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, describe, test } from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

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

  test("pending: the submit button reads 'Creating...' and is disabled", () => {
    const tree = mod.renderCreateWorkspaceView({
      error: null,
      action: () => undefined,
      isPending: true,
      open: true,
      onOpenChange: () => undefined,
    });
    const submit = firstElement(
      tree,
      (element) => element.props.type === "submit",
    );
    assert.equal(submit.props.disabled, true);
    assert.equal(submit.props.children, "Creating...");
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
  test("renders the idle trigger through the real useActionState wiring, with no dialog markup (no document)", () => {
    // Unlike the other settings-form precedents, this component's tree
    // contains a `Dialog`, so `createReactRenderHarness` (which installs a
    // body-less fake `document`/`window` for the duration of the render)
    // cannot be used here — `ModalSurface` would try to `createPortal`
    // into `document.body`, which does not exist on that fake document.
    // Rendering directly with `renderToStaticMarkup` keeps this process's
    // real, undefined `document`, so `ModalSurface` safely no-ops (see
    // `src/components/ui/overlay-stack.tsx`), matching
    // `delete-account-form.test.tsx`'s documented convention.
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
