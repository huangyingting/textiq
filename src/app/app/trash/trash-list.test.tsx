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
 * `RestoreConfirmDialog`/`PermanentDeleteConfirmDialog` are both built on
 * `Dialog` → `ModalSurface`, which unconditionally `createPortal`s to
 * `document.body` once `document` exists — same rationale as
 * `document-card.test.tsx`, so this uses `@/test/portal-dom`'s
 * `withPortalDom`/`mountWithPortalDom`. Both dialogs are only ever rendered
 * via `{restoreOpen && <RestoreConfirmDialog .../>}` /
 * `{deleteOpen && <PermanentDeleteConfirmDialog .../>}` — the parent fully
 * mounts/unmounts the dialog element on cancel (never just toggles `open`
 * while staying mounted), so cancelling synchronously removes it from the
 * tree; no framer-motion exit-animation linger to work around here (see
 * `portal-dom.ts`'s module docstring for the case where that *does* matter).
 *
 * `handleRestore`/`handlePermanentDelete` call their action with no local
 * `try`/`catch`, so a rejected action is never swallowed: it propagates out
 * of the `startTransition` async callback as a genuine thrown error (verified
 * against a real `restoreDocument`/`permanentDeleteDocument` rejection, not
 * inferred) — the "error" tests below assert that propagation directly via
 * `assert.rejects`, rather than asserting on a local error message that the
 * component never renders.
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
    restoreImpl: async () => undefined,
    permanentDeleteImpl: async () => undefined,
  };
}
resetActionsState();

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
          const confirmBtn = renderer.root
            .findByProps({ role: "dialog" })
            .find((el) => el.type === "button" && textOf(el) === "Restore");
          pendingCall = confirmBtn.props.onClick();
        });

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

  test("a rejected restoreDocument propagates uncaught — TrashRow has no local try/catch to swallow it", async () => {
    await withPortalDom(async () => {
      globalForActions.__trashListActionsTestState.restoreImpl = async () => {
        throw new Error("restore failed");
      };
      const renderer = mount([doc()]);
      try {
        act(() => {
          (
            restoreButtonFor(renderer, "Quarterly Plan").props
              .onClick as () => void
          )();
        });
        const confirmBtn = renderer.root
          .findByProps({ role: "dialog" })
          .find((el) => el.type === "button" && textOf(el) === "Restore");

        await assert.rejects(
          () =>
            Promise.resolve(
              act(async () => {
                (confirmBtn.props.onClick as () => void)();
                await waitForAsyncDrain();
                await waitForAsyncDrain();
              }),
            ),
          /restore failed/,
        );

        assert.deepEqual(
          globalForActions.__trashListActionsTestState.restoreCalls,
          ["doc-1"],
        );
      } finally {
        // The uncaught error already tore down the renderer's committed
        // tree (no local error boundary here); unmount is still safe to
        // call and is required for `mountWithPortalDom`'s cleanup ordering.
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
          const confirmBtn = renderer.root
            .findByProps({ role: "dialog" })
            .find(
              (el) =>
                el.type === "button" && textOf(el) === "Delete permanently",
            );
          pendingCall = confirmBtn.props.onClick();
        });

        const dialogWhilePending = renderer.root.findByProps({
          role: "dialog",
        });
        const confirmWhilePending = dialogWhilePending.find(
          (el) => el.type === "button" && textOf(el) === "Deleting…",
        );
        assert.equal(confirmWhilePending.props.disabled, true);

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

  test("a rejected permanentDeleteDocument propagates uncaught — TrashRow has no local try/catch to swallow it", async () => {
    await withPortalDom(async () => {
      globalForActions.__trashListActionsTestState.permanentDeleteImpl =
        async () => {
          throw new Error("delete failed");
        };
      const renderer = mount([doc()]);
      try {
        act(() => {
          (
            deleteButtonFor(renderer, "Quarterly Plan").props
              .onClick as () => void
          )();
        });
        const confirmBtn = renderer.root
          .findByProps({ role: "dialog" })
          .find(
            (el) => el.type === "button" && textOf(el) === "Delete permanently",
          );

        await assert.rejects(
          () =>
            Promise.resolve(
              act(async () => {
                (confirmBtn.props.onClick as () => void)();
                await waitForAsyncDrain();
                await waitForAsyncDrain();
              }),
            ),
          /delete failed/,
        );

        assert.deepEqual(
          globalForActions.__trashListActionsTestState.permanentDeleteCalls,
          ["doc-1"],
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });
});
