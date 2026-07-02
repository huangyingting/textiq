import assert from "node:assert/strict";
import { test } from "node:test";

import { createHeadlessEditor } from "@lexical/headless";
import { createEmptyHistoryState, registerHistory } from "@lexical/history";
import {
  $createTableNodeWithDimensions,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  TableCellNode,
  TableNode,
  TableRowNode,
} from "@lexical/table";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  REDO_COMMAND,
  UNDO_COMMAND,
  type LexicalEditor,
} from "lexical";

import { buildDeckSource } from "@/lib/ai/deck-source";
import {
  collectDocumentBlocks,
  lexicalStateToPlainText,
  type DocumentTableBlock,
} from "@/lib/content";
import { buildPresentationBlocks } from "../document/deck-kernel/present-blocks";
import { ensureLexicalTableCaptionSupport } from "@/lib/lexical/table-caption-runtime";

import {
  $getSelectedDocumentTableCaption,
  $isSelectionInsideDocumentTable,
  runDocumentTableCaptionControl,
  runDocumentTableControl,
  type DocumentTableControlAction,
} from "./table-controls";

ensureLexicalTableCaptionSupport();

function makeEditor(): LexicalEditor {
  const editor = createHeadlessEditor({
    namespace: "table-controls-test",
    nodes: [TableNode, TableRowNode, TableCellNode],
    onError(error) {
      throw error;
    },
  });
  editor.focus = (() => {}) as LexicalEditor["focus"];
  return editor;
}

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function tableNode(): TableNode {
  const node = $getRoot().getFirstChild();
  assert.ok(node && $isTableNode(node), "expected first node to be a table");
  return node;
}

function cellAt(rowIndex: number, columnIndex: number): TableCellNode {
  const row = tableNode().getChildAtIndex(rowIndex);
  assert.ok(row && $isTableRowNode(row), "expected table row");
  const cell = row.getChildAtIndex(columnIndex);
  assert.ok(cell && $isTableCellNode(cell), "expected table cell");
  return cell;
}

function seedTable(editor: LexicalEditor, rows: string[][]): void {
  editor.update(
    () => {
      const table = $createTableNodeWithDimensions(
        rows.length,
        rows[0]?.length ?? 1,
        true,
      );
      $getRoot().clear().append(table);
      for (const [rowIndex, row] of rows.entries()) {
        for (const [columnIndex, text] of row.entries()) {
          setCellText(rowIndex, columnIndex, text);
        }
      }
      cellAt(1, 0).selectStart();
    },
    { discrete: true },
  );
}

function setCellText(
  rowIndex: number,
  columnIndex: number,
  text: string,
): void {
  const cell = cellAt(rowIndex, columnIndex);
  cell.clear();
  cell.append($createParagraphNode().append($createTextNode(text)));
}

function selectCell(
  editor: LexicalEditor,
  rowIndex: number,
  columnIndex: number,
): void {
  editor.update(
    () => {
      cellAt(rowIndex, columnIndex).selectStart();
    },
    { discrete: true },
  );
}

function dimensions(editor: LexicalEditor): { rows: number; columns: number } {
  return editor.getEditorState().read(() => {
    const table = tableNode();
    const firstRow = table.getFirstChild();
    assert.ok(firstRow && $isTableRowNode(firstRow), "expected first row");
    return {
      rows: table.getChildrenSize(),
      columns: firstRow.getChildrenSize(),
    };
  });
}

async function run(
  editor: LexicalEditor,
  action: DocumentTableControlAction,
): Promise<void> {
  assert.equal(runDocumentTableControl(editor, action), true);
  await tick();
}

function serialized(editor: LexicalEditor): string {
  return JSON.stringify(editor.getEditorState().toJSON());
}

function onlyTableBlock(editor: LexicalEditor): DocumentTableBlock {
  const block = collectDocumentBlocks(serialized(editor))[0];
  assert.equal(block?.kind, "table");
  return block as DocumentTableBlock;
}

test("document table controls insert rows and columns from the selected cell", async () => {
  const editor = makeEditor();
  seedTable(editor, [
    ["Region", "ARR"],
    ["NA", "$12M"],
  ]);

  assert.equal(
    editor.getEditorState().read(() => $isSelectionInsideDocumentTable()),
    true,
  );

  await run(editor, "insert-row-after");
  assert.deepEqual(dimensions(editor), { rows: 3, columns: 2 });

  editor.update(
    () => {
      setCellText(2, 0, "EU");
      setCellText(2, 1, "$8M");
      cellAt(0, 1).selectStart();
    },
    { discrete: true },
  );

  await run(editor, "insert-column-after");
  assert.deepEqual(dimensions(editor), { rows: 3, columns: 3 });

  editor.update(
    () => {
      setCellText(0, 2, "Plan");
      setCellText(1, 2, "Base");
      setCellText(2, 2, "Upside");
    },
    { discrete: true },
  );

  assert.deepEqual(onlyTableBlock(editor), {
    kind: "table",
    columns: [
      { id: "col-1", label: "Region" },
      { id: "col-2", label: "ARR" },
      { id: "col-3", label: "Plan" },
    ],
    rows: [
      {
        id: "row-1",
        cells: [{ text: "NA" }, { text: "$12M" }, { text: "Base" }],
      },
      {
        id: "row-2",
        cells: [{ text: "EU" }, { text: "$8M" }, { text: "Upside" }],
      },
    ],
  });
});

test("document table controls delete rows and columns and participate in undo/redo", async () => {
  const editor = makeEditor();
  const history = createEmptyHistoryState();
  const unregister = registerHistory(editor, history, 0);
  try {
    seedTable(editor, [
      ["Region", "ARR", "Plan"],
      ["NA", "$12M", "Base"],
      ["EU", "$8M", "Upside"],
    ]);
    const baseline = serialized(editor);

    selectCell(editor, 2, 0);
    await run(editor, "delete-row");
    assert.deepEqual(dimensions(editor), { rows: 2, columns: 3 });
    assert.doesNotMatch(lexicalStateToPlainText(serialized(editor)), /EU/);

    editor.dispatchCommand(UNDO_COMMAND, undefined);
    editor.update(() => {}, { discrete: true });
    assert.equal(serialized(editor), baseline);

    editor.dispatchCommand(REDO_COMMAND, undefined);
    editor.update(() => {}, { discrete: true });
    assert.deepEqual(dimensions(editor), { rows: 2, columns: 3 });

    selectCell(editor, 0, 2);
    await run(editor, "delete-column");
    assert.deepEqual(dimensions(editor), { rows: 2, columns: 2 });
    assert.doesNotMatch(lexicalStateToPlainText(serialized(editor)), /Plan/);
  } finally {
    unregister();
  }
});

test("mutated tables survive serialization round-trip and keep projections aligned", async () => {
  const editor = makeEditor();
  seedTable(editor, [
    ["Region", "ARR"],
    ["NA", "$12M"],
  ]);
  await run(editor, "insert-row-after");
  editor.update(
    () => {
      setCellText(2, 0, "EU");
      setCellText(2, 1, "$8M");
    },
    { discrete: true },
  );

  const json = serialized(editor);
  const roundTripEditor = makeEditor();
  roundTripEditor.setEditorState(roundTripEditor.parseEditorState(json));
  assert.deepEqual(collectDocumentBlocks(serialized(roundTripEditor)), [
    onlyTableBlock(editor),
  ]);

  const expectedMarkdown =
    "| Region | ARR |\n| --- | --- |\n| NA | $12M |\n| EU | $8M |";
  assert.equal(lexicalStateToPlainText(json), expectedMarkdown);
  assert.equal(buildDeckSource(json, new Map()).outline, expectedMarkdown);
  assert.deepEqual(buildPresentationBlocks(json), collectDocumentBlocks(json));
});

test("document table captions can be set, updated, cleared, and extracted explicitly", () => {
  const editor = makeEditor();
  seedTable(editor, [
    ["Region", "ARR"],
    ["NA", "$12M"],
  ]);

  assert.equal(
    runDocumentTableCaptionControl(editor, "  FY26 forecast  "),
    true,
  );
  editor.update(() => {}, { discrete: true });
  assert.equal(onlyTableBlock(editor).caption, "FY26 forecast");

  assert.equal(runDocumentTableCaptionControl(editor, "FY26 actuals"), true);
  editor.update(() => {}, { discrete: true });
  assert.equal(onlyTableBlock(editor).caption, "FY26 actuals");

  assert.equal(runDocumentTableCaptionControl(editor, ""), true);
  editor.update(() => {}, { discrete: true });
  assert.equal(onlyTableBlock(editor).caption, undefined);
});

test("document table captions survive autosave and reopen JSON round-trip", () => {
  const editor = makeEditor();
  seedTable(editor, [
    ["Region", "ARR"],
    ["NA", "$12M"],
  ]);
  assert.equal(
    runDocumentTableCaptionControl(editor, "Bookings by region"),
    true,
  );
  editor.update(() => {}, { discrete: true });

  const json = serialized(editor);
  assert.match(json, /"caption":"Bookings by region"/);

  const roundTripEditor = makeEditor();
  roundTripEditor.setEditorState(roundTripEditor.parseEditorState(json));
  roundTripEditor.update(
    () => {
      cellAt(1, 0).selectStart();
    },
    { discrete: true },
  );

  assert.equal(
    roundTripEditor
      .getEditorState()
      .read(() => $getSelectedDocumentTableCaption()),
    "Bookings by region",
  );
  assert.deepEqual(collectDocumentBlocks(serialized(roundTripEditor)), [
    onlyTableBlock(editor),
  ]);
});

test("document table caption updates participate in undo and redo", () => {
  const editor = makeEditor();
  const history = createEmptyHistoryState();
  const unregister = registerHistory(editor, history, 0);
  try {
    seedTable(editor, [
      ["Region", "ARR"],
      ["NA", "$12M"],
    ]);

    assert.equal(runDocumentTableCaptionControl(editor, "First caption"), true);
    editor.update(() => {}, { discrete: true });
    assert.equal(onlyTableBlock(editor).caption, "First caption");

    editor.dispatchCommand(UNDO_COMMAND, undefined);
    editor.update(() => {}, { discrete: true });
    assert.equal(onlyTableBlock(editor).caption, undefined);

    editor.dispatchCommand(REDO_COMMAND, undefined);
    editor.update(() => {}, { discrete: true });
    assert.equal(onlyTableBlock(editor).caption, "First caption");
  } finally {
    unregister();
  }
});
