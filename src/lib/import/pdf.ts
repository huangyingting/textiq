/**
 * PDF → plain text extractor using the `pdf-parse` v2 package (`PDFParse`).
 *
 * `pdf-parse` wraps `pdfjs-dist` and runs entirely in Node.js, making it safe
 * for server-only route handlers. The parser is instantiated per-call and
 * destroyed after use to release internal worker resources.
 *
 * Server-only: `pdf-parse` must never be imported on the client.
 */
import "server-only";

import { PDFParse } from "pdf-parse";

import { ImportBudgetError } from "./archive-budget";

const PDF_MAX_PAGES = 250;
const PDF_MAX_TEXT_CHARS = 500_000;

type PdfTextResult = {
  text: string;
  total?: unknown;
  totalPages?: unknown;
};

/**
 * Extracts text from a PDF `Buffer` and returns it as a plain text string.
 * Throws when `pdf-parse` cannot load or read the document.
 */
export async function parsePdf(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result: PdfTextResult = await parser.getText();
    const pageCount = Number(result.totalPages ?? result.total);
    if (Number.isFinite(pageCount) && pageCount > PDF_MAX_PAGES) {
      throw new ImportBudgetError("PDF contains too many pages.");
    }
    if (result.text.length > PDF_MAX_TEXT_CHARS) {
      throw new ImportBudgetError("PDF contains too much text.");
    }
    return result.text;
  } finally {
    await parser.destroy();
  }
}
