"use client";

import { unstable_rethrow } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui";
import type { OnboardingStep } from "@/lib/onboarding/checklist";
import { emitProductTelemetry } from "@/lib/telemetry/product";

import { dismissOnboarding } from "./actions";

interface OnboardingChecklistProps {
  steps: OnboardingStep[];
}

/**
 * First-run onboarding checklist panel.
 *
 * Renders a dismissible card listing the core steps for getting value out of
 * TextIQ. The dismiss action persists server-side (User.onboardingDismissed)
 * so the checklist does not reappear on a new device or browser. Completing
 * all tracked steps does not auto-dismiss it.
 */
export function OnboardingChecklist({ steps }: OnboardingChecklistProps) {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);
  const mountedRef = useRef(true);
  const dismissOperationIdRef = useRef(0);
  const dismissInFlightRef = useRef(false);
  const doneCount = steps.filter((s) => s.done).length;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      dismissOperationIdRef.current += 1;
      dismissInFlightRef.current = false;
    };
  }, []);

  useEffect(() => {
    emitProductTelemetry("product.onboarding.activation", {
      activationKind:
        doneCount === steps.length ? "all_steps_complete" : "viewed",
      completedStepCount: doneCount,
      stepCount: steps.length,
    });
  }, [doneCount, steps.length]);

  async function handleDismiss(): Promise<void> {
    if (dismissInFlightRef.current) return;

    dismissInFlightRef.current = true;
    const operationId = ++dismissOperationIdRef.current;
    setError(null);
    setIsPending(true);
    try {
      await dismissOnboarding();
      if (
        !mountedRef.current ||
        dismissOperationIdRef.current !== operationId
      ) {
        return;
      }
      emitProductTelemetry("product.onboarding.dismissed", {
        completedStepCount: doneCount,
        stepCount: steps.length,
      });
      setIsDismissed(true);
    } catch (dismissError) {
      unstable_rethrow(dismissError);
      if (
        !mountedRef.current ||
        dismissOperationIdRef.current !== operationId
      ) {
        return;
      }
      setError("Could not dismiss the checklist. Please try again.");
    } finally {
      if (mountedRef.current && dismissOperationIdRef.current === operationId) {
        dismissInFlightRef.current = false;
        setIsPending(false);
      }
    }
  }

  if (isDismissed) return null;

  return (
    <section
      aria-label="Getting started checklist"
      aria-busy={isPending}
      className="rounded-2xl border border-ds-border-subtle bg-ds-surface-raised p-5 shadow-sm"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-base font-semibold text-ds-text-primary">
            Get started with TextIQ
          </h2>
          <p className="text-sm text-ds-text-secondary">
            {doneCount} of {steps.length} steps complete
          </p>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          disabled={isPending}
          aria-label="Dismiss onboarding checklist"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ds-text-muted transition hover:bg-ds-state-hover hover:text-ds-text-primary disabled:opacity-50"
        >
          {/* × close icon */}
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <line x1="2" y1="2" x2="12" y2="12" />
            <line x1="12" y1="2" x2="2" y2="12" />
          </svg>
        </button>
      </div>

      {/* Progress bar */}
      <div
        role="progressbar"
        aria-valuenow={doneCount}
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-label={`${doneCount} of ${steps.length} onboarding steps complete`}
        className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-ds-border-subtle"
      >
        <div
          className="h-full rounded-full bg-ds-accent transition-all"
          style={{ width: `${(doneCount / steps.length) * 100}%` }}
        />
      </div>

      <ol className="mt-4 flex flex-col gap-3" aria-label="Onboarding steps">
        {steps.map((step, index) => (
          <li key={step.id} className="flex items-start gap-3">
            {/* Step indicator */}
            <span
              aria-hidden="true"
              className={[
                "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                step.done
                  ? "bg-ds-accent text-ds-text-on-accent"
                  : "border border-ds-border-strong text-ds-text-muted",
              ].join(" ")}
            >
              {step.done ? (
                <svg
                  aria-hidden="true"
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="1.5,5 4,7.5 8.5,2.5" />
                </svg>
              ) : (
                index + 1
              )}
            </span>
            <div className="flex flex-col gap-0.5">
              <span
                className={[
                  "text-sm font-medium",
                  step.done
                    ? "text-ds-text-secondary line-through"
                    : "text-ds-text-primary",
                ].join(" ")}
              >
                {step.label}
              </span>
              <span className="text-xs text-ds-text-muted">
                {step.description}
              </span>
            </div>
          </li>
        ))}
      </ol>

      {error ? (
        <div
          role="alert"
          className="mt-4 rounded-ds-md border border-ds-danger-border bg-ds-danger-surface p-3 text-sm text-ds-danger-text"
        >
          <p>{error}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="subtle"
              size="sm"
              disabled={isPending}
              onClick={handleDismiss}
            >
              Try dismiss again
            </Button>
            <Button
              variant="plain"
              size="sm"
              disabled={isPending}
              onClick={() => setError(null)}
            >
              Dismiss error
            </Button>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={handleDismiss}
        disabled={isPending}
        className="mt-5 text-xs text-ds-text-muted underline-offset-2 transition hover:text-ds-text-secondary hover:underline disabled:opacity-50"
      >
        {isPending ? "Dismissing…" : "Mark as complete and dismiss"}
      </button>
    </section>
  );
}
