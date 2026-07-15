/**
 * Central import dispatcher.
 *
 * Given a validated MIME type and the raw file buffer, dispatches to the
 * appropriate parser and returns normalized plain text / Markdown that can be
 * passed to `markdownToLexicalState`.
 *
 * All parsers are server-only (they import `server-only`); this module should
 * only be imported from server-side code (route handlers / server actions).
 */
import "server-only";

import type { AcceptedMimeType } from "./validate";
import { normalizeImportedText } from "./normalize";
import { htmlToMarkdown } from "./html";
import { parseDocx } from "./docx";
import { parsePptx } from "./pptx";
import { parsePdf } from "./pdf";

export { validateImportFile, formatValidationError } from "./validate";

/**
 * Parses an uploaded file buffer and returns the extracted text, normalized
 * and ready for insertion into a Lexical editor state.
 *
 * @param mime    - The resolved MIME type (from `validateImportFile`).
 * @param buffer  - The raw file bytes.
 *
 * @throws when the underlying parser reports a malformed file.
 */
export async function parseImportedFile(
  mime: AcceptedMimeType,
  buffer: Buffer,
  signal?: AbortSignal,
): Promise<string> {
  let raw: string;

  switch (mime) {
    case "text/markdown":
    case "text/x-markdown":
    case "text/plain":
      // Already plain text / Markdown — decode as UTF-8.
      raw = buffer.toString("utf-8");
      break;

    case "text/html":
      raw = htmlToMarkdown(buffer.toString("utf-8"));
      break;

    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      raw = await parseDocx(buffer, { signal });
      break;

    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      raw = await parsePptx(buffer, { signal });
      break;

    case "application/pdf":
      raw = await parsePdf(buffer, { signal });
      break;

    default: {
      // TypeScript exhaustiveness guard.
      const _exhaustive: never = mime;
      void _exhaustive;
      throw new Error(`Unsupported MIME type: ${String(mime)}`);
    }
  }

  return normalizeImportedText(raw);
}
