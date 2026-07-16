"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot } from "lexical";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

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
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return createPortal(
    <div className="tiq-full-viewport fixed inset-0 z-modal flex items-end justify-center p-4 sm:items-center">
      <div
        className="absolute inset-0 bg-ds-backdrop"
        aria-hidden="true"
        onClick={onCancel}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-replace-title"
        className="tiq-mobile-sheet relative z-raised w-full max-w-sm rounded-ds-xl border border-ds-border-strong bg-ds-surface-base p-6 shadow-ds-popover"
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
      </div>
    </div>,
    document.body,
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
        compact
        iconOnly={iconOnly}
      />
      {pendingMarkdown !== null && (
        <ImportConfirmDialog
          onCancel={cancelImport}
          onConfirm={confirmImport}
        />
      )}
    </>
  );
}
