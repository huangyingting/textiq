/**
 * Pure, headless debounce scheduler for shared slide deck autosave (issues
 * #208 / -008).
 *
 * The presentation editor autosaves a short while after the user stops editing, while an
 * explicit Save must *flush* any pending autosave so the two paths never race or
 * report success while a stale write is still queued. That timing logic is
 * factored out here — behind an injectable timer — so it can be unit-tested with
 * no DOM, React or real clock, then wired into the editor hook.
 *
 * The scheduler is deck-shape agnostic (generic over the payload) so it can be
 * shared by route and editor controllers without importing presentation schema.
 */

import { SLIDE_SAVE_DEBOUNCE_MS } from "./save-status";

/** Opaque timer handle; `number` in browsers, `Timeout` object in Node. */
export type AutosaveTimerHandle = ReturnType<typeof setTimeout>;

/** Injectable timer surface, defaulting to the host `setTimeout`/`clearTimeout`. */
export interface AutosaveTimer {
  set(callback: () => void, delayMs: number): AutosaveTimerHandle;
  clear(handle: AutosaveTimerHandle): void;
}

/** Options for {@link createSlideAutosaveScheduler}. */
export interface SlideAutosaveSchedulerOptions<TDeck> {
  /**
   * Runs the actual persistence for a due (or flushed) deck. Invoked at most
   * once per scheduled deck; the scheduler never calls it for a cancelled deck.
   */
  onDue: (deck: TDeck) => void;
  /** Debounce window; defaults to {@link SLIDE_SAVE_DEBOUNCE_MS}. */
  debounceMs?: number;
  /** Timer surface; defaults to the host `setTimeout`/`clearTimeout`. */
  timer?: AutosaveTimer;
}

/** A debounced autosave scheduler with explicit flush/cancel semantics. */
export interface SlideAutosaveScheduler<TDeck> {
  /** (Re)arms the debounce for `deck`, replacing any earlier pending deck. */
  schedule(deck: TDeck): void;
  /**
   * Runs any pending deck immediately and clears the timer, so a manual save
   * can persist the latest edit without a queued autosave firing afterwards.
   * Returns the deck that was flushed, or `null` when nothing was pending.
   */
  flush(): TDeck | null;
  /** Drops any pending deck without persisting it (used on teardown). */
  cancel(): void;
  /** Whether a deck is currently waiting to autosave. */
  hasPending(): boolean;
}

const defaultTimer: AutosaveTimer = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) => clearTimeout(handle),
};

/**
 * Creates a debounced autosave scheduler.
 *
 * `schedule` collapses rapid edits into a single autosave a `debounceMs` after
 * the last edit. `flush` runs the pending deck now (manual save), and `cancel`
 * discards it (teardown) — both leave no timer armed, so autosave and manual
 * save can never double-fire.
 */
export function createSlideAutosaveScheduler<TDeck>({
  onDue,
  debounceMs = SLIDE_SAVE_DEBOUNCE_MS,
  timer = defaultTimer,
}: SlideAutosaveSchedulerOptions<TDeck>): SlideAutosaveScheduler<TDeck> {
  let handle: AutosaveTimerHandle | null = null;
  let pending: { deck: TDeck } | null = null;

  const clearTimer = (): void => {
    if (handle !== null) {
      timer.clear(handle);
      handle = null;
    }
  };

  return {
    schedule(deck: TDeck): void {
      clearTimer();
      pending = { deck };
      handle = timer.set(() => {
        handle = null;
        const due = pending;
        pending = null;
        if (due) {
          onDue(due.deck);
        }
      }, debounceMs);
    },
    flush(): TDeck | null {
      clearTimer();
      const due = pending;
      pending = null;
      if (due) {
        onDue(due.deck);
        return due.deck;
      }
      return null;
    },
    cancel(): void {
      clearTimer();
      pending = null;
    },
    hasPending(): boolean {
      return pending !== null;
    },
  };
}
