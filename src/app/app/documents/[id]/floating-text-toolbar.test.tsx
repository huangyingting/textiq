/**
 * Direct behavior coverage for `FloatingTextToolbar` (#1958).
 *
 * `FloatingTextToolbar` is a thin registry-driven renderer over
 * already-independently-tested collaborators: `useEditorContext` (selection
 * descriptor + DOM rects, `editor-context-provider.test.ts`),
 * `useEditingSurface` (mode/group decision, `use-editing-surface.test.ts`),
 * `toolsFor`/`isToolActive`/`formatShortcut` (the tool registry,
 * `tool-registry.test.ts`), and `FloatingSurface`/`ColorPicker`/`IconButton`
 * (shared UI primitives). This file exercises the toolbar's own contract:
 * visibility gating (float mode + text-format group + editable + a measured
 * selection rect — all four required), that it renders one button per
 * registry tool and running one dispatches through to the real editor
 * (observable via a real format-state flip), the color-control variant
 * wiring `onPick`/`onReset` to `tool.apply`, roving-tabindex arrow
 * navigation, and Escape returning focus to the editor.
 *
 * A range selection is real Lexical state (`text.select(...)`); the
 * *DOM* selection rect additionally requires a fake `window.getSelection()` +
 * `editor.getRootElement()` pair (same technique as
 * `editor-context-provider.test.ts`), since `EditorContextProvider` only
 * derives `rects.selection` from the native selection, not the Lexical one.
 */
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { createElement } from "react";
import { act, type ReactTestRenderer } from "react-test-renderer";

import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isRangeSelection,
  $isTextNode,
  $getSelection,
  type LexicalEditor,
} from "lexical";
import { LexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { registerRichText } from "@lexical/rich-text";

import { EditorContextProvider } from "@/lib/lexical/editor-context";

import {
  composerContextFor,
  installFakeDom,
  makeHeadlessEditor,
  mount,
  unmount,
  withMatchMedia,
  flushEditor,
} from "@/test/lexical-component-harness";
import { VisualPanelProvider } from "./visual-panel-context";

import { FloatingTextToolbar } from "./floating-text-toolbar";

/**
 * `tool.run` for the "format-*" tools dispatches `FORMAT_TEXT_COMMAND`, which
 * is only handled once `@lexical/rich-text`'s `registerRichText` has
 * installed its command listener (normally done by production's
 * `<RichTextPlugin>` inside `editor-plugins.tsx`). Since this file mounts
 * `FloatingTextToolbar` in isolation rather than the full editor composition,
 * it registers the same listener directly so a real Bold click flips real
 * format state.
 */
function makeEditor(): LexicalEditor {
  const editor = makeHeadlessEditor({
    namespace: "floating-text-toolbar-test",
  });
  registerRichText(editor);
  return editor;
}

/** Selects `[start, end)` of a fresh paragraph's text as a real range selection. */
function selectRange(
  editor: LexicalEditor,
  text: string,
  start: number,
  end: number,
) {
  act(() => {
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        const textNode = $createTextNode(text);
        paragraph.append(textNode);
        $getRoot().clear().append(paragraph);
        textNode.select(start, end);
      },
      { discrete: true },
    );
  });
}

/**
 * Makes the native `window.getSelection()` report a non-collapsed selection
 * anchored inside a fake editor root, so `EditorContextProvider` derives a
 * non-null `rects.selection` for a live "range" descriptor.
 */
function withNativeSelectionRect(editor: LexicalEditor, run: () => void) {
  const fakeRootElement = { contains: () => true } as unknown as HTMLElement;
  const originalGetRootElement = editor.getRootElement;
  editor.getRootElement = (() =>
    fakeRootElement) as typeof editor.getRootElement;

  const fakeWindow = globalThis.window as unknown as {
    getSelection: () => unknown;
  };
  const originalGetSelection = fakeWindow.getSelection;
  fakeWindow.getSelection = () => ({
    rangeCount: 1,
    isCollapsed: false,
    anchorNode: {},
    getRangeAt: () => ({
      getBoundingClientRect: () => ({
        top: 10,
        left: 20,
        right: 120,
        bottom: 40,
        width: 100,
        height: 30,
      }),
    }),
  });
  try {
    run();
  } finally {
    editor.getRootElement = originalGetRootElement;
    fakeWindow.getSelection = originalGetSelection;
  }
}

function mountToolbar(editor: LexicalEditor): ReactTestRenderer {
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
          createElement(FloatingTextToolbar),
        ),
      ),
    ),
  );
}

function findToolbar(renderer: ReactTestRenderer) {
  // Matching on `role` alone would also match `FloatingSurface`'s own fiber
  // (it forwards `role="toolbar"` straight through as a prop, whether or not
  // it's currently rendering anything into the portal). Restricting to host
  // elements finds only the actual DOM node — present only while `open`.
  return renderer.root.findAll(
    (instance) =>
      typeof instance.type === "string" && instance.props.role === "toolbar",
  );
}

function findToolButton(renderer: ReactTestRenderer, labelPrefix: string) {
  return renderer.root.find(
    (instance) =>
      instance.type === "button" &&
      typeof instance.props["aria-label"] === "string" &&
      (instance.props["aria-label"] as string).startsWith(labelPrefix),
  );
}

function isBold(editor: LexicalEditor): boolean {
  return editor.getEditorState().read(() => {
    const selection = $getSelection();
    return $isRangeSelection(selection) ? selection.hasFormat("bold") : false;
  });
}

describe("FloatingTextToolbar", () => {
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

  test("stays hidden with no selection, even on a fine pointer", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    withMatchMedia(true, () => {
      renderer = mountToolbar(editor);
    });
    assert.equal(findToolbar(renderer as ReactTestRenderer).length, 0);
  });

  test("stays hidden for a live range selection without a native DOM selection rect", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    withMatchMedia(true, () => {
      renderer = mountToolbar(editor);
    });
    selectRange(editor, "Hello world", 0, 5);
    // No `withNativeSelectionRect` here: `ctx.rects.selection` stays null, so
    // the toolbar's own extra positioning guard keeps it hidden even though
    // the surface resolves to float/text-format.
    assert.equal(findToolbar(renderer as ReactTestRenderer).length, 0);
  });

  test("becomes visible for a range selection with a measured rect on a fine pointer, and hides on a coarse pointer", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();

    withNativeSelectionRect(editor, () => {
      withMatchMedia(true, () => {
        renderer = mountToolbar(editor);
        selectRange(editor, "Hello world", 0, 5);
      });
    });

    assert.equal(findToolbar(renderer as ReactTestRenderer).length, 1);
    assert.ok(
      findToolButton(renderer as ReactTestRenderer, "Bold"),
      "expected a Bold tool button",
    );

    withMatchMedia(false, () => {
      act(() => {
        editor.update(() => {}, { discrete: true });
      });
    });
  });

  test("clicking the Bold tool button formats the real selection and flips its active state", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();

    withNativeSelectionRect(editor, () => {
      withMatchMedia(true, () => {
        renderer = mountToolbar(editor);
        selectRange(editor, "Hello world", 0, 5);
      });

      assert.equal(isBold(editor), false);
      const boldButton = findToolButton(renderer as ReactTestRenderer, "Bold");
      assert.equal(boldButton.props["aria-pressed"], false);

      act(() => {
        boldButton.props.onClick();
        flushEditor(editor);
      });

      assert.equal(isBold(editor), true);
      const updatedBoldButton = findToolButton(
        renderer as ReactTestRenderer,
        "Bold",
      );
      assert.equal(updatedBoldButton.props["aria-pressed"], true);
    });
  });

  test("the text-color control wires onPick/onReset through to tool.apply (real style mutation)", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();

    withNativeSelectionRect(editor, () => {
      withMatchMedia(true, () => {
        renderer = mountToolbar(editor);
        selectRange(editor, "Hello world", 0, 5);
      });

      const colorPicker = renderer!.root.find(
        (instance) =>
          typeof instance.type === "function" &&
          (instance.type as { name?: string }).name === "ColorPicker" &&
          instance.props["aria-label"] === "Text color",
      );

      act(() => {
        colorPicker.props.onChange("#ff0000");
        flushEditor(editor);
      });

      const styleAfterPick = editor.getEditorState().read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return "";
        const node = selection.getNodes()[0];
        return $isTextNode(node) ? node.getStyle() : "";
      });
      assert.match(styleAfterPick ?? "", /#ff0000/i);

      act(() => {
        colorPicker.props.onReset();
        flushEditor(editor);
      });
      const styleAfterReset = editor.getEditorState().read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return "";
        const node = selection.getNodes()[0];
        return $isTextNode(node) ? node.getStyle() : "";
      });
      assert.doesNotMatch(styleAfterReset ?? "", /#ff0000/i);
    });
  });

  test("ArrowRight roves the tabbable button forward and Escape returns focus to the editor", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    let editorFocusCalls = 0;
    editor.focus = (() => {
      editorFocusCalls += 1;
    }) as typeof editor.focus;

    // `onToolbarKeyDown`'s roving logic reads real button elements via
    // `measureRef.current.querySelectorAll("button")`. The toolbar's `<div>`
    // is portalled into `document.body` (via `FloatingSurface`), and
    // `react-test-renderer` resolves refs for *portalled* content through the
    // portal container's own `createNodeMock` (not the one passed to
    // `create()`/`mount()` — see `installFakeDom`'s `FakeDomNode` doc). This
    // test reassigns `document.body.createNodeMock` to proxy the measured
    // `<div>` to the real rendered `<button>` test instances, using stable
    // per-instance wrappers exposing `.focus()`/`.tabIndex` so
    // `document.activeElement` identity checks still work.
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
    (
      document.body as unknown as {
        createNodeMock: (element: {
          type: unknown;
          props: Record<string, unknown>;
        }) => unknown;
      }
    ).createNodeMock = (element) => {
      if (
        element.type === "div" &&
        typeof element.props.onKeyDown === "function" &&
        typeof element.props.onFocus === "function"
      ) {
        return {
          querySelectorAll: (selector: string) => {
            if (selector !== "button" || !renderedRoot) return [];
            return renderedRoot
              .findAll((i) => i.type === "button")
              .map(wrapperFor);
          },
        };
      }
      return null;
    };

    withNativeSelectionRect(editor, () => {
      withMatchMedia(true, () => {
        renderer = mountToolbar(editor);
        renderedRoot = renderer.root;
        selectRange(editor, "Hello world", 0, 5);
      });

      const toolbar = renderer!.root.find(
        (instance) =>
          typeof instance.type === "string" &&
          typeof instance.props.onKeyDown === "function" &&
          typeof instance.props.onFocus === "function",
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
      // The first button (index 0) should now have received focus.
      const buttons = renderer!.root.findAll((i) => i.type === "button");
      const firstWrapper = wrapperFor(buttons[0]);
      assert.equal(
        (globalThis.document as unknown as { activeElement: unknown })
          .activeElement,
        firstWrapper,
      );

      act(() => {
        toolbar.props.onKeyDown({ key: "Escape", preventDefault: () => {} });
      });
      assert.equal(editorFocusCalls, 1);
    });
  });
});
