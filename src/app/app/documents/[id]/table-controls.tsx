"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import {
  COMMAND_PRIORITY_LOW,
  SELECTION_CHANGE_COMMAND,
  type LexicalEditor,
} from "lexical";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { EditorToolbarButton } from "@/components/editor/toolbar-button";
import { FloatingSurface } from "@/components/ui";
import { computeAnchoredPosition } from "@/lib/anchored-position";
import {
  $getSelectedDocumentTableCaption,
  $getSelectedDocumentTableKey,
  runDocumentTableControl,
  runDocumentTableCaptionControl,
  type DocumentTableControlAction,
} from "@/lib/lexical/table-controls";

type TableSelectionState = {
  inTable: boolean;
  caption: string;
  tableKey: string | null;
};

const TOOLBAR_GAP = 8;
const EDGE_INSET = 8;

function readCurrentTableSelectionState(
  editor: LexicalEditor,
): TableSelectionState {
  const tableKey = $getSelectedDocumentTableKey();
  const caption = $getSelectedDocumentTableCaption();
  return {
    inTable: editor.isEditable() && tableKey !== null,
    caption: caption ?? "",
    tableKey,
  };
}

function readTableSelectionState(editor: LexicalEditor): TableSelectionState {
  return editor
    .getEditorState()
    .read(() => readCurrentTableSelectionState(editor));
}

export function FloatingTableToolbar({ editable }: { editable: boolean }) {
  const [editor] = useLexicalComposerContext();
  const measureRef = useRef<HTMLDivElement | null>(null);
  const [selectionState, setSelectionState] = useState(() =>
    readTableSelectionState(editor),
  );
  const [coords, setCoords] = useState({ top: -1000, left: -1000 });

  const recompute = useCallback(() => {
    setSelectionState(readTableSelectionState(editor));
  }, [editor]);

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          setSelectionState(readCurrentTableSelectionState(editor));
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

  const visible =
    editable && selectionState.inTable && selectionState.tableKey !== null;
  const reposition = useCallback(() => {
    if (!visible || selectionState.tableKey === null) {
      return;
    }
    const anchor = editor.getElementByKey(selectionState.tableKey);
    const el = measureRef.current;
    if (anchor === null || el === null) {
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const width = el.offsetWidth + 2;
    const height = el.offsetHeight + 2;
    const { top, left } = computeAnchoredPosition({
      anchor: rect,
      float: { width, height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      placement: "top",
      gap: TOOLBAR_GAP,
      padding: EDGE_INSET,
    });
    setCoords((prev) =>
      prev.top === top && prev.left === left ? prev : { top, left },
    );
  }, [editor, selectionState.tableKey, visible]);

  useLayoutEffect(() => {
    if (!visible) {
      return;
    }
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [selectionState.caption, visible, reposition]);

  const disabled = !editable || !selectionState.inTable;
  const run = (action: DocumentTableControlAction) => {
    runDocumentTableControl(editor, action);
  };
  const setCaption = (caption: string) => {
    setSelectionState((current) => ({ ...current, caption }));
    runDocumentTableCaptionControl(editor, caption);
  };

  return (
    <FloatingSurface
      open={visible}
      position={coords}
      role="toolbar"
      aria-label="Table editing"
      elevation="overlay"
      radius="lg"
      closeOnEscape={false}
      closeOnClickAway={false}
    >
      <div
        ref={measureRef}
        className="flex max-w-[calc(100vw-1rem)] flex-wrap items-center justify-center gap-1 p-1"
      >
        <label className="flex h-8 min-w-40 items-center gap-1.5 rounded-ds-md border border-ds-border-subtle bg-ds-surface-raised px-2 text-xs font-medium text-ds-text-secondary shadow-ds-raised">
          <span className="shrink-0">Caption</span>
          <input
            aria-label="Table caption"
            className="min-w-0 flex-1 bg-transparent text-sm font-normal text-ds-text-primary placeholder:text-ds-text-muted focus:outline-none disabled:cursor-not-allowed"
            disabled={disabled}
            placeholder={
              selectionState.inTable ? "Add caption" : "Select table"
            }
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
      </div>
    </FloatingSurface>
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
      className="w-auto px-2"
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onRun}
    >
      <span className="text-xs font-semibold">{shortLabel}</span>
    </EditorToolbarButton>
  );
}
