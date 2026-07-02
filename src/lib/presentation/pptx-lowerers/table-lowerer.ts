import type { ExportTableShapeOperation } from "../export-spec-types";
import type { PptxTableOp } from "../pptx-export-types";
import {
  fillToHex,
  frameToInches,
  resolveColor,
  styleToTextOptions,
} from "./shared";
import type { PptxLowererContext } from "./shared";

function ptToIn(pt: number): number {
  return Math.round((pt / 72) * 1000) / 1000;
}

export function lowerTableOpToPptx(
  op: ExportTableShapeOperation,
  ctx: PptxLowererContext,
): PptxTableOp {
  const frame = frameToInches(op.frame, ctx);
  const tableStyle = op.style.table;
  const headerFill = tableStyle?.headerFill
    ? fillToHex(tableStyle.headerFill, ctx.dc, `op(table:${op.id}).headerFill`)
    : undefined;
  const rowFill = tableStyle?.rowFill
    ? fillToHex(tableStyle.rowFill, ctx.dc, `op(table:${op.id}).rowFill`)
    : undefined;
  const alternateRowFill = tableStyle?.alternateRowFill
    ? fillToHex(
        tableStyle.alternateRowFill,
        ctx.dc,
        `op(table:${op.id}).alternateRowFill`,
      )
    : undefined;
  const border = tableStyle?.border
    ? {
        color: resolveColor(
          tableStyle.border.color,
          "#000000",
          ctx.dc,
          `op(table:${op.id}).border.color`,
        ),
        widthPt: tableStyle.border.widthPt,
        ...(tableStyle.border.dash !== undefined
          ? { dash: tableStyle.border.dash }
          : {}),
      }
    : undefined;
  const cellMargin = tableStyle?.cellPaddingPt
    ? ([
        ptToIn(tableStyle.cellPaddingPt.top),
        ptToIn(tableStyle.cellPaddingPt.right),
        ptToIn(tableStyle.cellPaddingPt.bottom),
        ptToIn(tableStyle.cellPaddingPt.left),
      ] satisfies [number, number, number, number])
    : undefined;
  return {
    type: "tableShape",
    id: op.id,
    ...frame,
    table: op.table,
    ...(headerFill !== undefined ? { headerFill } : {}),
    ...(rowFill !== undefined ? { rowFill } : {}),
    ...(alternateRowFill !== undefined ? { alternateRowFill } : {}),
    ...(border !== undefined ? { border } : {}),
    ...(cellMargin !== undefined ? { cellMargin } : {}),
    ...(tableStyle?.text
      ? { textStyle: styleToTextOptions({ text: tableStyle.text }) }
      : {}),
    zIndex: op.zIndex,
  };
}
