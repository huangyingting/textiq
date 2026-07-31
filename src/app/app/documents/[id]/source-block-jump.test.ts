/**
 * Direct behavior coverage for `SourceBlockJumpPlugin` (#1947).
 *
 * The plugin reads a `?sourceBlock=` URL param on mount, looks up the
 * matching block by its `VisualNode` visual id (via `instanceof VisualNode`)
 * or its durable block-id NodeState (recursing into nested element nodes such as
 * lists), and — only when a match is found — scrolls/focuses the
 * corresponding DOM element via `requestAnimationFrame`.
 *
 * A real `@lexical/headless` editor (as `editor-context.test.ts` and
 * `use-insert-imported-markdown.test.ts` already do for this codebase's
 * Lexical plugins) stands in as the typed Lexical fake, wired into a
 * `LexicalComposerContext` via the shared React render harness.
 * `editor.getElementByKey` is monkey-patched per test (headless editors throw
 * "not supported in headless mode" for it by default) to return a fake DOM
 * element with spy `scrollIntoView`/`focus` methods, and `window.location`/
 * `window.requestAnimationFrame` are stubbed so the effect can run
 * synchronously under plain Node (no jsdom).
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createElement } from "react";

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
  $getRoot,
  type LexicalEditor,
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
  const calls = {
    scrollIntoView: [] as unknown[],
    focus: [] as unknown[],
  };
  return {
    calls,
    element: {
      scrollIntoView: (...args: unknown[]) => calls.scrollIntoView.push(args),
      focus: (...args: unknown[]) => calls.focus.push(args),
    },
  };
}

/** Installs a minimal `window` with a settable `location.search` and a
 * synchronous `requestAnimationFrame` so the plugin's effect can run to
 * completion under plain Node. */
function installWindowStub(search: string): { rafCalls: number } {
  const state = { rafCalls: 0 };
  (globalThis as { window?: unknown }).window = {
    location: { search },
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      state.rafCalls++;
      callback(0);
      return 0;
    },
  };
  return state;
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
  renderWithTestRenderer(() =>
    createElement(
      LexicalComposerContext.Provider,
      { value: composerContextFor(editor) },
      createElement(SourceBlockJumpPlugin),
    ),
  );
}

// ---------------------------------------------------------------------------
// No sourceBlock param
// ---------------------------------------------------------------------------

test("SourceBlockJumpPlugin does nothing when the sourceBlock URL param is absent", () => {
  const editor = makeEditor();
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
  assert.deepEqual(target.calls.scrollIntoView, []);
  assert.deepEqual(target.calls.focus, []);
});

// ---------------------------------------------------------------------------
// Param present but no matching block
// ---------------------------------------------------------------------------

test("SourceBlockJumpPlugin does nothing when no block matches the sourceBlock param", () => {
  const editor = makeEditor();
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
  assert.deepEqual(target.calls.scrollIntoView, []);
  assert.deepEqual(target.calls.focus, []);
});

// ---------------------------------------------------------------------------
// Match via VisualNode.getVisualId()
// ---------------------------------------------------------------------------

test("SourceBlockJumpPlugin scrolls and focuses the element for a matching VisualNode", () => {
  const editor = makeEditor();
  const target = fakeElement();
  editor.getElementByKey = (() =>
    target.element) as unknown as typeof editor.getElementByKey;

  editor.update(
    () => {
      $getRoot().append(
        $createParagraphNode().append($createTextNode("Intro")),
        $createVisualNode(buildVisual(), "visual-42"),
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
  assert.deepEqual(target.calls.focus, [[{ preventScroll: true }]]);
});

// ---------------------------------------------------------------------------
// Match via durable block-id NodeState
// ---------------------------------------------------------------------------

test("SourceBlockJumpPlugin scrolls and focuses the element for a matching bid", () => {
  const editor = makeEditor();
  const target = fakeElement();
  editor.getElementByKey = (() =>
    target.element) as unknown as typeof editor.getElementByKey;

  editor.update(
    () => {
      const paragraph = $createParagraphNode().append(
        $createTextNode("Tagged paragraph"),
      );
      $setNodeBlockId(paragraph, "block-77");
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
  assert.deepEqual(target.calls.focus, [[{ preventScroll: true }]]);
});

// ---------------------------------------------------------------------------
// Recursion into nested element nodes (list -> listitem)
// ---------------------------------------------------------------------------

test("SourceBlockJumpPlugin finds a bid match nested inside a list", () => {
  const editor = makeEditor();
  const target = fakeElement();
  editor.getElementByKey = (() =>
    target.element) as unknown as typeof editor.getElementByKey;

  editor.update(
    () => {
      const list = $createListNode("bullet");
      const item = $createListItemNode().append($createTextNode("Item one"));
      $setNodeBlockId(item, "block-list-item");
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
  assert.deepEqual(target.calls.focus, [[{ preventScroll: true }]]);
});

// ---------------------------------------------------------------------------
// getElementByKey resolves to nothing (element unmounted)
// ---------------------------------------------------------------------------

test("SourceBlockJumpPlugin tolerates a matching block whose DOM element is unavailable", () => {
  const editor = makeEditor();
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
});
