/**
 * Tests for abuse-control observability (issue #512).
 *
 * Two guarantees matter here:
 *  1. Each abuse category produces a stable, greppable context.
 *  2. The helper can NEVER forward request content (prompts, file bytes): the
 *     emitted context contains only an allowlisted set of safe scalar keys.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ABUSE_CATEGORIES,
  buildRouteDenialContext,
  logRouteDenial,
  type RouteDenialEvent,
} from "./api-abuse";

const ALLOWED_KEYS = new Set([
  "route",
  "category",
  "status",
  "subjectHash",
  "docId",
  "userId",
  "retryAfterSeconds",
]);

function routeDenialEvent(value: unknown): RouteDenialEvent {
  return value as unknown as RouteDenialEvent;
}

test("buildRouteDenialContext: minimal event carries only safe fields", () => {
  const ctx = buildRouteDenialContext({
    route: "api.generate",
    reason: ABUSE_CATEGORIES.RATE_LIMIT_HIT,
    status: 429,
  });
  assert.deepEqual(ctx, {
    route: "api.generate",
    category: "rate-limit-hit",
    status: 429,
  });
});

test("buildRouteDenialContext: optional opaque identifiers are forwarded", () => {
  const ctx = buildRouteDenialContext({
    route: "api.import",
    reason: ABUSE_CATEGORIES.PARSER_TIMEOUT,
    status: 422,
    subjectHash: "deadbeef",
    docId: "doc-1",
    userId: "user-1",
    retryAfterSeconds: 30,
  });
  assert.deepEqual(ctx, {
    route: "api.import",
    category: "parser-timeout",
    status: 422,
    subjectHash: "deadbeef",
    docId: "doc-1",
    userId: "user-1",
    retryAfterSeconds: 30,
  });
});

test("buildRouteDenialContext: every abuse category is a stable string", () => {
  assert.deepEqual(Object.values(ABUSE_CATEGORIES).sort(), [
    "ai-timeout",
    "anon-quota-denied",
    "credit-denied",
    "parser-timeout",
    "rate-limit-hit",
  ]);
});

test("buildRouteDenialContext: never emits keys outside the safe allowlist", () => {
  // Even when a caller (via a loosely-typed object) sprinkles content fields,
  // the builder copies ONLY allowlisted keys — no prompt/text/bytes leak.
  const polluted = routeDenialEvent({
    route: "api.generate-deck",
    reason: ABUSE_CATEGORIES.AI_TIMEOUT,
    status: 504,
    prompt: "secret user prompt text",
    text: "raw imported document body",
    bytes: Buffer.from([1, 2, 3]),
    file: "resume.pdf",
  });

  const ctx = buildRouteDenialContext(polluted);
  for (const key of Object.keys(ctx)) {
    assert.ok(
      ALLOWED_KEYS.has(key),
      `unexpected key leaked into denial context: ${key}`,
    );
  }
  assert.ok(!("prompt" in ctx));
  assert.ok(!("text" in ctx));
  assert.ok(!("bytes" in ctx));
  assert.ok(!("file" in ctx));
});

test("logRouteDenial: emits exactly one structured info line, never throws", () => {
  const original = console.info;
  const lines: string[] = [];
  console.info = (line?: unknown) => {
    lines.push(String(line));
  };
  try {
    logRouteDenial({
      route: "api.generate",
      reason: ABUSE_CATEGORIES.CREDIT_DENIED,
      status: 402,
      userId: "user-9",
    });
  } finally {
    console.info = original;
  }

  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]) as Record<string, unknown>;
  assert.equal(record.level, "info");
  assert.equal(record.scope, "api.abuse");
  assert.equal(record.message, "route-denial");
  assert.equal(record.category, "credit-denied");
  assert.equal(record.status, 402);
  assert.equal(record.userId, "user-9");
});
