/**
 * Direct contract coverage for `DocumentList` (#1961) — the dashboard's
 * top-level composition: URL-derived sort/view/tag state, debounced search
 * (with stale-request cancellation), the empty state, and the optimistic
 * delete/undo round trip.
 *
 * This is deliberately an integration-level test of the *wiring*, not a
 * re-derivation of already-covered pure logic:
 *  - `parseSort`/`parseView`/`parseTag`/`applyDocumentListViewState`/
 *    `filterDocumentsBy*`/`sortDocuments` (`./document-list-url-state`) keep
 *    their own exhaustive coverage in `document-list-url-state.test.ts`.
 *  - `nextDocumentListRequestSeq`/`isCurrentDocumentListRequest`
 *    (`./document-list-async-ordering`) are covered by
 *    `document-list-async-ordering.test.ts`.
 *  - `useOptimisticDocumentTrash`'s full optimistic-removal/restore/error/
 *    stale-operation matrix is covered by
 *    `use-optimistic-document-trash.test.tsx`.
 * All four are used for real here (none are stubbed) — only `"./actions"`
 * (already covered by `actions.test.ts`) and `"next/navigation"` are
 * stubbed, so this file only asserts that `DocumentList` feeds the right
 * inputs to that already-tested logic and renders its outputs correctly:
 * which sort/view/tag the URL selects, when the debounce/search kicks in,
 * and that a card's delete/undo flows all the way through to the real
 * `DocumentGrid`/`DocumentCard`/`UndoToast`.
 *
 * `next/navigation`'s `usePathname`/`useSearchParams` are stubbed to read a
 * plain mutable global (`__documentListNavState`) — not a React context —
 * so each render just reads whatever the test last set. `window.history`
 * (absent from `@/test/portal-dom`'s fake `window`, since most of its other
 * consumers never touch it) is attached per-test as a spy that also updates
 * that same global, so a `setSort`/`setView`/`setTag` interaction can be
 * asserted two ways: the exact URL `history.replaceState` was called with
 * (the call boundary), and — after simulating the App Router's resulting
 * re-render via `renderer.update(...)` — the new `useSearchParams()` value
 * actually re-deriving the visible list (the observable effect a real user
 * would see once Next's router re-renders with the new URL).
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { act, type ReactTestRenderer } from "react-test-renderer";

import { mountWithPortalDom, withPortalDom } from "@/test/portal-dom";
import { textOf, waitForAsyncDrain } from "@/test/render-text";
import { stubModule } from "@/test/module-stub";
import type { AvailableTag, DashboardDocument } from "@/lib/document/list";

type NavState = { pathname: string; search: string };
const globalForNav = globalThis as typeof globalThis & {
  __documentListNavState: NavState;
};
globalForNav.__documentListNavState = { pathname: "/app", search: "" };

stubModule(
  "next/navigation",
  `module.exports = {
  usePathname: () => globalThis.__documentListNavState.pathname,
  useSearchParams: () => new URLSearchParams(globalThis.__documentListNavState.search),
  unstable_rethrow: (error) => {
    globalThis.__documentListActionsTestState.rethrowCalls.push(error);
    if (error && error.__nextControlFlow === true) throw error;
  },
};`,
);

type ActionsTestState = {
  deleteCalls: string[];
  restoreCalls: string[];
  searchCalls: string[];
  rethrowCalls: unknown[];
  deleteImpl: (id: string) => Promise<void>;
  restoreImpl: (id: string) => Promise<void>;
  searchImpl: (
    query: string,
  ) => Promise<{ results: DashboardDocument[]; hasMore: boolean }>;
};
const globalForActions = globalThis as typeof globalThis & {
  __documentListActionsTestState: ActionsTestState;
};

function resetActionsState(): void {
  globalForActions.__documentListActionsTestState = {
    deleteCalls: [],
    restoreCalls: [],
    searchCalls: [],
    rethrowCalls: [],
    deleteImpl: async () => undefined,
    restoreImpl: async () => undefined,
    searchImpl: async () => ({ results: [], hasMore: false }),
  };
}
resetActionsState();

// Covers every action the whole `document-list.tsx` module graph resolves
// via the shared `"./actions"` specifier: `deleteDocument`/
// `restoreDocument`/`searchDocuments` (used directly by `DocumentList`) and
// `duplicateDocument`/`renameDocument`/`toggleFavorite` (used by the real,
// transitively-rendered `DocumentCard`) and `createDocumentFromTemplate`
// (used by the real `EmptyDocumentList` → `NewDocumentButton`).
stubModule(
  "./actions",
  `module.exports = {
  deleteDocument: async (id) => {
    const s = globalThis.__documentListActionsTestState;
    s.deleteCalls.push(id);
    return s.deleteImpl(id);
  },
  restoreDocument: async (id) => {
    const s = globalThis.__documentListActionsTestState;
    s.restoreCalls.push(id);
    return s.restoreImpl(id);
  },
  searchDocuments: async (query) => {
    const s = globalThis.__documentListActionsTestState;
    s.searchCalls.push(query);
    return s.searchImpl(query);
  },
  duplicateDocument: async () => undefined,
  renameDocument: async (id, title) => ({ title }),
  toggleFavorite: async () => ({ favorite: true }),
  createDocumentFromTemplate: async () => undefined,
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

let DocumentList: typeof import("./document-list").DocumentList;
before(async () => {
  DocumentList = (await import("./document-list")).DocumentList;
});

beforeEach(() => {
  resetActionsState();
  globalForNav.__documentListNavState = { pathname: "/app", search: "" };
});

function doc(
  id: string,
  overrides: Partial<DashboardDocument> = {},
): DashboardDocument {
  return {
    id,
    title: id,
    favorite: false,
    editedLabel: "Jan 1, 2026",
    workspaceName: null,
    thumbnail: null,
    excerpt: "",
    readingMinutes: 1,
    createdAtMs: 1,
    updatedAtMs: 1,
    canEdit: true,
    canManage: true,
    tags: [],
    ...overrides,
  };
}

const TAGS: AvailableTag[] = [
  { slug: "roadmap", name: "Roadmap" },
  { slug: "notes", name: "Notes" },
];

/** Installs a `window.history.replaceState` spy that also keeps `__documentListNavState` in sync, mirroring the App Router's real URL-sync behavior closely enough for these tests. */
function installHistorySpy(): { calls: string[] } {
  const calls: string[] = [];
  (
    globalThis.window as unknown as {
      history: {
        replaceState: (state: unknown, title: string, url: string) => void;
      };
    }
  ).history = {
    replaceState: (_state, _title, url) => {
      calls.push(url);
      const [path, qs] = url.split("?");
      globalForNav.__documentListNavState = {
        pathname: path ?? "/app",
        search: qs ?? "",
      };
    },
  };
  return { calls };
}

function mount(props: {
  documents?: DashboardDocument[];
  availableTags?: AvailableTag[];
  listCapped?: boolean;
}): ReactTestRenderer {
  return mountWithPortalDom(
    <DocumentList
      documents={props.documents ?? []}
      availableTags={props.availableTags ?? TAGS}
      listCapped={props.listCapped ?? false}
    />,
  );
}

/** Returns each rendered card's `id` prop, in DOM order, de-duplicated (a card's `id` also appears on nested elements via prop drilling in some matchers). */
function cardIdsInOrder(renderer: ReactTestRenderer): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const el of renderer.root.findAllByProps({ canEdit: true })) {
    const id = el.props.id as string;
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

describe("DocumentList", () => {
  test("renders EmptyDocumentList (no toolbar/grid) when there are no documents at all", () => {
    withPortalDom(() => {
      installHistorySpy();
      const renderer = mount({ documents: [] });
      try {
        assert.match(textOf(renderer.root), /No documents yet/);
        assert.throws(() =>
          renderer.root.findByProps({ "aria-label": "Search documents" }),
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("with the default URL, documents render sorted by most-recently-edited (no tag/view filter, no cap notice)", () => {
    withPortalDom(() => {
      installHistorySpy();
      const docs = [
        doc("older", { title: "Older", updatedAtMs: 1 }),
        doc("newer", { title: "Newer", updatedAtMs: 2 }),
      ];
      const renderer = mount({ documents: docs });
      try {
        assert.deepEqual(cardIdsInOrder(renderer), ["newer", "older"]);
        assert.throws(() => renderer.root.findByProps({ role: "status" }));
        assert.throws(() => renderer.root.findByProps({ role: "alert" }));
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("tag=<slug> in the URL filters the grid to matching documents, naming the tag when none match", () => {
    withPortalDom(() => {
      installHistorySpy();
      const docs = [
        doc("tagged", {
          title: "Tagged",
          tags: [{ slug: "roadmap", name: "Roadmap" }],
        }),
        doc("untagged", { title: "Untagged" }),
      ];
      globalForNav.__documentListNavState.search = "tag=roadmap";
      const renderer = mount({ documents: docs });
      try {
        assert.ok(renderer.root.findByProps({ id: "tagged" }));
        assert.throws(() => renderer.root.findByProps({ id: "untagged" }));
      } finally {
        act(() => renderer.unmount());
      }

      globalForNav.__documentListNavState.search = "tag=notes";
      const renderer2 = mount({ documents: docs });
      try {
        assert.match(textOf(renderer2.root), /No documents tagged .Notes./);
      } finally {
        act(() => renderer2.unmount());
      }
    });
  });

  test("view=favorites in the URL filters to favorites, showing the favorites-empty state when there are none", () => {
    withPortalDom(() => {
      installHistorySpy();
      const docs = [
        doc("fav", { title: "Fav", favorite: true }),
        doc("plain", { title: "Plain" }),
      ];
      globalForNav.__documentListNavState.search = "view=favorites";
      const renderer = mount({ documents: docs });
      try {
        assert.ok(renderer.root.findByProps({ id: "fav" }));
        assert.throws(() => renderer.root.findByProps({ id: "plain" }));
      } finally {
        act(() => renderer.unmount());
      }

      const renderer2 = mount({
        documents: [doc("plain", { title: "Plain" })],
      });
      try {
        // Params already set to view=favorites from the prior mount.
        assert.match(textOf(renderer2.root), /No favorite documents yet/);
      } finally {
        act(() => renderer2.unmount());
      }
    });
  });

  test("choosing a sort option updates the URL via history.replaceState, and the resulting re-render re-sorts the grid", () => {
    withPortalDom(() => {
      const history = installHistorySpy();
      const docs = [
        doc("b-doc", { title: "Banana" }),
        doc("a-doc", { title: "Apple" }),
      ];
      const renderer = mount({ documents: docs });
      try {
        const sortTrigger = renderer.root.find(
          (el) =>
            el.type === "button" && el.props["aria-label"] === "Sort documents",
        );
        act(() => {
          (sortTrigger.props.onClick as () => void)();
        });
        const titleOption = renderer.root.find(
          (el) =>
            el.props.role === "option" && textOf(el).includes("Title (A–Z)"),
        );
        act(() => {
          (titleOption.findByType("button").props.onClick as () => void)();
        });

        assert.deepEqual(history.calls, ["/app?sort=title"]);

        act(() => {
          renderer.update(
            <DocumentList
              documents={docs}
              availableTags={TAGS}
              listCapped={false}
            />,
          );
        });

        assert.deepEqual(cardIdsInOrder(renderer), ["a-doc", "b-doc"]);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("the favorites toggle updates the URL to view=favorites and back to no view param", () => {
    withPortalDom(() => {
      const history = installHistorySpy();
      const renderer = mount({ documents: [doc("only")] });
      try {
        const toggle = renderer.root.findByProps({
          "aria-label": "Show favorites only",
        });
        act(() => {
          (toggle.props.onClick as () => void)();
        });
        assert.deepEqual(history.calls, ["/app?view=favorites"]);

        globalForNav.__documentListNavState.search = "view=favorites";
        act(() => {
          renderer.update(
            <DocumentList
              documents={[doc("only")]}
              availableTags={TAGS}
              listCapped={false}
            />,
          );
        });
        const toggleAgain = renderer.root.findByProps({
          "aria-label": "Show favorites only",
        });
        act(() => {
          (toggleAgain.props.onClick as () => void)();
        });
        assert.deepEqual(history.calls, ["/app?view=favorites", "/app"]);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("typing a query debounces 300ms before calling searchDocuments, and a keystroke before it fires cancels the pending call", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    await withPortalDom(async () => {
      installHistorySpy();
      globalForActions.__documentListActionsTestState.searchImpl = async (
        query,
      ) => ({
        results: [doc("hit", { title: `Result for ${query}` })],
        hasMore: false,
      });
      const renderer = mount({ documents: [doc("local", { title: "Local" })] });
      try {
        const input = renderer.root.findByProps({
          "aria-label": "Search documents",
        });
        act(() => {
          (input.props.onChange as (e: unknown) => void)({
            target: { value: "fir" },
          });
        });
        await act(async () => {
          t.mock.timers.tick(200);
        });
        // Not yet 300ms — no call, and a further keystroke resets the timer.
        assert.deepEqual(
          globalForActions.__documentListActionsTestState.searchCalls,
          [],
        );
        act(() => {
          (input.props.onChange as (e: unknown) => void)({
            target: { value: "first" },
          });
        });
        await act(async () => {
          t.mock.timers.tick(300);
        });
        await act(async () => {
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });

        assert.deepEqual(
          globalForActions.__documentListActionsTestState.searchCalls,
          ["first"],
        );
        assert.ok(renderer.root.findByProps({ id: "hit" }));
        assert.throws(() => renderer.root.findByProps({ id: "local" }));
      } finally {
        act(() => renderer.unmount());
        t.mock.timers.reset();
      }
    });
  });

  test("a search response showing hasMore renders the capped-results notice", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    await withPortalDom(async () => {
      installHistorySpy();
      globalForActions.__documentListActionsTestState.searchImpl =
        async () => ({
          results: [doc("hit", { title: "Hit" })],
          hasMore: true,
        });
      const renderer = mount({ documents: [doc("seed", { title: "Seed" })] });
      try {
        const input = renderer.root.findByProps({
          "aria-label": "Search documents",
        });
        act(() => {
          (input.props.onChange as (e: unknown) => void)({
            target: { value: "hit" },
          });
        });
        await act(async () => {
          t.mock.timers.tick(300);
        });
        await act(async () => {
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });

        assert.match(
          textOf(renderer.root.findByProps({ role: "status" })),
          /Showing the first 1 documents/,
        );
      } finally {
        act(() => renderer.unmount());
        t.mock.timers.reset();
      }
    });
  });

  test("a failed search stays inline with generic dismissible copy and keeps the dashboard usable", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    await withPortalDom(async () => {
      installHistorySpy();
      const privateFailure = new Error("private search provider detail");
      globalForActions.__documentListActionsTestState.searchImpl = async () => {
        throw privateFailure;
      };
      const renderer = mount({ documents: [doc("seed", { title: "Seed" })] });
      try {
        act(() => {
          renderer.root
            .findByProps({
              "aria-label": "Search documents",
            })
            .props.onChange({ target: { value: "missing" } });
        });
        await act(async () => {
          t.mock.timers.tick(300);
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });

        const alert = renderer.root.findByProps({ role: "alert" });
        assert.match(
          textOf(alert),
          /Could not search documents\. Please try again\./,
        );
        assert.doesNotMatch(textOf(alert), /private search provider detail/);
        assert.ok(
          renderer.root.findByProps({ "aria-label": "Search documents" }),
        );
        assert.deepEqual(
          globalForActions.__documentListActionsTestState.rethrowCalls,
          [privateFailure],
        );

        await act(async () => {
          alert
            .find(
              (el) => el.type === "button" && textOf(el) === "Dismiss error",
            )
            .props.onClick();
          await waitForAsyncDrain();
        });
        assert.throws(() => renderer.root.findByProps({ role: "alert" }));
      } finally {
        await act(async () => renderer.unmount());
        t.mock.timers.reset();
      }
    });
  });

  test("search retry runs immediately and replaces the failed result with the recovered response", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    await withPortalDom(async () => {
      installHistorySpy();
      let attempt = 0;
      globalForActions.__documentListActionsTestState.searchImpl = async () => {
        attempt += 1;
        if (attempt === 1) throw new Error("temporary search failure");
        return {
          results: [doc("recovered", { title: "Recovered result" })],
          hasMore: false,
        };
      };
      const renderer = mount({ documents: [doc("seed", { title: "Seed" })] });
      try {
        act(() => {
          renderer.root
            .findByProps({
              "aria-label": "Search documents",
            })
            .props.onChange({ target: { value: "recover" } });
        });
        await act(async () => {
          t.mock.timers.tick(300);
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });

        const retry = renderer.root.find(
          (el) => el.type === "button" && textOf(el) === "Try search again",
        );
        await act(async () => {
          retry.props.onClick();
          retry.props.onClick();
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });

        assert.deepEqual(
          globalForActions.__documentListActionsTestState.searchCalls,
          ["recover", "recover"],
        );
        assert.ok(renderer.root.findByProps({ id: "recovered" }));
        assert.throws(() => renderer.root.findByProps({ role: "alert" }));
      } finally {
        await act(async () => renderer.unmount());
        t.mock.timers.reset();
      }
    });
  });

  test("a favorite write stays reconciled when server props refresh during an active search", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    await withPortalDom(async () => {
      installHistorySpy();
      const searchHit = doc("search-hit", {
        title: "Search Hit",
        favorite: false,
      });
      globalForActions.__documentListActionsTestState.searchImpl =
        async () => ({
          results: [searchHit],
          hasMore: false,
        });
      const renderer = mount({ documents: [searchHit] });
      try {
        act(() => {
          renderer.root
            .findByProps({ "aria-label": "Search documents" })
            .props.onChange({ target: { value: "Search Hit" } });
        });
        await act(async () => {
          t.mock.timers.tick(300);
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });

        await act(async () => {
          renderer.root
            .findByProps({ "aria-label": "Favorite Search Hit" })
            .props.onClick();
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });

        await act(async () => {
          renderer.update(
            <DocumentList
              documents={[doc("search-hit", { ...searchHit, favorite: true })]}
              availableTags={TAGS}
              listCapped={false}
            />,
          );
          await waitForAsyncDrain();
        });

        assert.equal(
          renderer.root.findByProps({ "aria-label": "Unfavorite Search Hit" })
            .props["aria-pressed"],
          true,
        );
      } finally {
        act(() => renderer.unmount());
        t.mock.timers.reset();
      }
    });
  });

  test("duplicating an active search result refreshes the query so the matching copy appears", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    await withPortalDom(async () => {
      installHistorySpy();
      let searchAttempt = 0;
      const searchHit = doc("search-hit", { title: "Search Hit" });
      globalForActions.__documentListActionsTestState.searchImpl = async () => {
        searchAttempt += 1;
        return {
          results:
            searchAttempt === 1
              ? [searchHit]
              : [
                  searchHit,
                  doc("search-hit-copy", { title: "Search Hit (copy)" }),
                ],
          hasMore: false,
        };
      };
      const renderer = mount({ documents: [searchHit] });
      try {
        act(() => {
          renderer.root
            .findByProps({ "aria-label": "Search documents" })
            .props.onChange({ target: { value: "Search Hit" } });
        });
        await act(async () => {
          t.mock.timers.tick(300);
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });

        act(() => {
          renderer.root
            .findByProps({ "aria-label": "Actions for Search Hit" })
            .props.onClick();
        });
        await act(async () => {
          renderer.root
            .find(
              (element) =>
                element.props.role === "menuitem" &&
                textOf(element) === "Duplicate",
            )
            .props.onClick();
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });

        assert.deepEqual(
          globalForActions.__documentListActionsTestState.searchCalls,
          ["Search Hit", "Search Hit"],
        );
        assert.ok(renderer.root.findByProps({ id: "search-hit-copy" }));
      } finally {
        act(() => renderer.unmount());
        t.mock.timers.reset();
      }
    });
  });

  test("renaming an active search result refreshes membership when it stops matching", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    await withPortalDom(async () => {
      installHistorySpy();
      let searchAttempt = 0;
      const searchHit = doc("search-hit", { title: "Search Hit" });
      globalForActions.__documentListActionsTestState.searchImpl = async () => {
        searchAttempt += 1;
        return {
          results: searchAttempt === 1 ? [searchHit] : [],
          hasMore: false,
        };
      };
      const renderer = mount({ documents: [searchHit] });
      try {
        act(() => {
          renderer.root
            .findByProps({ "aria-label": "Search documents" })
            .props.onChange({ target: { value: "Search Hit" } });
        });
        await act(async () => {
          t.mock.timers.tick(300);
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });

        act(() => {
          renderer.root
            .findByProps({ "aria-label": "Actions for Search Hit" })
            .props.onClick();
        });
        act(() => {
          renderer.root
            .find(
              (element) =>
                element.props.role === "menuitem" &&
                textOf(element) === "Rename",
            )
            .props.onClick();
        });
        act(() => {
          renderer.root
            .findByProps({ "aria-label": "Document title" })
            .props.onChange({ target: { value: "Renamed Away" } });
        });
        await act(async () => {
          renderer.root.findByType("form").props.onSubmit({
            preventDefault: () => undefined,
          });
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });

        assert.deepEqual(
          globalForActions.__documentListActionsTestState.searchCalls,
          ["Search Hit", "Search Hit"],
        );
        assert.throws(() => renderer.root.findByProps({ id: "search-hit" }));
        assert.match(textOf(renderer.root), /No documents match your search/);
      } finally {
        act(() => renderer.unmount());
        t.mock.timers.reset();
      }
    });
  });

  test("listCapped shows the capped notice outside of an active search", () => {
    withPortalDom(() => {
      installHistorySpy();
      const renderer = mount({ documents: [doc("only")], listCapped: true });
      try {
        assert.match(
          textOf(renderer.root.findByProps({ role: "status" })),
          /Showing the first 1 documents/,
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("deleting a document shows the undo toast; clicking Undo restores it and calls restoreDocument", async () => {
    await withPortalDom(async () => {
      installHistorySpy();
      const renderer = mount({
        documents: [doc("doc-1", { title: "Doc One", canManage: true })],
      });
      try {
        const kebab = renderer.root.findByProps({
          "aria-label": "Actions for Doc One",
        });
        act(() => {
          (kebab.props.onClick as () => void)();
        });
        const deleteItem = renderer.root.find(
          (el) => el.props.role === "menuitem" && textOf(el) === "Delete",
        );
        act(() => {
          (deleteItem.props.onClick as () => void)();
        });
        const confirmDelete = renderer.root.find(
          (el) => el.type === "button" && textOf(el) === "Delete",
        );
        act(() => {
          (confirmDelete.props.onClick as () => void)();
        });

        assert.throws(() => renderer.root.findByProps({ id: "doc-1" }));
        assert.match(textOf(renderer.root), /Document deleted[\s\S]*Doc One/);

        const undoButton = renderer.root.find(
          (el) => el.type === "button" && textOf(el) === "Undo",
        );
        act(() => {
          (undoButton.props.onClick as () => void)();
        });

        assert.ok(renderer.root.findByProps({ id: "doc-1" }));

        await act(async () => {
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });

        assert.deepEqual(
          globalForActions.__documentListActionsTestState.restoreCalls,
          ["doc-1"],
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("a failed delete restores the row and shows the trash error banner", async () => {
    await withPortalDom(async () => {
      installHistorySpy();
      globalForActions.__documentListActionsTestState.deleteImpl = async () => {
        throw new Error("boom");
      };
      const renderer = mount({
        documents: [doc("doc-1", { title: "Doc One", canManage: true })],
      });
      try {
        const kebab = renderer.root.findByProps({
          "aria-label": "Actions for Doc One",
        });
        act(() => {
          (kebab.props.onClick as () => void)();
        });
        const deleteItem = renderer.root.find(
          (el) => el.props.role === "menuitem" && textOf(el) === "Delete",
        );
        act(() => {
          (deleteItem.props.onClick as () => void)();
        });
        const confirmDelete = renderer.root.find(
          (el) => el.type === "button" && textOf(el) === "Delete",
        );
        await act(async () => {
          (confirmDelete.props.onClick as () => void)();
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });

        assert.ok(renderer.root.findByProps({ id: "doc-1" }));
        assert.match(
          textOf(renderer.root.findByProps({ role: "alert" })),
          /Could not move the document to trash\. It was restored\./,
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });
});
