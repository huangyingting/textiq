/**
 * Direct behavior coverage for `TextFormatSection` (#1959).
 *
 * Mounted with a real `@lexical/headless` editor + `LexicalComposerContext`
 * + the real `EditorContextProvider`, the same pattern
 * `mobile-generate-visual-section.test.tsx` uses — a genuine Lexical
 * selection (plain, pre-bolded, or pre-colored text) drives the real
 * `toolsFor("text-format", ctx)`/`isToolActive`/`formatShortcut` registry
 * reads (already exhaustively covered by their own registry tests) rather
 * than faking their output, so this file only asserts the *section's own*
 * wiring: which control renders per tool, section-divider placement, the
 * `active`/`value` props it derives from a real selection snapshot, and that
 * clicking a control invokes the right editor call.
 *
 * The run-tool click path is asserted via a `dispatchCommand` recorder (the
 * same technique `tool-mutations.test.ts` uses for the runners themselves)
 * so this stays scoped to "did the button dispatch the right command",
 * without re-asserting the runner's own internals. The color-tool path is
 * asserted end-to-end against real Lexical state, since `TOOL_APPLIERS`
 * mutates directly via `editor.update` (no command/plugin registration
 * needed for it to take effect headlessly).
 *
 * The roving-tabindex/keyboard-nav effect reads and writes real DOM
 * (`containerRef.current.querySelectorAll("button")`, `el.tabIndex`,
 * `el.focus()`, `document.activeElement`) that `react-test-renderer` can't
 * back with genuine nodes; a `createNodeMock` (the same technique
 * `slide-editor-keyboard-command-path.test.ts` uses) supplies a fixed set of
 * lightweight, spy-able fake buttons for the toolbar container ref so the
 * component's *own* `onKeyDown`/`onFocus`/tabIndex-sync logic runs for real
 * against them — no jsdom.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
  type TestRendererOptions,
} from "react-test-renderer";

import { createHeadlessEditor } from "@lexical/headless";
import {
  createLexicalComposerContext,
  LexicalComposerContext,
  type LexicalComposerContextWithEditor,
} from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  FORMAT_TEXT_COMMAND,
  type LexicalCommand,
  type LexicalEditor,
} from "lexical";

import { ColorPicker, Divider } from "@/components/ui";
import { EditorContextProvider } from "@/lib/lexical/editor-context";
import { toolsFor } from "@/lib/lexical/tool-registry";
import type { EditorContextSnapshot } from "@/lib/lexical/selection-snapshot";

// Flips on `IS_REACT_ACT_ENVIRONMENT`; also installs the baseline
// `document`/`window` stubs `EditorContextProvider`'s effect needs,
// persistently for this file's lifetime.
import { installPersistentDefaultDom } from "@/test/react-render-harness";

import { TextFormatSection } from "./mobile-text-format-section";

installPersistentDefaultDom();

// Every tool is wrapped in `Tooltip`, which always calls
// `createPortal(tooltip, document.body)` once `document` exists, so `body`
// needs a `nodeType` react-dom's portal guard accepts.
(globalThis.document as unknown as { body: { nodeType: number } }).body = {
  nodeType: 1,
};

// All 18 `"text-format"` registry entries key their visibility on
// `"rangeSelection"` alone (`tool-metadata.ts`), so any real, non-collapsed,
// editable range selection renders every one of them — computed via the
// real export (not re-implemented) to avoid a brittle hard-coded count.
const RANGE_CTX: EditorContextSnapshot = {
  kind: "range",
  editable: true,
  isCollapsed: false,
  blockType: "paragraph",
  activeFormats: new Set(),
  elementFormat: "",
  textColor: "",
  highlightColor: "",
  isLink: false,
  selectionText: "hello",
  isEmptyBlock: false,
  rects: { selection: null, block: null },
};
const EXPECTED_TOOL_COUNT = toolsFor("text-format", RANGE_CTX).length;
const EXPECTED_DIVIDER_COUNT = (() => {
  const tools = toolsFor("text-format", RANGE_CTX);
  let dividers = 0;
  for (let i = 1; i < tools.length; i += 1) {
    if (tools[i - 1].section !== tools[i].section) dividers += 1;
  }
  return dividers;
})();

function makeEditor(): LexicalEditor {
  const editor = createHeadlessEditor({
    namespace: "text-format-section-test",
    onError(error) {
      throw error;
    },
  });
  editor.getRootElement = (() => null) as typeof editor.getRootElement;
  editor.getElementByKey = (() => null) as typeof editor.getElementByKey;
  // Headless editors throw on `.focus()`; Escape calls it unconditionally,
  // so replace it with a counting no-op rather than the throwing original.
  editor.focus = (() => undefined) as typeof editor.focus;
  return editor;
}

/** Builds a paragraph with one text node (optionally pre-formatted/styled) and selects it all. */
/** Builds a paragraph with one text node and selects it all, with optional
 * hooks to arrange node-level state (style) before selecting and
 * selection-level state (format) after selecting. */
function selectParagraphText(
  editor: LexicalEditor,
  text: string,
  options?: {
    beforeSelect?: (node: ReturnType<typeof $createTextNode>) => void;
    afterSelect?: () => void;
  },
): void {
  act(() => {
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        const textNode = $createTextNode(text);
        options?.beforeSelect?.(textNode);
        paragraph.append(textNode);
        $getRoot().clear().append(paragraph);
        textNode.select(0, text.length);
        options?.afterSelect?.();
      },
      { discrete: true },
    );
  });
}

type ButtonMock = { tabIndex: number; focus: () => void };

function makeButtonMocks(count: number): ButtonMock[] {
  return Array.from({ length: count }, () => ({
    tabIndex: -1,
    focus() {
      (
        globalThis.document as unknown as { activeElement: unknown }
      ).activeElement = this;
    },
  }));
}

function mount(
  editor: LexicalEditor,
  options?: TestRendererOptions,
): {
  renderer: ReactTestRenderer;
  unmount: () => void;
} {
  const composerContext: LexicalComposerContextWithEditor = [
    editor,
    createLexicalComposerContext(null, null),
  ];
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      createElement(
        LexicalComposerContext.Provider,
        { value: composerContext },
        createElement(
          EditorContextProvider,
          null,
          createElement(TextFormatSection),
        ),
      ),
      options,
    );
  });
  return {
    renderer,
    unmount: () => {
      act(() => {
        renderer.unmount();
      });
    },
  };
}

/** Reads the first paragraph's first text node's `style` string, for
 * asserting real Lexical style state after a color-tool apply/reset. */
function firstTextNodeStyle(): string {
  const paragraph = $getRoot().getFirstChild();
  const textNode = $isElementNode(paragraph) ? paragraph.getFirstChild() : null;
  return $isTextNode(textNode) ? textNode.getStyle() : "";
}

function findByAriaLabelStartingWith(
  renderer: ReactTestRenderer,
  prefix: string,
): ReactTestInstance {
  return renderer.root.find(
    (node) =>
      typeof node.props["aria-label"] === "string" &&
      (node.props["aria-label"] as string).startsWith(prefix),
  );
}

async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// No range selection — the toolbar renders with zero tools
// ---------------------------------------------------------------------------

test("renders an empty toolbar when there's no active range selection", () => {
  const editor = makeEditor();
  const { renderer, unmount } = mount(editor);
  try {
    const toolbar = renderer.root.findByProps({ role: "toolbar" });
    assert.equal(toolbar.props["aria-label"], "Text formatting");
    assert.equal(renderer.root.findAllByType("button").length, 0);
  } finally {
    unmount();
  }
});

// ---------------------------------------------------------------------------
// Composition + state: all tools render, grouped with dividers, active flags
// reflect the real selection snapshot
// ---------------------------------------------------------------------------

test("renders every text-format tool with section dividers and reflects inactive state from a real selection", () => {
  const editor = makeEditor();
  selectParagraphText(editor, "hello world");
  const { renderer, unmount } = mount(editor);
  try {
    assert.equal(
      renderer.root.findAllByType("button").length,
      EXPECTED_TOOL_COUNT,
    );
    assert.equal(
      renderer.root.findAllByType(Divider).length,
      EXPECTED_DIVIDER_COUNT,
    );

    const bold = findByAriaLabelStartingWith(renderer, "Bold");
    assert.equal(bold.props.active, false);
    assert.match(bold.props["aria-label"] as string, /^Bold \(/);

    const textColor = renderer.root.findByProps({ "aria-label": "Text color" });
    assert.equal(textColor.type, ColorPicker);
    assert.equal(textColor.props.color, "");
    assert.equal(textColor.props.active, false);
  } finally {
    unmount();
  }
});

test("reflects active state for a real pre-bolded selection", () => {
  const editor = makeEditor();
  selectParagraphText(editor, "bold text", {
    afterSelect: () => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        selection.formatText("bold");
      }
    },
  });
  const { renderer, unmount } = mount(editor);
  try {
    const bold = findByAriaLabelStartingWith(renderer, "Bold");
    assert.equal(bold.props.active, true);
  } finally {
    unmount();
  }
});

// ---------------------------------------------------------------------------
// Run-tool click wiring — dispatches the expected Lexical command
// ---------------------------------------------------------------------------

test("clicking a run tool dispatches its Lexical command through the real editor", () => {
  const editor = makeEditor();
  selectParagraphText(editor, "hello world");
  const calls: { command: LexicalCommand<unknown>; payload: unknown }[] = [];
  const originalDispatch = editor.dispatchCommand.bind(editor);
  editor.dispatchCommand = ((
    command: LexicalCommand<unknown>,
    payload: unknown,
  ) => {
    calls.push({ command, payload });
    return originalDispatch(command, payload);
  }) as typeof editor.dispatchCommand;

  const { renderer, unmount } = mount(editor);
  try {
    const bold = findByAriaLabelStartingWith(renderer, "Bold");
    act(() => {
      bold.props.onClick();
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, FORMAT_TEXT_COMMAND);
    assert.equal(calls[0].payload, "bold");
  } finally {
    unmount();
  }
});

// ---------------------------------------------------------------------------
// Color tool state + apply/reset — asserted against real Lexical style state
// ---------------------------------------------------------------------------

test("the text-color tool reflects a real pre-set style and apply/reset patch real selection style", async () => {
  const editor = makeEditor();
  selectParagraphText(editor, "colored text", {
    beforeSelect: (node) => {
      node.setStyle("color: #ff0000;");
    },
  });
  const { renderer, unmount } = mount(editor);
  try {
    const textColor = renderer.root.findByProps({ "aria-label": "Text color" });
    assert.equal(textColor.props.color, "#ff0000");
    assert.equal(textColor.props.active, true);
    assert.equal(textColor.props.layer, "menu");

    await act(async () => {
      textColor.props.onChange("#00ff00");
      await flush();
    });
    editor.getEditorState().read(() => {
      assert.match(firstTextNodeStyle(), /color:\s*#00ff00/);
    });

    await act(async () => {
      textColor.props.onReset();
      await flush();
    });
    editor.getEditorState().read(() => {
      assert.doesNotMatch(firstTextNodeStyle(), /color:/);
    });
  } finally {
    unmount();
  }
});

// ---------------------------------------------------------------------------
// Roving tabindex + keyboard nav — real onKeyDown/onFocus logic, fake DOM
// ---------------------------------------------------------------------------

test("roving tabindex: arrow keys/Home/End move focus, Escape refocuses the editor, and onFocus syncs the roving index", () => {
  const editor = makeEditor();
  selectParagraphText(editor, "hello world");
  const buttons = makeButtonMocks(EXPECTED_TOOL_COUNT);
  let focusCalls = 0;
  editor.focus = (() => {
    focusCalls += 1;
  }) as typeof editor.focus;

  const createNodeMock = (element: { props: Record<string, unknown> }) =>
    element.props.role === "toolbar"
      ? { querySelectorAll: () => buttons }
      : null;

  const { renderer, unmount } = mount(editor, {
    createNodeMock: createNodeMock as TestRendererOptions["createNodeMock"],
  });
  try {
    const toolbar = renderer.root.findByProps({ role: "toolbar" });

    act(() => {
      toolbar.props.onKeyDown({
        key: "ArrowRight",
        preventDefault: () => undefined,
      });
    });
    assert.equal(
      (globalThis.document as unknown as { activeElement: ButtonMock })
        .activeElement,
      buttons[0],
      "expected the first item to be focused from a neutral start",
    );

    act(() => {
      toolbar.props.onKeyDown({
        key: "ArrowRight",
        preventDefault: () => undefined,
      });
    });
    assert.equal(
      (globalThis.document as unknown as { activeElement: ButtonMock })
        .activeElement,
      buttons[1],
      "expected ArrowRight to advance from item 0 to item 1",
    );

    act(() => {
      toolbar.props.onKeyDown({
        key: "ArrowLeft",
        preventDefault: () => undefined,
      });
    });
    assert.equal(
      (globalThis.document as unknown as { activeElement: ButtonMock })
        .activeElement,
      buttons[0],
      "expected ArrowLeft to move back to item 0",
    );

    act(() => {
      toolbar.props.onKeyDown({ key: "End", preventDefault: () => undefined });
    });
    assert.equal(
      (globalThis.document as unknown as { activeElement: ButtonMock })
        .activeElement,
      buttons[buttons.length - 1],
      "expected End to jump to the last item",
    );

    act(() => {
      toolbar.props.onKeyDown({ key: "Home", preventDefault: () => undefined });
    });
    assert.equal(
      (globalThis.document as unknown as { activeElement: ButtonMock })
        .activeElement,
      buttons[0],
      "expected Home to jump to the first item",
    );

    // The `useEffect` re-syncs tabIndex after each roving-index change.
    assert.equal(buttons[0].tabIndex, 0);
    assert.ok(buttons.slice(1).every((button) => button.tabIndex === -1));

    // `onFocus` bubbling from a real focus event syncs the roving index —
    // observable via the tabIndex-sync effect re-running against the newly
    // focused item.
    act(() => {
      toolbar.props.onFocus({ target: buttons[2] });
    });
    assert.equal(buttons[2].tabIndex, 0);
    assert.ok(
      buttons
        .filter((_, i) => i !== 2)
        .every((button) => button.tabIndex === -1),
    );

    // Arrow-key "current" is read from `document.activeElement` (mirroring
    // real DOM focus, which a genuine focus event would already have
    // moved) rather than the roving-index state directly.
    (
      globalThis.document as unknown as { activeElement: ButtonMock }
    ).activeElement = buttons[2];
    act(() => {
      toolbar.props.onKeyDown({
        key: "ArrowRight",
        preventDefault: () => undefined,
      });
    });
    assert.equal(
      (globalThis.document as unknown as { activeElement: ButtonMock })
        .activeElement,
      buttons[3],
      "expected ArrowRight to advance from the onFocus-synced item 2 to item 3",
    );

    assert.equal(focusCalls, 0);
    act(() => {
      toolbar.props.onKeyDown({
        key: "Escape",
        preventDefault: () => undefined,
      });
    });
    assert.equal(
      focusCalls,
      1,
      "expected Escape to refocus the editor exactly once",
    );
  } finally {
    unmount();
  }
});
