/**
 * Direct contract coverage for `TagControl` (#1961) — the document header's
 * tag chip editor: add (Enter or blur) with autocomplete suggestions,
 * remove, and error surfacing for either mutation.
 *
 * `addTag`/`removeTag` (`./tags-actions`) are already fully covered by
 * `tags-actions.test.ts`, so `"./tags-actions"` is stubbed via the shared
 * `@/test/module-stub` helper — this file only asserts *which* action
 * `TagControl` calls, with what arguments, and how it renders the result
 * (or a failure).
 *
 * `TagControl` renders no portal content (no `Dialog`/`Popover`/`Tooltip`),
 * so — unlike the other target files in this issue — it needs no
 * `@/test/portal-dom`; a plain `react-test-renderer` mount is enough.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { textOf, waitForAsyncDrain } from "@/test/render-text";
import { stubModule } from "@/test/module-stub";
import type { DocumentTag } from "@/lib/document/tags";

type TagsActionsTestState = {
  addCalls: Array<{ documentId: string; name: string }>;
  removeCalls: Array<{ documentId: string; tagId: string }>;
  addImpl: (documentId: string, name: string) => Promise<DocumentTag[]>;
  removeImpl: (documentId: string, tagId: string) => Promise<DocumentTag[]>;
};
const globalForActions = globalThis as typeof globalThis & {
  __tagControlActionsTestState: TagsActionsTestState;
};

function resetActionsState(): void {
  globalForActions.__tagControlActionsTestState = {
    addCalls: [],
    removeCalls: [],
    addImpl: async () => [],
    removeImpl: async () => [],
  };
}
resetActionsState();

stubModule(
  "./tags-actions",
  `module.exports = {
  addTag: async (documentId, name) => {
    const s = globalThis.__tagControlActionsTestState;
    s.addCalls.push({ documentId, name });
    return s.addImpl(documentId, name);
  },
  removeTag: async (documentId, tagId) => {
    const s = globalThis.__tagControlActionsTestState;
    s.removeCalls.push({ documentId, tagId });
    return s.removeImpl(documentId, tagId);
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

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Dynamically imported (in `before`, after the `stubModule` call above)
// rather than statically at the top of this file: static imports of a
// whole dependency subtree resolve *before* any of this file's own
// top-level statements run, which would load the real `"use server"`
// `"./tags-actions"` instead of the stub.
let TagControl: typeof import("./tag-control").TagControl;
before(async () => {
  TagControl = (await import("./tag-control")).TagControl;
});

beforeEach(resetActionsState);

function tag(id: string, name: string): DocumentTag {
  return { id, name, slug: name.toLowerCase() };
}

function mount(overrides: {
  documentId?: string;
  initialTags?: DocumentTag[];
  allTags?: DocumentTag[];
  editable?: boolean;
}): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <TagControl
        documentId={overrides.documentId ?? "doc-1"}
        initialTags={overrides.initialTags ?? []}
        allTags={overrides.allTags ?? []}
        editable={overrides.editable}
      />,
    );
  });
  return renderer;
}

describe("TagControl", () => {
  test("renders each initial tag as a chip with a labelled remove button", () => {
    const renderer = mount({
      initialTags: [tag("t1", "Roadmap"), tag("t2", "Notes")],
    });
    try {
      assert.match(textOf(renderer.root), /Roadmap/);
      assert.match(textOf(renderer.root), /Notes/);
      assert.ok(
        renderer.root.findByProps({ "aria-label": "Remove tag Roadmap" }),
      );
      assert.ok(
        renderer.root.findByProps({ "aria-label": "Remove tag Notes" }),
      );
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("editable=false hides remove buttons and the add-tag input", () => {
    const renderer = mount({
      initialTags: [tag("t1", "Roadmap")],
      editable: false,
    });
    try {
      assert.match(textOf(renderer.root), /Roadmap/);
      assert.throws(() =>
        renderer.root.findByProps({ "aria-label": "Remove tag Roadmap" }),
      );
      assert.throws(() =>
        renderer.root.findByProps({ "aria-label": "Add a tag" }),
      );
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("the suggestions datalist lists allTags minus already-applied tags", () => {
    const renderer = mount({
      initialTags: [tag("t1", "Roadmap")],
      allTags: [tag("t1", "Roadmap"), tag("t2", "Notes"), tag("t3", "Ideas")],
    });
    try {
      const options = renderer.root.findAllByType("option");
      assert.deepEqual(
        options.map((option) => option.props.value),
        ["Notes", "Ideas"],
      );
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("pressing Enter with text commits addTag, clears the input immediately, and applies the returned tags", async () => {
    await (async () => {
      globalForActions.__tagControlActionsTestState.addImpl = async (
        _id,
        name,
      ) => [tag("new", name)];
      const renderer = mount({ documentId: "doc-7" });
      try {
        const input = renderer.root.findByProps({ "aria-label": "Add a tag" });
        act(() => {
          (input.props.onChange as (e: unknown) => void)({
            target: { value: "  Launch  " },
          });
        });
        act(() => {
          (input.props.onKeyDown as (e: unknown) => void)({
            key: "Enter",
            preventDefault: () => {},
          });
        });

        const inputAfter = renderer.root.findByProps({
          "aria-label": "Add a tag",
        });
        assert.equal(inputAfter.props.value, "");

        await act(async () => {
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });

        assert.deepEqual(
          globalForActions.__tagControlActionsTestState.addCalls,
          [{ documentId: "doc-7", name: "Launch" }],
        );
        assert.match(textOf(renderer.root), /Launch/);
      } finally {
        act(() => renderer.unmount());
      }
    })();
  });

  test("blurring the input with text also commits addTag", async () => {
    globalForActions.__tagControlActionsTestState.addImpl = async (
      _id,
      name,
    ) => [tag("new", name)];
    const renderer = mount({});
    try {
      const input = renderer.root.findByProps({ "aria-label": "Add a tag" });
      act(() => {
        (input.props.onChange as (e: unknown) => void)({
          target: { value: "Backlog" },
        });
      });
      act(() => {
        (input.props.onBlur as () => void)();
      });

      await act(async () => {
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });

      assert.deepEqual(globalForActions.__tagControlActionsTestState.addCalls, [
        { documentId: "doc-1", name: "Backlog" },
      ]);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("Enter/blur with only whitespace is a no-op — no addTag call", async () => {
    const renderer = mount({});
    try {
      const input = renderer.root.findByProps({ "aria-label": "Add a tag" });
      act(() => {
        (input.props.onChange as (e: unknown) => void)({
          target: { value: "   " },
        });
      });
      act(() => {
        (input.props.onKeyDown as (e: unknown) => void)({
          key: "Enter",
          preventDefault: () => {},
        });
      });
      act(() => {
        (
          renderer.root.findByProps({ "aria-label": "Add a tag" }).props
            .onBlur as () => void
        )();
      });

      await act(async () => {
        await waitForAsyncDrain();
      });

      assert.deepEqual(
        globalForActions.__tagControlActionsTestState.addCalls,
        [],
      );
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("a rejected addTag shows an alert and leaves the chip list unchanged", async () => {
    globalForActions.__tagControlActionsTestState.addImpl = async () => {
      throw new Error("boom");
    };
    const renderer = mount({ initialTags: [tag("t1", "Roadmap")] });
    try {
      const input = renderer.root.findByProps({ "aria-label": "Add a tag" });
      act(() => {
        (input.props.onChange as (e: unknown) => void)({
          target: { value: "Oops" },
        });
      });
      await act(async () => {
        (
          renderer.root.findByProps({ "aria-label": "Add a tag" }).props
            .onKeyDown as (e: unknown) => void
        )({ key: "Enter", preventDefault: () => {} });
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });

      assert.match(
        textOf(renderer.root.findByProps({ role: "alert" })),
        /Couldn't add tag/,
      );
      // The pre-existing chip is untouched; the failed tag never appears.
      assert.match(textOf(renderer.root), /Roadmap/);
      assert.doesNotMatch(textOf(renderer.root), /Oops/);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("removing a chip calls removeTag(documentId, tagId) and applies the returned tags", async () => {
    globalForActions.__tagControlActionsTestState.removeImpl = async () => [
      tag("t2", "Notes"),
    ];
    const renderer = mount({
      documentId: "doc-9",
      initialTags: [tag("t1", "Roadmap"), tag("t2", "Notes")],
    });
    try {
      const removeButton = renderer.root.findByProps({
        "aria-label": "Remove tag Roadmap",
      });
      act(() => {
        (removeButton.props.onClick as () => void)();
      });

      await act(async () => {
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });

      assert.deepEqual(
        globalForActions.__tagControlActionsTestState.removeCalls,
        [{ documentId: "doc-9", tagId: "t1" }],
      );
      assert.doesNotMatch(textOf(renderer.root), /Roadmap/);
      assert.match(textOf(renderer.root), /Notes/);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("a rejected removeTag shows an alert and leaves the chip in place", async () => {
    globalForActions.__tagControlActionsTestState.removeImpl = async () => {
      throw new Error("boom");
    };
    const renderer = mount({ initialTags: [tag("t1", "Roadmap")] });
    try {
      const removeButton = renderer.root.findByProps({
        "aria-label": "Remove tag Roadmap",
      });
      await act(async () => {
        (removeButton.props.onClick as () => void)();
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });

      assert.match(
        textOf(renderer.root.findByProps({ role: "alert" })),
        /Couldn't remove tag/,
      );
      assert.match(textOf(renderer.root), /Roadmap/);
    } finally {
      act(() => renderer.unmount());
    }
  });
});
