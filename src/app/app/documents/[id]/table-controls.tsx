"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import {
  COMMAND_PRIORITY_LOW,
  SELECTION_CHANGE_COMMAND,
  type LexicalEditor,
} from "lexical";
import { useCallback, useEffect, useState } from "react";

import { EditorToolbarButton } from "@/components/editor/toolbar-button";
import {
  $isSelectionInsideDocumentTable,
  $getSelectedDocumentTableCaption,
  runDocumentTableControl,
  runDocumentTableCaptionControl,
  type DocumentTableControlAction,
} from "@/lib/lexical/table-controls";

type TableSelectionState = {
  inTable: boolean;
  caption: string;
};

function readTableSelectionState(editor: LexicalEditor): TableSelectionState {
  return editor.getEditorState().read(() => {
    const caption = $getSelectedDocumentTableCaption();
    return {
      inTable: editor.isEditable() && $isSelectionInsideDocumentTable(),
      caption: caption ?? "",
    };
  });
}

export function TableControls({ editable }: { editable: boolean }) {
  const [editor] = useLexicalComposerContext();
  const [selectionState, setSelectionState] = useState(() =>
    readTableSelectionState(editor),
  );

  const recompute = useCallback(() => {
    setSelectionState(readTableSelectionState(editor));
  }, [editor]);

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          const caption = $getSelectedDocumentTableCaption();
          setSelectionState({
            inTable: editor.isEditable() && $isSelectionInsideDocumentTable(),
            caption: caption ?? "",
          });
        });
      }),
      editor.registerEditableListener(recompute),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          recompute();
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
    );
  }, [editor, recompute]);

  const disabled = !editable || !selectionState.inTable;
  const run = (action: DocumentTableControlAction) => {
    runDocumentTableControl(editor, action);
  };
  const setCaption = (caption: string) => {
    setSelectionState((current) => ({ ...current, caption }));
    runDocumentTableCaptionControl(editor, caption);
  };

  return (
    <>
      <label className="flex h-8 min-w-40 items-center gap-1.5 rounded-ds-md border border-ds-border-subtle bg-ds-surface-raised px-2 text-xs font-medium text-ds-text-secondary shadow-ds-raised">
        <span className="shrink-0">Caption</span>
        <input
          aria-label="Table caption"
          className="min-w-0 flex-1 bg-transparent text-sm font-normal text-ds-text-primary placeholder:text-ds-text-muted focus:outline-none disabled:cursor-not-allowed"
          disabled={disabled}
          placeholder={selectionState.inTable ? "Add caption" : "Select table"}
          value={selectionState.caption}
          onChange={(event) => setCaption(event.target.value)}
        />
      </label>
      <TableControlButton
        label="Clear table caption"
        shortLabel="Clear"
        disabled={disabled || selectionState.caption.length === 0}
        onRun={() => setCaption("")}
      />
      <TableControlButton
        label="Add row below"
        shortLabel="Row +"
        disabled={disabled}
        onRun={() => run("insert-row-after")}
      />
      <TableControlButton
        label="Delete row"
        shortLabel="Row −"
        disabled={disabled}
        onRun={() => run("delete-row")}
      />
      <TableControlButton
        label="Add column right"
        shortLabel="Col +"
        disabled={disabled}
        onRun={() => run("insert-column-after")}
      />
      <TableControlButton
        label="Delete column"
        shortLabel="Col −"
        disabled={disabled}
        onRun={() => run("delete-column")}
      />
    </>
  );
}

function TableControlButton({
  label,
  shortLabel,
  disabled,
  onRun,
}: {
  label: string;
  shortLabel: string;
  disabled: boolean;
  onRun: () => void;
}) {
  return (
    <EditorToolbarButton
      label={label}
      tooltip={label}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onRun}
    >
      <span className="text-xs font-semibold">{shortLabel}</span>
    </EditorToolbarButton>
  );
}
