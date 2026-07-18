/**
 * Direct behavior coverage for the React-wiring layer of `table-controls.tsx`
 * (#1958): `TableEditingSection`, `FloatingTableToolbar`, and the shared
 * `TableEditingControls` toolbar (state derivation, roving-tabindex keyboard
 * nav, row/column/header mutations, disabled states, and the
 * `window.confirm`-gated delete-table action).
 *
 * The pure Lexical mutation layer this composes (`runDocumentTableControl`,
 * `$getSelectedDocumentTableState`, etc.) is already exhaustively pinned by
 * `src/lib/lexical/table-controls.test.ts`; this file reuses that module's
 * real (not mocked) functions and instead exercises exactly what the
 * component adds on top: `useTableControlState`'s selection-driven
 * recompute, `useToolbarRovingFocus`'s DOM-derived roving tabindex,
 * `TableMoreMenu`'s confirm-gated delete, and `FloatingTableToolbar`'s
 * `useEditingSurface`-driven visibility gate (already exhaustively pinned as
 * pure decision logic by `editing-surface.test.ts` and as a hook bridge by
 * `use-editing-surface.test.ts` — reused here as real dependencies, not
 * re-derived).
 *
 * Every mutation button here dispatches through the real
 * `runDocumentTableControl`, whose internal `editor.update()` is not
 * `{discrete: true}`; every assertion of resulting Lexical state or a
 * re-rendered label follows the same `flushEditor(editor)` convention
 * established in `insert-menu.test.tsx`.
 *
 * `TableEditingControls`'s toolbar `<div>` is never portalled (unlike
 * `FloatingSurface`'s children), so its ref resolves through the
 * `createNodeMock` option passed directly to `mount()` — no
 * `document.body.createNodeMock` proxying is needed here, unlike
 * `floating-text-toolbar.test.tsx`'s roving-focus test (whose toolbar *is*
 * portalled). Per the AnimatePresence caveat documented in
 * `insert-menu.test.tsx`, no test here asserts a floating/popover surface
 * "disappears" within one continuously-mounted render; closes are asserted
 * via their real side effect instead (a `window.confirm`/`editor.focus` spy,
 * or real Lexical state).
 */
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { createElement, type ReactElement } from "react";
import {
  act,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";

import { LexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createTableNodeWithDimensions,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  TableCellNode,
  TableNode,
  TableRowNode,
} from "@lexical/table";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type LexicalEditor,
} from "lexical";

import { EditorContextProvider } from "@/lib/lexical/editor-context";
import {
  $getDocumentTableStateForKey,
  type DocumentTableControlState,
} from "@/lib/lexical/table-controls";

import {
  composerContextFor,
  flushEditor,
  installFakeDom,
  makeHeadlessEditor,
  mount,
  textOf,
  unmount,
  withMatchMedia,
} from "@/test/lexical-component-harness";

import { FloatingTableToolbar, TableEditingSection } from "./table-controls";
import { VisualPanelProvider } from "./visual-panel-context";

function makeEditor(): LexicalEditor {
  const editor = makeHeadlessEditor({
    namespace: "table-controls-test",
    nodes: [TableNode, TableRowNode, TableCellNode],
  });
  editor.focus = (() => undefined) as typeof editor.focus;
  return editor;
}

function tableNode() {
  const node = $getRoot().getFirstChild();
  assert.ok(node && $isTableNode(node), "expected first node to be a table");
  return node;
}

function cellAt(rowIndex: number, columnIndex: number) {
  const row = tableNode().getChildAtIndex(rowIndex);
  assert.ok(row && $isTableRowNode(row), "expected table row");
  const cell = row.getChildAtIndex(columnIndex);
  assert.ok(cell && $isTableCellNode(cell), "expected table cell");
  return cell;
}

/** Builds a real table (no header row by default) and selects a real cell. */
function seedTable(
  editor: LexicalEditor,
  rows: string[][],
  options: {
    headerRow?: boolean;
    selectRow?: number;
    selectColumn?: number;
  } = {},
): void {
  editor.update(
    () => {
      const table = $createTableNodeWithDimensions(
        rows.length,
        rows[0]?.length ?? 1,
        options.headerRow ?? false,
      );
      $getRoot().clear().append(table);
      for (const [rowIndex, row] of rows.entries()) {
        for (const [columnIndex, text] of row.entries()) {
          const cell = cellAt(rowIndex, columnIndex);
          cell.clear();
          cell.append($createParagraphNode().append($createTextNode(text)));
        }
      }
      cellAt(options.selectRow ?? 0, options.selectColumn ?? 0).selectStart();
    },
    { discrete: true },
  );
}

function readTableState(
  editor: LexicalEditor,
  tableKey: string,
): DocumentTableControlState | null {
  return editor
    .getEditorState()
    .read(() => $getDocumentTableStateForKey(tableKey));
}

function seededTableKey(editor: LexicalEditor): string {
  return editor.getEditorState().read(() => tableNode().getKey());
}

function mountSection(
  editor: LexicalEditor,
  createNodeMock?: (element: ReactElement) => unknown,
): ReactTestRenderer {
  return mount(
    createElement(
      LexicalComposerContext.Provider,
      { value: composerContextFor(editor) },
      createElement(TableEditingSection),
    ),
    createNodeMock ? { createNodeMock } : undefined,
  );
}

function mountFloatingToolbar(
  editor: LexicalEditor,
  editable: boolean,
): ReactTestRenderer {
  return mount(
    createElement(
      LexicalComposerContext.Provider,
      { value: composerContextFor(editor) },
      createElement(
        EditorContextProvider,
        null,
        createElement(
          VisualPanelProvider,
          null,
          createElement(FloatingTableToolbar, { editable }),
        ),
      ),
    ),
  );
}

function findToolbars(renderer: ReactTestRenderer): ReactTestInstance[] {
  return renderer.root.findAll(
    (instance) =>
      typeof instance.type === "string" && instance.props.role === "toolbar",
  );
}

function findButtonByLabel(
  renderer: ReactTestRenderer,
  label: string,
): ReactTestInstance {
  return renderer.root.find(
    (instance) =>
      instance.type === "button" && instance.props["aria-label"] === label,
  );
}

function findButtonsByText(
  renderer: ReactTestRenderer,
  text: string,
): ReactTestInstance[] {
  return renderer.root.findAll(
    (instance) => instance.type === "button" && textOf(instance).includes(text),
  );
}

/**
 * `Popover`'s open-tracking effect calls `window.requestAnimationFrame` in a
 * self-scheduling loop (`reposition(); requestAnimationFrame(trackPosition)`)
 * to keep the panel pinned while the page scrolls/resizes. The shared
 * harness's fake `requestAnimationFrame` invokes its callback synchronously
 * (there is no real frame clock here), so left alone this loop recurses
 * forever and blows the stack. None of these tests assert pixel-level
 * positioning (matching every other file in this subsystem), so it's safe to
 * swap in a no-op that never invokes its callback for the duration of a
 * popover-opening test.
 */
function withoutAnimationFrameLoop<T>(run: () => T): T {
  const win = globalThis.window as unknown as {
    requestAnimationFrame: (callback: FrameRequestCallback) => number;
  };
  const original = win.requestAnimationFrame;
  win.requestAnimationFrame = () => 0;
  try {
    return run();
  } finally {
    win.requestAnimationFrame = original;
  }
}

describe("TableEditingSection", () => {
  let restoreDom: (() => void) | null = null;
  let renderer: ReactTestRenderer | null = null;

  afterEach(() => {
    if (renderer) {
      unmount(renderer);
      renderer = null;
    }
    if (restoreDom) {
      restoreDom();
      restoreDom = null;
    }
  });

  test("renders nothing when no table is selected", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    editor.update(
      () => {
        $getRoot()
          .clear()
          .append($createParagraphNode().append($createTextNode("Hello")));
      },
      { discrete: true },
    );
    renderer = mountSection(editor);
    assert.equal(findToolbars(renderer).length, 0);
  });

  test("renders the real toolbar with a size label for a real table selection", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    seedTable(editor, [
      ["Region", "ARR"],
      ["NA", "$12M"],
    ]);
    renderer = mountSection(editor);
    const toolbars = findToolbars(renderer);
    assert.equal(toolbars.length, 1);
    assert.equal(toolbars[0]?.props["aria-label"], "Table editing");
    const label = renderer.root.find(
      (instance) =>
        instance.type === "span" &&
        instance.props["aria-label"] === "2 rows by 2 columns",
    );
    assert.equal(textOf(label), "2 × 2");
    assert.ok(findButtonByLabel(renderer, "Add row below"));
    assert.ok(findButtonByLabel(renderer, "Add column right"));
    assert.ok(findButtonByLabel(renderer, "Mark first row as header"));
  });

  test("delete row/column are disabled on a single row/column table and enabled otherwise", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    seedTable(editor, [["Only cell"]]);
    renderer = mountSection(editor);
    assert.equal(
      findButtonByLabel(renderer, "Delete row").props.disabled,
      true,
    );
    assert.equal(
      findButtonByLabel(renderer, "Delete column").props.disabled,
      true,
    );

    unmount(renderer);
    seedTable(editor, [
      ["A", "B"],
      ["C", "D"],
    ]);
    renderer = mountSection(editor);
    assert.equal(
      findButtonByLabel(renderer, "Delete row").props.disabled,
      false,
    );
    assert.equal(
      findButtonByLabel(renderer, "Delete column").props.disabled,
      false,
    );
  });

  test("Add row below inserts a real row, and Delete row removes one", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    seedTable(editor, [
      ["A", "B"],
      ["C", "D"],
    ]);
    const tableKey = seededTableKey(editor);
    renderer = mountSection(editor);

    act(() => {
      findButtonByLabel(
        renderer as ReactTestRenderer,
        "Add row below",
      ).props.onClick();
    });
    flushEditor(editor);
    assert.equal(readTableState(editor, tableKey)?.rows, 3);

    act(() => {
      findButtonByLabel(
        renderer as ReactTestRenderer,
        "Delete row",
      ).props.onClick();
    });
    flushEditor(editor);
    assert.equal(readTableState(editor, tableKey)?.rows, 2);
  });

  test("Add column right inserts a real column, and Delete column removes one", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    seedTable(editor, [
      ["A", "B"],
      ["C", "D"],
    ]);
    const tableKey = seededTableKey(editor);
    renderer = mountSection(editor);

    act(() => {
      findButtonByLabel(
        renderer as ReactTestRenderer,
        "Add column right",
      ).props.onClick();
    });
    flushEditor(editor);
    assert.equal(readTableState(editor, tableKey)?.columns, 3);

    act(() => {
      findButtonByLabel(
        renderer as ReactTestRenderer,
        "Delete column",
      ).props.onClick();
    });
    flushEditor(editor);
    assert.equal(readTableState(editor, tableKey)?.columns, 2);
  });

  test("the header-row toggle flips real headerRow state and its own label", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    seedTable(
      editor,
      [
        ["A", "B"],
        ["C", "D"],
      ],
      { headerRow: false },
    );
    const tableKey = seededTableKey(editor);
    renderer = mountSection(editor);
    assert.equal(readTableState(editor, tableKey)?.headerRow, false);
    assert.ok(findButtonByLabel(renderer, "Mark first row as header"));

    act(() => {
      findButtonByLabel(
        renderer as ReactTestRenderer,
        "Mark first row as header",
      ).props.onClick();
      // Needs to run inside the same `act()` as the click: the component's
      // `headerRow`-flipped label only depends on `useTableControlState`'s
      // own `setState` (from its `registerUpdateListener`), which fires when
      // `runDocumentTableControl`'s non-discrete `editor.update()` actually
      // commits — forced synchronously here by `flushEditor`. Calling it
      // *outside* `act()` (as in `insert-menu.test.tsx`, which only reads
      // `editor.getEditorState()` afterward) would still flip the real
      // Lexical state, but the resulting React re-render wouldn't be
      // guaranteed to have committed to the fiber tree before the next
      // assertion below inspects it.
      flushEditor(editor);
    });
    assert.equal(readTableState(editor, tableKey)?.headerRow, true);
    assert.ok(
      findButtonByLabel(renderer as ReactTestRenderer, "Remove header row"),
      "expected the button label to flip once headerRow is true",
    );
  });

  test("delete-table is gated behind window.confirm: cancel keeps the table, confirm removes it", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    seedTable(editor, [
      ["A", "B"],
      ["C", "D"],
    ]);
    renderer = mountSection(editor);

    const originalConfirm = globalThis.window.confirm;
    let confirmCalls = 0;
    let confirmReturn = false;
    (
      globalThis.window as unknown as { confirm: typeof window.confirm }
    ).confirm = ((message?: string) => {
      confirmCalls += 1;
      assert.equal(message, "Delete table?");
      return confirmReturn;
    }) as typeof window.confirm;

    try {
      withoutAnimationFrameLoop(() => {
        act(() => {
          findButtonByLabel(
            renderer as ReactTestRenderer,
            "More table actions",
          ).props.onClick();
        });
      });
      act(() => {
        findButtonsByText(
          renderer as ReactTestRenderer,
          "Delete table",
        )[0]?.props.onClick();
      });
      assert.equal(confirmCalls, 1, "expected window.confirm to be called");
      flushEditor(editor);
      const stillHasTable = editor
        .getEditorState()
        .read(() => $isTableNode($getRoot().getFirstChild()));
      assert.equal(stillHasTable, true, "cancel should not delete the table");

      confirmReturn = true;
      withoutAnimationFrameLoop(() => {
        act(() => {
          findButtonByLabel(
            renderer as ReactTestRenderer,
            "More table actions",
          ).props.onClick();
        });
      });
      act(() => {
        findButtonsByText(
          renderer as ReactTestRenderer,
          "Delete table",
        )[0]?.props.onClick();
      });
      assert.equal(confirmCalls, 2);
      flushEditor(editor);
      const hasTableAfterConfirm = editor
        .getEditorState()
        .read(() => $isTableNode($getRoot().getFirstChild()));
      assert.equal(
        hasTableAfterConfirm,
        false,
        "confirm should really delete the table",
      );
    } finally {
      (
        globalThis.window as unknown as { confirm: typeof window.confirm }
      ).confirm = originalConfirm;
    }
  });

  test("roving tabindex: ArrowRight/Home/End move across real non-disabled buttons, Escape returns focus to the editor", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    let editorFocusCalls = 0;
    editor.focus = (() => {
      editorFocusCalls += 1;
    }) as typeof editor.focus;
    // Single-row/column table: Delete row and Delete column stay disabled,
    // so `querySelectorAll("button:not(:disabled)")` should skip them.
    seedTable(editor, [["Only cell"]]);

    let renderedRoot: ReactTestRenderer["root"] | null = null;
    const wrappers = new Map<
      unknown,
      { tabIndex: number; focus: () => void }
    >();
    function wrapperFor(instance: unknown) {
      let wrapper = wrappers.get(instance);
      if (!wrapper) {
        wrapper = {
          tabIndex: -1,
          focus: () => {
            (
              globalThis.document as unknown as { activeElement: unknown }
            ).activeElement = wrapper;
          },
        };
        wrappers.set(instance, wrapper);
      }
      return wrapper;
    }

    renderer = mountSection(editor, (element) => {
      const props = element.props as Record<string, unknown>;
      if (
        element.type === "div" &&
        typeof props.onKeyDown === "function" &&
        typeof props.onFocus === "function"
      ) {
        return {
          querySelectorAll: (selector: string) => {
            if (selector !== "button:not(:disabled)" || !renderedRoot)
              return [];
            return renderedRoot
              .findAll((i) => i.type === "button" && !i.props.disabled)
              .map(wrapperFor);
          },
        };
      }
      return null;
    });
    renderedRoot = renderer.root;

    const toolbar = renderer.root.find(
      (instance) =>
        typeof instance.type === "string" && instance.props.role === "toolbar",
    );
    const nonDisabledButtons = renderer.root.findAll(
      (i) => i.type === "button" && !i.props.disabled,
    );
    assert.ok(
      nonDisabledButtons.length > 0 &&
        nonDisabledButtons.every((b) => !b.props.disabled),
    );

    let prevented = false;
    act(() => {
      toolbar.props.onKeyDown({
        key: "ArrowRight",
        preventDefault: () => {
          prevented = true;
        },
      });
    });
    assert.equal(prevented, true, "expected ArrowRight to be handled");
    assert.equal(
      globalThis.document.activeElement,
      wrapperFor(nonDisabledButtons[0]),
      "ArrowRight from no active item should focus the first item",
    );

    act(() => {
      toolbar.props.onKeyDown({
        key: "End",
        preventDefault: () => undefined,
      });
    });
    assert.equal(
      globalThis.document.activeElement,
      wrapperFor(nonDisabledButtons[nonDisabledButtons.length - 1]),
      "End should focus the last non-disabled item",
    );

    act(() => {
      toolbar.props.onKeyDown({
        key: "Home",
        preventDefault: () => undefined,
      });
    });
    assert.equal(
      globalThis.document.activeElement,
      wrapperFor(nonDisabledButtons[0]),
      "Home should focus the first item",
    );

    act(() => {
      toolbar.props.onKeyDown({
        key: "Escape",
        preventDefault: () => undefined,
      });
    });
    assert.equal(editorFocusCalls, 1, "Escape should call editor.focus() once");
  });
});

describe("FloatingTableToolbar", () => {
  let restoreDom: (() => void) | null = null;
  let renderer: ReactTestRenderer | null = null;

  afterEach(() => {
    if (renderer) {
      unmount(renderer);
      renderer = null;
    }
    if (restoreDom) {
      restoreDom();
      restoreDom = null;
    }
  });

  test("stays hidden with no table selected, even editable on a fine pointer", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    editor.update(
      () => {
        $getRoot()
          .clear()
          .append($createParagraphNode().append($createTextNode("Hello")));
      },
      { discrete: true },
    );
    withMatchMedia(true, () => {
      renderer = mountFloatingToolbar(editor, true);
    });
    assert.equal(findToolbars(renderer as ReactTestRenderer).length, 0);
  });

  test("stays hidden when not editable, even with a real table selection on a fine pointer", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    seedTable(editor, [
      ["A", "B"],
      ["C", "D"],
    ]);
    withMatchMedia(true, () => {
      renderer = mountFloatingToolbar(editor, false);
    });
    assert.equal(findToolbars(renderer as ReactTestRenderer).length, 0);
  });

  test("stays hidden on a coarse pointer, even editable with a real table selection", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    seedTable(editor, [
      ["A", "B"],
      ["C", "D"],
    ]);
    withMatchMedia(false, () => {
      renderer = mountFloatingToolbar(editor, true);
    });
    assert.equal(findToolbars(renderer as ReactTestRenderer).length, 0);
  });

  test("mounts exactly one named toolbar when table controls become visible", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    seedTable(editor, [
      ["A", "B"],
      ["C", "D"],
    ]);
    withMatchMedia(true, () => {
      renderer = mountFloatingToolbar(editor, true);
    });
    const toolbars = findToolbars(renderer as ReactTestRenderer);
    assert.equal(toolbars.length, 1);
    assert.equal(toolbars[0]?.props["aria-label"], "Table editing");
    const label = (renderer as ReactTestRenderer).root.find(
      (instance) =>
        instance.type === "span" &&
        instance.props["aria-label"] === "2 rows by 2 columns",
    );
    assert.equal(textOf(label), "2 × 2");
  });
});
