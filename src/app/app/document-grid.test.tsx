/**
 * Direct contract coverage for `DocumentGrid`/`EmptyDocumentList` (#1961) —
 * the dashboard's document-tile layout and its three mutually-exclusive
 * empty states (no-tag-match, no-favorites, empty-search), plus the
 * all-documents-deleted empty state.
 *
 * `DocumentGrid` renders one `DocumentCard` per visible document — already
 * given full behavioral coverage (menu/rename/duplicate/delete/favorite) by
 * `document-card.test.tsx` — so this file only asserts *grid-level*
 * wiring: which empty state wins when more than one condition is true, and
 * that each visible document is passed through to its own `DocumentCard`
 * with the right props and a shared `onDelete` callback. It never re-drives
 * a card's internal menu/dialogs.
 *
 * `EmptyDocumentList` renders `NewDocumentButton`, already fully covered by
 * `new-document-button.test.tsx`; this only asserts it's actually rendered
 * with the expected call-to-action copy, not its internal template-picker
 * behavior.
 *
 * Both `DocumentCard` (`duplicateDocument`/`renameDocument`/
 * `toggleFavorite`) and `NewDocumentButton` (`createDocumentFromTemplate`)
 * resolve the same `"./actions"` specifier within this file's module graph,
 * so the `@/test/module-stub` stub below covers all four — none of them are
 * expected to be called by anything this file drives directly.
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { act, type ReactTestRenderer } from "react-test-renderer";

import { mountWithPortalDom, withPortalDom } from "@/test/portal-dom";
import { textOf } from "@/test/render-text";
import { stubModule } from "@/test/module-stub";
import type { DashboardDocument } from "@/lib/document/list";

stubModule(
  "./actions",
  `module.exports = {
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

// `./document-card`/`./document-grid` both transitively resolve `"./actions"`
// — they must be imported dynamically, *after* the `stubModule` call above
// registers the stub, or the real `"use server"` module (which requires a
// live request/session) loads instead. A static `import` of either at the
// top of this file would defeat the stub entirely: ES module semantics
// fully evaluate all static imports (and their whole dependency subtree)
// before any of *this* file's own top-level statements — including the
// `stubModule` call above — ever run.
let DocumentCard: typeof import("./document-card").DocumentCard;
let DocumentGrid: typeof import("./document-grid").DocumentGrid;
let EmptyDocumentList: typeof import("./document-grid").EmptyDocumentList;
type DocumentCardData = import("./document-card").DocumentCardData;
before(async () => {
  DocumentCard = (await import("./document-card")).DocumentCard;
  ({ DocumentGrid, EmptyDocumentList } = await import("./document-grid"));
});

function makeDocument(
  overrides: Partial<DashboardDocument> = {},
): DashboardDocument {
  return {
    id: "doc-1",
    title: "Quarterly Plan",
    favorite: false,
    editedLabel: "2 days ago",
    workspaceName: "Marketing",
    thumbnail: null,
    excerpt: "Some excerpt.",
    readingMinutes: 3,
    createdAtMs: 0,
    updatedAtMs: 0,
    canEdit: true,
    canManage: true,
    tags: [],
    ...overrides,
  };
}

function mountGrid(overrides: {
  visible?: DashboardDocument[];
  noTagMatch?: boolean;
  selectedTagName?: string | null;
  clearTag?: () => void;
  noFavorites?: boolean;
  onDelete?: (data: DocumentCardData) => void;
  onUpdated?: () => void;
  onRefreshRequested?: () => void;
}): ReactTestRenderer {
  return mountWithPortalDom(
    <DocumentGrid
      visible={overrides.visible ?? []}
      noTagMatch={overrides.noTagMatch ?? false}
      selectedTagName={overrides.selectedTagName ?? null}
      clearTag={overrides.clearTag ?? (() => {})}
      noFavorites={overrides.noFavorites ?? false}
      onDelete={overrides.onDelete ?? (() => {})}
      onUpdated={overrides.onUpdated ?? (() => {})}
      onRefreshRequested={overrides.onRefreshRequested ?? (() => {})}
    />,
  );
}

describe("EmptyDocumentList", () => {
  test("shows the no-documents message and a New Document button", () => {
    withPortalDom(() => {
      const renderer = mountWithPortalDom(<EmptyDocumentList />);
      try {
        assert.match(textOf(renderer.root), /No documents yet/);
        assert.match(
          textOf(renderer.root),
          /Create your first document to start turning text into visuals\./,
        );
        const trigger = renderer.root.findByType("button");
        assert.match(textOf(trigger), /Create your first document/);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });
});

describe("DocumentGrid", () => {
  test("noTagMatch wins over noFavorites and a non-empty visible list, naming the tag and wiring Clear filter", () => {
    withPortalDom(() => {
      const clearCalls: number[] = [];
      const renderer = mountGrid({
        noTagMatch: true,
        noFavorites: true,
        selectedTagName: "Roadmap",
        visible: [makeDocument()],
        clearTag: () => clearCalls.push(1),
      });
      try {
        assert.match(textOf(renderer.root), /No documents tagged .Roadmap./);
        assert.throws(() => renderer.root.findByType(DocumentCard));
        const clearButton = renderer.root.find(
          (el) => el.type === "button" && textOf(el) === "Clear filter",
        );
        act(() => {
          (clearButton.props.onClick as () => void)();
        });
        assert.deepEqual(clearCalls, [1]);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("noFavorites shows the favorites-empty message even when documents are present", () => {
    withPortalDom(() => {
      const renderer = mountGrid({
        noFavorites: true,
        visible: [makeDocument()],
      });
      try {
        assert.match(textOf(renderer.root), /No favorite documents yet/);
        assert.throws(() => renderer.root.findByType(DocumentCard));
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("an empty visible list (no tag/favorites condition) shows the search-empty message", () => {
    withPortalDom(() => {
      const renderer = mountGrid({ visible: [] });
      try {
        assert.match(textOf(renderer.root), /No documents match your search/);
        assert.throws(() => renderer.root.findByType(DocumentCard));
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("renders one DocumentCard per visible document, in order, each wired to the shared onDelete", () => {
    withPortalDom(() => {
      const deletes: DocumentCardData[] = [];
      const docs = [
        makeDocument({ id: "doc-1", title: "First" }),
        makeDocument({ id: "doc-2", title: "Second", canManage: false }),
      ];
      const renderer = mountGrid({
        visible: docs,
        onDelete: (data) => {
          deletes.push(data);
        },
      });
      try {
        const cards = renderer.root.findAllByType(DocumentCard);
        assert.equal(cards.length, 2);
        assert.equal(cards[0]!.props.id, "doc-1");
        assert.equal(cards[0]!.props.title, "First");
        assert.equal(cards[1]!.props.id, "doc-2");
        assert.equal(cards[1]!.props.title, "Second");
        assert.equal(cards[1]!.props.canManage, false);
        // Both cards share the exact same onDelete reference from the grid.
        assert.equal(cards[0]!.props.onDelete, cards[1]!.props.onDelete);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });
});
