/**
 * Direct contract coverage for `NewDocumentButton`/`TemplatePicker` (issue
 * #1956) — the dashboard "New document" action and its starter-template
 * modal.
 *
 * `createDocumentFromTemplate` (from `./actions`) is already fully covered
 * by `src/app/app/actions.test.ts`, so this stubs the sibling `./actions`
 * module via `node:module`'s `registerHooks` (same pattern used by
 * `src/app/app/onboarding-checklist.test.tsx` and
 * `src/app/app/import-document-button.test.tsx`) rather than re-testing the
 * server action. The stub is scoped to the `"./actions"` specifier, which
 * only `new-document-button.tsx` resolves within this file's module graph —
 * safe because Node's test runner isolates each test file into its own
 * process.
 *
 * `TemplatePicker` renders `<Dialog open>` — always mounted-open; the parent
 * conditionally mounts/unmounts `TemplatePicker` itself rather than toggling
 * an `open` prop. `Dialog` portals to `document.body` unconditionally once
 * `document` exists (see `@/test/portal-dom`'s docstring), so this file uses
 * `withPortalDom`/`mountWithPortalDom` instead of the plain
 * `@/test/react-render-harness` (whose fake `document` has no `.body`).
 *
 * The keyboard-shortcut wiring (`enableShortcut` → `useKeyboardShortcut`) is
 * intentionally not covered here: `isNewDocumentShortcut`'s matching logic
 * is pinned by `src/lib/shortcuts/match.test.ts` and the generic
 * enabled/disabled + allowInInput behavior of `useKeyboardShortcut` itself is
 * pinned by `src/lib/shortcuts/use-keyboard-shortcuts.test.ts` — retesting
 * either here would duplicate that coverage for a prop this issue's target
 * flows (creation/pending/navigation/error) don't call out.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Component, type ReactNode } from "react";
import { after, before, beforeEach, describe, test } from "node:test";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";

import {
  createPortalNodeMock,
  mountWithPortalDom,
  withPortalDom,
} from "@/test/portal-dom";

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

type NewDocumentActionsTestState = {
  calls: string[];
  impl: (templateId: string) => Promise<void>;
};

const globalForActions = globalThis as typeof globalThis & {
  __newDocumentActionsTestState: NewDocumentActionsTestState;
};

function resetActionsState(): void {
  globalForActions.__newDocumentActionsTestState = {
    calls: [],
    impl: async () => undefined,
  };
}
resetActionsState();

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;
const actionsStubUrl = "new-document-button-actions:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./actions") {
      return { url: actionsStubUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === actionsStubUrl) {
      return {
        format: "commonjs",
        source: `module.exports = {
  createDocumentFromTemplate: async (templateId) => {
    globalThis.__newDocumentActionsTestState.calls.push(templateId);
    return globalThis.__newDocumentActionsTestState.impl(templateId);
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
  // React's default `onCaughtError` logs the caught error via
  // `console.error("%o\n\n%s\n\n%s\n", error, componentNameMessage, ...)` —
  // the format string is `args[0]`, and the actual Error instance is
  // `args[1]`, not `args[0]`. (react-test-renderer's `create()` ignores any
  // `onCaughtError`/`onUncaughtError` options passed to it — it always uses
  // this hardcoded default logger — so filtering here is the only way to
  // suppress it.) The "propagates to an error boundary" test below
  // intentionally triggers exactly one such error, so it's expected noise
  // rather than a signal of a real test failure.
  if (
    args.some((arg) => arg instanceof Error && arg.message === "create failed")
  ) {
    return;
  }
  originalConsoleError(...args);
};
after(() => {
  console.error = originalConsoleError;
});

type ButtonModule = typeof import("./new-document-button");
let NewDocumentButton: ButtonModule["NewDocumentButton"];

before(async () => {
  const mod = await import("./new-document-button");
  NewDocumentButton = mod.NewDocumentButton;
});

beforeEach(resetActionsState);

function textOf(instance: ReactTestInstance): string {
  return instance.children
    .map((child) => (typeof child === "string" ? child : textOf(child)))
    .join("");
}

function waitForAsyncDrain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function findTemplateButton(
  root: ReactTestInstance,
  templateName: string,
): ReactTestInstance {
  return root.findByProps({ "aria-label": `${templateName} template` });
}

function mount(props: {
  className?: string;
  children?: ReactNode;
  enableShortcut?: boolean;
}): ReactTestRenderer {
  return mountWithPortalDom(
    <NewDocumentButton
      className={props.className ?? "primary"}
      enableShortcut={props.enableShortcut}
    >
      {props.children ?? "New document"}
    </NewDocumentButton>,
  );
}

describe("NewDocumentButton", () => {
  test("idle render: only the trigger button, no template picker dialog", () => {
    withPortalDom(() => {
      const renderer = mount({});
      try {
        assert.throws(() => renderer.root.findByProps({ role: "dialog" }));
        const trigger = renderer.root.findByType("button");
        assert.equal(trigger.props.className, "primary");
        assert.equal(textOf(trigger), "New document");
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("clicking the trigger opens the template picker, listing the catalog with Blank first", () => {
    withPortalDom(() => {
      const renderer = mount({});
      try {
        const trigger = renderer.root.findByType("button");
        act(() => {
          trigger.props.onClick();
        });

        const dialog = renderer.root.findByProps({ role: "dialog" });
        assert.equal(dialog.props["aria-labelledby"], "template-picker-title");
        assert.equal(dialog.props["aria-modal"], "true");

        const allText = textOf(renderer.root);
        assert.match(allText, /Start a new document/);
        assert.match(allText, /Pick a template or start blank\./);

        const firstTileButton = renderer.root
          .findAllByType("li")[0]!
          .findAllByType("button")[0]!;
        assert.equal(firstTileButton.props["aria-label"], "Blank template");
        assert.match(
          textOf(firstTileButton),
          /Start from scratch with an empty document\./,
        );

        const flowchart = findTemplateButton(
          renderer.root,
          "Process / Flowchart",
        );
        assert.equal(flowchart.props.disabled, false);
        assert.match(
          textOf(flowchart),
          /Map a step-by-step process from start to finish\./,
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("choosing a template disables every tile, shows a per-tile pending label, and calls createDocumentFromTemplate with its id", async () => {
    await withPortalDom(async () => {
      const renderer = mount({});
      try {
        act(() => {
          renderer.root.findByType("button").props.onClick();
        });

        const flowchart = findTemplateButton(
          renderer.root,
          "Process / Flowchart",
        );
        act(() => {
          flowchart.props.onClick();
        });

        // Pending: the chosen tile shows "Creating…"; every tile (including
        // Blank) is disabled while any transition is in flight.
        const pendingFlowchart = findTemplateButton(
          renderer.root,
          "Process / Flowchart",
        );
        assert.equal(pendingFlowchart.props.disabled, true);
        assert.match(textOf(pendingFlowchart), /Creating…/);
        const blankWhilePending = findTemplateButton(renderer.root, "Blank");
        assert.equal(blankWhilePending.props.disabled, true);

        await act(async () => {
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });

        assert.deepEqual(globalForActions.__newDocumentActionsTestState.calls, [
          "flowchart",
        ]);
        // Transition settled: tiles are enabled again.
        const blankAfter = findTemplateButton(renderer.root, "Blank");
        assert.equal(blankAfter.props.disabled, false);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("the Cancel button closes the template picker", () => {
    withPortalDom(() => {
      const renderer = mount({});
      try {
        act(() => {
          renderer.root.findByType("button").props.onClick();
        });
        assert.ok(renderer.root.findByProps({ role: "dialog" }));

        const cancel = renderer.root.find(
          (el) => el.type === "button" && textOf(el) === "Cancel",
        );
        act(() => {
          cancel.props.onClick();
        });

        assert.throws(() => renderer.root.findByProps({ role: "dialog" }));
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("the header close button closes the template picker", () => {
    withPortalDom(() => {
      const renderer = mount({});
      try {
        act(() => {
          renderer.root.findByType("button").props.onClick();
        });
        const close = renderer.root.findByProps({ "aria-label": "Close" });
        act(() => {
          close.props.onClick();
        });
        assert.throws(() => renderer.root.findByProps({ role: "dialog" }));
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("a backdrop click closes the template picker", () => {
    withPortalDom(() => {
      const renderer = mount({});
      try {
        act(() => {
          renderer.root.findByType("button").props.onClick();
        });
        const backdrop = renderer.root.find(
          (el) =>
            el.type === "div" &&
            el.props["aria-hidden"] === "true" &&
            typeof el.props.className === "string" &&
            el.props.className.includes("bg-ds-backdrop"),
        );
        act(() => {
          backdrop.props.onClick();
        });
        assert.throws(() => renderer.root.findByProps({ role: "dialog" }));
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("a rejected createDocumentFromTemplate call is not swallowed locally — it propagates to the nearest error boundary (no local try/catch in `choose`)", async () => {
    globalForActions.__newDocumentActionsTestState.impl = async () => {
      throw new Error("create failed");
    };

    class TestErrorBoundary extends Component<
      { children: ReactNode },
      { error: Error | null }
    > {
      state: { error: Error | null } = { error: null };
      static getDerivedStateFromError(error: Error) {
        return { error };
      }
      render() {
        if (this.state.error) {
          return (
            <p role="alert">Something went wrong: {this.state.error.message}</p>
          );
        }
        return this.props.children;
      }
    }

    await withPortalDom(async () => {
      let renderer!: ReactTestRenderer;
      act(() => {
        renderer = create(
          <TestErrorBoundary>
            <NewDocumentButton className="primary">
              New document
            </NewDocumentButton>
          </TestErrorBoundary>,
          { createNodeMock: () => createPortalNodeMock() },
        );
      });
      try {
        act(() => {
          renderer.root.findByType("button").props.onClick();
        });
        const blank = findTemplateButton(renderer.root, "Blank");

        await act(async () => {
          blank.props.onClick();
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });

        const alert = renderer.root.findByProps({ role: "alert" });
        assert.match(textOf(alert), /create failed/);
        assert.deepEqual(globalForActions.__newDocumentActionsTestState.calls, [
          "blank",
        ]);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });
});
