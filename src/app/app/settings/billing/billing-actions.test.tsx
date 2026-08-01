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
  resolveBillingActionOutcome,
  type BillingActionPort,
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

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function buttonByText(renderer: ReturnType<typeof create>, pattern: RegExp) {
  const button = renderer.root
    .findAllByType("button")
    .find((candidate) => pattern.test(textContentOf(candidate.props.children)));
  assert.ok(button, `expected a button matching ${pattern}`);
  return button;
}

function waitForAsyncDrain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
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

describe("resolveBillingActionOutcome", () => {
  test("maps a rejected action transport to safe inline feedback", async () => {
    const outcome = await resolveBillingActionOutcome(async () => {
      throw new Error("server action transport failed");
    });

    assert.deepEqual(outcome, {
      message: "Could not update billing. Please try again.",
      isError: true,
    });
  });

  test("rethrows Next redirect control flow instead of converting it to billing feedback", async () => {
    const redirectError = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;push;/login;307;",
    });

    await assert.rejects(
      () =>
        resolveBillingActionOutcome(async () => {
          throw redirectError;
        }),
      (error: unknown) => error === redirectError,
    );
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

  test("plan changes use one synchronous mutation boundary and disable every billing action while pending", async () => {
    const attempt =
      deferred<Awaited<ReturnType<BillingActionPort["changePlan"]>>>();
    const changeCalls: string[] = [];
    let cancelCalls = 0;
    const actionPort: BillingActionPort = {
      changePlan: (plan) => {
        changeCalls.push(plan);
        return attempt.promise;
      },
      cancelSubscription: async () => {
        cancelCalls += 1;
        return { ok: true, data: { message: "Cancelled." } };
      },
    };
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <BillingActions
          currentPlan="plus"
          cancelAtPeriodEnd={false}
          actionPort={actionPort}
        />,
      );
    });
    try {
      const pro = buttonByText(renderer, /^Pro/);
      const cancel = buttonByText(renderer, /^Cancel subscription$/);
      await act(async () => {
        pro.props.onClick();
        pro.props.onClick();
        cancel.props.onClick();
        await waitForAsyncDrain();
      });

      assert.deepEqual(changeCalls, ["pro"]);
      assert.equal(cancelCalls, 0);
      assert.equal(buttonByText(renderer, /^Free/).props.disabled, true);
      assert.equal(buttonByText(renderer, /^Plus/).props.disabled, true);
      assert.equal(buttonByText(renderer, /^Pro/).props.disabled, true);
      assert.equal(
        buttonByText(renderer, /^Cancel subscription$/).props.disabled,
        true,
      );
      renderer.root.find(
        (element) =>
          element.type === "div" && element.props["aria-busy"] === true,
      );
      assert.match(
        textContentOf(
          renderer.root.findByProps({ role: "status" }).props.children,
        ),
        /Changing to Pro…/,
      );

      await act(async () => {
        attempt.resolve({
          ok: true,
          data: { message: "Plan updated to pro." },
        });
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      assert.match(
        textContentOf(
          renderer.root.findByProps({ role: "status" }).props.children,
        ),
        /Plan updated to pro/,
      );
      act(() => {
        renderer.root
          .findByProps({ "aria-label": "Dismiss billing message" })
          .props.onClick();
      });
      assert.throws(() => renderer.root.findByProps({ role: "status" }));
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("unmounting invalidates a pending checkout handoff before its late result can navigate", async () => {
    const attempt =
      deferred<Awaited<ReturnType<BillingActionPort["changePlan"]>>>();
    const actionPort: BillingActionPort = {
      changePlan: () => attempt.promise,
      cancelSubscription: async () => ({
        ok: true,
        data: { message: "Cancelled." },
      }),
    };
    const originalWindowDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "window",
    );
    const fakeWindow = {
      location: { href: "https://app.example/settings/billing" },
    } as unknown as Window & typeof globalThis;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: fakeWindow,
      writable: true,
    });
    let renderer!: ReturnType<typeof create>;
    try {
      act(() => {
        renderer = create(
          <BillingActions
            currentPlan="free"
            cancelAtPeriodEnd={false}
            actionPort={actionPort}
          />,
        );
      });
      act(() => {
        buttonByText(renderer, /^Plus/).props.onClick();
      });
      assert.equal(buttonByText(renderer, /^Plus/).props.disabled, true);

      act(() => renderer.unmount());
      attempt.resolve({
        ok: true,
        data: {
          message: "Redirecting…",
          redirectUrl: "https://billing.example/checkout",
        },
      });
      await act(async () => {
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });

      assert.equal(
        fakeWindow.location.href,
        "https://app.example/settings/billing",
      );
    } finally {
      if (renderer?.toJSON() !== null) act(() => renderer.unmount());
      if (originalWindowDescriptor) {
        Object.defineProperty(globalThis, "window", originalWindowDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, "window");
      }
    }
  });

  test("cancellation shares the mutation boundary and exposes contextual pending feedback", async () => {
    const attempt =
      deferred<Awaited<ReturnType<BillingActionPort["cancelSubscription"]>>>();
    let cancelCalls = 0;
    const changeCalls: string[] = [];
    const actionPort: BillingActionPort = {
      changePlan: async (plan) => {
        changeCalls.push(plan);
        return { ok: true, data: { message: "Changed." } };
      },
      cancelSubscription: () => {
        cancelCalls += 1;
        return attempt.promise;
      },
    };
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <BillingActions
          currentPlan="pro"
          cancelAtPeriodEnd={false}
          actionPort={actionPort}
        />,
      );
    });
    try {
      const cancel = buttonByText(renderer, /^Cancel subscription$/);
      const plus = buttonByText(renderer, /^Plus/);
      await act(async () => {
        cancel.props.onClick();
        cancel.props.onClick();
        plus.props.onClick();
        await waitForAsyncDrain();
      });

      assert.equal(cancelCalls, 1);
      assert.deepEqual(changeCalls, []);
      assert.match(
        textContentOf(
          renderer.root.findByProps({ role: "status" }).props.children,
        ),
        /Cancelling subscription…/,
      );

      await act(async () => {
        attempt.resolve({ ok: false, error: "No active subscription." });
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      assert.match(
        textContentOf(
          renderer.root.findByProps({ role: "alert" }).props.children,
        ),
        /No active subscription/,
      );
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("a rejected billing transport renders safe dismissible inline feedback", async () => {
    const actionPort: BillingActionPort = {
      changePlan: async () => {
        throw new Error("provider transport leaked details");
      },
      cancelSubscription: async () => ({
        ok: true,
        data: { message: "Cancelled." },
      }),
    };
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <BillingActions
          currentPlan="free"
          cancelAtPeriodEnd={false}
          actionPort={actionPort}
        />,
      );
    });
    try {
      await act(async () => {
        buttonByText(renderer, /^Plus/).props.onClick();
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });

      const alert = renderer.root.findByProps({ role: "alert" });
      const alertText = textContentOf(alert.props.children);
      assert.match(alertText, /Could not update billing/);
      assert.doesNotMatch(alertText, /provider transport/);
      act(() => {
        renderer.root
          .findByProps({ "aria-label": "Dismiss billing message" })
          .props.onClick();
      });
      assert.throws(() => renderer.root.findByProps({ role: "alert" }));
    } finally {
      act(() => renderer.unmount());
    }
  });
});
