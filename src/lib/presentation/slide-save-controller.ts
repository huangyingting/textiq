import { actionError, actionOk, type ActionResult } from "@/lib/action-result";

import { SLIDE_SAVE_DEBOUNCE_MS } from "./save-status";
import type {
  AutosaveTimer,
  AutosaveTimerHandle,
} from "./slide-autosave-scheduler";

export interface SlideSaveControllerState {
  dirty: boolean;
  saving: boolean;
  error: string | null;
}

export interface SlideSaveControllerOptions<TDeck> {
  persist: (
    deck: TDeck,
    isAuthoritative: () => boolean,
  ) => Promise<ActionResult>;
  equals: (left: TDeck, right: TDeck) => boolean;
  onStateChange: (state: SlideSaveControllerState) => void;
  initialPersisted?: TDeck | null;
  debounceMs?: number;
  timer?: AutosaveTimer;
}

export interface SlideSaveController<TDeck> {
  schedule(deck: TDeck): void;
  flush(deck: TDeck): Promise<ActionResult>;
  replaceAndPersist(deck: TDeck): Promise<ActionResult>;
  adoptPersisted(deck: TDeck): void;
  cancelScheduled(): void;
  dispose(): void;
  getState(): SlideSaveControllerState;
}

type ScheduledDeck<TDeck> = {
  deck: TDeck;
  generation: number;
  lifecycle: number;
};

type PersistRequest<TDeck> = {
  deck: TDeck;
};

const defaultTimer: AutosaveTimer = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) => clearTimeout(handle),
};

export function createSlideSaveController<TDeck>({
  persist,
  equals,
  onStateChange,
  initialPersisted = null,
  debounceMs = SLIDE_SAVE_DEBOUNCE_MS,
  timer = defaultTimer,
}: SlideSaveControllerOptions<TDeck>): SlideSaveController<TDeck> {
  let state: SlideSaveControllerState = {
    dirty: false,
    saving: false,
    error: null,
  };
  let disposed = false;
  let lifecycle = 0;
  let scheduleGeneration = 0;
  let timerHandle: AutosaveTimerHandle | null = null;
  let scheduled: ScheduledDeck<TDeck> | null = null;
  let active: PersistRequest<TDeck> | null = null;
  let queued: PersistRequest<TDeck> | null = null;
  let latestTarget: TDeck | null = initialPersisted;
  let lastPersisted: TDeck | null = initialPersisted;
  let drain: {
    promise: Promise<ActionResult>;
    resolve: (result: ActionResult) => void;
  } | null = null;

  const updateState = (next: SlideSaveControllerState): void => {
    if (disposed) return;
    if (
      state.dirty === next.dirty &&
      state.saving === next.saving &&
      state.error === next.error
    ) {
      return;
    }
    state = next;
    onStateChange(state);
  };

  const clearTimer = (): void => {
    if (timerHandle !== null) {
      timer.clear(timerHandle);
      timerHandle = null;
    }
  };

  const supersedeScheduled = (): TDeck | null => {
    scheduleGeneration += 1;
    clearTimer();
    const pendingDeck = scheduled?.deck ?? null;
    scheduled = null;
    return pendingDeck;
  };

  const isPersisted = (deck: TDeck): boolean =>
    lastPersisted !== null && equals(lastPersisted, deck);

  const settleWithoutWrite = (): Promise<ActionResult> => {
    updateState({ dirty: false, saving: false, error: null });
    return Promise.resolve(actionOk());
  };

  const finishDrain = (result: ActionResult, attemptedDeck: TDeck): void => {
    const pendingDrain = drain;
    drain = null;

    if (!disposed) {
      if (scheduled) {
        updateState({ dirty: true, saving: false, error: null });
      } else if (latestTarget !== null && isPersisted(latestTarget)) {
        updateState({ dirty: false, saving: false, error: null });
      } else if (
        !result.ok &&
        latestTarget !== null &&
        equals(latestTarget, attemptedDeck)
      ) {
        updateState({ dirty: true, saving: false, error: result.error });
      } else {
        updateState({ dirty: true, saving: false, error: null });
      }
    }

    pendingDrain?.resolve(result);
  };

  const runDrain = async (runLifecycle: number): Promise<void> => {
    let lastResult: ActionResult = actionOk();
    let lastAttemptedDeck = active?.deck;

    while (active) {
      const request = active;
      lastAttemptedDeck = request.deck;
      try {
        lastResult = await persist(
          request.deck,
          () =>
            !disposed &&
            lifecycle === runLifecycle &&
            latestTarget !== null &&
            equals(latestTarget, request.deck),
        );
      } catch (error) {
        lastResult = actionError(
          error instanceof Error ? error.message : "Failed to save slides.",
        );
      }

      if (disposed || lifecycle !== runLifecycle) {
        drain?.resolve(lastResult);
        drain = null;
        return;
      }

      if (lastResult.ok) {
        lastPersisted = request.deck;
      }

      const next = queued;
      queued = null;
      if (next) {
        if (isPersisted(next.deck)) {
          lastResult = actionOk();
          active = null;
          break;
        }
        active = next;
        updateState({ dirty: true, saving: true, error: null });
        continue;
      }

      active = null;
    }

    if (lastAttemptedDeck) {
      finishDrain(lastResult, lastAttemptedDeck);
    }
  };

  const requestPersist = (deck: TDeck): Promise<ActionResult> => {
    if (disposed) return Promise.resolve(actionOk());
    latestTarget = deck;

    if (active && equals(active.deck, deck)) {
      queued = null;
      updateState({ dirty: true, saving: true, error: null });
      return drain?.promise ?? Promise.resolve(actionOk());
    }
    if (queued && equals(queued.deck, deck)) {
      updateState({ dirty: true, saving: true, error: null });
      return drain?.promise ?? Promise.resolve(actionOk());
    }
    if (!active && isPersisted(deck)) {
      queued = null;
      return settleWithoutWrite();
    }

    if (active) {
      queued = { deck };
      updateState({ dirty: true, saving: true, error: null });
      return drain?.promise ?? Promise.resolve(actionOk());
    }

    let resolveDrain!: (result: ActionResult) => void;
    const promise = new Promise<ActionResult>((resolve) => {
      resolveDrain = resolve;
    });
    drain = { promise, resolve: resolveDrain };
    active = { deck };
    updateState({ dirty: true, saving: true, error: null });
    void runDrain(lifecycle);
    return promise;
  };

  const schedule = (deck: TDeck): void => {
    if (disposed) return;
    const generation = scheduleGeneration + 1;
    supersedeScheduled();
    scheduleGeneration = generation;
    latestTarget = deck;

    if (active && equals(active.deck, deck)) {
      queued = null;
      updateState({ dirty: true, saving: true, error: null });
      return;
    }
    if (queued && equals(queued.deck, deck)) {
      updateState({ dirty: true, saving: true, error: null });
      return;
    }
    if (!active && isPersisted(deck)) {
      queued = null;
      updateState({ dirty: false, saving: false, error: null });
      return;
    }

    const due: ScheduledDeck<TDeck> = {
      deck,
      generation,
      lifecycle,
    };
    scheduled = due;
    updateState({
      dirty: true,
      saving: active !== null,
      error: null,
    });
    timerHandle = timer.set(() => {
      if (
        disposed ||
        due.lifecycle !== lifecycle ||
        due.generation !== scheduleGeneration ||
        scheduled !== due
      ) {
        return;
      }
      timerHandle = null;
      scheduled = null;
      void requestPersist(due.deck);
    }, debounceMs);
  };

  return {
    schedule,
    flush(deck: TDeck): Promise<ActionResult> {
      if (disposed) return Promise.resolve(actionOk());
      const pendingDeck = supersedeScheduled();
      return requestPersist(pendingDeck ?? deck);
    },
    replaceAndPersist(deck: TDeck): Promise<ActionResult> {
      if (disposed) return Promise.resolve(actionOk());
      supersedeScheduled();
      return requestPersist(deck);
    },
    adoptPersisted(deck: TDeck): void {
      if (disposed) return;
      supersedeScheduled();
      queued = null;
      latestTarget = deck;
      lastPersisted = deck;
      updateState({ dirty: false, saving: false, error: null });
    },
    cancelScheduled(): void {
      if (disposed) return;
      supersedeScheduled();
      if (!active) {
        queued = null;
        const clean =
          latestTarget !== null && lastPersisted !== null
            ? equals(latestTarget, lastPersisted)
            : false;
        updateState({
          dirty: !clean,
          saving: false,
          error: clean ? null : state.error,
        });
      }
    },
    dispose(): void {
      if (disposed) return;
      supersedeScheduled();
      disposed = true;
      lifecycle += 1;
      queued = null;
    },
    getState(): SlideSaveControllerState {
      return state;
    },
  };
}
