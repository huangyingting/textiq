import { diagnosticTargetKey } from "./diagnostics";
import type { PresentationDiagnostic } from "./diagnostics";

function diagnosticSignature(diagnostic: PresentationDiagnostic): string {
  return `${diagnostic.code}:${diagnosticTargetKey(diagnostic.target)}:${diagnostic.path ?? ""}:${diagnostic.message}`;
}

export function dedupePresentationDiagnostics(
  diagnostics: readonly PresentationDiagnostic[],
): PresentationDiagnostic[] {
  const seen = new Set<string>();
  const deduped: PresentationDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const signature = diagnosticSignature(diagnostic);
    if (seen.has(signature)) continue;
    seen.add(signature);
    deduped.push(diagnostic);
  }
  return deduped;
}

export function mergePresentationDiagnostics(
  ...diagnosticSets: readonly (readonly PresentationDiagnostic[])[]
): PresentationDiagnostic[] {
  return dedupePresentationDiagnostics(diagnosticSets.flat());
}
