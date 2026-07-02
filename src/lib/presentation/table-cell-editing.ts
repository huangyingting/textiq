import { mergeRuns, runsToPlainText } from "./rich-text";
import type { TableCell, TableContent, TextRun } from "./schema";

type RunStyle = Omit<TextRun, "text">;

export interface TableCellNavigation {
  rowIndex: number;
  colIndex: number;
}

function cloneRunStyle(style: RunStyle): RunStyle {
  return style.localStyle
    ? { ...style, localStyle: { ...style.localStyle } }
    : { ...style };
}

function styleFromRun(run: TextRun): RunStyle {
  const { text: _text, ...style } = run;
  return cloneRunStyle(style);
}

function sameRunStyle(a: RunStyle, b: RunStyle): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strikethrough === b.strikethrough &&
    a.code === b.code &&
    a.link === b.link &&
    a.localStyle?.color === b.localStyle?.color &&
    a.localStyle?.fontSizePt === b.localStyle?.fontSizePt &&
    a.localStyle?.fontFamily === b.localStyle?.fontFamily
  );
}

function runsEqual(
  a: readonly TextRun[] | undefined,
  b: readonly TextRun[] | undefined,
): boolean {
  const left = a && a.length > 0 ? a : undefined;
  const right = b && b.length > 0 ? b : undefined;
  if (!left || !right) return left === right;
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (
      left[i].text !== right[i].text ||
      !sameRunStyle(styleFromRun(left[i]), styleFromRun(right[i]))
    ) {
      return false;
    }
  }
  return true;
}

export function normalizeTableCellText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function clampTableCellNavigation({
  rowCount,
  colCount,
  rowIndex,
  colIndex,
  rowDelta,
  colDelta,
}: {
  rowCount: number;
  colCount: number;
  rowIndex: number;
  colIndex: number;
  rowDelta: number;
  colDelta: number;
}): TableCellNavigation | null {
  if (rowCount <= 0 || colCount <= 0) return null;
  return {
    rowIndex: Math.max(0, Math.min(rowCount - 1, rowIndex + rowDelta)),
    colIndex: Math.max(0, Math.min(colCount - 1, colIndex + colDelta)),
  };
}

export function wrapTableCellNavigation({
  rowCount,
  colCount,
  rowIndex,
  colIndex,
  direction,
}: {
  rowCount: number;
  colCount: number;
  rowIndex: number;
  colIndex: number;
  direction: 1 | -1;
}): TableCellNavigation | null {
  if (rowCount <= 0 || colCount <= 0) return null;
  const total = rowCount * colCount;
  const current = rowIndex * colCount + colIndex;
  const next = (current + direction + total) % total;
  return {
    rowIndex: Math.floor(next / colCount),
    colIndex: next % colCount,
  };
}

export function tableCellEditableText(cell: TableCell): string {
  return cell.runs && cell.runs.length > 0
    ? runsToPlainText(cell.runs)
    : cell.text;
}

function rebuildRunsForEditedText(
  runs: readonly TextRun[],
  nextText: string,
): TextRun[] {
  const previousText = runsToPlainText(runs);
  if (previousText === nextText) return runs.map((run) => ({ ...run }));
  if (nextText.length === 0) return [];

  const characterStyles: RunStyle[] = [];
  for (const run of runs) {
    const style = styleFromRun(run);
    for (let index = 0; index < run.text.length; index += 1) {
      characterStyles.push(style);
    }
  }

  let prefixLength = 0;
  while (
    prefixLength < previousText.length &&
    prefixLength < nextText.length &&
    previousText[prefixLength] === nextText[prefixLength]
  ) {
    prefixLength += 1;
  }

  let previousSuffixStart = previousText.length;
  let nextSuffixStart = nextText.length;
  while (
    previousSuffixStart > prefixLength &&
    nextSuffixStart > prefixLength &&
    previousText[previousSuffixStart - 1] === nextText[nextSuffixStart - 1]
  ) {
    previousSuffixStart -= 1;
    nextSuffixStart -= 1;
  }

  const fallbackStyle =
    characterStyles[0] ?? (runs[0] ? styleFromRun(runs[0]) : {});
  const insertionStyle =
    (prefixLength > 0 ? characterStyles[prefixLength - 1] : undefined) ??
    characterStyles[previousSuffixStart] ??
    fallbackStyle;

  const rebuiltRuns = nextText.split("").map((character, index) => {
    const style =
      index < prefixLength
        ? (characterStyles[index] ?? insertionStyle)
        : index >= nextSuffixStart
          ? (characterStyles[previousSuffixStart + index - nextSuffixStart] ??
            insertionStyle)
          : insertionStyle;
    return {
      text: character,
      ...cloneRunStyle(style),
    };
  });

  return mergeRuns(rebuiltRuns);
}

export function applyPlainTextEditToTableCell(
  cell: TableCell,
  rawText: string,
): TableCell {
  const nextText = normalizeTableCellText(rawText);
  if (!cell.runs || cell.runs.length === 0) {
    return cell.text === nextText ? cell : { ...cell, text: nextText };
  }

  const nextRuns = rebuildRunsForEditedText(cell.runs, nextText);
  const normalizedRuns = nextRuns.length > 0 ? nextRuns : undefined;
  if (cell.text === nextText && runsEqual(cell.runs, normalizedRuns)) {
    return cell;
  }

  const nextCell: TableCell = { ...cell, text: nextText };
  if (normalizedRuns) {
    nextCell.runs = normalizedRuns;
  } else {
    delete nextCell.runs;
  }
  return nextCell;
}

export function updateTableCellContent(
  table: TableContent,
  rowIndex: number,
  cellIndex: number,
  updater: (cell: TableCell) => TableCell,
): TableContent {
  const row = table.rows[rowIndex];
  const current = row?.cells[cellIndex];
  if (!row || !current) return table;

  const nextCell = updater(current);
  if (
    nextCell === current ||
    (nextCell.text === current.text && runsEqual(nextCell.runs, current.runs))
  ) {
    return table;
  }

  return {
    ...table,
    rows: table.rows.map((candidateRow, candidateRowIndex) =>
      candidateRowIndex === rowIndex
        ? {
            ...candidateRow,
            cells: candidateRow.cells.map((cell, candidateCellIndex) =>
              candidateCellIndex === cellIndex ? nextCell : cell,
            ),
          }
        : candidateRow,
    ),
  };
}

export function applyPlainTextEditToTableContent(
  table: TableContent,
  rowIndex: number,
  cellIndex: number,
  rawText: string,
): TableContent {
  return updateTableCellContent(table, rowIndex, cellIndex, (cell) =>
    applyPlainTextEditToTableCell(cell, rawText),
  );
}
