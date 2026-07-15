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
import { hasOleCompoundFileSignature } from "./office-signature";
import { throwIfAborted } from "./timeout";

/**
 * Extracts text from a DOCX `Buffer` and returns it as Markdown-compatible text.
 * Throws when `mammoth` cannot parse the buffer (e.g. corrupt file).
 */
export type ParseDocxOptions = {
  signal?: AbortSignal;
};

export async function parseDocx(
  buffer: Buffer,
  options: ParseDocxOptions = {},
): Promise<string> {
  const { signal } = options;
  throwIfAborted(signal);
  if (hasOleCompoundFileSignature(buffer)) {
    throw new EncryptedImportError();
  }

  const zip = await loadZipWithinBudget(buffer, signal);
  try {
    if (zip.files["EncryptionInfo"] && zip.files["EncryptedPackage"]) {
      throw new EncryptedImportError();
    }
    throwIfAborted(signal);
    const result = await mammoth.convertToHtml({ buffer });
    throwIfAborted(signal);
    const markdown = htmlToMarkdown(result.value);
    throwIfAborted(signal);
    return markdown;
  } finally {
    disposeZip(zip);
  }
}
