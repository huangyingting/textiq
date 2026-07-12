import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { TouchEvent as ReactTouchEvent } from "react";

import { createReactRenderHarness } from "@/test/react-render-harness";

import {
  computePresentElapsedSeconds,
  exitBrowserFullscreen,
  getFullscreenElement,
  requestBrowserFullscreen,
  resolvePresentKeyboardDispatch,
  usePresentAutoHideHud,
  usePresentClickZones,
  usePresentKeyboardNavigation,
  usePresentNavigationShellPresentation,
  usePresentSlideBounds,
  usePresentSlideNavigation,
  usePresentSwipeNavigation,
  usePresenterFullscreen,
  usePresenterTimer,
  usePublicPresentSlideHash,
  useLaserPointer,
  type PresentShortcutIdMap,
} from "./present-shell";

type ListenerMap = Map<string, Set<(event: unknown) => void>>;

function createFakeWindow(initial: { hash?: string } = {}) {
  const listeners: ListenerMap = new Map();
  const state = { hash: initial.hash ?? "" };
  const replaceStateCalls: string[] = [];

  const fakeWindow = {
    innerWidth: 800,
    innerHeight: 600,
    location: {
      get hash() {
        return state.hash;
      },
      set hash(value: string) {
        state.hash = value;
      },
    },
    history: {
      replaceState: (_state: unknown, _title: string, url: string) => {
        replaceStateCalls.push(url);
        const hashIndex = url.indexOf("#");
        state.hash = hashIndex >= 0 ? url.slice(hashIndex) : "";
      },
    },
    addEventListener(type: string, handler: (event: unknown) => void) {
      const set = listeners.get(type) ?? new Set();
      set.add(handler);
      listeners.set(type, set);
    },
    removeEventListener(type: string, handler: (event: unknown) => void) {
      listeners.get(type)?.delete(handler);
    },
    setTimeout: (...args: Parameters<typeof setTimeout>) =>
      globalThis.setTimeout(...args),
    clearTimeout: (...args: Parameters<typeof clearTimeout>) =>
      globalThis.clearTimeout(...args),
    setInterval: (...args: Parameters<typeof setInterval>) =>
      globalThis.setInterval(...args),
    clearInterval: (...args: Parameters<typeof clearInterval>) =>
      globalThis.clearInterval(...args),
  };

  return {
    window: fakeWindow,
    dispatch(type: string, event: unknown = {}) {
      for (const handler of Array.from(listeners.get(type) ?? [])) {
        handler(event);
      }
    },
    listenerCount(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
    replaceStateCalls,
  };
}

function createFakeDocument(initial: { fullscreenElement?: unknown } = {}) {
  const listeners: ListenerMap = new Map();
  let fullscreenElement: unknown = initial.fullscreenElement ?? null;

  const fakeDocument = {
    get fullscreenElement() {
      return fullscreenElement;
    },
    documentElement: {
      requestFullscreen: undefined as (() => Promise<void>) | undefined,
    },
    exitFullscreen: undefined as (() => Promise<void>) | undefined,
    addEventListener(type: string, handler: (event: unknown) => void) {
      const set = listeners.get(type) ?? new Set();
      set.add(handler);
      listeners.set(type, set);
    },
    removeEventListener(type: string, handler: (event: unknown) => void) {
      listeners.get(type)?.delete(handler);
    },
  };

  return {
    document: fakeDocument,
    setFullscreenElement(value: unknown) {
      fullscreenElement = value;
    },
    dispatch(type: string, event: unknown = {}) {
      for (const handler of Array.from(listeners.get(type) ?? [])) {
        handler(event);
      }
    },
    listenerCount(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

async function withGlobal<K extends "window" | "document", T>(
  key: K,
  value: unknown,
  run: () => T | Promise<T>,
): Promise<T> {
  const previous = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value,
  });
  try {
    // Awaiting here (rather than returning the promise directly) matters:
    // the global must stay swapped until every microtask inside `run`
    // settles, not just until its first `await` yields control back.
    return await run();
  } finally {
    if (previous) {
      Object.defineProperty(globalThis, key, previous);
    } else {
      Reflect.deleteProperty(globalThis, key);
    }
  }
}

function touchEvent(clientX: number, changed = false): ReactTouchEvent {
  const point = { clientX };
  return {
    touches: changed ? [] : [point],
    changedTouches: changed ? [point] : [],
  } as unknown as ReactTouchEvent;
}

describe("usePresentSlideNavigation", () => {
  test("clamps navigation across empty, single, and multi-slide decks", () => {
    const harness = createReactRenderHarness();
    try {
      const empty = harness.run(() => usePresentSlideNavigation(0, 5));
      assert.equal(empty.currentIndex, 0);
      assert.deepEqual(empty.progress, { label: "0 / 0", percentage: 100 });
      empty.goNext();
      empty.goPrev();
      empty.goLast();
      const afterEmptyOps = harness.run(() => usePresentSlideNavigation(0, 5));
      assert.equal(afterEmptyOps.currentIndex, 0);
    } finally {
      harness.cleanup();
    }

    const single = createReactRenderHarness();
    try {
      let state = single.run(() => usePresentSlideNavigation(1, 0));
      assert.equal(state.currentIndex, 0);
      state.goNext();
      state = single.run(() => usePresentSlideNavigation(1, 0));
      assert.equal(state.currentIndex, 0);
      state.goPrev();
      state = single.run(() => usePresentSlideNavigation(1, 0));
      assert.equal(state.currentIndex, 0);
      assert.deepEqual(state.progress, { label: "1 / 1", percentage: 100 });
    } finally {
      single.cleanup();
    }

    const multi = createReactRenderHarness();
    try {
      let state = multi.run(() => usePresentSlideNavigation(4, 1));
      assert.equal(state.currentIndex, 1);

      state.goPrev();
      state = multi.run(() => usePresentSlideNavigation(4, 1));
      assert.equal(state.currentIndex, 0);

      state.goPrev();
      state = multi.run(() => usePresentSlideNavigation(4, 1));
      assert.equal(state.currentIndex, 0, "goPrev clamps at the first slide");

      state.goLast();
      state = multi.run(() => usePresentSlideNavigation(4, 1));
      assert.equal(state.currentIndex, 3);

      state.goNext();
      state = multi.run(() => usePresentSlideNavigation(4, 1));
      assert.equal(state.currentIndex, 3, "goNext clamps at the last slide");

      state.goToSlide(-9);
      state = multi.run(() => usePresentSlideNavigation(4, 1));
      assert.equal(state.currentIndex, 0);

      state.goToSlide(99);
      state = multi.run(() => usePresentSlideNavigation(4, 1));
      assert.equal(state.currentIndex, 3);

      state.goFirst();
      state = multi.run(() => usePresentSlideNavigation(4, 1));
      assert.equal(state.currentIndex, 0);
      assert.deepEqual(state.progress, { label: "1 / 4", percentage: 0 });
    } finally {
      multi.cleanup();
    }
  });
});

describe("usePresentSlideBounds", () => {
  test("keeps the default viewport when no slide area node is attached", () => {
    const harness = createReactRenderHarness();
    try {
      const { slideAreaRef, slideAreaBounds } = harness.run(() =>
        usePresentSlideBounds<HTMLDivElement>(),
      );
      assert.equal(slideAreaRef.current, null);
      assert.deepEqual(slideAreaBounds, { width: 16, height: 9 });
    } finally {
      harness.cleanup();
    }
  });
});

describe("usePresentSwipeNavigation", () => {
  test("dispatches next/prev only past the swipe threshold and resets state", () => {
    const harness = createReactRenderHarness();
    try {
      const nextCalls: number[] = [];
      const prevCalls: number[] = [];
      const { onTouchStart, onTouchEnd } = harness.run(() =>
        usePresentSwipeNavigation({
          onNext: () => nextCalls.push(1),
          onPrevious: () => prevCalls.push(1),
        }),
      );

      // No prior touchstart: touchend is a no-op.
      onTouchEnd(touchEvent(0, true));
      assert.equal(nextCalls.length, 0);
      assert.equal(prevCalls.length, 0);

      // Below threshold: no navigation.
      onTouchStart(touchEvent(100));
      onTouchEnd(touchEvent(60, true));
      assert.equal(nextCalls.length, 0);
      assert.equal(prevCalls.length, 0);

      // Exactly at the threshold (50px) leftward still counts as "next".
      onTouchStart(touchEvent(100));
      onTouchEnd(touchEvent(50, true));
      assert.equal(nextCalls.length, 1);
      assert.equal(prevCalls.length, 0);

      // Exactly at the threshold (50px) rightward counts as "prev".
      onTouchStart(touchEvent(100));
      onTouchEnd(touchEvent(150, true));
      assert.equal(nextCalls.length, 1);
      assert.equal(prevCalls.length, 1);

      // Touch state resets after each end: a second end without a new
      // start is a no-op.
      onTouchEnd(touchEvent(0, true));
      assert.equal(nextCalls.length, 1);
      assert.equal(prevCalls.length, 1);
    } finally {
      harness.cleanup();
    }
  });
});

describe("usePresentClickZones", () => {
  test("disables previous/next regions at deck boundaries", () => {
    const noop = () => undefined;

    const empty = usePresentClickZones({
      currentIndex: 0,
      total: 0,
      onNext: noop,
      onPrevious: noop,
    });
    assert.equal(empty.previousZone.disabled, true);
    // total - 1 is -1 for an empty deck, so 0 !== -1: the next zone is not
    // reported disabled even though there is nothing to navigate to.
    assert.equal(empty.nextZone.disabled, false);

    const single = usePresentClickZones({
      currentIndex: 0,
      total: 1,
      onNext: noop,
      onPrevious: noop,
    });
    assert.equal(single.previousZone.disabled, true);
    assert.equal(single.nextZone.disabled, true);

    const atStart = usePresentClickZones({
      currentIndex: 0,
      total: 3,
      onNext: noop,
      onPrevious: noop,
    });
    assert.equal(atStart.previousZone.disabled, true);
    assert.equal(atStart.nextZone.disabled, false);

    const atMiddle = usePresentClickZones({
      currentIndex: 1,
      total: 3,
      onNext: noop,
      onPrevious: noop,
    });
    assert.equal(atMiddle.previousZone.disabled, false);
    assert.equal(atMiddle.nextZone.disabled, false);

    const atEnd = usePresentClickZones({
      currentIndex: 2,
      total: 3,
      onNext: noop,
      onPrevious: noop,
    });
    assert.equal(atEnd.previousZone.disabled, false);
    assert.equal(atEnd.nextZone.disabled, true);
  });

  test("wires click-zone labels and callbacks without wrapping them", () => {
    const onNext = () => undefined;
    const onPrevious = () => undefined;
    const zones = usePresentClickZones({
      currentIndex: 1,
      total: 3,
      onNext,
      onPrevious,
    });

    assert.equal(zones.previousZone["aria-label"], "Previous slide");
    assert.equal(zones.nextZone["aria-label"], "Next slide");
    assert.equal(zones.previousZone.onClick, onPrevious);
    assert.equal(zones.nextZone.onClick, onNext);
  });
});

describe("resolvePresentKeyboardDispatch", () => {
  const shortcuts: PresentShortcutIdMap = {
    next: "presentation.next",
    previous: "presentation.previous",
  };

  test("never dispatches for editable targets regardless of matches", () => {
    const action = resolvePresentKeyboardDispatch({
      target: { tagName: "INPUT" },
      shortcuts,
      matches: () => true,
    });
    assert.equal(action, null);

    const contentEditableAction = resolvePresentKeyboardDispatch({
      target: { tagName: "DIV", isContentEditable: true },
      shortcuts,
      matches: () => true,
    });
    assert.equal(contentEditableAction, null);
  });

  test("returns null when no shortcut in the map matches", () => {
    const action = resolvePresentKeyboardDispatch({
      target: null,
      shortcuts,
      matches: () => false,
    });
    assert.equal(action, null);
  });

  test("dispatches the first matching action and skips later lookups", () => {
    const checkedIds: string[] = [];
    const action = resolvePresentKeyboardDispatch({
      target: { tagName: "BODY" },
      shortcuts,
      matches: (id) => {
        checkedIds.push(id);
        return id === "presentation.next";
      },
    });
    assert.equal(action, "next");
    assert.deepEqual(checkedIds, ["presentation.next"]);
  });
});

describe("usePresentKeyboardNavigation", () => {
  test("registers and cleans up a window keydown listener", async () => {
    const fake = createFakeWindow();
    await withGlobal("window", fake.window, () => {
      const harness = createReactRenderHarness();
      try {
        const shortcuts: PresentShortcutIdMap = { next: "presentation.next" };
        harness.run(() =>
          usePresentKeyboardNavigation({ shortcuts, onShortcut: () => true }),
        );
        assert.equal(fake.listenerCount("keydown"), 1);
      } finally {
        harness.cleanup();
        assert.equal(fake.listenerCount("keydown"), 0);
      }
    });
  });

  test("prevents default only when the shortcut handler does not opt out", async () => {
    const fake = createFakeWindow();
    await withGlobal("window", fake.window, () => {
      const harness = createReactRenderHarness();
      try {
        const shortcuts: PresentShortcutIdMap = { next: "presentation.next" };
        const seen: Array<[string, unknown]> = [];
        let handledResult: boolean | void = true;
        harness.run(() =>
          usePresentKeyboardNavigation({
            shortcuts,
            onShortcut: (action, event) => {
              seen.push([action, event]);
              return handledResult;
            },
          }),
        );

        let prevented = 0;
        fake.dispatch("keydown", {
          key: "ArrowRight",
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          shiftKey: false,
          target: { tagName: "BODY" },
          preventDefault: () => {
            prevented += 1;
          },
        });
        assert.equal(seen.length, 1);
        assert.equal(seen[0]?.[0], "next");
        assert.equal(prevented, 1);

        handledResult = false;
        fake.dispatch("keydown", {
          key: "ArrowRight",
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          shiftKey: false,
          target: { tagName: "BODY" },
          preventDefault: () => {
            prevented += 1;
          },
        });
        assert.equal(seen.length, 2);
        assert.equal(prevented, 1, "handled=false skips preventDefault");
      } finally {
        harness.cleanup();
      }
    });
  });

  test("ignores keydown events targeting editable elements", async () => {
    const fake = createFakeWindow();
    await withGlobal("window", fake.window, () => {
      const harness = createReactRenderHarness();
      try {
        const shortcuts: PresentShortcutIdMap = { next: "presentation.next" };
        const seen: string[] = [];
        harness.run(() =>
          usePresentKeyboardNavigation({
            shortcuts,
            onShortcut: (action) => {
              seen.push(action);
              return true;
            },
          }),
        );

        fake.dispatch("keydown", {
          key: "ArrowRight",
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          shiftKey: false,
          target: { tagName: "INPUT" },
          preventDefault: () => undefined,
        });
        assert.deepEqual(seen, []);
      } finally {
        harness.cleanup();
      }
    });
  });
});

describe("usePresentAutoHideHud", () => {
  test("auto-hides after the delay and resets visibility on activity", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const fake = createFakeWindow();
    await withGlobal("window", fake.window, () => {
      const harness = createReactRenderHarness();
      const read = () =>
        harness.run(() =>
          usePresentAutoHideHud({ enabled: true, delayMs: 3000 }),
        );
      try {
        assert.equal(read().hudVisible, true);
        assert.equal(fake.listenerCount("mousemove"), 1);
        assert.equal(fake.listenerCount("keydown"), 1);

        t.mock.timers.tick(3000);
        assert.equal(read().hudVisible, false);

        fake.dispatch("mousemove", {});
        assert.equal(read().hudVisible, true);

        t.mock.timers.tick(3000);
        assert.equal(read().hudVisible, false);
      } finally {
        harness.cleanup();
        assert.equal(fake.listenerCount("mousemove"), 0);
        assert.equal(fake.listenerCount("keydown"), 0);
      }
    });
  });

  test("never schedules or fires hide while disabled", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const fake = createFakeWindow();
    await withGlobal("window", fake.window, () => {
      const harness = createReactRenderHarness();
      try {
        const state = harness.run(() =>
          usePresentAutoHideHud({ enabled: false, delayMs: 3000 }),
        );
        assert.equal(state.hudVisible, true);
        assert.equal(fake.listenerCount("mousemove"), 0);
        assert.equal(fake.listenerCount("keydown"), 0);

        t.mock.timers.tick(10_000);
        assert.equal(state.hudVisible, true);
      } finally {
        harness.cleanup();
      }
    });
  });
});

describe("usePresentNavigationShellPresentation", () => {
  test("composes navigation, click-zone, and HUD decisions without clobbering", () => {
    const harness = createReactRenderHarness();
    try {
      const shell = harness.run(() =>
        usePresentNavigationShellPresentation<HTMLDivElement>({
          total: 3,
          aspectRatio: 16 / 9,
          initialIndex: 1,
          autoHideHud: false,
        }),
      );

      assert.equal(shell.currentIndex, 1);
      assert.equal(shell.clickZones.previousZone.disabled, false);
      assert.equal(shell.clickZones.nextZone.disabled, false);
      assert.deepEqual(shell.fittedSlideSize, { width: 16, height: 9 });
      assert.equal(typeof shell.swipeHandlers.onTouchStart, "function");
      assert.equal(shell.hudVisible, true);
    } finally {
      harness.cleanup();
    }
  });
});

describe("usePublicPresentSlideHash", () => {
  test("syncs from the initial hash and skips only the mount-time write", async () => {
    const fake = createFakeWindow({ hash: "#2" });
    await withGlobal("window", fake.window, () => {
      const harness = createReactRenderHarness();
      const goToSlideCalls: number[] = [];
      let currentIndex = 0;
      const goToSlide = (index: number) => {
        goToSlideCalls.push(index);
        currentIndex = index;
      };
      const read = () =>
        harness.run(() =>
          usePublicPresentSlideHash({ currentIndex, total: 5, goToSlide }),
        );

      try {
        read();
        assert.deepEqual(
          goToSlideCalls,
          [1],
          "mount syncs currentIndex from the #2 location hash",
        );
        assert.equal(fake.replaceStateCalls.length, 0);

        currentIndex = 2;
        read();
        assert.deepEqual(
          fake.replaceStateCalls,
          ["#3"],
          "the first index change after mount writes the hash",
        );

        currentIndex = 3;
        read();
        assert.deepEqual(fake.replaceStateCalls, ["#3", "#4"]);
      } finally {
        harness.cleanup();
        assert.equal(fake.listenerCount("hashchange"), 0);
      }
    });
  });

  test("re-syncs from a hashchange event", async () => {
    const fake = createFakeWindow({ hash: "#1" });
    await withGlobal("window", fake.window, () => {
      const harness = createReactRenderHarness();
      try {
        const goToSlideCalls: number[] = [];
        harness.run(() =>
          usePublicPresentSlideHash({
            currentIndex: 0,
            total: 5,
            goToSlide: (index) => goToSlideCalls.push(index),
          }),
        );
        assert.equal(fake.listenerCount("hashchange"), 1);

        fake.window.location.hash = "#4";
        fake.dispatch("hashchange");
        assert.deepEqual(goToSlideCalls, [3]);
      } finally {
        harness.cleanup();
      }
    });
  });
});

describe("getFullscreenElement", () => {
  test("returns null instead of undefined when nothing is fullscreen", () => {
    const doc = { fullscreenElement: undefined } as unknown as Document;
    assert.equal(getFullscreenElement(doc), null);
  });

  test("returns the active fullscreen element when present", () => {
    const element = { tagName: "DIV" } as unknown as Element;
    const doc = { fullscreenElement: element } as unknown as Document;
    assert.equal(getFullscreenElement(doc), element);
  });
});

describe("requestBrowserFullscreen / exitBrowserFullscreen", () => {
  test("resolves true when the browser API succeeds", async () => {
    const fakeDoc = createFakeDocument();
    fakeDoc.document.documentElement.requestFullscreen = async () => undefined;
    fakeDoc.document.exitFullscreen = async () => undefined;

    await withGlobal("document", fakeDoc.document, async () => {
      assert.equal(await requestBrowserFullscreen(), true);
      assert.equal(await exitBrowserFullscreen(), true);
    });
  });

  test("resolves false when the browser API is unavailable or rejects", async () => {
    const missingApi = createFakeDocument();
    await withGlobal("document", missingApi.document, async () => {
      assert.equal(await requestBrowserFullscreen(), false);
      assert.equal(await exitBrowserFullscreen(), false);
    });

    const rejectingApi = createFakeDocument();
    rejectingApi.document.documentElement.requestFullscreen = async () => {
      throw new Error("denied by user agent");
    };
    rejectingApi.document.exitFullscreen = async () => {
      throw new Error("denied by user agent");
    };
    await withGlobal("document", rejectingApi.document, async () => {
      assert.equal(await requestBrowserFullscreen(), false);
      assert.equal(await exitBrowserFullscreen(), false);
    });
  });
});

describe("usePresenterFullscreen", () => {
  test("tracks fullscreenchange events and clears the hint once active", async () => {
    const fakeDoc = createFakeDocument();
    await withGlobal("document", fakeDoc.document, () => {
      const harness = createReactRenderHarness();
      try {
        const state = harness.run(() => usePresenterFullscreen());
        assert.equal(state.isFullscreen, false);

        state.setFullscreenHintVisible(true);
        const withHint = harness.run(() => usePresenterFullscreen());
        assert.equal(withHint.fullscreenHintVisible, true);

        fakeDoc.setFullscreenElement({ tagName: "DIV" });
        fakeDoc.dispatch("fullscreenchange");
        const afterChange = harness.run(() => usePresenterFullscreen());
        assert.equal(afterChange.isFullscreen, true);
        assert.equal(afterChange.fullscreenHintVisible, false);
      } finally {
        harness.cleanup();
        assert.equal(fakeDoc.listenerCount("fullscreenchange"), 0);
      }
    });
  });

  test("toggleFullscreen requests entry when nothing is fullscreen", async () => {
    const fakeDoc = createFakeDocument();
    let requestCalls = 0;
    fakeDoc.document.documentElement.requestFullscreen = async () => {
      requestCalls += 1;
    };

    await withGlobal("document", fakeDoc.document, async () => {
      const harness = createReactRenderHarness();
      try {
        const state = harness.run(() => usePresenterFullscreen());
        await state.toggleFullscreen();
        assert.equal(requestCalls, 1);
      } finally {
        harness.cleanup();
      }
    });
  });

  test("toggleFullscreen exits and clears the hint when already fullscreen", async () => {
    const fakeDoc = createFakeDocument({
      fullscreenElement: { tagName: "DIV" },
    });
    let exitCalls = 0;
    fakeDoc.document.exitFullscreen = async () => {
      exitCalls += 1;
    };

    await withGlobal("document", fakeDoc.document, async () => {
      const harness = createReactRenderHarness();
      try {
        const state = harness.run(() => usePresenterFullscreen());
        await state.toggleFullscreen();
        assert.equal(exitCalls, 1);
      } finally {
        harness.cleanup();
      }
    });
  });
});

describe("computePresentElapsedSeconds", () => {
  test("floors whole seconds elapsed since the start time", () => {
    assert.equal(computePresentElapsedSeconds(0, 0), 0);
    assert.equal(computePresentElapsedSeconds(0, 999), 0);
    assert.equal(computePresentElapsedSeconds(0, 1000), 1);
    assert.equal(computePresentElapsedSeconds(1_000, 4_500), 3);
  });
});

describe("usePresenterTimer", () => {
  test("ticks elapsed seconds every second and clears the interval on cleanup", async (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const fake = createFakeWindow();
    await withGlobal("window", fake.window, () => {
      const harness = createReactRenderHarness();
      try {
        const state = harness.run(() => usePresenterTimer());
        assert.equal(state.elapsedSeconds, 0);

        t.mock.timers.tick(1000);
        const afterOneTick = harness.run(() => usePresenterTimer());
        assert.equal(afterOneTick.elapsedSeconds, 1);

        t.mock.timers.tick(2000);
        const afterMoreTicks = harness.run(() => usePresenterTimer());
        assert.equal(afterMoreTicks.elapsedSeconds, 3);
      } finally {
        harness.cleanup();
      }
    });
  });
});

describe("useLaserPointer", () => {
  test("toggles laser state, centers the pointer, and resets the HUD timer", async () => {
    const fake = createFakeWindow();
    await withGlobal("window", fake.window, () => {
      const harness = createReactRenderHarness();
      try {
        let resetCalls = 0;
        let state = harness.run(() =>
          useLaserPointer({ resetHudTimer: () => (resetCalls += 1) }),
        );
        assert.equal(state.laserActive, false);
        assert.equal(state.laserPosition, null);
        assert.equal(fake.listenerCount("mousemove"), 0);

        state.toggleLaser();
        state = harness.run(() =>
          useLaserPointer({ resetHudTimer: () => (resetCalls += 1) }),
        );
        assert.equal(state.laserActive, true);
        assert.deepEqual(state.laserPosition, { x: 400, y: 300 });
        assert.equal(resetCalls, 1);
        assert.equal(fake.listenerCount("mousemove"), 1);

        fake.dispatch("mousemove", { clientX: 12, clientY: 34 });
        state = harness.run(() =>
          useLaserPointer({ resetHudTimer: () => (resetCalls += 1) }),
        );
        assert.deepEqual(state.laserPosition, { x: 12, y: 34 });

        state.toggleLaser();
        state = harness.run(() =>
          useLaserPointer({ resetHudTimer: () => (resetCalls += 1) }),
        );
        assert.equal(state.laserActive, false);
        assert.equal(resetCalls, 2);
        assert.equal(fake.listenerCount("mousemove"), 0);
      } finally {
        harness.cleanup();
      }
    });
  });
});
