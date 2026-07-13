/**
 * Direct behavior coverage for `MobileViewportSync` (#1964) — the client
 * component that mirrors the layout/visual viewport into CSS custom
 * properties on `document.documentElement`, so mobile browser chrome
 * (address bar collapse, on-screen keyboard) doesn't clip fixed-position UI.
 *
 * `resolveMobileViewportSize`/`mobileViewportCssVars` (the pure size
 * resolution + CSS var serialization) are already exhaustively covered by
 * `src/lib/mobile-viewport.test.ts`; this file only asserts the effect
 * wiring `MobileViewportSync` itself owns: CSS vars are applied on mount,
 * `resize`/`orientationchange`/`visualViewport` `resize`/`scroll` listeners
 * are registered while mounted and fully removed on unmount (no leaks), a
 * later dispatch of any of those events re-applies the vars from the
 * *current* window/visualViewport state, and the component degrades cleanly
 * when `window.visualViewport` is absent (falls back to `innerWidth`/
 * `innerHeight`, and never calls `.addEventListener` on the missing object).
 *
 * Uses the shared `@/test/browser-globals` installer to swap in a fake
 * `window`/`document` and `@/test/event-target-double`'s trackable listener
 * registry (real `Map<type, Set<handler>>`-backed `addEventListener`/
 * `removeEventListener`/`dispatchEvent`/`listenerCount`) for `window` and
 * `window.visualViewport` — `@/test/portal-dom`'s fake `document` isn't used
 * here since its listener methods are deliberate no-ops and this component
 * renders no portal content at all.
 */
import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { createElement } from "react";

import { createBrowserGlobalInstaller } from "@/test/browser-globals";
import { createTrackedEventTarget } from "@/test/event-target-double";

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

let MobileViewportSync: typeof import("./mobile-viewport-sync").MobileViewportSync;
before(async () => {
  MobileViewportSync = (await import("./mobile-viewport-sync"))
    .MobileViewportSync;
});

interface FakeVisualViewport {
  width: number;
  height: number;
  offsetTop: number;
  offsetLeft: number;
  target: ReturnType<typeof createTrackedEventTarget>;
  addEventListener: ReturnType<
    typeof createTrackedEventTarget
  >["addEventListener"];
  removeEventListener: ReturnType<
    typeof createTrackedEventTarget
  >["removeEventListener"];
}

function createFakeVisualViewport(
  size: Partial<
    Pick<FakeVisualViewport, "width" | "height" | "offsetTop" | "offsetLeft">
  > = {},
): FakeVisualViewport {
  const target = createTrackedEventTarget();
  return {
    width: size.width ?? 375,
    height: size.height ?? 600,
    offsetTop: size.offsetTop ?? 0,
    offsetLeft: size.offsetLeft ?? 0,
    target,
    addEventListener: target.addEventListener,
    removeEventListener: target.removeEventListener,
  };
}

function setupDom(options: { withVisualViewport?: boolean } = {}) {
  const installer = createBrowserGlobalInstaller(["window", "document"]);
  const windowTarget = createTrackedEventTarget();
  const styleCalls: Array<[string, string]> = [];
  const visualViewport =
    options.withVisualViewport === false
      ? undefined
      : createFakeVisualViewport();

  const fakeWindow = {
    innerWidth: 390,
    innerHeight: 844,
    visualViewport,
    addEventListener: windowTarget.addEventListener,
    removeEventListener: windowTarget.removeEventListener,
  };
  const fakeDocument = {
    documentElement: {
      style: {
        setProperty(name: string, value: string) {
          styleCalls.push([name, value]);
        },
      },
    },
  };

  installer.define("window", fakeWindow);
  installer.define("document", fakeDocument);

  return { installer, windowTarget, styleCalls, fakeWindow, visualViewport };
}

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function mount(dom: ReturnType<typeof setupDom>): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(createElement(MobileViewportSync));
  });
  cleanup = () => {
    act(() => renderer.unmount());
    dom.installer.restore();
  };
  return renderer;
}

function latestValueFor(
  styleCalls: Array<[string, string]>,
  name: string,
): string | undefined {
  for (let i = styleCalls.length - 1; i >= 0; i--) {
    if (styleCalls[i][0] === name) return styleCalls[i][1];
  }
  return undefined;
}

test("applies all four viewport CSS vars from visualViewport immediately on mount", () => {
  const dom = setupDom();
  mount(dom);

  assert.equal(latestValueFor(dom.styleCalls, "--tiq-viewport-width"), "375px");
  assert.equal(
    latestValueFor(dom.styleCalls, "--tiq-viewport-height"),
    "600px",
  );
  assert.equal(
    latestValueFor(dom.styleCalls, "--tiq-viewport-offset-top"),
    "0px",
  );
  assert.equal(
    latestValueFor(dom.styleCalls, "--tiq-viewport-offset-left"),
    "0px",
  );
});

test("registers window resize/orientationchange and visualViewport resize/scroll listeners on mount", () => {
  const dom = setupDom();
  mount(dom);

  assert.equal(dom.windowTarget.listenerCount("resize"), 1);
  assert.equal(dom.windowTarget.listenerCount("orientationchange"), 1);
  assert.equal(dom.visualViewport?.target.listenerCount("resize"), 1);
  assert.equal(dom.visualViewport?.target.listenerCount("scroll"), 1);
});

test("removes every registered listener on unmount (no leaks)", () => {
  const dom = setupDom();
  const renderer = mount(dom);

  act(() => renderer.unmount());

  assert.equal(dom.windowTarget.listenerCount("resize"), 0);
  assert.equal(dom.windowTarget.listenerCount("orientationchange"), 0);
  assert.equal(dom.visualViewport?.target.listenerCount("resize"), 0);
  assert.equal(dom.visualViewport?.target.listenerCount("scroll"), 0);

  cleanup = () => dom.installer.restore();
});

test("a window resize event re-applies CSS vars using the current visualViewport size", () => {
  const dom = setupDom();
  mount(dom);
  dom.styleCalls.length = 0;

  if (dom.visualViewport) {
    dom.visualViewport.width = 414;
    dom.visualViewport.height = 700;
    dom.visualViewport.offsetTop = 40;
  }
  act(() => {
    dom.windowTarget.dispatchEvent({ type: "resize" });
  });

  assert.equal(latestValueFor(dom.styleCalls, "--tiq-viewport-width"), "414px");
  assert.equal(
    latestValueFor(dom.styleCalls, "--tiq-viewport-height"),
    "700px",
  );
  assert.equal(
    latestValueFor(dom.styleCalls, "--tiq-viewport-offset-top"),
    "40px",
  );
});

test("an orientationchange event also re-applies the CSS vars", () => {
  const dom = setupDom();
  mount(dom);
  dom.styleCalls.length = 0;

  act(() => {
    dom.windowTarget.dispatchEvent({ type: "orientationchange" });
  });

  assert.equal(latestValueFor(dom.styleCalls, "--tiq-viewport-width"), "375px");
});

test("a visualViewport resize event re-applies the CSS vars", () => {
  const dom = setupDom();
  mount(dom);
  dom.styleCalls.length = 0;
  if (dom.visualViewport) dom.visualViewport.width = 320;

  act(() => {
    dom.visualViewport?.target.dispatchEvent({ type: "resize" });
  });

  assert.equal(latestValueFor(dom.styleCalls, "--tiq-viewport-width"), "320px");
});

test("a visualViewport scroll event re-applies the CSS vars", () => {
  const dom = setupDom();
  mount(dom);
  dom.styleCalls.length = 0;
  if (dom.visualViewport) dom.visualViewport.offsetLeft = 12;

  act(() => {
    dom.visualViewport?.target.dispatchEvent({ type: "scroll" });
  });

  assert.equal(
    latestValueFor(dom.styleCalls, "--tiq-viewport-offset-left"),
    "12px",
  );
});

test("falls back to innerWidth/innerHeight and never touches visualViewport when it is absent", () => {
  const dom = setupDom({ withVisualViewport: false });
  mount(dom);

  assert.equal(latestValueFor(dom.styleCalls, "--tiq-viewport-width"), "390px");
  assert.equal(
    latestValueFor(dom.styleCalls, "--tiq-viewport-height"),
    "844px",
  );
  // No visualViewport object exists at all in this scenario; the component
  // must have guarded every access with `?.` rather than throwing.
  assert.equal(dom.fakeWindow.visualViewport, undefined);
});
