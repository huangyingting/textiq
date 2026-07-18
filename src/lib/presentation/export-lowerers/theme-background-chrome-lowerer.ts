import type {
  ExportBackgroundOperation,
  ExportOperation,
} from "../export-spec-types";
import type { DiagnosticCollector } from "../diagnostics";
import type {
  ResolvedRenderNode,
  ResolvedSlideRenderTree,
} from "../render-tree";
import {
  effectiveVisualZIndex,
  orderSiblingsByVisualOrder,
} from "../render-order";
import { lowerNodeToExportOperations } from "./export-node-lowerer";

function lowerNodes(
  nodes: readonly ResolvedRenderNode[],
  dc: DiagnosticCollector,
): ExportOperation[] {
  const operations: ExportOperation[] = [];
  for (const node of orderSiblingsByVisualOrder(nodes)) {
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
    slide.chrome.filter((node) => effectiveVisualZIndex(node) < 0),
    dc,
  );
}

export function lowerForegroundChromeOperations(
  slide: ResolvedSlideRenderTree,
  dc: DiagnosticCollector,
): ExportOperation[] {
  return lowerNodes(
    slide.chrome.filter((node) => effectiveVisualZIndex(node) >= 0),
    dc,
  );
}
