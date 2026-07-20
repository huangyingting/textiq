import { readPositiveInt } from "./collab-utils.mjs";

const DEFAULT_MAX_CONNECTIONS_PER_ROOM = 50;
const DEFAULT_MAX_CONNECTIONS_TOTAL = 500;
const DEFAULT_MAX_MESSAGE_BYTES = 256 * 1024;
const DEFAULT_MAX_MESSAGES_PER_WINDOW = 120;
const DEFAULT_MESSAGE_WINDOW_MS = 10_000;
const DEFAULT_MAX_AWARENESS_BYTES = 16 * 1024;
const DEFAULT_UPGRADE_RATE_WINDOW_MS = 60_000;

export const upgradeWindows = new Map();

export const collabLimits = () => ({
  maxConnectionsPerRoom: readPositiveInt(
    process.env.COLLAB_MAX_CONNECTIONS_PER_ROOM,
    DEFAULT_MAX_CONNECTIONS_PER_ROOM,
  ),
  maxConnectionsTotal: readPositiveInt(
    process.env.COLLAB_MAX_CONNECTIONS_TOTAL,
    DEFAULT_MAX_CONNECTIONS_TOTAL,
  ),
  maxMessageBytes: readPositiveInt(
    process.env.COLLAB_MAX_MESSAGE_BYTES,
    DEFAULT_MAX_MESSAGE_BYTES,
  ),
  maxMessagesPerWindow: readPositiveInt(
    process.env.COLLAB_MAX_MESSAGES_PER_WINDOW,
    DEFAULT_MAX_MESSAGES_PER_WINDOW,
  ),
  messageWindowMs: readPositiveInt(
    process.env.COLLAB_MESSAGE_WINDOW_MS,
    DEFAULT_MESSAGE_WINDOW_MS,
  ),
  maxAwarenessBytes: readPositiveInt(
    process.env.COLLAB_MAX_AWARENESS_BYTES,
    DEFAULT_MAX_AWARENESS_BYTES,
  ),
});

export const trustProxyForUpgrade = () => {
  const raw = process.env.COLLAB_TRUST_PROXY;
  return (
    raw === "1" || (typeof raw === "string" && raw.toLowerCase() === "true")
  );
};

export const clientIpFromUpgrade = (req) => {
  const remoteAddress = req.socket?.remoteAddress || "unknown";
  if (!trustProxyForUpgrade()) {
    return remoteAddress;
  }

  const forwarded = req.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = req.headers?.["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim()) {
    return realIp.trim();
  }
  return remoteAddress;
};

export const pruneExpiredUpgradeWindows = (now = Date.now()) => {
  for (const [subject, window] of upgradeWindows.entries()) {
    if (now >= window.resetAt) {
      upgradeWindows.delete(subject);
    }
  }
};

export const allowUpgradeAttempt = (subject, now = Date.now()) => {
  const limit = readPositiveInt(
    process.env.COLLAB_UPGRADE_RATE_LIMIT,
    DEFAULT_MAX_MESSAGES_PER_WINDOW,
  );
  const windowMs = readPositiveInt(
    process.env.COLLAB_UPGRADE_RATE_WINDOW_MS,
    DEFAULT_UPGRADE_RATE_WINDOW_MS,
  );
  pruneExpiredUpgradeWindows(now);
  const existing = upgradeWindows.get(subject);
  if (!existing) {
    upgradeWindows.set(subject, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (existing.count >= limit) {
    return false;
  }
  existing.count += 1;
  return true;
};
