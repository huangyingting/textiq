import assert from "node:assert/strict";
import { test } from "node:test";

import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_KEY_PATTERN,
} from "@/lib/ai/idempotency-key";
import {
  buildGenerateBody,
  canGenerateForSelection,
  canGenerateFromText,
  candidatesFrom,
  generateTargetForContext,
  isCreditError,
  parseCandidates,
  requestVisualCandidates,
  stampSourceText,
  type GenerateSelection,
} from "./generate";
import { hashSourceText, type Visual } from "./schema";
import { FIXTURES } from "./fixtures";

// A schema-valid visual reused across the parse/stamp tests.
const VALID_VISUAL: Visual = FIXTURES.list;

// ---------------------------------------------------------------------------
// candidatesFrom / parseCandidates — pull and validate candidates.
// ---------------------------------------------------------------------------

test("candidatesFrom returns the array or empty", () => {
  assert.deepEqual(candidatesFrom({ candidates: [1, 2] }), [1, 2]);
  assert.deepEqual(candidatesFrom({ candidates: "x" }), []);
  assert.deepEqual(candidatesFrom({}), []);
  assert.deepEqual(candidatesFrom(null), []);
});

test("parseCandidates keeps only schema-valid visuals", () => {
  const parsed = parseCandidates({
    candidates: [VALID_VISUAL, { type: "not-real" }, 5],
  });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].title, VALID_VISUAL.title);
});

test("parseCandidates returns empty for non-array payloads", () => {
  assert.deepEqual(parseCandidates(null), []);
  assert.deepEqual(parseCandidates({ candidates: {} }), []);
});

// ---------------------------------------------------------------------------
// buildGenerateBody — only non-"auto"/unset knobs are forwarded.
// ---------------------------------------------------------------------------

test("buildGenerateBody includes only the text by default", () => {
  assert.deepEqual(buildGenerateBody("hello"), { text: "hello" });
});

test("buildGenerateBody omits 'auto' knobs", () => {
  assert.deepEqual(
    buildGenerateBody("hi", {
      type: "auto",
      orientation: "auto",
      detailLevel: "auto",
      stayCloserToText: false,
    }),
    { text: "hi" },
  );
});

test("buildGenerateBody forwards concrete knobs", () => {
  assert.deepEqual(
    buildGenerateBody("hi", {
      type: "timeline",
      orientation: "vertical",
      detailLevel: "detailed",
      stayCloserToText: true,
    }),
    {
      text: "hi",
      type: "timeline",
      orientation: "vertical",
      detailLevel: "detailed",
      stayCloserToText: true,
    },
  );
});

// ---------------------------------------------------------------------------
// Eligibility — canGenerateFromText / generateTargetForContext.
// ---------------------------------------------------------------------------

test("canGenerateFromText requires non-whitespace content", () => {
  assert.equal(canGenerateFromText("hi"), true);
  assert.equal(canGenerateFromText("   "), false);
  assert.equal(canGenerateFromText(""), false);
  assert.equal(canGenerateFromText(undefined), false);
  assert.equal(canGenerateFromText(null), false);
});

test("generateTargetForContext resolves a range selection with text", () => {
  const ctx: GenerateSelection = {
    kind: "range",
    blockKey: "k1",
    blockText: "Whole block text",
    selectionText: "  Selected text  ",
    selectionEndBlockKey: "k2",
  };
  assert.deepEqual(generateTargetForContext(ctx), {
    blockKey: "k2",
    text: "Selected text",
  });
  assert.equal(canGenerateForSelection(ctx), true);
});

test("generateTargetForContext falls back to the active block key for range selections", () => {
  const ctx: GenerateSelection = {
    kind: "range",
    blockKey: "k1",
    selectionText: "Selected text",
  };
  assert.deepEqual(generateTargetForContext(ctx), {
    blockKey: "k1",
    text: "Selected text",
  });
});

test("generateTargetForContext resolves a collapsed caret in a non-empty block", () => {
  const ctx: GenerateSelection = {
    kind: "collapsed",
    blockKey: "k2",
    blockText: "Active block",
  };
  assert.deepEqual(generateTargetForContext(ctx), {
    blockKey: "k2",
    text: "Active block",
  });
});

test("generateTargetForContext rejects unusable selections", () => {
  // Wrong kind.
  assert.equal(
    generateTargetForContext({ kind: "visual", blockKey: "k", blockText: "x" }),
    null,
  );
  assert.equal(
    generateTargetForContext({ kind: "none", blockText: "x" }),
    null,
  );
  // Missing block key.
  assert.equal(
    generateTargetForContext({ kind: "range", blockText: "x" }),
    null,
  );
  // Empty / whitespace text.
  assert.equal(
    generateTargetForContext({
      kind: "range",
      blockKey: "k",
      selectionText: "   ",
    }),
    null,
  );
  assert.equal(
    generateTargetForContext({ kind: "range", blockKey: "k" }),
    null,
  );
});

// ---------------------------------------------------------------------------
// stampSourceText — stamp source text + hash, or pass through.
// ---------------------------------------------------------------------------

test("stampSourceText stamps trimmed source text and its hash", () => {
  const stamped = stampSourceText(VALID_VISUAL, "  My source  ");
  assert.equal(stamped.sourceText, "My source");
  assert.equal(stamped.sourceTextHash, hashSourceText("My source"));
});

test("stampSourceText passes the visual through for empty text", () => {
  const stamped = stampSourceText(VALID_VISUAL, "   ");
  assert.equal(stamped, VALID_VISUAL);
});

// ---------------------------------------------------------------------------
// requestVisualCandidates — the shared fetch path (injectable fetch).
// ---------------------------------------------------------------------------

function mockResponse(response: unknown): Response {
  return response as unknown as Response;
}

function mockFetch(
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return fetchImpl as unknown as typeof fetch;
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return mockResponse({
    ok,
    status,
    json: async () => body,
  });
}

test("requestVisualCandidates returns validated candidates on success", async () => {
  const fetchImpl = mockFetch(async () =>
    jsonResponse({ candidates: [VALID_VISUAL] }),
  );
  const result = await requestVisualCandidates("hi", {}, fetchImpl);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.candidates.length, 1);
  }
});

test("requestVisualCandidates POSTs to /api/generate with the built body", async () => {
  let capturedUrl: string | undefined;
  let capturedBody: unknown;
  let capturedIdempotencyKey: string | null = null;
  const fetchImpl = mockFetch(async (url: string, init?: RequestInit) => {
    capturedUrl = url;
    capturedBody = init?.body ? JSON.parse(String(init.body)) : undefined;
    capturedIdempotencyKey = new Headers(init?.headers).get(
      IDEMPOTENCY_KEY_HEADER,
    );
    return jsonResponse({ candidates: [VALID_VISUAL] });
  });

  await requestVisualCandidates("hello", { type: "timeline" }, fetchImpl);
  assert.equal(capturedUrl, "/api/generate");
  assert.deepEqual(capturedBody, { text: "hello", type: "timeline" });
  assert.ok(capturedIdempotencyKey);
  assert.match(capturedIdempotencyKey, IDEMPOTENCY_KEY_PATTERN);
});

test("requestVisualCandidates reuses caller-provided idempotency key", async () => {
  let capturedIdempotencyKey: string | null = null;
  const fetchImpl = mockFetch(async (_url: string, init?: RequestInit) => {
    capturedIdempotencyKey = new Headers(init?.headers).get(
      IDEMPOTENCY_KEY_HEADER,
    );
    return jsonResponse({ candidates: [VALID_VISUAL] });
  });

  await requestVisualCandidates("hello", { type: "timeline" }, fetchImpl, {
    idempotencyKey: "visual-op-00000001",
  });

  assert.equal(capturedIdempotencyKey, "visual-op-00000001");
});

test("requestVisualCandidates rejects invalid caller-provided idempotency keys", async () => {
  let called = false;
  const fetchImpl = mockFetch(async () => {
    called = true;
    return jsonResponse({ candidates: [VALID_VISUAL] });
  });

  const result = await requestVisualCandidates("hello", {}, fetchImpl, {
    idempotencyKey: "bad key",
  });

  assert.equal(called, false);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /idempotency key/i);
  }
});

test("requestVisualCandidates surfaces the server error message", async () => {
  const fetchImpl = mockFetch(async () =>
    jsonResponse({ error: "Out of credits" }, false, 402),
  );
  const result = await requestVisualCandidates("hi", {}, fetchImpl);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, "Out of credits");
  }
});

test("requestVisualCandidates errors when no usable candidates come back", async () => {
  const fetchImpl = mockFetch(async () =>
    jsonResponse({ candidates: [{ bogus: true }] }),
  );
  const result = await requestVisualCandidates("hi", {}, fetchImpl);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /No usable visuals/);
  }
});

test("requestVisualCandidates returns a network error when fetch throws", async () => {
  const fetchImpl = mockFetch(async () => {
    throw new Error("offline");
  });
  const result = await requestVisualCandidates("hi", {}, fetchImpl);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /Couldn't reach the generator/);
  }
});

// ---------------------------------------------------------------------------
// isCreditError — pure error-kind classification.
// ---------------------------------------------------------------------------

test("isCreditError returns true for a 402 credit error result", () => {
  assert.equal(
    isCreditError({
      ok: false,
      error: "Insufficient credits",
      errorKind: "credit",
    }),
    true,
  );
});

test("isCreditError returns false for a non-credit error result", () => {
  assert.equal(
    isCreditError({
      ok: false,
      error: "Something went wrong",
      errorKind: "other",
    }),
    false,
  );
});

test("isCreditError returns false for a successful result", () => {
  assert.equal(isCreditError({ ok: true, candidates: [] }), false);
});

test("requestVisualCandidates sets errorKind=credit on 402 response", async () => {
  const fetchImpl = mockFetch(async () =>
    jsonResponse({ error: "Insufficient credits" }, false, 402),
  );
  const result = await requestVisualCandidates("hi", {}, fetchImpl);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errorKind, "credit");
  }
});

test("requestVisualCandidates sets errorKind=other on non-402 error response", async () => {
  const fetchImpl = mockFetch(async () =>
    jsonResponse({ error: "Server error" }, false, 500),
  );
  const result = await requestVisualCandidates("hi", {}, fetchImpl);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errorKind, "other");
  }
});

test("requestVisualCandidates sets errorKind=other when no usable candidates", async () => {
  const fetchImpl = mockFetch(async () =>
    jsonResponse({ candidates: [{ bogus: true }] }),
  );
  const result = await requestVisualCandidates("hi", {}, fetchImpl);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errorKind, "other");
  }
});

test("requestVisualCandidates sets errorKind=other on network failure", async () => {
  const fetchImpl = mockFetch(async () => {
    throw new Error("offline");
  });
  const result = await requestVisualCandidates("hi", {}, fetchImpl);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errorKind, "other");
  }
});
