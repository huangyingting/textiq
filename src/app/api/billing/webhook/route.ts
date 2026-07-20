/**
 * POST /api/billing/webhook — Stripe webhook endpoint (US-010 epic).
 *
 * Receives Stripe webhook events and updates subscription/credit data in the
 * database. Requires the following env vars when Stripe is enabled:
 *
 *   STRIPE_SECRET_KEY      — Stripe secret key
 *   STRIPE_WEBHOOK_SECRET  — Signing secret from the Stripe dashboard (whsec_…)
 *
 * This route is a no-op (returns 200) when STRIPE_SECRET_KEY is not set, so
 * the app builds and runs without Stripe credentials.
 *
 * Events handled (via handleStripeWebhookEvent in stripe-provider.ts):
 *   - checkout.session.completed
 *   - customer.subscription.updated
 *   - customer.subscription.deleted
 */

import { NextResponse, type NextRequest } from "next/server";

import { serverError, validationError } from "@/lib/api/errors";
import { stripe as stripeEnv } from "@/lib/env"; /*! node:coverage ignore next */
import { logError } from "@/lib/log";
export const runtime = "nodejs";
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!stripeEnv.isConfigured()) {
    // Stripe not configured — accept and ignore the request gracefully
    return NextResponse.json({ message: "ok" }, { status: 200 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return validationError("Missing stripe-signature header");
  }

  const rawBody = await request.text();

  try {
    const { handleStripeWebhookEvent } =
      await import("@/lib/billing/stripe-provider");
    const { status, message } = await handleStripeWebhookEvent(
      rawBody,
      signature,
    );
    return NextResponse.json({ message }, { status });
  } catch (err) {
    logError("billing.webhook.handler", err);
    return serverError("Webhook handler failed.");
  }
}
