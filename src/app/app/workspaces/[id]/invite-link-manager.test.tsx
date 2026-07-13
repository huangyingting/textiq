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
    "next/navigation",
    `
      export function redirect(url) {
        return globalThis.__inviteLinkManagerTestState.redirect(url);
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

function mountManager(inviteLinks: InviteLink[]): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  const InviteLinkManager = mod.InviteLinkManager;
  act(() => {
    renderer = create(
      <InviteLinkManager workspaceId="workspace-1" inviteLinks={inviteLinks} />,
    );
  });
  return renderer;
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

  test("clicking the invite URL field selects the text and copies it to the clipboard", () => {
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
      act(() => {
        input.props.onClick({
          currentTarget: {
            select: () => {
              selected = true;
            },
            value: input.props.value,
          },
        });
      });
      assert.equal(selected, true);
      assert.deepEqual(written, ["https://workspace.test/app/join/tok-copy"]);
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

  test("revoking a link removes it from the list", async () => {
    const renderer = mountManager([
      makeLink({ id: "link-1", token: "tok-1" }),
      makeLink({ id: "link-2", token: "tok-2" }),
    ]);
    try {
      // `aria-label` is forwarded through `Button`'s `...rest` spread onto
      // the underlying host <button>, so `findAllByProps` matches both the
      // composite `Button` instance and its host element per link; keep
      // only the composite instances (non-string `type`) to get one match
      // per rendered link.
      const revokeButtons = renderer.root
        .findAll(
          (instance) =>
            (instance.props as { "aria-label"?: string })["aria-label"] ===
            "Revoke invite link",
        )
        .filter((instance) => typeof instance.type !== "string");
      assert.equal(revokeButtons.length, 2);
      await act(async () => {
        revokeButtons[0].props.onClick();
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

  test("known gap: create/revoke have no try/catch, so a rejected action propagates as an unhandled rejection (no error UI)", async () => {
    state().createWorkspaceInviteLink = async () => {
      throw new Error("boom");
    };
    const renderer = mountManager([]);
    try {
      const createButton = renderer.root.findByProps({
        children: "Create invite link",
      });
      // `handleCreate` (the real onClick handler) has no try/catch, so its
      // rejection is only observable here because we call it directly and
      // await/catch its returned promise ourselves — a real end user's
      // click would leave this as a genuinely unhandled rejection, which
      // this test intentionally does not reproduce (that would crash the
      // test process); it only confirms no error UI exists for this path.
      await assert.rejects(async () => {
        await act(async () => {
          await createButton.props.onClick();
        });
      }, /boom/);
      assert.throws(() => renderer.root.findByProps({ role: "alert" }));
    } finally {
      act(() => renderer.unmount());
    }
  });
});
