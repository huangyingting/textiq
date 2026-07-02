import { useMemo } from "react";

import type { PresentationDiagnostic } from "@/lib/presentation/diagnostics";
import { buildExportSpec } from "@/lib/presentation/export-spec";
import type { ResolvedDeckRenderTree } from "@/lib/presentation/render-tree";

const EMPTY_EXPORT_DIAGNOSTICS: readonly PresentationDiagnostic[] = [];

type ExportDiagnosticsBuilder = (
  renderTree: ResolvedDeckRenderTree,
) => Pick<ReturnType<typeof buildExportSpec>, "diagnostics">;

function isEditorExportDiagnostic(
  diagnostic: PresentationDiagnostic,
): diagnostic is PresentationDiagnostic {
  return (
    diagnostic.code === "unsupported-export-feature" ||
    diagnostic.code === "theme-decoration-export-fallback"
  );
}

export function createExportDiagnosticsMemo(
  buildSpec: ExportDiagnosticsBuilder = buildExportSpec,
): (
  renderTree: ResolvedDeckRenderTree | null | undefined,
) => readonly PresentationDiagnostic[] {
  let cachedRenderTree: ResolvedDeckRenderTree | null = null;
  let cachedDiagnostics: readonly PresentationDiagnostic[] =
    EMPTY_EXPORT_DIAGNOSTICS;

  return (renderTree) => {
    if (!renderTree) {
      cachedRenderTree = null;
      cachedDiagnostics = EMPTY_EXPORT_DIAGNOSTICS;
      return EMPTY_EXPORT_DIAGNOSTICS;
    }

    if (cachedRenderTree === renderTree) {
      return cachedDiagnostics;
    }

    cachedRenderTree = renderTree;
    cachedDiagnostics = buildSpec(renderTree).diagnostics.filter(
      isEditorExportDiagnostic,
    );
    return cachedDiagnostics;
  };
}

export function useExportDiagnostics(
  renderTree: ResolvedDeckRenderTree | null | undefined,
): readonly PresentationDiagnostic[] {
  const resolveExportDiagnostics = useMemo(
    () => createExportDiagnosticsMemo(),
    [],
  );
  return resolveExportDiagnostics(renderTree);
}
