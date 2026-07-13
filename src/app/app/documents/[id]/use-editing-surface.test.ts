/**
 * Direct contracts for `useEditingSurface` (#1946), the React bridge in front
 * of the pure {@link resolveEditingSurface} decision (already exhaustively
 * pinned by `editing-surface.test.ts`).
 *
 * This file exercises exactly the wiring the bridge adds on top of that pure
 * decision:
 * - Gathers `pointerFine` from `useIsPointerFine` (via `window.matchMedia`).
 * - Derives `contextSelectionKind` from the real `useEditorContext` snapshot
 *   (a live `@lexical/headless` editor, matching `editor-context.test.ts`'s
 *   pattern for range/table/visual selections).
 * - Layers two overrides on top of that context-derived kind, in precedence
 *   order: `activeVisual` (bridged from `VisualPanelProvider`) beats a live
 *   `"range"` selection, which beats the caption-focus bridge
 *   (`useActiveTableCaptionKey`, exercised on its own in
 *   `use-active-table-caption.test.ts`), which beats the raw context kind.
 *
 * Mounted directly with `react-test-renderer`'s `act`/`create` (not the
 * shared harness's `run()`, which never commits what it builds and so cannot
 * propagate `LexicalComposerContext`/`VisualPanelProvider` to a nested
 * consumer) — same rationale as `editor-context-provider.test.ts`. Importing
 * `@/test/react-render-harness` is for its module-level side effect only: it
 * flips on `IS_REACT_ACT_ENVIRONMENT`. `installPersistentDefaultDom` installs
 * the baseline `document`/`window` stubs `EditorContextProvider`'s effect
 * depends on, persistently for this file's lifetime.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { createHeadlessEditor } from "@lexical/headless";
import {
  createLexicalComposerContext,
  LexicalComposerContext,
  type LexicalComposerContextWithEditor,
} from "@lexical/react/LexicalComposerContext";
import {
  $createNodeSelection,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $setSelection,
  type LexicalEditor,
} from "lexical";
import {
  $createTableNodeWithDimensions,
  $isTableCellNode,
  $isTableRowNode,
  TableCellNode,
  TableNode,
  TableRowNode,
} from "@lexical/table";

import { FIXTURES } from "@/lib/visual/fixtures";
import { $createVisualNode, VisualNode } from "@/lib/lexical/visual-node";
import { EditorContextProvider } from "@/lib/lexical/editor-context";

// Side effect only: flips `IS_REACT_ACT_ENVIRONMENT` on; also installs the
// baseline `document`/`window` stubs `EditorContextProvider`'s effect needs,
// persistently for this file's lifetime.
import { installPersistentDefaultDom } from "@/test/react-render-harness";

import { useEditingSurface } from "./use-editing-surface";
import { useVisualPanel, VisualPanelProvider } from "./visual-panel-context";
import type { ResolvedEditingSurface } from "@/lib/lexical/editing-surface";

installPersistentDefaultDom();

/**
 * `useActiveTableCaptionKey` (used internally by `useEditingSurface`) checks
 * `document.activeElement instanceof HTMLElement`; a bare `HTMLElement`
 * reference throws a `ReferenceError` under Node unless a global is
 * installed, even when the check would resolve to `false`. Every test in
 * this file mounts the full hook tree, so the fake is installed once for the
 * whole suite (individual caption-bridge tests further customize
 * `document.activeElement`, not the class itself).
 */
const previousHTMLElement = Object.getOwnPropertyDescriptor(
  globalThis,
  "HTMLElement",
);
class FakeCaptionElement {
  constructor(
    public readonly dataset: Record<string, string> = {},
    private readonly ancestorMatch: FakeCaptionElement | null = null,
  ) {}

  closest(selector: string): FakeCaptionElement | null {
    return selector === "[data-document-table-caption-input]"
      ? this.ancestorMatch
      : null;
  }
}
Object.defineProperty(globalThis, "HTMLElement", {
  configurable: true,
  writable: true,
  value: FakeCaptionElement,
});
after(() => {
  if (previousHTMLElement) {
    Object.defineProperty(globalThis, "HTMLElement", previousHTMLElement);
  } else {
    Reflect.deleteProperty(globalThis, "HTMLElement");
  }
});

function makeEditor(): LexicalEditor {
  const editor = createHeadlessEditor({
    namespace: "use-editing-surface-test",
    nodes: [TableNode, TableRowNode, TableCellNode, VisualNode],
    onError(error) {
      throw error;
    },
  });
  editor.getRootElement = (() => null) as typeof editor.getRootElement;
  editor.getElementByKey = (() => null) as typeof editor.getElementByKey;
  return editor;
}

type SetActiveVisual = ReturnType<typeof useVisualPanel>["setActiveVisual"];

type Mounted = {
  latest(): ResolvedEditingSurface;
  setActiveVisual(active: { nodeKey: string; visualId: string } | null): void;
  unmount(): void;
};

function mountSurface(editor: LexicalEditor): Mounted {
  const composerContext: LexicalComposerContextWithEditor = [
    editor,
    createLexicalComposerContext(null, null),
  ];
  const seen: ResolvedEditingSurface[] = [];
  let setActiveVisual: SetActiveVisual | undefined;

  function Inner() {
    seen.push(useEditingSurface());
    setActiveVisual = useVisualPanel().setActiveVisual;
    return null;
  }

  let renderer: ReactTestRenderer | null = null;
  act(() => {
    renderer = create(
      createElement(
        LexicalComposerContext.Provider,
        { value: composerContext },
        createElement(
          EditorContextProvider,
          null,
          createElement(VisualPanelProvider, null, createElement(Inner)),
        ),
      ),
    );
  });

  return {
    latest: () => {
      assert.ok(seen.length > 0, "expected the surface to have rendered");
      return seen[seen.length - 1] as ResolvedEditingSurface;
    },
    setActiveVisual: (active) => {
      act(() => {
        assert.ok(setActiveVisual, "expected setActiveVisual to be captured");
        setActiveVisual?.(active);
      });
    },
    unmount: () => {
      act(() => {
        renderer?.unmount();
      });
    },
  };
}

function withMatchMedia<T>(matches: boolean, run: () => T): T {
  const fakeWindow = globalThis.window as unknown as {
    matchMedia: (query: string) => {
      matches: boolean;
      addEventListener: () => void;
      removeEventListener: () => void;
    };
  };
  const original = fakeWindow.matchMedia;
  fakeWindow.matchMedia = () => ({
    matches,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
  try {
    return run();
  } finally {
    fakeWindow.matchMedia = original;
  }
}

function withActiveElement<T>(activeElement: unknown, run: () => T): T {
  const fakeDocument = globalThis.document as { activeElement?: unknown };
  const previous = fakeDocument.activeElement;
  fakeDocument.activeElement = activeElement;
  try {
    return run();
  } finally {
    fakeDocument.activeElement = previous;
  }
}

// ---------------------------------------------------------------------------
// Document-level default (no selection) — mode is always "none"
// ---------------------------------------------------------------------------

test("no selection resolves to mode 'none' / group 'overall' regardless of pointer", () => {
  const mounted = mountSurface(makeEditor());
  try {
    withMatchMedia(true, () => {
      assert.deepEqual(mounted.latest(), { mode: "none", group: "overall" });
    });
  } finally {
    mounted.unmount();
  }
});

// ---------------------------------------------------------------------------
// Range selection — floats on fine pointers, sheets on coarse
// ---------------------------------------------------------------------------

test("a non-collapsed text range resolves to 'float'/'text-format' on a fine pointer", () => {
  const editor = makeEditor();
  const mounted = withMatchMedia(true, () => mountSurface(editor));
  try {
    act(() => {
      editor.update(
        () => {
          const paragraph = $createParagraphNode();
          const text = $createTextNode("Selected range");
          paragraph.append(text);
          $getRoot().clear().append(paragraph);
          text.select(0, 5);
        },
        { discrete: true },
      );
    });

    assert.deepEqual(mounted.latest(), {
      mode: "float",
      group: "text-format",
    });
  } finally {
    mounted.unmount();
  }
});

test("a non-collapsed text range resolves to 'sheet'/'text-format' on a coarse pointer", () => {
  const editor = makeEditor();
  const mounted = withMatchMedia(false, () => mountSurface(editor));
  try {
    act(() => {
      editor.update(
        () => {
          const paragraph = $createParagraphNode();
          const text = $createTextNode("Selected range");
          paragraph.append(text);
          $getRoot().clear().append(paragraph);
          text.select(0, 5);
        },
        { discrete: true },
      );
    });

    assert.deepEqual(mounted.latest(), {
      mode: "sheet",
      group: "text-format",
    });
  } finally {
    mounted.unmount();
  }
});

// ---------------------------------------------------------------------------
// Native table selection (collapsed caret inside a table)
// ---------------------------------------------------------------------------

test("a collapsed caret inside a table resolves to group 'table-edit'", () => {
  const editor = makeEditor();
  const mounted = withMatchMedia(true, () => mountSurface(editor));
  try {
    act(() => {
      editor.update(
        () => {
          const table = $createTableNodeWithDimensions(2, 2, true);
          $getRoot().clear().append(table);
          const row = table.getFirstChild();
          assert.ok(row && $isTableRowNode(row));
          const cell = row.getFirstChild();
          assert.ok(cell && $isTableCellNode(cell));
          cell.selectStart();
        },
        { discrete: true },
      );
    });

    assert.deepEqual(mounted.latest(), { mode: "float", group: "table-edit" });
  } finally {
    mounted.unmount();
  }
});

// ---------------------------------------------------------------------------
// Selected visual decorator (via the real editor context, no override needed)
// ---------------------------------------------------------------------------

test("a selected VisualNode resolves to group 'visual-edit' via the editor context alone", () => {
  const editor = makeEditor();
  const mounted = withMatchMedia(true, () => mountSurface(editor));
  try {
    act(() => {
      editor.update(
        () => {
          const visual = $createVisualNode(FIXTURES.flowchart, "vis-1");
          $getRoot().clear().append(visual);
          const selection = $createNodeSelection();
          selection.add(visual.getKey());
          $setSelection(selection);
        },
        { discrete: true },
      );
    });

    assert.deepEqual(mounted.latest(), {
      mode: "float",
      group: "visual-edit",
    });
  } finally {
    mounted.unmount();
  }
});

// ---------------------------------------------------------------------------
// VisualPanel override — activeVisual beats every other selection signal
// ---------------------------------------------------------------------------

test("VisualPanel's activeVisual overrides a live text-range selection to 'visual-edit'", () => {
  const editor = makeEditor();
  const mounted = withMatchMedia(true, () => mountSurface(editor));
  try {
    act(() => {
      editor.update(
        () => {
          const paragraph = $createParagraphNode();
          const text = $createTextNode("Range still active");
          paragraph.append(text);
          $getRoot().clear().append(paragraph);
          text.select(0, 5);
        },
        { discrete: true },
      );
    });
    assert.equal(mounted.latest().group, "text-format");

    mounted.setActiveVisual({ nodeKey: "node-1", visualId: "vis-1" });

    assert.deepEqual(mounted.latest(), {
      mode: "float",
      group: "visual-edit",
    });

    // Clearing the active visual falls back to the still-live range selection.
    mounted.setActiveVisual(null);
    assert.equal(mounted.latest().group, "text-format");
  } finally {
    mounted.unmount();
  }
});

// ---------------------------------------------------------------------------
// Caption-focus bridge — useActiveTableCaptionKey forces "table" when the
// editor context itself has no selection kind of its own.
// ---------------------------------------------------------------------------

test("a focused table-caption input bridges to group 'table-edit' when the editor context has no selection", () => {
  const input = new FakeCaptionElement({ tableKey: "table-9" });
  const active = new FakeCaptionElement({}, input);

  const mounted = withActiveElement(active, () =>
    withMatchMedia(true, () => mountSurface(makeEditor())),
  );
  try {
    assert.deepEqual(mounted.latest(), {
      mode: "float",
      group: "table-edit",
    });
  } finally {
    mounted.unmount();
  }
});

test("a live text range wins over the caption-focus bridge", () => {
  const input = new FakeCaptionElement({ tableKey: "table-9" });
  const active = new FakeCaptionElement({}, input);
  const editor = makeEditor();

  const mounted = withActiveElement(active, () =>
    withMatchMedia(true, () => mountSurface(editor)),
  );
  try {
    act(() => {
      editor.update(
        () => {
          const paragraph = $createParagraphNode();
          const text = $createTextNode("Wins over caption");
          paragraph.append(text);
          $getRoot().clear().append(paragraph);
          text.select(0, 5);
        },
        { discrete: true },
      );
    });

    assert.deepEqual(mounted.latest(), {
      mode: "float",
      group: "text-format",
    });
  } finally {
    mounted.unmount();
  }
});
