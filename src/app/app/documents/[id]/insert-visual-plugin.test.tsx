/**
 * Direct contracts for `InsertVisualPlugin` (#1949), the React wiring around
 * {@link INSERT_VISUAL_COMMAND}.
 *
 * `$insertBlankVisualAfter` (the pure insertion routine the plugin delegates
 * to) already has exhaustive headless coverage in `insert-visual.test.ts`
 * (target resolution, selection, node shape per `VisualKind`). This file
 * instead covers only what the plugin itself adds on top of that pure
 * decision: registering {@link INSERT_VISUAL_COMMAND} at
 * `COMMAND_PRIORITY_EDITOR` on mount, that a real dispatch end-to-end inserts
 * and selects a `VisualNode` and reports the command as handled, that an
 * invalid runtime payload surfaces through the editor's `onError` instead of
 * throwing synchronously (and leaves the document untouched), and that
 * unmounting tears the registration down so a later dispatch is no longer
 * handled.
 *
 * Mounted directly with `react-test-renderer`'s `act`/`create` against a real
 * `@lexical/headless` editor wrapped in a `LexicalComposerContext.Provider` —
 * the same pattern `editor-context-provider.test.ts` and
 * `document-export-button.test.tsx` use for plugins that only need
 * `useLexicalComposerContext`, no DOM/jsdom required since this plugin never
 * touches `document`/`window`.
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
import {
  $getRoot,
  $getSelection,
  $createParagraphNode,
  $createTextNode,
  $isNodeSelection,
  COMMAND_PRIORITY_EDITOR,
  type CommandListenerPriority,
  type LexicalCommand,
  type LexicalEditor,
} from "lexical";

import {
  INSERT_VISUAL_COMMAND,
  type InsertVisualPayload,
} from "@/lib/lexical/commands";
import { $isVisualNode, VisualNode } from "@/lib/lexical/visual-node";

// Imported for its module-level side effect only: it flips
// `IS_REACT_ACT_ENVIRONMENT` on, which `act()` requires.
import "@/test/react-render-harness";

import { InsertVisualPlugin } from "./insert-visual-plugin";

function makeEditor(onError: (error: Error) => void = () => {}): LexicalEditor {
  return createHeadlessEditor({
    namespace: "insert-visual-plugin-test",
    nodes: [VisualNode],
    onError,
  });
}

type Mounted = {
  unmount(): void;
};

function mountPlugin(editor: LexicalEditor): Mounted {
  const composerContext: LexicalComposerContextWithEditor = [
    editor,
    createLexicalComposerContext(null, null),
  ];

  let renderer: ReactTestRenderer | null = null;
  act(() => {
    renderer = create(
      createElement(
        LexicalComposerContext.Provider,
        { value: composerContext },
        createElement(InsertVisualPlugin),
      ),
    );
  });

  return {
    unmount: () => {
      act(() => {
        renderer?.unmount();
      });
    },
  };
}

function rootChildTypes(editor: LexicalEditor): string[] {
  return editor.getEditorState().read(() =>
    $getRoot()
      .getChildren()
      .map((node) => node.getType()),
  );
}

/**
 * The plugin's handler calls `editor.update()` without `discrete: true`, so
 * (matching real Lexical/React usage) the pending state only commits on a
 * queued microtask — `dispatchCommand`'s synchronous return value reflects
 * whether a handler claimed the command, not that the resulting state has
 * landed yet. Tests that inspect post-dispatch editor state await this once.
 */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}

// ---------------------------------------------------------------------------
// Registration — command + priority
// ---------------------------------------------------------------------------

test("mounting registers INSERT_VISUAL_COMMAND at COMMAND_PRIORITY_EDITOR", () => {
  const editor = makeEditor();
  const calls: Array<{
    command: LexicalCommand<unknown>;
    priority: CommandListenerPriority;
  }> = [];
  const originalRegisterCommand = editor.registerCommand.bind(editor);
  editor.registerCommand = ((
    command: LexicalCommand<unknown>,
    listener: (payload: unknown) => boolean,
    priority: CommandListenerPriority,
  ) => {
    calls.push({ command, priority });
    return originalRegisterCommand(command, listener, priority);
  }) as typeof editor.registerCommand;

  const mounted = mountPlugin(editor);
  try {
    assert.equal(calls.length, 1, "expected exactly one command registration");
    assert.equal(calls[0]?.command, INSERT_VISUAL_COMMAND);
    assert.equal(calls[0]?.priority, COMMAND_PRIORITY_EDITOR);
  } finally {
    mounted.unmount();
  }
});

// ---------------------------------------------------------------------------
// Valid payload — insertion + selection
// ---------------------------------------------------------------------------

test("dispatching with a valid payload inserts a VisualNode and reports the command handled", async () => {
  const editor = makeEditor((error) => {
    throw error;
  });
  editor.update(
    () => {
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode("intro"));
      $getRoot().clear().append(paragraph);
      paragraph.selectStart();
    },
    { discrete: true },
  );

  const mounted = mountPlugin(editor);
  try {
    let handled = false;
    await act(async () => {
      handled = editor.dispatchCommand(INSERT_VISUAL_COMMAND, {
        kind: "flowchart",
      });
      await flushMicrotasks();
    });

    assert.equal(handled, true, "the plugin's handler should report true");
    assert.deepEqual(rootChildTypes(editor), ["paragraph", "visual"]);
  } finally {
    mounted.unmount();
  }
});

test("dispatching selects the newly inserted VisualNode as a NodeSelection", async () => {
  const editor = makeEditor((error) => {
    throw error;
  });
  editor.update(
    () => {
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode("intro"));
      $getRoot().clear().append(paragraph);
      paragraph.selectStart();
    },
    { discrete: true },
  );

  const mounted = mountPlugin(editor);
  try {
    await act(async () => {
      editor.dispatchCommand(INSERT_VISUAL_COMMAND, { kind: "chart" });
      await flushMicrotasks();
    });

    editor.getEditorState().read(() => {
      const visual = $getRoot()
        .getChildren()
        .find((node): node is VisualNode => $isVisualNode(node));
      assert.ok(visual, "expected an inserted VisualNode");

      const selection = $getSelection();
      assert.ok(
        $isNodeSelection(selection),
        "selection should be a NodeSelection after insertion",
      );
      assert.deepEqual(selection.getNodes(), [visual]);
    });
  } finally {
    mounted.unmount();
  }
});

// ---------------------------------------------------------------------------
// afterNodeKey — input-dependent target resolution wiring
// ---------------------------------------------------------------------------

test("dispatching with an afterNodeKey inserts immediately after that node, not the current selection", async () => {
  const editor = makeEditor((error) => {
    throw error;
  });
  let firstKey = "";
  editor.update(
    () => {
      const first = $createParagraphNode();
      first.append($createTextNode("first"));
      const second = $createParagraphNode();
      second.append($createTextNode("second"));
      $getRoot().clear().append(first, second);
      firstKey = first.getKey();
      // Selection sits in the SECOND paragraph, but the payload explicitly
      // targets the first — the plugin must honor the explicit key.
      second.selectStart();
    },
    { discrete: true },
  );

  const mounted = mountPlugin(editor);
  try {
    await act(async () => {
      editor.dispatchCommand(INSERT_VISUAL_COMMAND, {
        kind: "flowchart",
        afterNodeKey: firstKey,
      } satisfies InsertVisualPayload);
      await flushMicrotasks();
    });

    assert.deepEqual(rootChildTypes(editor), [
      "paragraph",
      "visual",
      "paragraph",
    ]);
  } finally {
    mounted.unmount();
  }
});

// ---------------------------------------------------------------------------
// Invalid payload — no-op/error contract, not a thrown exception
// ---------------------------------------------------------------------------

test("dispatching with a runtime-invalid kind surfaces via onError, leaves the document unchanged, and still reports handled", () => {
  const errors: unknown[] = [];
  const editor = makeEditor((error) => {
    errors.push(error);
  });
  editor.update(
    () => {
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode("intro"));
      $getRoot().clear().append(paragraph);
      paragraph.selectStart();
    },
    { discrete: true },
  );

  const mounted = mountPlugin(editor);
  try {
    let handled = false;
    let threw = false;
    act(() => {
      try {
        handled = editor.dispatchCommand(INSERT_VISUAL_COMMAND, {
          kind: "not-a-real-kind",
        } as unknown as InsertVisualPayload);
      } catch {
        threw = true;
      }
    });

    assert.equal(
      threw,
      false,
      "an invalid payload must not throw synchronously out of dispatchCommand",
    );
    assert.equal(
      handled,
      true,
      "the handler still returns true (it always claims the command)",
    );
    assert.equal(
      errors.length,
      1,
      "the invalid kind should surface exactly once via the editor's onError",
    );
    assert.deepEqual(
      rootChildTypes(editor),
      ["paragraph"],
      "no VisualNode should have been inserted for an invalid kind",
    );
  } finally {
    mounted.unmount();
  }
});

// ---------------------------------------------------------------------------
// Unregister / cleanup
// ---------------------------------------------------------------------------

test("unmounting unregisters the command so a later dispatch is no longer handled", () => {
  const editor = makeEditor((error) => {
    throw error;
  });
  let unregisterCalls = 0;
  const originalRegisterCommand = editor.registerCommand.bind(editor);
  editor.registerCommand = ((
    ...args: Parameters<typeof editor.registerCommand>
  ) => {
    const unregister = originalRegisterCommand(...args);
    return () => {
      unregisterCalls += 1;
      unregister();
    };
  }) as typeof editor.registerCommand;

  editor.update(
    () => {
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode("intro"));
      $getRoot().clear().append(paragraph);
      paragraph.selectStart();
    },
    { discrete: true },
  );

  const mounted = mountPlugin(editor);
  assert.equal(unregisterCalls, 0);

  mounted.unmount();
  assert.equal(unregisterCalls, 1);

  let handledAfterUnmount = false;
  act(() => {
    handledAfterUnmount = editor.dispatchCommand(INSERT_VISUAL_COMMAND, {
      kind: "flowchart",
    });
  });

  assert.equal(
    handledAfterUnmount,
    false,
    "no listener should remain registered after unmount",
  );
  assert.deepEqual(
    rootChildTypes(editor),
    ["paragraph"],
    "no VisualNode should be inserted once the plugin is unmounted",
  );
});
