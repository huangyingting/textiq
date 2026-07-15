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

async function waitForAbortCleanup(
  operation: Promise<unknown>,
  maxWaitMs: number,
): Promise<void> {
  if (maxWaitMs <= 0) {
    return;
  }
  await Promise.race([
    operation.then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((resolve) => {
      setTimeout(resolve, maxWaitMs);
    }),
  ]);
}

/**
 * Runs `factory(signal)` under a timeout budget. On timeout the helper aborts the
 * signal, waits briefly for adapter cleanup, then rejects with
 * {@link ParseTimeoutError}.
 */
export function withTimeout<T>(
  factory: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number = DEFAULT_PARSE_TIMEOUT_MS,
  abortCleanupWaitMs: number = DEFAULT_ABORT_CLEANUP_WAIT_MS,
): Promise<T> {
  const controller = new AbortController();
  const operation = Promise.resolve().then(() => factory(controller.signal));
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(async () => {
      timedOut = true;
      controller.abort();
      await waitForAbortCleanup(operation, abortCleanupWaitMs);
      reject(new ParseTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  const guardedOperation = operation.catch((error: unknown) => {
    if (timedOut) {
      throw new ParseTimeoutError(timeoutMs);
    }
    if (error instanceof ParseAbortedError) {
      throw error;
    }
    if (
      controller.signal.aborted &&
      error instanceof DOMException &&
      error.name === "AbortError"
    ) {
      throw new ParseAbortedError();
    }
    throw error;
  });

  return Promise.race([guardedOperation, timeout]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
}
