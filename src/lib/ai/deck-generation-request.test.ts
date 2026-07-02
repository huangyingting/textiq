import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildDeckGenerationBody,
  EMPTY_CONTENT_ERROR,
  parseDeckResponse,
  requestDeckGeneration,
} from "./deck-generation-request";

const VALID_DECK = {
  schemaVersion: 7,
  canvas: { format: "16:9", width: 100, height: 56.25, unit: "percent" },
  theme: { packageId: "neutral" },
  assets: { images: {} },
  slides: [
    {
      id: "slide-0001",
      type: "slide",
      template: { kind: "cover" },
      style: { ref: "slide.cover" },
      children: [],
    },
  ],
};

const LEGACY_DECK = {
  schemaVersion: 6,
  canvas: { format: "16:9" },
  design: { themeId: "default" },
  slides: [],
};

const CONTENT_JSON = { root: { children: [] } };

test("buildDeckGenerationBody includes contentJson and omits options when unset", () => {
  const body = buildDeckGenerationBody(CONTENT_JSON);
  assert.deepEqual(body, { contentJson: CONTENT_JSON });
  assert.equal("options" in body, false);
});

test("buildDeckGenerationBody includes only the set knobs", () => {
  const body = buildDeckGenerationBody(CONTENT_JSON, {
    length: "short",
    tone: "  playful  ",
    audience: "  execs  ",
    mode: "faithful",
  });
  assert.deepEqual(body, {
    contentJson: CONTENT_JSON,
    options: {
      length: "short",
      tone: "playful",
      audience: "execs",
      mode: "faithful",
    },
  });
});

test("buildDeckGenerationBody drops blank tone/audience strings", () => {
  const body = buildDeckGenerationBody(CONTENT_JSON, {
    length: "long",
    tone: "   ",
    audience: "",
  });
  assert.deepEqual(body, {
    contentJson: CONTENT_JSON,
    options: { length: "long" },
  });
});

test("buildDeckGenerationBody includes theme package request fields", () => {
  const body = buildDeckGenerationBody(
    CONTENT_JSON,
    { length: "medium" },
    { themePackageId: "noir" },
  );
  assert.deepEqual(body, {
    contentJson: CONTENT_JSON,
    options: { length: "medium" },
    themePackageId: "noir",
  });
});

test("parseDeckResponse returns Deck and truncated flag", () => {
  const parsed = parseDeckResponse({ deck: VALID_DECK, truncated: true });
  assert.ok(parsed);
  assert.equal(parsed.truncated, true);
  assert.equal(parsed.deck.schemaVersion, 7);
  assert.equal(parsed.deck.slides[0].id, "slide-0001");
});

test("parseDeckResponse returns presentation response metadata", () => {
  const parsed = parseDeckResponse({
    deck: VALID_DECK,
    truncated: false,
    metadata: {
      planner: "ai",
      mode: "presentationRewrite",
      tableSlideCount: 2,
      schemaValid: true,
      themePackageId: "noir",
      selectedKindCounts: { table: 1, cover: 1, ignored: "bad" },
    },
  });

  assert.ok(parsed);
  assert.deepEqual(parsed.metadata, {
    planner: "ai",
    mode: "presentationRewrite",
    tableSlideCount: 2,
    schemaValid: true,
    themePackageId: "noir",
    selectedKindCounts: { table: 1, cover: 1 },
  });
});

test("parseDeckResponse drops invalid metadata fields and empty kind counts", () => {
  const parsed = parseDeckResponse({
    deck: VALID_DECK,
    metadata: {
      planner: "legacy",
      mode: "magic",
      tableSlideCount: -1,
      schemaValid: "yes",
      themePackageId: "not-a-package",
      selectedKindCounts: { ignored: "bad", negative: -1 },
    },
  });

  assert.ok(parsed);
  assert.equal(parsed.metadata, undefined);
  assert.equal(
    parseDeckResponse({ deck: VALID_DECK, metadata: [] })?.metadata,
    undefined,
  );
});

test("parseDeckResponse preserves valid diagnostics and drops invalid entries", () => {
  const parsed = parseDeckResponse({
    deck: VALID_DECK,
    diagnostics: [
      {
        code: "slot-over-capacity",
        category: "validation",
        severity: "warning",
        target: { scope: "slide", slideId: "slide-0001" },
        message: "Truncated extras",
      },
      {
        code: "invalid",
        category: "made-up",
        severity: "warning",
        target: { scope: "deck" },
        message: "Should be ignored",
      },
    ],
  });

  assert.ok(parsed);
  assert.equal(parsed.diagnostics.length, 1);
  assert.equal(parsed.diagnostics[0].code, "slot-over-capacity");
});

test("parseDeckResponse defaults truncated to false", () => {
  const parsed = parseDeckResponse({ deck: VALID_DECK });
  assert.ok(parsed);
  assert.equal(parsed.truncated, false);
});

test("parseDeckResponse rejects invalid, missing, and legacy decks", () => {
  assert.equal(parseDeckResponse({ deck: { not: "a deck" } }), null);
  assert.equal(parseDeckResponse({ deck: LEGACY_DECK }), null);
  assert.equal(parseDeckResponse({ truncated: true }), null);
  assert.equal(parseDeckResponse(null), null);
  assert.equal(parseDeckResponse("nope"), null);
});

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

test("requestDeckGeneration returns the parsed Deck on success", async () => {
  const fetchImpl = (async () =>
    jsonResponse({
      deck: VALID_DECK,
      truncated: true,
      diagnostics: [
        {
          code: "missing-required-slot",
          category: "validation",
          severity: "warning",
          target: { scope: "slide", slideId: "slide-0001" },
          message: "Used fallback content",
        },
      ],
    })) as unknown as typeof fetch;
  const result = await requestDeckGeneration(CONTENT_JSON, {}, fetchImpl);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.truncated, true);
    assert.equal(result.deck.schemaVersion, 7);
    assert.equal(result.diagnostics.length, 1);
    assert.equal(result.diagnostics[0].code, "missing-required-slot");
  }
});

test("requestDeckGeneration POSTs to /api/generate-deck with the built body", async () => {
  let seenUrl = "";
  let seenBody: unknown = null;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    seenUrl = url;
    seenBody = JSON.parse(String(init?.body));
    return jsonResponse({ deck: VALID_DECK, truncated: false });
  }) as unknown as typeof fetch;
  await requestDeckGeneration(
    CONTENT_JSON,
    { length: "medium", audience: "students" },
    fetchImpl,
  );
  assert.equal(seenUrl, "/api/generate-deck");
  assert.deepEqual(seenBody, {
    contentJson: CONTENT_JSON,
    options: { length: "medium", audience: "students" },
  });
});

test("requestDeckGeneration classifies a 404 as unavailable", async () => {
  const fetchImpl = (async () =>
    jsonResponse(
      { error: "Not found." },
      false,
      404,
    )) as unknown as typeof fetch;
  const result = await requestDeckGeneration(CONTENT_JSON, {}, fetchImpl);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errorKind, "unavailable");
});

test("requestDeckGeneration classifies a 402 as credit", async () => {
  const fetchImpl = (async () =>
    jsonResponse(
      { error: "Insufficient credits." },
      false,
      402,
    )) as unknown as typeof fetch;
  const result = await requestDeckGeneration(CONTENT_JSON, {}, fetchImpl);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errorKind, "credit");
    assert.equal(result.error, "Insufficient credits.");
  }
});

test("requestDeckGeneration classifies a 504 as timeout", async () => {
  const fetchImpl = (async () =>
    jsonResponse(
      { error: "Too slow." },
      false,
      504,
    )) as unknown as typeof fetch;
  const result = await requestDeckGeneration(CONTENT_JSON, {}, fetchImpl);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errorKind, "timeout");
});

test("requestDeckGeneration classifies an empty-outline 400 as empty", async () => {
  const fetchImpl = (async () =>
    jsonResponse(
      { error: "`contentJson` does not contain any usable outline content." },
      false,
      400,
    )) as unknown as typeof fetch;
  const result = await requestDeckGeneration(CONTENT_JSON, {}, fetchImpl);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errorKind, "empty");
    assert.equal(result.error, EMPTY_CONTENT_ERROR);
  }
});

test("requestDeckGeneration classifies a non-empty 400 as other", async () => {
  const fetchImpl = (async () =>
    jsonResponse(
      { error: "`contentJson` is required." },
      false,
      400,
    )) as unknown as typeof fetch;
  const result = await requestDeckGeneration(CONTENT_JSON, {}, fetchImpl);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errorKind, "other");
});

test("requestDeckGeneration classifies other non-OK statuses as other", async () => {
  const fetchImpl = (async () =>
    jsonResponse({ error: "boom" }, false, 500)) as unknown as typeof fetch;
  const result = await requestDeckGeneration(CONTENT_JSON, {}, fetchImpl);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errorKind, "other");
    assert.equal(result.error, "boom");
  }
});

test("requestDeckGeneration returns a network error when fetch throws", async () => {
  const fetchImpl = (async () => {
    throw new Error("offline");
  }) as unknown as typeof fetch;
  const result = await requestDeckGeneration(CONTENT_JSON, {}, fetchImpl);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errorKind, "network");
});

test("requestDeckGeneration classifies an aborted fetch as timeout", async () => {
  const fetchImpl = (async () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    throw err;
  }) as unknown as typeof fetch;
  const result = await requestDeckGeneration(CONTENT_JSON, {}, fetchImpl);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errorKind, "timeout");
});

test("requestDeckGeneration classifies an unparseable success payload as other", async () => {
  const fetchImpl = (async () =>
    jsonResponse({
      deck: { bogus: true },
      truncated: false,
    })) as unknown as typeof fetch;
  const result = await requestDeckGeneration(CONTENT_JSON, {}, fetchImpl);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errorKind, "other");
});

test("requestDeckGeneration rejects legacy deck responses", async () => {
  const fetchImpl = (async () =>
    jsonResponse({
      deck: LEGACY_DECK,
      truncated: false,
    })) as unknown as typeof fetch;
  const result = await requestDeckGeneration(CONTENT_JSON, {}, fetchImpl);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errorKind, "other");
});

test("parseDeckResponse preserves every diagnostic target scope plus optional diagnostic fields", () => {
  const diagnostics = [
    {
      code: "deck",
      category: "validation",
      severity: "info",
      target: { scope: "deck", path: "deck", label: "Deck" },
      message: "Deck message",
      path: "$.deck",
      nodeId: "node-top",
      slideId: "slide-top",
      action: { type: "fix" },
      details: { count: 1 },
    },
    {
      code: "node",
      category: "validation",
      severity: "error",
      target: {
        scope: "node",
        nodeId: "node-1",
        slideId: "slide-1",
        path: "node",
        label: "Node",
      },
      message: "Node message",
    },
    {
      code: "asset",
      category: "export",
      severity: "warning",
      target: {
        scope: "asset",
        assetId: "asset-1",
        slideId: "slide-1",
        nodeId: "node-1",
        path: "asset",
        label: "Asset",
      },
      message: "Asset message",
    },
    {
      code: "source",
      category: "source",
      severity: "warning",
      target: {
        scope: "source",
        documentId: "doc-1",
        blockId: "block-1",
        slideId: "slide-1",
        nodeId: "node-1",
      },
      message: "Source message",
    },
    {
      code: "style",
      category: "theme",
      severity: "warning",
      target: {
        scope: "style",
        styleRef: "role.title",
        slideId: "slide-1",
        nodeId: "node-1",
      },
      message: "Style message",
    },
    {
      code: "theme",
      category: "theme",
      severity: "warning",
      target: { scope: "theme", themePackageId: "noir", slideId: "slide-1" },
      message: "Theme message",
    },
    {
      code: "export",
      category: "export",
      severity: "fatal",
      target: {
        scope: "export",
        exportFeature: "pptx",
        slideId: "slide-1",
        nodeId: "node-1",
      },
      message: "Export message",
    },
    {
      code: "bad-target",
      category: "validation",
      severity: "info",
      target: [],
      message: "Ignored",
    },
  ];

  const parsed = parseDeckResponse({ deck: VALID_DECK, diagnostics });
  assert.ok(parsed);
  assert.deepEqual(
    parsed.diagnostics.map((diagnostic) => diagnostic.target.scope),
    ["deck", "node", "asset", "source", "style", "theme", "export"],
  );
  assert.equal(parsed.diagnostics[0].path, "$.deck");
  assert.equal(parsed.diagnostics[0].nodeId, "node-top");
  assert.equal(parsed.diagnostics[0].slideId, "slide-top");
  assert.deepEqual(parsed.diagnostics[0].action, { type: "fix" });
  assert.deepEqual(parsed.diagnostics[0].details, { count: 1 });
});

test("parseDeckResponse rejects diagnostics missing required target identifiers", () => {
  const parsed = parseDeckResponse({
    deck: VALID_DECK,
    diagnostics: [
      {
        code: "missing-slide",
        category: "validation",
        severity: "warning",
        target: { scope: "slide" },
        message: "ignored",
      },
      {
        code: "missing-node",
        category: "validation",
        severity: "warning",
        target: { scope: "node" },
        message: "ignored",
      },
      {
        code: "bad-severity",
        category: "validation",
        severity: "loud",
        target: { scope: "deck" },
        message: "ignored",
      },
      null,
    ],
  });
  assert.ok(parsed);
  assert.deepEqual(parsed.diagnostics, []);
});

test("parseDeckResponse ignores non-object selected kind counts and metadata", () => {
  assert.equal(
    parseDeckResponse({
      deck: VALID_DECK,
      metadata: { selectedKindCounts: [] },
    })?.metadata,
    undefined,
  );
  assert.equal(
    parseDeckResponse({ deck: VALID_DECK, metadata: null })?.metadata,
    undefined,
  );
});

test("requestDeckGeneration forwards signal and theme package request and handles JSON parse failures", async () => {
  const controller = new AbortController();
  let seenSignal: AbortSignal | undefined;
  let seenBody: unknown;
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    seenSignal = init?.signal ?? undefined;
    seenBody = JSON.parse(String(init?.body));
    return {
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    } as unknown as Response;
  }) as unknown as typeof fetch;

  const result = await requestDeckGeneration(
    CONTENT_JSON,
    { mode: "presentationRewrite" },
    fetchImpl,
    controller.signal,
    { themePackageId: "noir" },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errorKind, "other");
  assert.equal(seenSignal, controller.signal);
  assert.deepEqual(seenBody, {
    contentJson: CONTENT_JSON,
    options: { mode: "presentationRewrite" },
    themePackageId: "noir",
  });
});

test("requestDeckGeneration classifies timeout-named fetch errors as timeout", async () => {
  const fetchImpl = (async () => {
    const err = new Error("timeout");
    err.name = "TimeoutError";
    throw err;
  }) as unknown as typeof fetch;
  const result = await requestDeckGeneration(CONTENT_JSON, {}, fetchImpl);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errorKind, "timeout");
});
