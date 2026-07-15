import { NextResponse, type NextRequest } from "next/server";

import { readFormData } from "@/lib/api/route-adapters";
import {
  IMPORT_ERROR_CODES,
  importFailure,
  type ImportRouteFailure,
  type ParsedImportUpload,
} from "@/lib/import/contract";
import {
  IMPORT_MAX_UPLOAD_BYTES,
  IMPORT_MULTIPART_ENVELOPE_MAX_BYTES,
} from "@/lib/import/format-registry";

function importFailureResponse(
  failure: ImportRouteFailure,
): NextResponse<ImportRouteFailure> {
  return NextResponse.json(failure, { status: failure.error.status });
}

export async function parseImportUploadRequest(
  request: Pick<NextRequest, "formData"> &
    Partial<Pick<NextRequest, "headers">>,
): Promise<
  | { ok: true; parsed: ParsedImportUpload }
  | { ok: false; response: NextResponse<ImportRouteFailure> }
> {
  const form = await readFormData(
    request,
    "Request must be multipart/form-data.",
    (message) =>
      importFailureResponse(
        importFailure(IMPORT_ERROR_CODES.MALFORMED, message, 422),
      ),
    {
      maxBytes: IMPORT_MAX_UPLOAD_BYTES + IMPORT_MULTIPART_ENVELOPE_MAX_BYTES,
      tooLargeMessage: "Uploaded file is too large.",
    },
  );
  if (!form.ok) {
    if (form.response.status === 413) {
      return {
        ok: false,
        response: importFailureResponse(
          importFailure(
            IMPORT_ERROR_CODES.TOO_LARGE,
            "Uploaded file is too large.",
          ),
        ),
      };
    }
    return {
      ok: false,
      response: importFailureResponse(
        importFailure(
          IMPORT_ERROR_CODES.MALFORMED,
          "Request must be multipart/form-data.",
          422,
        ),
      ),
    };
  }

  const file = form.formData.get("file");
  if (!(file instanceof File)) {
    return {
      ok: false,
      response: importFailureResponse(
        importFailure(
          IMPORT_ERROR_CODES.MALFORMED,
          "Missing `file` field in form data.",
          422,
        ),
      ),
    };
  }

  const targetRaw = form.formData.get("target");
  if (targetRaw === null || targetRaw === "") {
    return {
      ok: true,
      parsed: { file, target: null },
    };
  }
  if (typeof targetRaw !== "string") {
    return {
      ok: false,
      response: importFailureResponse(
        importFailure(
          IMPORT_ERROR_CODES.MALFORMED,
          "Invalid `target` field in form data.",
          422,
        ),
      ),
    };
  }
  if (targetRaw === "personal") {
    return {
      ok: true,
      parsed: { file, target: { kind: "personal" } },
    };
  }
  if (targetRaw === "workspace") {
    const workspaceId = form.formData.get("workspaceId");
    if (typeof workspaceId !== "string" || workspaceId.trim().length === 0) {
      return {
        ok: false,
        response: importFailureResponse(
          importFailure(
            IMPORT_ERROR_CODES.MALFORMED,
            "Missing `workspaceId` for workspace import target.",
            422,
          ),
        ),
      };
    }
    return {
      ok: true,
      parsed: {
        file,
        target: { kind: "workspace", workspaceId: workspaceId.trim() },
      },
    };
  }

  return {
    ok: false,
    response: importFailureResponse(
      importFailure(
        IMPORT_ERROR_CODES.MALFORMED,
        "Invalid `target` field in form data.",
        422,
      ),
    ),
  };
}
