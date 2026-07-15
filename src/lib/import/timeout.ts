/**
 * Bounded-time execution for the document import parsers (#96, criterion 3).
 *
 * Heavy parsers (mammoth, jszip, pdf-parse) run server-side on attacker-
 * supplied bytes and can be coerced into pathological CPU/IO time. Wrapping each
 * parse in {@link withTimeout} guarantees the route rejects with a clear error
 * instead of pinning the Node.js runtime indefinitely.
 *
 * The helper is pure with respect to its inputs (it takes a promise factory and
 * a clock-free timeout) so it can be unit-tested deterministically.
 */
import { IMPORT_PARSE_TIMEOUT_MS } from "@/lib/import/format-registry";

/** Default per-parse timeout in milliseconds. */
export const DEFAULT_PARSE_TIMEOUT_MS = IMPORT_PARSE_TIMEOUT_MS;
const DEFAULT_ABORT_CLEANUP_WAIT_MS = 300;

/** Thrown when a wrapped operation does not settle within its timeout. */
export class ParseTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Parsing timed out after ${timeoutMs}ms.`);
    this.name = "ParseTimeoutError";
  }
}

/** Thrown when an import parse is aborted cooperatively. */
export class ParseAbortedError extends Error {
  constructor(message = "Parsing was aborted.") {
    super(message);
    this.name = "ParseAbortedError";
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw new ParseAbortedError();
}

export type WithTimeoutOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
  abortCleanupWaitMs?: number;
  onCleanupError?: (error: unknown) => void;
};

type ResolvedTimeoutOptions = {
  timeoutMs: number;
  signal?: AbortSignal;
  abortCleanupWaitMs: number;
  onCleanupError?: (error: unknown) => void;
};

function reportCleanupError(
  callback: ((error: unknown) => void) | undefined,
  error: unknown,
): void {
  if (!callback) return;
  try {
    callback(error);
  } catch {
    // Cleanup logging must never surface into product behavior.
  }
}

async function waitForAbortCleanup(
  operation: Promise<unknown> | null,
  maxWaitMs: number,
  onCleanupError?: (error: unknown) => void,
): Promise<void> {
  if (!operation || maxWaitMs <= 0) {
    return;
  }
  try {
    await Promise.race([
      operation.then(
        () => undefined,
        () => undefined,
      ),
      new Promise<void>((resolve) => {
        setTimeout(resolve, maxWaitMs);
      }),
    ]);
  } catch (error) {
    reportCleanupError(onCleanupError, error);
  }
}

function resolveOptions(
  timeoutOrOptions: number | WithTimeoutOptions | undefined,
  abortCleanupWaitMs: number | undefined,
): ResolvedTimeoutOptions {
  if (typeof timeoutOrOptions === "number") {
    return {
      timeoutMs: timeoutOrOptions,
      abortCleanupWaitMs: abortCleanupWaitMs ?? DEFAULT_ABORT_CLEANUP_WAIT_MS,
    };
  }
  const options = timeoutOrOptions ?? {};
  return {
    timeoutMs: options.timeoutMs ?? DEFAULT_PARSE_TIMEOUT_MS,
    signal: options.signal,
    abortCleanupWaitMs:
      options.abortCleanupWaitMs ?? DEFAULT_ABORT_CLEANUP_WAIT_MS,
    onCleanupError: options.onCleanupError,
  };
}

/**
 * Runs `factory(signal)` under a timeout budget. On timeout the helper aborts the
 * signal, waits briefly for adapter cleanup, then rejects with
 * {@link ParseTimeoutError}.
 */
export function withTimeout<T>(
  factory: (signal: AbortSignal) => Promise<T>,
  timeoutOrOptions: number | WithTimeoutOptions = DEFAULT_PARSE_TIMEOUT_MS,
  abortCleanupWaitMs?: number,
): Promise<T> {
  const options = resolveOptions(timeoutOrOptions, abortCleanupWaitMs);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let operation: Promise<T> | null = null;
  let settled = false;
  let terminal: "none" | "timeout" | "aborted" = "none";
  let externalAbortListener: (() => void) | undefined;

  const clearTimer = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };

  const removeExternalAbortListener = () => {
    if (!options.signal || !externalAbortListener) return;
    options.signal.removeEventListener("abort", externalAbortListener);
    externalAbortListener = undefined;
  };

  const cleanup = () => {
    clearTimer();
    removeExternalAbortListener();
  };

  return new Promise<T>((resolve, reject) => {
    const settleResolve = (value: T) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const settleReject = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const rejectTerminal = (reason: "timeout" | "aborted") => {
      if (settled || terminal !== "none") return;
      terminal = reason;
      controller.abort();
      void waitForAbortCleanup(
        operation,
        options.abortCleanupWaitMs,
        options.onCleanupError,
      ).then(() => {
        settleReject(
          reason === "timeout"
            ? new ParseTimeoutError(options.timeoutMs)
            : new ParseAbortedError(),
        );
      });
    };

    if (options.signal?.aborted) {
      rejectTerminal("aborted");
      return;
    }
    if (options.signal) {
      externalAbortListener = () => {
        rejectTerminal("aborted");
      };
      options.signal.addEventListener("abort", externalAbortListener, {
        once: true,
      });
    }

    timer = setTimeout(() => {
      rejectTerminal("timeout");
    }, options.timeoutMs);

    operation = Promise.resolve().then(() => factory(controller.signal));
    operation.then(
      (value) => {
        if (terminal !== "none") return;
        settleResolve(value);
      },
      (error: unknown) => {
        if (terminal !== "none") {
          reportCleanupError(options.onCleanupError, error);
          return;
        }
        if (error instanceof ParseAbortedError) {
          settleReject(error);
          return;
        }
        if (
          controller.signal.aborted &&
          error instanceof DOMException &&
          error.name === "AbortError"
        ) {
          settleReject(new ParseAbortedError());
          return;
        }
        settleReject(error);
      },
    );
  });
}
