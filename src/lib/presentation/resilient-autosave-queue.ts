import { actionError, actionOk, type ActionResult } from "@/lib/action-result";
import { logInfo } from "@/lib/log";

import { SLIDE_SAVE_DEBOUNCE_MS, type SaveQueueStatus } from "./save-status";
import type {
  AutosaveTimer,
  AutosaveTimerHandle,
} from "./slide-autosave-scheduler";

export type SaveQueueErrorClass =
  "offline" | "transient" | "fatal" | "conflict";

export type { SaveQueueStatus } from "./save-status";

export interface QueuedSnapshot<TSnapshot> {
  documentId: string;
  snapshot: TSnapshot;
  baseRevisionToken: string | null;
  enqueuedAt: number;
  attemptCount: number;
  lastErrorClass: SaveQueueErrorClass | null;
  serializedByteSize: number;
  sequence: number;
}

export interface SaveQueueStorage<TSnapshot> {
  load(): Promise<QueuedSnapshot<TSnapshot> | null>;
  save(snapshot: QueuedSnapshot<TSnapshot>): Promise<void>;
  remove(): Promise<void>;
}

export type SaveQueueSaveResult =
  | { ok: true; revisionToken: string | null }
  | { ok: "conflict"; serverRevisionToken: string | null }
  | { ok: false; error: string; retryable?: boolean };

export interface ResilientLatestSnapshotQueueOptions<TSnapshot> {
  documentId: string;
  storage: SaveQueueStorage<TSnapshot>;
  save: (
    snapshot: TSnapshot,
    baseRevisionToken: string | null,
  ) => Promise<SaveQueueSaveResult>;
  onStatusChange?: (status: SaveQueueStatus) => void;
  onSaved?: (snapshot: TSnapshot, revisionToken: string | null) => void;
  now?: () => number;
  isOnline?: () => boolean;
  timer?: AutosaveTimer;
  debounceMs?: number;
  retryDelaysMs?: readonly number[];
  serialize?: (snapshot: TSnapshot) => string;
}

export interface ResilientLatestSnapshotQueue<TSnapshot> {
  enqueue(
    snapshot: TSnapshot,
    baseRevisionToken: string | null,
    options?: { flush?: boolean },
  ): Promise<ActionResult>;
  flushNow(): Promise<ActionResult>;
  recover(): Promise<QueuedSnapshot<TSnapshot> | null>;
  clear(): Promise<void>;
  cancelScheduledFlush(): void;
  destroy(): void;
  getStatus(): SaveQueueStatus;
  getPending(): QueuedSnapshot<TSnapshot> | null;
  isFlushing(): boolean;
}

const defaultTimer: AutosaveTimer = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) => clearTimeout(handle),
};

const defaultRetryDelaysMs = [1_000, 2_500, 5_000, 10_000] as const;

function isQueuedSnapshot<TSnapshot>(
  value: unknown,
): value is QueuedSnapshot<TSnapshot> {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.documentId === "string" &&
    "snapshot" in record &&
    (typeof record.baseRevisionToken === "string" ||
      record.baseRevisionToken === null) &&
    typeof record.enqueuedAt === "number" &&
    Number.isFinite(record.enqueuedAt) &&
    typeof record.attemptCount === "number" &&
    Number.isInteger(record.attemptCount) &&
    record.attemptCount >= 0 &&
    (record.lastErrorClass === null ||
      record.lastErrorClass === "offline" ||
      record.lastErrorClass === "transient" ||
      record.lastErrorClass === "fatal" ||
      record.lastErrorClass === "conflict") &&
    typeof record.serializedByteSize === "number" &&
    Number.isFinite(record.serializedByteSize) &&
    typeof record.sequence === "number" &&
    Number.isInteger(record.sequence)
  );
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function classifyFailure(
  result: { retryable?: boolean } | null,
  isOnline: () => boolean,
): SaveQueueErrorClass {
  if (!isOnline()) {
    return "offline";
  }
  return result?.retryable === false ? "fatal" : "transient";
}

export function createResilientLatestSnapshotQueue<TSnapshot>({
  documentId,
  storage,
  save,
  onStatusChange,
  onSaved,
  now = () => Date.now(),
  isOnline = () => true,
  timer = defaultTimer,
  debounceMs = SLIDE_SAVE_DEBOUNCE_MS,
  retryDelaysMs = defaultRetryDelaysMs,
  serialize = JSON.stringify,
}: ResilientLatestSnapshotQueueOptions<TSnapshot>): ResilientLatestSnapshotQueue<TSnapshot> {
  let pending: QueuedSnapshot<TSnapshot> | null = null;
  let nextSequence = 0;
  let status: SaveQueueStatus = "idle";
  let flushPromise: Promise<ActionResult> | null = null;
  let debounceHandle: AutosaveTimerHandle | null = null;
  let retryHandle: AutosaveTimerHandle | null = null;
  let conflictPaused = false;

  /* node:coverage ignore next 4 */
  const emit = (nextStatus: SaveQueueStatus): void => {
    status = nextStatus;
    onStatusChange?.(nextStatus);
  };

  const clearDebounce = (): void => {
    if (debounceHandle !== null) {
      timer.clear(debounceHandle);
      debounceHandle = null;
    }
  };

  const clearRetry = (): void => {
    if (retryHandle !== null) {
      timer.clear(retryHandle);
      retryHandle = null;
    }
  };

  const scheduleRetry = (): void => {
    clearRetry();
    if (!pending || pending.lastErrorClass === "fatal" || conflictPaused) {
      return;
    }
    const delayIndex = Math.min(
      pending.attemptCount - 1,
      retryDelaysMs.length - 1,
    );
    retryHandle = timer.set(
      () => {
        retryHandle = null;
        void api.flushNow();
      },
      retryDelaysMs[Math.max(0, delayIndex)] ?? retryDelaysMs.at(-1) ?? 1_000,
    );
  };

  const persistPending = async (): Promise<void> => {
    if (pending) {
      await storage.save(pending);
    }
  };

  const api: ResilientLatestSnapshotQueue<TSnapshot> = {
    /* node:coverage ignore next 40 */
    async enqueue(
      snapshot,
      baseRevisionToken,
      options = {},
    ): Promise<ActionResult> {
      clearRetry();
      conflictPaused = false;
      const serialized = serialize(snapshot);
      const sequence = ++nextSequence;
      pending = {
        documentId,
        snapshot,
        baseRevisionToken,
        enqueuedAt: now(),
        attemptCount: 0,
        lastErrorClass: null,
        serializedByteSize: byteLength(serialized),
        sequence,
      };
      try {
        await storage.save(pending);
      } catch (error) {
        emit("failed");
        return actionError(
          error instanceof Error
            ? error.message
            : "Couldn't store the queued deck snapshot locally.",
        );
      }
      emit(isOnline() ? "queued" : "offline");
      if (options.flush) {
        return api.flushNow();
      }
      clearDebounce();
      debounceHandle = timer.set(() => {
        debounceHandle = null;
        void api.flushNow();
      }, debounceMs);
      return actionOk();
    },

    /* node:coverage ignore next 85 */
    async flushNow(): Promise<ActionResult> {
      clearDebounce();
      clearRetry();
      if (flushPromise) {
        return flushPromise;
      }
      if (!pending) {
        return actionOk();
      }
      if (conflictPaused) {
        emit("conflict");
        return actionError(
          "Save conflict: resolve the conflict before retrying.",
        );
      }
      if (!isOnline()) {
        pending.lastErrorClass = "offline";
        await persistPending();
        emit("offline");
        scheduleRetry();
        return actionError("Offline — changes are saved locally.");
      }

      flushPromise = (async (): Promise<ActionResult> => {
        try {
          while (pending) {
            const current: QueuedSnapshot<TSnapshot> = pending;
            emit(current.attemptCount > 0 ? "retrying" : "saving");
            const result = await save(
              current.snapshot,
              current.baseRevisionToken,
            );
            if (result.ok === true) {
              if (pending?.sequence === current.sequence) {
                const savedSnapshot = current.snapshot;
                pending = null;
                await storage.remove();
                onSaved?.(savedSnapshot, result.revisionToken);
                emit("idle");
                return actionOk();
              }
              if (pending) {
                pending.baseRevisionToken = result.revisionToken;
                pending.lastErrorClass = null;
                pending.attemptCount = 0;
                await persistPending();
              }
              continue;
            }
            if (result.ok === "conflict") {
              current.attemptCount += 1;
              current.lastErrorClass = "conflict";
              pending = current;
              await persistPending();
              conflictPaused = true;
              emit("conflict");
              return actionError(SAVE_CONFLICT_MESSAGE);
            }
            current.attemptCount += 1;
            current.lastErrorClass = classifyFailure(result, isOnline);
            pending = current;
            await persistPending();
            emit(current.lastErrorClass === "offline" ? "offline" : "failed");
            scheduleRetry();
            return actionError(result.error);
          }
          emit("idle");
          return actionOk();
        } catch (error) {
          if (pending) {
            pending.attemptCount += 1;
            pending.lastErrorClass = classifyFailure(null, isOnline);
            await persistPending();
            emit(pending.lastErrorClass === "offline" ? "offline" : "failed");
            scheduleRetry();
          }
          return actionError(
            error instanceof Error ? error.message : "Queued save failed.",
          );
        } finally {
          flushPromise = null;
        }
      })();
      return flushPromise;
    },

    async recover(): Promise<QueuedSnapshot<TSnapshot> | null> {
      let restored: QueuedSnapshot<TSnapshot> | null = null;
      try {
        restored = await storage.load();
      } catch (error) {
        logInfo("presentation.autosave", "autosave-recovery-load-failed", {
          documentId,
          errorName: error instanceof Error ? error.name : typeof error,
        });
        try {
          await storage.remove();
        } catch {
          // Recovery must not fail when corrupted storage also refuses removal.
        }
      }
      if (!restored || restored.documentId !== documentId) {
        pending = null;
        emit("idle");
        return null;
      }
      pending = restored;
      nextSequence = Math.max(nextSequence, restored.sequence);
      conflictPaused = restored.lastErrorClass === "conflict";
      emit(conflictPaused ? "conflict" : isOnline() ? "queued" : "offline");
      return restored;
    },

    async clear(): Promise<void> {
      pending = null;
      conflictPaused = false;
      clearDebounce();
      clearRetry();
      await storage.remove();
      emit("idle");
    },

    cancelScheduledFlush(): void {
      clearDebounce();
    },

    destroy(): void {
      clearDebounce();
      clearRetry();
    },

    getStatus(): SaveQueueStatus {
      return status;
    },

    getPending(): QueuedSnapshot<TSnapshot> | null {
      return pending;
    },

    isFlushing(): boolean {
      return flushPromise !== null;
    },
  };

  return api;
}

const SAVE_CONFLICT_MESSAGE =
  "Save conflict: another session modified this deck.";

export function createMemorySaveQueueStorage<TSnapshot>(
  initial: QueuedSnapshot<TSnapshot> | null = null,
): SaveQueueStorage<TSnapshot> & {
  readStored(): QueuedSnapshot<TSnapshot> | null;
} {
  let stored = initial;
  return {
    async load() {
      return stored;
    },
    async save(snapshot) {
      stored = snapshot;
    },
    async remove() {
      stored = null;
    },
    readStored() {
      return stored;
    },
  };
}

export function createBrowserLocalStorageSaveQueueStorage<TSnapshot>({
  documentId,
  storageKeyPrefix = "textiq:presentation-autosave",
  maxBytes = 4 * 1024 * 1024,
}: {
  documentId: string;
  storageKeyPrefix?: string;
  maxBytes?: number;
}): SaveQueueStorage<TSnapshot> {
  const key = `${storageKeyPrefix}:${documentId}`;
  const localStorageOrNull = (): Storage | null => {
    try {
      /* node:coverage ignore next 3 */
      if (typeof window === "undefined") {
        return null;
      }
      return window.localStorage;
    } catch {
      return null;
    }
  };
  return {
    async load() {
      const storage = localStorageOrNull();
      if (!storage) return null;
      try {
        const stored = storage.getItem(key);
        if (!stored) return null;
        const parsed = JSON.parse(stored) as unknown;
        if (isQueuedSnapshot<TSnapshot>(parsed)) return parsed;
      } catch {
        // Treat corrupt/inaccessible recovery state as absent.
      }
      try {
        storage.removeItem(key);
      } catch {
        // Storage cleanup is best-effort.
      }
      return null;
    },
    async save(snapshot) {
      const serialized = JSON.stringify(snapshot);
      if (byteLength(serialized) > maxBytes) {
        throw new Error("Queued deck snapshot exceeds the local save cap.");
      }
      const storage = localStorageOrNull();
      if (!storage) {
        return;
      }
      storage.setItem(key, serialized);
    },
    async remove() {
      localStorageOrNull()?.removeItem(key);
    },
  };
}
