/**
 * Direct contract coverage for `DocumentListToolbar` (#1961) — the dashboard
 * search/tag-filter/favorites/sort control row `DocumentList` mounts above
 * the document grid.
 *
 * Both dropdowns (`SelectMenu` for tag filter and sort) portal their open
 * listbox to `document.body` and wrap their trigger in `Tooltip`
 * (framer-motion), so this uses the shared `@/test/portal-dom` harness —
 * same rationale as `new-document-button.test.tsx`. `DocumentListToolbar`
 * itself is a pure controlled component (every mutation is a callback prop),
 * so coverage here is call-boundary only: which callback fires, with what
 * argument, for a given control interaction — never re-deriving
 * `SelectMenu`'s own open/keyboard-nav contract (no direct test exists yet,
 * out of scope for this file) beyond what's needed to select an option.
 */
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { act, type ReactTestRenderer } from "react-test-renderer";

import { mountWithPortalDom, withPortalDom } from "@/test/portal-dom";
import { textOf } from "@/test/render-text";
import type { AvailableTag } from "@/lib/document/list";

import { DocumentListToolbar } from "./document-list-toolbar";
import type { SortKey, ViewKey } from "./document-list-url-state";

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

const TAGS: AvailableTag[] = [
  { slug: "roadmap", name: "Roadmap" },
  { slug: "notes", name: "Notes" },
];

type Props = {
  availableTags?: AvailableTag[];
  query?: string;
  setQuery?: (query: string) => void;
  isSearching?: boolean;
  selectedTag?: string | null;
  setTag?: (tag: string | null) => void;
  sort?: SortKey;
  setSort?: (sort: SortKey) => void;
  view?: ViewKey;
  setView?: (view: ViewKey) => void;
};

function mount(overrides: Props = {}): ReactTestRenderer {
  return mountWithPortalDom(
    <DocumentListToolbar
      availableTags={overrides.availableTags ?? TAGS}
      query={overrides.query ?? ""}
      setQuery={overrides.setQuery ?? (() => {})}
      isSearching={overrides.isSearching ?? false}
      selectedTag={overrides.selectedTag ?? null}
      setTag={overrides.setTag ?? (() => {})}
      sort={overrides.sort ?? "edited"}
      setSort={overrides.setSort ?? (() => {})}
      view={overrides.view ?? "all"}
      setView={overrides.setView ?? (() => {})}
    />,
  );
}

/** Opens a `SelectMenu` by its trigger `aria-label`, then clicks the option matching `optionText`. */
function chooseOption(
  renderer: ReactTestRenderer,
  triggerLabel: string,
  optionText: string,
): void {
  // `findByProps` would also match the wrapping `SelectMenu` element itself
  // (it forwards `aria-label` as a prop), so narrow to the host `<button>`.
  const trigger = renderer.root.find(
    (el) => el.type === "button" && el.props["aria-label"] === triggerLabel,
  );
  act(() => {
    (trigger.props.onClick as () => void)();
  });
  const option = renderer.root.find(
    (el) => el.props.role === "option" && textOf(el).includes(optionText),
  );
  const optionButton = option.findByType("button");
  act(() => {
    (optionButton.props.onClick as () => void)();
  });
}

describe("DocumentListToolbar", () => {
  test("typing in the search box calls setQuery with the raw input value", () => {
    withPortalDom(() => {
      const calls: string[] = [];
      const renderer = mount({ setQuery: (q) => calls.push(q) });
      try {
        const input = renderer.root.findByProps({
          "aria-label": "Search documents",
        });
        act(() => {
          (input.props.onChange as (e: unknown) => void)({
            target: { value: "quarterly plan" },
          });
        });
        assert.deepEqual(calls, ["quarterly plan"]);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("shows the spinner affordance while searching, and a static magnifier otherwise", () => {
    withPortalDom(() => {
      const idleRenderer = mount({ isSearching: false });
      try {
        // The idle (magnifier) icon draws a circle lens; the spinner does not.
        assert.equal(idleRenderer.root.findAllByType("circle").length, 1);
      } finally {
        act(() => idleRenderer.unmount());
      }

      const searchingRenderer = mount({ isSearching: true });
      try {
        assert.equal(searchingRenderer.root.findAllByType("circle").length, 0);
      } finally {
        act(() => searchingRenderer.unmount());
      }
    });
  });

  test("omits the tag filter entirely when there are no available tags", () => {
    withPortalDom(() => {
      const renderer = mount({ availableTags: [] });
      try {
        assert.throws(() =>
          renderer.root.findByProps({ "aria-label": "Filter by tag" }),
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("choosing a tag from the filter calls setTag with its slug", () => {
    withPortalDom(() => {
      const calls: (string | null)[] = [];
      const renderer = mount({ setTag: (tag) => calls.push(tag) });
      try {
        chooseOption(renderer, "Filter by tag", "Notes");
        assert.deepEqual(calls, ["notes"]);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("choosing 'All tags' calls setTag with null", () => {
    withPortalDom(() => {
      const calls: (string | null)[] = [];
      const renderer = mount({
        selectedTag: "roadmap",
        setTag: (tag) => calls.push(tag),
      });
      try {
        chooseOption(renderer, "Filter by tag", "All tags");
        assert.deepEqual(calls, [null]);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("the Favorites toggle reflects the current view and flips it on click", () => {
    withPortalDom(() => {
      const calls: ViewKey[] = [];
      const renderer = mount({
        view: "all",
        setView: (view) => calls.push(view),
      });
      try {
        const toggle = renderer.root.findByProps({
          "aria-label": "Show favorites only",
        });
        assert.equal(toggle.props["aria-pressed"], false);
        act(() => {
          (toggle.props.onClick as () => void)();
        });
        assert.deepEqual(calls, ["favorites"]);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("the Favorites toggle shows pressed state and flips back to all", () => {
    withPortalDom(() => {
      const calls: ViewKey[] = [];
      const renderer = mount({
        view: "favorites",
        setView: (view) => calls.push(view),
      });
      try {
        const toggle = renderer.root.findByProps({
          "aria-label": "Show favorites only",
        });
        assert.equal(toggle.props["aria-pressed"], true);
        act(() => {
          (toggle.props.onClick as () => void)();
        });
        assert.deepEqual(calls, ["all"]);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("choosing a sort option calls setSort with the chosen key", () => {
    withPortalDom(() => {
      const calls: SortKey[] = [];
      const renderer = mount({ setSort: (sort) => calls.push(sort) });
      try {
        chooseOption(renderer, "Sort documents", "Title (A–Z)");
        assert.deepEqual(calls, ["title"]);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });
});
