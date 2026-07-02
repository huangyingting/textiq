import type {
  ExportConnectorOperation,
  ExportShapeOperation,
} from "../export-spec-types";
import type { ExportNodeWithContent } from "./shared";
import { exportNodeBasis } from "./shared";

export function lowerShapeNode(
  node: ExportNodeWithContent<"shape">,
): ExportShapeOperation {
  const { frame, style, rotation, zIndex } = exportNodeBasis(node);
  return {
    type: "shape",
    id: node.id,
    shape: node.content.content.shape,
    frame,
    style,
    ...(rotation !== undefined ? { rotation } : {}),
    zIndex,
  };
}

export function lowerConnectorNode(
  node: ExportNodeWithContent<"connector">,
): ExportConnectorOperation {
  const { frame, style, zIndex } = exportNodeBasis(node);
  return {
    type: "connector",
    id: node.id,
    from: node.content.content.from,
    to: node.content.content.to,
    ...(node.content.content.routing
      ? { routing: node.content.content.routing }
      : {}),
    frame,
    style,
    zIndex,
  };
}
