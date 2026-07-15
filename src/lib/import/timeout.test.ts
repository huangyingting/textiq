import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PARSE_TIMEOUT_MS,
  ParseAbortedError,
  ParseTimeoutError,
  withTimeout,
} from "./timeout";

test("withTimeout resolves with the value when the factory settles in time", async () => {
  const value = await withTimeout(async () => "parsed", { timeoutMs: 1000 });
  assert.equal(value, "parsed");
});

test("withTimeout rejects with ParseTimeoutError when the factory hangs", async () => {
  await assert.rejects(
    () => withTimeout(() => new Promise<string>(() => {}), { timeoutMs: 10 }),
    (error: unknown) => {
      assert.ok(error instanceof ParseTimeoutError);
      assert.match((error as Error).message, /10ms/);
      return true;
    },
  );
});

test("withTimeout propagates a rejection from the factory unchanged", async () => {
  const boom = new Error("parser exploded");
  await assert.rejects(
    () =>
      withTimeout(
        async () => {
          throw boom;
        },
        { timeoutMs: 1000 },
      ),
    (error: unknown) => {
      assert.equal(error, boom);
      assert.ok(!(error instanceof ParseTimeoutError));
      return true;
    },
  );
});

test("withTimeout resolves a slow-but-in-time factory without firing the timeout", async () => {
  const value = await withTimeout(
    () => new Promise<number>((resolve) => setTimeout(() => resolve(42), 5)),
    { timeoutMs: 1000 },
  );
  assert.equal(value, 42);
});

test("DEFAULT_PARSE_TIMEOUT_MS is a sane positive default", () => {
  assert.ok(DEFAULT_PARSE_TIMEOUT_MS > 0);
});

test("withTimeout aborts the parser signal when timing out", async () => {
  let sawAbort = false;
  await assert.rejects(
    () =>
      withTimeout(
        (signal) =>
          new Promise<string>((_resolve, reject) => {
            signal.addEventListener("abort", () => {
              sawAbort = true;
              reject(new ParseAbortedError());
            });
          }),
        { timeoutMs: 10, abortCleanupWaitMs: 0 },
      ),
    (error: unknown) => error instanceof ParseTimeoutError,
  );
  assert.equal(sawAbort, true);
});

test("withTimeout waits briefly for abort cleanup before rejecting timeout", async () => {
  let cleanupFinished = false;
  const startedAt = Date.now();
  await assert.rejects(
    () =>
      withTimeout(
        (signal) =>
          new Promise<string>((_resolve, reject) => {
            signal.addEventListener("abort", () => {
              setTimeout(() => {
                cleanupFinished = true;
                reject(new ParseAbortedError());
              }, 20);
            });
          }),
        { timeoutMs: 5, abortCleanupWaitMs: 40 },
      ),
    (error: unknown) => error instanceof ParseTimeoutError,
  );
  assert.equal(cleanupFinished, true);
  assert.ok(Date.now() - startedAt >= 20);
});

test("withTimeout rejects on external abort", async () => {
  const external = new AbortController();
  const parsing = withTimeout(
    (signal) =>
      new Promise<string>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new ParseAbortedError()),
          { once: true },
        );
      }),
    { timeoutMs: 1_000, signal: external.signal },
  );
  external.abort();

  await assert.rejects(
    () => parsing,
    (error: unknown) => error instanceof ParseAbortedError,
  );
});

test("withTimeout keeps timeout outcome even when the parser resolves after abort", async () => {
  await assert.rejects(
    () =>
      withTimeout(
        (signal) =>
          new Promise<string>((resolve) => {
            signal.addEventListener(
              "abort",
              () => {
                setTimeout(() => resolve("late-success"), 5);
              },
              { once: true },
            );
          }),
        { timeoutMs: 1, abortCleanupWaitMs: 15 },
      ),
    (error: unknown) => error instanceof ParseTimeoutError,
  );
});

test("withTimeout consistently rejects late resolves across repeated invocations", async () => {
  for (let run = 0; run < 3; run += 1) {
    await assert.rejects(
      () =>
        withTimeout(
          (signal) =>
            new Promise<string>((resolve) => {
              signal.addEventListener(
                "abort",
                () => {
                  setTimeout(() => resolve(`late-${run}`), 5);
                },
                { once: true },
              );
            }),
          { timeoutMs: 1, abortCleanupWaitMs: 15 },
        ),
      (error: unknown) => error instanceof ParseTimeoutError,
    );
  }
});

test("withTimeout reports late cleanup rejections and does not leak unhandled rejections", async () => {
  const cleanupErrors: unknown[] = [];
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);

  try {
    await assert.rejects(
      () =>
        withTimeout(
          (signal) =>
            new Promise<string>((_resolve, reject) => {
              signal.addEventListener(
                "abort",
                () => {
                  setTimeout(
                    () => reject(new Error("late-cleanup-failure")),
                    5,
                  );
                },
                { once: true },
              );
            }),
          {
            timeoutMs: 1,
            abortCleanupWaitMs: 0,
            onCleanupError: (error) => {
              cleanupErrors.push(error);
            },
          },
        ),
      (error: unknown) => error instanceof ParseTimeoutError,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(cleanupErrors.length, 1);
    assert.equal(unhandled.length, 0);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});
