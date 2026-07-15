/**
 * Shared validation helpers for the document import pipeline.
 *
 * All validation is pure (no I/O) so it can run in both the route handler
 * (server) and unit tests without any framework dependency.
 */

import { formatImportFileTooLargeError } from "@/lib/limits";
import {
  IMPORT_ACCEPTED_MIME_TYPES,
  IMPORT_MAX_BYTES_BY_MIME,
  IMPORT_MAX_UPLOAD_BYTES,
  importResourceForExtension,
  importResourceForMime,
  type ImportAcceptedMimeType,
} from "@/lib/import/format-registry";

export const MAX_UPLOAD_BYTES = IMPORT_MAX_UPLOAD_BYTES;
export const ACCEPTED_MIME_TYPES = IMPORT_ACCEPTED_MIME_TYPES;
export type AcceptedMimeType = ImportAcceptedMimeType;

/** Returns the per-type upload ceiling for a resolved MIME type. */
export function maxBytesForMime(mime: AcceptedMimeType): number {
  return IMPORT_MAX_BYTES_BY_MIME[mime];
}

/**
 * Resolves the effective MIME type for an uploaded file.
 *
 * Browsers sometimes report `application/octet-stream` for binary office
 * files. When that happens, we fall back to the file extension so the right
 * parser is chosen. Returns `null` when neither the MIME type nor the
 * extension map to a supported format.
 */
export function resolveImportMime(
  mimeType: string,
  filename: string,
): AcceptedMimeType | null {
  const byMime = importResourceForMime(mimeType);
  if (byMime) {
    const normalized = mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
    const resolved = byMime.mimes.find((mime) => mime === normalized);
    if (resolved) {
      return resolved;
    }
  }

  const byExtension = importResourceForExtension(filename);
  return byExtension?.mimes[0] ?? null;
}

export type ValidationError =
  | { code: "unsupported_type"; accepted: readonly string[] }
  | { code: "file_too_large"; maxBytes: number; actualBytes: number };

export type ValidationResult =
  | { ok: true; mime: AcceptedMimeType }
  | { ok: false; error: ValidationError };

/**
 * Validates that a file's MIME type is supported and its byte size is within
 * the per-type limit. Returns the resolved MIME type on success. The MIME type
 * is resolved first so the size limit applied is the one for the actual format
 * (#96, criterion 3).
 */
export function validateImportFile(
  mimeType: string,
  filename: string,
  byteSize: number,
): ValidationResult {
  const mime = resolveImportMime(mimeType, filename);
  if (!mime) {
    return {
      ok: false,
      error: { code: "unsupported_type", accepted: ACCEPTED_MIME_TYPES },
    };
  }

  const maxBytes = maxBytesForMime(mime);
  if (byteSize > maxBytes) {
    return {
      ok: false,
      error: {
        code: "file_too_large",
        maxBytes,
        actualBytes: byteSize,
      },
    };
  }

  return { ok: true, mime };
}

/**
 * Human-readable validation error message suitable for displaying in the UI.
 */
export function formatValidationError(error: ValidationError): string {
  switch (error.code) {
    case "unsupported_type":
      return "Unsupported file type. Please upload a .md, .html, .docx, .pptx, or .pdf file.";
    case "file_too_large": {
      return formatImportFileTooLargeError(error.maxBytes);
    }
  }
}
