import type { ExportOperation } from "../export-spec-types";
import type { DiagnosticCollector } from "../diagnostics";
import type { ResolvedRenderNode } from "../render-tree";
import type { ExportNodeWithContent } from "./shared";
import { lowerImageNode } from "./image-media-lowerer";
import { lowerConnectorNode, lowerShapeNode } from "./shape-connector-lowerer";
import { lowerTableNode } from "./table-lowerer";
import { lowerTextNode } from "./text-rich-text-lowerer";
import { warnUnsupportedExportEffect } from "./shared";
import { lowerVisualNode } from "./visual-block-lowerer";

export function lowerNodeToExportOperations(
  node: ResolvedRenderNode,
  dc: DiagnosticCollector,
): ExportOperation[] {
  warnUnsupportedExportEffect(node, dc);

  if (node.type === "group") {
    const ops: ExportOperation[] = [];
    for (const child of node.children ?? []) {
      ops.push(...lowerNodeToExportOperations(child, dc));
    }
    return ops;
  }

  switch (node.content.type) {
    case "text":
      return [lowerTextNode(node as ExportNodeWithContent<"text">)];
    case "image":
      return [lowerImageNode(node as ExportNodeWithContent<"image">)];
    case "shape":
      return [lowerShapeNode(node as ExportNodeWithContent<"shape">)];
    case "connector":
      return [lowerConnectorNode(node as ExportNodeWithContent<"connector">)];
    case "visual":
      return [lowerVisualNode(node as ExportNodeWithContent<"visual">)];
    case "table":
      return [lowerTableNode(node as ExportNodeWithContent<"table">)];
    case "group":
      return [];
    default: {
      void (node.content as never);
      dc.warning(
        "unsupported-export-feature",
        `Node "${node.id}": unknown content type in export`,
      );
      return [];
    }
  }
}
