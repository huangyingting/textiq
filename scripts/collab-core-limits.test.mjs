import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  allowUpgradeAttempt,
  clientIpFromUpgrade,
  collabLimits,
  pruneExpiredUpgradeWindows,
  trustProxyForUpgrade,
  upgradeWindows,
} from "./collab-core-limits.mjs";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  upgradeWindows.clear();
});

test("collab limits resolve configured positive env values", () => {
  process.env.COLLAB_MAX_CONNECTIONS_PER_ROOM = "3";
  process.env.COLLAB_MAX_CONNECTIONS_TOTAL = "4";
  process.env.COLLAB_MAX_MESSAGE_BYTES = "5";
  process.env.COLLAB_MAX_MESSAGES_PER_WINDOW = "6";
  process.env.COLLAB_MESSAGE_WINDOW_MS = "7";
  process.env.COLLAB_MAX_AWARENESS_BYTES = "8";

  assert.deepEqual(collabLimits(), {
    maxConnectionsPerRoom: 3,
    maxConnectionsTotal: 4,
    maxMessageBytes: 5,
    maxMessagesPerWindow: 6,
    messageWindowMs: 7,
    maxAwarenessBytes: 8,
  });
});

test("clientIpFromUpgrade ignores spoofable proxy headers unless trust proxy is enabled", () => {
  process.env.COLLAB_TRUST_PROXY = "yes";

  assert.equal(trustProxyForUpgrade(), false);
  assert.equal(
    clientIpFromUpgrade({
      headers: {
        "x-forwarded-for": "198.51.100.1, 198.51.100.2",
        "x-real-ip": "198.51.100.3",
      },
      socket: { remoteAddress: "203.0.113.10" },
    }),
    "203.0.113.10",
  );
  assert.equal(clientIpFromUpgrade({ headers: {}, socket: {} }), "unknown");
});

test("clientIpFromUpgrade defaults to remoteAddress when trust proxy is unset", () => {
  delete process.env.COLLAB_TRUST_PROXY;

  assert.equal(trustProxyForUpgrade(), false);
  assert.equal(
    clientIpFromUpgrade({
      headers: { "x-forwarded-for": "198.51.100.1" },
      socket: { remoteAddress: "203.0.113.12" },
    }),
    "203.0.113.12",
  );
});

test("clientIpFromUpgrade trusts x-forwarded-for only when explicitly enabled", () => {
  process.env.COLLAB_TRUST_PROXY = "1";

  assert.equal(trustProxyForUpgrade(), true);
  assert.equal(
    clientIpFromUpgrade({
      headers: { "x-forwarded-for": "198.51.100.1, 198.51.100.2" },
      socket: { remoteAddress: "203.0.113.10" },
    }),
    "198.51.100.1",
  );
});

test("clientIpFromUpgrade trusts x-real-ip fallback when proxy trust is enabled", () => {
  process.env.COLLAB_TRUST_PROXY = "true";

  assert.equal(trustProxyForUpgrade(), true);
  assert.equal(
    clientIpFromUpgrade({
      headers: { "x-forwarded-for": "  ", "x-real-ip": "198.51.100.3" },
      socket: { remoteAddress: "203.0.113.10" },
    }),
    "198.51.100.3",
  );
});

test("clientIpFromUpgrade falls back to remoteAddress when trusted proxy headers are absent", () => {
  process.env.COLLAB_TRUST_PROXY = "TRUE";

  assert.equal(
    clientIpFromUpgrade({
      headers: {},
      socket: { remoteAddress: "203.0.113.11" },
    }),
    "203.0.113.11",
  );
});

test("pruneExpiredUpgradeWindows deletes expired windows and preserves active ones", () => {
  upgradeWindows.set("expired-a", { count: 1, resetAt: 10 });
  upgradeWindows.set("active", { count: 2, resetAt: 30 });
  upgradeWindows.set("expired-b", { count: 3, resetAt: 20 });

  pruneExpiredUpgradeWindows(20);

  assert.equal(upgradeWindows.has("expired-a"), false);
  assert.equal(upgradeWindows.has("expired-b"), false);
  assert.deepEqual(upgradeWindows.get("active"), { count: 2, resetAt: 30 });
});

test("allowUpgradeAttempt allows, denies, and resets with bounded window storage", () => {
  process.env.COLLAB_UPGRADE_RATE_LIMIT = "2";
  process.env.COLLAB_UPGRADE_RATE_WINDOW_MS = "10";
  upgradeWindows.set("stale", { count: 99, resetAt: 0 });
  upgradeWindows.set("active-peer", { count: 1, resetAt: 50 });

  assert.equal(allowUpgradeAttempt("203.0.113.20", 0), true);
  assert.equal(upgradeWindows.has("stale"), false);
  assert.equal(allowUpgradeAttempt("203.0.113.20", 5), true);
  assert.equal(allowUpgradeAttempt("203.0.113.20", 9), false);
  assert.equal(allowUpgradeAttempt("203.0.113.20", 10), true);

  assert.deepEqual(upgradeWindows.get("203.0.113.20"), {
    count: 1,
    resetAt: 20,
  });
  assert.equal(upgradeWindows.has("active-peer"), true);
});
