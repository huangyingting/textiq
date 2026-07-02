"use client";

/**
 * Diagnostics panel for the presentation slide inspector.
 *
 * Shows structured `PresentationDiagnostic` items grouped by diagnostic target
 * scope and surfaces one-click action buttons. Callers handle action routing.
 */

import type { JSX } from "react";

import type {
  PresentationDiagnostic,
  DiagnosticSeverity,
  DiagnosticAction,
} from "@/lib/presentation/diagnostics";
import {
  diagnosticTargetLabel,
  groupDiagnostics,
} from "@/lib/presentation/diagnostics";
import { diagnosticActionDescriptor } from "@/lib/presentation/review-action-descriptors";
import { FOCUS_RING } from "@/components/ui/tokens";

// ---------------------------------------------------------------------------
// Severity badge styles
// ---------------------------------------------------------------------------

const SEVERITY_STYLES: Record<
  DiagnosticSeverity,
  { badge: string; row: string }
> = {
  fatal: {
    badge: "bg-ds-status-error-fill text-ds-status-error-text",
    row: "border-l-2 border-ds-status-error-fill bg-ds-status-error-subtle",
  },
  error: {
    badge: "bg-ds-status-error-fill text-ds-status-error-text",
    row: "border-l-2 border-ds-status-error-fill bg-ds-status-error-subtle",
  },
  warning: {
    badge: "bg-ds-status-warning-fill text-ds-status-warning-text",
    row: "border-l-2 border-ds-status-warning-fill bg-ds-status-warning-subtle",
  },
  info: {
    badge: "bg-ds-surface-2 text-ds-text-secondary",
    row: "border-l-2 border-ds-border-subtle bg-ds-surface",
  },
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DiagnosticsPanelProps {
  diagnostics: PresentationDiagnostic[];
  /**
   * Called when the user clicks an action button.
   * The caller is responsible for routing to the appropriate editor command.
   */
  onAction: (
    action: DiagnosticAction,
    diagnostic: PresentationDiagnostic,
  ) => void;
  /** When true, info-severity diagnostics are hidden. Defaults to false. */
  hideInfo?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DiagnosticsPanel({
  diagnostics,
  onAction,
  hideInfo = false,
}: DiagnosticsPanelProps): JSX.Element | null {
  const visible = hideInfo
    ? diagnostics.filter((d) => d.severity !== "info")
    : diagnostics;
  const groups = groupDiagnostics(visible);

  if (groups.length === 0) return null;

  return (
    <section className="flex flex-col gap-2 px-3 py-2.5">
      <h4 className="text-[10px] font-bold uppercase tracking-[0.06em] text-ds-text-muted">
        Diagnostics
      </h4>
      <div className="flex flex-col gap-2">
        {groups.map((group) => (
          <section key={group.key} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="truncate font-semibold text-ds-text-secondary">
                {group.label}
              </span>
              <span className="shrink-0 uppercase tracking-[0.06em] text-ds-text-muted">
                {group.scope}
              </span>
            </div>
            <ul className="flex flex-col gap-1" role="list">
              {group.diagnostics.map((d, i) => {
                const action = d.action;
                const actionDescriptor = action
                  ? diagnosticActionDescriptor(action)
                  : undefined;
                const styles = SEVERITY_STYLES[d.severity];
                return (
                  <li
                    key={`${d.code}-${d.path ?? ""}-${i}`}
                    className={`flex flex-col gap-1 rounded-ds-sm px-2 py-1.5 text-xs ${styles.row}`}
                  >
                    <div className="flex items-start gap-1.5">
                      <span
                        className={`mt-0.5 shrink-0 rounded px-1 py-0.5 text-[10px] font-bold uppercase ${styles.badge}`}
                      >
                        {d.severity}
                      </span>
                      <span className="text-ds-text-primary">{d.message}</span>
                    </div>
                    <p className="text-[11px] text-ds-text-muted">
                      {d.code} · {d.category} ·{" "}
                      {diagnosticTargetLabel(d.target)}
                    </p>
                    {action && actionDescriptor ? (
                      <button
                        type="button"
                        disabled={Boolean(actionDescriptor.disabledReason)}
                        title={actionDescriptor.disabledReason}
                        onClick={() => onAction(action, d)}
                        className={`self-start rounded-ds-sm px-2 py-0.5 text-[11px] font-medium text-ds-accent-text underline-offset-2 hover:underline disabled:opacity-40 ${FOCUS_RING}`}
                      >
                        {actionDescriptor.label}
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}
