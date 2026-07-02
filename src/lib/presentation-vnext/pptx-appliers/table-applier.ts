import type { VnextPptxTableOp } from "../pptx-export-adapter";
import type { TableCell } from "../schema";
import type { PptxSlide } from "./shared";
import { textContentToPptxRuns } from "./text-rich-text-applier";

const CAPTION_GAP_IN = 0.05;
const CAPTION_HEIGHT_IN = 0.3;

function tableCellText(cell: TableCell): string | Record<string, unknown>[] {
  if (!cell.runs || cell.runs.length === 0) return cell.text;
  return textContentToPptxRuns({
    paragraphs: [{ id: "cell", text: cell.text, runs: cell.runs }],
  });
}

function tableCellOptions(
  fill: string | undefined,
  textStyle: VnextPptxTableOp["textStyle"],
): Record<string, unknown> {
  return {
    ...(fill !== undefined ? { fill: { color: fill } } : {}),
    ...(textStyle?.fontSize !== undefined
      ? { fontSize: textStyle.fontSize }
      : {}),
    ...(textStyle?.fontFace !== undefined
      ? { fontFace: textStyle.fontFace }
      : {}),
  };
}

export function applyVnextTableOp(
  slide: PptxSlide,
  op: VnextPptxTableOp,
): void {
  const {
    x,
    y,
    w,
    h,
    table,
    headerFill,
    rowFill,
    alternateRowFill,
    border,
    cellMargin,
    textStyle,
  } = op;

  type PptxTableCell = {
    text: string | Record<string, unknown>[];
    options?: Record<string, unknown>;
  };

  if (table.caption) {
    slide.addText(table.caption, {
      x,
      y: Math.max(0, y - CAPTION_HEIGHT_IN - CAPTION_GAP_IN),
      w,
      h: CAPTION_HEIGHT_IN,
      ...(textStyle?.fontSize !== undefined
        ? { fontSize: textStyle.fontSize }
        : {}),
      ...(textStyle?.fontFace !== undefined
        ? { fontFace: textStyle.fontFace }
        : {}),
      ...(textStyle?.color !== undefined ? { color: textStyle.color } : {}),
      ...(textStyle?.italic ? { italic: true } : {}),
    } as Parameters<PptxSlide["addText"]>[1]);
  }

  const headerRow: PptxTableCell[] = table.columns.map((col) => ({
    text: col.label,
    options: {
      bold: true,
      ...(headerFill !== undefined ? { fill: { color: headerFill } } : {}),
      ...(textStyle?.fontSize !== undefined
        ? { fontSize: textStyle.fontSize }
        : {}),
      ...(textStyle?.fontFace !== undefined
        ? { fontFace: textStyle.fontFace }
        : {}),
    },
  }));

  const dataRows: PptxTableCell[][] = table.rows.map((row, rowIndex) =>
    row.cells.map((cell) => {
      const fill =
        rowIndex % 2 === 1 && alternateRowFill !== undefined
          ? alternateRowFill
          : rowFill;
      return {
        text: tableCellText(cell),
        options: tableCellOptions(fill, textStyle),
      };
    }),
  );

  slide.addTable(
    [headerRow, ...dataRows] as Parameters<PptxSlide["addTable"]>[0],
    {
      x,
      y,
      w,
      h,
      ...(border !== undefined
        ? {
            border: {
              color: border.color,
              pt: border.widthPt,
              type:
                border.dash === undefined || border.dash === "solid"
                  ? "solid"
                  : "dash",
            },
          }
        : {}),
      ...(cellMargin !== undefined ? { margin: cellMargin } : {}),
    },
  );
}
