import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { requireUser } from "@/lib/session";
import {
  PLAN_NAMES,
  type Plan,
  type PlanEntitlements,
} from "@/lib/billing/catalog";
import { isUnlimitedCreditsEnabled } from "@/lib/billing/config";
import { createEntitlementFacade } from "@/lib/billing/entitlement-facade";
import {
  loadAndSyncBillingState,
  type BillingSubscriptionState,
} from "@/lib/billing/service";

import { BillingActions } from "./billing-actions";

export const metadata: Metadata = {
  title: "Billing & Plan — TextIQ",
};

export type BillingViewInput = {
  plan: Plan;
  subscription: BillingSubscriptionState | null;
  periodEnd: Date;
  creditBalance: number;
  entitlements: PlanEntitlements;
  unlimitedCredits: boolean;
};

/**
 * Pure billing-state -> markup composition for {@link BillingPage} (issue
 * #1956).
 *
 * Given the already-loaded plan/subscription/credit-balance/entitlement
 * values, decides the current-plan summary (including the
 * renewing-vs-cancelling copy), the credit usage bar/copy (including the
 * unlimited-credits override), the plan-features checklist, and the
 * `BillingActions` wiring. Extracted from the async default export so this
 * composition is unit-testable without exercising `requireUser`/
 * `loadAndSyncBillingState`, which require a live session and database.
 */
export function renderBillingView(input: BillingViewInput): ReactNode {
  const { plan, subscription, creditBalance, entitlements, unlimitedCredits } =
    input;
  const periodEnd = subscription?.currentPeriodEnd ?? input.periodEnd;

  const creditsUsed = Math.max(
    0,
    entitlements.creditsPerPeriod - creditBalance,
  );

  const usagePct =
    entitlements.creditsPerPeriod > 0
      ? Math.min(
          100,
          Math.round((creditsUsed / entitlements.creditsPerPeriod) * 100),
        )
      : 0;

  return (
    <main className="flex flex-1 flex-col items-center bg-ds-surface-sunken px-6 py-12">
      <div className="flex w-full max-w-2xl flex-col gap-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-ds-text-primary">
            Billing &amp; Plan
          </h1>
          <p className="text-sm text-ds-text-secondary">
            Manage your subscription and AI credits.
          </p>
        </header>

        {/* Current plan */}
        <section className="flex flex-col gap-4 rounded-2xl border border-ds-border-strong bg-ds-surface-base p-6">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-semibold text-ds-text-primary">
                Current Plan
              </h2>
              <p className="text-sm text-ds-text-secondary">
                You are on the{" "}
                <span className="font-medium text-ds-text-primary">
                  {PLAN_NAMES[plan]}
                </span>{" "}
                plan.
              </p>
            </div>
            <span className="rounded-full bg-ds-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-ds-accent">
              {PLAN_NAMES[plan]}
            </span>
          </div>

          {/* Subscription status */}
          {subscription?.cancelAtPeriodEnd && (
            <p className="rounded-lg bg-ds-warning-surface px-4 py-2 text-sm text-ds-warning-text">
              Your subscription will be cancelled at the end of the current
              billing period
              {periodEnd ? ` (${periodEnd.toLocaleDateString()}).` : "."}
            </p>
          )}

          {periodEnd && !subscription?.cancelAtPeriodEnd && (
            <p className="text-sm text-ds-text-secondary">
              Renews on{" "}
              <span className="font-medium">
                {periodEnd.toLocaleDateString()}
              </span>
            </p>
          )}
        </section>

        {/* Credit usage */}
        <section className="flex flex-col gap-4 rounded-2xl border border-ds-border-strong bg-ds-surface-base p-6">
          <h2 className="text-base font-semibold text-ds-text-primary">
            AI Credits
          </h2>

          <div className="flex items-end justify-between gap-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-3xl font-bold tabular-nums text-ds-text-primary">
                {unlimitedCredits
                  ? "Unlimited"
                  : creditBalance.toLocaleString()}
              </span>
              <span className="text-sm text-ds-text-secondary">
                {unlimitedCredits
                  ? "AI credits"
                  : `of ${entitlements.creditsPerPeriod.toLocaleString()} remaining`}
              </span>
            </div>
            <div className="text-right text-sm text-ds-text-secondary">
              {unlimitedCredits ? (
                "No usage limits"
              ) : (
                <>
                  {creditsUsed.toLocaleString()} used
                  {periodEnd && (
                    <>
                      {" · resets "}
                      <span className="font-medium text-ds-text-primary">
                        {periodEnd.toLocaleDateString()}
                      </span>
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Progress bar */}
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-ds-border-strong"
            {...(unlimitedCredits
              ? { "aria-hidden": true }
              : {
                  role: "progressbar",
                  "aria-label": "AI credit usage",
                  "aria-valuemin": 0,
                  "aria-valuemax": 100,
                  "aria-valuenow": usagePct,
                  "aria-valuetext": `${usagePct}% used`,
                })}
          >
            <div
              className="h-full rounded-full bg-ds-accent transition-all"
              style={{ width: `${unlimitedCredits ? 100 : usagePct}%` }}
            />
          </div>

          <p className="text-xs text-ds-text-secondary">
            {unlimitedCredits
              ? "Unlimited AI generations — no per-word metering."
              : `~1 credit per word selected for generation · ${
                  entitlements.periodDays === 7
                    ? "resets weekly"
                    : "resets monthly"
                }`}
          </p>
        </section>

        {/* Plan features */}
        <section className="flex flex-col gap-4 rounded-2xl border border-ds-border-strong bg-ds-surface-base p-6">
          <h2 className="text-base font-semibold text-ds-text-primary">
            Your Plan Includes
          </h2>
          <ul className="flex flex-col gap-2 text-sm">
            <FeatureRow
              enabled={true}
              label={
                unlimitedCredits
                  ? "Unlimited AI credits"
                  : `${entitlements.creditsPerPeriod.toLocaleString()} AI credits / ${entitlements.periodDays === 7 ? "week" : "month"}`
              }
            />
            <FeatureRow enabled={true} label="PNG & PDF export" />
            <FeatureRow enabled={entitlements.svgExport} label="SVG export" />
            <FeatureRow enabled={entitlements.pptxExport} label="PPTX export" />
            <FeatureRow
              enabled={entitlements.brandStyles}
              label="Brand Styles"
            />
            <FeatureRow
              enabled={entitlements.removeWatermark}
              label="Remove export watermark"
            />
            <FeatureRow
              enabled={entitlements.fontUpload}
              label="Custom font upload"
            />
          </ul>
        </section>

        {/* Plan management actions */}
        <section className="flex flex-col gap-4 rounded-2xl border border-ds-border-strong bg-ds-surface-base p-6">
          <h2 className="text-base font-semibold text-ds-text-primary">
            Change Plan
          </h2>
          <BillingActions
            currentPlan={plan}
            cancelAtPeriodEnd={subscription?.cancelAtPeriodEnd ?? false}
          />
        </section>

        <Link
          href="/app/settings"
          className="text-sm font-medium text-ds-text-secondary underline-offset-4 transition hover:text-ds-text-primary hover:underline"
        >
          ← Back to settings
        </Link>
      </div>
    </main>
  );
}

export default async function BillingPage() {
  const sessionUser = await requireUser(redirect);

  const billingState = await loadAndSyncBillingState(sessionUser.id);

  const entitlements = createEntitlementFacade(billingState.plan).entitlements;

  return renderBillingView({
    plan: billingState.plan,
    subscription: billingState.subscription,
    periodEnd: billingState.periodEnd,
    creditBalance: billingState.creditBalance,
    entitlements,
    unlimitedCredits: isUnlimitedCreditsEnabled(),
  });
}

function FeatureRow({
  enabled,
  label,
}: {
  enabled: boolean;
  label: ReactNode;
}) {
  return (
    <li className="flex items-center gap-2">
      <span
        className={`text-base ${enabled ? "text-ds-success-text" : "text-ds-text-secondary/40"}`}
        aria-hidden="true"
      >
        {enabled ? "✓" : "✗"}
      </span>
      <span className={enabled ? "text-ds-text-primary" : "text-ds-text-muted"}>
        {label}
      </span>
    </li>
  );
}
