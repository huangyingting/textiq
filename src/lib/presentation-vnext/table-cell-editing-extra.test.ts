import assert from "node:assert/strict";
import { test } from "node:test";

import type { TableContent } from "./schema";
import {
  applyPlainTextEditToTableCell,
  applyPlainTextEditToTableContent,
  tableCellEditableText,
  updateTableCellContent,
  wrapTableCellNavigation,
} from "./table-cell-editing";

test("table cell editing covers empty runs, deletion, suffix edits, and bounds no-ops", () => {
  assert.equal(
    tableCellEditableText({ text: "Fallback", runs: [] }),
    "Fallback",
  );

  const noChangeRich = {
    text: "AB",
    runs: [
      { text: "A", bold: true },
      { text: "B", italic: true },
    ],
  };
  assert.equal(applyPlainTextEditToTableCell(noChangeRich, "AB"), noChangeRich);
  assert.deepEqual(
    applyPlainTextEditToTableCell(noChangeRich, "AB").runs,
    noChangeRich.runs,
  );
  assert.deepEqual(applyPlainTextEditToTableCell(noChangeRich, ""), {
    text: "",
  });
  assert.deepEqual(applyPlainTextEditToTableCell(noChangeRich, "ZAB").runs, [
    { text: "ZA", bold: true },
    { text: "B", italic: true },
  ]);
  assert.deepEqual(applyPlainTextEditToTableCell(noChangeRich, "AX").runs, [
    { text: "AX", bold: true },
  ]);

  const table: TableContent = {
    columns: [{ id: "c", label: "C" }],
    rows: [{ id: "r", cells: [{ text: "A" }] }],
  };
  assert.equal(
    updateTableCellContent(table, 4, 0, (cell) => ({ ...cell, text: "B" })),
    table,
  );
  assert.equal(
    updateTableCellContent(table, 0, 4, (cell) => ({ ...cell, text: "B" })),
    table,
  );
  assert.equal(applyPlainTextEditToTableContent(table, 4, 4, "B"), table);
  assert.equal(
    wrapTableCellNavigation({
      rowCount: 0,
      colCount: 2,
      rowIndex: 0,
      colIndex: 0,
      direction: 1,
    }),
    null,
  );
});

test("table cell equality detects run style differences before applying wrapper edits", () => {
  const table: TableContent = {
    columns: [{ id: "c", label: "C" }],
    rows: [
      {
        id: "r",
        cells: [
          {
            text: "AB",
            runs: [
              { text: "A", bold: true },
              { text: "B", italic: true },
            ],
          },
        ],
      },
    ],
  };
  const changedStyle = updateTableCellContent(table, 0, 0, (cell) => ({
    ...cell,
    runs: [{ text: "AB", bold: true }],
  }));
  assert.notEqual(changedStyle, table);
  const wrapper = applyPlainTextEditToTableContent(table, 0, 0, "ABC");
  assert.deepEqual(wrapper.rows[0].cells[0].runs, [
    { text: "A", bold: true },
    { text: "BC", italic: true },
  ]);
});
