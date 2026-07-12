/**
 * Direct contracts for `EditorContextProvider` / `useEditorContext` (#1929).
 *
 * `editor-context.test.ts` already exercises `readSelectionDescriptor` and
 * `stableSelectionSnapshot` (the pure Lexical-state reader re-exported from
 * `selection-snapshot.ts`) against a headless editor. This file instead
 * covers the React/DOM boundary `EditorContextProvider` adds on top: the
 * default context returned outside any provider, the initial snapshot for a
 * freshly mounted provider, that editor updates/editable changes/selection
 * commands each trigger a recompute, DOM-rect derivation for the active
 * block and range selection, and that unmounting tears down every listener
 * and command registration it installed.
 *
 * A real `@lexical/headless` editor stands in as the typed Lexical fake (its
 * `getElementByKey`/`getRootElement` are monkey-patched per test only where a
 * DOM rect needs to be observed — headless editors have no real DOM). Because
 * `EditorContextProvider` needs to react to *live* updates (not just an
 * initial render), this file mounts it directly with `react-test-renderer`'s
 * `act`/`create`/`update` rather than the shared harness's `run()` (which
 * never mounts what it builds) or `renderWithTestRenderer` (which unmounts
 * immediately after one render). Importing `createReactRenderHarness` here is
 * for its module-level side effects only: it flips on
 * `IS_REACT_ACT_ENVIRONMENT` and installs the `document`/`window` stubs that
 * `EditorContextProvider`'s effect needs (`addEventListener`,
 * `getSelection`, `requestAnimationFrame`, ...).
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
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  SELECTION_CHANGE_COMMAND,
  type LexicalEditor,
} from "lexical";

// Side effect only: sets IS_REACT_ACT_ENVIRONMENT and (on first use) the
// document/window stubs EditorContextProvider's effect depends on.
import { createReactRenderHarness } from "@/test/react-render-harness";

import {
  EditorContextProvider,
  useEditorContext,
  type EditorContextSnapshot,
} from "./editor-context";

// Prime the shared document/window stubs once, without mounting anything of
// our own through it (see the file header for why this file drives its own
// `act`/`create`/`update` instead of the harness's `run()`).
createReactRenderHarness().run(() => null);

/**
 * A headless editor with `getRootElement`/`getElementByKey` stubbed to `null`
 * (their real headless implementations *throw* "not supported in headless
 * mode" rather than returning `null` the way a real, unmounted browser editor
 * would) — matching the DOM-less baseline `EditorContextProvider`'s effect
 * must tolerate. Individual tests override either method further to observe
 * the DOM-derived branches.
 */
function makeEditor(): LexicalEditor {
  const editor = createHeadlessEditor({
    namespace: "editor-context-provider-test",
    onError(error) {
      throw error;
    },
  });
  editor.getRootElement = (() => null) as typeof editor.getRootElement;
  editor.getElementByKey = (() => null) as typeof editor.getElementByKey;
  return editor;
}

type Mounted = {
  latest(): EditorContextSnapshot;
  rerender(): void;
  unmount(): void;
};

function mountProvider(editor: LexicalEditor): Mounted {
  const composerContext: LexicalComposerContextWithEditor = [
    editor,
    createLexicalComposerContext(null, null),
  ];
  const seen: EditorContextSnapshot[] = [];

  function Inner() {
    seen.push(useEditorContext());
    return null;
  }

  const buildElement = () =>
    createElement(
      LexicalComposerContext.Provider,
      { value: composerContext },
      createElement(EditorContextProvider, null, createElement(Inner)),
    );

  let renderer: ReactTestRenderer | null = null;
  act(() => {
    renderer = create(buildElement());
  });

  return {
    latest: () => {
      assert.ok(seen.length > 0, "expected the provider to have rendered");
      return seen[seen.length - 1] as EditorContextSnapshot;
    },
    rerender: () => {
      act(() => {
        renderer?.update(buildElement());
      });
    },
    unmount: () => {
      act(() => {
        renderer?.unmount();
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Guard — no provider ancestor
// ---------------------------------------------------------------------------

test("useEditorContext outside any provider returns the none/uneditable default", () => {
  const harness = createReactRenderHarness();
  try {
    const snapshot = harness.run(() => useEditorContext());

    assert.equal(snapshot.kind, "none");
    assert.equal(snapshot.editable, false);
    assert.equal(snapshot.isCollapsed, true);
    assert.equal(snapshot.isEmptyBlock, false);
    assert.equal(snapshot.activeFormats.size, 0);
    assert.deepEqual(snapshot.rects, { selection: null, block: null });
  } finally {
    harness.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Defaults — freshly mounted provider, untouched editor
// ---------------------------------------------------------------------------

test("EditorContextProvider's initial snapshot reflects the editor's real default state", () => {
  const editor = makeEditor();
  const mounted = mountProvider(editor);
  try {
    const snapshot = mounted.latest();

    assert.equal(snapshot.kind, "none");
    assert.equal(snapshot.editable, editor.isEditable());
    assert.equal(snapshot.editable, true);
    assert.deepEqual(snapshot.rects, { selection: null, block: null });
  } finally {
    mounted.unmount();
  }
});

// ---------------------------------------------------------------------------
// Recompute triggers
// ---------------------------------------------------------------------------

test("an editor update recomputes the snapshot via registerUpdateListener", () => {
  const editor = makeEditor();
  const mounted = mountProvider(editor);
  try {
    assert.equal(mounted.latest().kind, "none");

    act(() => {
      editor.update(
        () => {
          const paragraph = $createParagraphNode();
          const text = $createTextNode("Hello");
          paragraph.append(text);
          $getRoot().clear().append(paragraph);
          text.select(1, 1);
        },
        { discrete: true },
      );
    });

    const snapshot = mounted.latest();
    assert.equal(snapshot.kind, "collapsed");
    assert.equal(snapshot.blockText, "Hello");
  } finally {
    mounted.unmount();
  }
});

test("editor.setEditable recomputes the snapshot via registerEditableListener", () => {
  const editor = makeEditor();
  const mounted = mountProvider(editor);
  try {
    assert.equal(mounted.latest().editable, true);

    act(() => {
      editor.setEditable(false);
    });

    assert.equal(mounted.latest().editable, false);
  } finally {
    mounted.unmount();
  }
});

test("dispatching SELECTION_CHANGE_COMMAND recomputes without altering the descriptor", () => {
  const editor = makeEditor();
  const mounted = mountProvider(editor);
  try {
    act(() => {
      editor.update(
        () => {
          const paragraph = $createParagraphNode();
          const text = $createTextNode("Dispatch me");
          paragraph.append(text);
          $getRoot().clear().append(paragraph);
          text.select(0, 0);
        },
        { discrete: true },
      );
    });
    const beforeDispatch = mounted.latest();

    act(() => {
      editor.dispatchCommand(SELECTION_CHANGE_COMMAND, undefined);
    });

    assert.deepEqual(mounted.latest(), beforeDispatch);
  } finally {
    mounted.unmount();
  }
});

// ---------------------------------------------------------------------------
// DOM rect derivation
// ---------------------------------------------------------------------------

test("blockRect is derived from editor.getElementByKey when the active block has a DOM element", () => {
  const editor = makeEditor();
  const fakeRect = {
    top: 1,
    left: 2,
    right: 3,
    bottom: 4,
    width: 5,
    height: 6,
    x: 2,
    y: 1,
    toJSON: () => ({}),
  };
  editor.getElementByKey = (() =>
    ({
      getBoundingClientRect: () => fakeRect,
    }) as unknown as HTMLElement) as typeof editor.getElementByKey;

  const mounted = mountProvider(editor);
  try {
    act(() => {
      editor.update(
        () => {
          const paragraph = $createParagraphNode();
          const text = $createTextNode("Block rect");
          paragraph.append(text);
          $getRoot().clear().append(paragraph);
          text.select(0, 0);
        },
        { discrete: true },
      );
    });

    const snapshot = mounted.latest();
    assert.ok(snapshot.blockKey, "expected a live blockKey");
    assert.deepEqual(snapshot.rects.block, {
      top: 1,
      left: 2,
      right: 3,
      bottom: 4,
      width: 5,
      height: 6,
    });
  } finally {
    mounted.unmount();
  }
});

test("selectionRect stays null when the kind isn't 'range', even if a native selection exists", () => {
  const editor = makeEditor();
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
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
      }),
    }),
  });

  const mounted = mountProvider(editor);
  try {
    act(() => {
      editor.update(
        () => {
          const paragraph = $createParagraphNode();
          const text = $createTextNode("Collapsed");
          paragraph.append(text);
          $getRoot().clear().append(paragraph);
          text.select(0, 0);
        },
        { discrete: true },
      );
    });

    const snapshot = mounted.latest();
    assert.equal(snapshot.kind, "collapsed");
    assert.equal(snapshot.rects.selection, null);
  } finally {
    fakeWindow.getSelection = originalGetSelection;
    mounted.unmount();
  }
});

test("selectionRect is derived for a 'range' kind when the native selection sits inside the editor root", () => {
  const editor = makeEditor();
  const fakeRootElement = {
    contains: () => true,
  } as unknown as HTMLElement;
  editor.getRootElement = (() =>
    fakeRootElement) as typeof editor.getRootElement;

  const fakeWindow = globalThis.window as unknown as {
    getSelection: () => unknown;
  };
  const originalGetSelection = fakeWindow.getSelection;
  const fakeRect = {
    top: 10,
    left: 20,
    right: 30,
    bottom: 40,
    width: 10,
    height: 30,
  };
  fakeWindow.getSelection = () => ({
    rangeCount: 1,
    isCollapsed: false,
    anchorNode: {},
    getRangeAt: () => ({ getBoundingClientRect: () => fakeRect }),
  });

  const mounted = mountProvider(editor);
  try {
    act(() => {
      editor.update(
        () => {
          const paragraph = $createParagraphNode();
          const text = $createTextNode("Range select");
          paragraph.append(text);
          $getRoot().clear().append(paragraph);
          text.select(0, 5);
        },
        { discrete: true },
      );
    });

    const snapshot = mounted.latest();
    assert.equal(snapshot.kind, "range");
    assert.deepEqual(snapshot.rects.selection, fakeRect);
  } finally {
    fakeWindow.getSelection = originalGetSelection;
    mounted.unmount();
  }
});

test("selectionRect stays null when the native anchor node sits outside the editor root", () => {
  const editor = makeEditor();
  const fakeRootElement = { contains: () => false } as unknown as HTMLElement;
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
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
      }),
    }),
  });

  const mounted = mountProvider(editor);
  try {
    act(() => {
      editor.update(
        () => {
          const paragraph = $createParagraphNode();
          const text = $createTextNode("Outside root");
          paragraph.append(text);
          $getRoot().clear().append(paragraph);
          text.select(0, 5);
        },
        { discrete: true },
      );
    });

    const snapshot = mounted.latest();
    assert.equal(snapshot.kind, "range");
    assert.equal(snapshot.rects.selection, null);
  } finally {
    fakeWindow.getSelection = originalGetSelection;
    mounted.unmount();
  }
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

test("unmounting tears down the update listener, command, editable listener, and DOM listeners", () => {
  const editor = makeEditor();

  let updateUnregisterCalls = 0;
  const originalRegisterUpdateListener =
    editor.registerUpdateListener.bind(editor);
  editor.registerUpdateListener = ((
    listener: Parameters<typeof editor.registerUpdateListener>[0],
  ) => {
    const unregister = originalRegisterUpdateListener(listener);
    return () => {
      updateUnregisterCalls += 1;
      unregister();
    };
  }) as typeof editor.registerUpdateListener;

  let editableUnregisterCalls = 0;
  const originalRegisterEditableListener =
    editor.registerEditableListener.bind(editor);
  editor.registerEditableListener = ((
    listener: Parameters<typeof editor.registerEditableListener>[0],
  ) => {
    const unregister = originalRegisterEditableListener(listener);
    return () => {
      editableUnregisterCalls += 1;
      unregister();
    };
  }) as typeof editor.registerEditableListener;

  let commandUnregisterCalls = 0;
  const originalRegisterCommand = editor.registerCommand.bind(editor);
  editor.registerCommand = ((
    ...args: Parameters<typeof editor.registerCommand>
  ) => {
    const unregister = originalRegisterCommand(...args);
    return () => {
      commandUnregisterCalls += 1;
      unregister();
    };
  }) as typeof editor.registerCommand;

  const fakeDocument = globalThis.document as unknown as {
    addEventListener: (...args: unknown[]) => void;
    removeEventListener: (...args: unknown[]) => void;
  };
  const fakeWindow = globalThis.window as unknown as {
    addEventListener: (...args: unknown[]) => void;
    removeEventListener: (...args: unknown[]) => void;
  };
  let documentAdds = 0;
  let documentRemoves = 0;
  let windowAdds = 0;
  let windowRemoves = 0;
  const originalDocAdd = fakeDocument.addEventListener;
  const originalDocRemove = fakeDocument.removeEventListener;
  const originalWinAdd = fakeWindow.addEventListener;
  const originalWinRemove = fakeWindow.removeEventListener;
  fakeDocument.addEventListener = (...args: unknown[]) => {
    documentAdds += 1;
    return originalDocAdd.apply(fakeDocument, args as never);
  };
  fakeDocument.removeEventListener = (...args: unknown[]) => {
    documentRemoves += 1;
    return originalDocRemove.apply(fakeDocument, args as never);
  };
  fakeWindow.addEventListener = (...args: unknown[]) => {
    windowAdds += 1;
    return originalWinAdd.apply(fakeWindow, args as never);
  };
  fakeWindow.removeEventListener = (...args: unknown[]) => {
    windowRemoves += 1;
    return originalWinRemove.apply(fakeWindow, args as never);
  };

  try {
    const mounted = mountProvider(editor);
    // rerender before unmount to prove the listeners aren't re-installed on
    // every render (React's effect dependency array is `[editor]`).
    mounted.rerender();

    assert.equal(updateUnregisterCalls, 0);
    assert.equal(editableUnregisterCalls, 0);
    assert.equal(commandUnregisterCalls, 0);

    mounted.unmount();

    assert.equal(updateUnregisterCalls, 1);
    assert.equal(editableUnregisterCalls, 1);
    assert.equal(commandUnregisterCalls, 1);
    assert.equal(documentAdds, 1);
    assert.equal(documentRemoves, 1);
    assert.equal(windowAdds, 2); // resize + scroll
    assert.equal(windowRemoves, 2);
  } finally {
    fakeDocument.addEventListener = originalDocAdd;
    fakeDocument.removeEventListener = originalDocRemove;
    fakeWindow.addEventListener = originalWinAdd;
    fakeWindow.removeEventListener = originalWinRemove;
  }
});
