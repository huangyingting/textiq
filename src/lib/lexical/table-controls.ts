import {
  $deleteTableColumnAtSelection,
  $deleteTableRowAtSelection,
  $getTableCellNodeFromLexicalNode,
  $insertTableColumnAtSelection,
  $insertTableRowAtSelection,
  $isTableSelection,
} from "@lexical/table";
import { $getSelection, $isRangeSelection, type LexicalEditor } from "lexical";

export type DocumentTableControlAction =
  | "insert-row-after"
  | "delete-row"
  | "insert-column-after"
  | "delete-column";

export function $isSelectionInsideDocumentTable(): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) && !$isTableSelection(selection)) {
    return false;
  }
  return $getTableCellNodeFromLexicalNode(selection.anchor.getNode()) !== null;
}

export function $applyDocumentTableControl(
  action: DocumentTableControlAction,
): boolean {
  if (!$isSelectionInsideDocumentTable()) {
    return false;
  }

  switch (action) {
    case "insert-row-after":
      $insertTableRowAtSelection(true);
      return true;
    case "delete-row":
      $deleteTableRowAtSelection();
      return true;
    case "insert-column-after":
      $insertTableColumnAtSelection(true);
      return true;
    case "delete-column":
      $deleteTableColumnAtSelection();
      return true;
  }
}

export function runDocumentTableControl(
  editor: LexicalEditor,
  action: DocumentTableControlAction,
): boolean {
  let applied = false;
  editor.update(() => {
    applied = $applyDocumentTableControl(action);
  });
  if (applied) {
    editor.focus();
  }
  return applied;
}
