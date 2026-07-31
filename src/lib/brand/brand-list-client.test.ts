import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  BRAND_LIST_LOAD_ERROR,
  loadBrandStyles,
} from "@/lib/brand/brand-list-client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const brand = {
  id: "brand-1",
  name: "Acme",
  ownerId: "owner-1",
  palette: null,
  background: null,
  nodeFill: null,
  nodeStroke: null,
  nodeText: null,
  edgeColor: null,
  fontFamily: null,
  fontAssetUrl: null,
  logoAssetUrl: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

test("loadBrandStyles validates and returns the complete API response", async () => {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    assert.equal(url, "/api/brand");
    assert.equal(init?.signal, undefined);
    return { ok: true, json: async () => ({ brands: [brand] }) } as Response;
  }) as typeof fetch;

  assert.deepEqual(await loadBrandStyles(), [brand]);
});

test("loadBrandStyles forwards cancellation and rejects non-ok or malformed responses", async () => {
  const controller = new AbortController();
  let response: { ok: boolean; json: () => Promise<unknown> } = {
    ok: false,
    json: async () => ({}),
  };
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    assert.equal(init?.signal, controller.signal);
    return response as Response;
  }) as typeof fetch;

  await assert.rejects(
    loadBrandStyles(controller.signal),
    new RegExp(BRAND_LIST_LOAD_ERROR),
  );

  response = { ok: true, json: async () => ({ brands: [null] }) };
  await assert.rejects(
    loadBrandStyles(controller.signal),
    new RegExp(BRAND_LIST_LOAD_ERROR),
  );
});
