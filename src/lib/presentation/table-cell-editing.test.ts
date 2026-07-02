import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { TableContent } from "@/lib/presentation/schema";
import {
  applyPlainTextEditToTableCell,
  applyPlainTextEditToTableContent,
  clampTableCellNavigation,
  normalizeTableCellText,
  tableCellEditableText,
  updateTableCellContent,
  wrapTableCellNavigation,
} from "./table-cell-editing";

describe("table cell editing", () => {
  test("prefers runs when resolving editable table cell text", () => {
    assert.equal(
      tableCellEditableText({
        text: "Fallback",
        runs: [{ text: "Run " }, { text: "text", bold: true }],
      }),
      "Run text",
    );
    assert.equal(tableCellEditableText({ text: "Plain" }), "Plain");
  });

  test("normalizes whitespace and preserves rich formatting for single-run edits", () => {
    const edited = applyPlainTextEditToTableCell(
      { text: "15%", runs: [{ text: "15%", bold: true }] },
      " 16% \n",
    );

    assert.equal(normalizeTableCellText(" 16% \n"), "16%");
    assert.equal(edited.text, "16%");
    assert.deepEqual(edited.runs, [{ text: "16%", bold: true }]);
  });

  test("preserves neighboring run styles for middle insertions", () => {
    const edited = applyPlainTextEditToTableCell(
      {
        text: "AB",
        runs: [
          { text: "A", bold: true },
          { text: "B", italic: true },
        ],
      },
      "ACB",
    );

    assert.equal(edited.text, "ACB");
    assert.deepEqual(edited.runs, [
      { text: "AC", bold: true },
      { text: "B", italic: true },
    ]);
  });

  test("returns the original plain-text cell when no change is needed", () => {
    const cell = { text: "Revenue" };
    const edited = applyPlainTextEditToTableCell(cell, "Revenue");
    assert.equal(edited, cell);
  });

  test("updates only the targeted table cell and keeps no-op edits stable", () => {
    const table: TableContent = {
      columns: [
        { id: "c1", label: "Metric" },
        { id: "c2", label: "Value" },
      ],
      rows: [
        {
          id: "r1",
          cells: [
            { text: "ARR" },
            { text: "$12M", runs: [{ text: "$12M", bold: true }] },
          ],
        },
        { id: "r2", cells: [{ text: "NRR" }, { text: "118%" }] },
      ],
    };

    const unchanged = updateTableCellContent(table, 0, 0, (cell) => ({
      ...cell,
    }));
    assert.equal(unchanged, table);

    const updated = applyPlainTextEditToTableContent(table, 0, 1, "$13M");
    assert.equal(updated.rows[0].cells[1].text, "$13M");
    assert.deepEqual(updated.rows[0].cells[1].runs, [
      { text: "$13M", bold: true },
    ]);
    assert.equal(updated.rows[1], table.rows[1]);
    assert.equal(updated.columns, table.columns);
  });

  test("clamps row and column movement within table bounds", () => {
    assert.deepEqual(
      clampTableCellNavigation({
        rowCount: 3,
        colCount: 2,
        rowIndex: 1,
        colIndex: 1,
        rowDelta: 5,
        colDelta: 5,
      }),
      { rowIndex: 2, colIndex: 1 },
    );
    assert.deepEqual(
      clampTableCellNavigation({
        rowCount: 3,
        colCount: 2,
        rowIndex: 1,
        colIndex: 0,
        rowDelta: -5,
        colDelta: -5,
      }),
      { rowIndex: 0, colIndex: 0 },
    );
    assert.equal(
      clampTableCellNavigation({
        rowCount: 0,
        colCount: 2,
        rowIndex: 0,
        colIndex: 0,
        rowDelta: 1,
        colDelta: 0,
      }),
      null,
    );
  });

  test("wraps linear table movement for Tab and Shift+Tab navigation", () => {
    assert.deepEqual(
      wrapTableCellNavigation({
        rowCount: 2,
        colCount: 2,
        rowIndex: 0,
        colIndex: 1,
        direction: 1,
      }),
      { rowIndex: 1, colIndex: 0 },
    );
    assert.deepEqual(
      wrapTableCellNavigation({
        rowCount: 2,
        colCount: 2,
        rowIndex: 0,
        colIndex: 0,
        direction: -1,
      }),
      { rowIndex: 1, colIndex: 1 },
    );
    assert.equal(
      wrapTableCellNavigation({
        rowCount: 2,
        colCount: 0,
        rowIndex: 0,
        colIndex: 0,
        direction: 1,
      }),
      null,
    );
  });
});
