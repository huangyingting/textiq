import assert from "node:assert/strict";
import { test } from "node:test";

import {
  IMPORT_ERROR_CODES,
  importFailure,
  importErrorStatusForCode,
  isImportRouteFailure,
  parseImportRouteResult,
  type ImportErrorCode,
  type ImportErrorStatus,
} from "./contract";

const ALL_IMPORT_CODES: ImportErrorCode[] = Object.values(IMPORT_ERROR_CODES);
const ALL_STATUSES: ImportErrorStatus[] = [
  401, 403, 408, 409, 413, 415, 422, 500,
];

test("import contract guard accepts canonical failure payloads for all 12 import error codes", () => {
  for (const code of ALL_IMPORT_CODES) {
    const failure = importFailure(code, `${code} message`);
    assert.equal(
      isImportRouteFailure(failure),
      true,
      `expected canonical ${code} failure to pass`,
    );
    assert.deepEqual(
      parseImportRouteResult(failure),
      failure,
      `expected canonical ${code} failure to parse`,
    );
  }
});

test("import contract guard rejects every canonical status mismatch for all 12 import error codes", () => {
  for (const code of ALL_IMPORT_CODES) {
    const canonicalStatus = importErrorStatusForCode(code);
    for (const status of ALL_STATUSES) {
      if (status === canonicalStatus) {
        continue;
      }
      const failure = {
        ok: false,
        error: {
          code,
          status,
          message: `${code} mismatch`,
        },
      };
      assert.equal(
        isImportRouteFailure(failure),
        false,
        `${code} must reject non-canonical status ${status}`,
      );
      assert.equal(
        parseImportRouteResult(failure),
        null,
        `${code} mismatch ${status} must not parse`,
      );
    }
  }
});

test("import contract guard rejects unknown, malformed, or non-canonical failure shapes", () => {
  const unknownCodeFailure = {
    ok: false,
    error: {
      code: "not-a-real-code",
      status: 422,
      message: "bad",
    },
  };
  assert.equal(isImportRouteFailure(unknownCodeFailure), false);
  assert.equal(parseImportRouteResult(unknownCodeFailure), null);

  const emptyMessageFailure = {
    ok: false,
    error: {
      code: IMPORT_ERROR_CODES.MALFORMED,
      status: 422,
      message: "   ",
    },
  };
  assert.equal(isImportRouteFailure(emptyMessageFailure), false);
  assert.equal(parseImportRouteResult(emptyMessageFailure), null);

  const unknownStatusFailure = {
    ok: false,
    error: {
      code: IMPORT_ERROR_CODES.MALFORMED,
      status: 499,
      message: "bad",
    },
  };
  assert.equal(isImportRouteFailure(unknownStatusFailure), false);
  assert.equal(parseImportRouteResult(unknownStatusFailure), null);

  const missingErrorField = {
    ok: false,
  };
  assert.equal(isImportRouteFailure(missingErrorField), false);
  assert.equal(parseImportRouteResult(missingErrorField), null);

  const extraFailureTopLevelField = {
    ok: false,
    error: {
      code: IMPORT_ERROR_CODES.MALFORMED,
      status: 422,
      message: "bad",
    },
    retryAfterSeconds: 10,
  };
  assert.equal(isImportRouteFailure(extraFailureTopLevelField), false);
  assert.equal(parseImportRouteResult(extraFailureTopLevelField), null);

  const extraErrorField = {
    ok: false,
    error: {
      code: IMPORT_ERROR_CODES.MALFORMED,
      status: 422,
      message: "bad",
      details: "unexpected",
    },
  };
  assert.equal(isImportRouteFailure(extraErrorField), false);
  assert.equal(parseImportRouteResult(extraErrorField), null);
});

test("parseImportRouteResult enforces strict success shape and ok flag", () => {
  const validSuccess = {
    ok: true,
    documentId: "doc-1",
    documentPath: "/app/documents/doc-1",
  };
  assert.deepEqual(parseImportRouteResult(validSuccess), validSuccess);

  const successWithExtraField = {
    ok: true,
    documentId: "doc-1",
    documentPath: "/app/documents/doc-1",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  assert.equal(parseImportRouteResult(successWithExtraField), null);

  const missingPathSuccess = {
    ok: true,
    documentId: "doc-1",
  };
  assert.equal(parseImportRouteResult(missingPathSuccess), null);

  const invalidOk = {
    ok: "true",
    documentId: "doc-1",
    documentPath: "/app/documents/doc-1",
  };
  assert.equal(parseImportRouteResult(invalidOk), null);
});

test("importFailure defaults to canonical status for every import error code", () => {
  for (const code of ALL_IMPORT_CODES) {
    const failure = importFailure(code, `${code} message`);
    assert.equal(failure.error.status, importErrorStatusForCode(code));
  }
});
