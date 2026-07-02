import type { ResolvedNodeContent, ResolvedRenderNode } from "../render-tree";
import type { DiagnosticCollector } from "../diagnostics";

export type ExportFrame = { x: number; y: number; w: number; h: number };

export type ExportNodeWithContent<T extends ResolvedNodeContent["type"]> =
  ResolvedRenderNode & {
    content: Extract<ResolvedNodeContent, { type: T }>;
  };

export function resolvedFrame(node: ResolvedRenderNode): ExportFrame {
  // Prefer pixel frame if available, fall back to percent frame.
  if (node.layout.framePx) return node.layout.framePx;
  return node.layout.frame;
}

export function exportNodeBasis(node: ResolvedRenderNode): {
  frame: ExportFrame;
  style: ResolvedRenderNode["style"];
  rotation: ResolvedRenderNode["layout"]["rotation"];
  zIndex: ResolvedRenderNode["layout"]["zIndex"];
} {
  return {
    frame: resolvedFrame(node),
    style: node.style,
    rotation: node.layout.rotation,
    zIndex: node.layout.zIndex,
  };
}

export function warnUnsupportedExportEffect(
  node: ResolvedRenderNode,
  dc: DiagnosticCollector,
): void {
  const effect = node.style.effect;
  if (!effect || effect.kind === "none") return;
  if (effect.kind !== "glass" && effect.kind !== "blur") return;

  const isThemeDecoration = node.source === "themeDecoration";
  dc.warning(
    isThemeDecoration
      ? "theme-decoration-export-fallback"
      : "unsupported-export-feature",
    `Node "${node.id}": effect "${effect.kind}" uses a deterministic export fallback`,
    {
      nodeId: node.id,
      ...(isThemeDecoration
        ? {
            details: {
              decorationId: node.id.replace(/^decoration-/, ""),
              exportFeature: "theme-decoration-effect",
            },
          }
        : { action: { type: "replace-style-ref" as const } }),
    },
  );
}
