import assert from "node:assert/strict";
import test from "node:test";

import {
  applySessionSecurityStampToToken,
  isSessionSecurityStampCurrent,
} from "@/lib/auth/session-security";

test("session security stamps reject JWT payloads issued before rotation", () => {
  const oldStamp = "2026-07-04T20:00:00.000Z";
  const rotatedAt = new Date("2026-07-04T21:00:00.000Z");

  assert.equal(isSessionSecurityStampCurrent(oldStamp, rotatedAt), false);
  assert.equal(
    isSessionSecurityStampCurrent(rotatedAt.toISOString(), rotatedAt),
    true,
  );
});

test("session security token stamping preserves null for never-rotated accounts", () => {
  assert.deepEqual(
    applySessionSecurityStampToToken(
      {},
      { id: "u1", sessionInvalidatedAt: null },
    ),
    { id: "u1", sessionInvalidatedAt: null },
  );
});
