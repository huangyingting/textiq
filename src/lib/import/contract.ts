import {
  isFiniteNumber,
  isNonEmptyString,
  isPlainObject,
} from "@/lib/type-guards";

export const IMPORT_ERROR_CODES = {
  UNSUPPORTED: "unsupported",
  TOO_LARGE: "too_large",
  MALFORMED: "malformed",
  ENCRYPTED: "encrypted",
  ARCHIVE_LIMITS: "archive_limits",
  TIMEOUT: "timeout",
  ABORTED: "aborted",
  UNAUTHORIZED: "unauthorized",
  FORBIDDEN: "forbidden",
  PERSISTENCE: "persistence",
  CONFLICT: "conflict",
  INTERNAL: "internal",
} as const;

export type ImportErrorCode =
  (typeof IMPORT_ERROR_CODES)[keyof typeof IMPORT_ERROR_CODES];

export const IMPORT_ERROR_STATUS_BY_CODE: Record<ImportErrorCode, number> = {
  [IMPORT_ERROR_CODES.UNSUPPORTED]: 415,
  [IMPORT_ERROR_CODES.TOO_LARGE]: 413,
  [IMPORT_ERROR_CODES.MALFORMED]: 422,
  [IMPORT_ERROR_CODES.ENCRYPTED]: 422,
  [IMPORT_ERROR_CODES.ARCHIVE_LIMITS]: 422,
  [IMPORT_ERROR_CODES.TIMEOUT]: 408,
  [IMPORT_ERROR_CODES.ABORTED]: 408,
  [IMPORT_ERROR_CODES.UNAUTHORIZED]: 401,
  [IMPORT_ERROR_CODES.FORBIDDEN]: 403,
  [IMPORT_ERROR_CODES.PERSISTENCE]: 500,
  [IMPORT_ERROR_CODES.CONFLICT]: 409,
  [IMPORT_ERROR_CODES.INTERNAL]: 500,
};

export type ImportErrorStatus = 401 | 403 | 408 | 409 | 413 | 415 | 422 | 500;

export type ImportRouteError = {
  code: ImportErrorCode;
  status: ImportErrorStatus;
  message: string;
};

export type ImportRouteFailure = {
  ok: false;
  error: ImportRouteError;
};

export type ImportRouteSuccess = {
  ok: true;
  documentId: string;
  documentPath: string;
};

export type ImportRouteResult = ImportRouteSuccess | ImportRouteFailure;

export type ImportCreationTarget =
  | { kind: "personal" }
  | { kind: "workspace"; workspaceId: string };

export type ParsedImportUpload = {
  file: File;
  target: ImportCreationTarget;
};

function asImportErrorStatus(status: number): ImportErrorStatus | null {
  if (
    status === 401 ||
    status === 403 ||
    status === 408 ||
    status === 409 ||
    status === 413 ||
    status === 415 ||
    status === 422 ||
    status === 500
  ) {
    return status;
  }
  return null;
}

export function importErrorStatusForCode(
  code: ImportErrorCode,
): ImportErrorStatus {
  return IMPORT_ERROR_STATUS_BY_CODE[code] as ImportErrorStatus;
}

export function importFailure(
  code: ImportErrorCode,
  message: string,
  status: ImportErrorStatus = importErrorStatusForCode(code),
): ImportRouteFailure {
  return {
    ok: false,
    error: { code, status, message },
  };
}

export function isImportErrorCode(value: unknown): value is ImportErrorCode {
  return (
    typeof value === "string" &&
    Object.values(IMPORT_ERROR_CODES).includes(value as ImportErrorCode)
  );
}

export function isImportRouteFailure(
  value: unknown,
): value is ImportRouteFailure {
  if (!isPlainObject(value) || value.ok !== false) {
    return false;
  }
  const error = value.error;
  if (!isPlainObject(error)) {
    return false;
  }
  const status = asImportErrorStatus(
    isFiniteNumber(error.status) ? error.status : Number.NaN,
  );
  return (
    status !== null &&
    isImportErrorCode(error.code) &&
    isNonEmptyString(error.message)
  );
}

export function parseImportRouteResult(
  value: unknown,
): ImportRouteResult | null {
  if (!isPlainObject(value)) {
    return null;
  }

  if (value.ok === false) {
    return isImportRouteFailure(value) ? value : null;
  }

  if (value.ok !== true) {
    return null;
  }

  if (
    !isNonEmptyString(value.documentId) ||
    !isNonEmptyString(value.documentPath)
  ) {
    return null;
  }
  return {
    ok: true,
    documentId: value.documentId,
    documentPath: value.documentPath,
  };
}
