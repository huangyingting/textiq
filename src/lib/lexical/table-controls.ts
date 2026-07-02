import {
  $deleteTableColumnAtSelection,
  $deleteTableRowAtSelection,
  $getTableCellNodeFromLexicalNode,
  $insertTableColumnAtSelection,
  $insertTableRowAtSelection,
  $isTableNode,
  $isTableSelection,
  type TableNode,
} from "@lexical/table";
import {
  $getSelection,
  $isRangeSelection,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";

import {
  $getDocumentTableCaption,
  $setDocumentTableCaption,
  ensureLexicalTableCaptionSupport,
  normalizeDocumentTableCaption,
} from "@/lib/lexical/table-caption-runtime";

ensureLexicalTableCaptionSupport();

export type DocumentTableControlAction =
  | "insert-row-after"
  | "delete-row"
  | "insert-column-after"
  | "delete-column";

export function $isSelectionInsideDocumentTable(): boolean {
  return $selectedDocumentTableNode() !== null;
}

function $selectedDocumentTableNode(): TableNode | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) && !$isTableSelection(selection)) {
    return null;
  }
  const cell = $getTableCellNodeFromLexicalNode(selection.anchor.getNode());
  let node: LexicalNode | null = cell;
  while (node) {
    if ($isTableNode(node)) return node;
    node = node.getParent();
  }
  return null;
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

export function $getSelectedDocumentTableCaption(): string | null {
  const table = $selectedDocumentTableNode();
  if (!table) return null;
  return $getDocumentTableCaption(table);
}

export function $setSelectedDocumentTableCaption(caption: string): boolean {
  const table = $selectedDocumentTableNode();
  if (!table) return false;
  $setDocumentTableCaption(table, normalizeDocumentTableCaption(caption));
  return true;
}

export function runDocumentTableCaptionControl(
  editor: LexicalEditor,
  caption: string,
): boolean {
  let applied = false;
  editor.update(() => {
    applied = $setSelectedDocumentTableCaption(caption);
  });
  return applied;
}
