import assert from "node:assert/strict";
import { test } from "node:test";

import {
  acquirePurgeLock,
  PURGE_MIN_INTERVAL_MS,
  resetPurgeLockForTesting,
  shouldRunPurge,
} from "./maintenance";

// ---------------------------------------------------------------------------
// shouldRunPurge
// ---------------------------------------------------------------------------

test("shouldRunPurge: never run before → should run", () => {
  assert.equal(shouldRunPurge(null, Date.now(), PURGE_MIN_INTERVAL_MS), true);
});

test("shouldRunPurge: just ran (0ms ago) → should not run", () => {
  const now = Date.now();
  assert.equal(shouldRunPurge(now, now, PURGE_MIN_INTERVAL_MS), false);
});

test("shouldRunPurge: ran just under interval ago → should not run", () => {
  const now = Date.now();
  const lastRun = now - PURGE_MIN_INTERVAL_MS + 1;
  assert.equal(shouldRunPurge(lastRun, now, PURGE_MIN_INTERVAL_MS), false);
});

test("shouldRunPurge: ran exactly interval ago → should run", () => {
  const now = Date.now();
  const lastRun = now - PURGE_MIN_INTERVAL_MS;
  assert.equal(shouldRunPurge(lastRun, now, PURGE_MIN_INTERVAL_MS), true);
});

test("shouldRunPurge: ran well past interval ago → should run", () => {
  const now = Date.now();
  const lastRun = now - PURGE_MIN_INTERVAL_MS * 3;
  assert.equal(shouldRunPurge(lastRun, now, PURGE_MIN_INTERVAL_MS), true);
});

test("shouldRunPurge: custom interval respected", () => {
  const now = 10_000;
  assert.equal(shouldRunPurge(9_500, now, 600), false); // 500ms < 600ms
  assert.equal(shouldRunPurge(9_400, now, 600), true); // 600ms >= 600ms
});

// ---------------------------------------------------------------------------
// acquirePurgeLock
// ---------------------------------------------------------------------------

test("acquirePurgeLock: first call acquires lock", () => {
  resetPurgeLockForTesting();
  assert.equal(acquirePurgeLock(1000), true);
});

test("acquirePurgeLock: second call within interval is blocked", () => {
  resetPurgeLockForTesting();
  assert.equal(acquirePurgeLock(1000), true);
  assert.equal(acquirePurgeLock(1000 + PURGE_MIN_INTERVAL_MS - 1), false);
});

test("acquirePurgeLock: call after interval elapses acquires again", () => {
  resetPurgeLockForTesting();
  assert.equal(acquirePurgeLock(1000), true);
  assert.equal(acquirePurgeLock(1000 + PURGE_MIN_INTERVAL_MS), true);
});

test("acquirePurgeLock: reset restores first-call behaviour", () => {
  resetPurgeLockForTesting();
  acquirePurgeLock(1000);
  resetPurgeLockForTesting();
  assert.equal(acquirePurgeLock(1001), true);
});
