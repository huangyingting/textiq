import type { ExportTextOperation } from "../export-spec-types";
import type { ExportNodeWithContent } from "./shared";
import { exportNodeBasis } from "./shared";

export function lowerTextNode(
  node: ExportNodeWithContent<"text">,
): ExportTextOperation {
  const { frame, style, rotation, zIndex } = exportNodeBasis(node);
  return {
    type: "text",
    id: node.id,
    frame,
    content: node.content.content,
    style,
    ...(rotation !== undefined ? { rotation } : {}),
    zIndex,
  };
}
