import "server-only";

import { ABUSE_CATEGORIES, logRouteDenial } from "@/lib/diagnostics/api-abuse";
import { logError } from "@/lib/log";

import { parseImportedFile } from "./index";
import { ImportBudgetError } from "./archive-budget";
import {
  IMPORT_ERROR_CODES,
  importFailure,
  type ImportRouteFailure,
} from "./contract";
import { isEncryptedImportError } from "./import-errors";
import { ParseAbortedError, ParseTimeoutError, withTimeout } from "./timeout";
import {
  formatValidationError,
  validateImportFile,
  type AcceptedMimeType,
  type ValidationResult,
} from "./validate";

const LOG_SCOPE = "api.import";

export type ImportUploadResult =
  | { ok: true; markdown: string }
  | ImportRouteFailure;

type ParseImportedFile = (
  mime: AcceptedMimeType,
  buffer: Buffer,
  signal?: AbortSignal,
) => Promise<string>;

interface ImportUploadDeps {
  validateImportFile(
    mimeType: string,
    filename: string,
    byteSize: number,
  ): ValidationResult;
  readFile(file: File): Promise<Buffer>;
  parseImportedFile: ParseImportedFile;
  withTimeout<T>(factory: (signal: AbortSignal) => Promise<T>): Promise<T>;
  logError(
    scope: string,
    error: unknown,
    context?: Record<string, unknown>,
  ): void;
  logRouteDenial: typeof logRouteDenial;
}

const defaultDeps: ImportUploadDeps = {
  validateImportFile,
  readFile: async (file) => Buffer.from(await file.arrayBuffer()),
  parseImportedFile,
  withTimeout,
  logError,
  logRouteDenial,
};

function validationFailure(
  validation: ValidationResult,
): ImportRouteFailure | null {
  if (validation.ok) {
    return null;
  }

  if (validation.error.code === "file_too_large") {
    return importFailure(
      IMPORT_ERROR_CODES.TOO_LARGE,
      formatValidationError(validation.error),
    );
  }

  return importFailure(
    IMPORT_ERROR_CODES.UNSUPPORTED,
    formatValidationError(validation.error),
  );
}

export async function processImportUpload(
  file: File,
  options: {
    subjectHash: string;
    deps?: Partial<ImportUploadDeps>;
  },
): Promise<ImportUploadResult> {
  const deps = { ...defaultDeps, ...options.deps };
  const validation = deps.validateImportFile(file.type, file.name, file.size);
  if (!validation.ok) {
    return (
      validationFailure(validation) ??
      importFailure(IMPORT_ERROR_CODES.INTERNAL, "Import validation failed.")
    );
  }
  const mime = validation.mime;

  let buffer: Buffer;
  try {
    buffer = await deps.readFile(file);
  } catch (error) {
    const failure = importFailure(
      IMPORT_ERROR_CODES.MALFORMED,
      "Failed to read the uploaded file.",
      422,
    );
    deps.logError(LOG_SCOPE, error, {
      reason: "read-file",
      code: failure.error.code,
      status: failure.error.status,
    });
    return failure;
  }

  try {
    const markdown = await deps.withTimeout((signal) =>
      deps.parseImportedFile(mime, buffer, signal),
    );

    if (!markdown.trim()) {
      return importFailure(
        IMPORT_ERROR_CODES.MALFORMED,
        "No readable text was found in the uploaded file.",
      );
    }

    return { ok: true, markdown };
  } catch (error) {
    if (error instanceof ParseTimeoutError) {
      const failure = importFailure(
        IMPORT_ERROR_CODES.TIMEOUT,
        "The file took too long to parse. Try a smaller or simpler document.",
      );
      deps.logError(LOG_SCOPE, error, {
        reason: "parse-timeout",
        code: failure.error.code,
        status: failure.error.status,
      });
      deps.logRouteDenial({
        route: LOG_SCOPE,
        reason: ABUSE_CATEGORIES.PARSER_TIMEOUT,
        status: failure.error.status,
        subjectHash: options.subjectHash,
      });
      return failure;
    }
    if (error instanceof ParseAbortedError) {
      const failure = importFailure(
        IMPORT_ERROR_CODES.ABORTED,
        "The import was interrupted before parsing finished.",
      );
      deps.logError(LOG_SCOPE, error, {
        reason: "parse-aborted",
        code: failure.error.code,
        status: failure.error.status,
      });
      return failure;
    }
    if (error instanceof ImportBudgetError) {
      const failure = importFailure(
        IMPORT_ERROR_CODES.ARCHIVE_LIMITS,
        "The file is too complex to parse. Try a smaller or simpler document.",
      );
      deps.logError(LOG_SCOPE, error, {
        reason: "parser-budget",
        code: failure.error.code,
        status: failure.error.status,
      });
      deps.logRouteDenial({
        route: LOG_SCOPE,
        reason: ABUSE_CATEGORIES.PARSER_BUDGET,
        status: failure.error.status,
        subjectHash: options.subjectHash,
      });
      return failure;
    }
    if (isEncryptedImportError(error)) {
      const failure = importFailure(
        IMPORT_ERROR_CODES.ENCRYPTED,
        "Encrypted documents are not supported. Remove the password and try again.",
      );
      deps.logError(LOG_SCOPE, error, {
        reason: "parse-encrypted",
        code: failure.error.code,
        status: failure.error.status,
      });
      return failure;
    }

    const failure = importFailure(
      IMPORT_ERROR_CODES.MALFORMED,
      "Could not parse the file. Make sure it is a valid, uncorrupted document.",
    );
    deps.logError(LOG_SCOPE, error, {
      reason: "parse-failed",
      code: failure.error.code,
      status: failure.error.status,
    });
    return failure;
  }
}
