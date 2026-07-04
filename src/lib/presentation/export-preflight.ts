import type { PresentationDiagnostic } from "./diagnostics";
import { diagnosticTargetKey } from "./diagnostics";
import { buildExportSpec } from "./export-spec";
import type { ExportDeckSpec } from "./export-spec";
import { buildPptxSpec } from "./pptx-export-adapter";
import { resolveExportSpecAssetSources } from "./pptx-apply";
import type { ResolvedDeckRenderTree } from "./render-tree";
import type { Deck } from "./schema";

export type PresentationExportFormat = "pptx" | "pdf" | "png";

export type PresentationExportFallbackTier =
  "native" | "image-retry" | "placeholder" | "raster" | "diagnostic";

export interface PresentationExportPreflightResult {
  format: PresentationExportFormat;
  label: string;
  diagnostics: readonly PresentationDiagnostic[];
  fatalDiagnostics: readonly PresentationDiagnostic[];
  warningDiagnostics: readonly PresentationDiagnostic[];
  fallbackTiers: readonly PresentationExportFallbackTier[];
  hasFatal: boolean;
  hasWarnings: boolean;
  canExport: boolean;
}

export interface BuildPresentationExportPreflightArgs {
  deck: Deck;
  renderTree: ResolvedDeckRenderTree;
  format: PresentationExportFormat;
  buildSpec?: (renderTree: ResolvedDeckRenderTree) => ExportDeckSpec;
}

const EXPORT_FORMAT_LABELS: Record<PresentationExportFormat, string> = {
  pptx: "PPTX",
  pdf: "PDF",
  png: "PNGs",
};

const FALLBACK_TIER_ORDER: readonly PresentationExportFallbackTier[] = [
  "native",
  "image-retry",
  "placeholder",
  "raster",
  "diagnostic",
];

function diagnosticKey(diagnostic: PresentationDiagnostic): string {
  return [
    diagnostic.code,
    diagnostic.severity,
    diagnostic.category,
    diagnosticTargetKey(diagnostic.target),
    diagnostic.path ?? "",
    diagnostic.message,
  ].join(":");
}

function dedupeDiagnostics(
  diagnostics: readonly PresentationDiagnostic[],
): PresentationDiagnostic[] {
  const seen = new Set<string>();
  const result: PresentationDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const key = diagnosticKey(diagnostic);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(diagnostic);
  }
  return result;
}

function isFatalExportDiagnostic(diagnostic: PresentationDiagnostic): boolean {
  return diagnostic.severity === "fatal" || diagnostic.severity === "error";
}

function isWarningExportDiagnostic(
  diagnostic: PresentationDiagnostic,
): boolean {
  return diagnostic.severity === "warning";
}

function detailString(
  diagnostic: PresentationDiagnostic,
  key: string,
): string | undefined {
  const value = diagnostic.details?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function fallbackTierForDiagnostic(
  diagnostic: PresentationDiagnostic,
  format: PresentationExportFormat,
): PresentationExportFallbackTier | undefined {
  const exportFeature = detailString(diagnostic, "exportFeature");
  if (exportFeature?.includes("image-retry")) return "image-retry";
  if (exportFeature === "pptx-visual-asset-preflight") {
    return diagnostic.code === "missing-asset" ? "placeholder" : "image-retry";
  }
  if (diagnostic.code === "theme-decoration-export-fallback") {
    return format === "pptx" ? "image-retry" : "raster";
  }
  if (
    diagnostic.code === "unsupported-export-feature" &&
    diagnostic.category === "export"
  ) {
    return "diagnostic";
  }
  return undefined;
}

function resolveFallbackTiers(
  diagnostics: readonly PresentationDiagnostic[],
  format: PresentationExportFormat,
): PresentationExportFallbackTier[] {
  const tiers = new Set<PresentationExportFallbackTier>();
  for (const diagnostic of diagnostics) {
    const tier = fallbackTierForDiagnostic(diagnostic, format);
    if (tier) tiers.add(tier);
  }
  if (tiers.size === 0) tiers.add(format === "pptx" ? "native" : "raster");
  return FALLBACK_TIER_ORDER.filter((tier) => tiers.has(tier));
}

function buildFormatDiagnostics({
  deck,
  renderTree,
  format,
  buildSpec,
}: BuildPresentationExportPreflightArgs): PresentationDiagnostic[] {
  const exportSpec = (buildSpec ?? buildExportSpec)(renderTree);
  if (format !== "pptx") return exportSpec.diagnostics;

  const pptxSpec = buildPptxSpec(
    resolveExportSpecAssetSources(deck, exportSpec),
  );
  return pptxSpec.diagnostics;
}

export function buildPresentationExportPreflight(
  args: BuildPresentationExportPreflightArgs,
): PresentationExportPreflightResult {
  const diagnostics = dedupeDiagnostics(buildFormatDiagnostics(args));
  const fatalDiagnostics = diagnostics.filter(isFatalExportDiagnostic);
  const warningDiagnostics = diagnostics.filter(isWarningExportDiagnostic);

  return {
    format: args.format,
    label: EXPORT_FORMAT_LABELS[args.format],
    diagnostics,
    fatalDiagnostics,
    warningDiagnostics,
    fallbackTiers: resolveFallbackTiers(diagnostics, args.format),
    hasFatal: fatalDiagnostics.length > 0,
    hasWarnings: warningDiagnostics.length > 0,
    canExport: fatalDiagnostics.length === 0,
  };
}
