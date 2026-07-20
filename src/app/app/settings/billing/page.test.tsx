/**
 * Direct contract coverage for the Billing & Plan page composition (issue
 * #1956).
 *
 * `renderBillingView` is the pure billing-state -> markup decision extracted
 * from the async `BillingPage` default export, so the current-plan summary
 * (renewing vs. cancelling copy), the credit usage bar/copy (including the
 * unlimited-credits override), the plan-features checklist, and the
 * `BillingActions` wiring are unit-testable without exercising
 * `requireUser`/`loadAndSyncBillingState`, which require a live session and
 * database.
 *
 * Unlike `@/app/app/settings/page.tsx` and `@/app/app/brands/page.tsx`,
 * nothing in the billing page's import chain (`service.ts`,
 * `entitlement-facade.ts`, `config.ts`, `catalog.ts`) carries `import
 * "server-only"`, so `./page` is imported directly with no module-hook
 * stubbing.
 */
import assert from "node:assert/strict";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  getEntitlements,
  type Plan,
  type PlanEntitlements,
} from "@/lib/billing/catalog";
import type { BillingSubscriptionState } from "@/lib/billing/service";

import { BillingActions } from "./billing-actions";
import { renderBillingView, type BillingViewInput } from "./page";

type ElementLike = ReactElement<Record<string, unknown>>;

function collectElements(node: ReactNode, collected: ElementLike[] = []) {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, collected);
    return collected;
  }
  if (!isValidElement(node)) return collected;
  const element = node as ElementLike;
  collected.push(element);
  if (typeof element.type === "function") {
    return collected;
  }
  const props = element.props as { children?: ReactNode };
  collectElements(props.children, collected);
  return collected;
}

function firstElement(
  node: ReactNode,
  predicate: (element: ElementLike) => boolean,
): ElementLike {
  const element = collectElements(node).find(predicate);
  assert.ok(element, "expected a matching element");
  return element;
}

function buildSubscription(
  overrides: Partial<BillingSubscriptionState> = {},
): BillingSubscriptionState {
  return {
    plan: "pro",
    status: "active",
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_1",
    currentPeriodStart: new Date("2024-01-01T00:00:00.000Z"),
    currentPeriodEnd: new Date("2024-02-01T00:00:00.000Z"),
    cancelAtPeriodEnd: false,
    ...overrides,
  };
}

function buildInput(
  overrides: Partial<BillingViewInput> = {},
): BillingViewInput {
  const plan: Plan = overrides.plan ?? "free";
  return {
    plan,
    subscription: null,
    periodEnd: new Date("2024-02-01T00:00:00.000Z"),
    creditBalance: 300,
    entitlements: getEntitlements(plan),
    unlimitedCredits: false,
    ...overrides,
  };
}

describe("renderBillingView", () => {
  test("current plan: shows the plan name badge and copy for the given plan", () => {
    const tree = renderBillingView(buildInput({ plan: "pro" }));
    const html = renderToStaticMarkup(tree);
    assert.match(html, /You are on the/);
    assert.match(html, />Pro</);
  });

  test("subscription renewing: shows the renews-on copy with the formatted period end, not the cancellation warning", () => {
    const tree = renderBillingView(
      buildInput({
        plan: "pro",
        subscription: buildSubscription({ cancelAtPeriodEnd: false }),
      }),
    );
    const html = renderToStaticMarkup(tree);
    assert.match(html, /Renews on/);
    assert.doesNotMatch(html, /will be cancelled/);
  });

  test("subscription cancelling: shows the cancellation warning with the period end date, not the renews-on copy", () => {
    const tree = renderBillingView(
      buildInput({
        plan: "pro",
        subscription: buildSubscription({ cancelAtPeriodEnd: true }),
      }),
    );
    const html = renderToStaticMarkup(tree);
    assert.match(
      html,
      /Your subscription will be cancelled at the end of the current/,
    );
    assert.doesNotMatch(html, /Renews on/);
  });

  test("credits: shows the numeric balance, used count, and progress-bar width for a metered plan", () => {
    const entitlements = getEntitlements("plus");
    const tree = renderBillingView(
      buildInput({
        plan: "plus",
        entitlements,
        creditBalance: entitlements.creditsPerPeriod - 100,
        unlimitedCredits: false,
      }),
    );
    const html = renderToStaticMarkup(tree);
    assert.match(
      html,
      new RegExp(`${(entitlements.creditsPerPeriod - 100).toLocaleString()}`),
    );
    assert.match(html, /100 used/);
    assert.match(html, /width:1%/);
  });

  test("credits: caps progress-bar usage at 100% when balance is over-spent", () => {
    const entitlements = getEntitlements("free");
    const tree = renderBillingView(
      buildInput({
        plan: "free",
        entitlements,
        creditBalance: -50,
        unlimitedCredits: false,
      }),
    );
    const html = renderToStaticMarkup(tree);
    assert.match(html, /width:100%/);
  });

  test("unlimited credits: overrides the balance/usage copy and progress bar regardless of creditBalance", () => {
    const tree = renderBillingView(
      buildInput({ plan: "pro", creditBalance: 5, unlimitedCredits: true }),
    );
    const html = renderToStaticMarkup(tree);
    assert.match(html, />Unlimited</);
    assert.match(html, /No usage limits/);
    assert.match(html, /Unlimited AI generations/);
    assert.match(html, /width:100%/);
  });

  test("plan features: reflects each entitlement flag as enabled/disabled", () => {
    const entitlements: PlanEntitlements = {
      creditsPerPeriod: 1000,
      periodDays: 30,
      svgExport: true,
      pptxExport: false,
      brandStyles: true,
      removeWatermark: false,
      fontUpload: true,
    };
    const tree = renderBillingView(buildInput({ plan: "plus", entitlements }));
    const html = renderToStaticMarkup(tree);
    assert.match(html, /SVG export/);
    assert.match(html, /PPTX export/);
    assert.match(html, /Brand Styles/);
    assert.match(html, /Remove export watermark/);
    assert.match(html, /Custom font upload/);
    // Enabled rows use the success-text color; disabled rows the muted one.
    assert.match(
      html,
      /text-ds-success-text"[^>]*>✓<\/span><span class="text-ds-text-primary"[^>]*>SVG export/,
    );
    assert.match(
      html,
      /text-ds-text-secondary\/40"[^>]*>✗<\/span><span class="text-ds-text-muted"[^>]*>PPTX export/,
    );
  });

  test("wires BillingActions with the current plan and cancelAtPeriodEnd flag", () => {
    const tree = renderBillingView(
      buildInput({
        plan: "pro",
        subscription: buildSubscription({ cancelAtPeriodEnd: true }),
      }),
    );
    const actions = firstElement(
      tree,
      (element) => element.type === BillingActions,
    );
    assert.equal(actions.props.currentPlan, "pro");
    assert.equal(actions.props.cancelAtPeriodEnd, true);
  });

  test("wires BillingActions with cancelAtPeriodEnd defaulted to false when there's no subscription", () => {
    const tree = renderBillingView(buildInput({ subscription: null }));
    const actions = firstElement(
      tree,
      (element) => element.type === BillingActions,
    );
    assert.equal(actions.props.cancelAtPeriodEnd, false);
  });

  test("renders the back-to-settings link", () => {
    const tree = renderBillingView(buildInput());
    const html = renderToStaticMarkup(tree);
    assert.match(html, /href="\/app\/settings"/);
    assert.match(html, /Back to settings/);
  });
});
