"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot } from "lexical";
import { useCallback, useRef, useState, type RefObject } from "react";

import { Dialog } from "@/components/ui";
import type { ImportActionResult } from "@/lib/action-ports";
import { useInsertImportedMarkdown } from "@/lib/lexical/use-insert-imported-markdown";
import { resolveImportStep } from "@/lib/content";
import { ImportButton } from "@/components/editor/import-button";

/**
 * Confirmation modal shown before an import replaces a non-empty document.
 * Mirrors the portal/escape-to-cancel pattern used by the document delete
 * dialog so imports can't silently destroy existing content.
 */
function ImportConfirmDialog({
  onCancel,
  onConfirm,
  restoreFocusRef,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  restoreFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <Dialog
      open
      onClose={onCancel}
      aria-labelledby="import-replace-title"
      containerClassName="items-end sm:items-center"
      className="tiq-mobile-sheet max-w-sm"
      restoreFocusRef={restoreFocusRef}
    >
      <h2
        id="import-replace-title"
        className="text-base font-semibold text-ds-text-primary"
      >
        Replace document content?
      </h2>
      <p className="mt-2 text-sm text-ds-text-secondary">
        Importing will replace everything currently in this document. This can
        be undone right after.
      </p>
      <div className="sticky bottom-0 mt-6 flex justify-end gap-3 bg-ds-surface-base pb-[var(--tiq-safe-area-bottom)]">
        <button
          type="button"
          onClick={onCancel}
          className="tiq-touch-target flex h-9 items-center justify-center rounded-full border border-ds-border-strong px-4 text-sm font-medium text-ds-text-secondary transition hover:bg-ds-surface-sunken hover:text-ds-text-primary"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="tiq-touch-target flex h-9 items-center justify-center rounded-full bg-ds-accent px-4 text-sm font-medium text-ds-text-on-accent transition hover:opacity-90 disabled:opacity-60"
        >
          Replace
        </button>
      </div>
    </Dialog>
  );
}

/**
 * Lexical plugin that renders the import button inline in the editor toolbar.
 *
 * When a file is successfully parsed, its Markdown content replaces the current
 * editor state. Replacing a NON-EMPTY document is destructive, so it requires
 * an explicit confirmation first (the import is held pending until the user
 * confirms; cancelling discards it and leaves the document untouched). The
 * import itself is tagged so autosave persists it — see
 * `useInsertImportedMarkdown`.
 */
export function ImportPlugin({
  documentId,
  importFile: parseImportFile,
  iconOnly = false,
}: {
  documentId: string;
  importFile: (
    documentId: string,
    file: File,
  ) => Promise<ImportActionResult<{ markdown: string }>>;
  iconOnly?: boolean;
}) {
  const [editor] = useLexicalComposerContext();
  const insertMarkdown = useInsertImportedMarkdown();
  const importTriggerRef = useRef<HTMLButtonElement>(null);
  const [pendingMarkdown, setPendingMarkdown] = useState<string | null>(null);
  const importFile = useCallback(
    (file: File) => parseImportFile(documentId, file),
    [documentId, parseImportFile],
  );

  const isDocumentEmpty = useCallback(
    () =>
      editor
        .getEditorState()
        .read(
          () =>
            $getRoot().getTextContent() === "" &&
            $getRoot().getChildrenSize() <= 1,
        ),
    [editor],
  );

  const handleImport = useCallback(
    (markdown: string) => {
      if (resolveImportStep(isDocumentEmpty(), false) === "insert") {
        insertMarkdown(markdown);
        return;
      }
      setPendingMarkdown(markdown);
    },
    [isDocumentEmpty, insertMarkdown],
  );

  const confirmImport = useCallback(() => {
    if (pendingMarkdown !== null) {
      insertMarkdown(pendingMarkdown);
    }
    setPendingMarkdown(null);
  }, [pendingMarkdown, insertMarkdown]);

  const cancelImport = useCallback(() => setPendingMarkdown(null), []);

  return (
    <>
      <ImportButton
        onImport={handleImport}
        importFile={importFile}
        label="Import"
        iconOnly={iconOnly}
        buttonRef={importTriggerRef}
      />
      {pendingMarkdown !== null && (
        <ImportConfirmDialog
          onCancel={cancelImport}
          onConfirm={confirmImport}
          restoreFocusRef={importTriggerRef}
        />
      )}
    </>
  );
}
