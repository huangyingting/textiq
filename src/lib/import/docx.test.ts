/**
 * Behaviour contracts for `parseDocx` (#1880).
 *
 * docx.ts carries `import "server-only"` so it cannot be loaded under a plain
 * Node test runner without the same shim used by upload-service.test.ts:
 * pre-populate require.cache for the `server-only` package with a no-op
 * before the CJS require of the UUT.
 *
 * Every fixture here is a minimal in-memory ZIP built with `JSZip` at test
 * run time (mirrors pptx.test.ts) — no binary `.docx` file is committed to
 * the repo.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import JSZip from "jszip";

import { ImportBudgetError, IMPORT_ZIP_MAX_ENTRIES } from "./archive-budget";

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
const { parseDocx } = require("./docx") as typeof import("./docx");
/* eslint-enable @typescript-eslint/no-require-imports */

// ── helpers ──────────────────────────────────────────────────────────────────

/** Builds a minimal but fully valid in-memory `.docx` buffer. */
async function minimalDocx(bodyXml: string): Promise<Buffer> {
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
  <w:body>${bodyXml}</w:body>
</w:document>`,
  );
  return Buffer.from(await zip.generateAsync({ type: "uint8array" }));
}

// ── success ──────────────────────────────────────────────────────────────────

test("parseDocx converts a heading + paragraph to Markdown-compatible text", async () => {
  const buffer = await minimalDocx(
    `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Title Here</w:t></w:r></w:p>
     <w:p><w:r><w:t>Hello DOCX body text.</w:t></w:r></w:p>`,
  );

  const text = await parseDocx(buffer);
  assert.equal(text, "# Title Here\n\nHello DOCX body text.");
});

// ── malformed / empty input ───────────────────────────────────────────────────

test("parseDocx rejects an empty buffer", async () => {
  await assert.rejects(() => parseDocx(Buffer.alloc(0)));
});

test("parseDocx rejects a buffer that is not a zip at all", async () => {
  await assert.rejects(() => parseDocx(Buffer.from("not a docx at all")));
});

test("parseDocx rejects a valid zip that is missing the Word document part", async () => {
  const zip = new JSZip();
  zip.file("readme.txt", "just a plain zip, not a docx");
  const buffer = Buffer.from(await zip.generateAsync({ type: "uint8array" }));

  await assert.rejects(
    () => parseDocx(buffer),
    /main document part|valid \.docx/i,
  );
});

// ── archive budget ─────────────────────────────────────────────────────────────

test("parseDocx propagates ImportBudgetError when the archive exceeds the entry-count budget", async () => {
  const zip = new JSZip();
  for (let i = 0; i <= IMPORT_ZIP_MAX_ENTRIES; i++) {
    zip.file(`f-${i}.txt`, "");
  }
  const buffer = Buffer.from(await zip.generateAsync({ type: "uint8array" }));

  await assert.rejects(
    () => parseDocx(buffer),
    (error: unknown) => {
      assert.ok(error instanceof ImportBudgetError);
      return true;
    },
  );
});
