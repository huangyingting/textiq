import React, { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

type TestDispatcher = Record<string, unknown>;

function reactDispatcher(): TestDispatcher {
  return React as unknown as TestDispatcher;
}

function reducerInitialState<S>(initialArg: unknown): S {
  return initialArg as unknown as S;
}

function runWithOverrides<T>(dispatcher: TestDispatcher, render: () => T): T {
  const original: TestDispatcher = {};
  const reactOverrides = reactDispatcher();
  for (const key of Object.keys(dispatcher)) {
    original[key] = reactOverrides[key];
  }
  Object.assign(React, dispatcher);
  try {
    return render();
  } finally {
    Object.assign(React, original);
  }
}

export function renderWithReact<T>(render: () => T): T;
export function renderWithReact<T>(
  dispatcher: TestDispatcher,
  render: () => T,
  _options?: unknown,
): T;
export function renderWithReact<T>(
  renderOrDispatcher: (() => T) | TestDispatcher,
  render?: () => T,
): T {
  if (render) {
    return runWithOverrides(renderOrDispatcher as TestDispatcher, render);
  }
  const renderComponent = renderOrDispatcher as () => T;
  let result: T | undefined;

  function Probe() {
    result = renderComponent();
    return (result ?? null) as ReactNode;
  }

  renderToStaticMarkup(createElement(Probe));
  return result as T;
}

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

export function createServerRenderHarness(
  _options: ServerRenderHarnessOptions = {},
) {
  const {
    firstRefCurrent,
    idPrefix = "server-render-id",
    preferServerSnapshot = false,
    runEffects = false,
    runInsertionEffects = false,
    runLayoutEffects = false,
  } = _options;
  const slots: unknown[] = [];
  const cleanups: (() => void)[] = [];

  return {
    run<T>(render: () => T): T {
      let hookIndex = 0;
      return runWithOverrides(
        {
          useState: <S>(initial: S | (() => S)) => {
            const slotIndex = hookIndex++;
            if (!(slotIndex in slots)) {
              slots[slotIndex] =
                typeof initial === "function"
                  ? (initial as () => S)()
                  : initial;
            }
            const setState = (next: S | ((previousState: S) => S)) => {
              const previousState = slots[slotIndex] as S;
              slots[slotIndex] =
                typeof next === "function"
                  ? (next as (previousState: S) => S)(previousState)
                  : next;
            };
            return [slots[slotIndex] as S, setState] as const;
          },
          useReducer: <S, A, I = S>(
            reducer: (state: S, action: A) => S,
            initialArg: I,
            init?: (arg: I) => S,
          ) => {
            const slotIndex = hookIndex++;
            if (!(slotIndex in slots)) {
              slots[slotIndex] = init
                ? init(initialArg)
                : reducerInitialState<S>(initialArg);
            }
            const dispatch = (action: A) => {
              slots[slotIndex] = reducer(slots[slotIndex] as S, action);
            };
            return [slots[slotIndex] as S, dispatch] as const;
          },
          useRef: <T>(initial: T) => {
            const slotIndex = hookIndex++;
            if (!(slotIndex in slots)) {
              slots[slotIndex] = {
                current:
                  slotIndex === 0 && firstRefCurrent !== undefined
                    ? firstRefCurrent
                    : initial,
              };
            }
            return slots[slotIndex] as { current: T };
          },
          useMemo: <T>(factory: () => T) => {
            hookIndex++;
            return factory();
          },
          useCallback: <T>(callback: T) => {
            hookIndex++;
            return callback;
          },
          useId: () => {
            const slotIndex = hookIndex++;
            if (!(slotIndex in slots))
              slots[slotIndex] = `${idPrefix}-${slotIndex}`;
            return slots[slotIndex] as string;
          },
          useContext: () => {
            hookIndex++;
            return undefined;
          },
          useEffect: (effect?: () => void | (() => void)) => {
            hookIndex++;
            if (!runEffects) return;
            const cleanup = effect?.();
            if (typeof cleanup === "function") cleanups.push(cleanup);
          },
          useLayoutEffect: (effect?: () => void | (() => void)) => {
            hookIndex++;
            if (!runLayoutEffects) return;
            const cleanup = effect?.();
            if (typeof cleanup === "function") cleanups.push(cleanup);
          },
          useInsertionEffect: (effect?: () => void | (() => void)) => {
            hookIndex++;
            if (!runInsertionEffects) return;
            const cleanup = effect?.();
            if (typeof cleanup === "function") cleanups.push(cleanup);
          },
          useSyncExternalStore: <T>(
            _subscribe: (_callback: () => void) => () => void,
            getSnapshot: () => T,
            getServerSnapshot?: () => T,
          ) => {
            hookIndex++;
            return preferServerSnapshot && getServerSnapshot
              ? getServerSnapshot()
              : getSnapshot();
          },
          useTransition: () => {
            hookIndex++;
            return [false, (callback?: () => void) => callback?.()] as const;
          },
          useDeferredValue: <T>(value: T) => {
            hookIndex++;
            return value;
          },
          useImperativeHandle: () => {
            hookIndex++;
          },
        },
        render,
      );
    },
    cleanup(): void {
      for (const cleanup of cleanups.splice(0)) cleanup();
    },
  };
}
