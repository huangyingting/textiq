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
import { throwIfAborted } from "./timeout";

const PDF_MAX_PAGES = 250;
const PDF_MAX_TEXT_CHARS = 500_000;

type PdfTextResult = {
  text: string;
  total?: unknown;
  totalPages?: unknown;
};

/** The minimal surface `parsePdf` needs from a `PDFParse` instance. */
export interface PdfParserHandle {
  getText(): Promise<PdfTextResult>;
  destroy(): Promise<void>;
}

/**
 * Factory boundary for the underlying `pdf-parse` parser. Exposed so tests can
 * inject a fake handle that reports arbitrary page counts / text lengths
 * without needing to construct a real multi-hundred-page (or 500k-character)
 * PDF fixture to exercise the budget checks below.
 */
export interface ParsePdfDeps {
  createParser(buffer: Buffer): PdfParserHandle;
  onCleanupError?(error: unknown): void;
}

const defaultParsePdfDeps: ParsePdfDeps = {
  createParser: (buffer) => new PDFParse({ data: buffer }),
};

export type ParsePdfOptions = {
  deps?: ParsePdfDeps;
  signal?: AbortSignal;
  onCleanupError?(error: unknown): void;
};

/**
 * Extracts text from a PDF `Buffer` and returns it as a plain text string.
 * Throws when `pdf-parse` cannot load or read the document.
 */
export async function parsePdf(
  buffer: Buffer,
  options: ParsePdfOptions = {},
): Promise<string> {
  const deps = options.deps ?? defaultParsePdfDeps;
  const onCleanupError = options.onCleanupError ?? deps.onCleanupError;
  const signal = options.signal;
  const parser = deps.createParser(buffer);
  let destroyed = false;
  const destroyParser = async () => {
    if (destroyed) return;
    destroyed = true;
    try {
      await parser.destroy();
    } catch (error) {
      onCleanupError?.(error);
    }
  };
  const handleAbort = () => {
    void destroyParser();
  };
  signal?.addEventListener("abort", handleAbort, { once: true });
  try {
    throwIfAborted(signal);
    const result: PdfTextResult = await parser.getText();
    throwIfAborted(signal);
    const pageCount = Number(result.totalPages ?? result.total);
    if (Number.isFinite(pageCount) && pageCount > PDF_MAX_PAGES) {
      throw new ImportBudgetError("PDF contains too many pages.");
    }
    if (result.text.length > PDF_MAX_TEXT_CHARS) {
      throw new ImportBudgetError("PDF contains too much text.");
    }
    return result.text;
  } finally {
    signal?.removeEventListener("abort", handleAbort);
    await destroyParser();
  }
}
