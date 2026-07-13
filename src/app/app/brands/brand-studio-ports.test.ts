/**
 * Direct contract coverage for the `BrandUploadPort` adapters
 * (`src/app/app/brands/brand-studio-ports.ts`, #1965) — `uploadBrandAsset`'s
 * request shaping (`POST` + the raw `FormData` body, to the right path per
 * asset kind), successful-response mapping (`url`/`assetId`/optional
 * `familyName`), and error propagation (server `error` message vs. the
 * per-path fallback) for both `routeBrandUploadPort.uploadLogo` and
 * `.uploadFont`.
 *
 * `brand-studio.test.tsx` only exercises `BrandForm`/`BrandCard` against a
 * *fake* `BrandUploadPort` passed in as a prop (deliberately, per that
 * file's own docstring, to avoid mocking `fetch` there) — so
 * `routeBrandUploadPort`'s actual `fetch("/api/brand/logo" | "/api/brand/font")`
 * request/response wiring has never been exercised directly. This stubs
 * `globalThis.fetch` (save/restore per test, the same pattern used by
 * `document-export-button.test.tsx`) as the one true network boundary,
 * using the real built-in `Response`/`FormData` globals rather than a
 * hand-rolled substitute.
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { routeBrandUploadPort } from "./brand-studio-ports";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubFetch(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Response,
): { calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return handler(input, init);
  }) as typeof fetch;
  return { calls };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("uploadLogo POSTs the given FormData to /api/brand/logo and resolves with url/assetId (no familyName for logos)", async () => {
  const formData = new FormData();
  formData.set("file", new Blob(["logo-bytes"]), "logo.png");
  const { calls } = stubFetch(() =>
    jsonResponse(200, {
      url: "https://cdn.example/logo.png",
      assetId: "asset-1",
    }),
  );

  const result = await routeBrandUploadPort.uploadLogo(formData);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/brand/logo");
  assert.equal(calls[0].init?.method, "POST");
  assert.equal(calls[0].init?.body, formData);
  assert.deepEqual(result, {
    url: "https://cdn.example/logo.png",
    assetId: "asset-1",
    familyName: undefined,
  });
});

test("uploadFont POSTs the given FormData to /api/brand/font and resolves with url/assetId/familyName", async () => {
  const formData = new FormData();
  formData.set("file", new Blob(["font-bytes"]), "brand.woff2");
  const { calls } = stubFetch(() =>
    jsonResponse(200, {
      url: "https://cdn.example/brand.woff2",
      assetId: "asset-2",
      familyName: "Brand Sans",
    }),
  );

  const result = await routeBrandUploadPort.uploadFont(formData);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/brand/font");
  assert.equal(calls[0].init?.method, "POST");
  assert.equal(calls[0].init?.body, formData);
  assert.deepEqual(result, {
    url: "https://cdn.example/brand.woff2",
    assetId: "asset-2",
    familyName: "Brand Sans",
  });
});

test("uploadLogo rejects with the server's error message when the response is not ok", async () => {
  stubFetch(() => jsonResponse(413, { error: "File too large." }));

  await assert.rejects(
    () => routeBrandUploadPort.uploadLogo(new FormData()),
    /File too large\./,
  );
});

test("uploadFont rejects with the server's error message when the response is not ok", async () => {
  stubFetch(() => jsonResponse(400, { error: "Unsupported font format." }));

  await assert.rejects(
    () => routeBrandUploadPort.uploadFont(new FormData()),
    /Unsupported font format\./,
  );
});

test("uploadLogo falls back to 'Logo upload failed.' when the error response has no error message", async () => {
  stubFetch(() => jsonResponse(500, {}));

  await assert.rejects(
    () => routeBrandUploadPort.uploadLogo(new FormData()),
    /Logo upload failed\./,
  );
});

test("uploadFont falls back to 'Font upload failed.' when the error response has no error message", async () => {
  stubFetch(() => jsonResponse(500, {}));

  await assert.rejects(
    () => routeBrandUploadPort.uploadFont(new FormData()),
    /Font upload failed\./,
  );
});

test("uploadLogo rejects with the fallback message when the response is ok=true but missing url/assetId", async () => {
  // A malformed 200 response (missing url/assetId) is treated the same as a
  // failure, not a partial success — asserts the `!res.ok || !json.url ||
  // !json.assetId` guard, not just the `!res.ok` branch.
  stubFetch(() => jsonResponse(200, { assetId: "asset-only" }));

  await assert.rejects(
    () => routeBrandUploadPort.uploadLogo(new FormData()),
    /Logo upload failed\./,
  );
});

test("uploadFont rejects with the fallback message when the response is ok=true but missing assetId", async () => {
  stubFetch(() => jsonResponse(200, { url: "https://cdn.example/x.woff2" }));

  await assert.rejects(
    () => routeBrandUploadPort.uploadFont(new FormData()),
    /Font upload failed\./,
  );
});
