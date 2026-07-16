import assert from "node:assert/strict";
import { test } from "node:test";

import {
  IMPORT_MAX_UPLOAD_BYTES,
  IMPORT_MULTIPART_ENVELOPE_MAX_BYTES,
  IMPORT_MULTIPART_TEXT_MAX_BYTES,
} from "@/lib/import/format-registry";

import { parseImportUploadRequest } from "./parser";

const textEncoder = new TextEncoder();

function multipartBody(args: {
  boundary: string;
  fileName: string;
  mimeType: string;
  fileBytes: Uint8Array;
  fields?: Array<{ name: string; value: string }>;
}): Uint8Array {
  const chunks: Uint8Array[] = [];
  const fields = args.fields ?? [];

  for (const field of fields) {
    chunks.push(
      textEncoder.encode(
        [
          `--${args.boundary}`,
          `Content-Disposition: form-data; name="${field.name}"`,
          "",
          field.value,
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

function formRequest(formData: FormData, contentLength?: number) {
  const headers = new Headers();
  if (contentLength !== undefined) {
    headers.set("content-length", String(contentLength));
  }
  return {
    headers,
    async formData() {
      return formData;
    },
  };
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
  const form = new FormData();
  form.set("target", "personal");
  const result = await parseImportUploadRequest(formRequest(form));

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

test("parseImportUploadRequest requires a target field", async () => {
  const form = new FormData();
  form.set("file", new File([textEncoder.encode("# hi")], "doc.md"));
  const result = await parseImportUploadRequest(formRequest(form));

  assert.equal(result.ok, false);
  assert.equal(result.response.status, 422);
  assert.deepEqual(await result.response.json(), {
    ok: false,
    error: {
      code: "malformed",
      status: 422,
      message: "Missing `target` field in form data.",
    },
  });
});

test("parseImportUploadRequest accepts an exact 20 MiB file when multipart envelope bytes are within allowance", async () => {
  const boundary = "import-boundary";
  const fileBytes = new Uint8Array(IMPORT_MAX_UPLOAD_BYTES);
  fileBytes.fill(0x78);
  const body = multipartBody({
    boundary,
    fileName: "exact-limit.pdf",
    mimeType: "application/pdf",
    fileBytes,
    fields: [{ name: "target", value: "personal" }],
  });

  assert.ok(body.byteLength > IMPORT_MAX_UPLOAD_BYTES);
  assert.ok(
    body.byteLength <=
      IMPORT_MAX_UPLOAD_BYTES + IMPORT_MULTIPART_ENVELOPE_MAX_BYTES,
  );

  const form = new FormData();
  form.set(
    "file",
    new File([fileBytes], "exact-limit.pdf", { type: "application/pdf" }),
  );
  form.set("target", "personal");

  const result = await parseImportUploadRequest(
    formRequest(form, body.byteLength),
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.parsed.file.size, IMPORT_MAX_UPLOAD_BYTES);
    assert.deepEqual(result.parsed.target, { kind: "personal" });
  }
});

test("parseImportUploadRequest rejects file payloads larger than 20 MiB", async () => {
  const form = new FormData();
  const file = new File([textEncoder.encode("x")], "too-large.pdf", {
    type: "application/pdf",
  });
  Object.defineProperty(file, "size", {
    value: IMPORT_MAX_UPLOAD_BYTES + 1,
  });
  form.set("file", file);
  form.set("target", "personal");

  const result = await parseImportUploadRequest(formRequest(form));
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

test("parseImportUploadRequest rejects oversized multipart envelopes even when file is tiny", async () => {
  const boundary = "import-boundary";
  const hugeFieldValue = "x".repeat(
    IMPORT_MAX_UPLOAD_BYTES + IMPORT_MULTIPART_ENVELOPE_MAX_BYTES + 1,
  );
  const body = multipartBody({
    boundary,
    fileName: "tiny.md",
    mimeType: "text/markdown",
    fileBytes: textEncoder.encode("# tiny"),
    fields: [{ name: "target", value: hugeFieldValue }],
  });
  const form = new FormData();
  form.set("file", new File([textEncoder.encode("# tiny")], "tiny.md"));
  form.set("target", "personal");

  const result = await parseImportUploadRequest(
    formRequest(form, body.byteLength),
  );
  assert.equal(result.ok, false);
  assert.equal(result.response.status, 413);
});

test("parseImportUploadRequest rejects unknown form-data fields", async () => {
  const form = new FormData();
  form.set("file", new File([textEncoder.encode("# hi")], "doc.md"));
  form.set("target", "personal");
  form.set("extra", "value");

  const result = await parseImportUploadRequest(formRequest(form));
  assert.equal(result.ok, false);
  assert.equal(result.response.status, 422);
  assert.deepEqual(await result.response.json(), {
    ok: false,
    error: {
      code: "malformed",
      status: 422,
      message: "Unknown `extra` field in form data.",
    },
  });
});

test("parseImportUploadRequest rejects duplicate fields", async () => {
  const form = new FormData();
  form.set("file", new File([textEncoder.encode("# hi")], "doc.md"));
  form.append("target", "personal");
  form.append("target", "workspace");

  const result = await parseImportUploadRequest(formRequest(form));
  assert.equal(result.ok, false);
  assert.equal(result.response.status, 422);
  assert.deepEqual(await result.response.json(), {
    ok: false,
    error: {
      code: "malformed",
      status: 422,
      message: "Duplicate `target` field in form data.",
    },
  });
});

test("parseImportUploadRequest rejects multiple file parts", async () => {
  const form = new FormData();
  form.append("file", new File([textEncoder.encode("a")], "a.md"));
  form.append("file", new File([textEncoder.encode("b")], "b.md"));
  form.append("target", "personal");

  const result = await parseImportUploadRequest(formRequest(form));
  assert.equal(result.ok, false);
  assert.equal(result.response.status, 422);
  assert.deepEqual(await result.response.json(), {
    ok: false,
    error: {
      code: "malformed",
      status: 422,
      message: "Duplicate `file` field in form data.",
    },
  });
});

test("parseImportUploadRequest rejects non-file values in the file field", async () => {
  const form = new FormData();
  form.set("file", "not-a-file");
  form.set("target", "personal");

  const result = await parseImportUploadRequest(formRequest(form));
  assert.equal(result.ok, false);
  assert.equal(result.response.status, 422);
  assert.deepEqual(await result.response.json(), {
    ok: false,
    error: {
      code: "malformed",
      status: 422,
      message: "Invalid `file` field in form data.",
    },
  });
});

test("parseImportUploadRequest rejects when form-data contains more than four parts", async () => {
  const form = new FormData();
  form.append("file", new File([textEncoder.encode("# hi")], "doc.md"));
  form.append("target", "workspace");
  form.append("workspaceId", "workspace-1");
  form.append("extra-1", "x");
  form.append("extra-2", "y");

  const result = await parseImportUploadRequest(formRequest(form));
  assert.equal(result.ok, false);
  assert.equal(result.response.status, 422);
  assert.deepEqual(await result.response.json(), {
    ok: false,
    error: {
      code: "malformed",
      status: 422,
      message: "Too many form-data fields in upload.",
    },
  });
});

test("parseImportUploadRequest rejects overlong text fields", async () => {
  const form = new FormData();
  form.set("file", new File([textEncoder.encode("# hi")], "doc.md"));
  form.set("target", "workspace");
  form.set("workspaceId", "x".repeat(IMPORT_MULTIPART_TEXT_MAX_BYTES + 1));

  const result = await parseImportUploadRequest(formRequest(form));
  assert.equal(result.ok, false);
  assert.equal(result.response.status, 422);
  assert.deepEqual(await result.response.json(), {
    ok: false,
    error: {
      code: "malformed",
      status: 422,
      message: "Field `workspaceId` is too large.",
    },
  });
});

test("parseImportUploadRequest requires workspaceId when target=workspace", async () => {
  const form = new FormData();
  form.set("file", new File([textEncoder.encode("# hi")], "doc.md"));
  form.set("target", "workspace");

  const result = await parseImportUploadRequest(formRequest(form));
  assert.equal(result.ok, false);
  assert.equal(result.response.status, 422);
});

test("parseImportUploadRequest rejects workspaceId when target=personal", async () => {
  const form = new FormData();
  form.set("file", new File([textEncoder.encode("# hi")], "doc.md"));
  form.set("target", "personal");
  form.set("workspaceId", "workspace-1");

  const result = await parseImportUploadRequest(formRequest(form));
  assert.equal(result.ok, false);
  assert.equal(result.response.status, 422);
  assert.deepEqual(await result.response.json(), {
    ok: false,
    error: {
      code: "malformed",
      status: 422,
      message: "Unexpected `workspaceId` for personal import target.",
    },
  });
});

test("parseImportUploadRequest accepts workspace target with workspaceId", async () => {
  const form = new FormData();
  form.set("file", new File([textEncoder.encode("# hi")], "doc.md"));
  form.set("target", "workspace");
  form.set("workspaceId", "  workspace-1  ");

  const result = await parseImportUploadRequest(formRequest(form));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.parsed.target, {
      kind: "workspace",
      workspaceId: "workspace-1",
    });
  }
});
