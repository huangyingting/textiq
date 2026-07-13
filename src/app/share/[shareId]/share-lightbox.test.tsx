/**
 * Direct interactive-DOM coverage for `ShareLightbox` (#1960).
 *
 * `ShareLightbox` portals into `document.body`, queries the DOM
 * (`querySelectorAll`, `closest`), and manages real focus — none of which
 * `react-test-renderer` can provide (it has no real `document`). This test
 * instead runs the component inside a real DOM supplied by `happy-dom`
 * (already a transitive dependency via `@lexical/headless`, and already
 * relied on directly from `src/components/presentation/
 * inline-text-dom-adapter.test.ts`), driven by `react-dom/client`'s
 * `createRoot` and React 19's built-in `act` (imported from `"react"`).
 * `window.matchMedia` is polyfilled to report `prefers-reduced-motion:
 * reduce` so `framer-motion`'s `useReducedMotion()` (via `usePopMotion`)
 * takes the `NO_MOTION` branch and every transition resolves to its final
 * state instantly — this matches the existing reduced-motion-for-
 * determinism convention (see `present-hud-reduced-motion-render.test.ts`)
 * and avoids racing framer-motion's animation frames.
 *
 * Coverage: SVG-visual enhancement (data-zoomable/tabindex/cursor); opening
 * via click and via Enter/Space keyboard activation; the enlarged-overlay's
 * dialog/aria-label/cloned-image wiring for multiple distinctly labelled
 * images (plus the "Visual" fallback label); closing via the close button,
 * Escape, and an outside backdrop mousedown (with a same-panel mousedown
 * correctly NOT closing it); the Tab focus trap pulling focus back into the
 * panel; body-scroll-lock toggling while open; and focus restoration to the
 * originating trigger on close.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { ShareLightbox } from "./share-lightbox";

const GLOBAL_KEYS = [
  "window",
  "document",
  "navigator",
  "Node",
  "Element",
  "HTMLElement",
  "HTMLButtonElement",
  "SVGElement",
  "SVGSVGElement",
  "MouseEvent",
  "KeyboardEvent",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "matchMedia",
  "IS_REACT_ACT_ENVIRONMENT",
] as const;

let happyWindow: Window;
let previousGlobals: Map<string, PropertyDescriptor | undefined>;
let container: HTMLDivElement;
let root: Root | null = null;

function reducedMotionMatchMedia(query: string) {
  return {
    matches: true,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
    onchange: null,
  };
}

beforeEach(() => {
  happyWindow = new Window({ url: "https://textiq.test/share/abc" });
  previousGlobals = new Map(
    GLOBAL_KEYS.map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );

  const globalValues: Record<string, unknown> = {
    window: happyWindow,
    document: happyWindow.document,
    navigator: happyWindow.navigator,
    Node: happyWindow.Node,
    Element: happyWindow.Element,
    HTMLElement: happyWindow.HTMLElement,
    HTMLButtonElement: happyWindow.HTMLButtonElement,
    SVGElement: happyWindow.SVGElement,
    SVGSVGElement: happyWindow.SVGSVGElement,
    MouseEvent: happyWindow.MouseEvent,
    KeyboardEvent: happyWindow.KeyboardEvent,
    requestAnimationFrame: (cb: FrameRequestCallback) =>
      setTimeout(() => cb(Date.now()), 0) as unknown as number,
    cancelAnimationFrame: (id: number) => clearTimeout(id),
    matchMedia: reducedMotionMatchMedia,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [key, value] of Object.entries(globalValues)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  (
    happyWindow as unknown as { matchMedia: typeof reducedMotionMatchMedia }
  ).matchMedia = reducedMotionMatchMedia;

  container = happyWindow.document.createElement(
    "div",
  ) as unknown as HTMLDivElement;
  happyWindow.document.body.appendChild(container as never);
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
    root = null;
  }
  for (const key of GLOBAL_KEYS) {
    const descriptor = previousGlobals.get(key);
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, key);
    }
  }
  happyWindow.close();
});

function doc(): Document {
  return happyWindow.document as unknown as Document;
}

function mount(children: ReturnType<typeof createElement>) {
  root = createRoot(container);
  act(() => {
    root?.render(createElement(ShareLightbox, null, children));
  });
}

function buildVisuals() {
  return createElement(
    "div",
    null,
    createElement("svg", {
      role: "img",
      "aria-label": "Revenue chart",
      "data-testid": "chart-a",
    }),
    createElement("svg", {
      role: "img",
      "aria-label": "Growth chart",
      "data-testid": "chart-b",
    }),
    createElement("svg", { role: "img", "data-testid": "chart-unlabelled" }),
  );
}

function svgByTestId(testId: string): SVGSVGElement {
  const el = doc().querySelector(`[data-testid="${testId}"]`);
  assert.ok(el, `expected to find svg with data-testid="${testId}"`);
  return el as unknown as SVGSVGElement;
}

function dialogElement(): HTMLElement | null {
  return doc().querySelector('[role="dialog"]') as HTMLElement | null;
}

function closeButton(): HTMLButtonElement {
  const dialog = dialogElement();
  assert.ok(dialog, "expected the overlay dialog to be open");
  const button = dialog?.querySelector("button");
  assert.ok(button, "expected a close button inside the dialog");
  return button as unknown as HTMLButtonElement;
}

function clickOn(el: Element) {
  act(() => {
    (el as unknown as HTMLElement).dispatchEvent(
      new happyWindow.MouseEvent("click", {
        bubbles: true,
      }) as unknown as Event,
    );
  });
}

function mouseDownOn(el: Element) {
  act(() => {
    (el as unknown as HTMLElement).dispatchEvent(
      new happyWindow.MouseEvent("mousedown", {
        bubbles: true,
      }) as unknown as Event,
    );
  });
}

function keyDownOn(el: Element, key: string, shiftKey = false) {
  act(() => {
    (el as unknown as HTMLElement).dispatchEvent(
      new happyWindow.KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        shiftKey,
      }) as unknown as Event,
    );
  });
}

describe("ShareLightbox", () => {
  it("enhances every rendered svg[role=img] into a zoomable, keyboard-focusable trigger", () => {
    mount(buildVisuals());

    const chartA = svgByTestId("chart-a");
    assert.equal(chartA.dataset.zoomable, "true");
    assert.equal(chartA.getAttribute("tabindex"), "0");
    assert.equal((chartA as unknown as HTMLElement).style.cursor, "zoom-in");
  });

  it("opens the enlarged overlay on click, showing a dialog labelled from the svg's aria-label", () => {
    mount(buildVisuals());
    const chartA = svgByTestId("chart-a");

    clickOn(chartA);

    const dialog = dialogElement();
    assert.ok(dialog);
    assert.equal(dialog?.getAttribute("aria-modal"), "true");
    assert.equal(
      dialog?.getAttribute("aria-label"),
      "Revenue chart — enlarged",
    );
  });

  it("falls back to a generic 'Visual' label when the svg has no aria-label", () => {
    mount(buildVisuals());
    const unlabelled = svgByTestId("chart-unlabelled");

    clickOn(unlabelled);

    assert.equal(
      dialogElement()?.getAttribute("aria-label"),
      "Visual — enlarged",
    );
  });

  it("clones the clicked svg (not the original) into the overlay's image host", () => {
    mount(buildVisuals());
    const chartB = svgByTestId("chart-b");

    clickOn(chartB);

    const dialog = dialogElement();
    const clonedSvg = dialog?.querySelector('div[aria-hidden="true"] svg');
    assert.ok(clonedSvg, "expected a cloned svg inside the image host");
    assert.notEqual(clonedSvg, chartB);
    assert.equal(clonedSvg?.hasAttribute("data-zoomable"), false);
    assert.equal(clonedSvg?.hasAttribute("tabindex"), false);
  });

  it("opens via Enter and Space keyboard activation, not just click", () => {
    mount(buildVisuals());
    const chartA = svgByTestId("chart-a");

    keyDownOn(chartA, "Enter");
    assert.ok(dialogElement(), "Enter should open the overlay");

    clickOn(closeButton());
    assert.equal(dialogElement(), null);

    keyDownOn(chartA, " ");
    assert.ok(dialogElement(), "Space should open the overlay");
  });

  it("locks body scroll while open and restores it on close", () => {
    mount(buildVisuals());
    const previousOverflow = doc().body.style.overflow;
    const chartA = svgByTestId("chart-a");

    clickOn(chartA);
    assert.equal(doc().body.style.overflow, "hidden");

    clickOn(closeButton());
    assert.equal(doc().body.style.overflow, previousOverflow);
  });

  it("auto-focuses the close button on open and restores focus to the trigger on close", () => {
    mount(buildVisuals());
    const chartA = svgByTestId("chart-a");
    (chartA as unknown as HTMLElement).focus();

    clickOn(chartA);
    assert.equal(doc().activeElement, closeButton());

    clickOn(closeButton());
    assert.equal(dialogElement(), null);
    assert.equal(doc().activeElement, chartA);
  });

  it("closes on Escape", () => {
    mount(buildVisuals());
    clickOn(svgByTestId("chart-a"));
    assert.ok(dialogElement());

    keyDownOn(dialogElement()!, "Escape");
    assert.equal(dialogElement(), null);
  });

  it("closes on an outside backdrop mousedown, but not on a mousedown inside the panel", () => {
    mount(buildVisuals());
    clickOn(svgByTestId("chart-a"));
    const dialog = dialogElement();
    assert.ok(dialog);

    mouseDownOn(dialog!);
    assert.ok(
      dialogElement(),
      "a mousedown inside the panel must not close it",
    );

    const backdrop = dialog?.parentElement;
    assert.ok(backdrop);
    mouseDownOn(backdrop!);
    assert.equal(
      dialogElement(),
      null,
      "a mousedown outside the panel must close it",
    );
  });

  it("traps Tab focus inside the panel, pulling focus back in if it escapes", () => {
    mount(buildVisuals());
    clickOn(svgByTestId("chart-a"));
    const dialog = dialogElement()!;
    const button = closeButton();
    assert.equal(doc().activeElement, button);

    (doc().body as unknown as HTMLElement).focus();
    assert.notEqual(doc().activeElement, button);

    keyDownOn(dialog, "Tab");
    assert.equal(
      doc().activeElement,
      button,
      "Tab should pull focus back into the panel when it left",
    );

    keyDownOn(dialog, "Tab", true);
    assert.equal(
      doc().activeElement,
      button,
      "Shift+Tab wraps to the last focusable",
    );
  });

  it("supports opening a second, differently labelled image after closing the first", () => {
    mount(buildVisuals());

    clickOn(svgByTestId("chart-a"));
    assert.equal(
      dialogElement()?.getAttribute("aria-label"),
      "Revenue chart — enlarged",
    );
    clickOn(closeButton());
    assert.equal(dialogElement(), null);

    clickOn(svgByTestId("chart-b"));
    assert.equal(
      dialogElement()?.getAttribute("aria-label"),
      "Growth chart — enlarged",
    );
  });
});
