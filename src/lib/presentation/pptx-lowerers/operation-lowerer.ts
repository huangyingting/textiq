import type { ExportOperation } from "../export-spec-types";
import type { PptxOp } from "../pptx-export-types";
import { lowerImageOpToPptx } from "./image-media-lowerer";
import {
  lowerConnectorOpToPptx,
  lowerShapeOpToPptx,
} from "./shape-connector-lowerer";
import { lowerTableOpToPptx } from "./table-lowerer";
import { lowerTextOpToPptx } from "./text-rich-text-lowerer";
import type { PptxLowererContext } from "./shared";
import { lowerVisualOpToPptx } from "./visual-block-lowerer";

export function lowerExportOperationToPptx(
  op: ExportOperation,
  ctx: PptxLowererContext,
): PptxOp | null {
  switch (op.type) {
    case "text":
      return lowerTextOpToPptx(op, ctx);
    case "shape":
      return lowerShapeOpToPptx(op, ctx);
    case "image":
      return lowerImageOpToPptx(op, ctx);
    case "connector":
      return lowerConnectorOpToPptx(op, ctx);
    case "visual":
      return lowerVisualOpToPptx(op, ctx);
    case "tableShape":
      return lowerTableOpToPptx(op, ctx);
    default: {
      const _: never = op;
      void _;
      ctx.dc.warning(
        "unsupported-export-feature",
        `Unknown export operation type in PPTX adapter`,
      );
      return null;
    }
  }
}
