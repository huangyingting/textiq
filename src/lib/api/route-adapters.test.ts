import assert from "node:assert/strict";
import { test } from "node:test";

import {
  privateImmutableCacheHeaders,
  plainTextResponse,
  readFormData,
  readJsonObject,
  readJsonValue,
  requiredSearchParam,
  retryAfterHeader,
} from "@/lib/api/route-adapters";

const textEncoder = new TextEncoder();

function multipartBytes(boundary: string, value: string): Uint8Array {
  return textEncoder.encode(
    [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="file.txt"',
      "Content-Type: text/plain",
      "",
      value,
      `--${boundary}--`,
      "",
    ].join("\r\n"),
  );
}

function multipartRequestFromBytes(
  body: Uint8Array,
  boundary: string,
  options: {
    chunkSize?: number;
    onCancel?(): void;
    onChunk?(): void;
  } = {},
): Request {
  const chunkSize = options.chunkSize ?? body.byteLength;
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= body.byteLength) {
        controller.close();
        return;
      }

      const nextOffset = Math.min(offset + chunkSize, body.byteLength);
      controller.enqueue(body.slice(offset, nextOffset));
      offset = nextOffset;
      options.onChunk?.();
    },
    cancel() {
      options.onCancel?.();
    },
  });
  const init: RequestInit & { duplex: "half" } = {
    method: "POST",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    body: stream,
    duplex: "half",
  };
  return new Request("http://localhost/upload", init);
}

test("readJsonObject returns shared route error bodies", async () => {
  const invalid = await readJsonObject({
    async json() {
      throw new Error("bad json");
    },
  });

  assert.equal(invalid.ok, false);
  assert.equal(invalid.response.status, 400);
  assert.deepEqual(await invalid.response.json(), {
    error: "Request body must be valid JSON.",
    code: "VALIDATION_ERROR",
  });
});

test("readFormData maps parser failures to shared route errors", async () => {
  const result = await readFormData({
    async formData() {
      throw new Error("bad form");
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.response.status, 400);
  assert.deepEqual(await result.response.json(), {
    error: "Request must be multipart/form-data.",
    code: "VALIDATION_ERROR",
  });
});

test("body adapters reject oversized content-length before parsing", async () => {
  let jsonParsed = false;
  const oversizedJson = await readJsonObject(
    {
      headers: new Headers({ "content-length": "11" }),
      async json() {
        jsonParsed = true;
        return {};
      },
    },
    { maxBytes: 10 },
  );
  assert.equal(oversizedJson.ok, false);
  assert.equal(oversizedJson.response.status, 413);
  assert.equal(jsonParsed, false);

  const oversizedValue = await readJsonValue(
    {
      headers: new Headers({ "content-length": "12" }),
      async json() {
        return {};
      },
    },
    "bad json",
    { maxBytes: 10 },
  );
  assert.equal(oversizedValue.ok, false);
  assert.equal(oversizedValue.response.status, 413);

  const oversizedForm = await readFormData(
    {
      headers: new Headers({ "content-length": "12" }),
      async formData() {
        return new FormData();
      },
    },
    "bad form",
    undefined,
    { maxBytes: 10 },
  );
  assert.equal(oversizedForm.ok, false);
  assert.equal(oversizedForm.response.status, 413);
});

test("body adapters reject payloads that exceed actual byte limits", async () => {
  const oversizedJson = await readJsonObject(
    {
      headers: new Headers({ "content-length": "2" }),
      async text() {
        return JSON.stringify({ value: "é".repeat(6) });
      },
      async json() {
        throw new Error("json fallback should not be used");
      },
    },
    { maxBytes: 10 },
  );
  assert.equal(oversizedJson.ok, false);
  assert.equal(oversizedJson.response.status, 413);

  const oversizedValue = await readJsonValue(
    {
      headers: new Headers({ "content-length": "2" }),
      async text() {
        return JSON.stringify(["too large"]);
      },
      async json() {
        throw new Error("json fallback should not be used");
      },
    },
    "bad json",
    { maxBytes: 10 },
  );
  assert.equal(oversizedValue.ok, false);
  assert.equal(oversizedValue.response.status, 413);

  const form = new FormData();
  form.set("file", new File(["01234567890"], "large.txt"));
  const oversizedForm = await readFormData(
    {
      headers: new Headers({ "content-length": "2" }),
      async formData() {
        return form;
      },
    },
    "bad form",
    undefined,
    { maxBytes: 10 },
  );
  assert.equal(oversizedForm.ok, false);
  assert.equal(oversizedForm.response.status, 413);
});

test("readFormData enforces byte limits while reading request bodies", async () => {
  const boundary = "bounded-form";
  const body = multipartBytes(boundary, "x".repeat(1024));
  let chunksRead = 0;
  let canceled = false;
  const request = multipartRequestFromBytes(body, boundary, {
    chunkSize: 1,
    onCancel() {
      canceled = true;
    },
    onChunk() {
      chunksRead += 1;
    },
  });
  request.headers.set("content-length", "2");
  let unboundedParserCalled = false;
  Object.defineProperty(request, "formData", {
    value: async () => {
      unboundedParserCalled = true;
      throw new Error("request.formData should not be used");
    },
  });

  const result = await readFormData(request, "bad form", undefined, {
    maxBytes: 10,
  });

  assert.equal(result.ok, false);
  assert.equal(result.response.status, 413);
  assert.equal(unboundedParserCalled, false);
  assert.equal(canceled, true);
  assert.equal(chunksRead < body.byteLength, true);
});

test("readFormData parses multipart data from bounded request bytes", async () => {
  const boundary = "bounded-form";
  const request = multipartRequestFromBytes(
    multipartBytes(boundary, "ok"),
    boundary,
  );
  Object.defineProperty(request, "formData", {
    value: async () => {
      throw new Error("request.formData should not be used");
    },
  });

  const result = await readFormData(request, "bad form", undefined, {
    maxBytes: 1024,
  });

  assert.equal(result.ok, true);
  const file = result.ok ? result.formData.get("file") : null;
  assert.ok(file instanceof File);
  assert.equal(await file.text(), "ok");
});

test("body adapters accept valid payloads under the size limit", async () => {
  const object = await readJsonObject(
    {
      headers: new Headers({ "content-length": "11" }),
      async text() {
        return JSON.stringify({ ok: true });
      },
      async json() {
        throw new Error("json fallback should not be used");
      },
    },
    { maxBytes: 20 },
  );
  assert.deepEqual(object, { ok: true, body: { ok: true } });

  const value = await readJsonValue(
    {
      headers: new Headers({ "content-length": "4" }),
      async text() {
        return JSON.stringify(["ok"]);
      },
      async json() {
        throw new Error("json fallback should not be used");
      },
    },
    "bad json",
    { maxBytes: 10 },
  );
  assert.deepEqual(value, { ok: true, body: ["ok"] });

  const form = new FormData();
  form.set("file", "contents");
  const formResult = await readFormData(
    {
      headers: new Headers({ "content-length": "8" }),
      async formData() {
        return form;
      },
    },
    "bad form",
    undefined,
    { maxBytes: 10 },
  );
  assert.equal(formResult.ok, true);
  assert.equal(
    formResult.ok ? formResult.formData.get("file") : null,
    "contents",
  );
});

test("shared adapters expose statically comparable headers and params", () => {
  assert.deepEqual(retryAfterHeader(9), { "Retry-After": "9" });
  assert.deepEqual(privateImmutableCacheHeaders("image/png"), {
    "Content-Type": "image/png",
    "Cache-Control": "private, max-age=31536000, immutable",
  });
  assert.equal(
    requiredSearchParam("https://example.test/api?room= doc ", "room"),
    "doc",
  );
  assert.equal(
    requiredSearchParam("https://example.test/api?room= ", "room"),
    null,
  );
});

test("plainTextResponse returns the provided body and status", async () => {
  const response = plainTextResponse("not found", 404);

  assert.equal(response.status, 404);
  assert.equal(await response.text(), "not found");
});
