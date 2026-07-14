/**
 * Core Yjs websocket sync logic for TextIQ real-time collaboration
 * (US-019), factored out of the standalone server so it can be hosted either as
 * its own process (`scripts/collab-server.mjs`) or mounted on the Next.js HTTP
 * server (`server.mjs`) at a path.
 */

export {
  createCollabWss,
  ROOM_IDLE_TTL_MS,
  roomCount,
  connCount,
  shouldEvict,
} from "./collab-core-room-lifecycle.mjs";

export {
  hasPendingUpdates,
  setRoomSavedStateVector,
  getRoomSavedStateVector,
  markRoomSaved,
} from "./collab-core-durability.mjs";

export {
  recordFlushAttempt,
  recordFlushFailure,
  recentFlushFailures,
  flushStats,
} from "./collab-core-observability.mjs";

import {
  allowUpgradeAttempt,
  collabLimits,
  upgradeWindows,
} from "./collab-core-limits.mjs";
import { savedStateVectors } from "./collab-core-durability.mjs";
import {
  flushCounters,
  flushFailureRing,
} from "./collab-core-observability.mjs";
import {
  cancelEviction,
  docs,
  evictRoom,
  evictTimers,
  messageListener,
  rawSocketClosed,
  scheduleEviction,
  send,
  setupConnection,
} from "./collab-core-room-lifecycle.mjs";

/**
 * Test-only helpers — not part of the public API.
 * Allows unit tests to inspect eviction state and trigger eviction with a
 * custom TTL without needing real WebSocket connections.
 */
export const _testOnly = {
  docs,
  evictTimers,
  upgradeWindows,
  savedStateVectors,
  collabLimits,
  allowUpgradeAttempt,
  messageListener,
  setupConnection,
  send,
  rawSocketClosed,
  scheduleEviction,
  cancelEviction,
  evictRoom,
  flushFailureRing,
  flushCounters,
};
