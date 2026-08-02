/**
 * Unit tests for the eviction-flush helper (#497/#499) in collab-flush.mjs.
 *
 * Uses a mock `fetchImpl` so no network or DB is touched. Covers:
 *  - no-op behavior when the internal secret / flush URL is missing.
 *  - a successful flush POSTs the base64 update + secret header and does NOT
 *    record a failure.
 *  - a deleted document's 404 is a terminal skip, not a recovery failure.
 *  - a non-2xx response records a failure in the observability ring and bumps
 *    the failure counter (and the attempt counter).
 *  - a thrown fetch (network error) records a failure and never re-throws.
 *
 * Run with: node --test scripts/collab-flush.test.mjs
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { createEvictionFlusher } from "./collab-flush.mjs";
import { flushStats, recentFlushFailures, _testOnly } from "./collab-core.mjs";

const { flushFailureRing, flushCounters } = _testOnly;
const originalConsole = {
  info: console.info,
  warn: console.warn,
  error: console.error,
};
const originalEnv = { ...process.env };

/** Reset the shared observability ring + counters between tests. */
function resetObservability() {
  flushFailureRing.length = 0;
  flushCounters.flushAttempts = 0;
  flushCounters.flushFailures = 0;
}

beforeEach(() => {
  console.info = () => {};
  console.warn = () => {};
  console.error = () => {};
});

afterEach(() => {
  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  process.env = { ...originalEnv };
});

const ROOM = "doc-flush-room";
const UPDATE = new Uint8Array([1, 2, 3, 4, 5]);

describe("createEvictionFlusher: no-op when not configured", () => {
  beforeEach(resetObservability);

  it("returns a no-op when the internal secret is missing", async () => {
    let called = false;
    const flush = createEvictionFlusher({
      flushUrl: "http://app/api/collab/flush",
      internalSecret: undefined,
      fetchImpl: async () => {
        called = true;
        return { ok: true, status: 200 };
      },
    });
    await flush(ROOM, UPDATE);
    assert.equal(called, false, "fetch must not be called without a secret");
    assert.equal(flushStats().flushAttempts, 0);
  });

  it("returns a no-op when the flush URL is missing", async () => {
    let called = false;
    const flush = createEvictionFlusher({
      flushUrl: undefined,
      internalSecret: "s3cret",
      fetchImpl: async () => {
        called = true;
        return { ok: true, status: 200 };
      },
    });
    await flush(ROOM, UPDATE);
    assert.equal(called, false, "fetch must not be called without a URL");
  });

  it("can build a no-op without an injected fetch implementation", async () => {
    const flush = createEvictionFlusher({
      flushUrl: "http://app/api/collab/flush",
      internalSecret: undefined,
    });

    await flush(ROOM, UPDATE);

    assert.equal(flushStats().flushAttempts, 0);
  });
});

describe("createEvictionFlusher: successful flush", () => {
  beforeEach(resetObservability);

  it("POSTs the base64 update + secret header and records no failure", async () => {
    let captured = null;
    const flush = createEvictionFlusher({
      flushUrl: "http://app/api/collab/flush",
      internalSecret: "s3cret",
      fetchImpl: async (url, init) => {
        captured = { url, init };
        return { ok: true, status: 200 };
      },
    });

    await flush(ROOM, UPDATE);

    assert.ok(captured, "fetch should have been called");
    assert.equal(captured.url, "http://app/api/collab/flush");
    assert.equal(captured.init.method, "POST");
    assert.equal(
      captured.init.headers["x-collab-internal-secret"],
      "s3cret",
      "internal secret header must be sent",
    );
    const body = JSON.parse(captured.init.body);
    assert.equal(body.documentId, ROOM);
    assert.equal(body.room, ROOM);
    assert.equal(
      body.update,
      Buffer.from(UPDATE).toString("base64"),
      "update must be base64-encoded",
    );

    assert.equal(flushStats().flushAttempts, 1);
    assert.equal(flushStats().flushFailures, 0);
    assert.equal(recentFlushFailures().length, 0);
  });

  it("emits structured logs without leaking update bytes or secrets", async () => {
    const lines = [];
    console.info = (line) => lines.push(String(line));
    console.error = (line) => lines.push(String(line));
    const flush = createEvictionFlusher({
      flushUrl: "http://app/api/collab/flush",
      internalSecret: "s3cret",
      fetchImpl: async () => ({ ok: true, status: 200 }),
    });

    await flush(ROOM, UPDATE);

    assert.equal(lines.length, 2);
    const attempt = JSON.parse(lines[0]);
    const success = JSON.parse(lines[1]);
    assert.equal(attempt.scope, "collab.flush.attempt");
    assert.equal(success.scope, "collab.flush.result");
    assert.ok(!lines.join("\n").includes("s3cret"));
    assert.ok(
      !lines.join("\n").includes(Buffer.from(UPDATE).toString("base64")),
    );
  });
});

describe("createEvictionFlusher: failed flush observability", () => {
  beforeEach(resetObservability);

  it("treats a deleted document's 404 as a terminal skip", async () => {
    const lines = [];
    console.info = (line) => lines.push(String(line));
    const flush = createEvictionFlusher({
      flushUrl: "http://app/api/collab/flush",
      internalSecret: "s3cret",
      fetchImpl: async () => ({ ok: false, status: 404 }),
    });

    await flush(ROOM, UPDATE);

    assert.equal(flushStats().flushAttempts, 1);
    assert.equal(flushStats().flushFailures, 0);
    assert.equal(recentFlushFailures().length, 0);
    assert.equal(lines.length, 2);
    const result = JSON.parse(lines[1]);
    assert.equal(result.scope, "collab.flush.result");
    assert.equal(result.ok, true);
    assert.equal(result.persisted, false);
    assert.equal(result.skipped, true);
    assert.equal(result.status, 404);
    assert.equal(result.skipReason, "document-not-found");
  });

  it("records a failure on a non-2xx response (never pretends success)", async () => {
    const flush = createEvictionFlusher({
      flushUrl: "http://app/api/collab/flush",
      internalSecret: "s3cret",
      fetchImpl: async () => ({ ok: false, status: 500 }),
    });

    await flush(ROOM, UPDATE);

    assert.equal(flushStats().flushAttempts, 1);
    assert.equal(flushStats().flushFailures, 1);
    const failures = recentFlushFailures();
    assert.equal(failures.length, 1);
    assert.equal(failures[0].room, ROOM);
    assert.equal(failures[0].docId, ROOM);
    assert.equal(failures[0].reason, "http_500");
    assert.ok(failures[0].at, "failure should carry a timestamp");
  });

  it("records a failure when fetch throws and never re-throws", async () => {
    const flush = createEvictionFlusher({
      flushUrl: "http://app/api/collab/flush",
      internalSecret: "s3cret",
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });

    // Must resolve, not reject — eviction must always complete.
    await flush(ROOM, UPDATE);

    assert.equal(flushStats().flushFailures, 1);
    assert.equal(recentFlushFailures().length, 1);
    assert.equal(recentFlushFailures()[0].room, ROOM);
  });

  it("uses network_error for nameless or non-Error fetch failures", async () => {
    const nameless = new Error("socket closed");
    nameless.name = "";
    const failures = [nameless, "socket closed"];
    const flush = createEvictionFlusher({
      flushUrl: "http://app/api/collab/flush",
      internalSecret: "s3cret",
      fetchImpl: async () => {
        throw failures.shift();
      },
    });

    await flush(`${ROOM}-nameless`, UPDATE);
    await flush(`${ROOM}-string`, UPDATE);

    assert.equal(flushStats().flushFailures, 2);
    assert.deepEqual(
      recentFlushFailures().map((failure) => failure.reason),
      ["network_error", "network_error"],
    );
  });

  it("aborts and records a handled failure when the flush request times out", async () => {
    process.env.COLLAB_FLUSH_TIMEOUT_MS = "1";
    let capturedSignal = null;
    let abortObserved = false;
    const flush = createEvictionFlusher({
      flushUrl: "http://app/api/collab/flush",
      internalSecret: "s3cret",
      fetchImpl: async (_url, init) =>
        new Promise((_resolve, reject) => {
          capturedSignal = init.signal;
          const abort = () => {
            abortObserved = true;
            const err = new Error("flush timed out");
            err.name = "AbortError";
            reject(err);
          };
          init.signal.addEventListener("abort", abort, { once: true });
          if (init.signal.aborted) abort();
        }),
    });

    const keepAlive = setInterval(() => {}, 1000);
    try {
      await flush(ROOM, UPDATE);
    } finally {
      clearInterval(keepAlive);
    }

    assert.ok(capturedSignal, "fetch should receive an AbortSignal");
    assert.equal(capturedSignal.aborted, true);
    assert.equal(abortObserved, true);
    assert.equal(flushStats().flushAttempts, 1);
    assert.equal(flushStats().flushFailures, 1);
    assert.equal(recentFlushFailures()[0].reason, "AbortError");
  });

  it("caps the failure ring at 20 entries", async () => {
    const flush = createEvictionFlusher({
      flushUrl: "http://app/api/collab/flush",
      internalSecret: "s3cret",
      fetchImpl: async () => ({ ok: false, status: 503 }),
    });

    for (let i = 0; i < 25; i += 1) {
      await flush(`${ROOM}-${i}`, UPDATE);
    }

    assert.equal(recentFlushFailures().length, 20);
    assert.equal(flushStats().flushFailures, 25);
    // Oldest entries are dropped; the last 20 remain.
    assert.equal(recentFlushFailures()[0].room, `${ROOM}-5`);
  });
});
