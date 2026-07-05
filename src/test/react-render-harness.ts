import { createElement, isValidElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

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

function withDefaultDom<T>(callback: () => T): T {
  const previousDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const fakeDocument = {
    activeElement: { focus: () => undefined },
    addEventListener: () => undefined,
    createElement: () => createDefaultNodeMock(),
    dispatchEvent: () => true,
    querySelector: () => null,
    removeEventListener: () => undefined,
  };
  if (!previousDocument) {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      writable: true,
      value: fakeDocument,
    });
  }
  if (!previousWindow) {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      writable: true,
      value: {
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
      },
    });
  }
  try {
    return callback();
  } finally {
    if (previousDocument) {
      Object.defineProperty(globalThis, "document", previousDocument);
    }
    if (previousWindow) {
      Object.defineProperty(globalThis, "window", previousWindow);
    }
  }
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
