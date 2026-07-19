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

export type ImportErrorStatus = 401 | 403 | 408 | 409 | 413 | 415 | 422 | 500;

export const IMPORT_ERROR_STATUS_BY_CODE: Record<
  ImportErrorCode,
  ImportErrorStatus
> = {
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
  { kind: "personal" } | { kind: "workspace"; workspaceId: string };

export type ParsedImportUpload = {
  file: File;
  target: ImportCreationTarget;
};

export function importErrorStatusForCode(
  code: ImportErrorCode,
): ImportErrorStatus {
  return IMPORT_ERROR_STATUS_BY_CODE[code];
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
    Object.values(IMPORT_ERROR_CODES).some((code) => code === value)
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const presentKeys = Object.keys(value);
  return (
    presentKeys.length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

export function isImportRouteFailure(
  value: unknown,
): value is ImportRouteFailure {
  if (!isPlainObject(value)) {
    return false;
  }
  if (!hasExactKeys(value, ["ok", "error"]) || value.ok !== false) {
    return false;
  }
  const error = value.error;
  if (!isPlainObject(error)) {
    return false;
  }
  if (!hasExactKeys(error, ["code", "status", "message"])) {
    return false;
  }
  if (!isImportErrorCode(error.code)) {
    return false;
  }
  if (!isFiniteNumber(error.status) || !isNonEmptyString(error.message)) {
    return false;
  }
  return error.status === importErrorStatusForCode(error.code);
}

export function parseImportRouteResult(
  value: unknown,
): ImportRouteResult | null {
  if (!isPlainObject(value)) {
    return null;
  }

  if (value.ok === false) {
    if (!isImportRouteFailure(value)) {
      return null;
    }
    return {
      ok: false,
      error: {
        code: value.error.code,
        status: value.error.status,
        message: value.error.message,
      },
    };
  }

  if (value.ok !== true) {
    return null;
  }
  if (!hasExactKeys(value, ["ok", "documentId", "documentPath"])) {
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
