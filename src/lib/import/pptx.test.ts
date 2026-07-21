import assert from "node:assert/strict";
import { test } from "node:test";

import JSZip from "jszip";

import { ImportBudgetError, IMPORT_ZIP_MAX_ENTRIES } from "./archive-budget";
import { EncryptedImportError } from "./import-errors";
import { parsePptx } from "./pptx-parser";
import { ParseAbortedError } from "./timeout";

test("parsePptx extracts shape text, native table cells, and linked notes", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `
    <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <p:cSld>
        <p:spTree>
          <p:sp>
            <p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
            <p:txBody><a:p><a:r><a:t>Quarterly update</a:t></a:r></a:p></p:txBody>
          </p:sp>
          <p:sp>
            <p:nvSpPr><p:nvPr/></p:nvSpPr>
            <p:txBody><a:p><a:r><a:t>Intro text &#128512; &#x1F600;</a:t></a:r></a:p></p:txBody>
          </p:sp>
          <p:graphicFrame>
            <a:graphic>
              <a:graphicData>
                <a:tbl>
                  <a:tr>
                    <a:tc><a:txBody><a:p><a:r><a:t>Region</a:t></a:r></a:p></a:txBody></a:tc>
                    <a:tc><a:txBody><a:p><a:r><a:t>ARR</a:t></a:r></a:p></a:txBody></a:tc>
                  </a:tr>
                  <a:tr>
                    <a:tc><a:txBody><a:p><a:r><a:t>NA</a:t></a:r></a:p></a:txBody></a:tc>
                    <a:tc><a:txBody><a:p><a:r><a:t>$12M</a:t></a:r></a:p></a:txBody></a:tc>
                  </a:tr>
                </a:tbl>
              </a:graphicData>
            </a:graphic>
          </p:graphicFrame>
        </p:spTree>
      </p:cSld>
    </p:sld>
    `,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>
    </Relationships>
    `,
  );
  zip.file(
    "ppt/notesSlides/notesSlide1.xml",
    `
    <p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:cSld>
        <p:spTree>
          <p:sp>
            <p:txBody><a:p><a:r><a:t>Remember to mention retention.</a:t></a:r></a:p></p:txBody>
          </p:sp>
        </p:spTree>
      </p:cSld>
    </p:notes>
    `,
  );

  const buffer = Buffer.from(await zip.generateAsync({ type: "uint8array" }));
  const text = await parsePptx(buffer);

  assert.ok(text.includes("## Quarterly update"));
  assert.ok(text.includes("Intro text 😀 😀"));
  assert.ok(text.includes("| Region | ARR |"));
  assert.ok(text.includes("| NA | $12M |"));
  assert.ok(text.includes("### Speaker notes"));
  assert.ok(text.includes("Remember to mention retention."));
});

test("parsePptx retains table-only slide content", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `
    <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:cSld>
        <p:spTree>
          <p:graphicFrame>
            <a:graphic>
              <a:graphicData>
                <a:tbl>
                  <a:tr>
                    <a:tc><a:txBody><a:p><a:r><a:t>KPI</a:t></a:r></a:p></a:txBody></a:tc>
                    <a:tc><a:txBody><a:p><a:r><a:t>Value</a:t></a:r></a:p></a:txBody></a:tc>
                  </a:tr>
                  <a:tr>
                    <a:tc><a:txBody><a:p><a:r><a:t>Retention</a:t></a:r></a:p></a:txBody></a:tc>
                    <a:tc><a:txBody><a:p><a:r><a:t>96%</a:t></a:r></a:p></a:txBody></a:tc>
                  </a:tr>
                </a:tbl>
              </a:graphicData>
            </a:graphic>
          </p:graphicFrame>
        </p:spTree>
      </p:cSld>
    </p:sld>
    `,
  );

  const buffer = Buffer.from(await zip.generateAsync({ type: "uint8array" }));
  const text = await parsePptx(buffer);

  assert.ok(text.includes("| KPI | Value |"));
  assert.ok(text.includes("| Retention | 96% |"));
});

test("parsePptx rejects a non-zip payload as malformed", async () => {
  await assert.rejects(() => parsePptx(Buffer.from("not-a-pptx")));
});

test("parsePptx rejects encrypted Office payloads with typed error", async () => {
  const zip = new JSZip();
  zip.file("EncryptionInfo", "info");
  zip.file("EncryptedPackage", "payload");
  const buffer = Buffer.from(await zip.generateAsync({ type: "uint8array" }));

  await assert.rejects(
    () => parsePptx(buffer),
    (error: unknown) => error instanceof EncryptedImportError,
  );
});

test("parsePptx rejects OLE compound-file payloads before ZIP parsing", async () => {
  const oleBuffer = Buffer.from([
    0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00,
  ]);

  await assert.rejects(
    () => parsePptx(oleBuffer),
    (error: unknown) => error instanceof EncryptedImportError,
  );
});

test("parsePptx enforces archive entry budget", async () => {
  const zip = new JSZip();
  for (let index = 0; index <= IMPORT_ZIP_MAX_ENTRIES; index += 1) {
    zip.file(`ppt/slides/slide-${index}.xml`, "<p:sld/>");
  }
  const buffer = Buffer.from(await zip.generateAsync({ type: "uint8array" }));

  await assert.rejects(
    () => parsePptx(buffer),
    (error: unknown) => error instanceof ImportBudgetError,
  );
});

test("parsePptx observes an already-aborted signal before parsing", async () => {
  const zip = new JSZip();
  zip.file("ppt/slides/slide1.xml", "<p:sld/>");
  const buffer = Buffer.from(await zip.generateAsync({ type: "uint8array" }));
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () => parsePptx(buffer, { signal: controller.signal }),
    (error: unknown) => error instanceof ParseAbortedError,
  );
});

test("parsePptx aborts during parsing and drops late slide results", async () => {
  const zip = new JSZip();
  zip.file("ppt/slides/slide1.xml", "<p:sld/>");
  const buffer = Buffer.from(await zip.generateAsync({ type: "uint8array" }));
  const controller = new AbortController();

  const parsing = parsePptx(buffer, { signal: controller.signal });
  controller.abort();

  await assert.rejects(
    () => parsing,
    (error: unknown) => error instanceof ParseAbortedError,
  );
});
