import assert from "node:assert/strict";
import test from "node:test";

import {
  anonTrialLimit,
  newAnonState,
  parseAnonCookie,
  signAnonState,
} from "@/lib/ai/quota";

const SECRET = "test-secret-value-1234567890";

test("anonTrialLimit reads a positive environment override", () => {
  const previous = process.env.ANON_GENERATION_LIMIT;
  process.env.ANON_GENERATION_LIMIT = "7";
  try {
    assert.equal(anonTrialLimit(), 7);
  } finally {
    if (previous === undefined) {
      delete process.env.ANON_GENERATION_LIMIT;
    } else {
      process.env.ANON_GENERATION_LIMIT = previous;
    }
  }
});

test("signAnonState / parseAnonCookie round-trips", () => {
  const state = { id: "anon-123", count: 2 };
  const cookie = signAnonState(state, SECRET);
  assert.deepEqual(parseAnonCookie(cookie, SECRET), state);
});

test("parseAnonCookie rejects a tampered payload", () => {
  const cookie = signAnonState({ id: "anon-123", count: 0 }, SECRET);
  const signature = cookie.slice(cookie.lastIndexOf(".") + 1);
  const forgedPayload = Buffer.from(
    JSON.stringify({ id: "anon-123", count: 99 }),
  ).toString("base64url");
  const tampered = `${forgedPayload}.${signature}`;
  assert.equal(parseAnonCookie(tampered, SECRET), null);
});

test("parseAnonCookie rejects a cookie signed with a different secret", () => {
  const cookie = signAnonState({ id: "anon-123", count: 1 }, SECRET);
  assert.equal(parseAnonCookie(cookie, "a-different-secret"), null);
});

test("parseAnonCookie rejects malformed or missing values", () => {
  assert.equal(parseAnonCookie(undefined, SECRET), null);
  assert.equal(parseAnonCookie(null, SECRET), null);
  assert.equal(parseAnonCookie("", SECRET), null);
  assert.equal(parseAnonCookie("no-separator", SECRET), null);
  assert.equal(parseAnonCookie("not.base64", SECRET), null);
});

test("parseAnonCookie rejects signatures with mismatched lengths", () => {
  const cookie = signAnonState({ id: "anon-123", count: 0 }, SECRET);
  const payload = cookie.slice(0, cookie.lastIndexOf("."));
  assert.equal(parseAnonCookie(`${payload}.short`, SECRET), null);
});

test("newAnonState starts at zero with a unique non-empty id", () => {
  const a = newAnonState();
  const b = newAnonState();
  assert.equal(a.count, 0);
  assert.ok(a.id.length > 0);
  assert.notEqual(a.id, b.id);
});
