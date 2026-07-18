"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorState, LexicalEditor } from "lexical";

export type SaveStatus = "saved" | "pending" | "saving" | "error";

export type SaveResult = {
  ok: boolean;
  error?: string;
};

export type LexicalSaveFn = (json: string) => Promise<SaveResult>;

const DEFAULT_SAVE_DEBOUNCE_MS = 800;
const DEFAULT_SAVE_MAX_WAIT_MS = 5000;

export type AutosaveController = {
  queue(json: string): void;
  queueSnapshot(readJson: () => string): void;
  flush(): Promise<void>;
  dispose(): void;
  latestJson(): string | null;
};

export function createAutosaveController({
  save,
  debounceMs,
  maxWaitMs = DEFAULT_SAVE_MAX_WAIT_MS,
  onStatus,
  onError,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  scheduleMicrotask = queueMicrotask,
  now = Date.now,
}: {
  save: LexicalSaveFn;
  debounceMs: number;
  maxWaitMs?: number;
  onStatus(status: SaveStatus): void;
  onError(error: unknown): void;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
  scheduleMicrotask?: (callback: () => void) => void;
  now?: () => number;
}): AutosaveController {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latest: string | null = null;
  let generation = 0;
  let disposed = false;
  let inFlight: Promise<void> | null = null;
  let flushAgain = false;
  let pendingSnapshot: { generation: number; readJson: () => string } | null =
    null;
  let burstStartedAt: number | null = null;

  const clearPendingTimer = () => {
    if (timer) {
      clearTimer(timer);
      timer = null;
    }
  };

  const emitStatus = (status: SaveStatus) => {
    if (!disposed) onStatus(status);
  };

  const emitError = (error: unknown) => {
    if (!disposed) onError(error);
  };

  const scheduleFlush = () => {
    const currentTime = now();
    burstStartedAt ??= currentTime;
    const maxWaitRemaining = Math.max(
      0,
      maxWaitMs - (currentTime - burstStartedAt),
    );
    clearPendingTimer();
    timer = setTimer(
      () => {
        void flush();
      },
      Math.min(debounceMs, maxWaitRemaining),
    );
  };

  const capturePendingSnapshot = (): boolean => {
    const pending = pendingSnapshot;
    if (disposed || pending === null || pending.generation !== generation) {
      return true;
    }
    pendingSnapshot = null;
    try {
      latest = pending.readJson();
      scheduleFlush();
      return true;
    } catch (error) {
      emitError(error);
      emitStatus("error");
      return false;
    }
  };

  const flush = async (): Promise<void> => {
    if (!capturePendingSnapshot()) {
      return;
    }
    const json = latest;
    if (disposed || json === null) {
      return;
    }
    if (inFlight) {
      flushAgain = true;
      return inFlight;
    }
    clearPendingTimer();
    burstStartedAt = null;
    const saveGeneration = generation;
    emitStatus("saving");
    inFlight = (async () => {
      try {
        const result = await save(json);
        if (disposed || saveGeneration !== generation || latest !== json) {
          return;
        }
        if (!result.ok) {
          emitError(result.error ?? "Save failed");
          emitStatus("error");
          return;
        }
        emitStatus("saved");
      } catch (error) {
        if (disposed || saveGeneration !== generation || latest !== json) {
          return;
        }
        emitError(error);
        emitStatus("error");
      } finally {
        inFlight = null;
        if (!disposed && flushAgain && saveGeneration !== generation) {
          flushAgain = false;
          await flush();
        } else {
          flushAgain = false;
        }
      }
    })();
    return inFlight;
  };

  return {
    queue(json) {
      if (disposed) return;
      pendingSnapshot = null;
      latest = json;
      generation += 1;
      if (inFlight) {
        flushAgain = true;
      }
      emitStatus("pending");
      scheduleFlush();
    },
    queueSnapshot(readJson) {
      if (disposed) return;
      generation += 1;
      pendingSnapshot = { generation, readJson };
      if (inFlight) {
        flushAgain = true;
      }
      emitStatus("pending");
      clearPendingTimer();
      scheduleMicrotask(capturePendingSnapshot);
    },
    flush,
    dispose() {
      disposed = true;
      clearPendingTimer();
    },
    latestJson: () => latest,
  };
}

export function queueAutosaveForLexicalUpdate({
  controller,
  editor,
  tags,
  shouldAutosaveUpdate,
}: {
  controller: AutosaveController;
  editor: LexicalEditor;
  tags: Set<string>;
  shouldAutosaveUpdate(tags: Set<string>): boolean;
}): void {
  if (!shouldAutosaveUpdate(tags)) {
    return;
  }
  controller.queueSnapshot(() =>
    JSON.stringify(editor.getEditorState().toJSON()),
  );
}

/* @preserve node:coverage ignore start -- React hook lifecycle requires a DOM-capable renderer; controller behavior is covered headlessly. */
export function useLexicalAutosave({
  save,
  shouldAutosaveUpdate,
  debounceMs = DEFAULT_SAVE_DEBOUNCE_MS,
}: {
  save: LexicalSaveFn;
  shouldAutosaveUpdate(tags: Set<string>): boolean;
  debounceMs?: number;
}) {
  const [status, setStatus] = useState<SaveStatus>("saved");
  const controllerRef = useRef<AutosaveController | null>(null);

  useEffect(() => {
    /* node:coverage ignore next 7 -- Hook lifecycle is exercised by mounted editor coverage; controller behavior is covered headlessly. */
    const controller = createAutosaveController({
      save,
      debounceMs,
      onStatus: setStatus,
      onError: (error) => console.error(error),
    });
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    };
  }, [save, debounceMs]);

  const handleChange = useCallback(
    (_editorState: EditorState, editor: LexicalEditor, tags: Set<string>) => {
      const controller = controllerRef.current;
      if (!controller) {
        return;
      }
      queueAutosaveForLexicalUpdate({
        controller,
        editor,
        tags,
        shouldAutosaveUpdate,
      });
    },
    [shouldAutosaveUpdate],
  );

  return { status, handleChange };
}
/* @preserve node:coverage ignore stop */
