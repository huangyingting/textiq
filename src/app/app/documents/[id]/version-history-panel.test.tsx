/**
 * Direct behavior coverage for `VersionHistoryPanel` (#1961) — the editor's
 * version-history side panel: lazy-load-on-open, refresh, empty/loading/error
 * states, and per-row restore confirmation (confirm/cancel/success/error).
 *
 * `listDocumentVersions`/`restoreDocumentVersion` (`./actions` →
 * `./versioning-actions`) are already fully covered by
 * `server-actions.test.ts`, so `"./actions"` is stubbed via the shared
 * `@/test/module-stub` helper — this file only asserts *which* action the
 * panel calls, with what arguments, and how it renders the result (or a
 * surfaced error).
 *
 * `VersionHistoryPanel` only reads Lexical through `useLexicalComposerContext`
 * (`editor.parseEditorState`/`editor.setEditorState`), so a real
 * `@lexical/headless` editor wired into a `LexicalComposerContext.Provider`
 * (the same pattern `document-export-button.test.tsx` and
 * `use-insert-imported-markdown.test.ts` use) is enough to mount it for real
 * — no jsdom, no `lexical-editor.tsx`.
 *
 * Uses `@/test/portal-dom`'s `withPortalDom`/`mountWithPortalDom`:
 * `EditorSidePanel` unconditionally `createPortal`s to `document.body` once
 * open, and `EditorToolbarButton` renders a `Tooltip` — both need the fake
 * portal DOM. This file does not re-test `EditorSidePanel`'s own portal
 * contract (title/actions/`role="dialog"` rendering) — that's covered by
 * `side-panel.test.tsx`.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { act } from "react-test-renderer";

import { createHeadlessEditor } from "@lexical/headless";
import {
  createLexicalComposerContext,
  LexicalComposerContext,
  type LexicalComposerContextWithEditor,
} from "@lexical/react/LexicalComposerContext";
import type { LexicalEditor } from "lexical";
import { $createParagraphNode, $createTextNode, $getRoot } from "lexical";

import { mountWithPortalDom, withPortalDom } from "@/test/portal-dom";
import { textOf, waitForAsyncDrain } from "@/test/render-text";
import { stubModule } from "@/test/module-stub";
import type { DocumentVersionSummary } from "@/lib/document/persistence-types";
import { RESTORE_TAG } from "@/lib/content";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

type ActionsTestState = {
  listCalls: string[];
  restoreCalls: string[];
  listImpl: (documentId: string) => Promise<DocumentVersionSummary[]>;
  restoreImpl: (
    versionId: string,
  ) => Promise<ActionResult<{ documentId: string; contentJson: unknown }>>;
};
const globalForActions = globalThis as typeof globalThis & {
  __versionHistoryActionsTestState: ActionsTestState;
};

function resetActionsState(): void {
  globalForActions.__versionHistoryActionsTestState = {
    listCalls: [],
    restoreCalls: [],
    listImpl: async () => [],
    restoreImpl: async () => ({
      ok: true,
      data: { documentId: "doc-1", contentJson: null },
    }),
  };
}
resetActionsState();

stubModule(
  "./actions",
  `module.exports = {
  listDocumentVersions: async (documentId) => {
    const s = globalThis.__versionHistoryActionsTestState;
    s.listCalls.push(documentId);
    return s.listImpl(documentId);
  },
  restoreDocumentVersion: async (versionId) => {
    const s = globalThis.__versionHistoryActionsTestState;
    s.restoreCalls.push(versionId);
    return s.restoreImpl(versionId);
  },
};`,
);

stubModule(
  "next/navigation",
  `module.exports = {
  unstable_rethrow(error) {
    if (
      error &&
      typeof error === "object" &&
      typeof error.digest === "string" &&
      (error.digest.startsWith("NEXT_REDIRECT") ||
        error.digest.startsWith("NEXT_HTTP_ERROR_FALLBACK"))
    ) {
      throw error;
    }
  },
};`,
);

const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const [message] = args;
  if (
    typeof message === "string" &&
    message.startsWith("react-test-renderer is deprecated")
  ) {
    return;
  }
  originalConsoleError(...args);
};
after(() => {
  console.error = originalConsoleError;
});

// Dynamically imported (in `before`, after the `stubModule` call above)
// rather than statically at the top of this file: static imports of a whole
// dependency subtree resolve *before* any of this file's own top-level
// statements run, which would load the real `"use server"` `"./actions"`
// instead of the stub.
let VersionHistoryPanel: typeof import("./version-history-panel").VersionHistoryPanel;
before(async () => {
  VersionHistoryPanel = (await import("./version-history-panel"))
    .VersionHistoryPanel;
});

beforeEach(resetActionsState);

function makeEditor(): LexicalEditor {
  return createHeadlessEditor({
    namespace: "version-history-panel-test",
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

function version(
  overrides: Partial<DocumentVersionSummary> = {},
): DocumentVersionSummary {
  return {
    id: "v1",
    createdAt: "2026-01-01T10:00:00.000Z",
    label: null,
    authorName: null,
    hasDeck: false,
    ...overrides,
  };
}

function mount(
  editor: LexicalEditor,
  props: { documentId?: string; canEdit?: boolean; iconOnly?: boolean } = {},
) {
  return mountWithPortalDom(
    <LexicalComposerContext.Provider value={composerContextFor(editor)}>
      <VersionHistoryPanel
        documentId={props.documentId ?? "doc-1"}
        canEdit={props.canEdit ?? true}
        iconOnly={props.iconOnly}
      />
    </LexicalComposerContext.Provider>,
  );
}

function findByAria(
  root: import("react-test-renderer").ReactTestInstance,
  label: string,
) {
  return root.find(
    (node) =>
      node.props["aria-label"] === label && typeof node.type === "string",
  );
}

describe("VersionHistoryPanel", () => {
  test("renders only the trigger button when closed; opening it lazily loads versions once", async () => {
    await withPortalDom(async () => {
      globalForActions.__versionHistoryActionsTestState.listImpl = async () => [
        version({ id: "v1", label: "Draft 1", authorName: "Ada" }),
      ];
      const renderer = mount(makeEditor(), { documentId: "doc-42" });
      try {
        assert.throws(() => renderer.root.findByProps({ role: "dialog" }));

        const trigger = findByAria(renderer.root, "Version history");
        act(() => {
          (trigger.props.onClick as () => void)();
        });
        assert.match(textOf(renderer.root), /Loading…/);

        await act(async () => {
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });

        assert.deepEqual(
          globalForActions.__versionHistoryActionsTestState.listCalls,
          ["doc-42"],
        );
        assert.match(textOf(renderer.root), /Draft 1/);
        assert.match(textOf(renderer.root), /Ada/);

        // Close then reopen: already `loaded`, so no second fetch. Both
        // clicks are wrapped together with a drain in the same act() because
        // the earlier `refresh()` transition can still be settling; a plain
        // sync act() around just the click can leave the toggle applied to a
        // not-yet-committed render.
        await act(async () => {
          (
            findByAria(renderer.root, "Close version history").props
              .onClick as () => void
          )();
          await waitForAsyncDrain();
        });
        assert.throws(() => renderer.root.findByProps({ role: "dialog" }));
        const reopenTrigger = findByAria(renderer.root, "Version history");
        await act(async () => {
          (reopenTrigger.props.onClick as () => void)();
          await waitForAsyncDrain();
        });
        assert.deepEqual(
          globalForActions.__versionHistoryActionsTestState.listCalls,
          ["doc-42"],
        );
        assert.match(textOf(renderer.root), /Draft 1/);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("Refresh re-calls listDocumentVersions and disables itself while pending", async () => {
    await withPortalDom(async () => {
      globalForActions.__versionHistoryActionsTestState.listImpl = async () => [
        version({ id: "v1" }),
      ];
      const renderer = mount(makeEditor());
      try {
        act(() => {
          (
            findByAria(renderer.root, "Version history").props
              .onClick as () => void
          )();
        });
        await act(async () => {
          await waitForAsyncDrain();
        });

        let resolveRefresh!: (value: DocumentVersionSummary[]) => void;
        globalForActions.__versionHistoryActionsTestState.listImpl = () =>
          new Promise((resolve) => {
            resolveRefresh = resolve;
          });

        const refreshButton = findByAria(
          renderer.root,
          "Refresh version history",
        );
        let pendingCall!: unknown;
        act(() => {
          pendingCall = refreshButton.props.onClick();
        });
        assert.equal(
          findByAria(renderer.root, "Refresh version history").props.disabled,
          true,
        );

        resolveRefresh([version({ id: "v2", label: "Draft 2" })]);
        await act(async () => {
          await pendingCall;
          await waitForAsyncDrain();
        });

        assert.deepEqual(
          globalForActions.__versionHistoryActionsTestState.listCalls,
          ["doc-1", "doc-1"],
        );
        assert.match(textOf(renderer.root), /Draft 2/);
        assert.equal(
          findByAria(renderer.root, "Refresh version history").props.disabled,
          false,
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("an empty version list shows the no-versions-yet copy", async () => {
    await withPortalDom(async () => {
      const renderer = mount(makeEditor());
      try {
        act(() => {
          (
            findByAria(renderer.root, "Version history").props
              .onClick as () => void
          )();
        });
        await act(async () => {
          await waitForAsyncDrain();
        });

        assert.match(textOf(renderer.root), /No saved versions yet/);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("a failed load shows an alert instead of the list", async () => {
    await withPortalDom(async () => {
      globalForActions.__versionHistoryActionsTestState.listImpl = async () => {
        throw new Error("network down");
      };
      const renderer = mount(makeEditor());
      try {
        act(() => {
          (
            findByAria(renderer.root, "Version history").props
              .onClick as () => void
          )();
        });
        await act(async () => {
          await waitForAsyncDrain();
        });

        assert.match(
          textOf(renderer.root.findByProps({ role: "alert" })),
          /Couldn't load version history\. Please try again\./,
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("framework redirect control flow escapes load failure recovery", async () => {
    await withPortalDom(async () => {
      const redirectError = Object.assign(new Error("NEXT_REDIRECT"), {
        digest: "NEXT_REDIRECT;push;/login;307;",
      });
      globalForActions.__versionHistoryActionsTestState.listImpl = async () => {
        throw redirectError;
      };
      const renderer = mount(makeEditor());
      try {
        await assert.rejects(
          async () => {
            await act(async () => {
              findByAria(renderer.root, "Version history").props.onClick();
              await waitForAsyncDrain();
              await waitForAsyncDrain();
            });
          },
          (error: unknown) => error === redirectError,
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("canEdit=false hides restore controls for every row", async () => {
    await withPortalDom(async () => {
      globalForActions.__versionHistoryActionsTestState.listImpl = async () => [
        version({ id: "v1", label: "Draft 1" }),
        version({ id: "v2", label: "Draft 2" }),
      ];
      const renderer = mount(makeEditor(), { canEdit: false });
      try {
        act(() => {
          (
            findByAria(renderer.root, "Version history").props
              .onClick as () => void
          )();
        });
        await act(async () => {
          await waitForAsyncDrain();
        });

        assert.throws(() =>
          renderer.root.findByProps({ "aria-label": "Restore this version" }),
        );
        assert.equal(
          renderer.root.findAllByProps({ "aria-label": "Restore this version" })
            .length,
          0,
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("Restore shows Confirm/Cancel; Cancel reverts without calling restoreDocumentVersion", async () => {
    await withPortalDom(async () => {
      globalForActions.__versionHistoryActionsTestState.listImpl = async () => [
        version({ id: "v1" }),
      ];
      const renderer = mount(makeEditor());
      try {
        act(() => {
          (
            findByAria(renderer.root, "Version history").props
              .onClick as () => void
          )();
        });
        await act(async () => {
          await waitForAsyncDrain();
        });

        await act(async () => {
          (
            renderer.root.findByProps({ "aria-label": "Restore this version" })
              .props.onClick as () => void
          )();
          await waitForAsyncDrain();
        });
        assert.ok(
          renderer.root.findByProps({ "aria-label": "Confirm restore" }),
        );

        await act(async () => {
          (
            renderer.root.findByProps({ "aria-label": "Cancel restore" }).props
              .onClick as () => void
          )();
          await waitForAsyncDrain();
        });
        assert.ok(
          renderer.root.findByProps({ "aria-label": "Restore this version" }),
        );
        assert.deepEqual(
          globalForActions.__versionHistoryActionsTestState.restoreCalls,
          [],
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("confirming a restore calls restoreDocumentVersion, applies the parsed state via setEditorState with RESTORE_TAG, and closes the panel", async () => {
    await withPortalDom(async () => {
      const editor = makeEditor();
      const setEditorStateCalls: Array<{ tag?: string }> = [];
      const originalSetEditorState = editor.setEditorState.bind(editor);
      editor.setEditorState = ((state, options) => {
        setEditorStateCalls.push({ tag: options?.tag });
        return originalSetEditorState(state, options);
      }) as typeof editor.setEditorState;

      // A valid restored state needs a non-empty root (Lexical rejects an
      // empty root in `setEditorState`), so seed one real paragraph/text node
      // rather than reusing the editor's own (empty) initial state.
      editor.update(
        () => {
          const paragraph = $createParagraphNode().append(
            $createTextNode("Restored content"),
          );
          $getRoot().append(paragraph);
        },
        { discrete: true },
      );
      const restoredJson = editor.getEditorState().toJSON();

      globalForActions.__versionHistoryActionsTestState.listImpl = async () => [
        version({ id: "v1" }),
      ];
      globalForActions.__versionHistoryActionsTestState.restoreImpl =
        async () => ({
          ok: true,
          data: { documentId: "doc-1", contentJson: restoredJson },
        });

      const renderer = mount(editor);
      try {
        act(() => {
          (
            findByAria(renderer.root, "Version history").props
              .onClick as () => void
          )();
        });
        await act(async () => {
          await waitForAsyncDrain();
        });

        await act(async () => {
          (
            renderer.root.findByProps({ "aria-label": "Restore this version" })
              .props.onClick as () => void
          )();
          await waitForAsyncDrain();
        });
        await act(async () => {
          (
            renderer.root.findByProps({ "aria-label": "Confirm restore" }).props
              .onClick as () => void
          )();
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });
        await act(async () => {
          await waitForAsyncDrain();
        });

        assert.deepEqual(
          globalForActions.__versionHistoryActionsTestState.restoreCalls,
          ["v1"],
        );
        assert.deepEqual(setEditorStateCalls, [{ tag: RESTORE_TAG }]);
        // The panel closes on a successful restore.
        assert.throws(() => renderer.root.findByProps({ role: "dialog" }));
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("repeated restore confirmation issues one mutation and locks panel dismissal while pending", async () => {
    await withPortalDom(async () => {
      globalForActions.__versionHistoryActionsTestState.listImpl = async () => [
        version({ id: "v1" }),
      ];
      let rejectRestore!: (error: Error) => void;
      globalForActions.__versionHistoryActionsTestState.restoreImpl = () =>
        new Promise((_resolve, reject) => {
          rejectRestore = reject;
        });

      const renderer = mount(makeEditor());
      try {
        act(() => {
          findByAria(renderer.root, "Version history").props.onClick();
        });
        await act(async () => {
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });
        await act(async () => {
          renderer.root
            .findByProps({ "aria-label": "Restore this version" })
            .props.onClick();
          await waitForAsyncDrain();
        });
        const confirm = renderer.root.findByProps({
          "aria-label": "Confirm restore",
        });
        await act(async () => {
          confirm.props.onClick();
          confirm.props.onClick();
          await waitForAsyncDrain();
        });

        assert.deepEqual(
          globalForActions.__versionHistoryActionsTestState.restoreCalls,
          ["v1"],
        );
        assert.equal(
          renderer.root.findByProps({ "aria-label": "Confirm restore" }).props
            .disabled,
          true,
        );
        assert.equal(
          renderer.root.findByProps({ role: "dialog" }).props["aria-busy"],
          true,
        );
        assert.equal(
          findByAria(renderer.root, "Close version history").props.disabled,
          true,
        );
        findByAria(renderer.root, "Close version history").props.onClick();
        assert.ok(renderer.root.findByProps({ role: "dialog" }));

        await act(async () => {
          rejectRestore(new Error("temporary outage"));
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });
        assert.match(
          textOf(renderer.root.findByProps({ role: "alert" })),
          /Couldn't restore this version\. Please try again\./,
        );
        assert.ok(
          renderer.root.findByProps({ "aria-label": "Try restore again" }),
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("a server-declined restore surfaces the error, keeps retry confirmation, and leaves the panel open", async () => {
    await withPortalDom(async () => {
      globalForActions.__versionHistoryActionsTestState.listImpl = async () => [
        version({ id: "v1" }),
      ];
      globalForActions.__versionHistoryActionsTestState.restoreImpl =
        async () => ({
          ok: false,
          error: "This version was already superseded.",
        });

      const renderer = mount(makeEditor());
      try {
        act(() => {
          (
            findByAria(renderer.root, "Version history").props
              .onClick as () => void
          )();
        });
        await act(async () => {
          await waitForAsyncDrain();
        });

        await act(async () => {
          (
            renderer.root.findByProps({ "aria-label": "Restore this version" })
              .props.onClick as () => void
          )();
          await waitForAsyncDrain();
        });
        await act(async () => {
          (
            renderer.root.findByProps({ "aria-label": "Confirm restore" }).props
              .onClick as () => void
          )();
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });

        assert.match(
          textOf(renderer.root.findByProps({ role: "alert" })),
          /This version was already superseded\./,
        );
        assert.ok(
          renderer.root.findByProps({ "aria-label": "Try restore again" }),
        );
        assert.ok(renderer.root.findByProps({ role: "dialog" }));
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("a thrown restore error is caught, shown as an alert, and keeps retry confirmation", async () => {
    await withPortalDom(async () => {
      globalForActions.__versionHistoryActionsTestState.listImpl = async () => [
        version({ id: "v1" }),
      ];
      globalForActions.__versionHistoryActionsTestState.restoreImpl =
        async () => {
          throw new Error("boom");
        };

      const renderer = mount(makeEditor());
      try {
        act(() => {
          (
            findByAria(renderer.root, "Version history").props
              .onClick as () => void
          )();
        });
        await act(async () => {
          await waitForAsyncDrain();
        });

        await act(async () => {
          (
            renderer.root.findByProps({ "aria-label": "Restore this version" })
              .props.onClick as () => void
          )();
          await waitForAsyncDrain();
        });
        await act(async () => {
          (
            renderer.root.findByProps({ "aria-label": "Confirm restore" }).props
              .onClick as () => void
          )();
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });

        assert.match(
          textOf(renderer.root.findByProps({ role: "alert" })),
          /Couldn't restore this version\. Please try again\./,
        );
        assert.ok(
          renderer.root.findByProps({ "aria-label": "Try restore again" }),
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("framework redirect control flow escapes restore failure recovery", async () => {
    await withPortalDom(async () => {
      const redirectError = Object.assign(new Error("NEXT_REDIRECT"), {
        digest: "NEXT_REDIRECT;push;/login;307;",
      });
      globalForActions.__versionHistoryActionsTestState.listImpl = async () => [
        version({ id: "v1" }),
      ];
      globalForActions.__versionHistoryActionsTestState.restoreImpl =
        async () => {
          throw redirectError;
        };
      const renderer = mount(makeEditor());
      try {
        act(() => {
          findByAria(renderer.root, "Version history").props.onClick();
        });
        await act(async () => {
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });
        await act(async () => {
          renderer.root
            .findByProps({ "aria-label": "Restore this version" })
            .props.onClick();
          await waitForAsyncDrain();
        });

        await assert.rejects(
          async () => {
            await act(async () => {
              renderer.root
                .findByProps({ "aria-label": "Confirm restore" })
                .props.onClick();
              await waitForAsyncDrain();
              await waitForAsyncDrain();
            });
          },
          (error: unknown) => error === redirectError,
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });
});
