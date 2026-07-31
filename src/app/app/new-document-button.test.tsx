/**
 * Direct contract coverage for `NewDocumentButton`/`TemplatePickerDialog`
 * (issue
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
 * `TemplatePickerDialog` renders `<Dialog open>` — always mounted-open; the
 * parent conditionally mounts/unmounts the picker rather than toggling an
 * `open` prop. `Dialog` portals to `document.body` unconditionally once
 * `document` exists, so this file uses `withPortalDom`/`mountWithPortalDom`
 * instead of the plain
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
import type { ReactNode } from "react";
import { before, beforeEach, describe, test } from "node:test";
import {
  act,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";

import { mountWithPortalDom, withPortalDom } from "@/test/portal-dom";

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

  test("choosing a template synchronously suppresses duplicate activation, locks dismissal, and shows a per-tile pending label", async () => {
    let resolveCreation!: () => void;
    globalForActions.__newDocumentActionsTestState.impl = () =>
      new Promise<void>((resolve) => {
        resolveCreation = resolve;
      });

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
        const blank = findTemplateButton(renderer.root, "Blank");
        act(() => {
          flowchart.props.onClick();
          flowchart.props.onClick();
          blank.props.onClick();
        });

        assert.deepEqual(globalForActions.__newDocumentActionsTestState.calls, [
          "flowchart",
        ]);
        const pendingFlowchart = findTemplateButton(
          renderer.root,
          "Process / Flowchart",
        );
        assert.equal(pendingFlowchart.props.disabled, true);
        assert.match(textOf(pendingFlowchart), /Creating…/);
        const blankWhilePending = findTemplateButton(renderer.root, "Blank");
        assert.equal(blankWhilePending.props.disabled, true);
        assert.equal(
          renderer.root.findByProps({ role: "dialog" }).props["aria-busy"],
          true,
        );

        const close = renderer.root.findByProps({ "aria-label": "Close" });
        const cancel = renderer.root.find(
          (el) => el.type === "button" && textOf(el) === "Cancel",
        );
        assert.equal(close.props.disabled, true);
        assert.equal(cancel.props.disabled, true);
        const backdrop = renderer.root.find(
          (el) =>
            el.type === "div" &&
            el.props["aria-hidden"] === "true" &&
            typeof el.props.className === "string" &&
            el.props.className.includes("bg-ds-backdrop"),
        );
        act(() => backdrop.props.onClick());
        assert.ok(renderer.root.findByProps({ role: "dialog" }));

        await act(async () => {
          resolveCreation();
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });

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

  test("a failed create stays inline and retry repeats the same template without replacing the route", async () => {
    let attempt = 0;
    globalForActions.__newDocumentActionsTestState.impl = async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("private database detail");
    };
    await withPortalDom(async () => {
      const renderer = mount({});
      try {
        await act(async () => {
          renderer.root.findByType("button").props.onClick();
        });
        const blank = findTemplateButton(renderer.root, "Blank");

        await act(async () => {
          blank.props.onClick();
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });

        const alert = renderer.root.findByProps({ role: "alert" });
        assert.match(
          textOf(alert),
          /Could not create the document\. Please try again\./,
        );
        assert.doesNotMatch(textOf(alert), /private database detail/);
        assert.ok(renderer.root.findByProps({ role: "dialog" }));
        assert.deepEqual(globalForActions.__newDocumentActionsTestState.calls, [
          "blank",
        ]);

        const retry = renderer.root.find(
          (el) => el.type === "button" && textOf(el) === "Try again",
        );
        await act(async () => {
          retry.props.onClick();
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });
        assert.deepEqual(globalForActions.__newDocumentActionsTestState.calls, [
          "blank",
          "blank",
        ]);
        assert.throws(() => renderer.root.findByProps({ role: "alert" }));
      } finally {
        await act(async () => renderer.unmount());
      }
    });
  });

  test("Dismiss error clears a failed create without closing the picker", async () => {
    globalForActions.__newDocumentActionsTestState.impl = async () => {
      throw new Error("create failed");
    };
    await withPortalDom(async () => {
      const renderer = mount({});
      try {
        await act(async () => {
          renderer.root.findByType("button").props.onClick();
        });
        await act(async () => {
          findTemplateButton(renderer.root, "Blank").props.onClick();
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });
        const dismiss = renderer.root.find(
          (el) => el.type === "button" && textOf(el) === "Dismiss error",
        );
        await act(async () => dismiss.props.onClick());
        assert.throws(() => renderer.root.findByProps({ role: "alert" }));
        assert.ok(renderer.root.findByProps({ role: "dialog" }));
      } finally {
        await act(async () => renderer.unmount());
      }
    });
  });
});
