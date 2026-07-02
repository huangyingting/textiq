import type { ExportVisualOperation } from "../export-spec-types";
import { normalizeVisualChannelColors } from "../visual-channel-colors";
import type { ExportNodeWithContent } from "./shared";
import { exportNodeBasis } from "./shared";

export function lowerVisualNode(
  node: ExportNodeWithContent<"visual">,
): ExportVisualOperation {
  const { frame, style, rotation, zIndex } = exportNodeBasis(node);
  const channelColors = normalizeVisualChannelColors(
    style.visual?.channelColors,
  ).colors;
  const transparentBackground =
    node.content.content.transparentBackground ??
    style.visual?.transparentBackground;

  return {
    type: "visual",
    id: node.id,
    ...(node.content.content.assetId
      ? { assetId: node.content.content.assetId }
      : {}),
    ...(node.content.content.visualId
      ? { visualId: node.content.content.visualId }
      : {}),
    frame,
    style,
    ...(Object.keys(channelColors).length > 0 ? { channelColors } : {}),
    ...(transparentBackground !== undefined ? { transparentBackground } : {}),
    ...(node.content.content.alt ? { alt: node.content.content.alt } : {}),
    ...(rotation !== undefined ? { rotation } : {}),
    zIndex,
  };
}
