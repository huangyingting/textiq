/**
 * Direct contract coverage for `WorkspaceSettings` (issue #1957): owner
 * rename validation/success/error, owner delete vs. member leave copy and
 * gating, and the destructive-action confirmation dialog.
 *
 * `./actions` is loaded for real; only its deep dependencies (session,
 * workspace-capability check, workspace service, `next/cache`,
 * `next/navigation`) are stubbed — their authorization/persistence behavior
 * is already covered by `actions.test.ts` and is not re-asserted here.
 *
 * `@/components/ui`'s `Dialog` is stubbed to a no-op (see
 * `members-list.test.tsx` for the full rationale, reused verbatim here):
 * `Dialog`/`ModalSurface` cannot survive an `open` transition in a Node
 * process with no `document` global, and its own behavior already has
 * dedicated coverage in `src/components/ui/ui-interactions-coverage.test.ts`.
 * The confirm/cancel buttons are read directly off the `Dialog` call site's
 * own `children` prop (eagerly constructed by `WorkspaceSettings` regardless
 * of what `Dialog` renders), matching `members-list.test.tsx`'s technique.
 *
 * `handleDestructive` wraps `await deleteWorkspace(...)` / `await
 * leaveWorkspace(...)` in a `try/catch`, and both actions *always* end by
 * calling `redirect(...)` on success (see `./actions.ts`). Next.js
 * implements `redirect()` by throwing an error whose `digest` starts with
 * `"NEXT_REDIRECT"`, which must propagate uncaught so the router can
 * navigate (the same `digest`-sniffing pattern `google-sign-in-button.tsx`
 * uses). The `redirect` stub below attaches a realistic `digest` so the
 * tests can assert that signal escapes `handleDestructive`'s `catch` — via
 * `react-test-renderer`'s `act()` rejecting with it, which also unmounts the
 * tree, matching how an uncaught error propagates past a component with no
 * error boundary in a real app — while genuine mutation failures (rejected
 * with a plain `Error`, or a non-`Error` throw) are still caught and
 * rendered as an actionable error banner.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, describe, test } from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { Button } from "@/components/ui/button";
import { FIELD_CONTROL, PANEL_CHROME, cx } from "@/components/ui/tokens";
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

type TestState = {
  calls: unknown[][];
  redirect: (url: string) => never;
  revalidatePath: (path: string) => void;
  requireUser: (redirect: (url: string) => never) => Promise<{ id: string }>;
  requireWorkspaceCapability: (
    userId: string,
    workspaceId: string,
    capability: string,
  ) => Promise<unknown>;
  renameWorkspaceRecord: (
    workspaceId: string,
    rawName: string,
  ) => Promise<void>;
  deleteWorkspaceAndDetachDocuments: (workspaceId: string) => Promise<void>;
  leaveWorkspaceForUser: (workspaceId: string, userId: string) => Promise<void>;
};

const globalForTest = globalThis as typeof globalThis & {
  __workspaceSettingsTestState: TestState;
};

function createDefaultState(): TestState {
  const calls: unknown[][] = [];
  return {
    calls,
    redirect(url: string): never {
      calls.push(["redirect", url]);
      // Mirror Next.js's real redirect() shape: message is just
      // "NEXT_REDIRECT", and the routing signal lives in `digest`.
      const error = new Error("NEXT_REDIRECT") as Error & { digest: string };
      error.digest = `NEXT_REDIRECT;push;${url};307;`;
      throw error;
    },
    revalidatePath(path: string) {
      calls.push(["revalidatePath", path]);
    },
    async requireUser() {
      calls.push(["requireUser"]);
      return { id: "user-1" };
    },
    async requireWorkspaceCapability(userId, workspaceId, capability) {
      calls.push([
        "requireWorkspaceCapability",
        userId,
        workspaceId,
        capability,
      ]);
      return {
        role: "OWNER",
        canView: true,
        canMutate: true,
        canManage: true,
      };
    },
    async renameWorkspaceRecord(workspaceId, rawName) {
      calls.push(["renameWorkspaceRecord", workspaceId, rawName]);
    },
    async deleteWorkspaceAndDetachDocuments(workspaceId) {
      calls.push(["deleteWorkspaceAndDetachDocuments", workspaceId]);
    },
    async leaveWorkspaceForUser(workspaceId, userId) {
      calls.push(["leaveWorkspaceForUser", workspaceId, userId]);
    },
  };
}

globalForTest.__workspaceSettingsTestState = createDefaultState();
// Node 22's synchronous require(esm) interop path can drop the export from
// a synthetic `export { Button } from "@/components/ui/button"` re-export
// evaluated inside a module-hook-provided source string (reproduced via
// direct experiment: "The requested module '@/components/ui/button' does
// not provide an export named 'Button'", even though the real module
// unambiguously exports it — see `members-list.test.tsx` for the full
// investigation). Node 24 does not exhibit this. To stay on the real
// `Button`/token implementations without tripping that interop bug, the
// real bindings are imported normally above (resolved through the default
// loader, before any hooks are registered) and bridged into the synthetic
// `@/components/ui` module below via a global instead of a nested
// `export ... from` statement.
(
  globalThis as typeof globalThis & {
    __workspaceSettingsUiBridge: {
      Button: unknown;
      FIELD_CONTROL: unknown;
      PANEL_CHROME: unknown;
      cx: unknown;
    };
  }
).__workspaceSettingsUiBridge = { Button, FIELD_CONTROL, PANEL_CHROME, cx };
Object.defineProperty(globalThis, "window", {
  configurable: true,
  writable: true,
  value: {
    location: {
      reload: () =>
        globalForTest.__workspaceSettingsTestState.calls.push(["reload"]),
    },
  },
});

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-workspace-settings-test:";

const stubbedModules = new Map<string, string>([
  ["server-only", ""],
  [
    "@/components/ui",
    `
      export const Button = globalThis.__workspaceSettingsUiBridge.Button;
      export const FIELD_CONTROL = globalThis.__workspaceSettingsUiBridge.FIELD_CONTROL;
      export const PANEL_CHROME = globalThis.__workspaceSettingsUiBridge.PANEL_CHROME;
      export const cx = globalThis.__workspaceSettingsUiBridge.cx;
      // Real Dialog/ModalSurface cannot survive an open transition in a
      // Node process with no document (see file header) — this is
      // covered elsewhere, not re-tested here.
      export function Dialog() { return null; }
    `,
  ],
  [
    "next/navigation",
    `
      export function redirect(url) {
        return globalThis.__workspaceSettingsTestState.redirect(url);
      }
      export function unstable_rethrow(error) {
        if (
          error &&
          typeof error === "object" &&
          typeof error.digest === "string" &&
          (error.digest.startsWith("NEXT_REDIRECT") ||
            error.digest.startsWith("NEXT_HTTP_ERROR_FALLBACK"))
        ) {
          throw error;
        }
      }
    `,
  ],
  [
    "next/cache",
    `
      export function revalidatePath(path) {
        globalThis.__workspaceSettingsTestState.revalidatePath(path);
      }
    `,
  ],
  [
    "@/lib/session",
    `
      export async function requireUser(redirect) {
        return globalThis.__workspaceSettingsTestState.requireUser(redirect);
      }
    `,
  ],
  [
    "@/lib/auth/workspace-capabilities",
    `
      export async function requireWorkspaceCapability(userId, workspaceId, capability) {
        return globalThis.__workspaceSettingsTestState.requireWorkspaceCapability(
          userId, workspaceId, capability,
        );
      }
    `,
  ],
  [
    "@/lib/workspace/invite-service",
    `
      export function assertInvitableWorkspaceRole() {}
      export async function createWorkspaceInviteLink() { throw new Error("unused"); }
      export async function getInviteLinkTarget() { return null; }
      export async function revokeWorkspaceInviteLink() {}
    `,
  ],
  [
    "@/lib/workspace/service",
    `
      export async function createWorkspaceDocumentForUser() {}
      export async function deleteWorkspaceAndDetachDocuments(workspaceId) {
        return globalThis.__workspaceSettingsTestState.deleteWorkspaceAndDetachDocuments(workspaceId);
      }
      export async function getWorkspaceMemberRemovalTarget() { return null; }
      export async function importWorkspaceDocumentForUser() {}
      export async function leaveWorkspaceForUser(workspaceId, userId) {
        return globalThis.__workspaceSettingsTestState.leaveWorkspaceForUser(workspaceId, userId);
      }
      export async function listWorkspaceDocumentsForUser() {
        return { documents: [], hasMore: false };
      }
      export async function removeWorkspaceMemberAndDetachDocuments() {}
      export async function renameWorkspaceRecord(workspaceId, rawName) {
        return globalThis.__workspaceSettingsTestState.renameWorkspaceRecord(workspaceId, rawName);
      }
      export async function transferWorkspaceOwnership() {}
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

type WorkspaceSettingsModule = typeof import("./workspace-settings");

let mod: WorkspaceSettingsModule;

before(async () => {
  mod = await import("./workspace-settings");
});

beforeEach(() => {
  globalForTest.__workspaceSettingsTestState = createDefaultState();
});

function state(): TestState {
  return globalForTest.__workspaceSettingsTestState;
}

function callsOf(tag: string): unknown[][] {
  return state().calls.filter((c) => c[0] === tag);
}

/**
 * True when `error` is the `digest`-carrying signal Next.js's `redirect()`
 * throws to navigate to `url` — the same check `handleDestructive` and
 * `google-sign-in-button.tsx` use to distinguish it from a genuine mutation
 * failure.
 */
function isRedirectSignal(error: unknown, url: string): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return (
    error instanceof Error &&
    typeof digest === "string" &&
    digest.startsWith("NEXT_REDIRECT") &&
    digest.includes(`;${url};`)
  );
}

function waitForAsyncDrain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function mountWorkspaceSettings(props: {
  workspaceId: string;
  name: string;
  isOwner: boolean;
}): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  const WorkspaceSettings = mod.WorkspaceSettings;
  act(() => {
    renderer = create(<WorkspaceSettings {...props} />);
  });
  return renderer;
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

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) return node.map(textContent).join(" ");
  if (!isValidElement(node)) return "";
  return textContent((node.props as { children?: ReactNode }).children);
}

function findDialog(renderer: ReactTestRenderer) {
  return renderer.root.findByProps({
    "aria-labelledby": "workspace-destructive-title",
  });
}

describe("WorkspaceSettings (owner)", () => {
  test("renders the rename field pre-filled with the current name, Save disabled until changed", () => {
    const renderer = mountWorkspaceSettings({
      workspaceId: "workspace-1",
      name: "Marketing",
      isOwner: true,
    });
    try {
      const input = renderer.root.findByProps({ id: "workspace-name" });
      assert.equal(input.props.value, "Marketing");
      const saveButton = renderer.root.findByProps({ children: "Save" });
      assert.equal(saveButton.props.disabled, true);
      act(() => {
        input.props.onChange({ target: { value: "New Name" } });
      });
      const updatedSave = renderer.root.findByProps({ children: "Save" });
      assert.equal(updatedSave.props.disabled, false);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("a whitespace-only name keeps Save disabled (trimmed empty)", () => {
    const renderer = mountWorkspaceSettings({
      workspaceId: "workspace-1",
      name: "Marketing",
      isOwner: true,
    });
    try {
      const input = renderer.root.findByProps({ id: "workspace-name" });
      act(() => {
        input.props.onChange({ target: { value: "   " } });
      });
      const saveButton = renderer.root.findByProps({ children: "Save" });
      assert.equal(saveButton.props.disabled, true);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("saving a valid rename calls renameWorkspace (trimmed) and reloads on success", async () => {
    const renderer = mountWorkspaceSettings({
      workspaceId: "workspace-1",
      name: "Marketing",
      isOwner: true,
    });
    try {
      const input = renderer.root.findByProps({ id: "workspace-name" });
      act(() => {
        input.props.onChange({ target: { value: "  Growth Team  " } });
      });
      const saveButton = renderer.root.findByProps({ children: "Save" });
      await act(async () => {
        saveButton.props.onClick();
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      assert.deepEqual(callsOf("renameWorkspaceRecord"), [
        ["renameWorkspaceRecord", "workspace-1", "Growth Team"],
      ]);
      assert.equal(callsOf("reload").length, 1);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("a failed rename shows generic redacted recovery and does not reload", async () => {
    state().renameWorkspaceRecord = async () => {
      throw new Error("That name is already in use.");
    };
    const renderer = mountWorkspaceSettings({
      workspaceId: "workspace-1",
      name: "Marketing",
      isOwner: true,
    });
    try {
      const input = renderer.root.findByProps({ id: "workspace-name" });
      act(() => {
        input.props.onChange({ target: { value: "Growth Team" } });
      });
      const saveButton = renderer.root.findByProps({ children: "Save" });
      await act(async () => {
        saveButton.props.onClick();
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      const text = JSON.stringify(renderer.toJSON());
      assert.match(text, /Could not rename the workspace\. Please try again\./);
      assert.doesNotMatch(text, /That name is already in use\./);
      assert.equal(callsOf("reload").length, 0);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("a non-Error rename rejection uses the same generic recovery", async () => {
    state().renameWorkspaceRecord = async () => {
      throw "nope";
    };
    const renderer = mountWorkspaceSettings({
      workspaceId: "workspace-1",
      name: "Marketing",
      isOwner: true,
    });
    try {
      const input = renderer.root.findByProps({ id: "workspace-name" });
      act(() => {
        input.props.onChange({ target: { value: "Growth Team" } });
      });
      const saveButton = renderer.root.findByProps({ children: "Save" });
      await act(async () => {
        saveButton.props.onClick();
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      assert.match(
        JSON.stringify(renderer.toJSON()),
        /Could not rename the workspace\. Please try again\./,
      );
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("rename recovery retries once under repeated activation", async () => {
    let attempts = 0;
    state().renameWorkspaceRecord = async (workspaceId, rawName) => {
      state().calls.push(["renameWorkspaceRecord", workspaceId, rawName]);
      attempts += 1;
      if (attempts === 1) throw new Error("temporary outage");
    };
    const renderer = mountWorkspaceSettings({
      workspaceId: "workspace-1",
      name: "Marketing",
      isOwner: true,
    });
    try {
      act(() => {
        renderer.root
          .findByProps({ id: "workspace-name" })
          .props.onChange({ target: { value: "Growth Team" } });
      });
      await act(async () => {
        renderer.root.findByProps({ children: "Save" }).props.onClick();
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      const retryButton = renderer.root.findByProps({
        children: "Try rename again",
      });
      await act(async () => {
        retryButton.props.onClick();
        retryButton.props.onClick();
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      assert.equal(callsOf("renameWorkspaceRecord").length, 2);
      assert.equal(callsOf("reload").length, 1);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("same-event repeated rename activation issues one durable mutation", async () => {
    let resolveRename!: () => void;
    state().renameWorkspaceRecord = (workspaceId, rawName) => {
      state().calls.push(["renameWorkspaceRecord", workspaceId, rawName]);
      return new Promise((resolve) => {
        resolveRename = resolve;
      });
    };
    const renderer = mountWorkspaceSettings({
      workspaceId: "workspace-1",
      name: "Marketing",
      isOwner: true,
    });
    try {
      act(() => {
        renderer.root
          .findByProps({ id: "workspace-name" })
          .props.onChange({ target: { value: "Growth Team" } });
      });
      const saveButton = renderer.root.findByProps({ children: "Save" });
      await act(async () => {
        saveButton.props.onClick();
        saveButton.props.onClick();
        await waitForAsyncDrain();
      });
      assert.equal(callsOf("renameWorkspaceRecord").length, 1);

      await act(async () => {
        resolveRename();
        await waitForAsyncDrain();
      });
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("switching workspaces resets settings and suppresses a late rename reload from the old workspace", async () => {
    let resolveWorkspaceOneRename!: () => void;
    state().renameWorkspaceRecord = (workspaceId, rawName) => {
      state().calls.push(["renameWorkspaceRecord", workspaceId, rawName]);
      return new Promise((resolve) => {
        resolveWorkspaceOneRename = resolve;
      });
    };
    const renderer = mountWorkspaceSettings({
      workspaceId: "workspace-1",
      name: "Marketing",
      isOwner: true,
    });
    try {
      act(() => {
        renderer.root
          .findByProps({ id: "workspace-name" })
          .props.onChange({ target: { value: "Growth Team" } });
      });
      let oldWorkspaceRename!: Promise<void>;
      act(() => {
        oldWorkspaceRename = renderer.root
          .findByProps({ children: "Save" })
          .props.onClick();
      });
      await act(async () => {
        await waitForAsyncDrain();
      });

      const WorkspaceSettings = mod.WorkspaceSettings;
      act(() => {
        renderer.update(
          <WorkspaceSettings workspaceId="workspace-2" name="Sales" isOwner />,
        );
      });
      const workspaceTwoInput = renderer.root.findByProps({
        id: "workspace-name",
      });
      assert.equal(workspaceTwoInput.props.value, "Sales");
      assert.equal(
        renderer.root.findByProps({ children: "Save" }).props.disabled,
        true,
      );

      await act(async () => {
        resolveWorkspaceOneRename();
        await oldWorkspaceRename;
      });
      assert.equal(callsOf("reload").length, 0);

      state().renameWorkspaceRecord = async (workspaceId, rawName) => {
        state().calls.push(["renameWorkspaceRecord", workspaceId, rawName]);
      };
      act(() => {
        workspaceTwoInput.props.onChange({ target: { value: "Sales Team" } });
      });
      await act(async () => {
        await renderer.root.findByProps({ children: "Save" }).props.onClick();
      });
      assert.deepEqual(callsOf("renameWorkspaceRecord"), [
        ["renameWorkspaceRecord", "workspace-1", "Growth Team"],
        ["renameWorkspaceRecord", "workspace-2", "Sales Team"],
      ]);
      assert.equal(callsOf("reload").length, 1);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("framework redirect control flow escapes rename failure recovery", async () => {
    state().requireUser = async () => state().redirect("/login");
    const renderer = mountWorkspaceSettings({
      workspaceId: "workspace-1",
      name: "Marketing",
      isOwner: true,
    });
    try {
      act(() => {
        renderer.root
          .findByProps({ id: "workspace-name" })
          .props.onChange({ target: { value: "Growth Team" } });
      });
      const saveButton = renderer.root.findByProps({ children: "Save" });
      await assert.rejects(
        async () =>
          act(async () => {
            await saveButton.props.onClick();
          }),
        (error: unknown) => isRedirectSignal(error, "/login"),
      );
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("shows Delete copy and opens the destructive-confirmation dialog for the owner", () => {
    const renderer = mountWorkspaceSettings({
      workspaceId: "workspace-1",
      name: "Marketing",
      isOwner: true,
    });
    try {
      renderer.root.findByProps({ children: "Delete workspace" }); // section title
      const deleteButton = renderer.root.findByProps({ children: "Delete" });
      assert.equal(findDialog(renderer).props.open, false);
      act(() => {
        deleteButton.props.onClick();
      });
      assert.equal(findDialog(renderer).props.open, true);
      const dialogChildren = findDialog(renderer).props.children as ReactNode;
      const heading = firstElement(dialogChildren, (el) => el.type === "h2");
      assert.equal(heading.props.children, "Delete this workspace?");
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("Cancel closes the dialog without calling deleteWorkspace", () => {
    const renderer = mountWorkspaceSettings({
      workspaceId: "workspace-1",
      name: "Marketing",
      isOwner: true,
    });
    try {
      act(() => {
        renderer.root.findByProps({ children: "Delete" }).props.onClick();
      });
      const cancelButton = firstElement(
        findDialog(renderer).props.children as ReactNode,
        (el) => el.props.children === "Cancel",
      );
      act(() => {
        (cancelButton.props.onClick as () => void)();
      });
      assert.equal(findDialog(renderer).props.open, false);
      assert.equal(callsOf("deleteWorkspaceAndDetachDocuments").length, 0);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("confirming delete calls deleteWorkspace and lets the on-success redirect propagate uncaught so the router can navigate", async () => {
    const renderer = mountWorkspaceSettings({
      workspaceId: "workspace-1",
      name: "Marketing",
      isOwner: true,
    });
    try {
      act(() => {
        renderer.root.findByProps({ children: "Delete" }).props.onClick();
      });
      const confirmButton = firstElement(
        findDialog(renderer).props.children as ReactNode,
        (el) => el.props.children === "Delete workspace",
      );
      // `deleteWorkspace` calls `redirect("/app/workspaces")` on success,
      // which throws a NEXT_REDIRECT signal. `handleDestructive` must not
      // swallow it, so it escapes the `act()` call here uncaught (and, with
      // no error boundary present, unmounts the tree — matching how the
      // signal would reach the router in a real app).
      await assert.rejects(
        async () =>
          act(async () => {
            await (confirmButton.props.onClick as () => Promise<void>)();
          }),
        (err: unknown) => isRedirectSignal(err, "/app/workspaces"),
      );
      assert.equal(callsOf("deleteWorkspaceAndDetachDocuments").length, 1);
      assert.deepEqual(callsOf("redirect"), [["redirect", "/app/workspaces"]]);
    } finally {
      // The tree already unmounted itself when the redirect signal
      // propagated above; unmount() is a safe no-op here.
      act(() => renderer.unmount());
    }
  });

  test("a genuine delete failure stays in the dialog with generic redacted recovery", async () => {
    state().deleteWorkspaceAndDetachDocuments = async () => {
      throw new Error("Workspace has active billing obligations.");
    };
    const renderer = mountWorkspaceSettings({
      workspaceId: "workspace-1",
      name: "Marketing",
      isOwner: true,
    });
    try {
      act(() => {
        renderer.root.findByProps({ children: "Delete" }).props.onClick();
      });
      const confirmButton = firstElement(
        findDialog(renderer).props.children as ReactNode,
        (el) => el.props.children === "Delete workspace",
      );
      await act(async () => {
        (confirmButton.props.onClick as () => void)();
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      const dialogText = textContent(
        findDialog(renderer).props.children as ReactNode,
      );
      assert.match(
        dialogText,
        /Could not delete the workspace\. Please try again\./,
      );
      assert.doesNotMatch(
        dialogText,
        /Workspace has active billing obligations\./,
      );
      assert.equal(findDialog(renderer).props.open, true);
      assert.equal(callsOf("redirect").length, 0);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("a non-Error delete rejection uses the same generic recovery", async () => {
    state().deleteWorkspaceAndDetachDocuments = async () => {
      throw "nope";
    };
    const renderer = mountWorkspaceSettings({
      workspaceId: "workspace-1",
      name: "Marketing",
      isOwner: true,
    });
    try {
      act(() => {
        renderer.root.findByProps({ children: "Delete" }).props.onClick();
      });
      const confirmButton = firstElement(
        findDialog(renderer).props.children as ReactNode,
        (el) => el.props.children === "Delete workspace",
      );
      await act(async () => {
        (confirmButton.props.onClick as () => void)();
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      assert.match(
        textContent(findDialog(renderer).props.children as ReactNode),
        /Could not delete the workspace\. Please try again\./,
      );
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("a failed delete error can be dismissed before cancelling the dialog", async () => {
    state().deleteWorkspaceAndDetachDocuments = async () => {
      throw new Error("Workspace has active billing obligations.");
    };
    const renderer = mountWorkspaceSettings({
      workspaceId: "workspace-1",
      name: "Marketing",
      isOwner: true,
    });
    try {
      act(() => {
        renderer.root.findByProps({ children: "Delete" }).props.onClick();
      });
      const confirmButton = firstElement(
        findDialog(renderer).props.children as ReactNode,
        (el) => el.props.children === "Delete workspace",
      );
      await act(async () => {
        (confirmButton.props.onClick as () => void)();
        await waitForAsyncDrain();
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      let dialogChildren = findDialog(renderer).props.children as ReactNode;
      assert.match(
        textContent(dialogChildren),
        /Could not delete the workspace\. Please try again\./,
      );
      const dismissButton = firstElement(
        dialogChildren,
        (element) => element.props.children === "Dismiss error",
      );
      await act(async () => {
        (dismissButton.props.onClick as () => void)();
        await waitForAsyncDrain();
      });
      dialogChildren = findDialog(renderer).props.children as ReactNode;
      assert.doesNotMatch(
        textContent(dialogChildren),
        /Could not delete the workspace/,
      );
      const cancelButton = firstElement(
        dialogChildren,
        (element) => element.props.children === "Cancel",
      );
      await act(async () => {
        (cancelButton.props.onClick as () => void)();
        await waitForAsyncDrain();
      });
      assert.equal(findDialog(renderer).props.open, false);
    } finally {
      act(() => renderer.unmount());
    }
  });
});

describe("WorkspaceSettings (non-owner member)", () => {
  test("shows Leave copy only — no rename field, no Delete button", () => {
    const renderer = mountWorkspaceSettings({
      workspaceId: "workspace-1",
      name: "Marketing",
      isOwner: false,
    });
    try {
      assert.throws(() => renderer.root.findByProps({ id: "workspace-name" }));
      assert.throws(() => renderer.root.findByProps({ children: "Delete" }));
      renderer.root.findByProps({ children: "Leave workspace" }); // section title
      renderer.root.findByProps({ children: "Leave" }); // action button
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("opening the confirm dialog shows the Leave copy, and confirming calls leaveWorkspace and lets the on-success redirect propagate uncaught so the router can navigate", async () => {
    const renderer = mountWorkspaceSettings({
      workspaceId: "workspace-1",
      name: "Marketing",
      isOwner: false,
    });
    try {
      act(() => {
        renderer.root.findByProps({ children: "Leave" }).props.onClick();
      });
      const dialogChildren = findDialog(renderer).props.children as ReactNode;
      const heading = firstElement(dialogChildren, (el) => el.type === "h2");
      assert.equal(heading.props.children, "Leave this workspace?");
      const confirmButton = firstElement(
        dialogChildren,
        (el) => el.props.children === "Leave workspace",
      );
      // `leaveWorkspace` also calls `redirect("/app/workspaces")` on
      // success, and the signal must escape `handleDestructive` uncaught
      // (see the equivalent owner/delete test above for the full rationale).
      await assert.rejects(
        async () =>
          act(async () => {
            await (confirmButton.props.onClick as () => Promise<void>)();
          }),
        (err: unknown) => isRedirectSignal(err, "/app/workspaces"),
      );
      assert.deepEqual(callsOf("leaveWorkspaceForUser"), [
        ["leaveWorkspaceForUser", "workspace-1", "user-1"],
      ]);
      assert.deepEqual(callsOf("redirect"), [["redirect", "/app/workspaces"]]);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("a genuine leave failure stays in the dialog with generic redacted recovery", async () => {
    state().leaveWorkspaceForUser = async () => {
      throw new Error("Transfer ownership before leaving.");
    };
    const renderer = mountWorkspaceSettings({
      workspaceId: "workspace-1",
      name: "Marketing",
      isOwner: false,
    });
    try {
      act(() => {
        renderer.root.findByProps({ children: "Leave" }).props.onClick();
      });
      const confirmButton = firstElement(
        findDialog(renderer).props.children as ReactNode,
        (el) => el.props.children === "Leave workspace",
      );
      await act(async () => {
        (confirmButton.props.onClick as () => void)();
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      const dialogText = textContent(
        findDialog(renderer).props.children as ReactNode,
      );
      assert.match(
        dialogText,
        /Could not leave the workspace\. Please try again\./,
      );
      assert.doesNotMatch(dialogText, /Transfer ownership before leaving\./);
      assert.equal(findDialog(renderer).props.open, true);
      assert.equal(callsOf("redirect").length, 0);
    } finally {
      act(() => renderer.unmount());
    }
  });
});
