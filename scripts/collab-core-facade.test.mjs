import assert from "node:assert/strict";
import { describe, test } from "node:test";

import * as coreNamespace from "./collab-core.mjs";
import {
  ROOM_IDLE_TTL_MS,
  connCount,
  createCollabWss,
  flushStats,
  getRoomSavedStateVector,
  hasPendingUpdates,
  markRoomSaved,
  recentFlushFailures,
  roomCount,
  setRoomSavedStateVector,
  shouldEvict,
  _testOnly,
} from "./collab-core.mjs";
import {
  ROOM_IDLE_TTL_MS as ROOM_IDLE_TTL_MS_IMPL,
  connCount as connCountImpl,
  createCollabWss as createCollabWssImpl,
  roomCount as roomCountImpl,
  shouldEvict as shouldEvictImpl,
} from "./collab-core-room-lifecycle.mjs";
import {
  getRoomSavedStateVector as getRoomSavedStateVectorImpl,
  hasPendingUpdates as hasPendingUpdatesImpl,
  markRoomSaved as markRoomSavedImpl,
  savedStateVectors,
  setRoomSavedStateVector as setRoomSavedStateVectorImpl,
} from "./collab-core-durability.mjs";
import {
  flushCounters,
  flushFailureRing,
  flushStats as flushStatsImpl,
  recentFlushFailures as recentFlushFailuresImpl,
} from "./collab-core-observability.mjs";
import { collabLimits, upgradeWindows } from "./collab-core-limits.mjs";

const EXPECTED_FACADE_EXPORTS = [
  "ROOM_IDLE_TTL_MS",
  "connCount",
  "createCollabWss",
  "flushStats",
  "getRoomSavedStateVector",
  "hasPendingUpdates",
  "markRoomSaved",
  "recentFlushFailures",
  "recordFlushAttempt",
  "recordFlushFailure",
  "roomCount",
  "setRoomSavedStateVector",
  "shouldEvict",
  "_testOnly",
].sort();

describe("collab-core facade parity", () => {
  test("re-exports room lifecycle helpers", () => {
    assert.equal(createCollabWss, createCollabWssImpl);
    assert.equal(roomCount, roomCountImpl);
    assert.equal(connCount, connCountImpl);
    assert.equal(shouldEvict, shouldEvictImpl);
    assert.equal(ROOM_IDLE_TTL_MS, ROOM_IDLE_TTL_MS_IMPL);
  });

  test("re-exports durability helpers", () => {
    assert.equal(hasPendingUpdates, hasPendingUpdatesImpl);
    assert.equal(setRoomSavedStateVector, setRoomSavedStateVectorImpl);
    assert.equal(getRoomSavedStateVector, getRoomSavedStateVectorImpl);
    assert.equal(markRoomSaved, markRoomSavedImpl);
  });

  test("re-exports observability helpers", () => {
    assert.equal(flushStats, flushStatsImpl);
    assert.equal(recentFlushFailures, recentFlushFailuresImpl);
  });

  test("keeps _testOnly wired to shared module state", () => {
    assert.equal(_testOnly.savedStateVectors, savedStateVectors);
    assert.equal(_testOnly.flushFailureRing, flushFailureRing);
    assert.equal(_testOnly.flushCounters, flushCounters);
    assert.equal(_testOnly.upgradeWindows, upgradeWindows);
    assert.equal(_testOnly.collabLimits, collabLimits);
  });

  test("exact facade namespace matches stable public surface — no accidental mutable exports", () => {
    const actual = Object.keys(coreNamespace).sort();
    assert.deepEqual(
      actual,
      EXPECTED_FACADE_EXPORTS,
      "collab-core.mjs exports diverged from the expected stable surface",
    );
  });

  test("mutable internals are not reachable except through _testOnly", () => {
    assert.equal(
      "savedStateVectors" in coreNamespace,
      false,
      "savedStateVectors must not be a direct facade export",
    );
    assert.equal(
      "flushFailureRing" in coreNamespace,
      false,
      "flushFailureRing must not be a direct facade export",
    );
    assert.equal(
      "flushCounters" in coreNamespace,
      false,
      "flushCounters must not be a direct facade export",
    );
  });
});
