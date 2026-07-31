/**
 * Direct contract coverage for `WorkspaceDocuments` (issue #1957): the
 * documents tab's loading/error/empty/list rendering, owner/editor/viewer
 * create+import gating, the "New document" template picker, and the
 * import-file flow.
 *
 * `./actions` is loaded for real; only its deep dependencies (session,
 * `next/cache`, `next/navigation`, `@/lib/workspace/service`) are stubbed —
 * their authorization/persistence behavior is already covered by
 * `actions.test.ts` and is not re-asserted here. `createWorkspaceDocument`
 * ends with a real `redirect()` on success. The shared picker calls Next's
 * `unstable_rethrow` before handling ordinary failures, so redirect control
 * flow still propagates while durable-create and transport failures stay in a
 * retryable inline alert. Redirect wiring tests use `assert.rejects` around
 * `act()` to safely observe that control flow.
 *
 * `@/components/ui`'s `Dialog` is stubbed to a no-op (see
 * `members-list.test.tsx` for the full rationale): `Dialog`/`ModalSurface`
 * cannot survive an `open` transition in a Node process with no `document`
 * global, and its own open/close/focus-trap behavior already has dedicated
 * coverage in `src/components/ui/ui-interactions-coverage.test.ts`. `Button`/
 * `IconButton`/tokens are re-exported for real.
 *
 * `useDocumentImportCreationWorkflow`'s own upload/validation/error logic is fully
 * covered by `document-import-workflow.test.ts` and `import-button.test.tsx`;
 * here only the wiring (selecting a file drives `importWorkspaceDocument`,
 * and the hook's error state renders through `WorkspaceDocumentActions`) is
 * exercised, using the same real-`fetch`-mocking technique as
 * `import-button.test.tsx` (the hook has no injectable port from this
 * component).
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, describe, test } from "node:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { Button, IconButton } from "@/components/ui/button";
import { PANEL_CHROME, EMPTY_STATE_CHROME, cx } from "@/components/ui/tokens";
import "@/test/react-render-harness";

import { TEMPLATE_CATALOG } from "@/lib/templates/catalog";
import type { WorkspaceDocument } from "@/lib/workspace/document-types";

// `next/link` prefetches via `useIntersection`, which falls back to
// `requestIdleCallback` (from `next/dist/client/request-idle-callback.js`)
// when no `IntersectionObserver` global exists. That fallback dereferences
// the browser-only `self` global directly (not just `typeof self`), so
// without this one-line alias every `<Link>` mount throws `ReferenceError:
// self is not defined` from a passive effect. This is a plain global alias
// (`self === globalThis`, as in real browsers), not a DOM/jsdom shim — the
// resulting `requestIdleCallback` call only flips an internal "visible"
// state that this suite never depends on.
if (typeof (globalThis as { self?: unknown }).self === "undefined") {
  (globalThis as { self?: unknown }).self = globalThis;
}

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
  push: (url: string) => void;
  redirect: (url: string) => never;
  revalidatePath: (path: string) => void;
  requireUser: (redirect: (url: string) => never) => Promise<{ id: string }>;
  listWorkspaceDocumentsForUser: (
    userId: string,
    workspaceId: string,
  ) => Promise<{ documents: WorkspaceDocument[]; hasMore: boolean }>;
  createWorkspaceDocumentForUser: (
    userId: string,
    workspaceId: string,
    templateId: string,
  ) => Promise<{ id: string }>;
};

const globalForTest = globalThis as typeof globalThis & {
  __workspaceDocumentsTestState: TestState;
};

function createDefaultState(): TestState {
  const calls: unknown[][] = [];
  return {
    calls,
    push(url: string) {
      calls.push(["router.push", url]);
    },
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
    async listWorkspaceDocumentsForUser(userId, workspaceId) {
      calls.push(["listWorkspaceDocumentsForUser", userId, workspaceId]);
      return { documents: [], hasMore: false };
    },
    async createWorkspaceDocumentForUser(userId, workspaceId, templateId) {
      calls.push([
        "createWorkspaceDocumentForUser",
        userId,
        workspaceId,
        templateId,
      ]);
      return { id: "doc-1" };
    },
  };
}

globalForTest.__workspaceDocumentsTestState = createDefaultState();
// Node 22's synchronous require(esm) interop path can drop the export from
// a synthetic `export { Button } from "@/components/ui/button"` re-export
// evaluated inside a module-hook-provided source string (reproduced via
// direct experiment: "The requested module '@/components/ui/button' does
// not provide an export named 'Button'", even though the real module
// unambiguously exports it — see `members-list.test.tsx` for the full
// investigation). Node 24 does not exhibit this. To stay on the real
// `Button`/`IconButton`/token implementations without tripping that
// interop bug, the real bindings are imported normally above (resolved
// through the default loader, before any hooks are registered) and
// bridged into the synthetic `@/components/ui` module below via a global
// instead of a nested `export ... from` statement.
(
  globalThis as typeof globalThis & {
    __workspaceDocumentsUiBridge: {
      Button: unknown;
      IconButton: unknown;
      PANEL_CHROME: unknown;
      EMPTY_STATE_CHROME: unknown;
      cx: unknown;
    };
  }
).__workspaceDocumentsUiBridge = {
  Button,
  IconButton,
  PANEL_CHROME,
  EMPTY_STATE_CHROME,
  cx,
};

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-workspace-documents-test:";

const stubbedModules = new Map<string, string>([
  ["server-only", ""],
  [
    "@/components/ui",
    `
      export const Button = globalThis.__workspaceDocumentsUiBridge.Button;
      export const IconButton = globalThis.__workspaceDocumentsUiBridge.IconButton;
      export const PANEL_CHROME = globalThis.__workspaceDocumentsUiBridge.PANEL_CHROME;
      export const EMPTY_STATE_CHROME = globalThis.__workspaceDocumentsUiBridge.EMPTY_STATE_CHROME;
      export const cx = globalThis.__workspaceDocumentsUiBridge.cx;
      // Real Dialog/ModalSurface cannot survive an open transition in a
      // Node process with no document (see file header) — this is
      // covered elsewhere, not re-tested here. WorkspaceTemplatePicker's
      // Dialog is always mounted with open=true (its parent conditionally
      // *mounts* the picker instead), so rendering children when open is
      // safe and lets tests find its buttons directly in the tree.
      export function Dialog({ open, children }) { return open ? children : null; }
    `,
  ],
  [
    "next/navigation",
    `
      export function useRouter() {
        return {
          push(url) {
            globalThis.__workspaceDocumentsTestState.push(url);
          },
        };
      }
      export function redirect(url) {
        return globalThis.__workspaceDocumentsTestState.redirect(url);
      }
      export function unstable_rethrow(error) {
        if (error instanceof Error && error.message.startsWith("NEXT_REDIRECT:")) {
          throw error;
        }
      }
    `,
  ],
  [
    "next/cache",
    `
      export function revalidatePath(path) {
        globalThis.__workspaceDocumentsTestState.revalidatePath(path);
      }
    `,
  ],
  [
    "@/lib/session",
    `
      export async function requireUser(redirect) {
        return globalThis.__workspaceDocumentsTestState.requireUser(redirect);
      }
    `,
  ],
  [
    "@/lib/workspace/service",
    `
      export async function createWorkspaceDocumentForUser(userId, workspaceId, templateId) {
        return globalThis.__workspaceDocumentsTestState.createWorkspaceDocumentForUser(
          userId, workspaceId, templateId,
        );
      }
      export async function deleteWorkspaceAndDetachDocuments() {}
      export async function getWorkspaceMemberRemovalTarget() { return null; }
      export async function leaveWorkspaceForUser() {}
      export async function listWorkspaceDocumentsForUser(userId, workspaceId) {
        return globalThis.__workspaceDocumentsTestState.listWorkspaceDocumentsForUser(
          userId, workspaceId,
        );
      }
      export async function removeWorkspaceMemberAndDetachDocuments() {}
      export async function renameWorkspaceRecord() {}
      export async function transferWorkspaceOwnership() {}
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

type WorkspaceDocumentsModule = typeof import("./workspace-documents");

let mod: WorkspaceDocumentsModule;

before(async () => {
  mod = await import("./workspace-documents");
});

beforeEach(() => {
  globalForTest.__workspaceDocumentsTestState = createDefaultState();
});

function state(): TestState {
  return globalForTest.__workspaceDocumentsTestState;
}

function callsOf(tag: string): unknown[][] {
  return state().calls.filter((c) => c[0] === tag);
}

function waitForAsyncDrain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function mountWorkspaceDocuments(props: {
  workspaceId: string;
  userRole: "owner" | "editor" | "viewer";
}): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  const WorkspaceDocuments = mod.WorkspaceDocuments;
  act(() => {
    renderer = create(<WorkspaceDocuments {...props} />);
  });
  return renderer;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("WorkspaceDocuments", () => {
  test("shows a loading status immediately on mount", () => {
    const renderer = mountWorkspaceDocuments({
      workspaceId: "workspace-1",
      userRole: "owner",
    });
    try {
      const status = renderer.root.findByProps({ role: "status" });
      assert.equal(status.props.children, "Loading documents...");
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("renders the document grid with formatted dates once loaded, and the hasMore hint", async () => {
    state().listWorkspaceDocumentsForUser = async () => ({
      documents: [
        { id: "doc-1", title: "Roadmap", updatedAt: new Date("2024-03-05") },
        { id: "doc-2", title: "Notes", updatedAt: new Date("2024-01-15") },
      ],
      hasMore: true,
    });
    const renderer = mountWorkspaceDocuments({
      workspaceId: "workspace-1",
      userRole: "owner",
    });
    try {
      await act(async () => {
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      const text = JSON.stringify(renderer.toJSON());
      assert.match(text, /Roadmap/);
      assert.match(text, /Notes/);
      assert.match(text, /"Edited ","Mar 5, 2024"/);
      const links = renderer.root.findAllByProps({
        href: "/app/documents/doc-1",
      });
      assert.ok(links.length >= 1);
      const status = renderer.root.findByProps({ role: "status" });
      assert.equal(
        status.props.children.join(""),
        "Showing the first 2 documents in this workspace.",
      );
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("shows an empty-state message, with a create/import hint only when the caller can create", async () => {
    const owner = mountWorkspaceDocuments({
      workspaceId: "workspace-1",
      userRole: "owner",
    });
    try {
      await act(async () => {
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      const text = JSON.stringify(owner.toJSON());
      assert.match(text, /No documents in this workspace yet\./);
      assert.match(text, /Create or import one to get started\./);
    } finally {
      act(() => owner.unmount());
    }

    const viewer = mountWorkspaceDocuments({
      workspaceId: "workspace-1",
      userRole: "viewer",
    });
    try {
      await act(async () => {
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      const text = JSON.stringify(viewer.toJSON());
      assert.match(text, /No documents in this workspace yet\./);
      assert.doesNotMatch(text, /Create or import one to get started\./);
    } finally {
      act(() => viewer.unmount());
    }
  });

  test("a load failure shows a retryable alert, and Retry re-fetches successfully", async () => {
    let attempt = 0;
    state().listWorkspaceDocumentsForUser = async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error("boom");
      }
      return {
        documents: [
          {
            id: "doc-1",
            title: "Recovered",
            updatedAt: new Date("2024-02-01"),
          },
        ],
        hasMore: false,
      };
    };
    const renderer = mountWorkspaceDocuments({
      workspaceId: "workspace-1",
      userRole: "owner",
    });
    try {
      await act(async () => {
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      const alert = renderer.root.findByProps({ role: "alert" });
      const alertChildren = alert.props.children as {
        props: { children: string };
      }[];
      assert.match(
        alertChildren[0].props.children,
        /Could not load documents\. Please try again\./,
      );
      const retryButton = renderer.root.findByProps({ children: "Retry" });
      await act(async () => {
        retryButton.props.onClick();
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      assert.throws(() => renderer.root.findByProps({ role: "alert" }));
      assert.match(JSON.stringify(renderer.toJSON()), /Recovered/);
      assert.equal(attempt, 2);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("owners/editors see New + Import actions; viewers see neither", async () => {
    const owner = mountWorkspaceDocuments({
      workspaceId: "workspace-1",
      userRole: "owner",
    });
    try {
      await act(async () => {
        await waitForAsyncDrain();
      });
      owner.root.findByProps({ children: "New document" });
      owner.root.findByProps({ "aria-label": "Import document" });
    } finally {
      act(() => owner.unmount());
    }

    const viewer = mountWorkspaceDocuments({
      workspaceId: "workspace-1",
      userRole: "viewer",
    });
    try {
      await act(async () => {
        await waitForAsyncDrain();
      });
      assert.throws(() =>
        viewer.root.findByProps({ children: "New document" }),
      );
      assert.throws(() =>
        viewer.root.findByProps({ "aria-label": "Import document" }),
      );
    } finally {
      act(() => viewer.unmount());
    }
  });

  test("choosing a template suppresses duplicate activation, locks the picker pending, and redirects after one durable create", async () => {
    let resolveCreation!: (value: { id: string }) => void;
    state().createWorkspaceDocumentForUser = async (
      userId,
      workspaceId,
      templateId,
    ) => {
      state().calls.push([
        "createWorkspaceDocumentForUser",
        userId,
        workspaceId,
        templateId,
      ]);
      return new Promise<{ id: string }>((resolve) => {
        resolveCreation = resolve;
      });
    };
    const renderer = mountWorkspaceDocuments({
      workspaceId: "workspace-1",
      userRole: "owner",
    });
    try {
      await act(async () => {
        await waitForAsyncDrain();
      });
      const newButton = renderer.root.findByProps({
        children: "New document",
      });
      act(() => {
        newButton.props.onClick();
      });
      const template = TEMPLATE_CATALOG[0];
      const templateButton = renderer.root.findByProps({
        "aria-label": `${template.name} template`,
      });
      act(() => {
        templateButton.props.onClick();
        templateButton.props.onClick();
      });
      assert.equal(
        renderer.root.findByProps({ children: "Creating…" }).props.children,
        "Creating…",
      );
      for (const entry of TEMPLATE_CATALOG) {
        assert.equal(
          renderer.root.findByProps({
            "aria-label": `${entry.name} template`,
          }).props.disabled,
          true,
        );
      }
      assert.equal(
        renderer.root.findByProps({ children: "Cancel" }).props.disabled,
        true,
      );
      await waitForAsyncDrain();
      assert.deepEqual(callsOf("createWorkspaceDocumentForUser"), [
        [
          "createWorkspaceDocumentForUser",
          "user-1",
          "workspace-1",
          template.id,
        ],
      ]);

      await assert.rejects(async () => {
        await act(async () => {
          resolveCreation({ id: "doc-1" });
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });
      }, /NEXT_REDIRECT:\/app\/documents\/doc-1$/);
      assert.deepEqual(callsOf("createWorkspaceDocumentForUser"), [
        [
          "createWorkspaceDocumentForUser",
          "user-1",
          "workspace-1",
          template.id,
        ],
      ]);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("a failed workspace create stays inline; retry repeats the failed template and preserves redirect control flow", async () => {
    let attempt = 0;
    state().createWorkspaceDocumentForUser = async (
      userId,
      workspaceId,
      templateId,
    ) => {
      state().calls.push([
        "createWorkspaceDocumentForUser",
        userId,
        workspaceId,
        templateId,
      ]);
      attempt += 1;
      if (attempt === 1) throw new Error("private persistence detail");
      return { id: "doc-recovered" };
    };
    const renderer = mountWorkspaceDocuments({
      workspaceId: "workspace-1",
      userRole: "editor",
    });
    try {
      await act(async () => {
        await waitForAsyncDrain();
      });
      act(() => {
        renderer.root.findByProps({ children: "New document" }).props.onClick();
      });
      const template = TEMPLATE_CATALOG[1]!;
      await act(async () => {
        renderer.root
          .findByProps({ "aria-label": `${template.name} template` })
          .props.onClick();
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });

      const alert = renderer.root.findByProps({ role: "alert" });
      const rendered = JSON.stringify(renderer.toJSON());
      assert.equal(alert.props.role, "alert");
      assert.match(
        rendered,
        /Could not create the document\. Please try again\./,
      );
      assert.doesNotMatch(rendered, /private persistence detail/);

      const retry = renderer.root.findByProps({ children: "Try again" });
      await assert.rejects(async () => {
        await act(async () => {
          retry.props.onClick();
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });
      }, /NEXT_REDIRECT:\/app\/documents\/doc-recovered$/);
      assert.deepEqual(callsOf("createWorkspaceDocumentForUser"), [
        [
          "createWorkspaceDocumentForUser",
          "user-1",
          "workspace-1",
          template.id,
        ],
        [
          "createWorkspaceDocumentForUser",
          "user-1",
          "workspace-1",
          template.id,
        ],
      ]);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("Close/Cancel dismiss the template picker without creating a document", async () => {
    const renderer = mountWorkspaceDocuments({
      workspaceId: "workspace-1",
      userRole: "owner",
    });
    try {
      await act(async () => {
        await waitForAsyncDrain();
      });
      act(() => {
        renderer.root.findByProps({ children: "New document" }).props.onClick();
      });
      renderer.root.findByProps({ "aria-label": "Close" }); // picker is open
      act(() => {
        renderer.root.findByProps({ "aria-label": "Close" }).props.onClick();
      });
      assert.throws(() => renderer.root.findByProps({ "aria-label": "Close" }));
      assert.equal(callsOf("createWorkspaceDocumentForUser").length, 0);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("selecting a file imports it and navigates after durable persistence", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      jsonResponse({
        ok: true,
        documentId: "doc-2",
        documentPath: "/app/documents/doc-2",
      })) as typeof fetch;
    const renderer = mountWorkspaceDocuments({
      workspaceId: "workspace-1",
      userRole: "owner",
    });
    try {
      await act(async () => {
        await waitForAsyncDrain();
      });
      const input = renderer.root.findByProps({
        "aria-label": "Import a document file into workspace",
      });
      const file = new File(["# Imported"], "notes.md", {
        type: "text/markdown",
      });
      await act(async () => {
        input.props.onChange({
          target: { files: [file], value: "notes.md" },
        } as unknown as React.ChangeEvent<HTMLInputElement>);
        await waitForAsyncDrain();
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      assert.deepEqual(callsOf("router.push"), [
        ["router.push", "/app/documents/doc-2"],
      ]);
    } finally {
      act(() => renderer.unmount());
      globalThis.fetch = originalFetch;
    }
  });

  test("a failed import shows a retryable inline error", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      jsonResponse(
        {
          ok: false,
          error: {
            code: "unsupported",
            status: 415,
            message: "Unsupported file format.",
          },
        },
        415,
      )) as typeof fetch;
    const renderer = mountWorkspaceDocuments({
      workspaceId: "workspace-1",
      userRole: "owner",
    });
    try {
      await act(async () => {
        await waitForAsyncDrain();
      });
      const input = renderer.root.findByProps({
        "aria-label": "Import a document file into workspace",
      });
      const file = new File(["bad"], "bad.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      await act(async () => {
        input.props.onChange({
          target: { files: [file], value: "bad.docx" },
        } as unknown as React.ChangeEvent<HTMLInputElement>);
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      const text = JSON.stringify(renderer.toJSON());
      assert.match(text, /Unsupported file format\./);
      assert.match(text, /"retry"/);
      assert.equal(callsOf("router.push").length, 0);
    } finally {
      act(() => renderer.unmount());
      globalThis.fetch = originalFetch;
    }
  });
});
