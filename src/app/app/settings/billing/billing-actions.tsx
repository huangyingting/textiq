"use client";

import { unstable_rethrow } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { ActionResult } from "@/lib/action-result";
import {
  BILLING_ACTION_FAILURE_MESSAGE,
  type BillingActionData,
} from "@/lib/billing/action-types";
import type { Plan } from "@/lib/billing/catalog";
import { PLAN_CATALOG } from "@/lib/billing/catalog";
import { changePlanAction, cancelSubscriptionAction } from "./actions";

/**
 * Compact credit-allowance + period label derived from catalog entitlements.
 * Examples: "500 credits/week", "10k credits/mo".
 * Uses explicit period checks so future catalog values (e.g. 14-day trials)
 * produce a distinct label rather than silently inheriting "mo".
 */
export function compactCreditPeriod(
  credits: number,
  periodDays: number,
): string {
  const creditStr =
    credits >= 1000 && credits % 1000 === 0
      ? `${credits / 1000}k`
      : String(credits);
  const period =
    periodDays === 7 ? "week" : periodDays === 30 ? "mo" : `${periodDays}d`;
  return `${creditStr} credits/${period}`;
}

export type BillingActionOutcome = {
  /** User-facing feedback message, or `null` when the action redirects instead of messaging. */
  message: string | null;
  isError: boolean;
  /** Present only for a successful plan change that hands off to an external checkout/portal URL. */
  redirectUrl?: string;
};

/**
 * Pure outcome-mapping decision for the billing action UI adapter
 * (issue #1928).
 *
 * Given the `ActionResult` returned by `changePlanAction`/
 * `cancelSubscriptionAction`, decides the feedback message, its error/success
 * styling, and whether the caller should redirect instead of rendering a
 * message. Extracted from the `useTransition` handlers so the result ->
 * outcome mapping is unit-testable without invoking the real server actions,
 * which require a live session and billing provider.
 */
export function mapBillingActionOutcome(
  result: ActionResult<BillingActionData>,
): BillingActionOutcome {
  if (!result.ok) {
    return { message: result.error, isError: true };
  }
  if (result.data.redirectUrl) {
    return {
      message: null,
      isError: false,
      redirectUrl: result.data.redirectUrl,
    };
  }
  return { message: result.data.message, isError: false };
}

export async function resolveBillingActionOutcome(
  action: () => Promise<ActionResult<BillingActionData>>,
): Promise<BillingActionOutcome> {
  try {
    return mapBillingActionOutcome(await action());
  } catch (error) {
    unstable_rethrow(error);
    return {
      message: BILLING_ACTION_FAILURE_MESSAGE,
      isError: true,
    };
  }
}

interface BillingActionsProps {
  currentPlan: Plan;
  cancelAtPeriodEnd: boolean;
  actionPort?: BillingActionPort;
}

export type BillingActionPort = {
  changePlan: (targetPlan: Plan) => Promise<ActionResult<BillingActionData>>;
  cancelSubscription: () => Promise<ActionResult<BillingActionData>>;
};

const routeBillingActionPort: BillingActionPort = {
  changePlan: changePlanAction,
  cancelSubscription: cancelSubscriptionAction,
};

type PendingBillingAction =
  { kind: "change"; targetPlan: Plan } | { kind: "cancel" };

export function BillingActions({
  currentPlan,
  cancelAtPeriodEnd,
  actionPort = routeBillingActionPort,
}: BillingActionsProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [pendingAction, setPendingAction] =
    useState<PendingBillingAction | null>(null);
  const mountedRef = useRef(true);
  const actionOperationIdRef = useRef(0);
  const actionInFlightRef = useRef(false);
  const mutationBusy = pendingAction !== null;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      actionOperationIdRef.current += 1;
      actionInFlightRef.current = false;
    };
  }, []);

  async function runAction(
    pending: PendingBillingAction,
    action: () => Promise<ActionResult<BillingActionData>>,
  ): Promise<void> {
    if (actionInFlightRef.current) return;

    actionInFlightRef.current = true;
    const operationId = ++actionOperationIdRef.current;
    setMessage(null);
    setIsError(false);
    setPendingAction(pending);
    let checkoutHandoffStarted = false;
    try {
      const outcome = await resolveBillingActionOutcome(action);
      if (!mountedRef.current || actionOperationIdRef.current !== operationId) {
        return;
      }
      if (outcome.redirectUrl) {
        window.location.href = outcome.redirectUrl;
        checkoutHandoffStarted = true;
        return;
      }
      setMessage(outcome.message);
      setIsError(outcome.isError);
    } finally {
      if (
        !checkoutHandoffStarted &&
        mountedRef.current &&
        actionOperationIdRef.current === operationId
      ) {
        actionInFlightRef.current = false;
        setPendingAction(null);
      }
    }
  }

  async function handleChange(targetPlan: Plan): Promise<void> {
    await runAction({ kind: "change", targetPlan }, () =>
      actionPort.changePlan(targetPlan),
    );
  }

  async function handleCancel(): Promise<void> {
    await runAction({ kind: "cancel" }, actionPort.cancelSubscription);
  }

  const pendingLabel =
    pendingAction?.kind === "change"
      ? `Changing to ${PLAN_CATALOG[pendingAction.targetPlan].displayName}…`
      : pendingAction?.kind === "cancel"
        ? "Cancelling subscription…"
        : "Updating…";

  return (
    <div aria-busy={mutationBusy} className="flex flex-col gap-4">
      {/* Plan buttons */}
      <div className="grid grid-cols-3 gap-3">
        <PlanCard
          label="Free"
          price="Free"
          description={`${compactCreditPeriod(PLAN_CATALOG.free.entitlements.creditsPerPeriod, PLAN_CATALOG.free.entitlements.periodDays)} · PNG & PDF`}
          isCurrent={currentPlan === "free"}
          onSelect={() => handleChange("free")}
          disabled={mutationBusy || currentPlan === "free"}
        />
        <PlanCard
          label="Plus"
          price="$12/mo"
          description={`${compactCreditPeriod(PLAN_CATALOG.plus.entitlements.creditsPerPeriod, PLAN_CATALOG.plus.entitlements.periodDays)} · SVG & PPTX · Brand Styles`}
          isCurrent={currentPlan === "plus"}
          onSelect={() => handleChange("plus")}
          disabled={mutationBusy || currentPlan === "plus"}
        />
        <PlanCard
          label="Pro"
          price="$29/mo"
          description={`${compactCreditPeriod(PLAN_CATALOG.pro.entitlements.creditsPerPeriod, PLAN_CATALOG.pro.entitlements.periodDays)} · SVG & PPTX · Custom fonts`}
          isCurrent={currentPlan === "pro"}
          onSelect={() => handleChange("pro")}
          disabled={mutationBusy || currentPlan === "pro"}
        />
      </div>

      {/* Cancel */}
      {currentPlan !== "free" && !cancelAtPeriodEnd && (
        <button
          type="button"
          onClick={handleCancel}
          disabled={mutationBusy}
          className="w-fit text-sm text-ds-text-secondary underline-offset-4 transition hover:text-ds-danger hover:underline disabled:opacity-50"
        >
          Cancel subscription
        </button>
      )}

      {/* Feedback */}
      {message && (
        <div
          role={isError ? "alert" : "status"}
          className={`flex items-center justify-between gap-3 rounded-lg px-4 py-2 text-sm ${
            isError
              ? "bg-ds-danger-surface text-ds-danger-text"
              : "bg-ds-success-surface text-ds-success-text"
          }`}
        >
          <span>{message}</span>
          <button
            type="button"
            aria-label="Dismiss billing message"
            onClick={() => setMessage(null)}
            className="shrink-0 text-xs font-medium underline-offset-4 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {mutationBusy && (
        <p role="status" className="text-sm text-ds-text-secondary">
          {pendingLabel}
        </p>
      )}
    </div>
  );
}

function PlanCard({
  label,
  price,
  description,
  isCurrent,
  onSelect,
  disabled,
}: {
  label: string;
  price: string;
  description: string;
  isCurrent: boolean;
  onSelect: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={`flex flex-col gap-1 rounded-xl border p-4 text-left transition ${
        isCurrent
          ? "border-ds-accent bg-ds-accent/5"
          : "border-ds-border-strong bg-ds-surface-base hover:border-ds-accent/50"
      } disabled:cursor-not-allowed disabled:opacity-60`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-ds-text-primary">
          {label}
        </span>
        {isCurrent && (
          <span className="text-xs font-medium text-ds-accent">Current</span>
        )}
      </div>
      <span className="text-base font-bold text-ds-text-primary">{price}</span>
      <span className="text-xs text-ds-text-secondary">{description}</span>
    </button>
  );
}
