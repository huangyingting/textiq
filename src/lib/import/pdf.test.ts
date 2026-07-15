/**
 * Behaviour contracts for `parsePdf` (#1880).
 *
 * pdf.ts carries `import "server-only"` so it cannot be loaded under a plain
 * Node test runner without the same shim used by upload-service.test.ts:
 * pre-populate require.cache for the `server-only` package with a no-op
 * before the CJS require of the UUT.
 *
 * Success / malformed-input coverage uses a tiny, hand-written, text-based
 * PDF (raw PDF syntax is plain ASCII) so no binary fixture needs to be
 * committed. Page-count and character-budget coverage uses the
 * `ParsePdfDeps.createParser` injection seam instead of generating a real
 * 251-page or 500,001-character PDF.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { ImportBudgetError } from "./archive-budget";

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
const { parsePdf } = require("./pdf") as typeof import("./pdf");
/* eslint-enable @typescript-eslint/no-require-imports */

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * A minimal single-page PDF containing the given text, written directly in
 * raw (text-based) PDF syntax. `pdf-parse`/`pdfjs-dist` can read this without
 * needing a binary fixture on disk.
 */
function minimalPdf(text: string): Buffer {
  const stream = `BT /F1 18 Tf 20 100 Td (${text}) Tj ET`;
  return Buffer.from(
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
}

/** A fake `PdfParserHandle` reporting the given text/page-count, for budget tests. */
function fakeParser(
  result: { text: string; total?: number; totalPages?: number },
  onDestroy?: () => void,
) {
  return {
    getText: async () => result,
    destroy: async () => {
      onDestroy?.();
    },
  };
}

// ── success ──────────────────────────────────────────────────────────────────

test("parsePdf extracts real text from a minimal single-page PDF", async () => {
  const text = await parsePdf(minimalPdf("Hello PDF"));
  assert.ok(
    text.includes("Hello PDF"),
    "extracted text must include the source string",
  );
});

test("parsePdf uses `total` when `totalPages` is absent and stays within budget", async () => {
  let destroyed = false;
  const deps = {
    createParser: () =>
      fakeParser({ text: "short doc", total: 5 }, () => {
        destroyed = true;
      }),
  };

  const text = await parsePdf(Buffer.from("ignored"), deps);
  assert.equal(text, "short doc");
  assert.equal(destroyed, true, "parser.destroy() must always be called");
});

// ── malformed / empty input ───────────────────────────────────────────────────

test("parsePdf rejects an empty buffer", async () => {
  await assert.rejects(() => parsePdf(Buffer.alloc(0)));
});

test("parsePdf rejects a buffer that is not a PDF at all", async () => {
  await assert.rejects(() =>
    parsePdf(Buffer.from("this is definitely not a pdf")),
  );
});

// ── page-count budget ─────────────────────────────────────────────────────────

test("parsePdf throws ImportBudgetError when the page count exceeds the budget", async () => {
  let destroyed = false;
  const deps = {
    createParser: () =>
      fakeParser({ text: "lots of pages", totalPages: 251 }, () => {
        destroyed = true;
      }),
  };

  await assert.rejects(
    () => parsePdf(Buffer.from("ignored"), deps),
    (error: unknown) => {
      assert.ok(error instanceof ImportBudgetError);
      assert.match((error as Error).message, /too many pages/i);
      return true;
    },
  );
  assert.equal(
    destroyed,
    true,
    "parser.destroy() must run even when the budget check throws",
  );
});

test("parsePdf allows a page count exactly at the budget", async () => {
  const deps = {
    createParser: () => fakeParser({ text: "at the edge", totalPages: 250 }),
  };
  const text = await parsePdf(Buffer.from("ignored"), deps);
  assert.equal(text, "at the edge");
});

test("parsePdf ignores a non-finite page count and falls through to the text-length check", async () => {
  const deps = {
    createParser: () =>
      fakeParser({ text: "no usable page count", totalPages: Number.NaN }),
  };
  const text = await parsePdf(Buffer.from("ignored"), deps);
  assert.equal(text, "no usable page count");
});

// ── text-length budget ───────────────────────────────────────────────────────

test("parsePdf throws ImportBudgetError when extracted text exceeds the character budget", async () => {
  let destroyed = false;
  const deps = {
    createParser: () =>
      fakeParser({ text: "x".repeat(500_001), totalPages: 1 }, () => {
        destroyed = true;
      }),
  };

  await assert.rejects(
    () => parsePdf(Buffer.from("ignored"), deps),
    (error: unknown) => {
      assert.ok(error instanceof ImportBudgetError);
      assert.match((error as Error).message, /too much text/i);
      return true;
    },
  );
  assert.equal(
    destroyed,
    true,
    "parser.destroy() must run even when the budget check throws",
  );
});

test("parsePdf allows text exactly at the character budget", async () => {
  const deps = {
    createParser: () =>
      fakeParser({ text: "x".repeat(500_000), totalPages: 1 }),
  };
  const text = await parsePdf(Buffer.from("ignored"), deps);
  assert.equal(text.length, 500_000);
});

// ── cleanup ──────────────────────────────────────────────────────────────────

test("parsePdf destroys the parser even when getText() rejects", async () => {
  let destroyed = false;
  const deps = {
    createParser: () => ({
      getText: async () => {
        throw new Error("simulated pdfjs failure");
      },
      destroy: async () => {
        destroyed = true;
      },
    }),
  };

  await assert.rejects(() => parsePdf(Buffer.from("ignored"), deps));
  assert.equal(destroyed, true);
});

test("parsePdf abort signal destroys parser and rejects without continuing", async () => {
  let destroyCount = 0;
  let rejectGetText: ((reason?: unknown) => void) | null = null;
  const deps = {
    createParser: () => ({
      getText: async () =>
        new Promise<{ text: string }>((_resolve, reject) => {
          rejectGetText = reject;
        }),
      destroy: async () => {
        destroyCount += 1;
        rejectGetText?.(new Error("aborted"));
      },
    }),
  };

  const controller = new AbortController();
  const parsing = parsePdf(Buffer.from("ignored"), deps, controller.signal);
  controller.abort();

  await assert.rejects(() => parsing);
  assert.ok(destroyCount >= 1);
});
