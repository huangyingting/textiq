---
type: "architecture"
status: "current"
last_updated: "2026-07-10"
description: "The import subsystem parses uploaded .md, .html, .docx, .pptx, and .pdf files into Markdown-compatible text that can be converted into the current Lexical document JSON. It is a public, server-side parsing surface, so validation and abuse controls are part of the design contract."
---

# Document Import Pipeline

The import subsystem parses uploaded `.md`, `.html`, `.docx`, `.pptx`, and
`.pdf` files into Markdown-compatible text that can be converted into the
current Lexical document JSON. It is a public, server-side parsing surface, so
validation and abuse controls are part of the design contract.

## Source Anchors

| Area                     | Source                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| Client workflow          | [`src/lib/import/document-import-workflow.ts`](../../src/lib/import/document-import-workflow.ts) |
| Import API route         | [`src/app/api/import/route.ts`](../../src/app/api/import/route.ts)                               |
| Multipart parser         | [`src/app/api/import/parser.ts`](../../src/app/api/import/parser.ts)                             |
| Upload service           | [`src/lib/import/upload-service.ts`](../../src/lib/import/upload-service.ts)                     |
| MIME and size validation | [`src/lib/import/validate.ts`](../../src/lib/import/validate.ts)                                 |
| Format dispatcher        | [`src/lib/import/index.ts`](../../src/lib/import/index.ts)                                       |
| Text normalization       | [`src/lib/import/normalize.ts`](../../src/lib/import/normalize.ts)                               |
| Parse timeout            | [`src/lib/import/timeout.ts`](../../src/lib/import/timeout.ts)                                   |
| Archive budget           | [`src/lib/import/archive-budget.ts`](../../src/lib/import/archive-budget.ts)                     |
| Document creation        | [`src/lib/document/create.ts`](../../src/lib/document/create.ts)                                 |

## Flow

```text
File picker / dropzone
  -> useDocumentImportWorkflow
  -> POST /api/import multipart form-data
  -> parseImportUploadRequest (src/app/api/import/parser.ts)
  -> processImportUpload
  -> validateImportFile
  -> parseImportedFile
  -> normalizeImportedText
  -> { markdown }
  -> createDocumentFromImportForUser / editor insertion
```

The client rejects files above the global import ceiling before upload and emits
product telemetry for start/success/failure. The server repeats validation and
is authoritative.

## Accepted Formats

| Format         | Parser behavior                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------- |
| Markdown/plain | Decode as UTF-8 text.                                                                           |
| HTML           | Convert HTML to Markdown-compatible text.                                                       |
| DOCX           | Parse server-side through the DOCX parser.                                                      |
| PPTX           | Read slide shapes, native table cells, and linked speaker notes from the Office archive parser. |
| PDF            | Extract text server-side through the PDF parser.                                                |

MIME type is resolved first from the browser-provided MIME value. When browsers
send a generic MIME type for office files, the validator falls back to the file
extension. Each accepted MIME type has its own byte ceiling, all at or below the
global upload limit.

## Abuse Controls

`POST /api/import` is public and runs heavyweight parsers, so the route is
protected by:

- DB-backed per-IP fixed-window rate limiting;
- `AUTH_SECRET`-backed hashing for the rate-limit subject;
- shared API error bodies for validation, too-many-requests, and server errors;
- parser timeout with a clear 422 response;
- Office archive budgets for entry count, per-entry uncompressed bytes, and
  total uncompressed bytes;
- allowlisted abuse diagnostics for rate-limit hits and parser budget/timeout
  failures.

Missing `AUTH_SECRET` is treated as server misconfiguration and fails closed.

## Normalization Contract

All parser output is normalized before returning to callers:

- null bytes and non-printable control characters are removed, except tabs and
  newlines;
- three or more consecutive newlines collapse to two newline characters (one
  blank line);
- leading/trailing whitespace is trimmed;
- text is truncated to `AI_GENERATION_INPUT_MAX_CHARS`, preferring a newline boundary.

An empty normalized result is rejected with `422` so callers never create a
blank imported document accidentally.

## Invariants

1. Heavy parsers stay server-only and never enter the client bundle.
2. Server validation is authoritative even when the client pre-validates.
3. Parser work is bounded by rate limits, timeout, and archive budgets.
4. The API returns normalized Markdown-compatible text, not persisted state.
5. Document creation converts imported text to current Lexical JSON before save.
6. Import telemetry uses file type, size/duration buckets, surface, and stable
   failure reasons; it does not include document content.

## Primary Tests

- [`src/app/api/import/parser.test.ts`](../../src/app/api/import/parser.test.ts)
- [`src/lib/import/validate.test.ts`](../../src/lib/import/validate.test.ts)
- [`src/lib/import/normalize.test.ts`](../../src/lib/import/normalize.test.ts)
- [`src/lib/import/timeout.test.ts`](../../src/lib/import/timeout.test.ts)
- [`src/lib/import/archive-budget.test.ts`](../../src/lib/import/archive-budget.test.ts)
- [`src/lib/import/html.test.ts`](../../src/lib/import/html.test.ts)
- [`e2e/import/import-roundtrip.spec.ts`](../../e2e/import/import-roundtrip.spec.ts)
