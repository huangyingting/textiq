/**
 * Shared harness for direct-mounting components that render through
 * `ModalSurface`/`DrawerSurface` (`@/components/ui/overlay-stack`) —
 * `Dialog`, `Drawer`, and anything built on them (`TemplatePicker`, brand
 * delete-confirmation, etc.).
 *
 * `ModalSurface` does `if (typeof document === "undefined") return null;`
 * then unconditionally `createPortal(..., document.body)` once `document`
 * exists — regardless of the `open` prop. The shared
 * `createReactRenderHarness`/`renderWithTestRenderer` harness
 * (`@/test/react-render-harness`) installs a fake `document` with no `.body`,
 * so any Dialog-bearing component throws `"Target container is not a DOM
 * element."` the moment it mounts under that harness. Components that never
 * mount a Dialog should keep using that harness; this module is only for the
 * ones that do.
 *
 * `document.body` here is a minimal portal target (`{ nodeType: 1 }`) so
 * `createPortal` accepts it, mounted with its own `createNodeMock` — React
 * Test Renderer resolves ref mocks per portal *container*, not per primary
 * `create()` root, so refs attached inside portalled content (e.g. the
 * dialog panel's focus-trap ref) read `document.body.createNodeMock`, not
 * the outer `create()` call's `createNodeMock` option. `document.head`/
 * `getElementById` are also stubbed (no-op append / always-null lookup) so
 * `@/lib/brand/font-hooks`'s `hydrateBrandFont` — invoked incidentally by
 * `useHydrateBrandFont` whenever a brand card mounts, and directly after a
 * custom font upload — doesn't throw for lack of a real `<head>`.
 *
 * `ModalSurface`/`DrawerSurface` wrap their panel in framer-motion's
 * `AnimatePresence`/`motion.div` so it animates in/out. `AnimatePresence`
 * only unmounts an exiting child once its exit animation reports complete,
 * which framer-motion drives via successive `requestAnimationFrame` ticks
 * over real elapsed time — something no synchronous `act()` (nor even an
 * `await`-ed real-time delay, since our `requestAnimationFrame` shim below
 * only invokes its callback once) can drive to completion. Concretely: a
 * component that keeps a `<Dialog>` mounted and only toggles its `open` prop
 * (e.g. brand-studio's delete-confirmation `BrandCard`) would still show
 * `role="dialog"` in the render tree after `open` flips back to `false`,
 * because the exiting `motion.div` lingers mid-"animation" forever. (This
 * doesn't affect components like `TemplatePicker`, which always renders
 * `<Dialog open>` and instead has its *parent* conditionally mount/unmount
 * the whole subtree — destroying `AnimatePresence` itself along with it,
 * so there's no exiting child left to linger.) Rather than reimplement
 * framer-motion's animation clock, this module stubs the `"framer-motion"`
 * specifier itself (via `node:module`'s `registerHooks`, scoped to whichever
 * single test-file process imports this module) with a plain passthrough:
 * `AnimatePresence` renders its children directly, `motion.<tag>` renders a
 * plain intrinsic element with animation-only props stripped, and
 * `useReducedMotion` (re-exported by `@/components/motion/use-reduced-motion`,
 * also `ModalSurface`'s own import) returns `false` — matching this module's
 * `matchMedia` mock, which always reports `prefers-reduced-motion: reduce` as
 * not matching. This makes `open` toggling synchronous — matching what a
 * user actually sees once the (in production, ~160ms) exit animation
 * finishes — without
 * depending on framer-motion's internal timing at all.
 */
import { createRequire } from "node:module";
import type { ReactElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

// Any component that renders `next/link`'s `<Link>` (e.g. `DocumentCard`)
// mounts `useIntersection`'s prefetch-on-visible effect. Node has no global
// `IntersectionObserver`, so `next/link` falls back to
// `requestIdleCallback` — whose own fallback implementation (Node/this
// process also lacks a global `self`) references `self.setTimeout` and
// throws `ReferenceError: self is not defined` the moment that passive
// effect runs. Stubbing a real (no-op) `IntersectionObserver` here — once,
// at this module's first import, well before any component or `next/link`
// itself is dynamically imported — makes `next/link` treat intersection
// observation as supported and skip the broken fallback entirely; the stub
// never reports an intersection, so prefetch simply never fires, which is
// irrelevant to any of this repo's direct component tests.
if (typeof globalThis.IntersectionObserver === "undefined") {
  class NoopIntersectionObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  (
    globalThis as unknown as { IntersectionObserver: unknown }
  ).IntersectionObserver = NoopIntersectionObserver;
}

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

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;
const framerMotionStubUrl = "portal-dom-framer-motion:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "framer-motion") {
      return { url: framerMotionStubUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === framerMotionStubUrl) {
      return {
        format: "commonjs",
        source: `const { forwardRef, createElement } = require("react");
const MOTION_ONLY_PROPS = new Set([
  "initial", "animate", "exit", "transition", "variants", "layout",
  "layoutId", "whileHover", "whileTap", "whileFocus", "whileDrag",
  "whileInView", "drag", "dragConstraints", "dragElastic", "dragMomentum",
  "onAnimationStart", "onAnimationComplete", "onExitComplete", "custom",
  "viewport",
]);
function stripMotionProps(props) {
  const rest = {};
  for (const key of Object.keys(props)) {
    if (!MOTION_ONLY_PROPS.has(key)) rest[key] = props[key];
  }
  return rest;
}
const motion = new Proxy(
  {},
  {
    get(_target, tag) {
      return forwardRef(function MotionStub(props, ref) {
        return createElement(
          tag,
          { ref, ...stripMotionProps(props) },
          props.children,
        );
      });
    },
  },
);
function AnimatePresence(props) {
  return props.children ?? null;
}
function useReducedMotion() {
  return false;
}
module.exports = { motion, AnimatePresence, useReducedMotion };`,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** Default ref mock shared by every node mounted under the portal DOM. */
export function createPortalNodeMock() {
  return {
    focus: () => undefined,
    blur: () => undefined,
    contains: () => false,
    closest: () => null,
    querySelectorAll: () => [],
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    // `SelectMenu`/`Popover`/`Tooltip` all measure their trigger (and, for
    // `Popover`, an ancestor found via `closest`) via `getBoundingClientRect`
    // in a `useLayoutEffect` that fires as soon as they open, to position
    // their portalled panel. A zeroed rect is a valid, inert measurement —
    // it keeps that positioning math from throwing so tests can open these
    // controls and interact with their portalled options/content.
    getBoundingClientRect: () => ({
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
    offsetWidth: 0,
    style: {},
  };
}

/**
 * Installs a fake `document`/`window` (with a portal-capable `document.body`)
 * for the duration of `run`, restoring the previous globals (if any)
 * afterwards. Mount, interact with, and unmount a renderer all inside a
 * single `withPortalDom` call so `document.body` stays the same object
 * reference across the component's renders — swapping it mid-test would
 * make React treat the portal as having moved to a new container.
 *
 * `run` may be sync or async — if it returns a thenable, the previous
 * globals are restored only after that promise settles (not immediately
 * after the synchronous portion of an async function returns), so awaited
 * interactions inside `run` still see the fake DOM.
 */
// `Popover`/`ColorPicker` both drive a continuous "track position while
// open" loop: a `useLayoutEffect` calls `reposition()` once synchronously,
// then requests a frame for `trackPosition`, whose body calls `reposition()`
// again and immediately re-requests another frame — a self-perpetuating RAF
// loop, by design, so the panel keeps following its trigger during real
// scrolling/resizing. Invoking the callback synchronously (as this shim does,
// so the effect's *first* measurement is available immediately after mount)
// would recurse forever for that pattern, since each nested `requestAnimationFrame`
// call would itself synchronously invoke and re-request. `rafDepth` guards
// against that: only the outermost call actually invokes its callback: any
// call made from *within* an already-executing callback (i.e. the loop's own
// re-request) is accepted but never fired, which is enough for static test
// assertions — no test needs to simulate an in-progress scroll/resize.
let rafDepth = 0;

export function withPortalDom<T>(run: () => T): T {
  const previousDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

  const body = {
    nodeType: 1,
    children: [] as unknown[],
    style: {} as Record<string, string>,
    createNodeMock: () => createPortalNodeMock(),
  };

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    writable: true,
    value: {
      body,
      head: { appendChild: () => undefined },
      activeElement: createPortalNodeMock(),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      createElement: () => createPortalNodeMock(),
      getElementById: () => null,
      querySelector: () => null,
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      matchMedia: () => ({
        matches: false,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        if (rafDepth > 0) {
          return 0;
        }
        rafDepth++;
        try {
          callback(0);
        } finally {
          rafDepth--;
        }
        return 0;
      },
      cancelAnimationFrame: () => undefined,
    },
  });

  function restore(): void {
    if (previousDocument) {
      Object.defineProperty(globalThis, "document", previousDocument);
    } else {
      Reflect.deleteProperty(globalThis, "document");
    }
    if (previousWindow) {
      Object.defineProperty(globalThis, "window", previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }

  let result: T;
  try {
    result = run();
  } catch (error) {
    restore();
    throw error;
  }
  if (result instanceof Promise) {
    return result.then(
      (value) => {
        restore();
        return value;
      },
      (error: unknown) => {
        restore();
        throw error;
      },
    ) as T;
  }
  restore();
  return result;
}

/**
 * Mounts `element`, wrapped in `act`. Must be called from *inside* a
 * {@link withPortalDom} callback (it reuses whatever `document`/`window` are
 * currently installed rather than installing its own, so a single
 * `document.body` reference stays the portal container for the mount,
 * every interaction, and the eventual unmount).
 */
export function mountWithPortalDom(element: ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(element, {
      createNodeMock: () => createPortalNodeMock(),
    });
  });
  return renderer;
}
