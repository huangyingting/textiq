"use client";

import type { JSX } from "react";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

import type { PresentationDiagnostic } from "@/lib/presentation/diagnostics";
import { diagnosticTargetLabel } from "@/lib/presentation/diagnostics";
import type {
  PresentationExportFallbackTier,
  PresentationExportPreflightResult,
} from "@/lib/presentation/export-preflight";
import { Dialog } from "@/components/ui/dialog";
import { cx, FOCUS_RING } from "@/components/ui/tokens";

const SEVERITY_STYLES: Record<string, string> = {
  fatal: "bg-ds-status-error-fill text-ds-status-error-text",
  error: "bg-ds-status-error-fill text-ds-status-error-text",
  warning: "bg-ds-status-warning-fill text-ds-status-warning-text",
  info: "bg-ds-surface-2 text-ds-text-secondary",
};

const FALLBACK_TIER_LABELS: Record<PresentationExportFallbackTier, string> = {
  native: "Native",
  "image-retry": "Image retry",
  placeholder: "Placeholder",
  raster: "Raster",
  diagnostic: "Diagnostic fallback",
};

export interface ExportPreflightDialogProps {
  result: PresentationExportPreflightResult;
  onClose: () => void;
  onContinue: () => void;
}

function DiagnosticList({
  diagnostics,
}: {
  diagnostics: readonly PresentationDiagnostic[];
}): JSX.Element {
  return (
    <ul className="mt-2 flex flex-col gap-2" role="list">
      {diagnostics.map((diagnostic, index) => (
        <li
          key={`${diagnostic.code}-${diagnostic.path ?? ""}-${index}`}
          className="rounded-ds-sm border border-ds-border-subtle bg-ds-surface-raised px-3 py-2 text-xs"
        >
          <div className="flex items-start gap-2">
            <span
              className={cx(
                "mt-0.5 rounded px-1 py-0.5 text-[10px] font-bold uppercase",
                SEVERITY_STYLES[diagnostic.severity],
              )}
            >
              {diagnostic.severity}
            </span>
            <div className="min-w-0">
              <p className="text-ds-text-primary">{diagnostic.message}</p>
              <p className="mt-0.5 text-[11px] text-ds-text-muted">
                {diagnostic.code} · {diagnosticTargetLabel(diagnostic.target)}
                {diagnostic.path ? ` · ${diagnostic.path}` : ""}
              </p>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ExportPreflightDialog({
  result,
  onClose,
  onContinue,
}: ExportPreflightDialogProps): JSX.Element {
  const titleId = `export-preflight-${result.format}-title`;
  const isBlocked = !result.canExport;

  return (
    <Dialog
      open={true}
      onClose={onClose}
      aria-labelledby={titleId}
      className="flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-ds-lg border border-ds-border-subtle bg-ds-surface p-0 shadow-ds-overlay"
    >
      <section
        data-export-preflight-dialog={result.format}
        className="flex min-h-0 flex-1 flex-col"
      >
        <header className="flex items-start gap-3 border-b border-ds-border-subtle px-4 py-3">
          <div
            className={cx(
              "mt-0.5 rounded-full p-1",
              isBlocked
                ? "bg-ds-status-error-fill text-ds-status-error-text"
                : "bg-ds-status-warning-fill text-ds-status-warning-text",
            )}
          >
            {isBlocked ? (
              <XCircle size={16} aria-hidden="true" />
            ) : (
              <AlertTriangle size={16} aria-hidden="true" />
            )}
          </div>
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-sm font-semibold text-ds-text-primary"
            >
              Review {result.label} export
            </h2>
            <p className="mt-1 text-xs text-ds-text-secondary">
              {isBlocked
                ? "Fix blockers before this export can download."
                : "Review warnings, then continue export if the fallback is acceptable."}
            </p>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <div className="rounded-ds-md border border-ds-border-subtle bg-ds-surface-raised px-3 py-2 text-xs text-ds-text-secondary">
            <div className="flex items-center gap-2 font-medium text-ds-text-primary">
              <CheckCircle2 size={14} aria-hidden="true" />
              Fallback tiers
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {result.fallbackTiers.map((tier) => (
                <span
                  key={tier}
                  className="rounded-full bg-ds-surface-2 px-2 py-0.5 text-[11px] font-medium text-ds-text-secondary"
                >
                  {FALLBACK_TIER_LABELS[tier]}
                </span>
              ))}
            </div>
          </div>

          {result.fatalDiagnostics.length > 0 ? (
            <section className="mt-3">
              <h3 className="text-xs font-semibold text-ds-text-primary">
                Blockers ({result.fatalDiagnostics.length})
              </h3>
              <DiagnosticList diagnostics={result.fatalDiagnostics} />
            </section>
          ) : null}

          {result.warningDiagnostics.length > 0 ? (
            <section className="mt-3">
              <h3 className="text-xs font-semibold text-ds-text-primary">
                Warnings ({result.warningDiagnostics.length})
              </h3>
              <DiagnosticList diagnostics={result.warningDiagnostics} />
            </section>
          ) : null}
        </div>

        <footer className="flex justify-end gap-2 border-t border-ds-border-subtle px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className={cx(
              "rounded-full border border-ds-border-strong px-4 py-2 text-xs font-medium text-ds-text-secondary hover:bg-ds-state-hover",
              FOCUS_RING,
            )}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isBlocked}
            onClick={onContinue}
            className={cx(
              "rounded-full bg-ds-accent px-4 py-2 text-xs font-semibold text-ds-text-on-accent hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40",
              FOCUS_RING,
            )}
          >
            Continue export
          </button>
        </footer>
      </section>
    </Dialog>
  );
}
