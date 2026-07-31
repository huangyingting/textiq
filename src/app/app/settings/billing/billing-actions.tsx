"use client";

import { useState, useTransition } from "react";

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
  } catch {
    return {
      message: BILLING_ACTION_FAILURE_MESSAGE,
      isError: true,
    };
  }
}

interface BillingActionsProps {
  currentPlan: Plan;
  cancelAtPeriodEnd: boolean;
}

export function BillingActions({
  currentPlan,
  cancelAtPeriodEnd,
}: BillingActionsProps) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  function handleChange(targetPlan: string) {
    setMessage(null);
    setIsError(false);
    startTransition(async () => {
      const outcome = await resolveBillingActionOutcome(() =>
        changePlanAction(targetPlan),
      );
      if (outcome.redirectUrl) {
        window.location.href = outcome.redirectUrl;
        return;
      }
      setMessage(outcome.message);
      setIsError(outcome.isError);
    });
  }

  function handleCancel() {
    setMessage(null);
    setIsError(false);
    startTransition(async () => {
      const outcome = await resolveBillingActionOutcome(
        cancelSubscriptionAction,
      );
      setMessage(outcome.message);
      setIsError(outcome.isError);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Plan buttons */}
      <div className="grid grid-cols-3 gap-3">
        <PlanCard
          label="Free"
          price="Free"
          description={`${compactCreditPeriod(PLAN_CATALOG.free.entitlements.creditsPerPeriod, PLAN_CATALOG.free.entitlements.periodDays)} · PNG & PDF`}
          isCurrent={currentPlan === "free"}
          onSelect={() => handleChange("free")}
          disabled={isPending || currentPlan === "free"}
        />
        <PlanCard
          label="Plus"
          price="$12/mo"
          description={`${compactCreditPeriod(PLAN_CATALOG.plus.entitlements.creditsPerPeriod, PLAN_CATALOG.plus.entitlements.periodDays)} · SVG & PPTX · Brand Styles`}
          isCurrent={currentPlan === "plus"}
          onSelect={() => handleChange("plus")}
          disabled={isPending || currentPlan === "plus"}
        />
        <PlanCard
          label="Pro"
          price="$29/mo"
          description={`${compactCreditPeriod(PLAN_CATALOG.pro.entitlements.creditsPerPeriod, PLAN_CATALOG.pro.entitlements.periodDays)} · SVG & PPTX · Custom fonts`}
          isCurrent={currentPlan === "pro"}
          onSelect={() => handleChange("pro")}
          disabled={isPending || currentPlan === "pro"}
        />
      </div>

      {/* Cancel */}
      {currentPlan !== "free" && !cancelAtPeriodEnd && (
        <button
          type="button"
          onClick={handleCancel}
          disabled={isPending}
          className="w-fit text-sm text-ds-text-secondary underline-offset-4 transition hover:text-ds-danger hover:underline disabled:opacity-50"
        >
          Cancel subscription
        </button>
      )}

      {/* Feedback */}
      {message && (
        <p
          role={isError ? "alert" : "status"}
          className={`rounded-lg px-4 py-2 text-sm ${
            isError
              ? "bg-ds-danger-surface text-ds-danger-text"
              : "bg-ds-success-surface text-ds-success-text"
          }`}
        >
          {message}
        </p>
      )}

      {isPending && (
        <p role="status" className="text-sm text-ds-text-secondary">
          Updating…
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
