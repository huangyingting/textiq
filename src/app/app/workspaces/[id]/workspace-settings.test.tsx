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
 * **Real, pre-existing defect exercised (not fixed) here**: `handleDestructive`
 * wraps `await deleteWorkspace(...)` / `await leaveWorkspace(...)` in a
 * `try/catch`, but both actions *always* end by calling `redirect(...)` on
 * success (see `./actions.ts`). Per Next.js's own documentation, `redirect()`
 * throws and "should be called outside of try/catch blocks" — so on a
 * *successful* delete/leave here, the catch block intercepts that
 * intentional throw and displays it as a generic failure message, and the
 * `window.location.assign("/app/workspaces")` fallback on the line above it
 * never executes (the preceding `await` rejects first). The tests below
 * document this actual current behavior faithfully rather than the
 * (unreachable) intended one; see the final report for the defect writeup.
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
      throw new Error(`NEXT_REDIRECT:${url}`);
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
      assign: (url: string) =>
        globalForTest.__workspaceSettingsTestState.calls.push(["assign", url]),
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

  test("a failed rename shows the error message and does not reload", async () => {
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
      assert.match(text, /That name is already in use\./);
      assert.equal(callsOf("reload").length, 0);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("a non-Error rename rejection falls back to 'Could not rename.'", async () => {
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
      assert.match(JSON.stringify(renderer.toJSON()), /Could not rename\./);
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

  test("confirming delete calls deleteWorkspace, but the redirect-on-success is caught by handleDestructive's try/catch (pre-existing gap): the confirm dialog closes and an error banner shows the raw redirect signal instead of navigating", async () => {
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
      assert.equal(callsOf("deleteWorkspaceAndDetachDocuments").length, 1);
      assert.equal(findDialog(renderer).props.open, false);
      // The intended fallback navigation never runs — `redirect()` rejects
      // the preceding `await` before this line is reached.
      assert.equal(callsOf("assign").length, 0);
      const text = JSON.stringify(renderer.toJSON());
      assert.match(text, /NEXT_REDIRECT:\/app\/workspaces/);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("a genuine delete failure (unrelated to redirect) shows its message and does not navigate", async () => {
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
      const text = JSON.stringify(renderer.toJSON());
      assert.match(text, /Workspace has active billing obligations\./);
      assert.equal(callsOf("assign").length, 0);
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

  test("opening the confirm dialog shows the Leave copy, and confirming calls leaveWorkspace", async () => {
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
      await act(async () => {
        (confirmButton.props.onClick as () => void)();
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      assert.deepEqual(callsOf("leaveWorkspaceForUser"), [
        ["leaveWorkspaceForUser", "workspace-1", "user-1"],
      ]);
      assert.equal(findDialog(renderer).props.open, false);
    } finally {
      act(() => renderer.unmount());
    }
  });
});
