/**
 * Direct contract coverage for the billing action UI adapter, `BillingActions`
 * (issue #1928).
 *
 * `compactCreditPeriod` and `mapBillingActionOutcome` are the pure decisions
 * extracted from the component: the former derives the compact plan-card
 * credit label, and the latter maps a `changePlanAction`/
 * `cancelSubscriptionAction` `ActionResult` to the feedback message/error
 * styling/redirect the `useTransition` handlers apply. Both are unit-tested
 * directly, independent of the real server actions (which require a live
 * session and billing provider). The component itself is exercised through
 * `renderToStaticMarkup` for its prop-driven pending/disabled/conditional
 * composition — `useTransition`/`useState` render fine there since it is a
 * genuine React render pass, not a bare function call.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, create } from "react-test-renderer";

import {
  BillingActions,
  compactCreditPeriod,
  mapBillingActionOutcome,
} from "./billing-actions";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const [message] = args;
  if (
    typeof message === "string" &&
    message.startsWith("react-test-renderer is deprecated")
  ) {
    return;
  }
  originalConsoleError(...args);
};

/** Concatenates the string leaves of a React node tree (ignores elements). */
function textContentOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") {
    return "";
  }
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(textContentOf).join("");
  }
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return textContentOf(props.children);
  }
  return "";
}

describe("compactCreditPeriod", () => {
  test("formats a round-thousand weekly allowance as a 'k' shorthand", () => {
    assert.equal(compactCreditPeriod(500, 7), "500 credits/week");
  });

  test("formats a round-thousand monthly allowance as a 'k' shorthand", () => {
    assert.equal(compactCreditPeriod(10000, 30), "10k credits/mo");
  });

  test("does not shorten a non-round-thousand credit count", () => {
    assert.equal(compactCreditPeriod(1500, 30), "1500 credits/mo");
  });

  test("labels an unrecognized period by its day count instead of inheriting 'mo'", () => {
    assert.equal(compactCreditPeriod(1000, 14), "1k credits/14d");
  });
});

describe("mapBillingActionOutcome", () => {
  test("maps a failed result to an error message with no redirect", () => {
    const outcome = mapBillingActionOutcome({
      ok: false,
      error: "Payment method declined.",
    });
    assert.deepEqual(outcome, {
      message: "Payment method declined.",
      isError: true,
    });
  });

  test("maps a successful result carrying a redirect URL to a redirect-only outcome", () => {
    const outcome = mapBillingActionOutcome({
      ok: true,
      data: {
        message: "Redirecting…",
        redirectUrl: "https://billing.example/checkout",
      },
    });
    assert.equal(outcome.message, null);
    assert.equal(outcome.isError, false);
    assert.equal(outcome.redirectUrl, "https://billing.example/checkout");
  });

  test("maps a successful result without a redirect to a success message", () => {
    const outcome = mapBillingActionOutcome({
      ok: true,
      data: { message: "Switched to the plus plan." },
    });
    assert.deepEqual(outcome, {
      message: "Switched to the plus plan.",
      isError: false,
    });
  });
});

describe("BillingActions", () => {
  test("marks the current plan's card as current and disabled, leaves the others enabled", () => {
    const html = renderToStaticMarkup(
      <BillingActions currentPlan="plus" cancelAtPeriodEnd={false} />,
    );
    assert.match(html, /Current/);

    // `BillingActions` uses `useTransition`/`useState`, so its plan-card
    // buttons can only be introspected through a real render pass — mount it
    // with `react-test-renderer` (already a project dependency, see
    // `src/lib/i18n/locale-context.test.tsx`) rather than manually invoking
    // the component as a bare function, which would throw "Invalid hook
    // call".
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <BillingActions currentPlan="plus" cancelAtPeriodEnd={false} />,
      );
    });
    const planCardByLabel = (label: string) =>
      renderer.root
        .findAllByType("button")
        .find((button) =>
          textContentOf(button.props.children).startsWith(label),
        );
    const free = planCardByLabel("Free");
    const plus = planCardByLabel("Plus");
    const pro = planCardByLabel("Pro");
    assert.equal(free?.props.disabled, false);
    assert.equal(plus?.props.disabled, true);
    assert.equal(pro?.props.disabled, false);
    act(() => {
      renderer.unmount();
    });
  });

  test("shows the Cancel subscription control only for a paid, non-cancelling plan", () => {
    const paid = renderToStaticMarkup(
      <BillingActions currentPlan="pro" cancelAtPeriodEnd={false} />,
    );
    assert.match(paid, /Cancel subscription/);

    const free = renderToStaticMarkup(
      <BillingActions currentPlan="free" cancelAtPeriodEnd={false} />,
    );
    assert.doesNotMatch(free, /Cancel subscription/);

    const alreadyCancelling = renderToStaticMarkup(
      <BillingActions currentPlan="pro" cancelAtPeriodEnd={true} />,
    );
    assert.doesNotMatch(alreadyCancelling, /Cancel subscription/);
  });

  test("idle render shows no feedback message and no pending indicator", () => {
    const html = renderToStaticMarkup(
      <BillingActions currentPlan="free" cancelAtPeriodEnd={false} />,
    );
    assert.doesNotMatch(html, /Updating…/);
  });
});
