/**
 * POST /api/import — parse an uploaded document and create a persisted document
 * in one server-side operation.
 *
 * Accepts `multipart/form-data` with a `file` field containing one of:
 * .md, .html, .docx, .pptx, .pdf (up to 20 MB per file; multipart overhead has
 * a separate bounded allowance). Requires `target=personal|workspace` (plus
 * `workspaceId` for workspace target), then parses + normalizes + persists and
 * returns the new document id/path (`{ ok: true, documentId, documentPath }`).
 */

import { NextResponse, type NextRequest } from "next/server";

import { tooManyRequests } from "@/lib/api/errors";
import { checkIpRateLimit } from "@/lib/abuse-budget";
import { ABUSE_CATEGORIES, logRouteDenial } from "@/lib/diagnostics/api-abuse";
import { auth as authEnv } from "@/lib/env";
import { createDocumentFromImportUpload } from "@/lib/import/application-service";
import {
  IMPORT_ERROR_CODES,
  importFailure,
  type ImportRouteFailure,
} from "@/lib/import/contract";
import { IMPORT_PARSE_TIMEOUT_MS } from "@/lib/import/format-registry";
import { logError } from "@/lib/log";
import { getCurrentUser } from "@/lib/session";
import {
  bucketBytes,
  bucketDurationMs,
  classifyFileType,
  emitProductTelemetry,
  reasonFromImportError,
} from "@/lib/telemetry/product";

import { parseImportUploadRequest } from "./parser";

// Node.js runtime: the parsers (mammoth, jszip, pdfjs) require it.
export const runtime = "nodejs";

const LOG_SCOPE = "api.import";

function importFailureResponse(
  failure: ImportRouteFailure,
): NextResponse<ImportRouteFailure> {
  return NextResponse.json(failure, { status: failure.error.status });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = authEnv.secret();
  if (!secret) {
    const failure = importFailure(
      IMPORT_ERROR_CODES.INTERNAL,
      "Server is misconfigured (missing AUTH_SECRET).",
    );
    logError(LOG_SCOPE, new Error("Missing AUTH_SECRET"), {
      reason: "missing-auth-secret",
      code: failure.error.code,
      status: failure.error.status,
    });
    return importFailureResponse(failure);
  }

  const user = await getCurrentUser();
  if (!user?.id) {
    return importFailureResponse(
      importFailure(
        IMPORT_ERROR_CODES.UNAUTHORIZED,
        "Sign in to import a document.",
      ),
    );
  }

  const ipCheck = await checkIpRateLimit({
    namespace: "import.ip",
    headers: request.headers,
    secret,
  });
  if (!ipCheck.allowed) {
    logRouteDenial({
      route: LOG_SCOPE,
      reason: ABUSE_CATEGORIES.RATE_LIMIT_HIT,
      status: 429,
      subjectHash: ipCheck.subjectHash,
      retryAfterSeconds: ipCheck.retryAfterSeconds,
    });
    return tooManyRequests(
      ipCheck.retryAfterSeconds,
      "Too many imports. Please wait a moment and try again.",
    );
  }

  const parsed = await parseImportUploadRequest(request);
  if (!parsed.ok) {
    return parsed.response;
  }

  const { file, target } = parsed.parsed;
  const deadlineAt = Date.now() + IMPORT_PARSE_TIMEOUT_MS;
  const startedAt = Date.now();
  const fileType = classifyFileType(file);
  const fileSizeBucket = bucketBytes(file.size);
  emitProductTelemetry("product.import.started", {
    fileSizeBucket,
    fileType,
    surface: "api",
  });

  const result = await createDocumentFromImportUpload({
    file,
    subjectHash: ipCheck.subjectHash,
    target,
    signal: request.signal,
    deadlineAt,
  });

  if (!result.ok) {
    emitProductTelemetry("product.import.failed", {
      durationBucket: bucketDurationMs(Date.now() - startedAt),
      failureReason: reasonFromImportError(result.error),
      fileSizeBucket,
      fileType,
      status: result.error.status,
      surface: "api",
    });
    return importFailureResponse(result);
  }

  emitProductTelemetry("product.import.succeeded", {
    durationBucket: bucketDurationMs(Date.now() - startedAt),
    fileSizeBucket,
    fileType,
    surface: "api",
  });
  return NextResponse.json(result);
}
