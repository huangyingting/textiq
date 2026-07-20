"use client";

import type {
  JSX,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";

import type {
  DiagnosticAction,
  PresentationDiagnostic,
} from "@/lib/presentation/diagnostics";
import {
  diagnosticTargetLabel,
  getDiagnosticNodeId,
  getDiagnosticSlideId,
  groupDiagnostics,
} from "@/lib/presentation/diagnostics";
import { diagnosticActionDescriptor } from "@/lib/presentation/review-action-descriptors";
import { FOCUS_RING, cx } from "@/components/ui/tokens";

const SEVERITY_STYLES: Record<string, string> = {
  fatal: "bg-ds-status-error-fill text-ds-status-error-text",
  error: "bg-ds-status-error-fill text-ds-status-error-text",
  warning: "bg-ds-status-warning-fill text-ds-status-warning-text",
  info: "bg-ds-surface-2 text-ds-text-secondary",
};

export interface DeckDiagnosticsReviewProps {
  diagnostics: readonly PresentationDiagnostic[];
  onClose: () => void;
  onNavigate?: (diagnostic: PresentationDiagnostic) => void;
  onAction?: (
    action: DiagnosticAction,
    diagnostic: PresentationDiagnostic,
  ) => void;
}

function canNavigate(diagnostic: PresentationDiagnostic): boolean {
  return Boolean(
    getDiagnosticSlideId(diagnostic) || getDiagnosticNodeId(diagnostic),
  );
}

function diagnosticReviewContextLabel(
  diagnostic: PresentationDiagnostic,
): string {
  return `${diagnostic.code}: ${diagnostic.message} (${diagnosticTargetLabel(diagnostic.target)}${diagnostic.path ? `, ${diagnostic.path}` : ""})`;
}

export function diagnosticReviewActionAriaLabel(
  actionLabel: string,
  diagnostic: PresentationDiagnostic,
): string {
  return `${actionLabel} for ${diagnosticReviewContextLabel(diagnostic)}`;
}

export function DeckDiagnosticsReview({
  diagnostics,
  onClose,
  onNavigate,
  onAction,
}: DeckDiagnosticsReviewProps): JSX.Element {
  const groups = groupDiagnostics(diagnostics);
  const count = diagnostics.length;
  const handleBackdropClick = (
    event: ReactMouseEvent<HTMLDivElement>,
  ): void => {
    if (event.target !== event.currentTarget) return;
    onClose();
  };
  const handleDialogKeyDown = (
    event: ReactKeyboardEvent<HTMLElement>,
  ): void => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    onClose();
  };

  return (
    <div
      className="absolute inset-0 z-modal flex items-center justify-center bg-black/30 p-4"
      onClick={handleBackdropClick}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Deck diagnostics review"
        data-deck-diagnostics-review="true"
        onKeyDown={handleDialogKeyDown}
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-ds-lg border border-ds-border-subtle bg-ds-surface shadow-ds-overlay"
      >
        <header className="flex items-center justify-between gap-3 border-b border-ds-border-subtle px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-ds-text-primary">
              Diagnostics review
            </h2>
            <p className="text-xs text-ds-text-muted">
              {count === 0
                ? "No diagnostics found across this deck."
                : `${count} diagnostic${count === 1 ? "" : "s"} across deck, slide, node, source, asset, theme, and export groups.`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={cx(
              "rounded-ds-sm px-2 py-1 text-xs font-medium text-ds-text-secondary hover:bg-ds-state-hover",
              FOCUS_RING,
            )}
          >
            Close
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {groups.length === 0 ? (
            <p className="rounded-ds-md border border-ds-border-subtle bg-ds-surface-raised px-3 py-4 text-sm text-ds-text-secondary">
              This deck has no validation, render, asset, theme, source, or
              export diagnostics to review.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {groups.map((group) => (
                <section
                  key={group.key}
                  className="rounded-ds-md border border-ds-border-subtle bg-ds-surface-raised"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-ds-border-subtle px-3 py-2">
                    <div>
                      <h3 className="text-xs font-semibold text-ds-text-primary">
                        {group.label}
                      </h3>
                      <p className="text-[11px] uppercase tracking-[0.06em] text-ds-text-muted">
                        {group.scope} group · {group.diagnostics.length} item
                        {group.diagnostics.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    <span
                      className={cx(
                        "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase",
                        SEVERITY_STYLES[group.severity],
                      )}
                    >
                      {group.severity}
                    </span>
                  </div>
                  <ul
                    className="flex flex-col divide-y divide-ds-border-subtle"
                    role="list"
                  >
                    {group.diagnostics.map((diagnostic, index) => {
                      const action = diagnostic.action;
                      const actionDescriptor = action
                        ? diagnosticActionDescriptor(action)
                        : undefined;
                      return (
                        <li
                          key={`${diagnostic.code}-${diagnostic.path ?? ""}-${index}`}
                          className="flex flex-col gap-2 px-3 py-2 text-xs"
                        >
                          <div className="flex items-start gap-2">
                            <span
                              className={cx(
                                "mt-0.5 shrink-0 rounded px-1 py-0.5 text-[10px] font-bold uppercase",
                                SEVERITY_STYLES[diagnostic.severity],
                              )}
                            >
                              {diagnostic.severity}
                            </span>
                            <div className="min-w-0">
                              <p className="text-ds-text-primary">
                                {diagnostic.message}
                              </p>
                              <p className="mt-0.5 text-[11px] text-ds-text-muted">
                                {diagnostic.code} · {diagnostic.category} ·{" "}
                                {diagnosticTargetLabel(diagnostic.target)}
                                {diagnostic.path ? ` · ${diagnostic.path}` : ""}
                              </p>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2 pl-0 sm:pl-16">
                            {onNavigate && canNavigate(diagnostic) ? (
                              <button
                                type="button"
                                aria-label={diagnosticReviewActionAriaLabel(
                                  "Go to target",
                                  diagnostic,
                                )}
                                onClick={() => onNavigate(diagnostic)}
                                className={cx(
                                  "rounded-ds-sm border border-ds-border-subtle px-2 py-1 text-[11px] font-medium text-ds-text-secondary hover:bg-ds-state-hover",
                                  FOCUS_RING,
                                )}
                              >
                                Go to target
                              </button>
                            ) : null}
                            {onAction && action && actionDescriptor ? (
                              <button
                                type="button"
                                aria-label={diagnosticReviewActionAriaLabel(
                                  actionDescriptor.label,
                                  diagnostic,
                                )}
                                disabled={Boolean(
                                  actionDescriptor.disabledReason,
                                )}
                                title={actionDescriptor.disabledReason}
                                onClick={() => onAction(action, diagnostic)}
                                className={cx(
                                  "rounded-ds-sm px-2 py-1 text-[11px] font-medium text-ds-accent-text underline-offset-2 hover:underline disabled:opacity-40",
                                  FOCUS_RING,
                                )}
                              >
                                {actionDescriptor.label}
                              </button>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
