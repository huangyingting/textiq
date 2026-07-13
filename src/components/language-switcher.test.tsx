/**
 * Direct contract coverage for `LanguageSwitcher` (issue #1962) — the
 * header locale menu.
 *
 * `@/lib/i18n/locale-context` (the `setLocaleOptimistic` + `startTransition`
 * composition it wraps) is already deeply covered by
 * `src/lib/i18n/locale-context.test.tsx`, so this stubs that module — plus
 * the sibling `@/lib/i18n/actions` server action and `next/navigation`'s
 * `useRouter` — via `node:module`'s `registerHooks` (same pattern used by
 * `src/app/app/import-document-button.test.tsx`), rather than re-testing
 * React's `useOptimistic`/transition settling semantics. This isolates the
 * component's own click/menu/ordering logic.
 *
 * The stubbed `useLocale`/`useSetLocaleOptimistic` pair is backed by a real
 * `useSyncExternalStore` so that calling the returned setter actually
 * re-renders the mounted tree with the new locale (mirroring the real
 * hook's optimistic-update contract) without depending on React's own
 * `useOptimistic` implementation.
 *
 * `LanguageSwitcher` renders no Tooltip/Dialog/portal content, so it is
 * mounted directly with `react-test-renderer` (no `document`/`window`
 * globals needed) — same approach as `import-document-button.test.tsx`.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";
import { Component, createElement, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";

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

type Locale = "en" | "es";

type LanguageSwitcherTestState = {
  calls: unknown[][];
  translations: Record<string, string>;
  routerRefreshCount: number;
  setLocaleCookieImpl: (next: Locale) => Promise<void>;
};

const globalForTest = globalThis as typeof globalThis & {
  __languageSwitcherTestState: LanguageSwitcherTestState;
};

function resetState(): void {
  globalForTest.__languageSwitcherTestState = {
    calls: [],
    translations: {
      "languageSwitcher.label": "Language",
      "languageSwitcher.selectLanguage": "Select language",
    },
    routerRefreshCount: 0,
    setLocaleCookieImpl: async () => {},
  };
}
resetState();

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

// Opaque (non-`file://`) scheme strings work as stub URLs as long as the
// stub source needs no further module resolution of its own — the
// locale-context stub below reaches `useSyncExternalStore` via a global set
// by this file (rather than a nested `import "react"`) specifically to
// avoid that, since `next/navigation`/`@/lib/i18n/actions` are required
// through `language-switcher.tsx`'s CJS-interop require() chain (via tsx's
// TS->CJS transform), which bypasses `registerHooks`' ESM-only resolution
// for any further nested imports inside a stub's own source.
const localeContextStubUrl = "language-switcher-locale-context:test";
const actionsStubUrl = "language-switcher-actions:test";
const navigationStubUrl = "language-switcher-navigation:test";

(
  globalThis as typeof globalThis & {
    __languageSwitcherReact?: { useSyncExternalStore: unknown };
  }
).__languageSwitcherReact = { useSyncExternalStore };

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/i18n/locale-context") {
      return { url: localeContextStubUrl, shortCircuit: true };
    }
    if (specifier === "@/lib/i18n/actions") {
      return { url: actionsStubUrl, shortCircuit: true };
    }
    if (specifier === "next/navigation") {
      return { url: navigationStubUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === localeContextStubUrl) {
      return {
        format: "commonjs",
        source: `
const { useSyncExternalStore } = globalThis.__languageSwitcherReact;
const listeners = new Set();
let currentLocale = "en";
function subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb); }
function getSnapshot() { return currentLocale; }
function notify() { for (const cb of listeners) cb(); }
module.exports = {
  __setLocale(value) { currentLocale = value; notify(); },
  useLocale() { return useSyncExternalStore(subscribe, getSnapshot, getSnapshot); },
  useSetLocaleOptimistic() {
    return (next) => {
      globalThis.__languageSwitcherTestState.calls.push(["setLocaleOptimistic", next]);
      currentLocale = next;
      notify();
    };
  },
  useTranslation() {
    return (key) => globalThis.__languageSwitcherTestState.translations[key] ?? key;
  },
};
`,
        shortCircuit: true,
      };
    }
    if (url === actionsStubUrl) {
      return {
        format: "module",
        source: `
export async function setLocaleCookie(next) {
  globalThis.__languageSwitcherTestState.calls.push(["setLocaleCookie", next]);
  return globalThis.__languageSwitcherTestState.setLocaleCookieImpl(next);
}
`,
        shortCircuit: true,
      };
    }
    if (url === navigationStubUrl) {
      return {
        format: "module",
        source: `
export function useRouter() {
  return {
    refresh() {
      globalThis.__languageSwitcherTestState.calls.push(["router.refresh"]);
      globalThis.__languageSwitcherTestState.routerRefreshCount += 1;
    },
  };
}
`,
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
    (message.startsWith("react-test-renderer is deprecated") ||
      message.startsWith("An error occurred in the") ||
      message.startsWith("React will try to recreate"))
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

type LocaleContextStub = {
  __setLocale(value: Locale): void;
};
type SwitcherModule = typeof import("./language-switcher");

let LanguageSwitcher: SwitcherModule["LanguageSwitcher"];
let setLocale: LocaleContextStub["__setLocale"];

before(async () => {
  const [switcherMod, localeMod] = await Promise.all([
    import("./language-switcher"),
    // `registerHooks` above redirects this specifier's runtime resolution to
    // the CommonJS stub source (which shapes `__setLocale`), but TypeScript
    // still sees the real `@/lib/i18n/locale-context` module's type here —
    // hence the `unknown` bridge before asserting the stub's actual shape.
    import("@/lib/i18n/locale-context") as unknown as Promise<LocaleContextStub>,
  ]);
  LanguageSwitcher = switcherMod.LanguageSwitcher;
  setLocale = localeMod.__setLocale;
});

beforeEach(() => {
  resetState();
  setLocale("en");
});

function waitForAsyncDrain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function state(): LanguageSwitcherTestState {
  return globalForTest.__languageSwitcherTestState;
}

function mount(): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(createElement(LanguageSwitcher));
  });
  return renderer;
}

type ErrorBoundaryProps = {
  onError: (error: unknown) => void;
  children?: ReactNode;
};
type ErrorBoundaryState = { hasError: boolean };

// `switchTo` has no try/catch around `await setLocaleCookie(next)`. Since
// React 19 routes an async transition's uncaught rejection to the nearest
// Error Boundary (there is none in production, which is itself a real gap
// this test surfaces — see PR notes), mounting behind a minimal boundary
// here lets the failure be captured deterministically via
// `componentDidCatch` rather than relying on global/process-level error
// reporting timing.
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

function mountWithBoundary(
  onError: (error: unknown) => void,
): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      createElement(
        ErrorBoundary,
        { onError },
        createElement(LanguageSwitcher),
      ),
    );
  });
  return renderer;
}

function trigger(renderer: ReactTestRenderer): ReactTestInstance {
  return renderer.root.findAll(
    (node) =>
      node.type === "button" && node.props["aria-haspopup"] === "listbox",
  )[0];
}

function listbox(renderer: ReactTestRenderer): ReactTestInstance | undefined {
  return renderer.root.findAll((node) => node.type === "ul").at(0);
}

function options(renderer: ReactTestRenderer): ReactTestInstance[] {
  return renderer.root.findAll((node) => node.props.role === "option");
}

function optionButton(option: ReactTestInstance): ReactTestInstance {
  return option.findByType("button");
}

describe("LanguageSwitcher", () => {
  test("renders current locale and a closed menu by default", () => {
    const renderer = mount();
    const btn = trigger(renderer);
    assert.equal(btn.props["aria-expanded"], false);
    assert.equal(btn.props["aria-label"], "Language: English");
    const label = btn.findAll((node) => node.type === "span")[0];
    assert.equal(label.children.join(""), "EN");
    assert.equal(listbox(renderer), undefined);
    act(() => renderer.unmount());
  });

  test("clicking the trigger opens a listbox with all supported locales", () => {
    const renderer = mount();
    act(() => trigger(renderer).props.onClick());

    const menu = listbox(renderer);
    assert.ok(menu, "expected listbox to render when open");
    assert.equal(menu?.props["aria-label"], "Select language");
    assert.equal(trigger(renderer).props["aria-expanded"], true);

    const opts = options(renderer);
    assert.equal(opts.length, 2);
    assert.deepEqual(
      opts.map((o) => o.props["aria-selected"]),
      [true, false],
    );

    // English (selected) option shows a checkmark svg; Spanish does not.
    assert.equal(optionButton(opts[0]).findAllByType("svg").length, 1);
    assert.equal(optionButton(opts[1]).findAllByType("svg").length, 0);
    act(() => renderer.unmount());
  });

  test("selecting the current locale is a no-op that just closes the menu", () => {
    const renderer = mount();
    act(() => trigger(renderer).props.onClick());
    const [currentOption] = options(renderer);
    act(() => optionButton(currentOption).props.onClick());

    assert.deepEqual(state().calls, []);
    assert.equal(listbox(renderer), undefined);
    act(() => renderer.unmount());
  });

  test("selecting a different locale updates optimistically, closes the menu, then persists and refreshes", async () => {
    let resolveCookie!: () => void;
    state().setLocaleCookieImpl = () =>
      new Promise((resolve) => {
        resolveCookie = resolve;
      });

    const renderer = mount();
    act(() => trigger(renderer).props.onClick());
    const spanish = options(renderer)[1];
    act(() => optionButton(spanish).props.onClick());

    // Optimistic update + menu close happen synchronously.
    assert.equal(
      trigger(renderer)
        .findAll((n) => n.type === "span")[0]
        .children.join(""),
      "ES",
    );
    assert.equal(listbox(renderer), undefined);
    assert.deepEqual(state().calls, [
      ["setLocaleOptimistic", "es"],
      ["setLocaleCookie", "es"],
    ]);
    assert.equal(state().routerRefreshCount, 0);

    resolveCookie();
    await act(async () => {
      await waitForAsyncDrain();
    });

    assert.equal(state().routerRefreshCount, 1);
    assert.deepEqual(state().calls.at(-1), ["router.refresh"]);
    act(() => renderer.unmount());
  });

  test("when setLocaleCookie rejects, router.refresh is never called", async () => {
    // `switchTo` has no try/catch around `await setLocaleCookie(next)`, so a
    // rejection here is genuinely unhandled in production too. React 19
    // routes an async transition's uncaught rejection to the nearest Error
    // Boundary, so mounting behind `ErrorBoundary` (test-only wrapper)
    // captures it deterministically via `componentDidCatch`, alongside the
    // one behavior this component actually guarantees: a failed persist
    // never reaches `router.refresh()`.
    state().setLocaleCookieImpl = () =>
      Promise.reject(new Error("network down"));

    let capturedError: unknown;
    const renderer = mountWithBoundary((error) => {
      capturedError = error;
    });
    act(() => trigger(renderer).props.onClick());
    const spanish = options(renderer)[1];

    await act(async () => {
      optionButton(spanish).props.onClick();
      await waitForAsyncDrain();
      await waitForAsyncDrain();
    });

    assert.ok(capturedError, "expected the failed persist to be reported");
    assert.match(
      String((capturedError as Error)?.message ?? capturedError),
      /network down/,
    );
    assert.equal(state().routerRefreshCount, 0);
    assert.ok(
      state().calls.some((call) => call[0] === "setLocaleCookie"),
      "expected setLocaleCookie to still have been invoked",
    );
    act(() => renderer.unmount());
  });

  test("clicking the outside-click backdrop closes the menu", () => {
    const renderer = mount();
    act(() => trigger(renderer).props.onClick());
    const backdrop = renderer.root.findAll(
      (node) => node.type === "div" && node.props["aria-hidden"] === "true",
    )[0];
    act(() => backdrop.props.onClick());
    assert.equal(listbox(renderer), undefined);
    act(() => renderer.unmount());
  });

  test("uses real button/listbox/option semantics for keyboard operability", () => {
    const renderer = mount();
    assert.equal(trigger(renderer).type, "button");
    assert.equal(trigger(renderer).props.type, "button");
    act(() => trigger(renderer).props.onClick());
    const menu = listbox(renderer);
    assert.equal(menu?.type, "ul");
    assert.equal(menu?.props.role, "listbox");
    for (const option of options(renderer)) {
      assert.equal(option.props.role, "option");
      const btn = optionButton(option);
      assert.equal(btn.type, "button");
      assert.equal(btn.props.type, "button");
    }
    act(() => renderer.unmount());
  });
});
