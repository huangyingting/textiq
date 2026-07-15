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
  unmount,
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
  return renderer.root.findAll((instance) => instance.props.role === "dialog");
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

  test("renders ImportButton in compact mode with the expected label and iconOnly wired through", () => {
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
    assert.equal(button.props.compact, true);
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
        listener: (event: { key: string }) => void,
      ) => void;
    };
    let escapeListener: ((event: { key: string }) => void) | undefined;
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
      escapeListener?.({ key: "Escape" });
    });

    assert.equal(rootText(editor), "Existing content");
    assert.equal(findDialog(renderer as ReactTestRenderer).length, 0);
  });
});
