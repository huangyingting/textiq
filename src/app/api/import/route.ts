/**
 * POST /api/import — parse an uploaded document, and optionally create a
 * persisted document in one server-side operation.
 *
 * Accepts `multipart/form-data` with a `file` field containing one of:
 * .md, .html, .docx, .pptx, .pdf (up to 20 MB per file; multipart overhead has
 * a separate bounded allowance). With no `target` field, this route returns
 * parsed Markdown (`{ ok: true, mode: "parse", markdown }`). With
 * `target=personal|workspace`, it parses + normalizes + persists and returns the
 * new document id/path (`{ ok: true, mode: "create", ... }`).
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
  type ImportRouteResult,
} from "@/lib/import/contract";
import { processImportUpload } from "@/lib/import/upload-service";
import { logError } from "@/lib/log";
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
  const startedAt = Date.now();
  const fileType = classifyFileType(file);
  const fileSizeBucket = bucketBytes(file.size);
  emitProductTelemetry("product.import.started", {
    fileSizeBucket,
    fileType,
    surface: "api",
  });

  let result: ImportRouteResult;
  if (!target) {
    const parsedUpload = await processImportUpload(file, {
      subjectHash: ipCheck.subjectHash,
    });
    result = parsedUpload.ok
      ? { ok: true, mode: "parse", markdown: parsedUpload.markdown }
      : parsedUpload;
  } else {
    result = await createDocumentFromImportUpload({
      file,
      subjectHash: ipCheck.subjectHash,
      target,
    });
  }

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
