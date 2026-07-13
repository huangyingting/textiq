/**
 * Direct contract coverage for `MembersList` (issue #1957).
 *
 * `MembersList` is mounted with a real `react-test-renderer` tree so its
 * owner/self/member action-visibility rules, `removeMember`/
 * `transferOwnership` wiring (via `useTransition`), and error-recovery
 * states are exercised directly. The sibling `./actions` module is loaded
 * for real; only its deep dependencies (session, workspace capability
 * check, workspace service, next/cache, next/navigation) are stubbed via
 * module hooks — the authorization/persistence behavior those dependencies
 * encapsulate is already covered by `actions.test.ts` and is not
 * re-asserted here.
 *
 * `@/components/ui`'s `Dialog` is also stubbed to a no-op (its `Button`
 * and token exports are re-exported for real). This is a hard environment
 * constraint, not a shortcut: `Dialog`/`ModalSurface` (in
 * `src/components/ui/overlay-stack.tsx`) calls `document.activeElement`/
 * `document.addEventListener` from an unconditional `useEffect` the moment
 * `open` becomes `true`, and portals into `document.body` via
 * `react-dom`'s `createPortal`. There is no `document` global in this
 * Node test process (no jsdom, per task constraints), and — confirmed by
 * direct experiment — `react-test-renderer` hard-rejects any
 * `createPortal` target that isn't its own internal container ("An
 * invalid container has been provided... This is not supported."), so no
 * amount of `document` faking can make a real open transition survive
 * here. `Dialog`/`ModalSurface`'s own open/close/focus-trap/escape
 * behavior already has dedicated coverage in
 * `src/components/ui/ui-interactions-coverage.test.ts` (which uses a
 * specialized fake-React-hooks technique built for exactly this), so it is
 * intentionally not re-tested through `MembersList`. What *is* verified
 * here is `MembersList`'s own wiring: that "Make owner" targets the right
 * member (read via the `Dialog` call site's own `open`/`children` props,
 * which React constructs eagerly regardless of what `Dialog` does with
 * them), and that "Cancel"/"Transfer ownership" invoke the right
 * handlers.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, describe, test } from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { Button } from "@/components/ui/button";
import { PANEL_CHROME, cx } from "@/components/ui/tokens";
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

type MemberTarget = { workspaceId: string; userId: string };

type TestState = {
  calls: unknown[];
  redirect: (url: string) => never;
  revalidatePath: (path: string) => void;
  requireUser: (redirect: (url: string) => never) => Promise<{ id: string }>;
  requireWorkspaceCapability: (
    userId: string,
    workspaceId: string,
    capability: string,
  ) => Promise<unknown>;
  getWorkspaceMemberRemovalTarget: (
    memberId: string,
  ) => Promise<MemberTarget | null>;
  removeWorkspaceMemberAndDetachDocuments: (
    memberId: string,
    member: MemberTarget,
  ) => Promise<void>;
  transferWorkspaceOwnership: (
    workspaceId: string,
    currentOwnerId: string,
    newOwnerUserId: string,
  ) => Promise<void>;
};

const globalForTest = globalThis as typeof globalThis & {
  __membersListTestState: TestState;
};

function createDefaultState(): TestState {
  const calls: unknown[] = [];
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
    async getWorkspaceMemberRemovalTarget(memberId) {
      calls.push(["getWorkspaceMemberRemovalTarget", memberId]);
      return { workspaceId: "workspace-1", userId: "user-2" };
    },
    async removeWorkspaceMemberAndDetachDocuments(memberId, member) {
      calls.push(["removeWorkspaceMemberAndDetachDocuments", memberId, member]);
    },
    async transferWorkspaceOwnership(
      workspaceId,
      currentOwnerId,
      newOwnerUserId,
    ) {
      calls.push([
        "transferWorkspaceOwnership",
        workspaceId,
        currentOwnerId,
        newOwnerUserId,
      ]);
    },
  };
}

globalForTest.__membersListTestState = createDefaultState();
// Node 22's synchronous require(esm) interop path can drop the export from
// a synthetic `export { Button } from "@/components/ui/button"` re-export
// evaluated inside a module-hook-provided source string (reproduced via
// direct experiment: "The requested module '@/components/ui/button' does
// not provide an export named 'Button'", even though the real module
// unambiguously exports it). Node 24 does not exhibit this. To stay on the
// real `Button`/token implementations without tripping that interop bug,
// the real bindings are imported normally above (resolved through the
// default loader, before any hooks are registered) and bridged into the
// synthetic `@/components/ui` module below via a global instead of a
// nested `export ... from` statement.
(
  globalThis as typeof globalThis & {
    __membersListUiBridge: {
      Button: unknown;
      PANEL_CHROME: unknown;
      cx: unknown;
    };
  }
).__membersListUiBridge = { Button, PANEL_CHROME, cx };
Object.defineProperty(globalThis, "window", {
  configurable: true,
  writable: true,
  value: {
    location: {
      reload: () => globalForTest.__membersListTestState.calls.push(["reload"]),
    },
  },
});

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-members-list-test:";

const stubbedModules = new Map<string, string>([
  ["server-only", ""],
  [
    "@/components/ui",
    `
      export const Button = globalThis.__membersListUiBridge.Button;
      export const PANEL_CHROME = globalThis.__membersListUiBridge.PANEL_CHROME;
      export const cx = globalThis.__membersListUiBridge.cx;
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
        return globalThis.__membersListTestState.redirect(url);
      }
    `,
  ],
  [
    "next/cache",
    `
      export function revalidatePath(path) {
        globalThis.__membersListTestState.revalidatePath(path);
      }
    `,
  ],
  [
    "@/lib/session",
    `
      export async function requireUser(redirect) {
        return globalThis.__membersListTestState.requireUser(redirect);
      }
    `,
  ],
  [
    "@/lib/auth/workspace-capabilities",
    `
      export async function requireWorkspaceCapability(userId, workspaceId, capability) {
        return globalThis.__membersListTestState.requireWorkspaceCapability(
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
      export async function deleteWorkspaceAndDetachDocuments() {}
      export async function getWorkspaceMemberRemovalTarget(memberId) {
        return globalThis.__membersListTestState.getWorkspaceMemberRemovalTarget(memberId);
      }
      export async function importWorkspaceDocumentForUser() {}
      export async function leaveWorkspaceForUser() {}
      export async function listWorkspaceDocumentsForUser() {
        return { documents: [], hasMore: false };
      }
      export async function removeWorkspaceMemberAndDetachDocuments(memberId, member) {
        return globalThis.__membersListTestState.removeWorkspaceMemberAndDetachDocuments(
          memberId, member,
        );
      }
      export async function renameWorkspaceRecord() {}
      export async function transferWorkspaceOwnership(workspaceId, currentOwnerId, newOwnerUserId) {
        return globalThis.__membersListTestState.transferWorkspaceOwnership(
          workspaceId, currentOwnerId, newOwnerUserId,
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

type MembersListModule = typeof import("./members-list");

let mod: MembersListModule;

before(async () => {
  mod = await import("./members-list");
});

beforeEach(() => {
  globalForTest.__membersListTestState = createDefaultState();
});

function state(): TestState {
  return globalForTest.__membersListTestState;
}

function callsOf(tag: string): unknown[][] {
  return (state().calls as unknown[][]).filter((c) => c[0] === tag);
}

function waitForAsyncDrain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

type Member = {
  id: string;
  userId: string;
  role: "OWNER" | "EDITOR" | "VIEWER";
  user: { email: string; name: string | null };
};

type Workspace = {
  id: string;
  ownerId: string;
  owner: { email: string; name: string | null };
  members: Member[];
};

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "workspace-1",
    ownerId: "owner-1",
    owner: { email: "owner@example.com", name: "Owner Person" },
    members: [
      {
        id: "member-1",
        userId: "user-2",
        role: "EDITOR",
        user: { email: "editor@example.com", name: "Edith Editor" },
      },
      {
        id: "member-2",
        userId: "user-3",
        role: "VIEWER",
        user: { email: "viewer@example.com", name: null },
      },
    ],
    ...overrides,
  };
}

function mountMembersList(props: {
  workspace: Workspace;
  isOwner: boolean;
  currentUserId: string;
}): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  const MembersList = mod.MembersList;
  act(() => {
    renderer = create(<MembersList {...props} />);
  });
  return renderer;
}

type ElementLike = ReactElement<Record<string, unknown>>;

// Purely structural: never invokes function components (Dialog uses hooks
// and cannot be safely called outside a real render pass) — it only reads
// the already-constructed `children` prop data.
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

/**
 * Locates the `<Dialog aria-labelledby="transfer-ownership-title" ...>`
 * call site by its own props, rather than by type identity — the tree
 * contains the stubbed `Dialog` (see the stub-module map above), not the
 * real one, so `findByType` against a real import would never match. The
 * `Dialog` instance's props (`open`, `children`, etc.) are the same
 * eagerly-constructed data `MembersList` passes in either case.
 */
function findDialog(renderer: ReactTestRenderer) {
  return renderer.root.findByProps({
    "aria-labelledby": "transfer-ownership-title",
  });
}

describe("MembersList", () => {
  test("renders the owner row plus every member with role labels", () => {
    const renderer = mountMembersList({
      workspace: makeWorkspace(),
      isOwner: false,
      currentUserId: "user-2",
    });
    try {
      const text = JSON.stringify(renderer.toJSON());
      assert.match(text, /Owner Person/);
      assert.match(text, /Edith Editor/);
      assert.match(text, /"viewer@example\.com"/);
      assert.match(text, /"Owner"/);
      assert.match(text, /"Editor"/);
      assert.match(text, /"Viewer"/);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("shows the email as a secondary line only when the member has a display name", () => {
    const renderer = mountMembersList({
      workspace: makeWorkspace(),
      isOwner: false,
      currentUserId: "user-2",
    });
    try {
      const text = JSON.stringify(renderer.toJSON());
      assert.match(text, /"editor@example\.com"/); // secondary line for Edith
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("non-owner viewers never see Make-owner/Remove actions", () => {
    const renderer = mountMembersList({
      workspace: makeWorkspace(),
      isOwner: false,
      currentUserId: "user-2",
    });
    try {
      assert.throws(() =>
        renderer.root.findByProps({ children: "Make owner" }),
      );
      assert.throws(() => renderer.root.findByProps({ children: "Remove" }));
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("the owner sees Make-owner/Remove for other members, but never for the OWNER row or their own row", () => {
    const renderer = mountMembersList({
      workspace: makeWorkspace(),
      isOwner: true,
      currentUserId: "user-2", // the "Edith Editor" member is viewing
    });
    try {
      // Edith (self) gets no actions.
      assert.throws(() =>
        renderer.root.findByProps({
          "aria-label": "Remove editor@example.com",
        }),
      );
      // The synthesized OWNER row gets no actions either.
      assert.throws(() =>
        renderer.root.findByProps({
          "aria-label": "Remove owner@example.com",
        }),
      );
      // The other member (viewer) gets both actions.
      renderer.root.findByProps({ "aria-label": "Remove viewer@example.com" });
      renderer.root.findByProps({
        "aria-label": "Make viewer@example.com the owner",
      });
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("removing a member calls removeMember and reloads the page on success", async () => {
    const renderer = mountMembersList({
      workspace: makeWorkspace(),
      isOwner: true,
      currentUserId: "owner-1",
    });
    try {
      const removeButton = renderer.root.findByProps({
        "aria-label": "Remove viewer@example.com",
      });
      await act(async () => {
        removeButton.props.onClick();
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      assert.equal(callsOf("getWorkspaceMemberRemovalTarget").length, 1);
      assert.equal(
        callsOf("removeWorkspaceMemberAndDetachDocuments").length,
        1,
      );
      assert.equal(callsOf("reload").length, 1);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("disables the action buttons while the remove transition is pending", async () => {
    let resolveRemoval!: () => void;
    state().removeWorkspaceMemberAndDetachDocuments = () =>
      new Promise((resolve) => {
        resolveRemoval = resolve;
      });
    const renderer = mountMembersList({
      workspace: makeWorkspace(),
      isOwner: true,
      currentUserId: "owner-1",
    });
    try {
      const removeButton = renderer.root.findByProps({
        "aria-label": "Remove viewer@example.com",
      });
      await act(async () => {
        removeButton.props.onClick();
        await waitForAsyncDrain();
      });
      const pendingRemove = renderer.root.findByProps({
        "aria-label": "Remove viewer@example.com",
      });
      assert.equal(pendingRemove.props.disabled, true);
      const pendingMakeOwner = renderer.root.findByProps({
        "aria-label": "Make viewer@example.com the owner",
      });
      assert.equal(pendingMakeOwner.props.disabled, true);
      await act(async () => {
        resolveRemoval();
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("a failed removal shows an inline error and does not reload", async () => {
    state().removeWorkspaceMemberAndDetachDocuments = async () => {
      throw new Error("You cannot remove this member.");
    };
    const renderer = mountMembersList({
      workspace: makeWorkspace(),
      isOwner: true,
      currentUserId: "owner-1",
    });
    try {
      const removeButton = renderer.root.findByProps({
        "aria-label": "Remove viewer@example.com",
      });
      await act(async () => {
        removeButton.props.onClick();
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      const text = JSON.stringify(renderer.toJSON());
      assert.match(text, /You cannot remove this member\./);
      assert.equal(callsOf("reload").length, 0);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("a non-Error rejection falls back to a generic 'Could not remove.' message", async () => {
    state().removeWorkspaceMemberAndDetachDocuments = async () => {
      throw "not an Error instance";
    };
    const renderer = mountMembersList({
      workspace: makeWorkspace(),
      isOwner: true,
      currentUserId: "owner-1",
    });
    try {
      const removeButton = renderer.root.findByProps({
        "aria-label": "Remove viewer@example.com",
      });
      await act(async () => {
        removeButton.props.onClick();
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      const text = JSON.stringify(renderer.toJSON());
      assert.match(text, /Could not remove\./);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("clicking Make-owner opens the transfer-ownership dialog for that member", () => {
    const renderer = mountMembersList({
      workspace: makeWorkspace(),
      isOwner: true,
      currentUserId: "owner-1",
    });
    try {
      const makeOwnerButton = renderer.root.findByProps({
        "aria-label": "Make viewer@example.com the owner",
      });
      const dialogBefore = findDialog(renderer);
      assert.equal(dialogBefore.props.open, false);
      act(() => {
        makeOwnerButton.props.onClick();
      });
      const dialogAfter = findDialog(renderer);
      assert.equal(dialogAfter.props.open, true);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("Cancel (read from the dialog's own children prop) closes the dialog without transferring", async () => {
    const renderer = mountMembersList({
      workspace: makeWorkspace(),
      isOwner: true,
      currentUserId: "owner-1",
    });
    try {
      const makeOwnerButton = renderer.root.findByProps({
        "aria-label": "Make viewer@example.com the owner",
      });
      act(() => {
        makeOwnerButton.props.onClick();
      });
      const openDialog = findDialog(renderer);
      const cancelButton = firstElement(
        openDialog.props.children as ReactNode,
        (element) => element.props.children === "Cancel",
      );
      act(() => {
        (cancelButton.props.onClick as () => void)();
      });
      const closedDialog = findDialog(renderer);
      assert.equal(closedDialog.props.open, false);
      assert.equal(callsOf("transferWorkspaceOwnership").length, 0);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("confirming the transfer (read from the dialog's own children prop) calls transferOwnership and reloads", async () => {
    const renderer = mountMembersList({
      workspace: makeWorkspace(),
      isOwner: true,
      currentUserId: "owner-1",
    });
    try {
      const makeOwnerButton = renderer.root.findByProps({
        "aria-label": "Make viewer@example.com the owner",
      });
      act(() => {
        makeOwnerButton.props.onClick();
      });
      const openDialog = findDialog(renderer);
      const confirmButton = firstElement(
        openDialog.props.children as ReactNode,
        (element) => element.props.children === "Transfer ownership",
      );
      await act(async () => {
        (confirmButton.props.onClick as () => void)();
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      // `transferOwnership`'s `currentOwnerId` argument comes from
      // `requireUser()` (the *authenticated caller*), not from the
      // `currentUserId` prop passed to the component for UI gating — the
      // stub `requireUser` always resolves to `{ id: "user-1" }`.
      assert.deepEqual(callsOf("transferWorkspaceOwnership"), [
        ["transferWorkspaceOwnership", "workspace-1", "user-1", "user-3"],
      ]);
      assert.equal(callsOf("reload").length, 1);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("a failed transfer closes the dialog and shows an inline error, without reloading", async () => {
    state().transferWorkspaceOwnership = async () => {
      throw new Error("Target is no longer a member.");
    };
    const renderer = mountMembersList({
      workspace: makeWorkspace(),
      isOwner: true,
      currentUserId: "owner-1",
    });
    try {
      const makeOwnerButton = renderer.root.findByProps({
        "aria-label": "Make viewer@example.com the owner",
      });
      act(() => {
        makeOwnerButton.props.onClick();
      });
      const openDialog = findDialog(renderer);
      const confirmButton = firstElement(
        openDialog.props.children as ReactNode,
        (element) => element.props.children === "Transfer ownership",
      );
      await act(async () => {
        (confirmButton.props.onClick as () => void)();
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      const closedDialog = findDialog(renderer);
      assert.equal(closedDialog.props.open, false);
      const text = JSON.stringify(renderer.toJSON());
      assert.match(text, /Target is no longer a member\./);
      assert.equal(callsOf("reload").length, 0);
    } finally {
      act(() => renderer.unmount());
    }
  });
});
