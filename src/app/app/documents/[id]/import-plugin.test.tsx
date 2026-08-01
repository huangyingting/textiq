/**
 * Direct behavior coverage for `ImportPlugin` (#1958).
 *
 * `ImportPlugin` wires three already-independently-tested collaborators
 * (`ImportButton` + editor import workflow's upload/parse flow,
 * `resolveImportStep`'s pure empty/confirmed decision, and
 * `useInsertImportedMarkdown`'s markdown->Lexical-state replacement) into one
 * plugin-level contract: an empty document imports immediately, a non-empty
 * document is held pending behind a confirm dialog, and only a confirmed (or
 * empty-document) import ever mutates the editor. This file drives that
 * contract directly — importing the real `ImportButton` and calling the
 * `onImport` prop it receives from `ImportPlugin` (rather than driving its
 * file input, which is `document-import-workflow.test.ts`'s job) — and
 * verifies the resulting Lexical editor state and dialog visibility on a real
 * `@lexical/headless` editor.
 */
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { createElement } from "react";
import { act, type ReactTestRenderer } from "react-test-renderer";
import { LexicalComposerContext } from "@lexical/react/LexicalComposerContext";

import {
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  type LexicalEditor,
} from "lexical";

import {
  installFakeDom,
  makeHeadlessEditor,
  mountWithComposer,
  composerContextFor,
  createDeferred,
  unmount,
  waitForAsyncDrain,
} from "@/test/lexical-component-harness";

import { ImportPlugin } from "./import-plugin";

const importFileStub = async () => ({
  ok: true as const,
  data: { markdown: "" },
});

function makeEditor(): LexicalEditor {
  return makeHeadlessEditor({ namespace: "import-plugin-test" });
}

function rootText(editor: LexicalEditor): string {
  return editor.getEditorState().read(() => $getRoot().getTextContent());
}

function fillWithText(editor: LexicalEditor, text: string) {
  act(() => {
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode(text));
        $getRoot().clear().append(paragraph);
      },
      { discrete: true },
    );
  });
}

function findImportButton(renderer: ReactTestRenderer) {
  return renderer.root.find(
    (instance) =>
      typeof instance.type === "function" &&
      instance.type.name === "ImportButton",
  );
}

function findDialog(renderer: ReactTestRenderer) {
  return renderer.root.findAll(
    (instance) => instance.type === "div" && instance.props.role === "dialog",
  );
}

function findFileInput(renderer: ReactTestRenderer) {
  return renderer.root.findByProps({
    "aria-label": "Import document file",
  });
}

function findToolbarImportButton(renderer: ReactTestRenderer) {
  return renderer.root.find(
    (instance) =>
      instance.type === "button" && instance.props["aria-label"] === "Import",
  );
}

function updatePlugin(
  renderer: ReactTestRenderer,
  editor: LexicalEditor,
  documentId: string,
  importFile: Parameters<typeof ImportPlugin>[0]["importFile"],
) {
  act(() => {
    renderer.update(
      createElement(
        LexicalComposerContext.Provider,
        { value: composerContextFor(editor) },
        createElement(ImportPlugin, { documentId, importFile }),
      ),
    );
  });
}

function triggerImport(renderer: ReactTestRenderer, markdown: string) {
  act(() => {
    findImportButton(renderer).props.onImport(markdown);
  });
}

describe("ImportPlugin", () => {
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

  test("renders the toolbar ImportButton with the expected label and iconOnly wired through", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    renderer = mountWithComposer(
      editor,
      createElement(ImportPlugin, {
        documentId: "doc-1",
        importFile: importFileStub,
        iconOnly: true,
      }),
    );

    const button = findImportButton(renderer);
    assert.equal(button.props.label, "Import");
    assert.equal(button.props.iconOnly, true);
    assert.equal(findDialog(renderer).length, 0);
  });

  test("importing into an empty document inserts immediately with no confirm dialog", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    renderer = mountWithComposer(
      editor,
      createElement(ImportPlugin, {
        documentId: "doc-1",
        importFile: importFileStub,
      }),
    );

    assert.equal(rootText(editor), "");
    triggerImport(renderer, "Hello from import");

    assert.equal(rootText(editor), "Hello from import");
    assert.equal(findDialog(renderer as ReactTestRenderer).length, 0);
  });

  test("importing into a non-empty document holds the import behind a confirm dialog", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    fillWithText(editor, "Existing content");
    renderer = mountWithComposer(
      editor,
      createElement(ImportPlugin, {
        documentId: "doc-1",
        importFile: importFileStub,
      }),
    );

    triggerImport(renderer, "Replacement content");

    // Held pending: the editor content is untouched until confirmed.
    assert.equal(rootText(editor), "Existing content");
    const dialogs = findDialog(renderer as ReactTestRenderer);
    assert.equal(dialogs.length, 1);
    assert.equal(dialogs[0]?.props["aria-modal"], "true");
  });

  test("cancelling the confirm dialog discards the pending import", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    fillWithText(editor, "Existing content");
    renderer = mountWithComposer(
      editor,
      createElement(ImportPlugin, {
        documentId: "doc-1",
        importFile: importFileStub,
      }),
    );
    triggerImport(renderer, "Replacement content");

    const cancelButton = renderer.root.find(
      (instance) =>
        instance.type === "button" && instance.props.children === "Cancel",
    );
    act(() => {
      cancelButton.props.onClick();
    });

    assert.equal(rootText(editor), "Existing content");
    assert.equal(findDialog(renderer as ReactTestRenderer).length, 0);
  });

  test("confirming the dialog applies the held import and closes the dialog", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    fillWithText(editor, "Existing content");
    renderer = mountWithComposer(
      editor,
      createElement(ImportPlugin, {
        documentId: "doc-1",
        importFile: importFileStub,
      }),
    );
    triggerImport(renderer, "Replacement content");

    const replaceButton = renderer.root.find(
      (instance) =>
        instance.type === "button" && instance.props.children === "Replace",
    );
    act(() => {
      replaceButton.props.onClick();
    });

    assert.equal(rootText(editor), "Replacement content");
    assert.equal(findDialog(renderer as ReactTestRenderer).length, 0);
  });

  test("pressing Escape while the dialog is open cancels the pending import", () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    fillWithText(editor, "Existing content");

    // Capture the dialog's keydown listener as it registers (it only
    // registers once `ImportConfirmDialog` itself mounts, i.e. once an
    // import is pending), so install the capturing `addEventListener`
    // before the plugin mounts at all.
    const fakeDocument = globalThis.document as unknown as {
      addEventListener: (
        type: string,
        listener: (event: {
          key: string;
          preventDefault: () => void;
          stopPropagation: () => void;
        }) => void,
      ) => void;
    };
    let escapeListener:
      | ((event: {
          key: string;
          preventDefault: () => void;
          stopPropagation: () => void;
        }) => void)
      | undefined;
    fakeDocument.addEventListener = (type, listener) => {
      if (type === "keydown") escapeListener = listener;
    };

    renderer = mountWithComposer(
      editor,
      createElement(ImportPlugin, {
        documentId: "doc-1",
        importFile: importFileStub,
      }),
    );
    triggerImport(renderer, "Replacement content");
    assert.equal(findDialog(renderer as ReactTestRenderer).length, 1);
    assert.ok(
      escapeListener,
      "expected the dialog to register a keydown listener",
    );

    act(() => {
      escapeListener?.({
        key: "Escape",
        preventDefault: () => undefined,
        stopPropagation: () => undefined,
      });
    });

    assert.equal(rootText(editor), "Existing content");
    assert.equal(findDialog(renderer as ReactTestRenderer).length, 0);
  });

  test("switching documents invalidates a pending parse before it can lock or replace the new editor", async () => {
    restoreDom = installFakeDom();
    const editor = makeEditor();
    const oldParse = createDeferred<{
      ok: true;
      data: { markdown: string };
    }>();
    const parsedDocumentIds: string[] = [];
    const parseImportFile = (documentId: string) => {
      parsedDocumentIds.push(documentId);
      return oldParse.promise;
    };
    renderer = mountWithComposer(
      editor,
      createElement(ImportPlugin, {
        documentId: "doc-old",
        importFile: parseImportFile,
      }),
    );

    const target = {
      files: [new File(["old"], "old.md", { type: "text/markdown" })],
      value: "old.md",
    };
    let settled!: Promise<void>;
    act(() => {
      settled = findFileInput(renderer as ReactTestRenderer).props.onChange({
        target,
      });
    });
    assert.deepEqual(parsedDocumentIds, ["doc-old"]);
    assert.equal(
      findToolbarImportButton(renderer as ReactTestRenderer).props.disabled,
      true,
    );

    updatePlugin(renderer, editor, "doc-new", async (documentId) => {
      parsedDocumentIds.push(documentId);
      return { ok: true, data: { markdown: "# New" } };
    });

    assert.equal(
      findToolbarImportButton(renderer as ReactTestRenderer).props.disabled,
      false,
    );
    assert.equal(rootText(editor), "");

    oldParse.resolve({ ok: true, data: { markdown: "# Stale old import" } });
    await act(async () => {
      await settled;
      await waitForAsyncDrain();
    });

    assert.equal(rootText(editor), "");
    assert.equal(findDialog(renderer as ReactTestRenderer).length, 0);
    assert.equal(
      findToolbarImportButton(renderer as ReactTestRenderer).props.disabled,
      false,
    );
  });
});
