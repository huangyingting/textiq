import {
  $deleteTableColumnAtSelection,
  $deleteTableRowAtSelection,
  $getTableCellNodeFromLexicalNode,
  $insertTableColumnAtSelection,
  $insertTableRowAtSelection,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  $isTableSelection,
  TableCellHeaderStates,
  type TableCellNode,
  type TableNode,
  type TableRowNode,
} from "@lexical/table";
import {
  $createParagraphNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
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
  | "delete-column"
  | "toggle-header-row"
  | "delete-table";

export type DocumentTableControlState = {
  tableKey: string;
  caption: string;
  rows: number;
  columns: number;
  canDeleteRow: boolean;
  canDeleteColumn: boolean;
  headerRow: boolean;
};

export function $isSelectionInsideDocumentTable(): boolean {
  return $selectedDocumentTableNode() !== null;
}

export function $getSelectedDocumentTableKey(): string | null {
  return $selectedDocumentTableNode()?.getKey() ?? null;
}

export function $selectedDocumentTableNode(): TableNode | null {
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

function $documentTableNodeForKey(tableKey: string): TableNode | null {
  const node = $getNodeByKey(tableKey);
  return $isTableNode(node) ? node : null;
}

function tableRows(table: TableNode): TableRowNode[] {
  return table.getChildren().filter($isTableRowNode);
}

function rowCells(row: TableRowNode): TableCellNode[] {
  return row.getChildren().filter($isTableCellNode);
}

function tableDimensions(table: TableNode): { rows: number; columns: number } {
  const rows = tableRows(table);
  const firstRow = rows[0];
  return {
    rows: rows.length,
    columns: firstRow ? rowCells(firstRow).length : 0,
  };
}

function hasHeaderRow(table: TableNode): boolean {
  const firstRow = tableRows(table)[0];
  if (!firstRow) return false;
  const cells = rowCells(firstRow);
  return (
    cells.length > 0 &&
    cells.every((cell) => cell.hasHeaderState(TableCellHeaderStates.ROW))
  );
}

function tableState(table: TableNode): DocumentTableControlState {
  const { rows, columns } = tableDimensions(table);
  return {
    tableKey: table.getKey(),
    caption: $getDocumentTableCaption(table),
    rows,
    columns,
    canDeleteRow: rows > 1,
    canDeleteColumn: columns > 1,
    headerRow: hasHeaderRow(table),
  };
}

export function $getDocumentTableStateForKey(
  tableKey: string,
): DocumentTableControlState | null {
  const table = $documentTableNodeForKey(tableKey);
  return table ? tableState(table) : null;
}

export function $getSelectedDocumentTableState(): DocumentTableControlState | null {
  const table = $selectedDocumentTableNode();
  return table ? tableState(table) : null;
}

function $resolveDocumentTableNode(tableKey?: string): TableNode | null {
  return tableKey
    ? $documentTableNodeForKey(tableKey)
    : $selectedDocumentTableNode();
}

function $setHeaderRow(table: TableNode, enabled: boolean): boolean {
  const firstRow = tableRows(table)[0];
  if (!firstRow) return false;
  const cells = rowCells(firstRow);
  if (cells.length === 0) return false;
  for (const cell of cells) {
    cell.setHeaderStyles(
      enabled ? TableCellHeaderStates.ROW : TableCellHeaderStates.NO_STATUS,
      TableCellHeaderStates.ROW,
    );
  }
  return true;
}

function $toggleHeaderRow(table: TableNode): boolean {
  return $setHeaderRow(table, !hasHeaderRow(table));
}

function $selectAfterTableDelete(table: TableNode): void {
  const previous = table.getPreviousSibling();
  const next = table.getNextSibling();
  table.remove();
  if ($isElementNode(next)) {
    next.selectStart();
    return;
  }
  if ($isElementNode(previous)) {
    previous.selectEnd();
    return;
  }
  const paragraph = $createParagraphNode();
  $getRoot().append(paragraph);
  paragraph.select();
}

export function $applyDocumentTableControl(
  action: DocumentTableControlAction,
  tableKey?: string,
): boolean {
  const table = $resolveDocumentTableNode(tableKey);
  if (!table) {
    return false;
  }

  switch (action) {
    case "insert-row-after":
      if (!$isSelectionInsideDocumentTable()) return false;
      $insertTableRowAtSelection(true);
      return true;
    case "delete-row":
      if (!$isSelectionInsideDocumentTable()) return false;
      if (tableDimensions(table).rows <= 1) return false;
      $deleteTableRowAtSelection();
      return true;
    case "insert-column-after":
      if (!$isSelectionInsideDocumentTable()) return false;
      $insertTableColumnAtSelection(true);
      return true;
    case "delete-column":
      if (!$isSelectionInsideDocumentTable()) return false;
      if (tableDimensions(table).columns <= 1) return false;
      $deleteTableColumnAtSelection();
      return true;
    case "toggle-header-row":
      return $toggleHeaderRow(table);
    case "delete-table":
      $selectAfterTableDelete(table);
      return true;
  }
}

export function runDocumentTableControl(
  editor: LexicalEditor,
  action: DocumentTableControlAction,
  tableKey?: string,
): boolean {
  let applied = false;
  editor.update(() => {
    applied = $applyDocumentTableControl(action, tableKey);
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

export function $setSelectedDocumentTableCaption(
  caption: string,
  tableKey?: string,
): boolean {
  const table = $resolveDocumentTableNode(tableKey);
  if (!table) return false;
  $setDocumentTableCaption(table, normalizeDocumentTableCaption(caption));
  return true;
}

export function runDocumentTableCaptionControl(
  editor: LexicalEditor,
  caption: string,
  tableKey?: string,
): boolean {
  let applied = false;
  editor.update(() => {
    applied = $setSelectedDocumentTableCaption(caption, tableKey);
  });
  return applied;
}
