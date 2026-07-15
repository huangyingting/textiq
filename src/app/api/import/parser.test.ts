import assert from "node:assert/strict";
import { test } from "node:test";

import {
  IMPORT_MAX_UPLOAD_BYTES,
  IMPORT_MULTIPART_ENVELOPE_MAX_BYTES,
} from "@/lib/import/format-registry";

import { parseImportUploadRequest } from "./parser";

const textEncoder = new TextEncoder();

function multipartBody(args: {
  boundary: string;
  fileName: string;
  mimeType: string;
  fileBytes: Uint8Array;
  fields?: Record<string, string>;
}): Uint8Array {
  const chunks: Uint8Array[] = [];
  const fields = args.fields ?? {};

  for (const [key, value] of Object.entries(fields)) {
    chunks.push(
      textEncoder.encode(
        [
          `--${args.boundary}`,
          `Content-Disposition: form-data; name="${key}"`,
          "",
          value,
          "",
        ].join("\r\n"),
      ),
    );
  }

  chunks.push(
    textEncoder.encode(
      [
        `--${args.boundary}`,
        `Content-Disposition: form-data; name="file"; filename="${args.fileName}"`,
        `Content-Type: ${args.mimeType}`,
        "",
      ].join("\r\n"),
    ),
  );
  chunks.push(args.fileBytes);
  chunks.push(textEncoder.encode(`\r\n--${args.boundary}--\r\n`));

  const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

test("parseImportUploadRequest maps multipart parser denial to malformed import failure", async () => {
  const result = await parseImportUploadRequest({
    async formData() {
      throw new Error("bad form");
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.response.status, 422);
  assert.deepEqual(await result.response.json(), {
    ok: false,
    error: {
      code: "malformed",
      status: 422,
      message: "Request must be multipart/form-data.",
    },
  });
});

test("parseImportUploadRequest requires a file field", async () => {
  const result = await parseImportUploadRequest({
    async formData() {
      return new FormData();
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.response.status, 422);
  assert.deepEqual(await result.response.json(), {
    ok: false,
    error: {
      code: "malformed",
      status: 422,
      message: "Missing `file` field in form data.",
    },
  });
});

test("parseImportUploadRequest accepts an exact 20 MiB file when only multipart envelope bytes exceed 20 MiB", async () => {
  const boundary = "import-boundary";
  const fileBytes = new Uint8Array(IMPORT_MAX_UPLOAD_BYTES);
  fileBytes.fill(0x78);
  const body = multipartBody({
    boundary,
    fileName: "exact-limit.pdf",
    mimeType: "application/pdf",
    fileBytes,
    fields: { target: "personal" },
  });

  assert.ok(body.byteLength > IMPORT_MAX_UPLOAD_BYTES);
  assert.ok(
    body.byteLength <=
      IMPORT_MAX_UPLOAD_BYTES + IMPORT_MULTIPART_ENVELOPE_MAX_BYTES,
  );

  const formData = new FormData();
  formData.set(
    "file",
    new File([fileBytes], "exact-limit.pdf", { type: "application/pdf" }),
  );
  formData.set("target", "personal");

  const result = await parseImportUploadRequest({
    headers: new Headers({
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": String(body.byteLength),
    }),
    async formData() {
      return formData;
    },
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.parsed.file.size, IMPORT_MAX_UPLOAD_BYTES);
    assert.deepEqual(result.parsed.target, { kind: "personal" });
  }
});

test("parseImportUploadRequest rejects oversized multipart envelopes even when the file itself is tiny", async () => {
  const boundary = "import-boundary";
  const hugeFieldValue = "x".repeat(
    IMPORT_MAX_UPLOAD_BYTES + IMPORT_MULTIPART_ENVELOPE_MAX_BYTES + 1,
  );
  const body = multipartBody({
    boundary,
    fileName: "tiny.md",
    mimeType: "text/markdown",
    fileBytes: textEncoder.encode("# tiny"),
    fields: {
      target: "personal",
      extra: hugeFieldValue,
    },
  });
  const formData = new FormData();
  formData.set("file", new File([textEncoder.encode("# tiny")], "tiny.md"));
  formData.set("target", "personal");

  const result = await parseImportUploadRequest({
    headers: new Headers({
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": String(body.byteLength),
    }),
    async formData() {
      return formData;
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.response.status, 413);
  assert.deepEqual(await result.response.json(), {
    ok: false,
    error: {
      code: "too_large",
      status: 413,
      message: "Uploaded file is too large.",
    },
  });
});
