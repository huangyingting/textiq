/**
 * Behaviour contracts for processImportUpload.
 *
 * upload-service.ts carries `import "server-only"` so it cannot be loaded
 * under a plain Node test runner.  We pre-populate require.cache for the
 * server-only package (mapping it to a no-op) before the CJS require of the
 * UUT.  Everything else goes through the real DI surface (options.deps) with
 * deterministic fakes – no mocking of the UUT itself.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { ImportBudgetError } from "./archive-budget";
import { EncryptedImportError } from "./import-errors";
import { ParseAbortedError, ParseTimeoutError } from "./timeout";

// ── server-only shim ─────────────────────────────────────────────────────────
// tsx compiles TypeScript imports to CJS require() calls in order, so we can
// pre-populate require.cache before the UUT is loaded.  All three server-only
// consumers in the transitive dep tree (upload-service → index → pdf/docx/pptx)
// will find the cached no-op on their first require("server-only") call.
const serverOnlyPath = require.resolve("server-only");
(require as NodeJS.Require).cache[serverOnlyPath] = {
  id: serverOnlyPath,
  filename: serverOnlyPath,
  loaded: true,
  exports: {},
  children: [],
  paths: [],
  isPreloading: false,
  path: serverOnlyPath,
  require: require as NodeJS.Require,
  parent: null,
} as unknown as NodeJS.Module;

/* eslint-disable @typescript-eslint/no-require-imports */
const { processImportUpload } =
  require("./upload-service") as typeof import("./upload-service");
/* eslint-enable @typescript-eslint/no-require-imports */

// ── helpers ──────────────────────────────────────────────────────────────────

/** Minimal File whose name/type/size are controlled by the caller. */
function fakeFile(name: string, type: string, content = "data"): File {
  return new File([Buffer.from(content)], name, { type });
}

// ── validation failure paths ─────────────────────────────────────────────────

test("processImportUpload: unsupported MIME type returns status 415", async () => {
  const file = fakeFile("photo.jpg", "image/jpeg");
  const result = await processImportUpload(file, {
    subjectHash: "h1",
    deps: {
      validateImportFile: () => ({
        ok: false,
        error: {
          code: "unsupported_type" as const,
          accepted: ["text/markdown"] as const,
        },
      }),
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.status, 415);
    assert.equal(result.error.code, "unsupported");
    assert.ok(
      result.error.message.length > 0,
      "error message must be non-empty",
    );
  }
});

test("processImportUpload: oversized file returns status 413", async () => {
  const file = fakeFile("big.pdf", "application/pdf");
  const result = await processImportUpload(file, {
    subjectHash: "h1",
    deps: {
      validateImportFile: () => ({
        ok: false,
        error: {
          code: "file_too_large" as const,
          maxBytes: 1024,
          actualBytes: 2048,
        },
      }),
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.status, 413);
    assert.equal(result.error.code, "too_large");
    assert.ok(
      result.error.message.length > 0,
      "error message must be non-empty",
    );
  }
});

// ── read failure path ─────────────────────────────────────────────────────────

test("processImportUpload: readFile throws returns malformed 422 and calls logError once", async () => {
  const file = fakeFile("doc.md", "text/markdown");
  const logErrorCalls: Array<{
    scope: string;
    error: unknown;
    context: Record<string, unknown> | undefined;
  }> = [];

  const result = await processImportUpload(file, {
    subjectHash: "h1",
    deps: {
      validateImportFile: () => ({ ok: true, mime: "text/markdown" as const }),
      readFile: async () => {
        throw new Error("disk read failed");
      },
      logError: (scope, error, context) => {
        logErrorCalls.push({ scope, error, context });
      },
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.status, 422);
    assert.equal(result.error.code, "malformed");
  }
  assert.equal(logErrorCalls.length, 1, "logError must be called exactly once");
  assert.equal(logErrorCalls[0]?.scope, "api.import");
  assert.equal(
    (logErrorCalls[0]?.context as Record<string, unknown>)?.reason,
    "read-file",
  );
});

// ── parse success paths ───────────────────────────────────────────────────────

test("processImportUpload: non-empty markdown result returns ok:true with markdown", async () => {
  const file = fakeFile("doc.md", "text/markdown", "# Hello");
  const result = await processImportUpload(file, {
    subjectHash: "h1",
    deps: {
      validateImportFile: () => ({ ok: true, mime: "text/markdown" as const }),
      readFile: async () => Buffer.from("# Hello"),
      parseImportedFile: async () => "# Hello World",
      withTimeout: async (factory) => factory(new AbortController().signal),
      logError: () => {},
      logRouteDenial: () => {},
    },
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.markdown, "# Hello World");
  }
});

test("processImportUpload: whitespace-only markdown result returns status 422", async () => {
  const file = fakeFile("empty.html", "text/html", "   ");
  const result = await processImportUpload(file, {
    subjectHash: "h1",
    deps: {
      validateImportFile: () => ({ ok: true, mime: "text/html" as const }),
      readFile: async () => Buffer.from("   "),
      parseImportedFile: async () => "   ",
      withTimeout: async (factory) => factory(new AbortController().signal),
      logError: () => {},
      logRouteDenial: () => {},
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.status, 422);
    assert.equal(result.error.code, "malformed");
    assert.ok(
      result.error.message.toLowerCase().includes("no readable text"),
      "error must mention no readable text",
    );
  }
});

// ── parse error paths ─────────────────────────────────────────────────────────

test("processImportUpload: ParseTimeoutError returns timeout 408 and calls logRouteDenial with subjectHash", async () => {
  const file = fakeFile("doc.pdf", "application/pdf");
  const logRouteDenialCalls: Array<Record<string, unknown>> = [];
  const logErrorCalls: unknown[] = [];

  const result = await processImportUpload(file, {
    subjectHash: "deadbeef",
    deps: {
      validateImportFile: () => ({
        ok: true,
        mime: "application/pdf" as const,
      }),
      readFile: async () => Buffer.alloc(4),
      withTimeout: async () => {
        throw new ParseTimeoutError(15_000);
      },
      logError: (scope, error, context) => {
        logErrorCalls.push({ scope, error, context });
      },
      logRouteDenial: (event) => {
        logRouteDenialCalls.push(event as unknown as Record<string, unknown>);
      },
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.status, 408);
    assert.equal(result.error.code, "timeout");
  }
  assert.equal(
    logErrorCalls.length,
    1,
    "logError must be called once on parse timeout",
  );
  assert.equal(
    logRouteDenialCalls.length,
    1,
    "logRouteDenial must be called once on parse timeout",
  );
  assert.equal(
    logRouteDenialCalls[0]?.["reason"],
    "parser-timeout",
    "denial reason must be parser-timeout",
  );
  assert.equal(
    logRouteDenialCalls[0]?.["subjectHash"],
    "deadbeef",
    "denial must carry the caller-supplied subjectHash",
  );
});

test("processImportUpload: ParseAbortedError returns aborted 408 without abuse denial", async () => {
  const file = fakeFile("doc.pdf", "application/pdf");
  const logRouteDenialCalls: Array<Record<string, unknown>> = [];
  const logErrorCalls: Array<{ context: Record<string, unknown> | undefined }> =
    [];

  const result = await processImportUpload(file, {
    subjectHash: "aborted-hash",
    deps: {
      validateImportFile: () => ({
        ok: true,
        mime: "application/pdf" as const,
      }),
      readFile: async () => Buffer.alloc(4),
      withTimeout: async () => {
        throw new ParseAbortedError();
      },
      logError: (_scope, _error, context) => {
        logErrorCalls.push({ context });
      },
      logRouteDenial: (event) => {
        logRouteDenialCalls.push(event as unknown as Record<string, unknown>);
      },
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.status, 408);
    assert.equal(result.error.code, "aborted");
  }
  assert.equal(logErrorCalls.length, 1);
  assert.equal(logErrorCalls[0]?.context?.reason, "parse-aborted");
  assert.equal(logRouteDenialCalls.length, 0);
});

test("processImportUpload: ImportBudgetError returns archive-limits 422 and calls logRouteDenial with subjectHash", async () => {
  const file = fakeFile(
    "slides.pptx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  );
  const logRouteDenialCalls: Array<Record<string, unknown>> = [];
  const logErrorCalls: unknown[] = [];

  const result = await processImportUpload(file, {
    subjectHash: "cafebabe",
    deps: {
      validateImportFile: () => ({
        ok: true,
        mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" as const,
      }),
      readFile: async () => Buffer.alloc(4),
      withTimeout: async () => {
        throw new ImportBudgetError("archive expands to too much data");
      },
      logError: (scope, error, context) => {
        logErrorCalls.push({ scope, error, context });
      },
      logRouteDenial: (event) => {
        logRouteDenialCalls.push(event as unknown as Record<string, unknown>);
      },
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.status, 422);
    assert.equal(result.error.code, "archive_limits");
  }
  assert.equal(
    logErrorCalls.length,
    1,
    "logError must be called once on budget error",
  );
  assert.equal(
    logRouteDenialCalls.length,
    1,
    "logRouteDenial must be called once on budget error",
  );
  assert.equal(
    logRouteDenialCalls[0]?.["reason"],
    "parser-budget",
    "denial reason for budget error must be parser-budget",
  );
  assert.equal(
    logRouteDenialCalls[0]?.["subjectHash"],
    "cafebabe",
    "denial must carry the caller-supplied subjectHash",
  );
});

test("processImportUpload: encrypted documents map to encrypted 422", async () => {
  const file = fakeFile(
    "secret.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  const logRouteDenialCalls: unknown[] = [];
  const result = await processImportUpload(file, {
    subjectHash: "encrypted-subject",
    deps: {
      validateImportFile: () => ({
        ok: true,
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const,
      }),
      readFile: async () => Buffer.alloc(4),
      withTimeout: async () => {
        throw new EncryptedImportError();
      },
      logError: () => {},
      logRouteDenial: (event) => {
        logRouteDenialCalls.push(event);
      },
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.status, 422);
    assert.equal(result.error.code, "encrypted");
  }
  assert.equal(logRouteDenialCalls.length, 0);
});

test("processImportUpload: generic parse error returns 422, logError called, logRouteDenial NOT called", async () => {
  const file = fakeFile("doc.md", "text/markdown");
  const logRouteDenialCalls: unknown[] = [];
  const logErrorCalls: unknown[] = [];

  const result = await processImportUpload(file, {
    subjectHash: "h1",
    deps: {
      validateImportFile: () => ({ ok: true, mime: "text/markdown" as const }),
      readFile: async () => Buffer.from("data"),
      withTimeout: async () => {
        throw new Error("unexpected parser crash");
      },
      logError: (scope, error, context) => {
        logErrorCalls.push({ scope, error, context });
      },
      logRouteDenial: (event) => {
        logRouteDenialCalls.push(event);
      },
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.status, 422);
    assert.equal(result.error.code, "malformed");
  }
  assert.equal(
    logErrorCalls.length,
    1,
    "logError must be called once on generic parse error",
  );
  assert.equal(
    logRouteDenialCalls.length,
    0,
    "logRouteDenial must NOT be called for a generic error",
  );
});

// ── cleanup / no-unintended-write ─────────────────────────────────────────────

test("processImportUpload: clean success calls neither logError nor logRouteDenial", async () => {
  const file = fakeFile("notes.md", "text/markdown", "# Title\n\nBody text.");
  const logErrorCalls: unknown[] = [];
  const logRouteDenialCalls: unknown[] = [];

  const result = await processImportUpload(file, {
    subjectHash: "h1",
    deps: {
      validateImportFile: () => ({ ok: true, mime: "text/markdown" as const }),
      readFile: async () => Buffer.from("# Title\n\nBody text."),
      parseImportedFile: async () => "# Title\n\nBody text.",
      withTimeout: async (factory) => factory(new AbortController().signal),
      logError: () => {
        logErrorCalls.push(null);
      },
      logRouteDenial: () => {
        logRouteDenialCalls.push(null);
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(
    logErrorCalls.length,
    0,
    "logError must not be called on a clean success",
  );
  assert.equal(
    logRouteDenialCalls.length,
    0,
    "logRouteDenial must not be called on a clean success",
  );
});
