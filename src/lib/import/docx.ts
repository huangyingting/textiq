/**
 * DOCX → plain Markdown-like text via `mammoth`.
 *
 * `mammoth` converts Word documents to HTML; we then run the result through the
 * `htmlToMarkdown` converter so the output is in the Markdown subset the editor
 * already understands (headings, bullets, paragraphs).
 *
 * Server-only: `mammoth` is a Node.js library and must never be imported on the
 * client. The route handler that calls this file already carries `runtime = 'nodejs'`.
 */
import "server-only";

import mammoth from "mammoth";

import { disposeZip, loadZipWithinBudget } from "./archive-budget";
import { htmlToMarkdown } from "./html";
import { EncryptedImportError } from "./import-errors";
import { throwIfAborted } from "./timeout";

/**
 * Extracts text from a DOCX `Buffer` and returns it as Markdown-compatible text.
 * Throws when `mammoth` cannot parse the buffer (e.g. corrupt file).
 */
export async function parseDocx(
  buffer: Buffer,
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal);
  const zip = await loadZipWithinBudget(buffer, signal);
  try {
    if (zip.files["EncryptionInfo"] && zip.files["EncryptedPackage"]) {
      throw new EncryptedImportError();
    }
    throwIfAborted(signal);
    const result = await mammoth.convertToHtml({ buffer });
    throwIfAborted(signal);
    return htmlToMarkdown(result.value);
  } finally {
    disposeZip(zip);
  }
}
