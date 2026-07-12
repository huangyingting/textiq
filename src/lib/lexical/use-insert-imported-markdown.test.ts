/**
 * Direct contracts for `useInsertImportedMarkdown` (#1929).
 *
 * The hook is the single React/DOM boundary between "the user pasted/imported
 * Markdown" and Lexical's `setEditorState`: it parses Markdown into a
 * serialized Lexical state (`markdownToLexicalState`, already covered by
 * `src/lib/content/from-markdown.test.ts`), asks the editor to parse that
 * state, and — only if parsing succeeds — replaces the editor's entire
 * content, tagged `IMPORT_TAG`. This file exercises that boundary: import
 * ordering (parse-then-replace, never merge), the `IMPORT_TAG` propagation,
 * empty/whitespace input, and the malformed-input catch path (a parsed state
 * referencing a node type the editor doesn't have registered — exactly how a
 * corrupt/foreign import fails in production).
 *
 * Uses a real `@lexical/headless` editor (as `editor-context.test.ts` and
 * `table-observer-guard.test.ts` already do for this codebase's Lexical
 * plugins) as the typed Lexical fake, wired into a `LexicalComposerContext`
 * via the shared React render harness — the hook's only surface with Lexical
 * is `useLexicalComposerContext`, `editor.parseEditorState`, and
 * `editor.setEditorState`, all of which a headless editor exercises for real.
 *
 * `createReactRenderHarness().run()` never mounts the tree it builds (by
 * design — it's meant for hooks that read no React Context, like
 * `useLexicalCollaboration` in `use-lexical-collaboration.test.ts`), so a
 * `LexicalComposerContext.Provider` ancestor would never actually commit.
 * `renderWithTestRenderer` mounts what it's given, so it's used here instead;
 * the one test that must observe `useCallback` identity across a *live*
 * re-render (not a remount) drives `react-test-renderer`'s `act`/`create`
 * directly, reusing the harness module's act-environment side effect.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { createHeadlessEditor } from "@lexical/headless";
import {
  createLexicalComposerContext,
  LexicalComposerContext,
  type LexicalComposerContextWithEditor,
} from "@lexical/react/LexicalComposerContext";
import { HeadingNode } from "@lexical/rich-text";
import { $getRoot, type LexicalEditor } from "lexical";

import { IMPORT_TAG } from "@/lib/content";
// Imported for its module-level side effect only: it flips
// `IS_REACT_ACT_ENVIRONMENT` on, which `act()` requires.
import { renderWithTestRenderer } from "@/test/react-render-harness";

import { useInsertImportedMarkdown } from "./use-insert-imported-markdown";

/** A headless editor with only Lexical's built-in nodes (no HeadingNode/ListNode/TableNode). */
function makeMinimalEditor(): LexicalEditor {
  return createHeadlessEditor({
    namespace: "insert-imported-markdown-minimal",
    onError(error) {
      throw error;
    },
  });
}

/** A headless editor with the heading node registered, matching the app's real NODES set. */
function makeHeadingCapableEditor(): LexicalEditor {
  return createHeadlessEditor({
    namespace: "insert-imported-markdown-heading",
    nodes: [HeadingNode],
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

/**
 * Mounts the hook under a real `LexicalComposerContext.Provider` and returns
 * its stable callback. The tree is unmounted immediately after capture (the
 * callback is a plain closure over `editor`, unaffected by unmount), which is
 * fine for every test except the dedicated re-render identity test below.
 */
function mountHook(editor: LexicalEditor): (markdown: string) => void {
  let latest: ((markdown: string) => void) | undefined;
  renderWithTestRenderer(() =>
    createElement(
      LexicalComposerContext.Provider,
      { value: composerContextFor(editor) },
      createElement(() => {
        latest = useInsertImportedMarkdown();
        return null;
      }),
    ),
  );
  assert.ok(latest, "expected the hook to have rendered");
  return latest;
}

function rootText(editor: LexicalEditor): string {
  return editor.getEditorState().read(() => $getRoot().getTextContent());
}

/** Captures the `tags` set from the next committed update on this editor. */
function captureNextUpdateTags(editor: LexicalEditor): {
  tags: () => Set<string> | undefined;
} {
  let seen: Set<string> | undefined;
  const unregister = editor.registerUpdateListener(({ tags }) => {
    seen = tags;
    unregister();
  });
  return { tags: () => seen };
}

// ---------------------------------------------------------------------------
// Happy path — parse then replace, tagged for autosave + collaboration sync
// ---------------------------------------------------------------------------

test("inserts parsed Markdown as the editor's entire content, tagged IMPORT_TAG", () => {
  const editor = makeMinimalEditor();
  const insertImportedMarkdown = mountHook(editor);
  const capture = captureNextUpdateTags(editor);

  insertImportedMarkdown("Hello world");

  assert.equal(rootText(editor), "Hello world");
  assert.ok(capture.tags()?.has(IMPORT_TAG), "expected the IMPORT_TAG tag");
});

test("a second import fully replaces the first — content never merges", () => {
  const editor = makeMinimalEditor();
  const insertImportedMarkdown = mountHook(editor);

  insertImportedMarkdown("First import");
  assert.equal(rootText(editor), "First import");

  insertImportedMarkdown("Second import");

  assert.equal(rootText(editor), "Second import");
  assert.doesNotMatch(rootText(editor), /First import/);
});

test("a throwing parse (unregistered node) never touches existing editor content", () => {
  // No HeadingNode registered, so a heading block fails to parse.
  const editor = makeMinimalEditor();
  const insertImportedMarkdown = mountHook(editor);

  insertImportedMarkdown("Existing content");
  assert.equal(rootText(editor), "Existing content");

  insertImportedMarkdown("# Unregistered heading");

  // setEditorState was never reached — content is untouched.
  assert.equal(rootText(editor), "Existing content");
});

// ---------------------------------------------------------------------------
// Empty input
// ---------------------------------------------------------------------------

test("empty Markdown replaces content with a single empty paragraph", () => {
  const editor = makeMinimalEditor();
  const insertImportedMarkdown = mountHook(editor);

  insertImportedMarkdown("Not empty yet");
  assert.equal(rootText(editor), "Not empty yet");

  const capture = captureNextUpdateTags(editor);
  insertImportedMarkdown("");

  assert.equal(rootText(editor), "");
  assert.equal(
    editor.getEditorState().read(() => $getRoot().getChildrenSize()),
    1,
  );
  assert.ok(capture.tags()?.has(IMPORT_TAG));
});

test("whitespace-only Markdown is treated the same as empty input", () => {
  const editor = makeMinimalEditor();
  const insertImportedMarkdown = mountHook(editor);

  insertImportedMarkdown("   \n\t  ");

  assert.equal(rootText(editor), "");
});

// ---------------------------------------------------------------------------
// Malformed input — caught, logged, content preserved
// ---------------------------------------------------------------------------

test("a parsed state referencing an unregistered node type is caught and logged, not thrown", () => {
  const editor = makeMinimalEditor();
  const insertImportedMarkdown = mountHook(editor);
  const originalConsoleError = console.error;
  const errors: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  try {
    assert.doesNotThrow(() => insertImportedMarkdown("# Heading one"));

    assert.equal(errors.length, 1);
    assert.equal(
      errors[0]?.[0],
      "Failed to insert imported content into editor",
    );
    assert.ok(errors[0]?.[1] instanceof Error);
  } finally {
    console.error = originalConsoleError;
  }
});

test("registering the missing node makes the same Markdown succeed", () => {
  const editor = makeHeadingCapableEditor();
  const insertImportedMarkdown = mountHook(editor);

  insertImportedMarkdown("# Heading one");

  assert.equal(rootText(editor), "Heading one");
});

// ---------------------------------------------------------------------------
// Stable callback identity across a live re-render (not a remount)
// ---------------------------------------------------------------------------

test("returns a stable callback across re-renders while the editor is unchanged", () => {
  const editor = makeMinimalEditor();
  const composerContext = composerContextFor(editor);
  const seen: Array<(markdown: string) => void> = [];

  function Inner() {
    seen.push(useInsertImportedMarkdown());
    return null;
  }

  const buildElement = () =>
    createElement(
      LexicalComposerContext.Provider,
      { value: composerContext },
      createElement(Inner),
    );

  let renderer: ReactTestRenderer | null = null;
  act(() => {
    renderer = create(buildElement());
  });
  act(() => {
    // Re-render the SAME mounted tree (not a remount) with a fresh-but-
    // equivalent element — this is what exercises useCallback's per-fiber
    // memoization, since `editor` (the only dependency) is unchanged.
    renderer?.update(buildElement());
  });
  act(() => {
    renderer?.unmount();
  });

  assert.equal(seen.length, 2);
  assert.equal(seen[0], seen[1]);
});
