import { createElement, isValidElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import {
  captureOwnPropertyDescriptors,
  restoreOwnPropertyDescriptors,
} from "@/test/global-property-descriptors";

export type ServerRenderHarnessOptions = {
  firstRefCurrent?: unknown;
  idPrefix?: string;
  message?: string;
  preferServerSnapshot?: boolean;
  requireInternals?: boolean;
  runEffects?: boolean;
  runInsertionEffects?: boolean;
  runLayoutEffects?: boolean;
};

type ProbeProps<T> = {
  render: () => T;
  renderResult?: boolean;
  onResult: (value: T) => void;
};

function createDefaultNodeMock() {
  return {
    addEventListener: () => undefined,
    blur: () => undefined,
    contains: () => false,
    focus: () => undefined,
    getBoundingClientRect: () => ({
      bottom: 0,
      height: 0,
      left: 0,
      right: 0,
      top: 0,
      width: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
    innerHTML: "",
    querySelectorAll: () => [],
    removeEventListener: () => undefined,
    style: {},
  };
}

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const [message] = args;
  if (
    typeof message === "string" &&
    (message.startsWith("react-test-renderer is deprecated") ||
      message.includes("was not wrapped in act(...)") ||
      message.startsWith("An invalid container has been provided."))
  ) {
    return;
  }
  originalConsoleError(...args);
};

const DEFAULT_DOM_GLOBAL_KEYS = ["document", "window"] as const;

/** The `document` stub `withDefaultDom` installs when none already exists. */
export function createDefaultFakeDocument() {
  return {
    activeElement: { focus: () => undefined },
    addEventListener: () => undefined,
    createElement: () => createDefaultNodeMock(),
    dispatchEvent: () => true,
    querySelector: () => null,
    removeEventListener: () => undefined,
  };
}

/** The `window` stub `withDefaultDom` installs when none already exists. */
export function createDefaultFakeWindow() {
  return {
    addEventListener: () => undefined,
    getSelection: () => null,
    matchMedia: () => ({
      addEventListener: () => undefined,
      matches: false,
      removeEventListener: () => undefined,
    }),
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    },
    cancelAnimationFrame: () => undefined,
    removeEventListener: () => undefined,
  };
}

/**
 * Installs the default fake `document`/`window` permanently — i.e. without
 * `withDefaultDom`'s per-call teardown — for test files whose tests rely on
 * directly monkey-patching `globalThis.document`/`globalThis.window` across
 * the whole file rather than scoping a fake DOM to one call. A no-op for
 * whichever of `document`/`window` already exists.
 */
export function installPersistentDefaultDom(): void {
  if (!("document" in globalThis)) {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      writable: true,
      value: createDefaultFakeDocument(),
    });
  }
  if (!("window" in globalThis)) {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      writable: true,
      value: createDefaultFakeWindow(),
    });
  }
}

/**
 * Installs a fake `document`/`window` for the duration of `callback`,
 * restoring the previous globals afterwards — reinstalling their exact
 * descriptors when they pre-existed, or deleting the temporary properties
 * entirely when they didn't (so a fake `document`/`window` never leaks into
 * later tests just because none existed yet). `callback` may be sync or
 * async: if it returns a thenable, the previous globals are restored only
 * after that promise settles, whether it resolves or rejects, so awaited
 * work inside `callback` still sees the fake DOM.
 */
export function withDefaultDom<T>(callback: () => T): T {
  const previous = captureOwnPropertyDescriptors(
    globalThis,
    DEFAULT_DOM_GLOBAL_KEYS,
  );
  if (!previous.get("document")) {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      writable: true,
      value: createDefaultFakeDocument(),
    });
  }
  if (!previous.get("window")) {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      writable: true,
      value: createDefaultFakeWindow(),
    });
  }

  function restore(): void {
    restoreOwnPropertyDescriptors(globalThis, previous);
  }

  let result: T;
  try {
    result = callback();
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

function Probe<T>({ render, renderResult = false, onResult }: ProbeProps<T>) {
  const result = render();
  onResult(result);
  if (!renderResult) return null;
  if (
    result == null ||
    typeof result === "boolean" ||
    typeof result === "string" ||
    typeof result === "number" ||
    isValidElement(result) ||
    Array.isArray(result)
  ) {
    return result as ReactNode;
  }
  return null;
}

function runInAct<T>(callback: () => T): T {
  let result: T | undefined;
  withDefaultDom(() => {
    act(() => {
      result = callback();
    });
  });
  return result as T;
}

export function renderWithTestRenderer<T>(render: () => T): T {
  let result: T | undefined;
  let renderer: ReactTestRenderer | null = null;
  act(() => {
    renderer = create(
      createElement(Probe<T>, {
        render,
        renderResult: true,
        onResult: (value) => {
          result = value;
        },
      }),
    );
  });
  act(() => {
    renderer?.unmount();
  });
  return result as T;
}

export function createReactRenderHarness(
  options: ServerRenderHarnessOptions = {},
) {
  let renderer: ReactTestRenderer | null = null;
  let refMockUsed = false;

  return {
    run<T>(render: () => T): T {
      let result: T | undefined;
      const element = createElement(Probe<T>, {
        render,
        renderResult: false,
        onResult: (value) => {
          result = value;
        },
      });
      runInAct(() => {
        if (renderer) {
          renderer.update(element);
          return;
        }
        renderer = create(element, {
          createNodeMock: () => {
            if (!refMockUsed && options.firstRefCurrent !== undefined) {
              refMockUsed = true;
              return options.firstRefCurrent;
            }
            return createDefaultNodeMock();
          },
        });
      });
      return result as T;
    },
    cleanup(): void {
      if (!renderer) return;
      runInAct(() => {
        renderer?.unmount();
        renderer = null;
      });
    },
  };
}
