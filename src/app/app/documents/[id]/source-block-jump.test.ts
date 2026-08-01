/**
 * Direct behavior coverage for `SourceBlockJumpPlugin` (#1947).
 *
 * The plugin reads a `?sourceBlock=` URL param on mount, looks up the
 * matching block by its `VisualNode` visual id (via `instanceof VisualNode`)
 * or its durable block-id NodeState (recursing into nested element nodes such as
 * lists), and — only when a match is found — scrolls the corresponding DOM
 * element, selects the matching Lexical node, and focuses the editor via
 * `requestAnimationFrame`.
 *
 * A real `@lexical/headless` editor (as `editor-context.test.ts` and
 * `use-insert-imported-markdown.test.ts` already do for this codebase's
 * Lexical plugins) stands in as the typed Lexical fake, wired into a
 * `LexicalComposerContext` via the shared React render harness.
 * `editor.getElementByKey` is monkey-patched per test (headless editors throw
 * "not supported in headless mode" for it by default) to return a fake DOM
 * element with a spy `scrollIntoView` method. `editor.focus`,
 * `window.location`, and `window.requestAnimationFrame` are stubbed so the
 * effect can run synchronously under plain Node (no jsdom).
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { createHeadlessEditor } from "@lexical/headless";
import {
  createLexicalComposerContext,
  LexicalComposerContext,
  type LexicalComposerContextWithEditor,
} from "@lexical/react/LexicalComposerContext";
import {
  ListItemNode,
  ListNode,
  $createListNode,
  $createListItemNode,
} from "@lexical/list";
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isNodeSelection,
  $isRangeSelection,
  type LexicalEditor,
  type NodeKey,
} from "lexical";

// Imported for its module-level side effect only: it flips
// `IS_REACT_ACT_ENVIRONMENT` on, which `act()` (used internally by
// `renderWithTestRenderer`) requires.
import { renderWithTestRenderer } from "@/test/react-render-harness";

import { $createVisualNode, VisualNode } from "@/lib/lexical/visual-node";
import { $setNodeBlockId } from "@/lib/lexical/block-id-runtime";
import { buildVisual } from "@/test/builders/visual";

import { SourceBlockJumpPlugin } from "./source-block-jump";

const ORIGINAL_WINDOW = globalThis.window;

function fakeElement() {
  const calls = { scrollIntoView: [] as unknown[] };
  return {
    calls,
    element: {
      scrollIntoView: (...args: unknown[]) => calls.scrollIntoView.push(args),
    },
  };
}

function installEditorFocusSpy(editor: LexicalEditor): {
  calls: number;
  rootCalls: number;
} {
  const state = { calls: 0, rootCalls: 0 };
  editor.focus = (() => {
    state.calls++;
  }) as typeof editor.focus;
  editor.getRootElement = (() => ({
    focus: () => {
      state.rootCalls++;
    },
  })) as unknown as typeof editor.getRootElement;
  return state;
}

function selectionContainsNode(
  editor: LexicalEditor,
  nodeKey: NodeKey,
): boolean {
  return editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return false;
    const target = $getNodeByKey(nodeKey);
    const anchor = selection.anchor.getNode();
    return target !== null && (target.is(anchor) || target.isParentOf(anchor));
  });
}

/** Installs a minimal `window` with a settable `location.search` and a
 * synchronous `requestAnimationFrame` so the plugin's effect can run to
 * completion under plain Node. */
function installWindowStub(
  search: string,
  deferAnimationFrame = false,
): { rafCalls: number; flushAnimationFrames(): void } {
  const state = { rafCalls: 0 };
  const callbacks: FrameRequestCallback[] = [];
  (globalThis as { window?: unknown }).window = {
    location: { search },
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      state.rafCalls++;
      if (deferAnimationFrame) callbacks.push(callback);
      else callback(0);
      return 0;
    },
    cancelAnimationFrame: () => undefined,
  };
  return {
    ...state,
    get rafCalls() {
      return state.rafCalls;
    },
    flushAnimationFrames() {
      for (const callback of callbacks.splice(0)) callback(0);
    },
  };
}

afterEach(() => {
  (globalThis as { window?: unknown }).window = ORIGINAL_WINDOW;
});

function makeEditor(): LexicalEditor {
  return createHeadlessEditor({
    namespace: "source-block-jump",
    nodes: [VisualNode, ListNode, ListItemNode],
    onError(error) {
      throw error;
    },
  });
}

function composerContextFor(
  editor: LexicalEditor,
): LexicalComposerContextWithEditor {
  return [editor, createLexicalComposerContext(null, null)];
}

/** Mounts the plugin under a real `LexicalComposerContext.Provider`. Its
 * effect (URL-param read + optional scroll/focus) runs synchronously during
 * the mount, so nothing further needs to happen after this returns. */
function mountPlugin(editor: LexicalEditor): void {
  renderWithTestRenderer(() => pluginElement(editor));
}

function pluginElement(editor: LexicalEditor) {
  return createElement(
    LexicalComposerContext.Provider,
    { value: composerContextFor(editor) },
    createElement(SourceBlockJumpPlugin),
  );
}

function mountPersistentPlugin(editor: LexicalEditor): () => void {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(pluginElement(editor));
  });
  return () => {
    act(() => renderer?.unmount());
  };
}

// ---------------------------------------------------------------------------
// No sourceBlock param
// ---------------------------------------------------------------------------

test("SourceBlockJumpPlugin does nothing when the sourceBlock URL param is absent", () => {
  const editor = makeEditor();
  const focus = installEditorFocusSpy(editor);
  const target = fakeElement();
  editor.getElementByKey = (() =>
    target.element) as unknown as typeof editor.getElementByKey;

  editor.update(
    () => {
      $getRoot().append(
        $createParagraphNode().append($createTextNode("Hello")),
      );
    },
    { discrete: true },
  );

  const raf = installWindowStub("");
  mountPlugin(editor);

  assert.equal(raf.rafCalls, 0);
  assert.equal(focus.calls, 0);
  assert.deepEqual(target.calls.scrollIntoView, []);
});

// ---------------------------------------------------------------------------
// Param present but no matching block
// ---------------------------------------------------------------------------

test("SourceBlockJumpPlugin does nothing when no block matches the sourceBlock param", () => {
  const editor = makeEditor();
  const focus = installEditorFocusSpy(editor);
  const target = fakeElement();
  editor.getElementByKey = (() =>
    target.element) as unknown as typeof editor.getElementByKey;

  editor.update(
    () => {
      $getRoot().append(
        $createParagraphNode().append($createTextNode("Hello")),
      );
    },
    { discrete: true },
  );

  const raf = installWindowStub("?sourceBlock=missing-id");
  mountPlugin(editor);

  assert.equal(raf.rafCalls, 0);
  assert.equal(focus.calls, 0);
  assert.deepEqual(target.calls.scrollIntoView, []);
});

test("SourceBlockJumpPlugin waits for a matching block from collaboration", () => {
  const editor = makeEditor();
  const focus = installEditorFocusSpy(editor);
  const target = fakeElement();
  editor.getElementByKey = (() =>
    target.element) as unknown as typeof editor.getElementByKey;

  const raf = installWindowStub("?sourceBlock=late-block", true);
  const unmount = mountPersistentPlugin(editor);
  try {
    assert.equal(raf.rafCalls, 0);
    assert.equal(focus.calls, 0);

    let paragraphKey: NodeKey | undefined;
    editor.update(
      () => {
        const paragraph = $createParagraphNode().append(
          $createTextNode("Collaborative content"),
        );
        $setNodeBlockId(paragraph, "late-block");
        paragraphKey = paragraph.getKey();
        $getRoot().append(paragraph);
      },
      { discrete: true },
    );

    assert.equal(raf.rafCalls, 1);
    raf.flushAnimationFrames();
    assert.equal(focus.calls, 1);
    assert.ok(paragraphKey);
    assert.equal(selectionContainsNode(editor, paragraphKey), true);
  } finally {
    unmount();
  }
});

// ---------------------------------------------------------------------------
// Match via VisualNode.getVisualId()
// ---------------------------------------------------------------------------

test("SourceBlockJumpPlugin scrolls, selects, and focuses the editor for a matching VisualNode", () => {
  const editor = makeEditor();
  const focus = installEditorFocusSpy(editor);
  const target = fakeElement();
  let visualKey: NodeKey | undefined;
  editor.getElementByKey = (() =>
    target.element) as unknown as typeof editor.getElementByKey;

  editor.update(
    () => {
      const visual = $createVisualNode(buildVisual(), "visual-42");
      visualKey = visual.getKey();
      $getRoot().append(
        $createParagraphNode().append($createTextNode("Intro")),
        visual,
      );
    },
    { discrete: true },
  );

  const raf = installWindowStub("?sourceBlock=visual-42");
  mountPlugin(editor);

  assert.equal(raf.rafCalls, 1);
  assert.deepEqual(target.calls.scrollIntoView, [
    [{ block: "center", behavior: "smooth" }],
  ]);
  assert.equal(focus.calls, 1);
  const resolvedVisualKey = visualKey;
  assert.ok(resolvedVisualKey);
  editor.getEditorState().read(() => {
    const selection = $getSelection();
    assert.ok($isNodeSelection(selection));
    assert.equal(selection.has(resolvedVisualKey), true);
  });
});

// ---------------------------------------------------------------------------
// Match via durable block-id NodeState
// ---------------------------------------------------------------------------

test("SourceBlockJumpPlugin scrolls, selects, and focuses the editor for a matching bid", () => {
  const editor = makeEditor();
  const focus = installEditorFocusSpy(editor);
  const target = fakeElement();
  let paragraphKey: NodeKey | undefined;
  editor.getElementByKey = (() =>
    target.element) as unknown as typeof editor.getElementByKey;

  editor.update(
    () => {
      const paragraph = $createParagraphNode().append(
        $createTextNode("Tagged paragraph"),
      );
      $setNodeBlockId(paragraph, "block-77");
      paragraphKey = paragraph.getKey();
      $getRoot().append(paragraph);
    },
    { discrete: true },
  );

  const raf = installWindowStub("?sourceBlock=block-77");
  mountPlugin(editor);

  assert.equal(raf.rafCalls, 1);
  assert.deepEqual(target.calls.scrollIntoView, [
    [{ block: "center", behavior: "smooth" }],
  ]);
  assert.equal(focus.calls, 1);
  assert.ok(paragraphKey);
  assert.equal(selectionContainsNode(editor, paragraphKey), true);
});

// ---------------------------------------------------------------------------
// Recursion into nested element nodes (list -> listitem)
// ---------------------------------------------------------------------------

test("SourceBlockJumpPlugin finds a bid match nested inside a list", () => {
  const editor = makeEditor();
  const focus = installEditorFocusSpy(editor);
  const target = fakeElement();
  let itemKey: NodeKey | undefined;
  editor.getElementByKey = (() =>
    target.element) as unknown as typeof editor.getElementByKey;

  editor.update(
    () => {
      const list = $createListNode("bullet");
      const item = $createListItemNode().append($createTextNode("Item one"));
      $setNodeBlockId(item, "block-list-item");
      itemKey = item.getKey();
      list.append(item);
      $getRoot().append(list);
    },
    { discrete: true },
  );

  const raf = installWindowStub("?sourceBlock=block-list-item");
  mountPlugin(editor);

  assert.equal(raf.rafCalls, 1);
  assert.deepEqual(target.calls.scrollIntoView, [
    [{ block: "center", behavior: "smooth" }],
  ]);
  assert.equal(focus.calls, 1);
  assert.ok(itemKey);
  assert.equal(selectionContainsNode(editor, itemKey), true);
});

// ---------------------------------------------------------------------------
// getElementByKey resolves to nothing (element unmounted)
// ---------------------------------------------------------------------------

test("SourceBlockJumpPlugin tolerates a matching block whose DOM element is unavailable", () => {
  const editor = makeEditor();
  const focus = installEditorFocusSpy(editor);
  editor.getElementByKey = (() => null) as typeof editor.getElementByKey;

  editor.update(
    () => {
      $getRoot().append($createVisualNode(buildVisual(), "visual-99"));
    },
    { discrete: true },
  );

  const raf = installWindowStub("?sourceBlock=visual-99");
  assert.doesNotThrow(() => mountPlugin(editor));
  assert.equal(raf.rafCalls, 1);
  assert.equal(focus.calls, 1);
});
