/**
 * Dispatcher contracts for `parseImportedFile` (#1880).
 *
 * index.ts carries `import "server-only"` so it cannot be loaded under a
 * plain Node test runner without the same shim used by
 * upload-service.test.ts: pre-populate require.cache for the `server-only`
 * package with a no-op before the CJS require of the UUT.
 *
 * These tests exercise every switch branch (every supported MIME type) plus
 * the unsupported-type guard, and confirm the dispatcher composes the
 * type-specific parser with `normalizeImportedText` (e.g. collapsing runs of
 * blank lines) rather than returning the parser's raw output untouched.
 * Fixtures are minimal, purpose-built in-memory buffers/zips — detailed
 * parser behavior (PPTX tables/notes, DOCX budgets, PDF budgets) is covered
 * by pptx.test.ts, docx.test.ts, and pdf.test.ts and is not repeated here.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import JSZip from "jszip";

// ── server-only shim ─────────────────────────────────────────────────────────
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
const { parseImportedFile } = require("./index") as typeof import("./index");
/* eslint-enable @typescript-eslint/no-require-imports */

// ── plain-text / markdown branches ────────────────────────────────────────────

test("parseImportedFile: text/markdown decodes UTF-8 and normalizes blank-line runs", async () => {
  const text = await parseImportedFile(
    "text/markdown",
    Buffer.from("# Title\n\n\n\nBody", "utf-8"),
  );
  assert.equal(text, "# Title\n\nBody");
});

test("parseImportedFile: text/x-markdown uses the same decode path as text/markdown", async () => {
  const text = await parseImportedFile(
    "text/x-markdown",
    Buffer.from("# Title\n\n\n\nBody", "utf-8"),
  );
  assert.equal(text, "# Title\n\nBody");
});

test("parseImportedFile: text/plain decodes UTF-8 and trims surrounding whitespace", async () => {
  const text = await parseImportedFile(
    "text/plain",
    Buffer.from("  plain text  \n\n\n\nmore  ", "utf-8"),
  );
  assert.equal(text, "plain text  \n\nmore");
});

// ── html branch ────────────────────────────────────────────────────────────────

test("parseImportedFile: text/html converts to Markdown before normalizing", async () => {
  const text = await parseImportedFile(
    "text/html",
    Buffer.from("<h1>Head</h1><p>Body</p>", "utf-8"),
  );
  assert.equal(text, "# Head\n\nBody");
});

// ── docx branch ──────────────────────────────────────────────────────────────

test("parseImportedFile: dispatches DOCX MIME type to the DOCX parser", async () => {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>Dispatch check</w:t></w:r></w:p></w:body>
</w:document>`,
  );
  const buffer = Buffer.from(await zip.generateAsync({ type: "uint8array" }));

  const text = await parseImportedFile(
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer,
  );
  assert.equal(text, "Dispatch check");
});

// ── pptx branch ──────────────────────────────────────────────────────────────

test("parseImportedFile: dispatches PPTX MIME type to the PPTX parser", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:cSld><p:spTree>
        <p:sp><p:nvSpPr><p:nvPr/></p:nvSpPr><p:txBody><a:p><a:r><a:t>Dispatch check</a:t></a:r></a:p></p:txBody></p:sp>
      </p:spTree></p:cSld>
    </p:sld>`,
  );
  const buffer = Buffer.from(await zip.generateAsync({ type: "uint8array" }));

  const text = await parseImportedFile(
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer,
  );
  assert.equal(text, "Dispatch check");
});

// ── pdf branch ───────────────────────────────────────────────────────────────

test("parseImportedFile: dispatches PDF MIME type to the PDF parser", async () => {
  const stream = "BT /F1 18 Tf 20 100 Td (Dispatch check) Tj ET";
  const buffer = Buffer.from(
    `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 200 200] /Contents 5 0 R >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
5 0 obj
<< /Length ${stream.length} >>
stream
${stream}
endstream
endobj
xref
0 6
0000000000 65535 f 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
0
%%EOF`,
    "utf-8",
  );

  const text = await parseImportedFile("application/pdf", buffer);
  assert.ok(text.includes("Dispatch check"));
});

// ── unsupported input ──────────────────────────────────────────────────────────

test("parseImportedFile: throws a descriptive error for an unsupported MIME type", async () => {
  await assert.rejects(
    () =>
      parseImportedFile(
        // Deliberately outside the AcceptedMimeType union to exercise the
        // exhaustiveness guard.
        "application/zip" as any,
        Buffer.from("payload"),
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(
        (error as Error).message,
        "Unsupported MIME type: application/zip",
      );
      return true;
    },
  );
});
