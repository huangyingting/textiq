import type { ExportTableShapeOperation } from "../export-spec-types";
import type { ExportNodeWithContent } from "./shared";
import { exportNodeBasis } from "./shared";

export function lowerTableNode(
  node: ExportNodeWithContent<"table">,
): ExportTableShapeOperation {
  const { frame, style, zIndex } = exportNodeBasis(node);
  return {
    type: "tableShape",
    id: node.id,
    frame,
    style,
    table: node.content.content,
    zIndex,
  };
}
