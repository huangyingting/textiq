"use client";

import { useState, useTransition } from "react";

import type { Plan } from "@/lib/billing/catalog";
import { PLAN_CATALOG } from "@/lib/billing/catalog";
import { changePlanAction, cancelSubscriptionAction } from "./actions";

/**
 * Compact credit-allowance + period label derived from catalog entitlements.
 * Examples: "500 credits/week", "10k credits/mo".
 * Uses explicit period checks so future catalog values (e.g. 14-day trials)
 * produce a distinct label rather than silently inheriting "mo".
 */
function compactCreditPeriod(credits: number, periodDays: number): string {
  const creditStr =
    credits >= 1000 && credits % 1000 === 0
      ? `${credits / 1000}k`
      : String(credits);
  const period =
    periodDays === 7 ? "week" : periodDays === 30 ? "mo" : `${periodDays}d`;
  return `${creditStr} credits/${period}`;
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
      const result = await changePlanAction(targetPlan);
      if (!result.ok) {
        setMessage(result.error);
        setIsError(true);
        return;
      }
      if (result.data.redirectUrl) {
        window.location.href = result.data.redirectUrl;
        return;
      }
      setMessage(result.data.message);
      setIsError(false);
    });
  }

  function handleCancel() {
    setMessage(null);
    setIsError(false);
    startTransition(async () => {
      const result = await cancelSubscriptionAction();
      if (!result.ok) {
        setMessage(result.error);
        setIsError(true);
        return;
      }
      setMessage(result.data.message);
      setIsError(false);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Plan buttons */}
      <div className="grid grid-cols-3 gap-3">
        <PlanCard
          label="Free"
          price="Free"
          description={`${compactCreditPeriod(PLAN_CATALOG.free.entitlements.creditsPerPeriod, PLAN_CATALOG.free.entitlements.periodDays)} · PNG &amp; PDF`}
          isCurrent={currentPlan === "free"}
          onSelect={() => handleChange("free")}
          disabled={isPending || currentPlan === "free"}
        />
        <PlanCard
          label="Plus"
          price="$12/mo"
          description={`${compactCreditPeriod(PLAN_CATALOG.plus.entitlements.creditsPerPeriod, PLAN_CATALOG.plus.entitlements.periodDays)} · SVG &amp; PPTX · Brand Styles`}
          isCurrent={currentPlan === "plus"}
          onSelect={() => handleChange("plus")}
          disabled={isPending || currentPlan === "plus"}
        />
        <PlanCard
          label="Pro"
          price="$29/mo"
          description={`${compactCreditPeriod(PLAN_CATALOG.pro.entitlements.creditsPerPeriod, PLAN_CATALOG.pro.entitlements.periodDays)} · SVG &amp; PPTX · Custom fonts`}
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
          className={`rounded-lg px-4 py-2 text-sm ${
            isError
              ? "bg-ds-danger-surface text-ds-danger-text"
              : "bg-ds-success-surface text-ds-success-text"
          }`}
        >
          {message}
        </p>
      )}

      {isPending && <p className="text-sm text-ds-text-secondary">Updating…</p>}
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
      <span
        className="text-xs text-ds-text-secondary"
        dangerouslySetInnerHTML={{ __html: description }}
      />
    </button>
  );
}
