"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type TouchEvent,
} from "react";

import { matchesShortcut, type ShortcutId } from "@/lib/shortcuts/catalog";
import { isEditableTagName } from "@/lib/shortcuts/match";
import {
  DEFAULT_PRESENT_VIEWPORT,
  PRESENTATION_NAVIGATION_SHORTCUT_IDS,
  PRESENT_MODE_SHORTCUT_IDS,
  clampPresentSlideIndex,
  fitPresentCanvasToViewport,
  presentHashFromSlideIndex,
  presentProgress,
  presentSlideIndexFromHash,
  resolvePresentSwipeNavigation,
  type PresentShortcutAction,
  type PresentShortcutIdMap,
} from "@/lib/presentation/present-shell";
import type { StageFitSize } from "@/lib/presentation/stage-fit";

export { PRESENTATION_NAVIGATION_SHORTCUT_IDS, PRESENT_MODE_SHORTCUT_IDS };
export type {
  PresentShortcutAction,
  PresentShortcutIdMap,
  PresentShortcutRow,
} from "@/lib/presentation/present-shell";

export function usePresentSlideNavigation(total: number, initialIndex = 0) {
  const [currentIndex, setCurrentIndex] = useState(() =>
    clampPresentSlideIndex(initialIndex, total),
  );

  const goToSlide = useCallback(
    (index: number) => {
      setCurrentIndex(clampPresentSlideIndex(index, total));
    },
    [total],
  );
  const goNext = useCallback(() => {
    setCurrentIndex((index) => clampPresentSlideIndex(index + 1, total));
  }, [total]);
  const goPrev = useCallback(() => {
    setCurrentIndex((index) => clampPresentSlideIndex(index - 1, total));
  }, [total]);
  const goFirst = useCallback(() => setCurrentIndex(0), []);
  const goLast = useCallback(() => {
    setCurrentIndex(Math.max(0, total - 1));
  }, [total]);
  const progress = useMemo(
    () => presentProgress(currentIndex, total),
    [currentIndex, total],
  );

  return {
    currentIndex: clampPresentSlideIndex(currentIndex, total),
    setCurrentIndex,
    goToSlide,
    goNext,
    goPrev,
    goFirst,
    goLast,
    progress,
  };
}

export function usePresentSlideBounds<T extends HTMLElement>(): {
  slideAreaRef: RefObject<T | null>;
  slideAreaBounds: StageFitSize;
} {
  const slideAreaRef = useRef<T>(null);
  const [slideAreaBounds, setSlideAreaBounds] = useState<StageFitSize>(
    DEFAULT_PRESENT_VIEWPORT,
  );

  useEffect(() => {
    const node = slideAreaRef.current;
    if (!node) return;

    const updateBounds = () => {
      const rect = node.getBoundingClientRect();
      setSlideAreaBounds({
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
      });
    };
    updateBounds();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateBounds);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { slideAreaRef, slideAreaBounds };
}

export function usePresentSwipeNavigation({
  onNext,
  onPrevious,
}: {
  onNext: () => void;
  onPrevious: () => void;
}): {
  onTouchStart: (event: TouchEvent) => void;
  onTouchEnd: (event: TouchEvent) => void;
} {
  const touchStartXRef = useRef<number | null>(null);

  const onTouchStart = useCallback((event: TouchEvent) => {
    touchStartXRef.current = event.touches[0].clientX;
  }, []);

  const onTouchEnd = useCallback(
    (event: TouchEvent) => {
      if (touchStartXRef.current === null) return;
      const dx = event.changedTouches[0].clientX - touchStartXRef.current;
      touchStartXRef.current = null;
      const intent = resolvePresentSwipeNavigation(dx);
      if (intent === "next") onNext();
      else if (intent === "prev") onPrevious();
    },
    [onNext, onPrevious],
  );

  return { onTouchStart, onTouchEnd };
}

export function usePresentClickZones({
  currentIndex,
  total,
  onNext,
  onPrevious,
}: {
  currentIndex: number;
  total: number;
  onNext: () => void;
  onPrevious: () => void;
}) {
  return {
    previousZone: {
      "aria-label": "Previous slide",
      disabled: currentIndex === 0,
      onClick: onPrevious,
    },
    nextZone: {
      "aria-label": "Next slide",
      disabled: currentIndex === total - 1,
      onClick: onNext,
    },
  };
}

export type PresentKeyboardDispatchTarget = {
  tagName?: string | null;
  isContentEditable?: boolean;
} | null;

/**
 * Pure decision for which shortcut action (if any) a keydown should dispatch:
 * editable targets never dispatch, and the first shortcut whose id matches
 * wins (mirrors the original in-effect iteration order). Kept free of
 * `KeyboardEvent`/DOM so it is unit-testable with `node --test`.
 */
export function resolvePresentKeyboardDispatch({
  target,
  shortcuts,
  matches,
}: {
  target: PresentKeyboardDispatchTarget;
  shortcuts: PresentShortcutIdMap;
  matches: (id: ShortcutId) => boolean;
}): PresentShortcutAction | null {
  if (isEditableTagName(target?.tagName, target?.isContentEditable ?? false)) {
    return null;
  }

  for (const [action, id] of Object.entries(shortcuts)) {
    if (matches(id)) {
      return action as PresentShortcutAction;
    }
  }

  return null;
}

export function usePresentKeyboardNavigation({
  shortcuts,
  onShortcut,
}: {
  shortcuts: PresentShortcutIdMap;
  onShortcut: (
    action: PresentShortcutAction,
    event: KeyboardEvent,
  ) => boolean | void;
}): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const action = resolvePresentKeyboardDispatch({
        target: event.target as HTMLElement | null,
        shortcuts,
        matches: (id) => matchesShortcut(id, event),
      });
      if (!action) return;

      const handled = onShortcut(action, event);
      if (handled === false) return;
      event.preventDefault();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onShortcut, shortcuts]);
}

export function usePresentAutoHideHud({
  enabled = true,
  delayMs = 3000,
}: {
  enabled?: boolean;
  delayMs?: number;
} = {}) {
  const [hudVisible, setHudVisible] = useState(true);
  const hudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHudTimer = useCallback(() => {
    if (!hudTimerRef.current) return;
    clearTimeout(hudTimerRef.current);
    hudTimerRef.current = null;
  }, []);

  const scheduleHudHide = useCallback(() => {
    clearHudTimer();
    if (!enabled) return;
    hudTimerRef.current = setTimeout(() => setHudVisible(false), delayMs);
  }, [clearHudTimer, delayMs, enabled]);

  const resetHudTimer = useCallback(() => {
    setHudVisible(true);
    scheduleHudHide();
  }, [scheduleHudHide]);

  useEffect(() => {
    if (!enabled) {
      clearHudTimer();
      return clearHudTimer;
    }

    scheduleHudHide();
    window.addEventListener("mousemove", resetHudTimer);
    window.addEventListener("keydown", resetHudTimer);
    return () => {
      window.removeEventListener("mousemove", resetHudTimer);
      window.removeEventListener("keydown", resetHudTimer);
      clearHudTimer();
    };
  }, [clearHudTimer, enabled, resetHudTimer, scheduleHudHide]);

  return { hudVisible, resetHudTimer, scheduleHudHide, setHudVisible };
}

export function usePresentNavigationShellPresentation<T extends HTMLElement>({
  total,
  aspectRatio,
  initialIndex = 0,
  autoHideHud = true,
}: {
  total: number;
  aspectRatio: number;
  initialIndex?: number;
  autoHideHud?: boolean;
}) {
  const navigation = usePresentSlideNavigation(total, initialIndex);
  const { slideAreaRef, slideAreaBounds } = usePresentSlideBounds<T>();
  const fittedSlideSize = useMemo(
    () => fitPresentCanvasToViewport(slideAreaBounds, aspectRatio),
    [aspectRatio, slideAreaBounds],
  );
  const swipeHandlers = usePresentSwipeNavigation({
    onNext: navigation.goNext,
    onPrevious: navigation.goPrev,
  });
  const clickZones = usePresentClickZones({
    currentIndex: navigation.currentIndex,
    total,
    onNext: navigation.goNext,
    onPrevious: navigation.goPrev,
  });
  const hud = usePresentAutoHideHud({ enabled: autoHideHud });

  return {
    ...navigation,
    slideAreaRef,
    slideAreaBounds,
    fittedSlideSize,
    swipeHandlers,
    clickZones,
    ...hud,
  };
}

export function usePublicPresentSlideHash({
  currentIndex,
  total,
  goToSlide,
}: {
  currentIndex: number;
  total: number;
  goToSlide: (index: number) => void;
}): void {
  const currentIndexRef = useRef(currentIndex);
  const initialHashSyncedRef = useRef(false);
  const initialHashWriteSkippedRef = useRef(false);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    const syncFromHash = () => {
      const hashIndex = presentSlideIndexFromHash(window.location.hash, total);
      initialHashSyncedRef.current = true;
      if (hashIndex !== currentIndexRef.current) {
        goToSlide(hashIndex);
      }
    };

    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, [goToSlide, total]);

  useEffect(() => {
    if (!initialHashSyncedRef.current) return;
    if (!initialHashWriteSkippedRef.current) {
      initialHashWriteSkippedRef.current = true;
      return;
    }

    const hash = presentHashFromSlideIndex(currentIndex);
    if (window.location.hash !== hash) {
      window.history.replaceState(null, "", hash);
    }
  }, [currentIndex]);
}

export function getFullscreenElement(doc: Document): Element | null {
  return doc.fullscreenElement ?? null;
}

export async function requestBrowserFullscreen(): Promise<boolean> {
  const root = document.documentElement;

  try {
    if (root.requestFullscreen) {
      await root.requestFullscreen();
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

export async function exitBrowserFullscreen(): Promise<boolean> {
  try {
    if (document.exitFullscreen) {
      await document.exitFullscreen();
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

export function usePresenterFullscreen(): {
  isFullscreen: boolean;
  fullscreenHintVisible: boolean;
  setFullscreenHintVisible: (visible: boolean) => void;
  enterFullscreen: () => Promise<boolean>;
  toggleFullscreen: () => Promise<void>;
} {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenHintVisible, setFullscreenHintVisible] = useState(false);
  const fullscreenOperationRef = useRef<Promise<boolean> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      fullscreenOperationRef.current = null;
    };
  }, []);

  const runFullscreenOperation = useCallback(
    (operation: () => Promise<boolean>): Promise<boolean> => {
      const activeOperation = fullscreenOperationRef.current;
      if (activeOperation) return activeOperation;

      const promise = operation().finally(() => {
        if (fullscreenOperationRef.current === promise) {
          fullscreenOperationRef.current = null;
        }
      });
      fullscreenOperationRef.current = promise;
      return promise;
    },
    [],
  );

  const enterFullscreen = useCallback(
    () =>
      runFullscreenOperation(async () => {
        const succeeded = await requestBrowserFullscreen();
        if (!mountedRef.current) {
          if (succeeded) {
            await exitBrowserFullscreen();
          }
          return succeeded;
        }
        setFullscreenHintVisible(!succeeded);
        return succeeded;
      }),
    [runFullscreenOperation],
  );

  const toggleFullscreen = useCallback(async () => {
    if (fullscreenOperationRef.current) {
      await fullscreenOperationRef.current;
      return;
    }
    if (!getFullscreenElement(document)) {
      await enterFullscreen();
      return;
    }
    await runFullscreenOperation(async () => {
      const succeeded = await exitBrowserFullscreen();
      if (mountedRef.current) {
        setFullscreenHintVisible(false);
      }
      return succeeded;
    });
  }, [enterFullscreen, runFullscreenOperation]);

  useEffect(() => {
    const updateFullscreenState = () => {
      if (!mountedRef.current) return;
      const active = !!getFullscreenElement(document);
      setIsFullscreen(active);
      if (active) {
        setFullscreenHintVisible(false);
      }
    };

    updateFullscreenState();
    document.addEventListener("fullscreenchange", updateFullscreenState);
    return () => {
      document.removeEventListener("fullscreenchange", updateFullscreenState);
    };
  }, []);

  return {
    isFullscreen,
    fullscreenHintVisible,
    setFullscreenHintVisible,
    enterFullscreen,
    toggleFullscreen,
  };
}

/**
 * Pure elapsed-seconds decision for the presenter timer tick, isolated from
 * `Date.now()`/`setInterval` so it is unit-testable with plain numbers.
 */
export function computePresentElapsedSeconds(
  startedAt: number,
  now: number,
): number {
  return Math.floor((now - startedAt) / 1000);
}

export function usePresenterTimer(): {
  elapsedSeconds: number;
  startedAtRef: RefObject<number | null>;
} {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    const startedAt = startedAtRef.current ?? Date.now();
    startedAtRef.current = startedAt;
    const intervalId = window.setInterval(() => {
      setElapsedSeconds(computePresentElapsedSeconds(startedAt, Date.now()));
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  return { elapsedSeconds, startedAtRef };
}

export type LaserPosition = {
  x: number;
  y: number;
};

export function useLaserPointer({
  resetHudTimer,
}: {
  resetHudTimer: () => void;
}): {
  laserActive: boolean;
  laserPosition: LaserPosition | null;
  toggleLaser: () => void;
} {
  const [laserActive, setLaserActive] = useState(false);
  const [laserPosition, setLaserPosition] = useState<LaserPosition | null>(
    null,
  );

  useEffect(() => {
    if (!laserActive) return;

    const handleMouseMove = (event: MouseEvent) => {
      setLaserPosition({ x: event.clientX, y: event.clientY });
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [laserActive]);

  const toggleLaser = useCallback(() => {
    setLaserActive((active) => {
      const next = !active;
      if (next) {
        setLaserPosition({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        });
      }
      return next;
    });
    resetHudTimer();
  }, [resetHudTimer]);

  return { laserActive, laserPosition, toggleLaser };
}
