/**
 * Direct behavior coverage for `InsertMenuPlugin` (#1958).
 *
 * The plugin is a thin registry-driven renderer over already-independently
 * tested collaborators: `useEditorContext` (selection descriptor + DOM rects,
 * `editor-context-provider.test.ts`), `toolsFor`/`applyBlockInsert`/
 * `createVisualInsertRunner` (the real tool registry + mutation layer,
 * `tool-registry.test.ts` / `tool-mutations.test.ts`), and `FloatingSurface`
 * (shared UI primitive). This file exercises the menu's own contract:
 *
 *  - The "+" gutter button's visibility gating (fine pointer, editable,
 *    `kind === "empty-block"`, a measured block rect, not already open, no
 *    slash trigger) and that clicking it opens the "plus" menu.
 *  - "+"-mode keyboard nav (ArrowDown/Up/Enter via the listbox's own
 *    `onKeyDown`) and that Enter commits a real block transformation.
 *  - Slash-trigger detection straight from `ctx.blockText` (no click needed),
 *    query filtering via `matchesQuery`, and that slash-mode keyboard nav
 *    goes through registered Lexical key commands instead of DOM `onKeyDown`.
 *  - Committing a "Visuals" tool in slash mode replaces the trigger block
 *    with a clean empty paragraph *and* dispatches `INSERT_VISUAL_COMMAND`
 *    with the real `blockKey` as `afterNodeKey` (observed via a real
 *    registered command listener, not a mock).
 *  - A slash query matching no tool keeps the whole menu closed.
 *
 * `FloatingSurface`/the gutter button both animate open/close via a raw
 * `framer-motion` `AnimatePresence`; its *exit* transition never resolves
 * synchronously under `react-test-renderer` (no real animation-frame clock),
 * so — matching `floating-text-toolbar.test.tsx`'s precedent — this file
 * never asserts a "disappears after closing" transition within one
 * continuously-mounted render. Instead it asserts the discrete state that
 * *caused* the close (a real block/command result, or an `editor.focus`
 * spy), and only checks "not rendered at all" for trees that start that way.
 */
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { createElement } from "react";
import {
  act,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";

import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  COMMAND_PRIORITY_LOW,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  type LexicalEditor,
} from "lexical";
import { $isListNode, ListItemNode, ListNode } from "@lexical/list";
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import {
  $isHeadingNode,
  $isQuoteNode,
  HeadingNode,
  QuoteNode,
} from "@lexical/rich-text";
import {
  $isTableNode,
  TableCellNode,
  TableNode,
  TableRowNode,
} from "@lexical/table";
import { LexicalComposerContext } from "@lexical/react/LexicalComposerContext";

import { EditorContextProvider } from "@/lib/lexical/editor-context";
import { INSERT_VISUAL_COMMAND } from "@/lib/lexical/commands";
import { FloatingSurface } from "@/components/ui";

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

import { InsertMenuPlugin } from "./insert-menu";

function makeEditor(): LexicalEditor {
  const editor = makeHeadlessEditor({
    namespace: "insert-menu-test",
    nodes: [
      HeadingNode,
      QuoteNode,
      ListNode,
      ListItemNode,
      TableNode,
      TableRowNode,
      TableCellNode,
      HorizontalRuleNode,
    ],
  });
  // `commit()` (and `applyBlockInsert`) call `editor.focus()` after running
  // a tool; a real, unmounted browser editor tolerates this, but the
  // headless implementation throws. Default to a no-op; tests asserting on
  // focus (e.g. Escape) install their own counting override afterward.
  editor.focus = (() => undefined) as typeof editor.focus;
  return editor;
}

/** Replaces the document with a single paragraph, selected `[collapsed at end]`. */
function selectParagraph(editor: LexicalEditor, text: string): string {
  let blockKey = "";
  act(() => {
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        if (text !== "") {
          paragraph.append($createTextNode(text));
        }
        $getRoot().clear().append(paragraph);
        blockKey = paragraph.getKey();
        paragraph.selectEnd();
      },
      { discrete: true },
    );
  });
  return blockKey;
}

/**
 * The menu reads a measured block rect from `ctx.rects.block`
 * (`editor.getElementByKey(descriptor.blockKey)`) and the editor root rect
 * directly from `editor.getRootElement()` (for the gutter button / "plus"
 * menu left offset) — both return `null` in headless mode by default (see
 * `makeHeadlessEditor`), so real gating/positioning paths need a fake
 * measured element for the scope under test.
 */
function withElementRects(editor: LexicalEditor, run: () => void): void {
  const fakeBlockElement = {
    getBoundingClientRect: () => ({
      top: 100,
      left: 140,
      right: 340,
      bottom: 130,
      width: 200,
      height: 30,
    }),
  } as unknown as HTMLElement;
  const fakeRootElement = {
    getBoundingClientRect: () => ({
      top: 0,
      left: 140,
      right: 800,
      bottom: 600,
      width: 660,
      height: 600,
    }),
  } as unknown as HTMLElement;
  const originalGetElementByKey = editor.getElementByKey;
  const originalGetRootElement = editor.getRootElement;
  editor.getElementByKey = (() =>
    fakeBlockElement) as typeof editor.getElementByKey;
  editor.getRootElement = (() =>
    fakeRootElement) as typeof editor.getRootElement;
  try {
    run();
  } finally {
    editor.getElementByKey = originalGetElementByKey;
    editor.getRootElement = originalGetRootElement;
  }
}

function mountMenu(editor: LexicalEditor): ReactTestRenderer {
  return mount(
    createElement(
      LexicalComposerContext.Provider,
      { value: composerContextFor(editor) },
      createElement(
        EditorContextProvider,
        null,
        createElement(InsertMenuPlugin),
      ),
    ),
  );
}

// All finders return arrays (never a single raw `ReactTestInstance`), so
// callers assert on `.length`/`[0]` rather than passing a fiber-laden
// instance straight into `assert.equal` (whose failure-diff formatting of a
// large circular fiber tree can otherwise take a very long time).
function findGutterButtons(renderer: ReactTestRenderer): ReactTestInstance[] {
  return renderer.root.findAll(
    (instance) =>
      instance.type === "button" &&
      instance.props["aria-label"] === "Insert block",
  );
}

function findListboxes(renderer: ReactTestRenderer): ReactTestInstance[] {
  return renderer.root.findAll(
    (instance) =>
      typeof instance.type === "string" && instance.props.role === "listbox",
  );
}

function floatingSurfaceOpen(renderer: ReactTestRenderer): boolean {
  return renderer.root.findByType(FloatingSurface).props.open as boolean;
}

function findOptions(renderer: ReactTestRenderer): ReactTestInstance[] {
  return renderer.root.findAll(
    (instance) =>
      instance.type === "button" && instance.props.role === "option",
  );
}

function findOptionByLabel(
  renderer: ReactTestRenderer,
  label: string,
): ReactTestInstance | undefined {
  return findOptions(renderer).find((instance) =>
    textOf(instance).includes(label),
  );
}

describe("InsertMenuPlugin", () => {
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

  test("gutter button stays hidden with no selection at all", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    withElementRects(editor, () => {
      withMatchMedia(true, () => {
        renderer = mountMenu(editor);
      });
    });
    assert.equal(findGutterButtons(renderer as ReactTestRenderer).length, 0);
  });

  test("gutter button appears for an empty-block selection on a fine pointer, and hides on a coarse pointer", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    withElementRects(editor, () => {
      withMatchMedia(true, () => {
        renderer = mountMenu(editor);
      });
      selectParagraph(editor, "");
      assert.equal(findGutterButtons(renderer as ReactTestRenderer).length, 1);

      // Fresh remount with a coarse pointer (rather than toggling in place)
      // sidesteps the `AnimatePresence` exit-transition timing described
      // above and still directly exercises the `isPointerFine` gate.
      unmount(renderer as ReactTestRenderer);
      withMatchMedia(false, () => {
        renderer = mountMenu(editor);
      });
      selectParagraph(editor, "");
      assert.equal(findGutterButtons(renderer as ReactTestRenderer).length, 0);
    });
  });

  test("gutter button stays hidden without a measured block rect even on an empty block", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    withMatchMedia(true, () => {
      renderer = mountMenu(editor);
    });
    selectParagraph(editor, "");
    // No `withElementRects`: `editor.getElementByKey` stays null, so
    // `ctx.rects.block` stays null and the gutter button's own rect guard
    // keeps it hidden even though kind/editable/pointer all qualify.
    assert.equal(findGutterButtons(renderer as ReactTestRenderer).length, 0);
  });

  test("clicking the gutter button opens the plus menu with Text and Visuals sections", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    withElementRects(editor, () => {
      withMatchMedia(true, () => {
        renderer = mountMenu(editor);
      });
      selectParagraph(editor, "");
      const button = findGutterButtons(renderer as ReactTestRenderer)[0];
      assert.ok(button);
      act(() => {
        button.props.onClick();
      });

      assert.equal(findListboxes(renderer as ReactTestRenderer).length, 1);
      assert.equal(
        (renderer as ReactTestRenderer).root.findByType(FloatingSurface).props
          .layer,
        "canvas",
      );
      assert.ok(findOptionByLabel(renderer as ReactTestRenderer, "Heading 1"));
      assert.ok(findOptionByLabel(renderer as ReactTestRenderer, "Table"));
    });
  });

  test("plus menu: ArrowDown/ArrowUp move the active option", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    withElementRects(editor, () => {
      withMatchMedia(true, () => {
        renderer = mountMenu(editor);
      });
      selectParagraph(editor, "");
      const button = findGutterButtons(renderer as ReactTestRenderer)[0];
      act(() => {
        button.props.onClick();
      });

      const listbox = findListboxes(renderer as ReactTestRenderer)[0];
      assert.ok(listbox);
      const firstOption = findOptions(renderer as ReactTestRenderer)[0];
      assert.equal(firstOption.props["aria-selected"], true);

      act(() => {
        listbox.props.onKeyDown({ key: "ArrowDown", preventDefault() {} });
      });
      const afterDown = findOptions(renderer as ReactTestRenderer);
      assert.equal(afterDown[0].props["aria-selected"], false);
      assert.equal(afterDown[1].props["aria-selected"], true);

      act(() => {
        listbox.props.onKeyDown({ key: "ArrowUp", preventDefault() {} });
      });
      const afterUp = findOptions(renderer as ReactTestRenderer);
      assert.equal(afterUp[0].props["aria-selected"], true);
    });
  });

  test("plus menu: Escape closes the menu via editor.focus, without committing anything", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    let editorFocusCalls = 0;
    editor.focus = (() => {
      editorFocusCalls += 1;
    }) as typeof editor.focus;

    withElementRects(editor, () => {
      withMatchMedia(true, () => {
        renderer = mountMenu(editor);
      });
      selectParagraph(editor, "");
      const button = findGutterButtons(renderer as ReactTestRenderer)[0];
      act(() => {
        button.props.onClick();
      });
      const listbox = findListboxes(renderer as ReactTestRenderer)[0];

      act(() => {
        listbox.props.onKeyDown({ key: "Escape", preventDefault() {} });
      });

      assert.equal(editorFocusCalls, 1);
      // Escape never runs `tool.run`, so the document is untouched.
      const isStillPlainParagraph = editor.getEditorState().read(() => {
        const first = $getRoot().getFirstChild();
        return first !== null && first.getType() === "paragraph";
      });
      assert.ok(isStillPlainParagraph);
    });
  });

  test("plus menu: Enter commits the active Text tool as a real block transformation", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    withElementRects(editor, () => {
      withMatchMedia(true, () => {
        renderer = mountMenu(editor);
      });
      selectParagraph(editor, "");
      const button = findGutterButtons(renderer as ReactTestRenderer)[0];
      act(() => {
        button.props.onClick();
      });

      const listbox = findListboxes(renderer as ReactTestRenderer)[0];
      act(() => {
        listbox.props.onKeyDown({ key: "Enter", preventDefault() {} });
      });
      flushEditor(editor);

      // Default active option (index 0) is "Heading 1".
      const isH1 = editor.getEditorState().read(() => {
        const first = $getRoot().getFirstChild();
        return (
          first !== null && $isHeadingNode(first) && first.getTag() === "h1"
        );
      });
      assert.ok(isH1);
    });
  });

  test("plus menu: clicking the Table option inserts a real 2x2 table", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    withElementRects(editor, () => {
      withMatchMedia(true, () => {
        renderer = mountMenu(editor);
      });
      selectParagraph(editor, "");
      const button = findGutterButtons(renderer as ReactTestRenderer)[0];
      act(() => {
        button.props.onClick();
      });

      const tableOption = findOptionByLabel(
        renderer as ReactTestRenderer,
        "Table",
      );
      assert.ok(tableOption);
      act(() => {
        (tableOption as ReactTestInstance).props.onClick();
      });
      flushEditor(editor);

      const hasTable = editor.getEditorState().read(() => {
        return $getRoot()
          .getChildren()
          .some((node) => $isTableNode(node));
      });
      assert.ok(hasTable);
    });
  });

  test("plus menu: clicking the Quote option inserts a real quote block", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    withElementRects(editor, () => {
      withMatchMedia(true, () => {
        renderer = mountMenu(editor);
      });
      selectParagraph(editor, "");
      const button = findGutterButtons(renderer as ReactTestRenderer)[0];
      act(() => {
        button.props.onClick();
      });

      const quoteOption = findOptionByLabel(
        renderer as ReactTestRenderer,
        "Quote",
      );
      assert.ok(quoteOption);
      act(() => {
        (quoteOption as ReactTestInstance).props.onClick();
      });
      flushEditor(editor);

      const hasQuote = editor.getEditorState().read(() => {
        const first = $getRoot().getFirstChild();
        return first !== null && $isQuoteNode(first);
      });
      assert.ok(hasQuote);
    });
  });

  test("plus menu: clicking the Bullet list option inserts a real bullet list", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    withElementRects(editor, () => {
      withMatchMedia(true, () => {
        renderer = mountMenu(editor);
      });
      selectParagraph(editor, "");
      const button = findGutterButtons(renderer as ReactTestRenderer)[0];
      act(() => {
        button.props.onClick();
      });

      const bulletOption = findOptionByLabel(
        renderer as ReactTestRenderer,
        "Bullet list",
      );
      assert.ok(bulletOption);
      act(() => {
        (bulletOption as ReactTestInstance).props.onClick();
      });
      flushEditor(editor);

      const hasBulletList = editor.getEditorState().read(() => {
        const first = $getRoot().getFirstChild();
        return (
          first !== null &&
          $isListNode(first) &&
          first.getListType() === "bullet"
        );
      });
      assert.ok(hasBulletList);
    });
  });

  test("slash trigger opens the menu straight from block text, filtered by query, with no click", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    withElementRects(editor, () => {
      withMatchMedia(true, () => {
        renderer = mountMenu(editor);
      });
      selectParagraph(editor, "/head");

      assert.equal(findListboxes(renderer as ReactTestRenderer).length, 1);
      const options = findOptions(renderer as ReactTestRenderer);
      // "head" matches "Heading 1/2/3" (label substring) but not "Table",
      // "Quote", "Divider", or any visual-insert tool.
      assert.ok(options.length > 0);
      for (const option of options) {
        assert.ok(textOf(option).toLowerCase().includes("head"));
      }
      assert.equal(
        findOptionByLabel(renderer as ReactTestRenderer, "Table"),
        undefined,
      );
      // No gutter button in slash mode.
      assert.equal(findGutterButtons(renderer as ReactTestRenderer).length, 0);
    });
  });

  test("slash trigger with no matching tools keeps the menu fully closed", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    withElementRects(editor, () => {
      withMatchMedia(true, () => {
        renderer = mountMenu(editor);
      });
      selectParagraph(editor, "/zzzznotarealtool");

      // With zero matching tools, `slashHasMatches` is false, so the menu's
      // own `open` prop never becomes true — this is a from-scratch closed
      // render, not a same-tree transition, so it's safe to assert directly.
      assert.equal(findListboxes(renderer as ReactTestRenderer).length, 0);
    });
  });

  test("slash mode: Escape dismisses the unchanged trigger and a new trigger can reopen", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    withElementRects(editor, () => {
      withMatchMedia(true, () => {
        renderer = mountMenu(editor);
      });
      selectParagraph(editor, "/head");
      assert.equal(floatingSurfaceOpen(renderer as ReactTestRenderer), true);

      let prevented = false;
      let handled = false;
      act(() => {
        handled = editor.dispatchCommand(KEY_ESCAPE_COMMAND, {
          preventDefault: () => {
            prevented = true;
          },
        } as KeyboardEvent);
      });

      assert.equal(handled, true);
      assert.equal(prevented, true);
      assert.equal(floatingSurfaceOpen(renderer as ReactTestRenderer), false);

      selectParagraph(editor, "/head");
      assert.equal(floatingSurfaceOpen(renderer as ReactTestRenderer), true);
    });
  });

  test("slash mode: ArrowDown/Enter keyboard nav goes through registered Lexical commands, not DOM onKeyDown", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    withElementRects(editor, () => {
      withMatchMedia(true, () => {
        renderer = mountMenu(editor);
      });
      selectParagraph(editor, "/head");

      const before = findOptions(renderer as ReactTestRenderer);
      assert.equal(before[0].props["aria-selected"], true);

      const fakeKeyboardEvent = {
        preventDefault() {},
      } as unknown as KeyboardEvent;

      act(() => {
        editor.dispatchCommand(KEY_ARROW_DOWN_COMMAND, fakeKeyboardEvent);
      });

      const after = findOptions(renderer as ReactTestRenderer);
      assert.equal(after[0].props["aria-selected"], false);
      assert.equal(after[1].props["aria-selected"], true);

      act(() => {
        editor.dispatchCommand(KEY_ENTER_COMMAND, fakeKeyboardEvent);
      });
      flushEditor(editor);

      // The second "head" match ("Heading 2") is now committed.
      const isH2 = editor.getEditorState().read(() => {
        const first = $getRoot().getFirstChild();
        return (
          first !== null && $isHeadingNode(first) && first.getTag() === "h2"
        );
      });
      assert.ok(isH2);
    });
  });

  test("slash mode: committing a Visuals tool replaces the trigger block and dispatches INSERT_VISUAL_COMMAND with the real block key", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    withElementRects(editor, () => {
      withMatchMedia(true, () => {
        renderer = mountMenu(editor);
      });
      const blockKey = selectParagraph(editor, "/chart");

      let dispatchedPayload: unknown = null;
      editor.registerCommand(
        INSERT_VISUAL_COMMAND,
        (payload) => {
          dispatchedPayload = payload;
          return true;
        },
        COMMAND_PRIORITY_LOW,
      );

      const chartOption = findOptionByLabel(
        renderer as ReactTestRenderer,
        "Chart",
      );
      assert.ok(chartOption);
      act(() => {
        (chartOption as ReactTestInstance).props.onClick();
      });
      flushEditor(editor);

      assert.ok(dispatchedPayload);
      assert.equal(
        (dispatchedPayload as { afterNodeKey?: string }).afterNodeKey,
        blockKey,
      );
      // The "/chart" text block was replaced with a clean empty paragraph
      // before the visual-insert command fired.
      const trailingText = editor
        .getEditorState()
        .read(() => $getRoot().getTextContent());
      assert.equal(trailingText, "");
    });
  });
});
