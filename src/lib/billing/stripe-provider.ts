/* node:coverage disable */
/**
 * Stripe billing provider (US-010 epic) — ENV-GATED.
 *
 * This module is only loaded (via dynamic import in provider.ts) when the
 * STRIPE_SECRET_KEY environment variable is set. The app builds, tests, and
 * runs without it. Stripe's Node SDK (`stripe`) is an optional dependency —
 * install it separately (`npm install stripe`) before enabling this path.
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY         — Stripe secret key (sk_test_… or sk_live_…)
 *   STRIPE_PLUS_PRICE_ID      — Stripe Price id for the Plus plan
 *   STRIPE_PRO_PRICE_ID       — Stripe Price id for the Pro plan
 *   STRIPE_WEBHOOK_SECRET     — Signing secret for webhook verification
 *   NEXT_PUBLIC_APP_URL       — Base URL for redirect after checkout
 *
 * Webhook route: POST /api/billing/webhook
 * Events handled: checkout.session.completed, customer.subscription.updated,
 *                 customer.subscription.deleted
 *
 * NOTE: The webhook handler lives in src/app/api/billing/webhook/route.ts
 * and shares the same event-handling logic via `handleStripeWebhookEvent`.
 */

import { prisma } from "@/lib/prisma";
import { getEntitlements, isPlan, type Plan } from "@/lib/billing/catalog";
import type { BillingProvider, ChangePlanResult } from "@/lib/billing/provider";
import {
  applyLocalPlanChange,
  getBillingSubscription,
  markSubscriptionCancelAtPeriodEnd,
  recordStripeCustomer,
  writeCheckoutSessionCompletedPlanChange,
  writeLocalSubscriptionDeleted,
  writeLocalSubscriptionUpdate,
} from "@/lib/billing/service";
import { stripe as stripeEnv, app as appEnv } from "@/lib/env";
import { logSecurityAudit } from "@/lib/security-audit";
/* node:coverage enable */

type PrismaClientLike = typeof prisma;
type StripeWebhookWriteClient = Pick<
  PrismaClientLike,
  "$transaction" | "stripeWebhookEvent" | "subscription" | "user"
>;
/* node:coverage disable */
type StripeClientLike = {
  customers: { create(args: unknown): Promise<{ id?: string | null }> };
  checkout: {
    sessions: { create(args: unknown): Promise<{ url?: string | null }> };
  };
  subscriptions: {
    cancel(id: string): Promise<unknown>;
    retrieve?(id: string): Promise<StripeSubscriptionLike>;
    update(id: string, args: unknown): Promise<unknown>;
  };
  webhooks: {
    constructEvent(
      rawBody: string,
      signature: string,
      secret: string,
    ): {
      id: string;
      created?: number;
      type: string;
      data: { object: Record<string, unknown> };
    };
  };
};
/* node:coverage enable */

let stripeLoaderForTesting: (() => Promise<StripeClientLike>) | null = null;

/* node:coverage disable */
class DuplicateStripeWebhookEventError extends Error {
  constructor() {
    super("Duplicate Stripe webhook event");
    this.name = "DuplicateStripeWebhookEventError";
  }
}

class MissingStripeSubscriptionWebhookEventError extends Error {
  constructor(readonly stripeSubscriptionId: string) {
    super("Stripe subscription row is not ready for this webhook event");
    this.name = "MissingStripeSubscriptionWebhookEventError";
  }
}
/* node:coverage enable */

function getStripeKey(): string {
  return stripeEnv.secretKey();
}

function getPriceId(plan: Plan): string {
  if (plan === "plus") {
    return stripeEnv.plusPriceId();
  }
  if (plan === "pro") {
    return stripeEnv.proPriceId();
  }
  throw new Error(`No Stripe price for plan: ${plan}`);
}

function isLivePaidStripeSubscription(
  sub: Awaited<ReturnType<typeof getBillingSubscription>>,
): sub is NonNullable<Awaited<ReturnType<typeof getBillingSubscription>>> & {
  stripeSubscriptionId: string;
} {
  if (!sub?.stripeSubscriptionId) return false;
  if (!isPlan(sub.plan) || sub.plan === "free") return false;
  return (
    sub.status === "active" ||
    sub.status === "trialing" ||
    sub.status === "past_due"
  );
}

async function updateExistingStripeSubscriptionPlan(
  stripe: StripeClientLike,
  stripeSubscriptionId: string,
  targetPlan: Plan,
): Promise<void> {
  const retrieveSubscription = stripe.subscriptions.retrieve;
  if (!retrieveSubscription) {
    throw new Error("Stripe subscription retrieval is not available.");
  }

  const stripeSubscription = await retrieveSubscription(stripeSubscriptionId);
  const itemId = stripeSubscription.items?.data?.[0]?.id;
  if (!itemId) {
    throw new Error("Stripe subscription did not include an item to update.");
  }

  await stripe.subscriptions.update(stripeSubscriptionId, {
    items: [{ id: itemId, price: getPriceId(targetPlan), quantity: 1 }],
    proration_behavior: "create_prorations",
    cancel_at_period_end: false,
  });
}

// Dynamic Stripe import (SDK is optional — ignore at bundle time, load at runtime)
type StripeConstructor = new (
  apiKey: string,
  options: { apiVersion: string },
) => StripeClientLike;

async function loadStripe(): Promise<StripeClientLike> {
  if (stripeLoaderForTesting) {
    return stripeLoaderForTesting();
  }
  try {
    // webpackIgnore prevents Turbopack/webpack from statically resolving this
    // module at build time so the app builds without the `stripe` package.
    const mod = await import(
      /* webpackIgnore: true */
      "stripe" as string
    );
    const StripeClass = (mod as { default?: unknown }).default ?? mod;
    return new (StripeClass as StripeConstructor)(getStripeKey(), {
      apiVersion: "2024-06-20",
    });
  } catch {
    throw new Error(
      "The `stripe` package is not installed. Run `npm install stripe` to enable Stripe billing.",
    );
  }
}

/**
 * Overrides the optional Stripe SDK loader in unit tests.
 * Pass `null` to restore the production dynamic import path.
 */
export function setStripeLoaderForTesting(
  loader: (() => Promise<StripeClientLike>) | null,
): void {
  stripeLoaderForTesting = loader;
}

export class StripeBillingProvider implements BillingProvider {
  async changePlan(
    userId: string,
    targetPlan: Plan,
  ): Promise<ChangePlanResult> {
    if (!isPlan(targetPlan)) {
      return {
        success: false,
        plan: "free",
        message: `Unknown plan: ${targetPlan}.`,
      };
    }

    if (targetPlan === "free") {
      // Downgrade — cancel active Stripe subscription and set free plan locally
      return this.cancelSubscription(userId);
    }

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true },
    });

    const appUrl = appEnv.url("http://localhost:3000");
    const stripe = await loadStripe();

    // Look up or create a Stripe customer (reuse the stored customer id; it can
    // outlive any single subscription).
    const sub = await getBillingSubscription(userId);
    if (isLivePaidStripeSubscription(sub)) {
      await updateExistingStripeSubscriptionPlan(
        stripe,
        sub.stripeSubscriptionId,
        targetPlan,
      );
      return {
        success: true,
        plan: targetPlan,
        message: `Plan change to ${targetPlan} submitted. Your billing page will update shortly.`,
      };
    }

    let customerId: string | undefined = sub?.stripeCustomerId ?? undefined;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId },
      });
      const createdCustomerId = customer.id;
      if (!createdCustomerId) {
        throw new Error("Stripe customer creation did not return an id.");
      }
      customerId = createdCustomerId;

      await recordStripeCustomer(userId, customerId, {
        fallbackPlan: isPlan(sub?.plan) ? sub.plan : "free",
        periodPlan: targetPlan,
        fallbackStatus: sub?.status ?? "inactive",
      });
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: getPriceId(targetPlan), quantity: 1 }],
      success_url: `${appUrl}/app/settings/billing?success=1`,
      cancel_url: `${appUrl}/app/settings/billing?cancelled=1`,
      metadata: { userId, plan: targetPlan },
    });
    if (!session.url) {
      throw new Error("Stripe checkout did not return a redirect URL.");
    }

    return {
      success: true,
      plan: targetPlan,
      message: "Redirecting to Stripe checkout…",
      redirectUrl: session.url,
    };
  }

  async cancelSubscriptionImmediately(userId: string): Promise<void> {
    const sub = await getBillingSubscription(userId);
    if (!sub?.stripeSubscriptionId) return;

    const stripe = await loadStripe();
    await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
  }

  async cancelSubscription(userId: string): Promise<ChangePlanResult> {
    const sub = await getBillingSubscription(userId);
    if (!sub?.stripeSubscriptionId) {
      // No Stripe subscription on record — downgrade locally
      await applyLocalPlanChange(userId, "free", {
        updateSubscriptionPeriodOnExisting: false,
      });
      return {
        success: true,
        plan: "free",
        message: "Subscription cancelled.",
      };
    }

    const stripe = await loadStripe();
    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    await markSubscriptionCancelAtPeriodEnd(userId);

    return {
      success: true,
      plan: sub.plan as Plan,
      message:
        "Subscription will be cancelled at the end of the current period.",
    };
  }
}

// ---------------------------------------------------------------------------
// Webhook event handler (shared with /api/billing/webhook)
// ---------------------------------------------------------------------------

/* node:coverage disable */
/** Minimal shape of the Stripe Subscription object fields we consume. */
export interface StripeSubscriptionLike {
  id?: string;
  status?: string;
  cancel_at_period_end?: boolean;
  /** Unix seconds. */
  current_period_start?: number;
  /** Unix seconds. */
  current_period_end?: number;
  items?: { data?: Array<{ id?: string | null; price?: { id?: string } }> };
}

/** The subset of subscription state a webhook event resolves to. */
export interface ReducedSubscriptionState {
  status: string;
  cancelAtPeriodEnd: boolean;
  plan?: Plan;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
}
/* node:coverage enable */

/**
 * Maps a Stripe subscription `status` to our internal status vocabulary
 * (`active` | `past_due` | `cancelled` | `inactive`). Pure.
 */
export function mapStripeSubscriptionStatus(
  status: string | undefined,
): string {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "cancelled";
    default:
      return "inactive";
  }
}

/**
 * Resolves a Stripe Price id to one of our plans using the configured price-id
 * env vars. Returns `null` when the price is unknown. Pure.
 */
export function planFromPriceId(
  priceId: string | undefined | null,
  env: Record<string, string | undefined> = process.env,
): Plan | null {
  if (!priceId) return null;
  if (priceId === env.STRIPE_PLUS_PRICE_ID) return "plus";
  if (priceId === env.STRIPE_PRO_PRICE_ID) return "pro";
  return null;
}

/**
 * Pure reducer: maps a Stripe subscription event to the subscription state we
 * persist. Handles update / delete / cancel reliably:
 *
 * - `customer.subscription.deleted` → cancelled + free plan.
 * - `customer.subscription.updated` (and created) → mapped status, period
 *   window, cancellation intent, and (when resolvable) the plan from the line
 *   item price id.
 *
 * No DB or network access — unit-tested directly.
 */
/* node:coverage ignore next 8 */
export function reduceStripeSubscriptionEvent(
  eventType: string,
  sub: StripeSubscriptionLike,
  env: Record<string, string | undefined> = process.env,
): ReducedSubscriptionState {
  if (eventType === "customer.subscription.deleted") {
    return { status: "cancelled", cancelAtPeriodEnd: false, plan: "free" };
  }

  const state: ReducedSubscriptionState = {
    status: mapStripeSubscriptionStatus(sub.status),
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
  };

  if (typeof sub.current_period_start === "number") {
    state.currentPeriodStart = new Date(sub.current_period_start * 1000);
  }
  if (typeof sub.current_period_end === "number") {
    state.currentPeriodEnd = new Date(sub.current_period_end * 1000);
  }

  const plan = planFromPriceId(sub.items?.data?.[0]?.price?.id, env);
  if (plan) state.plan = plan;

  return state;
}

export async function handleStripeWebhookEvent(
  rawBody: string,
  signature: string,
): Promise<{ status: number; message: string }> {
  const webhookSecret = stripeEnv.webhookSecret();
  if (!webhookSecret) {
    return { status: 500, message: "STRIPE_WEBHOOK_SECRET not configured" };
  }

  const stripe = await loadStripe();

  let event: {
    id: string;
    created?: number;
    type: string;
    data: { object: Record<string, unknown> };
  };
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch {
    return { status: 400, message: "Webhook signature verification failed" };
  }

  let outcome: StripeWebhookProcessingOutcome = "success";
  try {
    outcome = await applyStripeWebhookEvent(prisma, event);
  } catch (err) {
    if (err instanceof DuplicateStripeWebhookEventError) {
      logSecurityAudit("billing.webhook.processed", {
        stripeEventId: event.id,
        eventType: event.type,
        outcome: "duplicate",
        idempotent: true,
      });
      return { status: 200, message: "duplicate event ignored" };
    }
    if (err instanceof MissingStripeSubscriptionWebhookEventError) {
      logSecurityAudit("billing.webhook.processed", {
        stripeEventId: event.id,
        eventType: event.type,
        outcome: "missing",
        subscriptionId: err.stripeSubscriptionId,
      });
      return {
        status: 500,
        message: "subscription state missing; retry later",
      };
    }
    throw err;
  }

  logSecurityAudit("billing.webhook.processed", {
    stripeEventId: event.id,
    eventType: event.type,
    outcome,
  });

  if (outcome === "stale") {
    return { status: 200, message: "stale subscription update ignored" };
  }

  return { status: 200, message: "ok" };
}

export type StripeWebhookEventLike = {
  id: string;
  created?: number;
  type: string;
  data: { object: Record<string, unknown> };
};

export type StripeWebhookProcessingOutcome =
  "success" | "duplicate" | "stale" | "missing" | "ignored";

export async function applyStripeWebhookEvent(
  client: StripeWebhookWriteClient,
  event: StripeWebhookEventLike,
): Promise<Exclude<StripeWebhookProcessingOutcome, "duplicate">> {
  return client.$transaction(async (tx) => {
    try {
      await tx.stripeWebhookEvent.create({
        data: { id: event.id, type: event.type },
      });
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        throw new DuplicateStripeWebhookEventError();
      }
      throw error;
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const userId = (session.metadata as Record<string, string>)?.userId;
        const plan = (session.metadata as Record<string, string>)?.plan;
        if (userId && isPlan(plan)) {
          const now = new Date();
          const eventCreatedAt =
            typeof event.created === "number"
              ? new Date(event.created * 1000)
              : undefined;
          const stripeSubscriptionId =
            typeof session.subscription === "string"
              ? session.subscription
              : undefined;
          const stripeCustomerId =
            typeof session.customer === "string" ? session.customer : undefined;

          const applied = await writeCheckoutSessionCompletedPlanChange(
            tx,
            userId,
            plan,
            {
              status: "active",
              stripeCustomerId,
              stripeSubscriptionId,
              currentPeriodStart: now,
              currentPeriodEnd: new Date(
                now.getTime() +
                  getEntitlements(plan).periodDays * 24 * 60 * 60 * 1000,
              ),
              cancelAtPeriodEnd: false,
              eventCreatedAt,
            },
          );
          if (applied === "stale") {
            return "stale";
          }
        }
        return "success";
      }

      case "customer.subscription.updated": {
        const stripeSub = event.data.object as StripeSubscriptionLike;
        const stripeSubscriptionId = stripeSub.id;
        if (!stripeSubscriptionId) return "ignored";
        const next = reduceStripeSubscriptionEvent(event.type, stripeSub);
        const applied = await writeLocalSubscriptionUpdate(
          tx,
          stripeSubscriptionId,
          next,
        );
        if (applied === "missing") {
          throw new MissingStripeSubscriptionWebhookEventError(
            stripeSubscriptionId,
          );
        }
        return applied === "applied" ? "success" : applied;
      }

      case "customer.subscription.deleted": {
        const stripeSub = event.data.object as StripeSubscriptionLike;
        const stripeSubscriptionId = stripeSub.id;
        if (!stripeSubscriptionId) return "ignored";
        const next = reduceStripeSubscriptionEvent(event.type, stripeSub);
        const applied = await writeLocalSubscriptionDeleted(
          tx,
          stripeSubscriptionId,
          next,
        );
        return applied === "applied" ? "success" : applied;
      }

      default:
        return "ignored";
    }
  });
}

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "P2002"
  );
}
