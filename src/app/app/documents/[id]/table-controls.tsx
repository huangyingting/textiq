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
  runDocumentTableControl,
  type DocumentTableControlAction,
} from "@/lib/lexical/table-controls";

function readTableSelectionState(editor: LexicalEditor): boolean {
  return editor
    .getEditorState()
    .read(() => editor.isEditable() && $isSelectionInsideDocumentTable());
}

export function TableControls({ editable }: { editable: boolean }) {
  const [editor] = useLexicalComposerContext();
  const [inTable, setInTable] = useState(() => readTableSelectionState(editor));

  const recompute = useCallback(() => {
    setInTable(readTableSelectionState(editor));
  }, [editor]);

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          setInTable(editor.isEditable() && $isSelectionInsideDocumentTable());
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

  const disabled = !editable || !inTable;
  const run = (action: DocumentTableControlAction) => {
    runDocumentTableControl(editor, action);
  };

  return (
    <>
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
