/**
 * Direct contract coverage for `InviteLinkManager` (issue #1957).
 *
 * `InviteLinkManager` is mounted with a real `react-test-renderer` tree
 * (matching `import-button.test.tsx`'s harness pattern) so its `useState`-
 * driven role/expiry/max-uses selectors, invite list rendering, and
 * create/revoke/copy handlers are exercised directly. The sibling
 * `./actions` module is loaded for real; only its deep dependencies
 * (session, workspace capability check, invite service, next/cache,
 * next/navigation) are stubbed via module hooks — the authorization and
 * persistence behavior those dependencies encapsulate is already covered by
 * `actions.test.ts` and is not re-asserted here. This file only asserts
 * what the component itself does with the action's resolved/rejected
 * values.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, describe, test } from "node:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { Button } from "@/components/ui/button";
import { FIELD_CONTROL, PANEL_CHROME, cx } from "@/components/ui/tokens";
import "@/test/react-render-harness";

import type { InviteLink } from "@/lib/workspace/invite-types";

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
  calls: unknown[];
  redirect: (url: string) => never;
  revalidatePath: (path: string) => void;
  requireUser: (redirect: (url: string) => never) => Promise<{ id: string }>;
  requireWorkspaceCapability: (
    userId: string,
    workspaceId: string,
    capability: string,
  ) => Promise<unknown>;
  assertInvitableWorkspaceRole: (role: unknown) => void;
  createWorkspaceInviteLink: (args: {
    workspaceId: string;
    role: string;
    createdById: string;
    options: unknown;
  }) => Promise<InviteLink>;
  getInviteLinkTarget: (
    linkId: string,
  ) => Promise<{ workspaceId: string } | null>;
  revokeWorkspaceInviteLink: (linkId: string) => Promise<void>;
};

const globalForTest = globalThis as typeof globalThis & {
  __inviteLinkManagerTestState: TestState;
  __inviteLinkManagerUiBridge: {
    Button: unknown;
    FIELD_CONTROL: string;
    PANEL_CHROME: string;
    cx: typeof cx;
  };
};

function createDefaultState(): TestState {
  const calls: unknown[] = [];
  return {
    calls,
    redirect(url: string): never {
      calls.push(["redirect", url]);
      const error = new Error(`NEXT_REDIRECT:${url}`) as Error & {
        digest: string;
      };
      error.digest = `NEXT_REDIRECT;replace;${url};307;`;
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
      return { role: "OWNER", canView: true, canMutate: true, canManage: true };
    },
    assertInvitableWorkspaceRole(role) {
      calls.push(["assertInvitableWorkspaceRole", role]);
    },
    async createWorkspaceInviteLink(args) {
      calls.push(["createWorkspaceInviteLink", args]);
      return {
        id: "link-new",
        token: "tok-new",
        role: args.role as InviteLink["role"],
        createdAt: new Date("2026-02-01T00:00:00Z"),
        expiresAt: null,
        maxUses: null,
        useCount: 0,
      };
    },
    async getInviteLinkTarget(linkId) {
      calls.push(["getInviteLinkTarget", linkId]);
      return { workspaceId: "workspace-1" };
    },
    async revokeWorkspaceInviteLink(linkId) {
      calls.push(["revokeWorkspaceInviteLink", linkId]);
    },
  };
}

globalForTest.__inviteLinkManagerTestState = createDefaultState();
globalForTest.__inviteLinkManagerUiBridge = {
  Button,
  FIELD_CONTROL,
  PANEL_CHROME,
  cx,
};
// `getInviteUrl` early-returns "" when `window` is undefined (a real,
// unmocked concern in this Node test environment) — a fixed origin lets
// the copy-link assertions below verify the actual URL construction.
Object.defineProperty(globalThis, "window", {
  configurable: true,
  writable: true,
  value: { location: { origin: "https://workspace.test" } },
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    clipboard: { writeText: async () => undefined },
  },
});

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-invite-link-manager-test:";

const stubbedModules = new Map<string, string>([
  ["server-only", ""],
  [
    "@/components/ui",
    `
      export const Button = globalThis.__inviteLinkManagerUiBridge.Button;
      export const FIELD_CONTROL = globalThis.__inviteLinkManagerUiBridge.FIELD_CONTROL;
      export const PANEL_CHROME = globalThis.__inviteLinkManagerUiBridge.PANEL_CHROME;
      export const cx = globalThis.__inviteLinkManagerUiBridge.cx;
      export function Dialog({ children }) { return children; }
    `,
  ],
  [
    "next/navigation",
    `
      export function redirect(url) {
        return globalThis.__inviteLinkManagerTestState.redirect(url);
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
        globalThis.__inviteLinkManagerTestState.revalidatePath(path);
      }
    `,
  ],
  [
    "@/lib/session",
    `
      export async function requireUser(redirect) {
        return globalThis.__inviteLinkManagerTestState.requireUser(redirect);
      }
    `,
  ],
  [
    "@/lib/auth/workspace-capabilities",
    `
      export async function requireWorkspaceCapability(userId, workspaceId, capability) {
        return globalThis.__inviteLinkManagerTestState.requireWorkspaceCapability(
          userId, workspaceId, capability,
        );
      }
    `,
  ],
  [
    "@/lib/workspace/invite-service",
    `
      export function assertInvitableWorkspaceRole(role) {
        return globalThis.__inviteLinkManagerTestState.assertInvitableWorkspaceRole(role);
      }
      export async function createWorkspaceInviteLink(args) {
        return globalThis.__inviteLinkManagerTestState.createWorkspaceInviteLink(args);
      }
      export async function getInviteLinkTarget(linkId) {
        return globalThis.__inviteLinkManagerTestState.getInviteLinkTarget(linkId);
      }
      export async function revokeWorkspaceInviteLink(linkId) {
        return globalThis.__inviteLinkManagerTestState.revokeWorkspaceInviteLink(linkId);
      }
    `,
  ],
  [
    "@/lib/workspace/service",
    `
      export async function createWorkspaceDocumentForUser() {}
      export async function deleteWorkspaceAndDetachDocuments() {}
      export async function getWorkspaceMemberRemovalTarget() { return null; }
      export async function importWorkspaceDocumentForUser() {}
      export async function leaveWorkspaceForUser() {}
      export async function listWorkspaceDocumentsForUser() {
        return { documents: [], hasMore: false };
      }
      export async function removeWorkspaceMemberAndDetachDocuments() {}
      export async function renameWorkspaceRecord() {}
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

type InviteLinkManagerModule = typeof import("./invite-link-manager");

let mod: InviteLinkManagerModule;

before(async () => {
  mod = await import("./invite-link-manager");
});

beforeEach(() => {
  globalForTest.__inviteLinkManagerTestState = createDefaultState();
});

function state(): TestState {
  return globalForTest.__inviteLinkManagerTestState;
}

function callsOf(tag: string): unknown[][] {
  return (state().calls as unknown[][]).filter((c) => c[0] === tag);
}

function waitForAsyncDrain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function makeLink(overrides: Partial<InviteLink> = {}): InviteLink {
  return {
    id: "link-1",
    token: "tok-existing",
    role: "EDITOR",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    expiresAt: null,
    maxUses: null,
    useCount: 0,
    ...overrides,
  };
}

function mountManager(
  inviteLinks: InviteLink[],
  workspaceId = "workspace-1",
): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  const InviteLinkManager = mod.InviteLinkManager;
  act(() => {
    renderer = create(
      <InviteLinkManager workspaceId={workspaceId} inviteLinks={inviteLinks} />,
    );
  });
  return renderer;
}

function revokeButtons(renderer: ReactTestRenderer) {
  return renderer.root
    .findAll(
      (instance) =>
        (instance.props as { "aria-label"?: string })["aria-label"] ===
        "Revoke invite link",
    )
    .filter((instance) => typeof instance.type !== "string");
}

async function openRevokeDialog(renderer: ReactTestRenderer, index = 0) {
  const button = revokeButtons(renderer)[index];
  assert.ok(button, "expected a revoke button");
  await act(async () => {
    button.props.onClick({
      currentTarget: { focus() {} } as unknown as HTMLButtonElement,
    });
    await waitForAsyncDrain();
  });
  return renderer.root.findByProps({
    "aria-labelledby": "revoke-invite-title",
  });
}

function findCompositeButton(renderer: ReactTestRenderer, label: string) {
  const button = renderer.root
    .findAll(
      (instance) =>
        typeof instance.type !== "string" &&
        instance.props.children === label &&
        typeof instance.props.onClick === "function",
    )
    .at(-1);
  assert.ok(button, `expected composite button ${label}`);
  return button;
}

describe("InviteLinkManager", () => {
  test("renders the create controls with no list when there are no invite links yet", () => {
    const renderer = mountManager([]);
    try {
      const createButton = renderer.root.findByProps({
        children: "Create invite link",
      });
      assert.equal(typeof createButton.props.onClick, "function");
      assert.throws(() =>
        renderer.root.findByProps({ "aria-label": "Revoke invite link" }),
      );
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("lists existing links with role label, created date, and singular use-count phrasing", () => {
    const renderer = mountManager([
      makeLink({ id: "link-1", role: "VIEWER", useCount: 1 }),
    ]);
    try {
      const html = JSON.stringify(renderer.toJSON());
      assert.match(html, /Viewer/);
      assert.match(html, /"Created"," ","Jan 1"/);
      assert.match(html, /"1 use"/);
      assert.doesNotMatch(html, /"1 uses"/);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("plural use-count and max-uses cap phrasing render correctly", () => {
    const renderer = mountManager([
      makeLink({ id: "link-1", useCount: 3 }),
      makeLink({ id: "link-2", useCount: 2, maxUses: 5 }),
    ]);
    try {
      const html = JSON.stringify(renderer.toJSON());
      assert.match(html, /"3 uses"/);
      assert.match(html, /"2\/5 used"/);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("an expiring link shows its expiry date alongside the created date", () => {
    const renderer = mountManager([
      makeLink({ expiresAt: new Date("2026-03-15T00:00:00Z") }),
    ]);
    try {
      const html = JSON.stringify(renderer.toJSON());
      assert.match(html, /"· Expires"," ","Mar 15"/);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("the invite URL field embeds the workspace origin and the link's token", () => {
    const renderer = mountManager([makeLink({ token: "tok-abc123" })]);
    try {
      const input = renderer.root.find(
        (instance) => instance.type === "input" && instance.props.readOnly,
      );
      assert.equal(
        input.props.value,
        "https://workspace.test/app/join/tok-abc123",
      );
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("clicking the invite URL field selects the text, copies it, and announces success", async () => {
    const written: string[] = [];
    (
      navigator as unknown as { clipboard: { writeText: (s: string) => void } }
    ).clipboard.writeText = (s: string) => written.push(s);
    const renderer = mountManager([makeLink({ token: "tok-copy" })]);
    try {
      const input = renderer.root.find(
        (instance) => instance.type === "input" && instance.props.readOnly,
      );
      let selected = false;
      await act(async () => {
        input.props.onClick({
          currentTarget: {
            select: () => {
              selected = true;
            },
            value: input.props.value,
          },
        });
        await waitForAsyncDrain();
      });
      assert.equal(selected, true);
      assert.deepEqual(written, ["https://workspace.test/app/join/tok-copy"]);
      assert.match(JSON.stringify(renderer.toJSON()), /Invite link copied\./);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("clipboard rejection stays inline with generic retry and dismiss recovery", async () => {
    let shouldFail = true;
    (
      navigator as unknown as {
        clipboard: { writeText: (value: string) => Promise<void> };
      }
    ).clipboard.writeText = async () => {
      if (shouldFail) throw new Error("private clipboard detail");
    };
    const renderer = mountManager([makeLink({ token: "tok-copy-failure" })]);
    try {
      const copyButton = renderer.root
        .findAllByProps({ "aria-label": "Copy Editor invite link" })
        .filter((instance) => typeof instance.type !== "string")[0];
      await act(async () => {
        copyButton.props.onClick();
        await waitForAsyncDrain();
      });
      let tree = JSON.stringify(renderer.toJSON());
      assert.match(tree, /Could not copy the invite link\. Please try again\./);
      assert.doesNotMatch(tree, /private clipboard detail/);

      const dismissButton = findCompositeButton(renderer, "Dismiss error");
      act(() => {
        dismissButton.props.onClick();
      });
      assert.doesNotMatch(
        JSON.stringify(renderer.toJSON()),
        /Could not copy the invite link/,
      );

      await act(async () => {
        copyButton.props.onClick();
        await waitForAsyncDrain();
      });

      shouldFail = false;
      const retryButton = findCompositeButton(renderer, "Try copy again");
      await act(async () => {
        retryButton.props.onClick();
        await waitForAsyncDrain();
      });
      tree = JSON.stringify(renderer.toJSON());
      assert.match(tree, /Invite link copied\./);
      assert.doesNotMatch(tree, /Could not copy/);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("creating a link with the default EDITOR role and no expiry/max-uses passes null options", async () => {
    const renderer = mountManager([]);
    try {
      const createButton = renderer.root.findByProps({
        children: "Create invite link",
      });
      await act(async () => {
        createButton.props.onClick();
        await waitForAsyncDrain();
      });
      assert.deepEqual(callsOf("createWorkspaceInviteLink"), [
        [
          "createWorkspaceInviteLink",
          {
            workspaceId: "workspace-1",
            role: "EDITOR",
            createdById: "user-1",
            options: { expiresInDays: null, maxUses: null },
          },
        ],
      ]);
      // The newly-created link is prepended to the list.
      const html = JSON.stringify(renderer.toJSON());
      assert.match(html, /tok-new/);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("selecting VIEWER role, a 7-day expiry, and a max-uses cap passes the parsed values through", async () => {
    const renderer = mountManager([]);
    try {
      const roleSelect = renderer.root.find(
        (instance) =>
          instance.type === "select" && instance.props.value === "EDITOR",
      );
      act(() => {
        roleSelect.props.onChange({ target: { value: "VIEWER" } });
      });
      const expirySelect = renderer.root.findByProps({
        "aria-label": "Invite link expiry",
      });
      act(() => {
        expirySelect.props.onChange({ target: { value: "7" } });
      });
      const maxUsesInput = renderer.root.findByProps({
        "aria-label": "Maximum uses (leave blank for unlimited)",
      });
      act(() => {
        maxUsesInput.props.onChange({ target: { value: "5" } });
      });
      const createButton = renderer.root.findByProps({
        children: "Create invite link",
      });
      await act(async () => {
        createButton.props.onClick();
        await waitForAsyncDrain();
      });
      assert.deepEqual(callsOf("createWorkspaceInviteLink"), [
        [
          "createWorkspaceInviteLink",
          {
            workspaceId: "workspace-1",
            role: "VIEWER",
            createdById: "user-1",
            options: { expiresInDays: 7, maxUses: 5 },
          },
        ],
      ]);
      // The max-uses field resets after a successful create.
      const maxUsesAfter = renderer.root.findByProps({
        "aria-label": "Maximum uses (leave blank for unlimited)",
      });
      assert.equal(maxUsesAfter.props.value, "");
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("invalid maximum uses is rejected locally with actionable feedback", async () => {
    const renderer = mountManager([]);
    try {
      const maxUsesInput = renderer.root.findByProps({
        "aria-label": "Maximum uses (leave blank for unlimited)",
      });
      act(() => {
        maxUsesInput.props.onChange({ target: { value: "1.5" } });
      });
      const createButton = renderer.root.findByProps({
        children: "Create invite link",
      });
      await act(async () => {
        createButton.props.onClick();
        await waitForAsyncDrain();
      });
      assert.equal(callsOf("requireUser").length, 0);
      assert.match(
        JSON.stringify(renderer.toJSON()),
        /Maximum uses must be a whole number of at least 1\./,
      );
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("the created link is not yet in the list until the create promise resolves (in-flight state)", async () => {
    let resolveCreate!: () => void;
    state().createWorkspaceInviteLink = (args) => {
      return new Promise((resolve) => {
        resolveCreate = () =>
          resolve({
            id: "link-async",
            token: "tok-async",
            role: args.role as InviteLink["role"],
            createdAt: new Date("2026-02-01T00:00:00Z"),
            expiresAt: null,
            maxUses: null,
            useCount: 0,
          });
      });
    };
    const renderer = mountManager([]);
    try {
      const createButton = renderer.root.findByProps({
        children: "Create invite link",
      });
      // One drain lets the action's earlier `requireUser`/
      // `requireWorkspaceCapability` awaits settle so execution reaches
      // the (still-unresolved) `createWorkspaceInviteLink` call below.
      await act(async () => {
        createButton.props.onClick();
        await waitForAsyncDrain();
      });
      assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /tok-async/);
      await act(async () => {
        resolveCreate();
        await waitForAsyncDrain();
      });
      assert.match(JSON.stringify(renderer.toJSON()), /tok-async/);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("same-event repeated create activation issues one durable invite mutation", async () => {
    let resolveCreate!: (link: InviteLink) => void;
    state().createWorkspaceInviteLink = () =>
      new Promise((resolve) => {
        resolveCreate = resolve;
      });
    const renderer = mountManager([]);
    try {
      const createButton = renderer.root.findByProps({
        children: "Create invite link",
      });
      await act(async () => {
        createButton.props.onClick();
        createButton.props.onClick();
        await waitForAsyncDrain();
      });
      assert.equal(callsOf("requireUser").length, 1);

      await act(async () => {
        resolveCreate(makeLink({ id: "link-new", token: "tok-new" }));
        await waitForAsyncDrain();
      });
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("switching workspaces resets pending invite state and rejects a late create result from the old workspace", async () => {
    let resolveWorkspaceOne!: (link: InviteLink) => void;
    state().createWorkspaceInviteLink = (args) => {
      state().calls.push(["createWorkspaceInviteLink", args]);
      if (args.workspaceId === "workspace-1") {
        return new Promise((resolve) => {
          resolveWorkspaceOne = resolve;
        });
      }
      return Promise.resolve(
        makeLink({
          id: "workspace-two-created",
          token: "tok-workspace-two-created",
          role: args.role as InviteLink["role"],
        }),
      );
    };
    const renderer = mountManager([
      makeLink({ id: "workspace-one-link", token: "tok-workspace-one" }),
    ]);
    try {
      let workspaceOneCreation!: Promise<void>;
      const createWorkspaceOne = renderer.root.findByProps({
        children: "Create invite link",
      });
      act(() => {
        workspaceOneCreation = createWorkspaceOne.props.onClick();
      });
      await act(async () => {
        await waitForAsyncDrain();
      });

      const InviteLinkManager = mod.InviteLinkManager;
      const workspaceTwoInitial = makeLink({
        id: "workspace-two-link",
        token: "tok-workspace-two-initial",
      });
      act(() => {
        renderer.update(
          <InviteLinkManager
            workspaceId="workspace-2"
            inviteLinks={[workspaceTwoInitial]}
          />,
        );
      });
      const switchedTree = JSON.stringify(renderer.toJSON());
      assert.match(switchedTree, /tok-workspace-two-initial/);
      assert.doesNotMatch(switchedTree, /tok-workspace-one/);
      const createWorkspaceTwo = renderer.root.findByProps({
        children: "Create invite link",
      });
      assert.equal(createWorkspaceTwo.props.disabled, false);

      await act(async () => {
        await createWorkspaceTwo.props.onClick();
      });
      assert.match(
        JSON.stringify(renderer.toJSON()),
        /tok-workspace-two-created/,
      );

      await act(async () => {
        resolveWorkspaceOne(
          makeLink({
            id: "workspace-one-late",
            token: "tok-workspace-one-late",
          }),
        );
        await workspaceOneCreation;
      });
      const finalTree = JSON.stringify(renderer.toJSON());
      assert.match(finalTree, /tok-workspace-two-created/);
      assert.match(finalTree, /tok-workspace-two-initial/);
      assert.doesNotMatch(finalTree, /tok-workspace-one-late/);
      assert.deepEqual(
        callsOf("createWorkspaceInviteLink").map(
          (call) => (call[1] as { workspaceId: string }).workspaceId,
        ),
        ["workspace-1", "workspace-2"],
      );
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("revoking requires confirmation and removes the link only after confirmation succeeds", async () => {
    const renderer = mountManager([
      makeLink({ id: "link-1", token: "tok-1" }),
      makeLink({ id: "link-2", token: "tok-2" }),
    ]);
    try {
      assert.equal(revokeButtons(renderer).length, 2);
      const dialog = await openRevokeDialog(renderer);
      assert.equal(callsOf("revokeWorkspaceInviteLink").length, 0);
      assert.equal(dialog.props.open, true);
      const confirmButton = findCompositeButton(renderer, "Revoke invite link");
      await act(async () => {
        confirmButton.props.onClick();
        await waitForAsyncDrain();
      });
      assert.deepEqual(callsOf("revokeWorkspaceInviteLink"), [
        ["revokeWorkspaceInviteLink", "link-1"],
      ]);
      const html = JSON.stringify(renderer.toJSON());
      assert.doesNotMatch(html, /tok-1/);
      assert.match(html, /tok-2/);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("revoke confirmation locks dismissal and suppresses repeated confirmation while pending", async () => {
    let resolveRevoke!: () => void;
    state().revokeWorkspaceInviteLink = (linkId) => {
      state().calls.push(["revokeWorkspaceInviteLink", linkId]);
      return new Promise((resolve) => {
        resolveRevoke = resolve;
      });
    };
    const renderer = mountManager([makeLink({ id: "link-1", token: "tok-1" })]);
    try {
      await openRevokeDialog(renderer);
      const confirmButton = findCompositeButton(renderer, "Revoke invite link");
      await act(async () => {
        confirmButton.props.onClick();
        confirmButton.props.onClick();
        await waitForAsyncDrain();
      });
      assert.equal(callsOf("revokeWorkspaceInviteLink").length, 1);
      const dialog = renderer.root.findByProps({
        "aria-labelledby": "revoke-invite-title",
      });
      assert.equal(dialog.props["aria-busy"], true);
      assert.equal(
        findCompositeButton(renderer, "Cancel").props.disabled,
        true,
      );
      act(() => {
        dialog.props.onClose();
      });
      assert.equal(
        renderer.root.findByProps({
          "aria-labelledby": "revoke-invite-title",
        }).props.open,
        true,
      );

      await act(async () => {
        resolveRevoke();
        await waitForAsyncDrain();
      });
      assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /tok-1/);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("a rejected create is contained with generic redacted feedback, without adding a link", async () => {
    state().createWorkspaceInviteLink = async () => {
      throw new Error("boom");
    };
    const renderer = mountManager([]);
    try {
      const createButton = renderer.root.findByProps({
        children: "Create invite link",
      });
      await act(async () => {
        createButton.props.onClick();
        await waitForAsyncDrain();
      });
      renderer.root.findByProps({ role: "alert" });
      const tree = JSON.stringify(renderer.toJSON());
      assert.match(tree, /Could not create invite link\. Please try again\./);
      assert.doesNotMatch(tree, /boom/);
      assert.doesNotMatch(tree, /tok-new/);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("a non-Error create rejection falls back to a generic message", async () => {
    state().createWorkspaceInviteLink = async () => {
      throw "not an Error instance";
    };
    const renderer = mountManager([]);
    try {
      const createButton = renderer.root.findByProps({
        children: "Create invite link",
      });
      await act(async () => {
        createButton.props.onClick();
        await waitForAsyncDrain();
      });
      assert.match(
        JSON.stringify(renderer.toJSON()),
        /Could not create invite link\./,
      );
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("a rejected revoke stays in the locked dialog with generic redacted retry feedback", async () => {
    let shouldFail = true;
    state().revokeWorkspaceInviteLink = async (linkId) => {
      state().calls.push(["revokeWorkspaceInviteLink", linkId]);
      if (shouldFail) throw new Error("Cannot revoke this link.");
    };
    const renderer = mountManager([makeLink({ id: "link-1", token: "tok-1" })]);
    try {
      await openRevokeDialog(renderer);
      const confirmButton = findCompositeButton(renderer, "Revoke invite link");
      await act(async () => {
        confirmButton.props.onClick();
        await waitForAsyncDrain();
      });
      renderer.root.findByProps({ role: "alert" });
      const tree = JSON.stringify(renderer.toJSON());
      assert.match(tree, /Could not revoke invite link\. Please try again\./);
      assert.doesNotMatch(tree, /Cannot revoke this link\./);
      assert.match(tree, /tok-1/);
      assert.equal(
        renderer.root.findByProps({
          "aria-labelledby": "revoke-invite-title",
        }).props.open,
        true,
      );

      shouldFail = false;
      const retryButton = findCompositeButton(renderer, "Try revoke again");
      await act(async () => {
        retryButton.props.onClick();
        retryButton.props.onClick();
        await waitForAsyncDrain();
      });
      assert.equal(callsOf("revokeWorkspaceInviteLink").length, 2);
      assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /tok-1/);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("a non-Error revoke rejection falls back to a generic message", async () => {
    state().revokeWorkspaceInviteLink = async () => {
      throw "not an Error instance";
    };
    const renderer = mountManager([makeLink({ id: "link-1", token: "tok-1" })]);
    try {
      await openRevokeDialog(renderer);
      const confirmButton = findCompositeButton(renderer, "Revoke invite link");
      await act(async () => {
        confirmButton.props.onClick();
        await waitForAsyncDrain();
      });
      assert.match(
        JSON.stringify(renderer.toJSON()),
        /Could not revoke invite link\./,
      );
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("an error thrown deeper in the create action is redacted from the alert", async () => {
    // `createInviteLink`/`revokeInviteLink` only ever throw — there is no
    // `{ ok: false, error }` return shape on these actions today, unlike the
    // `ActionResult` convention used elsewhere (e.g.
    // `src/app/app/brands/actions.ts`). This exercises a rejection that
    // originates from a dependency awaited *inside* the action
    // (`requireWorkspaceCapability`) rather than from `createWorkspaceInviteLink`
    // itself, confirming the handler's `try`/`catch` wraps the entire
    // awaited action call, not just its final step.
    state().requireWorkspaceCapability = async () => {
      throw new Error("Not authorized to manage this workspace.");
    };
    const renderer = mountManager([]);
    try {
      const createButton = renderer.root.findByProps({
        children: "Create invite link",
      });
      await act(async () => {
        createButton.props.onClick();
        await waitForAsyncDrain();
      });
      assert.match(
        JSON.stringify(renderer.toJSON()),
        /Could not create invite link\. Please try again\./,
      );
      assert.doesNotMatch(
        JSON.stringify(renderer.toJSON()),
        /Not authorized to manage this workspace\./,
      );
      assert.equal(callsOf("createWorkspaceInviteLink").length, 0);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("framework redirect control flow escapes invite failure recovery", async () => {
    state().requireUser = async () => state().redirect("/login");
    const renderer = mountManager([]);
    try {
      const createButton = renderer.root.findByProps({
        children: "Create invite link",
      });
      await assert.rejects(
        async () =>
          act(async () => {
            await createButton.props.onClick();
          }),
        (error: unknown) =>
          error instanceof Error &&
          (error as Error & { digest?: string }).digest?.startsWith(
            "NEXT_REDIRECT",
          ) === true,
      );
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("retrying a create after a failure clears the previous error once the retry succeeds", async () => {
    let shouldFail = true;
    state().createWorkspaceInviteLink = async (args) => {
      if (shouldFail) throw new Error("temporary failure");
      return {
        id: "link-retry",
        token: "tok-retry",
        role: args.role as InviteLink["role"],
        createdAt: new Date("2026-02-01T00:00:00Z"),
        expiresAt: null,
        maxUses: null,
        useCount: 0,
      };
    };
    const renderer = mountManager([]);
    try {
      const createButton = renderer.root.findByProps({
        children: "Create invite link",
      });
      await act(async () => {
        createButton.props.onClick();
        await waitForAsyncDrain();
      });
      assert.ok(renderer.root.findByProps({ role: "alert" }));

      shouldFail = false;
      const retryButton = findCompositeButton(renderer, "Try create again");
      await act(async () => {
        retryButton.props.onClick();
        retryButton.props.onClick();
        await waitForAsyncDrain();
      });
      assert.equal(callsOf("requireUser").length, 2);
      assert.throws(() => renderer.root.findByProps({ role: "alert" }));
      assert.match(JSON.stringify(renderer.toJSON()), /tok-retry/);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("a successful revoke after a failed create clears the stale create error", async () => {
    state().createWorkspaceInviteLink = async () => {
      throw new Error("cannot create right now");
    };
    const renderer = mountManager([makeLink({ id: "link-1", token: "tok-1" })]);
    try {
      const createButton = renderer.root.findByProps({
        children: "Create invite link",
      });
      await act(async () => {
        createButton.props.onClick();
        await waitForAsyncDrain();
      });
      assert.ok(renderer.root.findByProps({ role: "alert" }));

      await openRevokeDialog(renderer);
      assert.throws(() => renderer.root.findByProps({ role: "alert" }));
      const confirmButton = findCompositeButton(renderer, "Revoke invite link");
      await act(async () => {
        confirmButton.props.onClick();
        await waitForAsyncDrain();
      });
      assert.throws(() => renderer.root.findByProps({ role: "alert" }));
      assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /tok-1/);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("an in-flight create synchronously blocks a competing revoke and locks mutation controls", async () => {
    let resolveCreate!: (link: InviteLink) => void;
    state().createWorkspaceInviteLink = () =>
      new Promise((resolve) => {
        resolveCreate = resolve;
      });
    const renderer = mountManager([makeLink({ id: "link-1", token: "tok-1" })]);
    try {
      const createButton = renderer.root.findByProps({
        children: "Create invite link",
      });
      const revokeButton = revokeButtons(renderer)[0];

      await act(async () => {
        createButton.props.onClick();
        revokeButton.props.onClick({
          currentTarget: { focus() {} } as unknown as HTMLButtonElement,
        });
        await waitForAsyncDrain();
      });
      assert.equal(callsOf("revokeWorkspaceInviteLink").length, 0);
      assert.throws(() =>
        renderer.root.findByProps({
          "aria-labelledby": "revoke-invite-title",
        }),
      );
      assert.equal(revokeButtons(renderer)[0].props.disabled, true);
      assert.throws(() => renderer.root.findByProps({ role: "alert" }));
      assert.match(JSON.stringify(renderer.toJSON()), /tok-1/);

      await act(async () => {
        resolveCreate({
          id: "link-new",
          token: "tok-new",
          role: "EDITOR",
          createdAt: new Date("2026-02-01T00:00:00Z"),
          expiresAt: null,
          maxUses: null,
          useCount: 0,
        });
        await waitForAsyncDrain();
      });
      const html = JSON.stringify(renderer.toJSON());
      assert.match(html, /tok-1/);
      assert.match(html, /tok-new/);
      assert.equal(revokeButtons(renderer)[0].props.disabled, false);
    } finally {
      act(() => renderer.unmount());
    }
  });
});
