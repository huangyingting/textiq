/**
 * Direct behavior coverage for `TrashList`/`TrashRow` (#1961) — the trash
 * page's document list: empty state, per-row remaining-time formatting and
 * urgency styling, and the restore/permanent-delete confirmation dialogs
 * (confirm/cancel/pending/error).
 *
 * `restoreDocument` (`../actions`) and `permanentDeleteDocument` (`./actions`)
 * are both `"use server"` actions already fully covered by
 * `src/app/app/actions.test.ts` and `src/app/app/trash/actions.test.ts`
 * respectively, so both specifiers are stubbed via the shared
 * `@/test/module-stub` helper — this file only asserts *which* action
 * `TrashRow` calls, with what id, and how it renders the pending/settled
 * result.
 *
 * The shared trash confirmation dialog is built on
 * `Dialog` → `ModalSurface`, which unconditionally `createPortal`s to
 * `document.body` once `document` exists — same rationale as
 * `document-card.test.tsx`, so this uses `@/test/portal-dom`'s
 * `withPortalDom`/`mountWithPortalDom`. Both dialogs are only ever rendered
 * via the row's conditional restore/delete branches — the parent fully
 * mounts/unmounts the dialog element on cancel (never just toggles `open`
 * while staying mounted), so cancelling synchronously removes it from the
 * tree; no framer-motion exit-animation linger to work around here (see
 * `portal-dom.ts`'s module docstring for the case where that *does* matter).
 *
 * Ordinary Server Action failures stay in the dialog as generic retryable
 * errors. The `next/navigation` stub mirrors `unstable_rethrow` closely enough
 * to prove that framework control-flow errors still escape that local handler.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { act, type ReactTestRenderer } from "react-test-renderer";

import { mountWithPortalDom, withPortalDom } from "@/test/portal-dom";
import { textOf, waitForAsyncDrain } from "@/test/render-text";
import { stubModule } from "@/test/module-stub";
import type { TrashDocumentData } from "./trash-list";

type TrashActionsTestState = {
  restoreCalls: string[];
  permanentDeleteCalls: string[];
  rethrowCalls: unknown[];
  restoreImpl: (id: string) => Promise<void>;
  permanentDeleteImpl: (id: string) => Promise<void>;
};

const globalForActions = globalThis as typeof globalThis & {
  __trashListActionsTestState: TrashActionsTestState;
};

function resetActionsState(): void {
  globalForActions.__trashListActionsTestState = {
    restoreCalls: [],
    permanentDeleteCalls: [],
    rethrowCalls: [],
    restoreImpl: async () => undefined,
    permanentDeleteImpl: async () => undefined,
  };
}
resetActionsState();

stubModule(
  "next/navigation",
  `module.exports = {
  unstable_rethrow: (error) => {
    globalThis.__trashListActionsTestState.rethrowCalls.push(error);
    if (error && error.__nextControlFlow === true) throw error;
  },
};`,
);

stubModule(
  "../actions",
  `module.exports = {
  restoreDocument: async (id) => {
    const state = globalThis.__trashListActionsTestState;
    state.restoreCalls.push(id);
    return state.restoreImpl(id);
  },
};`,
);

stubModule(
  "./actions",
  `module.exports = {
  permanentDeleteDocument: async (id) => {
    const state = globalThis.__trashListActionsTestState;
    state.permanentDeleteCalls.push(id);
    return state.permanentDeleteImpl(id);
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

let TrashList: typeof import("./trash-list").TrashList;
before(async () => {
  TrashList = (await import("./trash-list")).TrashList;
});

beforeEach(resetActionsState);

/** Same formatter `trash-list.tsx` uses, so the expected string tracks the runtime's locale/timezone instead of a hardcoded literal. */
const deletedAtFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function doc(overrides: Partial<TrashDocumentData> = {}): TrashDocumentData {
  return {
    id: "doc-1",
    title: "Quarterly Plan",
    deletedAtMs: Date.UTC(2026, 0, 15),
    remainingMs: 10 * DAY_MS,
    ...overrides,
  };
}

function mount(documents: TrashDocumentData[]): ReactTestRenderer {
  return mountWithPortalDom(<TrashList documents={documents} />);
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function rowFor(
  renderer: ReactTestRenderer,
  title: string,
): ReturnType<ReactTestRenderer["root"]["find"]> {
  return renderer.root.find(
    (el) => el.type === "li" && textOf(el).startsWith(title),
  );
}

function restoreButtonFor(renderer: ReactTestRenderer, title: string) {
  return rowFor(renderer, title).find(
    (el) => el.type === "button" && el.props.children === "Restore",
  );
}

function deleteButtonFor(renderer: ReactTestRenderer, title: string) {
  return rowFor(renderer, title).find(
    (el) => el.type === "button" && el.props.children === "Delete permanently",
  );
}

function dialogButton(renderer: ReactTestRenderer, label: string) {
  return renderer.root
    .findByProps({ role: "dialog" })
    .find((el) => el.type === "button" && textOf(el) === label);
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

describe("TrashList", () => {
  test("an empty document list renders the empty-trash copy, not a <ul>", () => {
    withPortalDom(() => {
      const renderer = mount([]);
      try {
        assert.match(textOf(renderer.root), /Trash is empty/);
        assert.match(
          textOf(renderer.root),
          /Deleted documents appear here for 30 days\./,
        );
        assert.throws(() => renderer.root.findByType("ul"));
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("renders each document's title and its deleted-at date formatted the same way trash-list.tsx does", () => {
    withPortalDom(() => {
      const deletedAtMs = Date.UTC(2026, 2, 3);
      const renderer = mount([
        doc({ id: "doc-1", title: "March draft", deletedAtMs }),
        doc({
          id: "doc-2",
          title: "Old notes",
          deletedAtMs: Date.UTC(2025, 11, 25),
        }),
      ]);
      try {
        const all = textOf(renderer.root);
        assert.match(all, /March draft/);
        assert.match(all, /Old notes/);
        assert.match(
          textOf(rowFor(renderer, "March draft")),
          new RegExp(
            `Deleted ${deletedAtFormatter.format(new Date(deletedAtMs))}`,
          ),
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("each row's Restore and Delete-permanently buttons expose a document-scoped aria-label so multiple trashed docs are distinguishable to assistive tech", () => {
    withPortalDom(() => {
      const renderer = mount([
        doc({ id: "doc-1", title: "March draft" }),
        doc({ id: "doc-2", title: "Old notes" }),
      ]);
      try {
        // Visible text stays short/generic ("Restore" / "Delete permanently"),
        // but the accessible name is scoped to each document's title.
        assert.equal(
          restoreButtonFor(renderer, "March draft").props["aria-label"],
          "Restore March draft",
        );
        assert.equal(
          deleteButtonFor(renderer, "March draft").props["aria-label"],
          "Permanently delete March draft",
        );
        assert.equal(
          restoreButtonFor(renderer, "Old notes").props["aria-label"],
          "Restore Old notes",
        );
        assert.equal(
          deleteButtonFor(renderer, "Old notes").props["aria-label"],
          "Permanently delete Old notes",
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("formatRemaining renders days+hours, hours+minutes, minutes-only, and Expired for the corresponding remainingMs ranges", () => {
    withPortalDom(() => {
      const renderer = mount([
        doc({
          id: "d",
          title: "Days doc",
          remainingMs: 3 * DAY_MS + 5 * HOUR_MS,
        }),
        doc({
          id: "h",
          title: "Hours doc",
          remainingMs: 5 * HOUR_MS + 30 * 60 * 1000,
        }),
        doc({ id: "m", title: "Minutes doc", remainingMs: 45 * 60 * 1000 }),
        doc({ id: "e", title: "Expired doc", remainingMs: 0 }),
      ]);
      try {
        assert.match(textOf(rowFor(renderer, "Days doc")), /3d 5h remaining/);
        assert.match(textOf(rowFor(renderer, "Hours doc")), /5h 30m remaining/);
        assert.match(textOf(rowFor(renderer, "Minutes doc")), /45m remaining/);
        assert.match(textOf(rowFor(renderer, "Expired doc")), /Expired/);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("remaining time at or under 24h renders with danger styling; over 24h renders with secondary styling", () => {
    withPortalDom(() => {
      const renderer = mount([
        doc({ id: "urgent", title: "Urgent doc", remainingMs: HOUR_MS }),
        doc({ id: "safe", title: "Safe doc", remainingMs: 2 * DAY_MS }),
      ]);
      try {
        const urgentSpan = rowFor(renderer, "Urgent doc").find(
          (el) => el.type === "span" && textOf(el).includes("remaining"),
        );
        const safeSpan = rowFor(renderer, "Safe doc").find(
          (el) => el.type === "span" && textOf(el).includes("remaining"),
        );
        assert.match(String(urgentSpan.props.className), /text-ds-danger/);
        assert.match(
          String(safeSpan.props.className),
          /text-ds-text-secondary/,
        );
        assert.doesNotMatch(String(safeSpan.props.className), /text-ds-danger/);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("clicking Restore opens a dialog naming the document; Cancel closes it without calling restoreDocument, and the row remains", () => {
    withPortalDom(() => {
      const renderer = mount([doc()]);
      try {
        act(() => {
          (
            restoreButtonFor(renderer, "Quarterly Plan").props
              .onClick as () => void
          )();
        });
        assert.match(textOf(renderer.root), /Restore document\?/);
        assert.match(
          textOf(renderer.root),
          /“Quarterly Plan”|"Quarterly Plan"/,
        );

        const cancel = renderer.root
          .findByProps({ role: "dialog" })
          .find((el) => el.type === "button" && textOf(el) === "Cancel");
        act(() => {
          (cancel.props.onClick as () => void)();
        });

        assert.throws(() => renderer.root.findByProps({ role: "dialog" }));
        assert.deepEqual(
          globalForActions.__trashListActionsTestState.restoreCalls,
          [],
        );
        // The row is still present (never removed).
        assert.ok(restoreButtonFor(renderer, "Quarterly Plan"));
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("confirming Restore shows a pending Restoring… label, disables both dialog buttons, calls restoreDocument(id), then closes the dialog and removes only that row", async () => {
    await withPortalDom(async () => {
      const deferred = createDeferred<void>();
      globalForActions.__trashListActionsTestState.restoreImpl = () =>
        deferred.promise;

      const renderer = mount([
        doc({ id: "doc-1", title: "Quarterly Plan" }),
        doc({ id: "doc-2", title: "Other doc" }),
      ]);
      try {
        act(() => {
          (
            restoreButtonFor(renderer, "Quarterly Plan").props
              .onClick as () => void
          )();
        });

        let pendingCall!: unknown;
        act(() => {
          const confirmBtn = dialogButton(renderer, "Restore");
          pendingCall = confirmBtn.props.onClick();
          confirmBtn.props.onClick();
        });

        assert.deepEqual(
          globalForActions.__trashListActionsTestState.restoreCalls,
          ["doc-1"],
        );

        const dialogWhilePending = renderer.root.findByProps({
          role: "dialog",
        });
        const confirmWhilePending = dialogWhilePending.find(
          (el) => el.type === "button" && textOf(el) === "Restoring…",
        );
        assert.equal(confirmWhilePending.props.disabled, true);
        const cancelWhilePending = dialogWhilePending.find(
          (el) => el.type === "button" && textOf(el) === "Cancel",
        );
        assert.equal(cancelWhilePending.props.disabled, true);
        act(() => {
          backdropFor(renderer).props.onClick();
        });
        assert.ok(renderer.root.findByProps({ role: "dialog" }));

        deferred.resolve();
        await act(async () => {
          await pendingCall;
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });

        assert.deepEqual(
          globalForActions.__trashListActionsTestState.restoreCalls,
          ["doc-1"],
        );
        assert.throws(() => renderer.root.findByProps({ role: "dialog" }));
        // Only the restored row is removed; the other document remains.
        assert.throws(() => restoreButtonFor(renderer, "Quarterly Plan"));
        assert.ok(restoreButtonFor(renderer, "Other doc"));
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("a rejected restore stays inline with generic copy, can be dismissed, and retries successfully", async () => {
    await withPortalDom(async () => {
      const privateFailure = new Error("private restore detail");
      let attempt = 0;
      globalForActions.__trashListActionsTestState.restoreImpl = async () => {
        attempt += 1;
        if (attempt < 3) throw privateFailure;
      };
      const renderer = mount([doc()]);
      try {
        act(() => {
          (
            restoreButtonFor(renderer, "Quarterly Plan").props
              .onClick as () => void
          )();
        });
        await act(async () => {
          dialogButton(renderer, "Restore").props.onClick();
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });

        const firstAlert = renderer.root.findByProps({ role: "alert" });
        assert.match(
          textOf(firstAlert),
          /Could not restore the document\. Please try again\./,
        );
        assert.doesNotMatch(textOf(firstAlert), /private restore detail/);
        assert.deepEqual(
          globalForActions.__trashListActionsTestState.restoreCalls,
          ["doc-1"],
        );
        assert.deepEqual(
          globalForActions.__trashListActionsTestState.rethrowCalls,
          [privateFailure],
        );

        await act(async () => {
          dialogButton(renderer, "Dismiss error").props.onClick();
        });
        assert.throws(() => renderer.root.findByProps({ role: "alert" }));
        assert.ok(dialogButton(renderer, "Restore"));

        await act(async () => {
          dialogButton(renderer, "Restore").props.onClick();
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });
        assert.ok(dialogButton(renderer, "Try restore again"));

        await act(async () => {
          dialogButton(renderer, "Try restore again").props.onClick();
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });
        assert.deepEqual(
          globalForActions.__trashListActionsTestState.restoreCalls,
          ["doc-1", "doc-1", "doc-1"],
        );
        assert.throws(() => renderer.root.findByProps({ role: "dialog" }));
        assert.match(textOf(renderer.root), /Trash is empty/);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("clicking Delete permanently opens a dialog naming the document; Cancel closes it without calling permanentDeleteDocument, and the row remains", () => {
    withPortalDom(() => {
      const renderer = mount([doc()]);
      try {
        act(() => {
          (
            deleteButtonFor(renderer, "Quarterly Plan").props
              .onClick as () => void
          )();
        });
        assert.match(textOf(renderer.root), /Permanently delete\?/);

        const cancel = renderer.root
          .findByProps({ role: "dialog" })
          .find((el) => el.type === "button" && textOf(el) === "Cancel");
        act(() => {
          (cancel.props.onClick as () => void)();
        });

        assert.throws(() => renderer.root.findByProps({ role: "dialog" }));
        assert.deepEqual(
          globalForActions.__trashListActionsTestState.permanentDeleteCalls,
          [],
        );
        assert.ok(deleteButtonFor(renderer, "Quarterly Plan"));
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("confirming Delete permanently shows a pending Deleting… label, disables both dialog buttons, calls permanentDeleteDocument(id), then closes the dialog and removes only that row", async () => {
    await withPortalDom(async () => {
      const deferred = createDeferred<void>();
      globalForActions.__trashListActionsTestState.permanentDeleteImpl = () =>
        deferred.promise;

      const renderer = mount([
        doc({ id: "doc-1", title: "Quarterly Plan" }),
        doc({ id: "doc-2", title: "Other doc" }),
      ]);
      try {
        act(() => {
          (
            deleteButtonFor(renderer, "Quarterly Plan").props
              .onClick as () => void
          )();
        });

        let pendingCall!: unknown;
        act(() => {
          const confirmBtn = dialogButton(renderer, "Delete permanently");
          pendingCall = confirmBtn.props.onClick();
          confirmBtn.props.onClick();
        });

        assert.deepEqual(
          globalForActions.__trashListActionsTestState.permanentDeleteCalls,
          ["doc-1"],
        );

        const dialogWhilePending = renderer.root.findByProps({
          role: "dialog",
        });
        const confirmWhilePending = dialogWhilePending.find(
          (el) => el.type === "button" && textOf(el) === "Deleting…",
        );
        assert.equal(confirmWhilePending.props.disabled, true);
        const cancelWhilePending = dialogWhilePending.find(
          (el) => el.type === "button" && textOf(el) === "Cancel",
        );
        assert.equal(cancelWhilePending.props.disabled, true);
        act(() => {
          backdropFor(renderer).props.onClick();
        });
        assert.ok(renderer.root.findByProps({ role: "dialog" }));

        deferred.resolve();
        await act(async () => {
          await pendingCall;
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });

        assert.deepEqual(
          globalForActions.__trashListActionsTestState.permanentDeleteCalls,
          ["doc-1"],
        );
        assert.throws(() => renderer.root.findByProps({ role: "dialog" }));
        assert.throws(() => deleteButtonFor(renderer, "Quarterly Plan"));
        assert.ok(deleteButtonFor(renderer, "Other doc"));
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("a rejected permanent delete stays inline with generic copy and retries successfully", async () => {
    await withPortalDom(async () => {
      const privateFailure = new Error("private delete detail");
      let attempt = 0;
      globalForActions.__trashListActionsTestState.permanentDeleteImpl =
        async () => {
          attempt += 1;
          if (attempt === 1) throw privateFailure;
        };
      const renderer = mount([doc()]);
      try {
        act(() => {
          (
            deleteButtonFor(renderer, "Quarterly Plan").props
              .onClick as () => void
          )();
        });
        await act(async () => {
          dialogButton(renderer, "Delete permanently").props.onClick();
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });

        const alert = renderer.root.findByProps({ role: "alert" });
        assert.match(
          textOf(alert),
          /Could not permanently delete the document\. Please try again\./,
        );
        assert.doesNotMatch(textOf(alert), /private delete detail/);
        assert.deepEqual(
          globalForActions.__trashListActionsTestState.permanentDeleteCalls,
          ["doc-1"],
        );
        assert.deepEqual(
          globalForActions.__trashListActionsTestState.rethrowCalls,
          [privateFailure],
        );

        await act(async () => {
          dialogButton(renderer, "Try delete again").props.onClick();
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });
        assert.deepEqual(
          globalForActions.__trashListActionsTestState.permanentDeleteCalls,
          ["doc-1", "doc-1"],
        );
        assert.throws(() => renderer.root.findByProps({ role: "dialog" }));
        assert.match(textOf(renderer.root), /Trash is empty/);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("framework navigation control-flow errors still escape the local action handler", async () => {
    await withPortalDom(async () => {
      const controlFlowError = Object.assign(new Error("NEXT_REDIRECT"), {
        __nextControlFlow: true,
      });
      globalForActions.__trashListActionsTestState.restoreImpl = async () => {
        throw controlFlowError;
      };
      const renderer = mount([doc()]);
      try {
        act(() => {
          restoreButtonFor(renderer, "Quarterly Plan").props.onClick();
        });

        await assert.rejects(
          () =>
            Promise.resolve(
              act(async () => {
                dialogButton(renderer, "Restore").props.onClick();
                await waitForAsyncDrain();
                await waitForAsyncDrain();
              }),
            ),
          controlFlowError,
        );
        assert.deepEqual(
          globalForActions.__trashListActionsTestState.rethrowCalls,
          [controlFlowError],
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });
});
