import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, describe, it } from "node:test";

import { BRAND_FONT_MAX_BYTES } from "@/lib/limits";

type ModuleHooks = {
  registerHooks(hooks: {
    resolve(
      specifier: string,
      context: unknown,
      nextResolve: (specifier: string, context: unknown) => unknown,
    ): unknown;
    load(
      url: string,
      context: unknown,
      nextLoad: (url: string, context: unknown) => unknown,
    ): unknown;
  }): void;
};

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;
const serverOnlyStubUrl = "server-only:brand-upload-errors-test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: serverOnlyStubUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === serverOnlyStubUrl) {
      return { format: "commonjs", source: "", shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

type UploadBrandLogo =
  typeof import("@/lib/brand/upload-route-service").uploadBrandLogo;
type UploadBrandFont =
  typeof import("@/lib/brand/upload-route-service").uploadBrandFont;

let uploadBrandLogo: UploadBrandLogo;
let uploadBrandFont: UploadBrandFont;
const textEncoder = new TextEncoder();

before(async () => {
  const uploadService = await import("@/lib/brand/upload-route-service");
  uploadBrandLogo = uploadService.uploadBrandLogo;
  uploadBrandFont = uploadService.uploadBrandFont;
});

function formRequest(formData: FormData, contentLength?: number): Request {
  const request = new Request("http://localhost/api/brand/upload", {
    method: "POST",
    body: formData,
  });
  if (contentLength !== undefined) {
    request.headers.set("content-length", String(contentLength));
  }
  return request;
}

function fileForm(field: "logo" | "font", file: File): FormData {
  const formData = new FormData();
  formData.set(field, file);
  return formData;
}

function multipartBytes(
  boundary: string,
  field: "logo" | "font",
  fileName: string,
  contentType: string,
  value: string,
): Uint8Array {
  return textEncoder.encode(
    [
      `--${boundary}`,
      `Content-Disposition: form-data; name="${field}"; filename="${fileName}"`,
      `Content-Type: ${contentType}`,
      "",
      value,
      `--${boundary}--`,
      "",
    ].join("\r\n"),
  );
}

function streamingMultipartRequest(
  body: Uint8Array,
  boundary: string,
  options: {
    chunkSize?: number;
    onCancel?(): void;
    onChunk?(): void;
  } = {},
): Request {
  const chunkSize = options.chunkSize ?? 64 * 1024;
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
  return new Request("http://localhost/api/brand/upload", init);
}

describe("brand upload route service validation errors", () => {
  it("rejects oversized logo requests before parsing multipart data", async () => {
    const result = await uploadBrandLogo(
      formRequest(new FormData(), 10_000_000),
      "owner-1",
    );

    assert.deepEqual(result, {
      ok: false,
      error: "Uploaded file is too large.",
      status: 413,
    });
  });

  it("rejects oversized multipart bodies without relying on content-length", async () => {
    const boundary = "oversized-font";
    let chunksRead = 0;
    let canceled = false;
    const chunkSize = 64 * 1024;
    const body = multipartBytes(
      boundary,
      "font",
      "font.woff2",
      "font/woff2",
      "x".repeat(BRAND_FONT_MAX_BYTES + 512 * 1024),
    );
    const request = streamingMultipartRequest(body, boundary, {
      chunkSize,
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

    const result = await uploadBrandFont(request, "owner-1");

    assert.deepEqual(result, {
      ok: false,
      error: "Uploaded file is too large.",
      status: 413,
    });
    assert.equal(unboundedParserCalled, false);
    assert.equal(canceled, true);
    assert.equal(chunksRead < Math.ceil(body.byteLength / chunkSize), true);
  });

  it("rejects malformed multipart bodies", async () => {
    const request = new Request("http://localhost/api/brand/upload", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=broken" },
      body: "not multipart",
    });

    assert.deepEqual(await uploadBrandLogo(request, "owner-1"), {
      ok: false,
      error: "Request must be multipart/form-data.",
      status: 400,
    });
  });

  it("rejects missing file fields for the configured upload kind", async () => {
    const formData = new FormData();
    formData.set("brandId", "brand-1");

    assert.deepEqual(await uploadBrandFont(formRequest(formData), "owner-1"), {
      ok: false,
      error: "Missing `font` field in form data.",
      status: 400,
    });
  });

  it("rejects disallowed MIME types before reading asset bytes", async () => {
    const result = await uploadBrandLogo(
      formRequest(
        fileForm(
          "logo",
          new File([new Blob(["not an image"])], "logo.txt", {
            type: "text/plain",
          }),
        ),
      ),
      "owner-1",
    );

    assert.equal(result.ok, false);
    assert.equal(result.status, 415);
    assert.match(result.error, /Unsupported file type/);
  });

  it("rejects SVG logo uploads before storage", async () => {
    const result = await uploadBrandLogo(
      formRequest(
        fileForm(
          "logo",
          new File(
            [new Blob(["<svg><script>alert(1)</script></svg>"])],
            "logo.svg",
            {
              type: "image/svg+xml",
            },
          ),
        ),
      ),
      "owner-1",
    );

    assert.equal(result.ok, false);
    assert.equal(result.status, 415);
    assert.match(result.error, /Unsupported file type/);
  });

  it("rejects files whose magic bytes do not match the declared MIME", async () => {
    const result = await uploadBrandLogo(
      formRequest(
        fileForm(
          "logo",
          new File([new Blob(["not a png"])], "logo.png", {
            type: "image/png",
          }),
        ),
      ),
      "owner-1",
    );

    assert.equal(result.ok, false);
    assert.equal(result.status, 415);
    assert.match(result.error, /do not match/);
  });
});
