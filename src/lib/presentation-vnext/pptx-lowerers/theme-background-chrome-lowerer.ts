import type {
  ExportBackgroundOperation,
  ExportSlideSpec,
} from "../export-spec-types";
import type { DiagnosticCollector } from "../diagnostics";
import type { VnextPptxBackgroundOp } from "../pptx-export-types";
import { fillToPptxFill } from "./shared";

export function lowerBackgroundOperationToPptx(
  slideId: ExportSlideSpec["id"],
  background: ExportBackgroundOperation,
  dc: DiagnosticCollector,
): VnextPptxBackgroundOp {
  const bgFill = background.fill
    ? fillToPptxFill(background.fill, dc, `slide(${slideId}).background`)
    : undefined;

  return {
    type: "background",
    ...(typeof bgFill === "string" ? { fill: bgFill } : {}),
    ...(bgFill !== undefined && typeof bgFill !== "string"
      ? { imageFill: bgFill }
      : {}),
  };
}
