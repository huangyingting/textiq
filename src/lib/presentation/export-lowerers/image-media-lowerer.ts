import type { ExportImageOperation } from "../export-spec-types";
import type { ExportNodeWithContent } from "./shared";
import { exportNodeBasis } from "./shared";

export function lowerImageNode(
  node: ExportNodeWithContent<"image">,
): ExportImageOperation {
  const { frame, style, rotation, zIndex } = exportNodeBasis(node);
  const fit = node.content.content.fit ?? style.image?.fit;
  return {
    type: "image",
    id: node.id,
    assetId: node.content.content.assetId,
    frame,
    style,
    ...(fit ? { fit } : {}),
    ...(node.content.content.crop ? { crop: node.content.content.crop } : {}),
    ...(node.content.content.alt ? { alt: node.content.content.alt } : {}),
    ...(rotation !== undefined ? { rotation } : {}),
    zIndex,
  };
}
