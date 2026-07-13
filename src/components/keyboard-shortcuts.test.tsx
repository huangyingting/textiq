/**
 * Direct contract coverage for `KeyboardShortcuts`/`ShortcutsDialog`/
 * `KeyCombo` (#1962) — the discoverable "?" trigger and the global-shortcut
 * dialog listing every scope's shortcuts.
 *
 * `useKeyboardShortcut` (from `@/lib/shortcuts/use-keyboard-shortcuts`) is
 * already fully covered by its own `use-keyboard-shortcuts.test.ts` (the
 * generic enable/disable, `allowInInput`, and add/remove-listener lifecycle),
 * and `isHelpShortcut`/`matchesShortcut`'s key-matching logic is covered by
 * `match.test.ts`/`catalog.test.ts`. Re-dispatching real `keydown` events
 * through a fake `document` here would only duplicate that coverage — worse,
 * `withPortalDom`'s fake `document.addEventListener` is a deliberate no-op
 * (see its docstring), so a real dispatch wouldn't even reach the listener.
 * Instead this stubs `@/lib/shortcuts/use-keyboard-shortcuts` via
 * `node:module`'s `registerHooks` (same pattern as
 * `src/app/app/new-document-button.test.tsx`'s `./actions` stub) to capture
 * the handler `KeyboardShortcuts` registers, then invokes it directly with
 * fabricated `KeyEventLike`-shaped events — isolating exactly what this
 * component adds on top: the `isHelpShortcut` check, `preventDefault`, and
 * the `open` toggle.
 *
 * `shortcutsForScope`/`shortcutDisplayTokens`/`SHORTCUT_SCOPES` are used for
 * real (not stubbed) — their own filtering/formatting logic is covered by
 * `catalog.test.ts`; this file only asserts that `ShortcutsDialog` renders
 * whatever they return, matching the real catalog's current shape.
 *
 * `ShortcutsDialog` renders `<Dialog open>` unconditionally once mounted, and
 * `Dialog`/`ModalSurface` portals to `document.body` — so this uses
 * `withPortalDom`/`mountWithPortalDom` (`@/test/portal-dom`) rather than the
 * plain `@/test/react-render-harness`. Escape-to-close and focus-trap
 * mechanics are already covered by
 * `src/components/ui/ui-interactions-coverage.test.ts`; this file only
 * covers the explicit "Close" button and the scope-specific dialog content.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, describe, test } from "node:test";
import { act, type ReactTestInstance } from "react-test-renderer";

import { mountWithPortalDom, withPortalDom } from "@/test/portal-dom";
import {
  SHORTCUT_SCOPES,
  shortcutsForScope,
  shortcutDisplayTokens,
} from "@/lib/shortcuts/catalog";

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

type KeyEventLike = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

type FakeKeyboardEvent = KeyEventLike & {
  defaultPrevented: boolean;
  preventDefault: () => void;
};

function fakeEvent(overrides: Partial<KeyEventLike> = {}): FakeKeyboardEvent {
  const event: FakeKeyboardEvent = {
    key: "?",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    defaultPrevented: false,
    preventDefault() {
      event.defaultPrevented = true;
    },
    ...overrides,
  };
  return event;
}

type ShortcutHookTestState = {
  handler: ((event: FakeKeyboardEvent) => void) | undefined;
  registrations: number;
};

const globalForHook = globalThis as typeof globalThis & {
  __keyboardShortcutsHookTestState: ShortcutHookTestState;
};

function resetHookState(): void {
  globalForHook.__keyboardShortcutsHookTestState = {
    handler: undefined,
    registrations: 0,
  };
}
resetHookState();

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;
const hookStubUrl = "keyboard-shortcuts-use-keyboard-shortcuts:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/shortcuts/use-keyboard-shortcuts") {
      return { url: hookStubUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === hookStubUrl) {
      return {
        format: "commonjs",
        source: `module.exports = {
  useKeyboardShortcut: (handler) => {
    globalThis.__keyboardShortcutsHookTestState.handler = handler;
    globalThis.__keyboardShortcutsHookTestState.registrations += 1;
  },
};`,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

type ShortcutsModule = typeof import("./keyboard-shortcuts");
let KeyboardShortcuts: ShortcutsModule["KeyboardShortcuts"];

before(async () => {
  const mod = await import("./keyboard-shortcuts");
  KeyboardShortcuts = mod.KeyboardShortcuts;
});

beforeEach(resetHookState);

function textOf(instance: ReactTestInstance): string {
  return instance.children
    .map((child) => (typeof child === "string" ? child : textOf(child)))
    .join("");
}

describe("KeyboardShortcuts", () => {
  test("idle render: only the trigger, labelled for both the tooltip and screen readers; registers exactly one global-shortcut handler", () => {
    withPortalDom(() => {
      const renderer = mountWithPortalDom(<KeyboardShortcuts />);
      try {
        assert.throws(() => renderer.root.findByProps({ role: "dialog" }));

        const trigger = renderer.root.findByProps({
          "aria-label": "Keyboard shortcuts",
        });
        assert.equal(textOf(trigger), "?");

        const tooltipLabels = renderer.root
          .findAllByProps({ side: "bottom" })
          .map((el) => el.props.label);
        assert.deepEqual(tooltipLabels, ["Keyboard shortcuts (?)"]);

        assert.equal(
          globalForHook.__keyboardShortcutsHookTestState.registrations,
          1,
        );
        assert.equal(
          typeof globalForHook.__keyboardShortcutsHookTestState.handler,
          "function",
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("clicking the trigger opens the dialog, labelled by its own heading", () => {
    withPortalDom(() => {
      const renderer = mountWithPortalDom(<KeyboardShortcuts />);
      try {
        const trigger = renderer.root.findByProps({
          "aria-label": "Keyboard shortcuts",
        });
        act(() => trigger.props.onClick());

        const dialog = renderer.root.findByProps({ role: "dialog" });
        assert.equal(dialog.props["aria-labelledby"], "shortcuts-title");

        const heading = renderer.root.findByProps({ id: "shortcuts-title" });
        assert.equal(textOf(heading), "Keyboard shortcuts");
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("the explicit Close button closes the dialog", () => {
    withPortalDom(() => {
      const renderer = mountWithPortalDom(<KeyboardShortcuts />);
      try {
        const trigger = renderer.root.findByProps({
          "aria-label": "Keyboard shortcuts",
        });
        act(() => trigger.props.onClick());
        assert.ok(renderer.root.findByProps({ role: "dialog" }));

        const close = renderer.root.findByProps({ "aria-label": "Close" });
        act(() => close.props.onClick());

        assert.throws(() => renderer.root.findByProps({ role: "dialog" }));
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("renders every non-empty catalog scope, in SHORTCUT_SCOPES order, with one row (description + KeyCombo) per entry", () => {
    withPortalDom(() => {
      const renderer = mountWithPortalDom(<KeyboardShortcuts />);
      try {
        const trigger = renderer.root.findByProps({
          "aria-label": "Keyboard shortcuts",
        });
        act(() => trigger.props.onClick());

        const expectedScopes = SHORTCUT_SCOPES.filter(
          (scope) => shortcutsForScope(scope).length > 0,
        );
        // Sanity check on the fixture assumption this test relies on: every
        // scope currently has at least one visible entry. If the catalog
        // changes so a scope becomes empty, this test still passes (it only
        // asserts against whatever the real catalog returns) but this guard
        // documents the assumption so a future reader notices the shift.
        assert.deepEqual(expectedScopes, SHORTCUT_SCOPES);

        const headings = renderer.root
          .findAllByType("h3")
          .map((el) => textOf(el));
        assert.deepEqual(headings, expectedScopes);

        for (const scope of expectedScopes) {
          const entries = shortcutsForScope(scope);
          const heading = renderer.root.find(
            (el) => el.type === "h3" && textOf(el) === scope,
          );
          const scopeSection = heading.parent;
          assert.ok(scopeSection);
          const rows = scopeSection!.findAllByType("li");
          assert.equal(rows.length, entries.length);

          rows.forEach((row, index) => {
            const entry = entries[index]!;
            const description = row.findByProps({
              className: "text-sm text-ds-text-secondary",
            });
            assert.equal(textOf(description), entry.description);

            const kbds = row.findAllByType("kbd").map((el) => textOf(el));
            assert.deepEqual(kbds, shortcutDisplayTokens(entry));
          });
        }
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("the captured global handler ignores non-matching events and never opens the dialog", () => {
    withPortalDom(() => {
      const renderer = mountWithPortalDom(<KeyboardShortcuts />);
      try {
        const handler = globalForHook.__keyboardShortcutsHookTestState.handler;
        assert.ok(handler);

        const event = fakeEvent({ key: "a" });
        act(() => handler!(event));

        assert.equal(event.defaultPrevented, false);
        assert.throws(() => renderer.root.findByProps({ role: "dialog" }));
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("the captured global handler opens the dialog and calls preventDefault when the event matches the help shortcut", () => {
    withPortalDom(() => {
      const renderer = mountWithPortalDom(<KeyboardShortcuts />);
      try {
        const handler = globalForHook.__keyboardShortcutsHookTestState.handler;
        assert.ok(handler);

        const event = fakeEvent({ key: "?", shiftKey: true });
        act(() => handler!(event));

        assert.equal(event.defaultPrevented, true);
        const dialog = renderer.root.findByProps({ role: "dialog" });
        assert.equal(dialog.props["aria-labelledby"], "shortcuts-title");
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("the captured global handler toggles the dialog closed on a second matching event", () => {
    withPortalDom(() => {
      const renderer = mountWithPortalDom(<KeyboardShortcuts />);
      try {
        const handler = globalForHook.__keyboardShortcutsHookTestState.handler;
        assert.ok(handler);

        act(() => handler!(fakeEvent({ key: "?" })));
        assert.ok(renderer.root.findByProps({ role: "dialog" }));

        act(() => handler!(fakeEvent({ key: "?" })));
        assert.throws(() => renderer.root.findByProps({ role: "dialog" }));
      } finally {
        act(() => renderer.unmount());
      }
    });
  });
});
