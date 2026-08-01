/**
 * Direct contract coverage for `DocumentCard` (#1961) — the dashboard grid
 * tile: favorite star, kebab menu (rename/duplicate/delete), and the two
 * dialogs those menu items open.
 *
 * `RenameDialog`/`DeleteConfirmDialog` are both built on `Dialog` →
 * `ModalSurface`, which unconditionally `createPortal`s to `document.body`
 * once `document` exists — same rationale as `new-document-button.test.tsx`,
 * so this uses `@/test/portal-dom`'s `withPortalDom`/`mountWithPortalDom`.
 *
 * `rename`/`duplicate`/`toggleFavorite` are already fully covered by
 * `src/app/app/actions.test.ts`, so `"./actions"` is stubbed via the shared
 * `@/test/module-stub` helper (same technique as
 * `new-document-button.test.tsx`, generalized) rather than re-testing the
 * server actions themselves — this file only asserts *which* action
 * `DocumentCard` calls, with what arguments, and when.
 *
 * Deletion itself is intentionally never triggered from within the card: per
 * its own docstring, confirming the delete dialog calls the `onDelete(data)`
 * prop so the parent (`DocumentList`, via `useOptimisticDocumentTrash`) owns
 * the actual optimistic-removal + `deleteDocument` call. Every delete-flow
 * test here asserts both sides of that boundary: `onDelete` fires with the
 * expected payload, and neither stubbed action received a delete call.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import {
  createPortalNodeMock,
  mountWithPortalDom,
  withPortalDom,
} from "@/test/portal-dom";
import { textOf, waitForAsyncDrain } from "@/test/render-text";
import { stubModule } from "@/test/module-stub";
import type { DocumentCardData } from "./document-card";

type CardActionsTestState = {
  duplicateCalls: string[];
  renameCalls: Array<{ id: string; title: string }>;
  favoriteCalls: string[];
  rethrowCalls: unknown[];
  duplicateImpl: (id: string) => Promise<void>;
  renameImpl: (id: string, title: string) => Promise<{ title: string }>;
  favoriteImpl: (id: string) => Promise<{ favorite: boolean }>;
};

const globalForActions = globalThis as typeof globalThis & {
  __documentCardActionsTestState: CardActionsTestState;
};

function resetActionsState(): void {
  globalForActions.__documentCardActionsTestState = {
    duplicateCalls: [],
    renameCalls: [],
    favoriteCalls: [],
    rethrowCalls: [],
    duplicateImpl: async () => undefined,
    renameImpl: async (_id, title) => ({ title }),
    favoriteImpl: async () => ({ favorite: true }),
  };
}
resetActionsState();

stubModule(
  "next/navigation",
  `module.exports = {
  unstable_rethrow: (error) => {
    globalThis.__documentCardActionsTestState.rethrowCalls.push(error);
    if (error && error.__nextControlFlow === true) throw error;
  },
};`,
);

stubModule(
  "./actions",
  `module.exports = {
  duplicateDocument: async (id) => {
    const state = globalThis.__documentCardActionsTestState;
    state.duplicateCalls.push(id);
    return state.duplicateImpl(id);
  },
  renameDocument: async (id, title) => {
    const state = globalThis.__documentCardActionsTestState;
    state.renameCalls.push({ id, title });
    return state.renameImpl(id, title);
  },
  toggleFavorite: async (id) => {
    const state = globalThis.__documentCardActionsTestState;
    state.favoriteCalls.push(id);
    return state.favoriteImpl(id);
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

let DocumentCard: typeof import("./document-card").DocumentCard;
before(async () => {
  DocumentCard = (await import("./document-card")).DocumentCard;
});

beforeEach(resetActionsState);

const BASE: Omit<DocumentCardData, "id" | "title"> = {
  favorite: false,
  editedLabel: "2 days ago",
  workspaceName: "Marketing",
  thumbnail: null,
  excerpt: "Some excerpt text.",
  readingMinutes: 3,
  canEdit: true,
  canManage: true,
};

function mount(
  overrides: Partial<DocumentCardData> = {},
  onDelete: (data: DocumentCardData) => void = () => {},
): ReactTestRenderer {
  const data: DocumentCardData = {
    id: "doc-1",
    title: "Quarterly Plan",
    ...BASE,
    ...overrides,
  };
  return mountWithPortalDom(
    <DocumentCard
      {...data}
      onDelete={onDelete}
      onUpdated={() => undefined}
      onRefreshRequested={() => undefined}
    />,
  );
}

function openMenu(renderer: ReactTestRenderer, title = "Quarterly Plan") {
  const kebab = renderer.root.findByProps({
    "aria-label": `Actions for ${title}`,
  });
  act(() => {
    (kebab.props.onClick as () => void)();
  });
}

function buttonByText(renderer: ReactTestRenderer, label: string) {
  return renderer.root.find(
    (el) => el.type === "button" && textOf(el) === label,
  );
}

function backdropFor(renderer: ReactTestRenderer) {
  return renderer.root.find(
    (el) =>
      el.type === "div" &&
      el.props["aria-hidden"] === "true" &&
      typeof el.props.className === "string" &&
      el.props.className.includes("bg-ds-backdrop"),
  );
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("DocumentCard", () => {
  test("renders the title, excerpt, edited label, reading time, and workspace name", () => {
    withPortalDom(() => {
      const renderer = mount();
      try {
        const all = textOf(renderer.root);
        assert.match(all, /Quarterly Plan/);
        assert.match(all, /Some excerpt text\./);
        assert.match(all, /Edited 2 days ago/);
        assert.match(all, /3 min read/);
        assert.match(all, /Marketing/);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("shows an italic placeholder instead of an excerpt when there is no content yet", () => {
    withPortalDom(() => {
      const renderer = mount({ excerpt: "" });
      try {
        assert.match(textOf(renderer.root), /No content yet/);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("canEdit=false hides the favorite star and the Rename menu item", () => {
    withPortalDom(() => {
      const renderer = mount({ canEdit: false });
      try {
        assert.throws(() =>
          renderer.root.findByProps({
            "aria-label": "Favorite Quarterly Plan",
          }),
        );
        openMenu(renderer);
        const menu = renderer.root.findByProps({ role: "menu" });
        assert.doesNotMatch(textOf(menu), /Rename/);
        assert.match(textOf(menu), /Duplicate/);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("canManage=false hides the Delete menu item but keeps Duplicate/Rename", () => {
    withPortalDom(() => {
      const renderer = mount({ canManage: false });
      try {
        openMenu(renderer);
        const menu = renderer.root.findByProps({ role: "menu" });
        assert.doesNotMatch(textOf(menu), /Delete/);
        assert.match(textOf(menu), /Rename/);
        assert.match(textOf(menu), /Duplicate/);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("the kebab button toggles the menu open and closed", () => {
    withPortalDom(() => {
      const renderer = mount();
      try {
        assert.throws(() => renderer.root.findByProps({ role: "menu" }));
        openMenu(renderer);
        assert.ok(renderer.root.findByProps({ role: "menu" }));
        openMenu(renderer);
        assert.throws(() => renderer.root.findByProps({ role: "menu" }));
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("the menu opens from the keyboard, roves focus, closes on Escape, and restores its trigger", () => {
    withPortalDom(() => {
      const focusLog: string[] = [];
      const menuItems = ["Rename", "Duplicate", "Delete"].map((label) => ({
        ...createPortalNodeMock(),
        hasAttribute: () => false,
        getAttribute: () => null,
        focus: () => focusLog.push(label),
      }));
      const triggerNode = {
        ...createPortalNodeMock(),
        focus: () => focusLog.push("trigger"),
      };
      const menuNode = {
        ...createPortalNodeMock(),
        querySelectorAll: () => menuItems,
      };
      const data: DocumentCardData = {
        id: "doc-1",
        title: "Quarterly Plan",
        ...BASE,
      };
      let renderer!: ReactTestRenderer;
      act(() => {
        renderer = create(
          <DocumentCard
            {...data}
            onDelete={() => {}}
            onUpdated={() => undefined}
            onRefreshRequested={() => undefined}
          />,
          {
            createNodeMock(element) {
              const nodeElement = element as {
                type: unknown;
                props: Record<string, unknown>;
              };
              if (
                nodeElement.type === "button" &&
                nodeElement.props["aria-label"] === "Actions for Quarterly Plan"
              ) {
                return triggerNode;
              }
              if (
                nodeElement.type === "div" &&
                nodeElement.props.role === "menu"
              ) {
                return menuNode;
              }
              return createPortalNodeMock();
            },
          },
        );
      });

      const menuKeyboardContainer = () =>
        renderer.root.find(
          (element) =>
            element.type === "div" &&
            typeof element.props.className === "string" &&
            element.props.className.includes("absolute right-2 top-2") &&
            typeof element.props.onKeyDown === "function",
        );
      const press = (key: string, target: object) => {
        let prevented = false;
        let stopped = false;
        act(() => {
          menuKeyboardContainer().props.onKeyDown({
            key,
            target,
            preventDefault: () => {
              prevented = true;
            },
            stopPropagation: () => {
              stopped = true;
            },
          });
        });
        return { prevented, stopped };
      };

      try {
        const opened = press("ArrowDown", triggerNode);
        assert.deepEqual(opened, { prevented: true, stopped: false });
        assert.deepEqual(focusLog, ["Rename"]);
        assert.deepEqual(
          renderer.root
            .findByProps({ role: "menu" })
            .findAllByProps({ role: "menuitem" })
            .map((item) => item.props.tabIndex),
          [-1, -1, -1],
        );

        press("ArrowDown", menuItems[0] as object);
        press("End", menuItems[1] as object);
        assert.deepEqual(focusLog, ["Rename", "Duplicate", "Delete"]);

        const escaped = press("Escape", menuItems[2] as object);
        assert.deepEqual(escaped, { prevented: true, stopped: true });
        assert.deepEqual(focusLog, [
          "Rename",
          "Duplicate",
          "Delete",
          "trigger",
        ]);
        assert.throws(() => renderer.root.findByProps({ role: "menu" }));
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("toggling favorite flips the star optimistically and calls toggleFavorite(id) exactly once", async () => {
    await withPortalDom(async () => {
      const renderer = mount({ favorite: false });
      try {
        const star = renderer.root.findByProps({
          "aria-label": "Favorite Quarterly Plan",
        });
        assert.equal(star.props["aria-pressed"], false);
        act(() => {
          (star.props.onClick as () => void)();
        });

        // Optimistic flip is synchronous, before the action settles.
        const starAfterClick = renderer.root.findByProps({
          "aria-label": "Unfavorite Quarterly Plan",
        });
        assert.equal(starAfterClick.props["aria-pressed"], true);

        await act(async () => {
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });

        assert.deepEqual(
          globalForActions.__documentCardActionsTestState.favoriteCalls,
          ["doc-1"],
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("renaming submits the raw title to renameDocument and shows the normalized title optimistically", async () => {
    await withPortalDom(async () => {
      const renderer = mount();
      try {
        openMenu(renderer);
        const renameItem = renderer.root.find(
          (el) => el.props.role === "menuitem" && textOf(el) === "Rename",
        );
        act(() => {
          (renameItem.props.onClick as () => void)();
        });

        const input = renderer.root.findByProps({
          "aria-label": "Document title",
        });
        assert.equal(input.props.value, "Quarterly Plan");

        act(() => {
          (input.props.onChange as (e: unknown) => void)({
            target: { value: "  New Title  " },
          });
        });
        const form = renderer.root.findByType("form");
        act(() => {
          (form.props.onSubmit as (e: unknown) => void)({
            preventDefault: () => {},
          });
        });

        // The dialog stays mounted and locked until persistence settles.
        assert.equal(
          renderer.root.findByProps({ "aria-label": "Document title" }).props
            .disabled,
          true,
        );
        assert.ok(buttonByText(renderer, "Renaming…"));
        // The optimistic title (normalized: trimmed) is visible right away,
        // before the transition's `renameDocument` call has settled.
        assert.match(textOf(renderer.root), /New Title/);

        await act(async () => {
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });

        // `renameDocument` receives the raw (non-normalized) title — the
        // server clamp/trim is the source of truth, not the optimistic UI
        // value.
        assert.deepEqual(
          globalForActions.__documentCardActionsTestState.renameCalls,
          [{ id: "doc-1", title: "  New Title  " }],
        );
        assert.throws(() =>
          renderer.root.findByProps({ "aria-label": "Document title" }),
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("submitting a rename that normalizes to the current title is a no-op (no call, no transition)", async () => {
    await withPortalDom(async () => {
      const renderer = mount({ title: "Quarterly Plan" });
      try {
        openMenu(renderer);
        const renameItem = renderer.root.find(
          (el) => el.props.role === "menuitem" && textOf(el) === "Rename",
        );
        act(() => {
          (renameItem.props.onClick as () => void)();
        });

        const input = renderer.root.findByProps({
          "aria-label": "Document title",
        });
        act(() => {
          (input.props.onChange as (e: unknown) => void)({
            target: { value: "  Quarterly Plan  " },
          });
        });
        const form = renderer.root.findByType("form");
        act(() => {
          (form.props.onSubmit as (e: unknown) => void)({
            preventDefault: () => {},
          });
        });

        await act(async () => {
          await waitForAsyncDrain();
        });

        assert.deepEqual(
          globalForActions.__documentCardActionsTestState.renameCalls,
          [],
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("the Rename submit button is disabled for an empty or whitespace-only title and enabled once the value is non-blank", () => {
    withPortalDom(() => {
      const renderer = mount();
      try {
        openMenu(renderer);
        const renameItem = renderer.root.find(
          (el) => el.props.role === "menuitem" && textOf(el) === "Rename",
        );
        act(() => {
          (renameItem.props.onClick as () => void)();
        });

        const input = renderer.root.findByProps({
          "aria-label": "Document title",
        });
        const submitButton = () =>
          renderer.root.find(
            (el) => el.type === "button" && el.props.type === "submit",
          );

        // Pre-filled with the current (non-empty) title → enabled.
        assert.equal(submitButton().props.disabled, false);

        // Cleared → disabled.
        act(() => {
          (input.props.onChange as (e: unknown) => void)({
            target: { value: "" },
          });
        });
        assert.equal(submitButton().props.disabled, true);

        // Whitespace-only → still disabled.
        act(() => {
          (
            renderer.root.findByProps({ "aria-label": "Document title" }).props
              .onChange as (e: unknown) => void
          )({
            target: { value: "   " },
          });
        });
        assert.equal(submitButton().props.disabled, true);

        // Non-blank again → re-enabled.
        act(() => {
          (
            renderer.root.findByProps({ "aria-label": "Document title" }).props
              .onChange as (e: unknown) => void
          )({
            target: { value: "Renamed" },
          });
        });
        assert.equal(submitButton().props.disabled, false);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("submitting a whitespace-only title is a no-op: renameDocument is never called and the dialog stays open", async () => {
    await withPortalDom(async () => {
      const renderer = mount({ title: "Quarterly Plan" });
      try {
        openMenu(renderer);
        const renameItem = renderer.root.find(
          (el) => el.props.role === "menuitem" && textOf(el) === "Rename",
        );
        act(() => {
          (renameItem.props.onClick as () => void)();
        });

        const input = renderer.root.findByProps({
          "aria-label": "Document title",
        });
        act(() => {
          (input.props.onChange as (e: unknown) => void)({
            target: { value: "   " },
          });
        });
        const form = renderer.root.findByType("form");
        act(() => {
          (form.props.onSubmit as (e: unknown) => void)({
            preventDefault: () => {},
          });
        });

        await act(async () => {
          await waitForAsyncDrain();
        });

        // The empty submit is guarded: no rename fired, and the dialog is
        // still mounted (its title input remains findable) rather than
        // silently coercing the title to "Untitled".
        assert.deepEqual(
          globalForActions.__documentCardActionsTestState.renameCalls,
          [],
        );
        assert.ok(
          renderer.root.findByProps({ "aria-label": "Document title" }),
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("cancelling the rename dialog leaves the title untouched and calls no action", () => {
    withPortalDom(() => {
      const renderer = mount();
      try {
        openMenu(renderer);
        const renameItem = renderer.root.find(
          (el) => el.props.role === "menuitem" && textOf(el) === "Rename",
        );
        act(() => {
          (renameItem.props.onClick as () => void)();
        });
        const cancel = renderer.root.find(
          (el) => el.type === "button" && textOf(el) === "Cancel",
        );
        act(() => {
          (cancel.props.onClick as () => void)();
        });
        assert.throws(() =>
          renderer.root.findByProps({ "aria-label": "Document title" }),
        );
        assert.deepEqual(
          globalForActions.__documentCardActionsTestState.renameCalls,
          [],
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("duplicating closes the menu and calls duplicateDocument(id) exactly once", async () => {
    await withPortalDom(async () => {
      const renderer = mount();
      try {
        openMenu(renderer);
        const duplicateItem = renderer.root.find(
          (el) => el.props.role === "menuitem" && textOf(el) === "Duplicate",
        );
        act(() => {
          (duplicateItem.props.onClick as () => void)();
        });
        assert.throws(() => renderer.root.findByProps({ role: "menu" }));

        await act(async () => {
          await waitForAsyncDrain();
        });

        assert.deepEqual(
          globalForActions.__documentCardActionsTestState.duplicateCalls,
          ["doc-1"],
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("a failed favorite rolls back, redacts private details, dismisses cleanly, and retries without duplicate toggles", async () => {
    await withPortalDom(async () => {
      const privateFailure = new Error("private favorite storage detail");
      const retry = createDeferred<{ favorite: boolean }>();
      let attempt = 0;
      globalForActions.__documentCardActionsTestState.favoriteImpl =
        async () => {
          attempt += 1;
          if (attempt <= 2) throw privateFailure;
          return retry.promise;
        };

      const renderer = mount({ favorite: false });
      try {
        const clickFavorite = async () => {
          await act(async () => {
            renderer.root
              .findByProps({
                "aria-label": "Favorite Quarterly Plan",
              })
              .props.onClick();
            await waitForAsyncDrain();
            await waitForAsyncDrain();
          });
        };

        await clickFavorite();
        let alert = renderer.root.findByProps({ role: "alert" });
        assert.match(
          textOf(alert),
          /Could not update the favorite\. Please try again\./,
        );
        assert.doesNotMatch(textOf(alert), /private favorite storage detail/);
        assert.ok(
          renderer.root.findByProps({
            "aria-label": "Favorite Quarterly Plan",
          }),
        );

        await act(async () => {
          buttonByText(renderer, "Dismiss error").props.onClick();
          await waitForAsyncDrain();
        });
        assert.throws(() => renderer.root.findByProps({ role: "alert" }));

        await clickFavorite();
        alert = renderer.root.findByProps({ role: "alert" });
        const retryButton = alert.find(
          (el) => el.type === "button" && textOf(el) === "Try favorite again",
        );
        act(() => {
          retryButton.props.onClick();
          retryButton.props.onClick();
        });
        assert.deepEqual(
          globalForActions.__documentCardActionsTestState.favoriteCalls,
          ["doc-1", "doc-1", "doc-1"],
        );
        assert.equal(
          renderer.root.findByProps({
            "aria-label": "Unfavorite Quarterly Plan",
          }).props.disabled,
          true,
        );
        assert.equal(
          renderer.root.findByProps({
            "aria-label": "Actions for Quarterly Plan",
          }).props.disabled,
          true,
        );

        retry.resolve({ favorite: true });
        await act(async () => {
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });
        assert.throws(() => renderer.root.findByProps({ role: "alert" }));
        assert.deepEqual(
          globalForActions.__documentCardActionsTestState.rethrowCalls,
          [privateFailure, privateFailure],
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("a failed rename stays in its locked dialog and retries the same title exactly once", async () => {
    await withPortalDom(async () => {
      const privateFailure = new Error("private rename storage detail");
      const retry = createDeferred<{ title: string }>();
      let attempt = 0;
      globalForActions.__documentCardActionsTestState.renameImpl = async () => {
        attempt += 1;
        if (attempt === 1) throw privateFailure;
        return retry.promise;
      };

      const renderer = mount();
      try {
        openMenu(renderer);
        act(() => {
          renderer.root
            .find(
              (el) => el.props.role === "menuitem" && textOf(el) === "Rename",
            )
            .props.onClick();
        });
        act(() => {
          renderer.root
            .findByProps({
              "aria-label": "Document title",
            })
            .props.onChange({ target: { value: "Recovered title" } });
        });

        await act(async () => {
          renderer.root.findByType("form").props.onSubmit({
            preventDefault: () => {},
          });
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });

        const alert = renderer.root.findByProps({ role: "alert" });
        assert.match(
          textOf(alert),
          /Could not rename the document\. Please try again\./,
        );
        assert.doesNotMatch(textOf(alert), /private rename storage detail/);
        assert.ok(buttonByText(renderer, "Try rename again"));

        const form = renderer.root.findByType("form");
        act(() => {
          form.props.onSubmit({ preventDefault: () => {} });
          form.props.onSubmit({ preventDefault: () => {} });
        });
        assert.deepEqual(
          globalForActions.__documentCardActionsTestState.renameCalls,
          [
            { id: "doc-1", title: "Recovered title" },
            { id: "doc-1", title: "Recovered title" },
          ],
        );
        assert.equal(
          renderer.root.findByProps({
            "aria-label": "Document title",
          }).props.disabled,
          true,
        );
        assert.equal(buttonByText(renderer, "Cancel").props.disabled, true);
        act(() => backdropFor(renderer).props.onClick());
        assert.ok(renderer.root.findByProps({ role: "dialog" }));

        retry.resolve({ title: "Recovered title" });
        await act(async () => {
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });
        assert.throws(() => renderer.root.findByProps({ role: "dialog" }));
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("a failed duplicate stays inline and a double-activated retry creates one copy", async () => {
    await withPortalDom(async () => {
      const privateFailure = new Error("private duplicate storage detail");
      const retry = createDeferred<void>();
      let attempt = 0;
      globalForActions.__documentCardActionsTestState.duplicateImpl =
        async () => {
          attempt += 1;
          if (attempt === 1) throw privateFailure;
          return retry.promise;
        };

      const renderer = mount();
      try {
        openMenu(renderer);
        await act(async () => {
          renderer.root
            .find(
              (el) =>
                el.props.role === "menuitem" && textOf(el) === "Duplicate",
            )
            .props.onClick();
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });

        const alert = renderer.root.findByProps({ role: "alert" });
        assert.match(
          textOf(alert),
          /Could not duplicate the document\. Please try again\./,
        );
        assert.doesNotMatch(textOf(alert), /private duplicate storage detail/);
        const retryButton = alert.find(
          (el) => el.type === "button" && textOf(el) === "Try duplicate again",
        );
        act(() => {
          retryButton.props.onClick();
          retryButton.props.onClick();
        });
        assert.deepEqual(
          globalForActions.__documentCardActionsTestState.duplicateCalls,
          ["doc-1", "doc-1"],
        );

        retry.resolve();
        await act(async () => {
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });
        assert.throws(() => renderer.root.findByProps({ role: "alert" }));
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("framework navigation control-flow errors still escape card recovery", async () => {
    await withPortalDom(async () => {
      const controlFlowError = Object.assign(new Error("NEXT_REDIRECT"), {
        __nextControlFlow: true,
      });
      globalForActions.__documentCardActionsTestState.duplicateImpl =
        async () => {
          throw controlFlowError;
        };
      const renderer = mount();
      try {
        openMenu(renderer);
        const duplicateItem = renderer.root.find(
          (el) => el.props.role === "menuitem" && textOf(el) === "Duplicate",
        );
        await assert.rejects(
          () =>
            Promise.resolve(
              act(async () => {
                duplicateItem.props.onClick();
                await waitForAsyncDrain();
                await waitForAsyncDrain();
              }),
            ),
          controlFlowError,
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("confirming delete calls onDelete with the card's current data and calls no server action itself", () => {
    withPortalDom(() => {
      const deletes: unknown[] = [];
      const renderer = mount({ favorite: true }, (data) => deletes.push(data));
      try {
        openMenu(renderer);
        const deleteItem = renderer.root.find(
          (el) => el.props.role === "menuitem" && textOf(el) === "Delete",
        );
        act(() => {
          (deleteItem.props.onClick as () => void)();
        });

        assert.match(textOf(renderer.root), /Delete document\?/);
        const confirm = renderer.root.find(
          (el) => el.type === "button" && textOf(el) === "Delete",
        );
        act(() => {
          (confirm.props.onClick as () => void)();
        });

        assert.deepEqual(deletes, [
          {
            id: "doc-1",
            title: "Quarterly Plan",
            favorite: true,
            editedLabel: "2 days ago",
            workspaceName: "Marketing",
            thumbnail: null,
            excerpt: "Some excerpt text.",
            readingMinutes: 3,
            canEdit: true,
            canManage: true,
          },
        ]);
        assert.deepEqual(
          globalForActions.__documentCardActionsTestState.duplicateCalls,
          [],
        );
        assert.deepEqual(
          globalForActions.__documentCardActionsTestState.renameCalls,
          [],
        );
        assert.deepEqual(
          globalForActions.__documentCardActionsTestState.favoriteCalls,
          [],
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("cancelling the delete dialog calls no onDelete and no action", () => {
    withPortalDom(() => {
      const deletes: unknown[] = [];
      const renderer = mount({}, (data) => deletes.push(data));
      try {
        openMenu(renderer);
        const deleteItem = renderer.root.find(
          (el) => el.props.role === "menuitem" && textOf(el) === "Delete",
        );
        act(() => {
          (deleteItem.props.onClick as () => void)();
        });
        const cancel = renderer.root.find(
          (el) => el.type === "button" && textOf(el) === "Cancel",
        );
        act(() => {
          (cancel.props.onClick as () => void)();
        });
        assert.doesNotMatch(textOf(renderer.root), /Delete document\?/);
        assert.deepEqual(deletes, []);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });
});
