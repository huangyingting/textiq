import type { PptxOp } from "../pptx-export-adapter";
import { applyPptxImageOp } from "./image-media-applier";
import {
  applyPptxConnectorOp,
  applyPptxShapeOp,
} from "./shape-connector-applier";
import { applyPptxTableOp } from "./table-applier";
import { applyPptxTextOp } from "./text-rich-text-applier";
import type { PptxSlide } from "./shared";
import { applyPptxVisualOp } from "./visual-block-applier";

export async function applyPptxOp(slide: PptxSlide, op: PptxOp): Promise<void> {
  switch (op.type) {
    case "text":
      applyPptxTextOp(slide, op);
      break;
    case "shape":
      applyPptxShapeOp(slide, op);
      break;
    case "image":
      await applyPptxImageOp(slide, op);
      break;
    case "connector":
      applyPptxConnectorOp(slide, op);
      break;
    case "visual":
      await applyPptxVisualOp(slide, op);
      break;
    case "tableShape":
      applyPptxTableOp(slide, op);
      break;
    default: {
      const _: never = op;
      void _;
    }
  }
}
