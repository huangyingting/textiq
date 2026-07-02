import type {
  ExportBackgroundOperation,
  ExportOperation,
} from "../export-spec-types";
import type { DiagnosticCollector } from "../diagnostics";
import type {
  ResolvedRenderNode,
  ResolvedSlideRenderTree,
} from "../render-tree";
import { lowerNodeToExportOperations } from "./export-node-lowerer";

function compareByZIndex(
  left: ResolvedRenderNode,
  right: ResolvedRenderNode,
): number {
  return (left.layout.zIndex ?? 0) - (right.layout.zIndex ?? 0);
}

function lowerNodes(
  nodes: readonly ResolvedRenderNode[],
  dc: DiagnosticCollector,
): ExportOperation[] {
  const operations: ExportOperation[] = [];
  for (const node of nodes) {
    operations.push(...lowerNodeToExportOperations(node, dc));
  }
  return operations;
}

export function lowerSlideBackground(
  slide: ResolvedSlideRenderTree,
): ExportBackgroundOperation {
  return {
    type: "background",
    fill: slide.background.fill,
  };
}

export function lowerThemeDecorationOperations(
  slide: ResolvedSlideRenderTree,
  dc: DiagnosticCollector,
): ExportOperation[] {
  return lowerNodes(slide.decorations, dc);
}

export function lowerBackgroundChromeOperations(
  slide: ResolvedSlideRenderTree,
  dc: DiagnosticCollector,
): ExportOperation[] {
  return lowerNodes(
    slide.chrome
      .filter((node) => (node.layout.zIndex ?? 0) < 0)
      .sort(compareByZIndex),
    dc,
  );
}

export function lowerForegroundChromeOperations(
  slide: ResolvedSlideRenderTree,
  dc: DiagnosticCollector,
): ExportOperation[] {
  return lowerNodes(
    slide.chrome
      .filter((node) => (node.layout.zIndex ?? 0) >= 0)
      .sort(compareByZIndex),
    dc,
  );
}
