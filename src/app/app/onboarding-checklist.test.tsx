/**
 * Direct contract coverage for `OnboardingChecklist` (issue #1956) — the
 * dismissible first-run checklist panel.
 *
 * `dismissOnboarding` (from `./actions`) is already fully covered by
 * `src/app/app/actions.test.ts`, so this stubs the sibling `./actions`
 * module via `node:module`'s `registerHooks` (matching the aliased-specifier
 * pattern already used by `src/app/app/settings/page.test.tsx` and
 * `src/app/share/[shareId]/opengraph-image.test.tsx`) rather than
 * re-testing the server action or its `@/lib/prisma`/`@/lib/session`
 * dependencies. The stub is scoped to the `"./actions"` specifier, which
 * only `onboarding-checklist.tsx` resolves within this file's module graph —
 * safe because Node's test runner isolates each test file into its own
 * process, so this hook never collides with other test files' `./actions`
 * stubs.
 *
 * Mounted directly with `react-test-renderer` (same pattern as
 * `src/app/app/use-optimistic-document-trash.test.tsx`), NOT via the
 * "call the component as a plain function" pattern from
 * `conflict-recovery-dialog.test.ts`: `handleDismiss` drives its
 * `useTransition` with an async callback, and calling the component as a
 * bare function (bypassing a real fiber) leaves that transition's dangling
 * scheduler work to bleed into whichever test runs next in this file. A
 * real JSX mount + `await act(async () => { ... })` around each interaction
 * lets the transition settle cleanly before the test ends.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";
import { createElement } from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";

import type { OnboardingStep } from "@/lib/onboarding/checklist";
import {
  configureProductTelemetrySink,
  type ProductTelemetryRecord,
} from "@/lib/telemetry/product";

type ModuleHooks = {
  registerHooks(hooks: {
    resolve(
      specifier: string,
      context: unknown,
      nextResolve: (specifier: string, context: unknown) => unknown,
    ): unknown;
    load(
      url: string,
      context: unknown,
      nextLoad: (url: string, context: unknown) => unknown,
    ): unknown;
  }): void;
};

type OnboardingActionsTestState = {
  dismissCalls: number;
  rethrowCalls: unknown[];
  dismissImpl: () => Promise<void>;
};

const globalForActions = globalThis as typeof globalThis & {
  __onboardingActionsTestState: OnboardingActionsTestState;
};

function resetActionsState(): void {
  globalForActions.__onboardingActionsTestState = {
    dismissCalls: 0,
    rethrowCalls: [],
    dismissImpl: async () => undefined,
  };
}
resetActionsState();

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;
const actionsStubUrl = "onboarding-checklist-actions:test";
const navigationStubUrl = "onboarding-checklist-navigation:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./actions") {
      return { url: actionsStubUrl, shortCircuit: true };
    }
    if (specifier === "next/navigation") {
      return { url: navigationStubUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === actionsStubUrl) {
      return {
        format: "commonjs",
        source: `module.exports = {
  dismissOnboarding: async () => {
    globalThis.__onboardingActionsTestState.dismissCalls += 1;
    return globalThis.__onboardingActionsTestState.dismissImpl();
  },
};`,
        shortCircuit: true,
      };
    }
    if (url === navigationStubUrl) {
      return {
        format: "commonjs",
        source: `module.exports = {
  unstable_rethrow: (error) => {
    globalThis.__onboardingActionsTestState.rethrowCalls.push(error);
    if (error && error.__nextControlFlow === true) throw error;
  },
};`,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

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
after(() => {
  console.error = originalConsoleError;
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type ChecklistModule = typeof import("./onboarding-checklist");
let OnboardingChecklist: ChecklistModule["OnboardingChecklist"];

before(async () => {
  const mod = await import("./onboarding-checklist");
  OnboardingChecklist = mod.OnboardingChecklist;
});

beforeEach(resetActionsState);

function buildSteps(
  overrides: Partial<OnboardingStep>[] = [],
): OnboardingStep[] {
  const base: OnboardingStep[] = [
    {
      id: "create-doc",
      label: "Create your first document",
      description: "Start from a template or import a file.",
      done: true,
    },
    {
      id: "generate-visual",
      label: "Generate a visual",
      description: "Turn a paragraph into a diagram.",
      done: false,
    },
  ];
  return base.map((step, index) => ({ ...step, ...overrides[index] }));
}

function textOf(instance: ReactTestInstance): string {
  return instance.children
    .map((child) => (typeof child === "string" ? child : textOf(child)))
    .join("");
}

function findButtonByText(
  root: ReactTestInstance,
  text: string,
): ReactTestInstance {
  const button = root
    .findAllByType("button")
    .find((el) => textOf(el).trim() === text);
  assert.ok(button, `expected a button with text "${text}"`);
  return button;
}

function mountChecklist(steps: OnboardingStep[]): {
  renderer: ReactTestRenderer;
  root: ReactTestInstance;
} {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(createElement(OnboardingChecklist, { steps }));
  });
  return { renderer, root: renderer.root };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function captureTelemetry(): {
  events: ProductTelemetryRecord[];
  restore: () => void;
} {
  const events: ProductTelemetryRecord[] = [];
  const restore = configureProductTelemetrySink((event) => {
    events.push(event);
  });
  return { events, restore };
}

describe("OnboardingChecklist", () => {
  test("renders step progress: completed count, progressbar aria attributes, and per-step indicator/labels", () => {
    const steps = buildSteps();
    const { renderer, root } = mountChecklist(steps);
    try {
      const text = textOf(root);
      assert.match(text, /1 of 2 steps complete/);
      assert.match(text, /Create your first document/);
      assert.match(text, /Generate a visual/);

      const progressbar = root.findByProps({ role: "progressbar" });
      assert.equal(progressbar.props["aria-valuenow"], 1);
      assert.equal(progressbar.props["aria-valuemin"], 0);
      assert.equal(progressbar.props["aria-valuemax"], 2);
      assert.equal(
        progressbar.props["aria-label"],
        "1 of 2 onboarding steps complete",
      );
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("emits a 'viewed' activation telemetry event on mount with the completed/total step counts", async () => {
    const { events, restore } = captureTelemetry();
    const steps = buildSteps();
    const { renderer } = mountChecklist(steps);
    try {
      const activation = events.find(
        (e) => e.eventName === "product.onboarding.activation",
      );
      assert.ok(activation, "expected an activation telemetry event");
      assert.equal(activation.fields.activationKind, "viewed");
      assert.equal(activation.fields.completedStepCount, 1);
      assert.equal(activation.fields.stepCount, 2);
    } finally {
      act(() => renderer.unmount());
      restore();
    }
  });

  test("emits an 'all_steps_complete' activation telemetry event when every step is done", async () => {
    const { events, restore } = captureTelemetry();
    const allDone = buildSteps().map((s) => ({ ...s, done: true }));
    const { renderer } = mountChecklist(allDone);
    try {
      const activation = events.find(
        (e) => e.eventName === "product.onboarding.activation",
      );
      assert.ok(activation);
      assert.equal(activation.fields.activationKind, "all_steps_complete");
      assert.equal(activation.fields.completedStepCount, 2);
    } finally {
      act(() => renderer.unmount());
      restore();
    }
  });

  test("dismiss (header icon button): emits dismissed telemetry and calls dismissOnboarding", async () => {
    const { events, restore } = captureTelemetry();
    const steps = buildSteps();
    const { renderer, root } = mountChecklist(steps);
    try {
      const dismissButton = root.findByProps({
        "aria-label": "Dismiss onboarding checklist",
      });
      await act(async () => {
        dismissButton.props.onClick();
        await flush();
      });

      const dismissed = events.find(
        (e) => e.eventName === "product.onboarding.dismissed",
      );
      assert.ok(dismissed, "expected a dismissed telemetry event");
      assert.equal(dismissed.fields.completedStepCount, 1);
      assert.equal(dismissed.fields.stepCount, 2);
      assert.equal(
        globalForActions.__onboardingActionsTestState.dismissCalls,
        1,
      );
    } finally {
      act(() => renderer.unmount());
      restore();
    }
  });

  test("dismiss (footer CTA): disables the button and shows the pending label while in flight, then completes", async () => {
    let resolveDismiss!: () => void;
    globalForActions.__onboardingActionsTestState.dismissImpl = () =>
      new Promise((resolve) => {
        resolveDismiss = resolve;
      });

    const steps = buildSteps();
    const { renderer, root } = mountChecklist(steps);
    try {
      const idleCta = findButtonByText(root, "Mark as complete and dismiss");
      assert.equal(idleCta.props.disabled, false);

      act(() => {
        idleCta.props.onClick();
      });

      const pendingCta = findButtonByText(root, "Dismissing…");
      assert.equal(pendingCta.props.disabled, true);

      await act(async () => {
        resolveDismiss();
        await flush();
      });

      assert.equal(renderer.toJSON(), null);
      assert.equal(
        globalForActions.__onboardingActionsTestState.dismissCalls,
        1,
      );
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("unmounting invalidates a pending dismiss and suppresses its late success telemetry", async () => {
    const { events, restore } = captureTelemetry();
    const pendingDismiss = createDeferred<void>();
    globalForActions.__onboardingActionsTestState.dismissImpl = () =>
      pendingDismiss.promise;
    const { renderer, root } = mountChecklist(buildSteps());
    try {
      act(() => {
        root
          .findByProps({
            "aria-label": "Dismiss onboarding checklist",
          })
          .props.onClick();
      });
      assert.equal(
        root.findByProps({
          "aria-label": "Getting started checklist",
        }).props["aria-busy"],
        true,
      );

      act(() => renderer.unmount());
      pendingDismiss.resolve();
      await act(async () => {
        await flush();
        await flush();
      });

      assert.equal(
        events.filter(
          (event) => event.eventName === "product.onboarding.dismissed",
        ).length,
        0,
      );
    } finally {
      if (renderer.toJSON() !== null) act(() => renderer.unmount());
      restore();
    }
  });

  test("a failed dismiss stays inline, redacts details, can be dismissed, and retries without duplicate writes", async () => {
    const { events, restore } = captureTelemetry();
    const privateFailure = new Error("private onboarding storage detail");
    const retry = createDeferred<void>();
    let attempt = 0;
    globalForActions.__onboardingActionsTestState.dismissImpl = async () => {
      attempt += 1;
      if (attempt <= 2) throw privateFailure;
      return retry.promise;
    };

    const { renderer, root } = mountChecklist(buildSteps());
    try {
      await act(async () => {
        root
          .findByProps({
            "aria-label": "Dismiss onboarding checklist",
          })
          .props.onClick();
        await flush();
      });

      let alert = root.findByProps({ role: "alert" });
      assert.match(
        textOf(alert),
        /Could not dismiss the checklist\. Please try again\./,
      );
      assert.doesNotMatch(textOf(alert), /private onboarding storage detail/);
      assert.equal(
        events.filter(
          (event) => event.eventName === "product.onboarding.dismissed",
        ).length,
        0,
      );

      await act(async () => {
        findButtonByText(root, "Dismiss error").props.onClick();
        await flush();
      });
      assert.throws(() => root.findByProps({ role: "alert" }));

      await act(async () => {
        findButtonByText(root, "Mark as complete and dismiss").props.onClick();
        await flush();
      });
      alert = root.findByProps({ role: "alert" });
      const retryButton = alert.find(
        (element) =>
          element.type === "button" && textOf(element) === "Try dismiss again",
      );
      act(() => {
        retryButton.props.onClick();
        retryButton.props.onClick();
      });
      assert.equal(
        globalForActions.__onboardingActionsTestState.dismissCalls,
        3,
      );
      assert.equal(
        root.findByProps({
          "aria-label": "Getting started checklist",
        }).props["aria-busy"],
        true,
      );
      assert.equal(
        root.findByProps({
          "aria-label": "Dismiss onboarding checklist",
        }).props.disabled,
        true,
      );

      retry.resolve();
      await act(async () => {
        await flush();
        await flush();
      });
      assert.equal(renderer.toJSON(), null);
      assert.equal(
        events.filter(
          (event) => event.eventName === "product.onboarding.dismissed",
        ).length,
        1,
      );
      assert.deepEqual(
        globalForActions.__onboardingActionsTestState.rethrowCalls,
        [privateFailure, privateFailure],
      );
    } finally {
      act(() => renderer.unmount());
      restore();
    }
  });

  test("framework navigation control-flow errors escape onboarding recovery", async () => {
    const controlFlowError = Object.assign(new Error("NEXT_REDIRECT"), {
      __nextControlFlow: true,
    });
    globalForActions.__onboardingActionsTestState.dismissImpl = async () => {
      throw controlFlowError;
    };
    const { renderer, root } = mountChecklist(buildSteps());
    try {
      await assert.rejects(async () => {
        await act(async () => {
          await root
            .findByProps({
              "aria-label": "Dismiss onboarding checklist",
            })
            .props.onClick();
        });
      }, controlFlowError);
      assert.deepEqual(
        globalForActions.__onboardingActionsTestState.rethrowCalls,
        [controlFlowError],
      );
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("all steps complete does not auto-dismiss the checklist", () => {
    const steps = buildSteps().map((s) => ({ ...s, done: true }));
    const { renderer, root } = mountChecklist(steps);
    try {
      assert.match(textOf(root), /2 of 2 steps complete/);
      assert.equal(
        globalForActions.__onboardingActionsTestState.dismissCalls,
        0,
      );
    } finally {
      act(() => renderer.unmount());
    }
  });
});
